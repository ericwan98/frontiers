import type { GameMap } from "./game.ts";
import { tr } from "./i18n.ts";
import { area, centroid, intersection, type MultiPolygon, type Pair } from "./geometry.ts";

export interface Score {
  points: number;
  /** Intersection over union of the drawing and the real country, 0..1; absent for a pin. */
  overlap?: number;
  /** Distance between the two centroids, or the pin and the city; null when nothing was drawn. */
  distanceKm: number | null;
}

export const MAX_POINTS = 100;
const OVERLAP_WEIGHT = 0.75;
// Being in the right place earns points even when the shape is off. A drawing scores no
// placement points beyond twice the region's equivalent radius plus this share of the map
// width: about 190 km in Europe, 700 m in Paris.
const SLACK_SHARE = 0.04;

export function score(drawn: MultiPolygon, truth: MultiPolygon, map: Pick<GameMap, "width" | "kmPerUnit">): Score {
  const drawnArea = area(drawn);
  const c1 = centroid(drawn);
  const c2 = centroid(truth);
  if (drawnArea === 0 || !c1 || !c2) return { points: 0, overlap: 0, distanceKm: null };

  const truthArea = area(truth);
  const shared = area(intersection(drawn, truth));
  const overlap = shared / (drawnArea + truthArea - shared);

  const distance = Math.hypot(c1[0] - c2[0], c1[1] - c2[1]);
  const radius = Math.sqrt(truthArea / Math.PI);
  const closeness = Math.max(0, 1 - distance / (2 * radius + SLACK_SHARE * map.width));
  const distanceKm = distance * map.kmPerUnit;

  const points = Math.round(MAX_POINTS * (OVERLAP_WEIGHT * overlap + (1 - OVERLAP_WEIGHT) * closeness));
  return { points, overlap, distanceKm };
}

// A pin this close, as a share of the map width, scores full marks: about 160 km on the world
// map, 23 km on Europe. Past it, points fall by a factor e every FALLOFF_SHARE of the width.
export const BULLSEYE_SHARE = 0.005;
const FALLOFF_SHARE = 0.05;

export function pinScore(pin: Pair, truth: Pair, map: Pick<GameMap, "width" | "kmPerUnit">): Score {
  const distance = Math.hypot(pin[0] - truth[0], pin[1] - truth[1]);
  const off = Math.max(0, distance - BULLSEYE_SHARE * map.width) / (FALLOFF_SHARE * map.width);
  return { points: Math.round(MAX_POINTS * Math.exp(-off)), distanceKm: distance * map.kmPerUnit };
}

/** Score bands, best first: a name for the result card and a square for shared results. */
const TIERS = [
  { min: 85, name: tr("Cartographer", "Cartographe"), square: "🟩" },
  { min: 65, name: tr("Close enough", "Pas loin"), square: "🟨" },
  { min: 40, name: tr("Rough idea", "Une vague idée"), square: "🟧" },
  { min: 15, name: tr("Wrong neighbourhood", "Mauvais quartier"), square: "🟥" },
  { min: 0, name: tr("Here be dragons", "Ici vivent des dragons"), square: "⬛" },
];

const tier = (points: number) => TIERS.find((t) => points >= t.min)!;
export const verdict = (points: number): string => tier(points).name;
/** null is a skipped region. */
export const square = (points: number | null): string => (points === null ? "⬜" : tier(points).square);
