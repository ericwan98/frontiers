// Builds src/maps/paris.json: the 20 arrondissements and the Seine and canals, from
// opendata.paris.fr (ODbL).
import { geoAzimuthalEqualArea } from "d3-geo";
import { fetchJson, frame, rewind, shape, writeMap } from "./lib.mjs";

const SOURCE = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arrondissements/exports/geojson";
const WATER = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/plan-de-voirie-voies-deau/exports/geojson";
const ordinal = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

const { features } = await fetchJson(SOURCE);
if (features.length !== 20) throw new Error(`expected 20 arrondissements, found ${features.length}`);
const lonlat = features
  .map((f) => ({ n: f.properties.c_ar, geometry: rewind(f.geometry) }))
  .sort((a, b) => a.n - b.n);

const projection = geoAzimuthalEqualArea().rotate([-2.35, -48.86]);
const height = frame(projection, { type: "GeometryCollection", geometries: lonlat.map((r) => r.geometry) });

writeMap({
  id: "paris",
  name: "Paris",
  height,
  projection,
  // Neighbouring arrondissements leave gaps of up to ~800 m² between them; Paris has no real holes.
  minHole: 10,
  water: (await fetchJson(WATER)).features.map((f) => shape(rewind(f.geometry), projection)),
  regions: lonlat.map(({ n, geometry }) => ({
    id: String(n),
    name: `${ordinal(n)} arrondissement`,
    short: n === 1 ? "1er" : `${n}e`,
    geometry: shape(geometry, projection),
  })),
});
