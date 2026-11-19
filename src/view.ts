import type { GameMap, Stroke } from "./game.ts";
import { area, bbox, labelPoint, simplify, toPath, type Box, type MultiPolygon, type Pair, type Ring } from "./geometry.ts";

const SVG = "http://www.w3.org/2000/svg";
const MAX_ZOOM = 16;
/** Screen pixels a simplified stroke may stray from the pointer's path. */
const STROKE_TOLERANCE_PX = 1.2;
/** Screen pixels a press may move and still count as a tap that drops a pin, not a pan. */
const TAP_SLOP_PX = 6;
/** A map pin, drawn in screen pixels with its tip at the origin. */
const PIN_PATH = "M0 0C-2-6-9-10-9-17A9 9 0 1 1 9-17C9-10 2-6 0 0Z";

// Mirrors the map rules in style.css, in map units, which an exported image has no other way to know.
const EXPORT_CSS = `
.sea { fill: #d6e6ef }
.frame { fill: none; stroke: #b8c9d3; stroke-width: 1 }
.context { fill: #e3e1dc; stroke: #cfccc4; stroke-width: 0.6 }
.land { fill: #f4efe2; stroke: #a99f88; stroke-width: 0.8 }
.water { fill: #d6e6ef; stroke: #a8c3d3; stroke-width: 0.5 }
.placed { fill-opacity: 0.55; fill-rule: evenodd; stroke-width: 1.2 }
.truth path { fill: none; stroke: #1f2328; stroke-width: 1.4; stroke-dasharray: 5 4 }
.labels text, .pin-label {
  text-anchor: middle; dominant-baseline: middle; font-family: system-ui, sans-serif; font-weight: 700;
  fill: #1f2328; paint-order: stroke; stroke: rgb(255 255 255 / 0.85); stroke-width: 2.5px;
}
.truth-pins line { stroke: #1f2328; stroke-width: 1.2; stroke-dasharray: 4 3 }`;

export interface Labelled {
  name: string;
  shape: MultiPolygon;
  color: string;
  /** Drawn on top with a heavier outline, e.g. the region a replay is at. */
  focus?: boolean;
}

export interface Pin {
  /** Shown on hover. */
  name: string;
  at: Pair;
  color: string;
  focus?: boolean;
  /** The pin not yet submitted: drawn as a full marker. */
  draft?: boolean;
}

/** Where a city really is, linked by a dashed line to the pin that looked for it. */
export interface TruthPin {
  at: Pair;
  from?: Pair;
  /** Written next to the marker; hover text otherwise. */
  name: string;
  label?: boolean;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** A street the player found, drawn in colour. */
export interface FoundStreet {
  id: string;
  /** Shown on hover. */
  name: string;
  d: string;
}

export function colorFor(index: number): string {
  return `hsl(${Math.round((index * 137.508) % 360)} 62% 56%)`;
}

export class MapView {
  readonly svg: SVGSVGElement;
  private readonly map: GameMap;
  private view: { x: number; y: number; w: number; h: number };
  private readonly placedLayer: SVGGElement;
  private readonly labelLayer: SVGGElement;
  private readonly draftPath: SVGPathElement;
  private readonly truthLayer: SVGGElement;
  private readonly truthPinLayer: SVGGElement;
  private readonly pinLayer: SVGGElement;
  private readonly live: SVGPolylineElement;
  private readonly streetLayer: SVGGElement;
  private readonly streetBase: SVGPathElement;
  private readonly streetFound: SVGGElement;
  private readonly streetLatest: SVGPathElement;
  private readonly streetPaths = new Map<string, SVGPathElement>();
  private stroke: { points: Ring; erase: boolean; pointerId: number } | null = null;
  /** `tap` holds where a press began while it may still drop a pin. */
  private pan: { x: number; y: number; pointerId: number; tap: Pair | null } | null = null;
  private spaceHeld = false;
  /** Fingers on the map; two of them pinch and pan instead of drawing. */
  private readonly touches = new Map<number, Pair>();
  private pinch: { distance: number; mid: Pair } | null = null;
  private readonly listeners = new AbortController();
  drawingEnabled = true;
  /** Every stroke erases, for screens without a Shift key. */
  eraseMode = false;
  onStroke: (stroke: Stroke) => void = () => {};
  onPin: (at: Pair) => void = () => {};

