// Builds src/maps/world.json from Natural Earth 110m (world-atlas), the scale made for world maps: every country of at least
// 9,000 km² (so Cyprus is in), on Equal Earth, an equal-area world projection. Antarctica is
// left out; smaller countries, disputed and overseas territories are grey context.
import { geoArea, geoEqualEarth } from "d3-geo";
import { merge } from "topojson-client";
import world from "world-atlas/countries-110m.json" with { type: "json" };
import { capitalFinder, countryIndex, displayName, frame, moveCrimea, ringArea, shape as project, slug, split, within, writeMap } from "./lib.mjs";

// Square units (about 1,100 km²): islands smaller than this can't be drawn at this scale anyway.
const MIN_ISLAND = 1;
const MIN_KM2 = 9_000;
const EARTH_RADIUS_KM = 6371;

// Natural Earth features drawn as part of a bigger country.
const PART_OF = { Somaliland: "Somalia", "N. Cyprus": "Cyprus" };
// Big enough to play, but not countries.
const TERRITORIES = new Set([
  "Antarctica", "Falkland Is.", "Fr. S. Antarctic Lands", "New Caledonia", "Puerto Rico", "W. Sahara",
]);
// Overseas parts players won't draw: French Guiana, the Antilles, Réunion and Mayotte are context.
const HOMELAND = { France: within([-6, 41, 10, 52]) };

const simple = world;
const { geometries, named } = countryIndex(simple);

const members = new Map();
for (const g of geometries) {
  const name = g.properties?.name;
  if (!name || TERRITORIES.has(name)) continue;
  const owner = PART_OF[name] ?? name;
  members.set(owner, [...(members.get(owner) ?? []), name]);
}
const lonlat = new Map([...members].map(([name, parts]) => [name, merge(simple, named(parts))]));
const [russia, ukraine] = moveCrimea(lonlat.get("Russia"), lonlat.get("Ukraine"));
lonlat.set("Russia", russia).set("Ukraine", ukraine);
const overseas = [];
for (const [name, test] of Object.entries(HOMELAND)) {
  const [home, away] = split(lonlat.get(name), test);
  lonlat.set(name, home);
  overseas.push(away);
}

const km2 = (geometry) => geoArea(geometry) * EARTH_RADIUS_KM ** 2;
const playable = [...lonlat].filter(([, geometry]) => km2(geometry) >= MIN_KM2);
const inPlay = new Set(playable.map(([name]) => name));

// Centred on 11.5°E, the edge runs through the Bering Strait, between Chukotka and Alaska.
const projection = geoEqualEarth().rotate([-11.5, 0]);
const shape = (geometry) => project(geometry, projection).filter(([outer]) => ringArea(outer) >= MIN_ISLAND);
const height = frame(projection, {
  type: "GeometryCollection",
  geometries: playable.map(([, geometry]) => geometry),
});

const capital = await capitalFinder(projection);

writeMap({
  id: "world",
  name: "World",
  height,
  projection,
  regions: playable
    .map(([ne, geometry]) => {
      const name = displayName(ne);
      return { id: slug(name), name, geometry: shape(geometry), capital: capital(name, geometry) };
    })
    .sort((a, b) => a.name.localeCompare(b.name)),
  context: [
    ...[...lonlat].filter(([name]) => !inPlay.has(name)).map(([, geometry]) => shape(geometry)),
    ...geometries
      .filter((g) => TERRITORIES.has(g.properties?.name) && g.properties.name !== "Antarctica")
      .map((g) => shape(merge(simple, [g]))),
    ...overseas.map((g) => shape(g)),
  ],
});
