// Builds src/maps/south-america.json from Natural Earth 50m (world-atlas): the twelve
// independent countries, in an azimuthal equal-area projection. French Guiana (France) and the
// Falklands are grey context.
import { geoAzimuthalEqualArea } from "d3-geo";
import { merge } from "topojson-client";
import { presimplify, simplify } from "topojson-simplify";
import world from "world-atlas/countries-50m.json" with { type: "json" };
import { capitalFinder, countryIndex, frame, shape, slug, writeMap } from "./lib.mjs";

const MIN_WEIGHT = 1e-7;

const REGIONS = [
  "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador",
  "Guyana", "Paraguay", "Peru", "Suriname", "Uruguay", "Venezuela",
];

// Punta Pariñas, La Guajira, Ponta do Seixas, Cape Horn. Galápagos and Easter Island fall outside.
const FRAME_POINTS = [[-81.4, -4.7], [-71.7, 12.5], [-34.8, -7.2], [-67.3, -55.9]];

const simple = simplify(presimplify(structuredClone(world)), MIN_WEIGHT);
const { geometries, named } = countryIndex(simple);
const projection = geoAzimuthalEqualArea().rotate([60, 22]);
const height = frame(projection, { type: "MultiPoint", coordinates: FRAME_POINTS });
const inPlay = new Set(REGIONS);

const capital = await capitalFinder(projection);

writeMap({
  id: "south-america",
  name: "South America",
  height,
  projection,
  regions: REGIONS.map((name) => {
    const lonlat = merge(simple, named([name]));
    return { id: slug(name), name, geometry: shape(lonlat, projection), capital: capital(name, lonlat) };
  }),
  context: geometries
    .filter((g) => g.properties?.name && !inPlay.has(g.properties.name) && g.properties.name !== "Antarctica")
    .map((g) => shape(merge(simple, [g]), projection)),
});
