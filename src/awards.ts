// End-of-game superlatives: the funniest things a finished map says about its author.
import type { Game, Placement } from "./game.ts";
import { area, bbox, intersection, type Box } from "./geometry.ts";

export interface Award {
  emoji: string;
  title: string;
  /** Region the award is about, to show it on the map. */
  regionId: string;
  /** The award as a sentence, about "Your" or "My" map. */
  says: (whose: "Your" | "My") => string;
}

/** Share of a region another drawing must cover to count as a takeover. */
const TAKEOVER_MIN = 0.25;
const INFLATED_MIN = 1.8;
const SHRUNK_MAX = 0.4;
const SNIPER_MIN = 0.7;
/** Points under which a far-off drawing counts as lost. */
const LOST_MAX_POINTS = 30;

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

function findAwards(g: Game): Award[] {
  const drawn = g.placements.filter((p): p is Placement & { score: NonNullable<Placement["score"]> } => !!p.score);
  if (drawn.length === 0) return [];
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

  const farthest = [...drawn].sort((a, b) => (b.score.distanceKm ?? 0) - (a.score.distanceKm ?? 0))[0];
  if (farthest.score.points < LOST_MAX_POINTS) {
    out.push({
      emoji: "🧭",
      title: "Lost",
      regionId: farthest.regionId,
      says: (whose) => `${whose} ${name(farthest.regionId)} is ${formatKm(farthest.score.distanceKm ?? 0)} from home`,
    });
  }

  const sharpest = [...drawn].sort((a, b) => b.score.overlap - a.score.overlap)[0];
  if (sharpest.score.overlap >= SNIPER_MIN) {
    out.push({
      emoji: "🎯",
      title: "Sniper",
      regionId: sharpest.regionId,
      says: (whose) => `${whose} ${name(sharpest.regionId)} overlaps the real one by ${percent(sharpest.score.overlap)}`,
    });
  }
  return out;
}
