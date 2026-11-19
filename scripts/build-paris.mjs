// Builds src/maps/paris.json: the 20 arrondissements and the Seine and canals, from
// opendata.paris.fr (ODbL).
import { fetchJson, rewind, shape, writeMap } from "./lib.mjs";
import { arrondissements } from "./paris.mjs";

const WATER = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/plan-de-voirie-voies-deau/exports/geojson";
const ordinal = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

const { lonlat, projection, height } = await arrondissements();

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
