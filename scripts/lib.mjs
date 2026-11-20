// Shared helpers for the scripts/build-*.mjs map builders.
import { writeFileSync } from "node:fs";
import { geoArea, geoContains, geoDistance, geoPath } from "d3-geo";
import { geoProject } from "d3-geo-projection";
import polygonClipping from "polygon-clipping";

export const WIDTH = 1000;
const PAD = 10;

/**
 * Fits `projection` to `WIDTH` wide around `object` (any GeoJSON), with a little padding,
 * clips it to the frame and returns the frame height.
 */
export function frame(projection, object, { padX = PAD } = {}) {
  projection.fitWidth(WIDTH - 2 * padX, object);
  const [[x0, y0], [, y1]] = geoPath(projection).bounds(object);
  const [tx, ty] = projection.translate();
  projection.translate([tx + padX - x0, ty + PAD - y0]);
  const height = Math.round(y1 - y0 + 2 * PAD);
  // Composite projections like geoAlbersUsa clip each part themselves.
  projection.clipExtent?.([[0, 0], [WIDTH, height]]);
  return height;
}

const round = (v) => Math.round(v * 10) / 10;

/** Projects a lon/lat geometry to a polygon-clipping MultiPolygon, repairing what rounding breaks. */
export function shape(geometry, projection) {
  const projected = geoProject(geometry, projection);
  if (!projected) return [];
  const polys = projected.type === "Polygon" ? [projected.coordinates] : projected.coordinates;
  if (polys.length === 0) return [];
  return polygonClipping.union(polys.map((poly) => poly.map((ring) => ring.map(([x, y]) => [round(x), round(y)]))));
}

/**
 * d3 reads a polygon as the smaller of the two areas its rings enclose on the sphere only if the
 * exterior ring is clockwise. RFC 7946 files wind the other way, so flip polygons that came out
 * bigger than a hemisphere.
 */
export function rewind(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const fixed = polys.map((p) =>
    geoArea({ type: "Polygon", coordinates: p }) > 2 * Math.PI ? p.map((ring) => [...ring].reverse()) : p,
  );
  return { type: "MultiPolygon", coordinates: fixed };
}

export const union = (shapes) => (shapes.length ? polygonClipping.union(...shapes) : []);

export const ringArea = (ring) => Math.abs(ring.reduce((sum, [x0, y0], i) => {
  const [x1, y1] = ring[(i + 1) % ring.length];
  return sum + x0 * y1 - x1 * y0;
}, 0)) / 2;

/**
 * Writes src/maps/<id>.json; `land` is the union of the regions, `water` is drawn over it. Holes in it smaller than
 * `minHole` square units are slivers between regions that don't quite touch: they would
 * show the hidden borders, so they are filled.
 */
export function writeMap({ id, name, height, projection, regions, context = [], water = [], minHole = 0 }) {
  for (const r of regions) if (r.geometry.length === 0) throw new Error(`${id}: ${r.id} is outside the frame`);
  const map = {
    id,
    name,
    width: WIDTH,
    height,
    // d3 projections map the unit sphere's radius to `scale` units; every map uses an equal-area one.
    kmPerUnit: 6371 / projection.scale(),
    land: union(regions.map((r) => r.geometry)).map(([outer, ...holes]) => [
      outer,
      ...holes.filter((h) => ringArea(h) >= minHole),
    ]),
    context: union(context.filter((c) => c.length > 0)),
    ...(water.length ? { water: union(water.filter((w) => w.length > 0)) } : {}),
    regions,
  };
  const json = JSON.stringify(map);
  writeFileSync(new URL(`../src/maps/${id}.json`, import.meta.url), json);
  console.log(`${id}.json: ${regions.length} regions, ${WIDTH}x${height}, ${(json.length / 1024).toFixed(0)} KB`);
  // With --satellite, also renders the map's imagery; it needs sharp and a 0.3 GB download.
  if (process.argv.includes("--satellite")) return import("./satellite.mjs").then((m) => m.satellite(id, projection, height));
}

/** Downloads a JSON file, failing loudly. */
export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export const polygons = (geometry) => (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates);
const multi = (polys) => ({ type: "MultiPolygon", coordinates: polys });

/** Splits a lon/lat geometry into the polygons that `test` holds for and the rest. */
export function split(geometry, test) {
  return [multi(polygons(geometry).filter(test)), multi(polygons(geometry).filter((p) => !test(p)))];
}

