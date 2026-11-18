// Builds src/maps/europe.json from Natural Earth 50m (world-atlas): countries in play,
// projected to an equal-area plane so areas compare fairly, clipped to the map frame.
import { geoAzimuthalEqualArea } from "d3-geo";
import { merge } from "topojson-client";
import { presimplify, simplify } from "topojson-simplify";
import world from "world-atlas/countries-50m.json" with { type: "json" };
import { countryIndex, frame, moveCrimea, shape as project, writeMap } from "./lib.mjs";

// Square degrees (topojson-simplify's planar default): drops only the tiniest wiggles of the 50m data.
const MIN_WEIGHT = 2e-7;

// region id -> [display name, Natural Earth names merged into it]
const REGIONS = {
  al: ["Albania", ["Albania"]],
  at: ["Austria", ["Austria"]],
  by: ["Belarus", ["Belarus"]],
  be: ["Belgium", ["Belgium"]],
  ba: ["Bosnia and Herzegovina", ["Bosnia and Herz."]],
  bg: ["Bulgaria", ["Bulgaria"]],
  hr: ["Croatia", ["Croatia"]],
  cy: ["Cyprus", ["Cyprus", "N. Cyprus"]],
  cz: ["Czechia", ["Czechia"]],
  dk: ["Denmark", ["Denmark"]],
  ee: ["Estonia", ["Estonia"]],
  fi: ["Finland", ["Finland", "Åland"]],
  fr: ["France", ["France"]],
  de: ["Germany", ["Germany"]],
  gr: ["Greece", ["Greece"]],
  hu: ["Hungary", ["Hungary"]],
  is: ["Iceland", ["Iceland"]],
  ie: ["Ireland", ["Ireland"]],
  it: ["Italy", ["Italy"]],
  xk: ["Kosovo", ["Kosovo"]],
  lv: ["Latvia", ["Latvia"]],
  lt: ["Lithuania", ["Lithuania"]],
  lu: ["Luxembourg", ["Luxembourg"]],
  mk: ["North Macedonia", ["Macedonia"]],
  md: ["Moldova", ["Moldova"]],
  me: ["Montenegro", ["Montenegro"]],
  nl: ["Netherlands", ["Netherlands"]],
  no: ["Norway", ["Norway"]],
  pl: ["Poland", ["Poland"]],
  pt: ["Portugal", ["Portugal"]],
  ro: ["Romania", ["Romania"]],
  ru: ["Russia", ["Russia"]],
  rs: ["Serbia", ["Serbia"]],
  sk: ["Slovakia", ["Slovakia"]],
  si: ["Slovenia", ["Slovenia"]],
  es: ["Spain", ["Spain"]],
  se: ["Sweden", ["Sweden"]],
  ch: ["Switzerland", ["Switzerland"]],
  tr: ["Turkey", ["Turkey"]],
  ua: ["Ukraine", ["Ukraine"]],
  gb: ["United Kingdom", ["United Kingdom", "Isle of Man", "Jersey", "Guernsey"]],
};

// Points the frame must show: Iceland, Portugal, Cyprus, eastern Turkey, North Cape, the Volga.
const FRAME_POINTS = [[-24.5, 66.5], [-9.5, 36.9], [34.6, 34.6], [44.8, 39.5], [28, 71.2], [50, 56]];

const simple = simplify(presimplify(structuredClone(world)), MIN_WEIGHT);
const { geometries: geoms, named } = countryIndex(simple);

const projection = geoAzimuthalEqualArea().rotate([-15, -52]);
const height = frame(projection, { type: "MultiPoint", coordinates: FRAME_POINTS }, { padX: 0 });
const shape = (geometry) => project(geometry, projection);

const LONLAT = Object.fromEntries(Object.entries(REGIONS).map(([id, [, names]]) => [id, merge(simple, named(names))]));
[LONLAT.ru, LONLAT.ua] = moveCrimea(LONLAT.ru, LONLAT.ua);

// Every other country that reaches the frame is drawn grey for context and is not in play.
const inPlay = new Set(Object.values(REGIONS).flatMap(([, names]) => names));
const context = geoms.filter((g) => g.properties?.name && !inPlay.has(g.properties.name)).map((g) => shape(merge(simple, [g])));

writeMap({
  id: "europe",
  name: "Europe",
  height,
  projection,
  regions: Object.entries(REGIONS).map(([id, [name]]) => ({ id, name, geometry: shape(LONLAT[id]) })),
  context,
});
