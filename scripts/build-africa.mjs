// Builds src/maps/africa.json from Natural Earth 50m (world-atlas): mainland Africa and
// Madagascar in an azimuthal equal-area projection. Island nations too small to draw, and
// Western Sahara, whose status is disputed, are grey context.
import { geoAzimuthalEqualArea } from "d3-geo";
import { merge } from "topojson-client";
import { presimplify, simplify } from "topojson-simplify";
import world from "world-atlas/countries-50m.json" with { type: "json" };
import { countryIndex, displayName, frame, shape, slug, split, within, writeMap } from "./lib.mjs";

const MIN_WEIGHT = 2e-7;

// Natural Earth names; Somaliland is drawn as part of Somalia.
const REGIONS = [
  ["Algeria"], ["Angola"], ["Benin"], ["Botswana"], ["Burkina Faso"], ["Burundi"], ["Cameroon"],
  ["Central African Rep."], ["Chad"], ["Congo"], ["Dem. Rep. Congo"], ["Côte d'Ivoire"], ["Djibouti"],
  ["Egypt"], ["Eq. Guinea"], ["Eritrea"], ["eSwatini"], ["Ethiopia"], ["Gabon"], ["Gambia"], ["Ghana"],
  ["Guinea"], ["Guinea-Bissau"], ["Kenya"], ["Lesotho"], ["Liberia"], ["Libya"], ["Madagascar"],
  ["Malawi"], ["Mali"], ["Mauritania"], ["Morocco"], ["Mozambique"], ["Namibia"], ["Niger"],
  ["Nigeria"], ["Rwanda"], ["Senegal"], ["Sierra Leone"], ["Somalia", "Somaliland"], ["South Africa"],
  ["S. Sudan"], ["Sudan"], ["Tanzania"], ["Togo"], ["Tunisia"], ["Uganda"], ["Zambia"], ["Zimbabwe"],
];

// Cap-Vert, Cap Blanc, Gibraltar, Cap Bon, Sinai, the Horn, Madagascar, Cape Agulhas.
const FRAME_POINTS = [[-17.6, 14.7], [-17.1, 21], [-6, 35.9], [11, 37.3], [34.9, 31.3], [51.4, 11.8], [50.5, -15.5], [20, -34.9]];

const simple = simplify(presimplify(structuredClone(world)), MIN_WEIGHT);
const { geometries, named } = countryIndex(simple);
const projection = geoAzimuthalEqualArea().rotate([-17, -3]);
const height = frame(projection, { type: "MultiPoint", coordinates: FRAME_POINTS });

// South Africa's Prince Edward Islands sit halfway to Antarctica.
const mainland = (lonlat) => split(lonlat, within([-30, -40, 60, 40]))[0];
const inPlay = new Set(REGIONS.flat());

writeMap({
  id: "africa",
  name: "Africa",
  height,
  projection,
  regions: REGIONS.map((names) => {
    const name = displayName(names[0]);
    return { id: slug(name), name, geometry: shape(mainland(merge(simple, named(names))), projection) };
  }).sort((a, b) => a.name.localeCompare(b.name)),
  context: geometries
    .filter((g) => g.properties?.name && !inPlay.has(g.properties.name))
    .map((g) => shape(merge(simple, [g]), projection)),
});
