// End-of-game superlatives: the funniest things a finished map says about its author.
import type { Game, Placement } from "./game.ts";
import { area, bbox, contains, intersection, type Box } from "./geometry.ts";

export interface Award {
  emoji: string;
  title: string;
  /** Region the award is about, to show it on the map. */
  regionId: string;
  /** The award as a sentence, about "Your" or "My" map. */
  says: (whose: "Your" | "My") => string;
  /** Praise rather than a blunder: shared results leave it out. */
  good?: boolean;
}

/** Share of a region another drawing must cover to count as a takeover. */
const TAKEOVER_MIN = 0.25;
const INFLATED_MIN = 1.8;
const SHRUNK_MAX = 0.4;
const SNIPER_MIN = 0.7;
/** Points under which a far-off drawing or pin counts as lost. */
const LOST_MAX_POINTS = 30;
const BULLSEYE_MIN_POINTS = 90;

export function formatKm(km: number): string {
  if (km >= 10) return `${Math.round(km).toLocaleString("en")} km`;
  if (km >= 1) return `${km.toFixed(1)} km`;
  return `${Math.round(km * 100) * 10} m`;
}

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const percent = (share: number) => `${Math.round(share * 100)}%`;

const earned = new WeakMap<Game, Award[]>();

/** The awards a finished game earns, the funniest first; none that don't apply. */
export function awards(g: Game): Award[] {
  if (!earned.has(g)) earned.set(g, findAwards(g));
  return earned.get(g)!;
}

type Scored = Placement & { score: NonNullable<Placement["score"]> };

function findAwards(g: Game): Award[] {
  const scored = g.placements.filter((p): p is Scored => !!p.score);
  if (scored.length === 0) return [];
  return g.mode === "cities" ? cityAwards(g, scored) : borderAwards(g, scored);
}

/** The placement that missed by the most, if it did badly enough to be lost. */
function lost(g: Game, scored: Scored[], name: (id: string) => string): Award[] {
  const farthest = [...scored].sort((a, b) => (b.score.distanceKm ?? 0) - (a.score.distanceKm ?? 0))[0];
  if (farthest.score.points >= LOST_MAX_POINTS) return [];
  return [
    {
      emoji: "🧭",
      title: "Lost",
      regionId: farthest.regionId,
      says: (whose) => `${whose} ${name(farthest.regionId)} is ${formatKm(farthest.score.distanceKm ?? 0)} from home`,
    },
  ];
}

function cityAwards(g: Game, pinned: Scored[]): Award[] {
  const city = (id: string) => g.target(id);
  const worstFirst = [...pinned].sort((a, b) => a.score.points - b.score.points);
  const out: Award[] = [];

  const wet = (p: Scored) =>
    contains(g.map.water ?? [], p.pin!) || !(contains(g.map.land, p.pin!) || contains(g.map.context, p.pin!));
  const sunk = worstFirst.find(wet);
  if (sunk) {
    out.push({ emoji: "🌊", title: "Atlantis", regionId: sunk.regionId, says: (whose) => `${whose} ${city(sunk.regionId)} is underwater` });
  }

  for (const p of worstFirst) {
    const host = g.map.regions.find((r) => r.id !== p.regionId && contains(r.geometry, p.pin!));
    if (!host) continue;
    out.push({
      emoji: "🛂",
      title: "Border control",
      regionId: p.regionId,
      says: (whose) => `${whose} ${city(p.regionId)} is in ${host.name}`,
    });
    break;
  }

  out.push(...lost(g, pinned, city));

  const best = worstFirst.at(-1)!;
  if (best.score.points >= BULLSEYE_MIN_POINTS) {
    out.push({
      emoji: "🎯",
      title: "Bullseye",
      regionId: best.regionId,
      says: (whose) =>
        (best.score.distanceKm ?? 0) < 1
          ? `${whose} ${city(best.regionId)} is spot on`
          : `${whose} ${city(best.regionId)} landed ${formatKm(best.score.distanceKm ?? 0)} from the real one`,
      good: true,
    });
  }
  return out;
}

function borderAwards(g: Game, drawn: Scored[]): Award[] {
  const name = (id: string) => g.map.regions.find((r) => r.id === id)!.name;
  const ratio = (p: Placement) => area(p.shape) / area(g.region(p.regionId).geometry);
  const out: Award[] = [];

  // Every region on the map counts, played or not: Germany can swallow Poland on a 10-country game.
  const boxes = new Map(g.map.regions.map((r) => [r.id, bbox(r.geometry)]));
  let takeover = { share: TAKEOVER_MIN, from: "", by: "" };
  for (const p of drawn) {
    const box = bbox(p.shape);
    for (const r of g.map.regions) {
      if (r.id === p.regionId || !overlaps(box, boxes.get(r.id)!)) continue;
      const share = area(intersection(p.shape, r.geometry)) / area(r.geometry);
      if (share > takeover.share) takeover = { share, from: r.id, by: p.regionId };
    }
  }
  if (takeover.by) {
    const { share, from, by } = takeover;
    out.push({
      emoji: "🏴‍☠️",
      title: "Hostile takeover",
      regionId: by,
      says: (whose) => `${whose} ${name(by)} took ${percent(share)} of ${name(from)}`,
    });
  }

  const byRatio = [...drawn].sort((a, b) => ratio(b) - ratio(a));
  const [biggest, smallest] = [byRatio[0], byRatio.at(-1)!];
  if (ratio(biggest) >= INFLATED_MIN) {
    const times = ratio(biggest).toFixed(ratio(biggest) < 10 ? 1 : 0);
    out.push({
      emoji: "🎈",
      title: "Inflation",
      regionId: biggest.regionId,
      says: (whose) => `${whose} ${name(biggest.regionId)} is ${times}× its real size`,
    });
  }
  if (ratio(smallest) <= SHRUNK_MAX) {
    out.push({
      emoji: "🔬",
      title: "Microstate",
      regionId: smallest.regionId,
      says: (whose) => `${whose} ${name(smallest.regionId)} is ${percent(ratio(smallest))} of its real size`,
    });
  }

  out.push(...lost(g, drawn, name));

  const overlap = (p: Scored) => p.score.overlap ?? 0;
  const sharpest = [...drawn].sort((a, b) => overlap(b) - overlap(a))[0];
  if (overlap(sharpest) >= SNIPER_MIN) {
    out.push({
      emoji: "🎯",
      title: "Sniper",
      regionId: sharpest.regionId,
      says: (whose) => `${whose} ${name(sharpest.regionId)} overlaps the real one by ${percent(overlap(sharpest))}`,
      good: true,
    });
  }
  return out;
}