/** Whether every point of a polygon's outer ring is inside the lon/lat box. */
export const within = ([west, south, east, north]) => (polygon) =>
  polygon[0].every(([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north);

/**
 * Natural Earth draws Crimea inside Russia; the game uses the internationally recognised border.
 * Takes and returns lon/lat geometries.
 */
export function moveCrimea(russia, ukraine) {
  const [crimea, rest] = split(russia, within([32, 44, 37, 46.3]));
  if (crimea.coordinates.length !== 1) throw new Error(`expected one Crimea polygon, found ${crimea.coordinates.length}`);
  return [rest, multi([...polygons(ukraine), ...crimea.coordinates])];
}

// Natural Earth's abbreviations, spelled out for players.
const DISPLAY_NAMES = {
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Central African Rep.": "Central African Republic",
  Congo: "Republic of the Congo",
  "Dem. Rep. Congo": "DR Congo",
  "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea",
  eSwatini: "Eswatini",
  Macedonia: "North Macedonia",
  "S. Sudan": "South Sudan",
  "Solomon Is.": "Solomon Islands",
  "United States of America": "United States",
};
export const displayName = (name) => DISPLAY_NAMES[name] ?? name;
export const slug = (name) => name.normalize("NFD").replace(/[^A-Za-z]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

/** Looks up world-atlas countries by Natural Earth name, failing loudly on a typo. */
export function countryIndex(topology) {
  const geometries = topology.objects.countries.geometries;
  const byName = new Map(geometries.map((g) => [g.properties?.name, g]));
  return {
    geometries,
    named: (names) =>
      names.map((n) => {
        const g = byName.get(n);
        if (!g) throw new Error(`unknown Natural Earth name: ${n}`);
        return g;
      }),
  };
}

const PLACES_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_populated_places_simple.geojson";

// Display names Natural Earth's populated places spell differently.
const PLACE_COUNTRIES = {
  Bahamas: "The Bahamas",
  "Côte d'Ivoire": "Ivory Coast",
  "DR Congo": "Congo (Kinshasa)",
  Eswatini: "eSwatini",
  Gambia: "The Gambia",
  "Guinea-Bissau": "Guinea Bissau",
  "Republic of the Congo": "Congo (Brazzaville)",
  "Timor-Leste": "East Timor",
  "United States": "United States of America",
};

// Where Natural Earth has several capitals for a country, or an out-of-date one: a place's name, or
// [name, lon, lat] for a place it doesn't have.
const CAPITALS = {
  Benin: "Porto-Novo",
  Bolivia: "Sucre",
  Burundi: ["Gitega", 29.925, -3.427],
  "Côte d'Ivoire": "Yamoussoukro",
  Greenland: "Nuuk",
  Kazakhstan: ["Astana", 71.43, 51.13],
  Netherlands: "Amsterdam",
  "South Africa": "Pretoria",
  "South Sudan": "Juba",
  Tanzania: "Dodoma",
};

// Natural Earth's spellings, in English.
const CITY_NAMES = { Bogota: "Bogotá", København: "Copenhagen", "Washington,  D.C.": "Washington, D.C." };

/**
 * Kilometres a capital may sit outside its country as drawn: a port on a smoothed-away coast, or
 * Malabo on Bioko, an island too small for the world map.
 */
const CAPITAL_SLACK_KM = 200;

function vertices(geometry) {
  return polygons(geometry).flat(2);
}

/**
 * Returns a lookup of a country's capital by display name, checked against its lon/lat geometry and
 * projected with `projection`: Natural Earth's capital, unless CAPITALS says otherwise.
 */
export async function capitalFinder(projection) {
  const places = (await fetchJson(PLACES_URL)).features.map((f) => f.properties);
  return (name, lonlat) => {
    const country = PLACE_COUNTRIES[name] ?? name;
    const pick = CAPITALS[name];
    const found = Array.isArray(pick)
      ? [{ name: pick[0], longitude: pick[1], latitude: pick[2] }]
      : places.filter((p) =>
          p.adm0name === country && (pick ? p.name === pick : p.featurecla === "Admin-0 capital" && p.adm0cap === 1),
        );
    if (found.length !== 1) {
      throw new Error(`${name}: expected one capital, found ${found.map((p) => p.name).join(", ") || "none"}`);
    }
    const at = [found[0].longitude, found[0].latitude];
    const km = geoContains(lonlat, at) ? 0 : Math.min(...vertices(lonlat).map((v) => geoDistance(v, at))) * 6371;
    if (km > CAPITAL_SLACK_KM) throw new Error(`${name}: ${found[0].name} is ${Math.round(km)} km outside it`);
    const [x, y] = projection(at);
    return { name: CITY_NAMES[found[0].name] ?? found[0].name, at: [round(x), round(y)] };
  };
}
