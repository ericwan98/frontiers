import type { GameMap, Stroke } from "./game.ts";
import { area, bbox, labelPoint, simplify, toPath, type MultiPolygon, type Pair, type Ring } from "./geometry.ts";

const SVG = "http://www.w3.org/2000/svg";
const MAX_ZOOM = 16;
/** Screen pixels a simplified stroke may stray from the pointer's path. */
const STROKE_TOLERANCE_PX = 1.2;

// Mirrors the map rules in style.css, in map units, which an exported image has no other way to know.
const EXPORT_CSS = `
.sea { fill: #d6e6ef }
.frame { fill: none; stroke: #b8c9d3; stroke-width: 1 }
.context { fill: #e3e1dc; stroke: #cfccc4; stroke-width: 0.6 }
.land { fill: #f4efe2; stroke: #a99f88; stroke-width: 0.8 }
.water { fill: #d6e6ef; stroke: #a8c3d3; stroke-width: 0.5 }
.placed { fill-opacity: 0.55; fill-rule: evenodd; stroke-width: 1.2 }
.truth path { fill: none; stroke: #1f2328; stroke-width: 1.4; stroke-dasharray: 5 4 }
.labels text {
  text-anchor: middle; dominant-baseline: middle; font-family: system-ui, sans-serif; font-weight: 700;
  fill: #1f2328; paint-order: stroke; stroke: rgb(255 255 255 / 0.85); stroke-width: 2.5px;
}`;

export interface Labelled {
  name: string;
  shape: MultiPolygon;
  color: string;
  /** Drawn on top with a heavier outline, e.g. the region a replay is at. */
  focus?: boolean;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
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
  private readonly live: SVGPolylineElement;
  private stroke: { points: Ring; erase: boolean; pointerId: number } | null = null;
  private pan: { x: number; y: number; pointerId: number } | null = null;
  private spaceHeld = false;
  /** Fingers on the map; two of them pinch and pan instead of drawing. */
  private readonly touches = new Map<number, Pair>();
  private pinch: { distance: number; mid: Pair } | null = null;
  private readonly listeners = new AbortController();
  drawingEnabled = true;
  /** Every stroke erases, for screens without a Shift key. */
  eraseMode = false;
  onStroke: (stroke: Stroke) => void = () => {};

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
    this.placedLayer = el("g");
    this.draftPath = el("path", { class: "draft" });
    this.truthLayer = el("g", { class: "truth" });
    this.labelLayer = el("g", { class: "labels" });
    this.live = el("polyline", { class: "live" });
    this.svg.append(this.placedLayer, this.draftPath, this.truthLayer, this.labelLayer, this.live);
    container.append(this.svg);
    this.applyView();
    this.listen();
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

  zoomBy(factor: number, at?: Pair): void {
    const [cx, cy] = at ?? [this.view.x + this.view.w / 2, this.view.y + this.view.h / 2];
    const w = Math.min(this.map.width, Math.max(this.map.width / MAX_ZOOM, this.view.w / factor));
    const k = w / this.view.w;
    this.view = { x: cx - (cx - this.view.x) * k, y: cy - (cy - this.view.y) * k, w, h: this.view.h * k };
    this.applyView();
  }

  /** Zooms to show all of `shapes` with some room around them. */
  fit(shapes: MultiPolygon[]): void {
    const boxes = shapes.filter((s) => s.length).map(bbox);
    if (boxes.length === 0) return this.resetZoom();
    const [x0, y0, x1, y1] = boxes.reduce((a, b) => [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.max(a[3], b[3]),
    ]);
    const aspect = this.map.width / this.map.height;
    const w = Math.min(this.map.width, Math.max(this.map.width / MAX_ZOOM, (x1 - x0) * 1.8, (y1 - y0) * 1.8 * aspect));
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

  private applyView(): void {
    // Keep the frame on screen: at most half a view of slack around the map.
    const { w, h } = this.view;
    this.view.x = Math.min(this.map.width - w / 2, Math.max(-w / 2, this.view.x));
    this.view.y = Math.min(this.map.height - h / 2, Math.max(-h / 2, this.view.y));
    this.svg.setAttribute("viewBox", `${this.view.x} ${this.view.y} ${w} ${h}`);
    this.svg.style.setProperty("--zoom", String(this.map.width / w));
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
        this.pan = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
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
      if (this.pan?.pointerId === e.pointerId) this.pan = null;
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
