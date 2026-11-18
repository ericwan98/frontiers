// Builds src/maps/us.json from us-atlas (Census Bureau cartographic boundaries, 1:10m): the 48
// contiguous states in the Albers equal-area projection, Canada and Mexico from Natural Earth 50m
// for context.
import { geoAlbers } from "d3-geo";
import { feature, merge } from "topojson-client";
import { presimplify, simplify } from "topojson-simplify";
import us from "us-atlas/states-10m.json" with { type: "json" };
import world from "world-atlas/countries-50m.json" with { type: "json" };
import { frame, shape, writeMap } from "./lib.mjs";

const MIN_WEIGHT = 2e-7;
// FIPS codes: DC is drawn for context; Alaska, Hawaii, Puerto Rico and the island areas are left out.
const CONTEXT = new Set(["11"]);
const OUT = new Set(["02", "15", "60", "66", "69", "72", "78"]);

const simple = simplify(presimplify(structuredClone(us)), MIN_WEIGHT);
const geoms = simple.objects.states.geometries;
const states = geoms.filter((g) => !CONTEXT.has(g.id) && !OUT.has(g.id));
if (states.length !== 48) throw new Error(`expected 48 states, found ${states.length}`);

const projection = geoAlbers();
const height = frame(projection, feature(simple, { type: "GeometryCollection", geometries: states }));

// Not simplified: simplifying drops the 49th parallel's vertices, and the border then bows
// away from the states along a great circle.
const neighbours = world;
const NEIGHBOURS = new Set(["Canada", "Mexico", "Bahamas", "Cuba"]);

writeMap({
  id: "us",
  name: "United States",
  height,
  projection,
  regions: states
    .map((g) => ({ id: g.id, name: g.properties.name, geometry: shape(merge(simple, [g]), projection) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  context: [
    ...geoms.filter((g) => CONTEXT.has(g.id)).map((g) => shape(merge(simple, [g]), projection)),
    ...neighbours.objects.countries.geometries
      .filter((g) => NEIGHBOURS.has(g.properties?.name))
      .map((g) => shape(merge(neighbours, [g]), projection)),
  ],
});