  constructor(container: HTMLElement, map: GameMap) {
    this.map = map;
    this.view = { x: 0, y: 0, w: map.width, h: map.height };
    this.svg = el("svg", { class: "map", preserveAspectRatio: "xMidYMid meet" });
    this.svg.append(
      el("rect", { class: "sea", x: -map.width, y: -map.height, width: map.width * 3, height: map.height * 3 }),
      el("path", { class: "context", d: toPath(map.context) }),
      el("path", { class: "land", d: toPath(map.land) }),
      el("path", { class: "water", d: toPath(map.water ?? []) }),
      el("rect", { class: "frame", width: map.width, height: map.height }),
    );
    this.streetBase = el("path", { class: "street-base" });
    this.streetFound = el("g", { class: "street-found" });
    this.streetLatest = el("path", { class: "street-latest" });
    this.streetLayer = el("g", { class: "streets" });
    this.streetLayer.append(this.streetBase, this.streetFound, this.streetLatest);
    this.placedLayer = el("g");
    this.draftPath = el("path", { class: "draft" });
    this.truthLayer = el("g", { class: "truth" });
    this.labelLayer = el("g", { class: "labels" });
    this.truthPinLayer = el("g", { class: "truth-pins" });
    this.pinLayer = el("g", { class: "pins" });
    this.live = el("polyline", { class: "live" });
    this.svg.append(this.streetLayer, this.placedLayer, this.draftPath, this.truthLayer, this.labelLayer, this.truthPinLayer, this.pinLayer, this.live);
    container.append(this.svg);
    this.applyView();
    this.listen();
    // Pins keep their size on screen, which changes with the window as well as the zoom.
    const resize = new ResizeObserver(() => this.applyView());
    resize.observe(this.svg);
    this.listeners.signal.addEventListener("abort", () => resize.disconnect());
  }

  /** Taps drop pins instead of drawing; dragging still pans. */
  set pinEnabled(on: boolean) {
    this.svg.classList.toggle("pinning", on);
  }

  get pinEnabled(): boolean {
    return this.svg.classList.contains("pinning");
  }

  setPins(pins: Pin[]): void {
    this.pinLayer.replaceChildren(
      ...[...pins]
        .sort((a, b) => Number(a.focus || a.draft) - Number(b.focus || b.draft))
        .map((p) => {
          const body = p.draft || p.focus
            ? [el("path", { d: PIN_PATH, fill: p.color, stroke: "#fff", "stroke-width": 1.5 }), el("circle", { cy: -17, r: 3.5, fill: "#fff" })]
            : [el("circle", { r: 4.5, fill: p.color, stroke: "#fff", "stroke-width": 1.5 })];
          return this.marker(p.at, p.name, body);
        }),
    );
  }

  /** Real locations: a ring on the spot, and a dashed line back to the pin. */
  setTruthPins(pins: TruthPin[]): void {
    this.truthPinLayer.replaceChildren(
      ...pins.flatMap((p) => [
        ...(p.from ? [el("line", { x1: p.from[0], y1: p.from[1], x2: p.at[0], y2: p.at[1], "vector-effect": "non-scaling-stroke" })] : []),
        this.marker(p.at, p.name, [
          el("circle", { r: 7, fill: "none", stroke: "#1f2328", "stroke-width": 2 }),
          el("circle", { r: 2, fill: "#1f2328" }),
          ...(p.label ? [this.pinLabel(p.name, 16)] : []),
        ]),
      ]),
    );
  }

  setPlaced(items: Labelled[]): void {
    this.placedLayer.replaceChildren(
      ...items.map((i) =>
        el("path", { class: i.focus ? "placed focus" : "placed", d: toPath(i.shape), fill: i.color, stroke: i.color }),
      ),
    );
    this.labelLayer.replaceChildren(...items.flatMap((i) => this.label(i.name, i.shape)));
  }

  setDraft(shape: MultiPolygon, color: string): void {
    this.draftPath.setAttribute("d", toPath(shape));
    this.draftPath.setAttribute("fill", color);
    this.draftPath.setAttribute("stroke", color);
  }

  /** Real borders, drawn dashed on top of the drawings. */
  setTruth(shapes: MultiPolygon[]): void {
    this.truthLayer.replaceChildren(...shapes.map((s) => el("path", { d: toPath(s) })));
  }

  /** Every street in grey, or none: `all` is one SVG path. */
  setStreetBase(all: string | null): void {
    this.svg.classList.toggle("streets-mode", all !== null);
    this.streetBase.setAttribute("d", all ?? "");
    if (all === null) this.setFoundStreets([], null);
  }

