// Builds src/maps/fr-names.json: the French name of every region and capital of the maps, keyed by
// map id and region id. Countries, capitals and US states come from Natural Earth's own French
// names, France's regions from IGN (the source of france.json), arrondissements from their number.
// OVERRIDES fixes what those sources get wrong. Run it again after a map changes.
import { readFileSync, writeFileSync } from "node:fs";
import { displayName, fetchJson } from "./lib.mjs";

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson";
const COUNTRIES = `${NE}/ne_50m_admin_0_countries.geojson`;
const PLACES = `${NE}/ne_50m_populated_places.geojson`;
const STATES = `${NE}/ne_50m_admin_1_states_provinces.geojson`;
const FRANCE = "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/regions-version-simplifiee.geojson";

// English name in the map -> French name, where the sources are missing or wrong.
const OVERRIDES = {
  // Natural Earth gives the formal "République populaire de Chine".
  China: "Chine",
  // Natural Earth has no Gitega, the capital since 2019; French spells it the same.
  Gitega: "Gitega",
  // Natural Earth has "Noursoultan", the name from 2019 to 2022.
  Astana: "Astana",
  // Natural Earth has "Kiev"; the map uses the Ukrainian spelling, which French also uses.
  Kyiv: "Kyiv",
  // Natural Earth has "État de New York"; on a map of states "New York" is enough, as for Washington.
  "New York": "New York",
  // Natural Earth has the official "Viêt Nam"; everyday French writes "Vietnam".
  Vietnam: "Vietnam",
};

const read = (id) => JSON.parse(readFileSync(new URL(`../src/maps/${id}.json`, import.meta.url), "utf8"));
const props = async (url) => (await fetchJson(url)).features.map((f) => f.properties);
const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

const [countries, places, states, france] = await Promise.all([COUNTRIES, PLACES, STATES, FRANCE].map(props));

const french = (english, found) => {
  const name = OVERRIDES[english] ?? found;
  if (!name) throw new Error(`no French name for ${english}`);
  return name;
};

/** The Natural Earth country drawn as `region`: europe ids are ISO 3166 codes, other maps use names. */
function country(mapId, region) {
  const found = countries.filter((c) =>
    mapId === "europe" ? c.ISO_A2_EH.toLowerCase() === region.id : displayName(c.NAME) === region.name,
  );
  if (found.length !== 1 || displayName(found[0].NAME) !== region.name) {
    throw new Error(`${mapId}/${region.id}: expected one country named ${region.name}, found ${found.map((c) => c.NAME).join(", ") || "none"}`);
  }
  return found[0];
}

/** The French name of the map's capital: the place of that country with the map's English name. */
function capital(c, english) {
  if (english in OVERRIDES) return OVERRIDES[english];
  const inCountry = places.filter(
    (p) => [c.ADM0_A3, c.ISO_A3_EH].includes(p.ADM0_A3) && [p.NAME, p.NAME_EN, p.NAMEASCII].some((n) => n && fold(n) === fold(english)),
  );
  // Natural Earth has a second "Niamey" (an Admin-1 capital, French name "Maradi"): the national capital wins.
  const found = inCountry.length > 1 ? inCountry.filter((p) => p.FEATURECLA.startsWith("Admin-0 capital")) : inCountry;
  if (found.length !== 1) throw new Error(`${c.NAME}: expected one place named ${english}, found ${found.length}`);
  return french(english, found[0].NAME_FR);
}

function countryMap(mapId) {
  return Object.fromEntries(
    read(mapId).regions.map((r) => {
      const c = country(mapId, r);
      return [r.id, { name: french(r.name, c.NAME_FR), ...(r.capital ? { capital: capital(c, r.capital.name) } : {}) }];
    }),
  );
}

function usMap() {
  return Object.fromEntries(
    read("us").regions.map((r) => {
      const found = states.filter((s) => s.fips === `US${r.id}`);
      if (found.length !== 1 || found[0].name !== r.name) throw new Error(`us/${r.id}: expected ${r.name}, found ${found.map((s) => s.name)}`);
      return [r.id, { name: french(r.name, found[0].name_fr) }];
    }),
  );
}

function franceMap() {
  const byCode = new Map(france.map((f) => [f.code, f.nom]));
  return Object.fromEntries(read("france").regions.map((r) => [r.id, { name: french(r.name, byCode.get(r.id)) }]));
}

function parisMap() {
  return Object.fromEntries(
    read("paris").regions.map((r) => {
      const n = Number(r.id);
      const short = n === 1 ? "1er" : `${n}e`;
      if (r.short && r.short !== short) throw new Error(`paris/${r.id}: short is ${r.short}, expected ${short}`);
      return [r.id, { name: `${short} arrondissement` }];
    }),
  );
}

const names = {
  world: countryMap("world"),
  europe: countryMap("europe"),
  africa: countryMap("africa"),
  "south-america": countryMap("south-america"),
  us: usMap(),
  france: franceMap(),
  paris: parisMap(),
};

// One line per map keeps diffs readable.
const json = `{\n${Object.entries(names).map(([id, regions]) => `${JSON.stringify(id)}:${JSON.stringify(regions)}`).join(",\n")}\n}\n`;
writeFileSync(new URL("../src/maps/fr-names.json", import.meta.url), json);
for (const [id, regions] of Object.entries(names)) console.log(`fr-names.json: ${id}, ${Object.keys(regions).length} regions`);
