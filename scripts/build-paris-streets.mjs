// Builds src/maps/paris-streets.json: every named voie of Paris as a projected footprint.
// Source: the official street register of the Ville de Paris (opendata.paris.fr).
import { writeFileSync } from "node:fs";
import polygonClipping from "polygon-clipping";
import { fetchJson, polygons, ringArea } from "./lib.mjs";
import { arrondissements } from "./paris.mjs";

const SOURCE = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/denominations-emprises-voies-actuelles/exports/geojson";
const OUT = "src/maps/paris-streets.json";
const TOLERANCE = 0.08; // map units (about 1.5 m)
const ORIGIN_MAX = 160;

const { projection, height } = await arrondissements();
const { features } = await fetchJson(SOURCE);
const kmPerUnit = 6371 / projection.scale(); // as in writeMap

// Voies such as "voie A/1" or "passage J/13" have a code, not a name: draw them, never ask for them.
const coded = (p) => !p.nomvoie || p.nomvoie.includes("/");

const voies = [];
const checks = [];
const unnamed = [];
for (const { properties: p, geometry } of features) {
  if (!geometry) continue;
  const polys = project(geometry).map((poly) => poly.map(simplify).filter((r) => r.length >= 4));
  // Rounding can flatten a passage under 2 m wide: keep it unrounded, as it can still be named.
  let kept = polys.filter((poly) => poly.length > 0);
  if (kept.length === 0) kept = projected(geometry);
  // The register has a few empty duplicates, such as a second boulevard Périphérique with no area.
  const exact = polygonClipping.union(projected(geometry));
  const area = exact.reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0), 0);
  if (area * (kmPerUnit * 1000) ** 2 < 1) continue;
  const d = kept.map(path).join("");
  if (coded(p)) { unnamed.push(d); continue; }
  const estimate = exact.reduce((sum, poly) => sum + footprintLength(poly), 0) * kmPerUnit * 1000;
  if (p.longueur) checks.push(estimate / p.longueur);
  const xs = kept.flat(2).map(([x]) => x);
  const ys = kept.flat(2).map(([, y]) => y);
  voies.push({
    n: p.typo_min,
    k: p.nomvoie,
    a: (p.arrdt ?? []).map((s) => parseInt(s, 10)).filter(Number.isFinite),
    m2: Math.round(area * (kmPerUnit * 1000) ** 2),
    // In metres. The register gives it for most voies; the rest are measured on the footprint.
    l: Math.round(p.longueur || estimate),
    b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v)),
    ...(p.orig ? { o: origin(p.orig) } : {}),
    d,
  });
}
voies.sort((a, b) => a.n.localeCompare(b.n, "fr"));

// Street types ("rue", "quai"…), so that players can type them or not.
const types = [...new Set(features.map((f) => f.properties.typvoie).filter(Boolean))].sort();
const json = JSON.stringify({ width: 1000, height, kmPerUnit, types, voies, unnamed: unnamed.join("") });
writeFileSync(OUT, json);
const m2 = voies.reduce((s, v) => s + v.m2, 0);
checks.sort((a, b) => a - b);
const q = (f) => checks[Math.floor(f * (checks.length - 1))].toFixed(2);
console.log(`footprint length / register length on ${checks.length} voies: p25 ${q(0.25)}, median ${q(0.5)}, p75 ${q(0.75)}`);
const km = voies.reduce((s, v) => s + v.l, 0) / 1000;
console.log(`${OUT}: ${Math.round(km)} km, ${voies.length} voies, ${new Set(voies.map((v) => v.k)).size} names, ${unnamed.length} coded, ${(m2 / 1e6).toFixed(1)} km², ${Math.round(json.length / 1024)} KB`);

// Streets are small enough to project point by point: d3's spherical clipping collapses some of them.
function projected(geometry) {
  return polygons(geometry).map((poly) => poly.map((ring) => ring.map((p) => projection(p))));
}

function project(geometry) {
  const round = (v) => Math.round(v * 10) / 10;
  return polygonClipping.union(projected(geometry).map((poly) => poly.map((ring) => ring.map((p) => p.map(round)))));
}

/** Length of a long, thin polygon: the long side of the rectangle with the same area and perimeter. */
function footprintLength([outer, ...holes]) {
  const area = ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0);
  const perimeter = outer.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - outer[i][0], p[1] - outer[i][1]), 0);
  return (perimeter + Math.sqrt(Math.max(0, perimeter ** 2 - 16 * area))) / 4;
}

function origin(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= ORIGIN_MAX) return flat;
  const cut = flat.slice(0, ORIGIN_MAX);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

// Douglas-Peucker on a closed ring (first point repeated at the end).
function simplify(ring) {
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let max = 0, at = -1;
    for (let k = i + 1; k < j; k++) {
      const dist = segmentDistance(ring[k], ring[i], ring[j]);
      if (dist > max) { max = dist; at = k; }
    }
    if (max > TOLERANCE) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return ring.filter((_, i) => keep[i]);
}

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Compact SVG path: absolute move, then relative lines in tenths of a unit.
function path(poly) {
  return poly.map((ring) => {
    const pts = ring.slice(0, -1).map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]);
    let out = `M${num(pts[0][0])} ${num(pts[0][1])}l`;
    for (let i = 1; i < pts.length; i++) {
      const dx = num(pts[i][0] - pts[i - 1][0]), dy = num(pts[i][1] - pts[i - 1][1]);
      out += (i > 1 && !dx.startsWith("-") ? " " : "") + dx + (dy.startsWith("-") ? "" : " ") + dy;
    }
    return out + "z";
  }).join("");
}

function num(tenths) {
  const s = (tenths / 10).toString();
  return s.replace(/^(-?)0\./, "$1.");
}
