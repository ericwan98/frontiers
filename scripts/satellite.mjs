// Satellite imagery for a map: NASA Blue Marble Next Generation (July 2004, public domain), reprojected
// pixel by pixel with the map's own projection, so it lines up with the borders exactly.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { WIDTH } from "./lib.mjs";

const SOURCE = "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/";
const CACHE = new URL("../.cache/bmng/", import.meta.url);
const OUT = new URL("../src/maps/satellite/", import.meta.url);
/** Image pixels per map unit: the image stays sharp up to about 2x zoom. */
const PIXELS_PER_UNIT = 2.4;
const KM_PER_DEGREE = 111.32;

/** Whole-world image, 2 km a pixel. */
const GLOBAL = { perDegree: 60, tiles: [{ name: "world.topo.bathy.200407.3x21600x10800.jpg", col: 0, row: 0, w: 21600, h: 10800 }] };
/** Eight 90° tiles, 500 m a pixel: A1 is 180°W-90°W, 90°N-0°; A2 the same longitudes south of the equator. */
const TILED = {
  perDegree: 240,
  tiles: [..."ABCD"].flatMap((letter, i) =>
    [1, 2].map((n) => ({ name: `world.topo.bathy.200407.3x21600x21600.${letter}${n}.jpg`, col: i * 21600, row: (n - 1) * 21600, w: 21600, h: 21600 })),
  ),
};

async function download(name) {
  const file = fileURLToPath(new URL(name, CACHE));
  if (existsSync(file)) return file;
  mkdirSync(CACHE, { recursive: true });
  console.log(`  downloading ${name}`);
  const res = await fetch(SOURCE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${file}.part`));
  renameSync(`${file}.part`, file);
  return file;
}

/** Writes src/maps/satellite/<id>.webp, `PIXELS_PER_UNIT` times the map's size. */
export async function satellite(id, projection, height) {
  const width = Math.round(WIDTH * PIXELS_PER_UNIT);
  const rows = Math.round(height * PIXELS_PER_UNIT);

  // Where each pixel is on the globe; NaN off the projection's edge, e.g. around the world map's oval.
  const lon = new Float64Array(width * rows).fill(NaN);
  const lat = new Float64Array(width * rows).fill(NaN);
  let [west, east, south, north] = [180, -180, 90, -90];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const p = [(x + 0.5) / PIXELS_PER_UNIT, (y + 0.5) / PIXELS_PER_UNIT];
      const ll = projection.invert(p);
      const back = ll && projection(ll);
      if (!back || !(Math.hypot(back[0] - p[0], back[1] - p[1]) < 0.1)) continue;
      const i = y * width + x;
      lon[i] = ((((ll[0] + 180) % 360) + 360) % 360) - 180;
      lat[i] = ll[1];
      west = Math.min(west, lon[i]);
      east = Math.max(east, lon[i]);
      south = Math.min(south, lat[i]);
      north = Math.max(north, lat[i]);
    }
  }

  // Read the source at about twice the image's resolution, shrunk by a whole factor that divides the tiles.
  const kmPerPixel = 6371 / projection.scale() / PIXELS_PER_UNIT;
  const wanted = kmPerPixel / KM_PER_DEGREE / 2;
  const source = wanted < 1 / GLOBAL.perDegree ? TILED : GLOBAL;
  const shrink = [8, 6, 5, 4, 3, 2, 1].find((k) => k <= wanted * source.perDegree) ?? 1;
  const step = shrink / source.perDegree;
  const wrap = east - west > 300;
  if (wrap) [west, east] = [-180, 180];
  // The mosaic, in source pixels / shrink, from the north-west corner of the bounds.
  const col0 = Math.max(0, Math.floor(((west + 180) / step) - 2)) * shrink;
  const row0 = Math.max(0, Math.floor(((90 - north) / step) - 2)) * shrink;
  const col1 = Math.min(360 * source.perDegree, Math.ceil(((east + 180) / step) + 2) * shrink);
  const row1 = Math.min(180 * source.perDegree, Math.ceil(((90 - south) / step) + 2) * shrink);
  const mw = (col1 - col0) / shrink;
  const mh = (row1 - row0) / shrink;
  const mosaic = Buffer.alloc(mw * mh * 3);
  for (const tile of source.tiles) {
    const left = Math.max(col0, tile.col);
    const top = Math.max(row0, tile.row);
    const right = Math.min(col1, tile.col + tile.w);
    const bottom = Math.min(row1, tile.row + tile.h);
    if (right <= left || bottom <= top) continue;
    const w = (right - left) / shrink;
    const h = (bottom - top) / shrink;
    const part = await sharp(await download(tile.name), { limitInputPixels: false })
      .extract({ left: left - tile.col, top: top - tile.row, width: right - left, height: bottom - top })
      .resize(w, h)
      .removeAlpha()
      .raw()
      .toBuffer();
    const dx = (left - col0) / shrink;
    const dy = (top - row0) / shrink;
    for (let r = 0; r < h; r++) part.copy(mosaic, ((dy + r) * mw + dx) * 3, r * w * 3, (r + 1) * w * 3);
  }

  // Bilinear samples of the mosaic; pixels off the projection stay transparent.
  const out = Buffer.alloc(width * rows * 4);
  const at = (c, r, k) => mosaic[(Math.min(mh - 1, Math.max(0, r)) * mw + (wrap ? (c + mw) % mw : Math.min(mw - 1, Math.max(0, c)))) * 3 + k];
  for (let i = 0; i < lon.length; i++) {
    if (Number.isNaN(lon[i])) continue;
    const fx = (lon[i] + 180 - (col0 / source.perDegree)) / step - 0.5;
    const fy = (90 - lat[i] - (row0 / source.perDegree)) / step - 0.5;
    const c = Math.floor(fx);
    const r = Math.floor(fy);
    const tx = fx - c;
    const ty = fy - r;
    for (let k = 0; k < 3; k++) {
      const top = at(c, r, k) * (1 - tx) + at(c + 1, r, k) * tx;
      const bottom = at(c, r + 1, k) * (1 - tx) + at(c + 1, r + 1, k) * tx;
      out[i * 4 + k] = Math.round(top * (1 - ty) + bottom * ty);
    }
    out[i * 4 + 3] = 255;
  }

  mkdirSync(OUT, { recursive: true });
  const file = fileURLToPath(new URL(`${id}.webp`, OUT));
  const opaque = !lon.some(Number.isNaN);
  let image = sharp(out, { raw: { width, height: rows, channels: 4 } });
  if (opaque) image = image.removeAlpha();
  await image.webp({ quality: 70, effort: 6 }).toFile(file);
  console.log(`${id}.webp: ${width}x${rows}, ${(statSync(file).size / 1024).toFixed(0)} KB, source 1/${source.perDegree}° shrunk ${shrink}x`);
}