  /** Found streets in colour, `latest` on top. Paths are kept between calls: there can be thousands. */
  setFoundStreets(found: FoundStreet[], latest: FoundStreet | null): void {
    const keep = new Set(found.map((f) => f.id));
    for (const [id, path] of this.streetPaths) {
      if (!keep.has(id)) {
        path.remove();
        this.streetPaths.delete(id);
      }
    }
    for (const f of found) {
      if (this.streetPaths.has(f.id)) continue;
      const path = el("path", { d: f.d });
      const tip = el("title");
      tip.textContent = f.name;
      path.append(tip);
      this.streetFound.append(path);
      this.streetPaths.set(f.id, path);
    }
    this.streetLatest.setAttribute("d", latest?.d ?? "");
  }

  zoomBy(factor: number, at?: Pair): void {
    const [cx, cy] = at ?? [this.view.x + this.view.w / 2, this.view.y + this.view.h / 2];
    const w = Math.min(this.map.width, Math.max(this.map.width / MAX_ZOOM, this.view.w / factor));
    const k = w / this.view.w;
    this.view = { x: cx - (cx - this.view.x) * k, y: cy - (cy - this.view.y) * k, w, h: this.view.h * k };
    this.applyView();
  }

  /** Zooms to show all of `shapes` with some room around them. */
  fit(shapes: MultiPolygon[]): void {
    this.fitBoxes(shapes.filter((s) => s.length).map(bbox));
  }

  /** `room` is the view's size over the boxes': pins need more, as the result card can hide a corner. */
  fitBoxes(boxes: Box[], room = 1.8): void {
    if (boxes.length === 0) return this.resetZoom();
    const [x0, y0, x1, y1] = boxes.reduce((a, b) => [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.max(a[3], b[3]),
    ]);
    const aspect = this.map.width / this.map.height;
    const w = Math.min(this.map.width, Math.max(this.map.width / MAX_ZOOM, (x1 - x0) * room, (y1 - y0) * room * aspect));
    const h = w / aspect;
    this.view = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
    this.applyView();
  }

  /** Removes the map and its window listeners. */
  destroy(): void {
    this.listeners.abort();
    this.svg.remove();
  }

  /**
   * A standalone copy of the whole map as it looks now, for exporting: stand-alone SVG
   * images can't see the page's stylesheet, so it carries its own.
   */
  snapshot(): SVGSVGElement {
    const copy = this.svg.cloneNode(true) as SVGSVGElement;
    copy.querySelectorAll(".draft, .live").forEach((n) => n.remove());
    copy.setAttribute("xmlns", SVG);
    copy.setAttribute("viewBox", `0 0 ${this.map.width} ${this.map.height}`);
    copy.setAttribute("width", String(this.map.width));
    copy.setAttribute("height", String(this.map.height));
    // At the export's scale a map unit is a pixel.
    copy.style.setProperty("--px", "1");
    const style = el("style");
    style.textContent = EXPORT_CSS;
    copy.prepend(style);
    return copy;
  }

  resetZoom(): void {
    this.view = { x: 0, y: 0, w: this.map.width, h: this.map.height };
    this.applyView();
  }

  private label(name: string, shape: MultiPolygon): SVGTextElement[] {
    const at = labelPoint(shape);
    if (!at) return [];
    const size = Math.min(16, Math.max(4, Math.sqrt(area(shape)) / 6));
    const text = el("text", { x: at[0], y: at[1], "font-size": size.toFixed(1) });
    text.textContent = name;
    return [text];
  }

  /** A group at `at` whose contents are sized in screen pixels, whatever the zoom. */
  private marker(at: Pair, title: string, body: SVGElement[]): SVGGElement {
    const scaled = el("g", { class: "pin-body" });
    scaled.append(...body);
    const tip = el("title");
    tip.textContent = title;
    const g = el("g", { transform: `translate(${at[0]} ${at[1]})` });
    g.append(tip, scaled);
    return g;
  }

  private pinLabel(name: string, y: number): SVGTextElement {
    const text = el("text", { class: "pin-label", y, "font-size": 13 });
    text.textContent = name;
    return text;
  }

  private applyView(): void {
    // Keep the frame on screen: at most half a view of slack around the map.
    const { w, h } = this.view;
    this.view.x = Math.min(this.map.width - w / 2, Math.max(-w / 2, this.view.x));
    this.view.y = Math.min(this.map.height - h / 2, Math.max(-h / 2, this.view.y));
    this.svg.setAttribute("viewBox", `${this.view.x} ${this.view.y} ${w} ${h}`);
    this.svg.style.setProperty("--zoom", String(this.map.width / w));
    const { width, height } = this.svg.getBoundingClientRect();
    // preserveAspectRatio "meet" fits the tighter of the two dimensions.
    if (width && height) this.svg.style.setProperty("--px", String(Math.max(w / width, h / height)));
  }

