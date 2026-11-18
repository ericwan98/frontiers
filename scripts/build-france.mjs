// Builds src/maps/france.json: the 13 metropolitan regions (2016 borders) from
// github.com/gregoiredavid/france-geojson (IGN Admin Express, Licence Ouverte), neighbours from
// Natural Earth 50m for context.
import { geoAzimuthalEqualArea } from "d3-geo";
import { merge } from "topojson-client";
import world from "world-atlas/countries-50m.json" with { type: "json" };
import { fetchJson, frame, rewind, shape, writeMap } from "./lib.mjs";

const SOURCE = "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/regions-version-simplifiee.geojson";
// INSEE region code -> English display name.
const NAMES = {
  11: "Île-de-France",
  24: "Centre-Val de Loire",
  27: "Bourgogne-Franche-Comté",
  28: "Normandy",
  32: "Hauts-de-France",
  44: "Grand Est",
  52: "Pays de la Loire",
  53: "Brittany",
  75: "Nouvelle-Aquitaine",
  76: "Occitanie",
  84: "Auvergne-Rhône-Alpes",
  93: "Provence-Alpes-Côte d'Azur",
  94: "Corsica",
};

const { features } = await fetchJson(SOURCE);
if (features.length !== 13) throw new Error(`expected 13 regions, found ${features.length}`);
const lonlat = features.map((f) => ({ id: f.properties.code, geometry: rewind(f.geometry) }));

const projection = geoAzimuthalEqualArea().rotate([-2.5, -46.5]);
const height = frame(projection, { type: "GeometryCollection", geometries: lonlat.map((r) => r.geometry) });

writeMap({
  id: "france",
  name: "France",
  height,
  projection,
  regions: lonlat.map(({ id, geometry }) => {
    if (!NAMES[id]) throw new Error(`unknown region code ${id}`);
    return { id, name: NAMES[id], geometry: shape(geometry, projection) };
  }),
  context: world.objects.countries.geometries
    .filter((g) => g.properties?.name !== "France")
    .map((g) => shape(merge(world, [g]), projection)),
});
