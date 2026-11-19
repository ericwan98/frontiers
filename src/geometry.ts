import polygonClipping, { type MultiPolygon, type Pair, type Ring } from "polygon-clipping";

export type { MultiPolygon, Pair, Ring };

export const union = (...shapes: MultiPolygon[]): MultiPolygon =>
  shapes.length === 0 ? [] : polygonClipping.union(shapes[0], ...shapes.slice(1));

export const intersection = (a: MultiPolygon, b: MultiPolygon): MultiPolygon =>
  a.length === 0 || b.length === 0 ? [] : polygonClipping.intersection(a, b);

export const difference = (a: MultiPolygon, b: MultiPolygon): MultiPolygon =>
  a.length === 0 ? [] : b.length === 0 ? a : polygonClipping.difference(a, b);

/** A freehand loop as a shape; union resolves self-crossings into separate lobes. */
export const loop = (ring: Ring): MultiPolygon => (ring.length < 3 ? [] : union([[[...ring, ring[0]]]]));

function signedArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}

export function area(shape: MultiPolygon): number {
  let total = 0;
  for (const [outer, ...holes] of shape) {
    total += Math.abs(signedArea(outer));
    for (const hole of holes) total -= Math.abs(signedArea(hole));
  }
  return total;
}

/** Area-weighted centroid, holes included; null for an empty shape. */
export function centroid(shape: MultiPolygon): Pair | null {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (const polygon of shape) {
    polygon.forEach((ring, i) => {
      const sa = signedArea(ring);
      // Outer rings count positive and holes negative, whatever their winding.
      const sign = (i === 0 ? 1 : -1) * Math.sign(sa);
      for (let k = 0; k < ring.length - 1; k++) {
        const [x0, y0] = ring[k];
        const [x1, y1] = ring[k + 1];
        const cross = x0 * y1 - x1 * y0;
        cx += sign * (x0 + x1) * cross;
        cy += sign * (y0 + y1) * cross;
      }
      a += sign * sa;
    });
  }
  return a === 0 ? null : [cx / (6 * a), cy / (6 * a)];
}

/** [minX, minY, maxX, maxY] */
export type Box = [number, number, number, number];

export function bbox(shape: MultiPolygon): Box {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [outer] of shape)
    for (const [x, y] of outer) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  return box;
}

/** The box around a few points, e.g. a pin and the city it was meant for. */
export function pointsBox(points: Pair[]): Box {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Whether `point` is inside `shape`, holes excluded (even-odd rule). */
export function contains(shape: MultiPolygon, [px, py]: Pair): boolean {
  let inside = false;
  for (const polygon of shape)
    for (const ring of polygon)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
  return inside;
}

/** Where to put a label: the centroid of the largest piece. */
export function labelPoint(shape: MultiPolygon): Pair | null {
  let best: MultiPolygon = [];
  let bestArea = 0;
  for (const polygon of shape) {
    const a = area([polygon]);
    if (a > bestArea) [best, bestArea] = [[polygon], a];
  }
  return centroid(best);
}

/** Ramer–Douglas–Peucker: drops points closer than `tolerance` to the simplified line. */
export function simplify(points: Ring, tolerance: number): Ring {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const len = Math.hypot(bx - ax, by - ay);
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const d =
        len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > maxDist) [maxDist, index] = [d, i];
    }
    if (maxDist > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function toPath(shape: MultiPolygon): string {
  let d = "";
  for (const polygon of shape)
    for (const ring of polygon) d += "M" + ring.map(([x, y]) => `${+x.toFixed(1)},${+y.toFixed(1)}`).join("L") + "Z";
  return d;
}