  private toMap(e: { clientX: number; clientY: number }): Pair {
    const ctm = this.svg.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
    return [p.x, p.y];
  }

  /** Map units per screen pixel. */
  private unitsPerPx(): number {
    return 1 / this.svg.getScreenCTM()!.a;
  }

  /** Distance between the two fingers and their midpoint, in screen pixels. */
  private pinchState(): { distance: number; mid: Pair } | null {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return null;
    return { distance: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  }

  private listen(): void {
    const svg = this.svg;
    const { signal } = this.listeners;
    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), this.toMap(e));
      },
      { passive: false },
    );
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code === "Space" && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement)) {
          this.spaceHeld = true;
          svg.classList.add("panning");
          e.preventDefault();
        }
      },
      { signal },
    );
    window.addEventListener(
      "keyup",
      (e) => {
        if (e.code === "Space") {
          this.spaceHeld = false;
          svg.classList.remove("panning");
        }
      },
      { signal },
    );

    svg.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") {
        this.touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (this.touches.size === 2) {
          // A second finger turns the stroke the first one started into a pinch.
          this.stroke = null;
          this.pan = null;
          this.live.removeAttribute("points");
          this.pinch = this.pinchState();
          return;
        }
      }
      if (this.stroke || this.pan || this.pinch) return;
      const wantsPan = e.button === 1 || e.button === 2 || this.spaceHeld || !this.drawingEnabled;
      svg.setPointerCapture(e.pointerId);
      if (wantsPan) {
        const tap = this.pinEnabled && e.button === 0 && !this.spaceHeld ? ([e.clientX, e.clientY] as Pair) : null;
        this.pan = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, tap };
      } else if (e.button === 0) {
        const erase = e.shiftKey || e.altKey || this.eraseMode;
        this.stroke = { points: [this.toMap(e)], erase, pointerId: e.pointerId };
        this.live.classList.toggle("erase", erase);
      }
    });
    svg.addEventListener("pointermove", (e) => {
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pinch && this.touches.has(e.pointerId)) {
        const next = this.pinchState();
        if (!next) return;
        this.zoomBy(next.distance / this.pinch.distance, this.toMap({ clientX: next.mid[0], clientY: next.mid[1] }));
        const k = this.unitsPerPx();
        this.view.x -= (next.mid[0] - this.pinch.mid[0]) * k;
        this.view.y -= (next.mid[1] - this.pinch.mid[1]) * k;
        this.applyView();
        this.pinch = next;
      } else if (this.pan?.pointerId === e.pointerId) {
        const k = this.unitsPerPx();
        this.view.x -= (e.clientX - this.pan.x) * k;
        this.view.y -= (e.clientY - this.pan.y) * k;
        this.pan.x = e.clientX;
        this.pan.y = e.clientY;
        const { tap } = this.pan;
        if (tap && Math.hypot(e.clientX - tap[0], e.clientY - tap[1]) > TAP_SLOP_PX) this.pan.tap = null;
        this.applyView();
      } else if (this.stroke?.pointerId === e.pointerId) {
        const events = e.getCoalescedEvents?.() ?? [e];
        for (const ce of events) this.stroke.points.push(this.toMap(ce));
        this.live.setAttribute("points", this.stroke.points.map((p) => p.join(",")).join(" "));
      }
    });
    const end = (e: PointerEvent) => {
      this.touches.delete(e.pointerId);
      // The pinch ends with the first finger lifted; the other one can't draw until it lifts too.
      if (this.pinch && this.touches.size < 2) this.pinch = null;
      if (this.pan?.pointerId === e.pointerId) {
        // A press that barely moved drops a pin. The map may have panned a few pixels: pin where the finger is now.
        if (this.pan.tap && this.pinEnabled && e.type === "pointerup") this.onPin(this.toMap(e));
        this.pan = null;
      }
      if (this.stroke?.pointerId === e.pointerId) {
        const { points, erase } = this.stroke;
        this.stroke = null;
        this.live.removeAttribute("points");
        const ring = simplify(points, STROKE_TOLERANCE_PX * this.unitsPerPx());
        if (ring.length >= 3 && e.type === "pointerup") this.onStroke({ ring, erase });
      }
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
  }
}
