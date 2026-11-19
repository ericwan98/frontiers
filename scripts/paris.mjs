// The arrondissements and projection shared by the Paris builders.
import { geoAzimuthalEqualArea } from "d3-geo";
import { fetchJson, frame, rewind } from "./lib.mjs";

const SOURCE = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arrondissements/exports/geojson";

/** The 20 arrondissements in lon/lat, in order, and the projection that frames them. */
export async function arrondissements() {
  const { features } = await fetchJson(SOURCE);
  if (features.length !== 20) throw new Error(`expected 20 arrondissements, found ${features.length}`);
  const lonlat = features
    .map((f) => ({ n: f.properties.c_ar, geometry: rewind(f.geometry) }))
    .sort((a, b) => a.n - b.n);
  const projection = geoAzimuthalEqualArea().rotate([-2.35, -48.86]);
  const height = frame(projection, { type: "GeometryCollection", geometries: lonlat.map((r) => r.geometry) });
  return { lonlat, projection, height };
}
