// Sharp satellite tiles for a zoomed-in view: Sentinel-2 cloudless by EOX, 10 m a pixel, in Web Mercator
// tiles, laid on the map's own projection in pieces small enough for an affine transform to fit each one.
import { geoAzimuthalEqualArea, geoConicEqualArea, geoEqualEarth, geoPath, type GeoProjection } from "d3-geo";
import type { Box, Pair } from "./geometry.ts";

/** How scripts/satellite.mjs describes a map's projection, with points the copy must land on. */
export interface ProjectionSpec {
  /** Pixels per map unit of the map's base satellite image. */
  pixelsPerUnit: number;
  kind: "equalEarth" | "azimuthalEqualArea" | "conicEqualArea";
  rotate: [number, number, number];
  center: [number, number];
  parallels?: [number, number];
  scale: number;
  translate: [number, number];
  /** [lon, lat, x, y]: where the map's projection puts each point. */
  checks: [number, number, number, number][];
}

export interface Tile {
  key: string;
  href: string;
  /** The tile is laid in `split` × `split` pieces, so each bends with the projection. */
  split: number;
  /** Row by row, the SVG transform of a 1×1 square to each piece's place on the map. */
  pieces: string[];
}

const TILE_PX = 256;
/** Sentinel-2 has 10 m pixels: tiles past this level are only enlarged. */
const MAX_LEVEL = 14;
/** Tiles on screen at once; past it, a coarser level. */
const MAX_TILES = 128;
/** Device pixels a piece of tile may stray from its place; past it, the tile is cut finer. */
const MAX_ERROR_PX = 0.5;
const MAX_SPLIT = 16;
/** Web Mercator metres per tile pixel at level 0 on the equator. */
const MERCATOR_M_PER_PX = 40075016.686 / TILE_PX;
const KINDS = { equalEarth: geoEqualEarth, azimuthalEqualArea: geoAzimuthalEqualArea, conicEqualArea: geoConicEqualArea };

const tileUrl = (z: number, x: number, y: number) =>
  `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/${z}/${y}/${x}.jpg`;

export function rebuild(spec: ProjectionSpec): GeoProjection {
  const projection = KINDS[spec.kind]().rotate(spec.rotate).center(spec.center).scale(spec.scale).translate(spec.translate);
  if (spec.parallels) (projection as ReturnType<typeof geoConicEqualArea>).parallels(spec.parallels);
  return projection;
}

const lonOf = (x: number, n: number) => (x / n) * 360 - 180;
const latOf = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
const columnOf = (lon: number, n: number) => ((lon + 180) / 360) * n;
const rowOf = (lat: number, n: number) => {
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n;
};

/** Lays sharp tiles over the base image once the screen shows more detail than it has. */
export interface Tiler {
  /** The globe's outline on the map, as an SVG path: tiles stop there, like the base image. */
  globe: string;
  /** Tiles covering `box` (map units) at `pixelsPerUnit` device pixels per map unit; none while the base image is enough. */
  tiles(box: Box, pixelsPerUnit: number): Tile[];
}

export function tiler(spec: ProjectionSpec): Tiler {
  const projection = rebuild(spec);
  return { globe: geoPath(projection)({ type: "Sphere" }) ?? "", tiles: (box, pixelsPerUnit) => tilesFor(projection, spec, box, pixelsPerUnit) };
}

function tilesFor(projection: GeoProjection, spec: ProjectionSpec, box: Box, pixelsPerUnit: number): Tile[] {
  if (pixelsPerUnit <= spec.pixelsPerUnit * 1.25) return [];
  const [x0, y0, x1, y1] = box;
  // Longitudes count from the map's middle meridian, so a view across the antimeridian stays in one piece.
  const middle = -spec.rotate[0];
  const lons: number[] = [];
  const lats: number[] = [];
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p: Pair = [x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * j) / 8];
      const ll = projection.invert!(p);
      const back = ll && projection(ll);
      if (!ll || !back || Math.hypot(back[0] - p[0], back[1] - p[1]) > 0.01) continue;
      lons.push(middle + ((((ll[0] - middle + 180) % 360) + 360) % 360) - 180);
      lats.push(ll[1]);
    }
  }
  if (lons.length === 0) return [];
  const [west, east, south, north] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  // The map's scale where the view is: a hundredth of a degree of latitude is 1113 m.
  const mid: Pair = [(west + east) / 2, (south + north) / 2];
  const a = projection(mid)!;
  const b = projection([mid[0], mid[1] + 0.01])!;
  const metresPerPixel = 1113.2 / Math.hypot(b[0] - a[0], b[1] - a[1]) / pixelsPerUnit;
  const cos = Math.cos((mid[1] * Math.PI) / 180);
  let z = Math.min(MAX_LEVEL, Math.max(1, Math.ceil(Math.log2((MERCATOR_M_PER_PX * cos) / metresPerPixel))));
  const range = (level: number) => {
    const n = 2 ** level;
    return [Math.floor(columnOf(west, n)), Math.floor(rowOf(north, n)), Math.floor(columnOf(east, n)), Math.floor(rowOf(south, n))];
  };
  let [c0, r0, c1, r1] = range(z);
  while (z > 1 && (c1 - c0 + 1) * (r1 - r0 + 1) > MAX_TILES) [c0, r0, c1, r1] = range(--z);
  const n = 2 ** z;
  const tiles: Tile[] = [];
  for (let c = c0; c <= c1; c++) {
    for (let r = Math.max(0, r0); r <= Math.min(n - 1, r1); r++) {
      const at = (u: number, v: number) => projection([lonOf(c + u, n), latOf(r + v, n)])!;
      const whole = fit(at, 0, 0, 1, pixelsPerUnit);
      if (!whole) continue;
      const xs = whole.corners.map((p) => p[0]);
      const ys = whole.corners.map((p) => p[1]);
      if (Math.max(...xs) < x0 || Math.min(...xs) > x1 || Math.max(...ys) < y0 || Math.min(...ys) > y1) continue;
      let split = 1;
      let pieces = [whole];
      while (split < MAX_SPLIT && Math.max(...pieces.map((p) => p.error)) * pixelsPerUnit > MAX_ERROR_PX) {
        split *= 2;
        const size = 1 / split;
        pieces = Array.from({ length: split * split }, (_, i) => fit(at, (i % split) * size, Math.floor(i / split) * size, size, pixelsPerUnit)!);
      }
      const column = ((c % n) + n) % n;
      // The split is in the key: zoomed in further, the same tile may need finer pieces.
      tiles.push({ key: `${z}/${column}/${r}/${split}`, href: tileUrl(z, column, r), split, pieces: pieces.map((p) => p.transform) });
    }
  }
  return tiles;
}

/**
 * The affine transform that best lays the square [u, u + size] × [v, v + size] of a tile, whose projection
 * is `at`, with how far it strays from it in map units; none for a square cut in two by the world map's edge.
 */
function fit(at: (u: number, v: number) => Pair, u: number, v: number, size: number, pixelsPerUnit: number) {
  const corners = [at(u, v), at(u + size, v), at(u, v + size), at(u + size, v + size)];
  const [p00, p10, p01, p11] = corners;
  // Least squares over the four corners.
  const ex = [(p10[0] - p00[0] + p11[0] - p01[0]) / 2, (p10[1] - p00[1] + p11[1] - p01[1]) / 2];
  const ey = [(p01[0] - p00[0] + p11[0] - p10[0]) / 2, (p01[1] - p00[1] + p11[1] - p10[1]) / 2];
  const centre = [(p00[0] + p10[0] + p01[0] + p11[0]) / 4, (p00[1] + p10[1] + p01[1] + p11[1]) / 4];
  const twist = Math.hypot(p11[0] - p10[0] - p01[0] + p00[0], p11[1] - p10[1] - p01[1] + p00[1]);
  if (twist > 0.25 * Math.min(Math.hypot(ex[0], ex[1]), Math.hypot(ey[0], ey[1]))) return null;
  const middle = at(u + size / 2, v + size / 2);
  const error = Math.max(twist / 4, Math.hypot(middle[0] - centre[0], middle[1] - centre[1]));
  // A device pixel larger on every side, so neighbours overlap instead of leaving hairline seams.
  const grow = 1 + 2 / (Math.min(Math.hypot(ex[0], ex[1]), Math.hypot(ey[0], ey[1])) * pixelsPerUnit);
  const m = [...ex, ...ey].map((value) => value * grow);
  const origin = [centre[0] - (m[0] + m[2]) / 2, centre[1] - (m[1] + m[3]) / 2];
  return { corners, error, transform: `matrix(${[...m, ...origin].join(" ")})` };
}
