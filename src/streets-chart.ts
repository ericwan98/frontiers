// The replay's chart: how far each found street is from the one found before it. Finds from a known
// neighbourhood sit low; names typed at random sit near the "at random" line.
import { formatKm } from "./awards.ts";
import { h } from "./dom.ts";
import { num, tr } from "./i18n.ts";

const SVG = "http://www.w3.org/2000/svg";
const [W, H] = [360, 130];
const PAD = { left: 34, right: 8, top: 8, bottom: 18 };
/** Tick steps to pick from, in metres: the first that gives at most 5 ticks above 0. */
const STEPS_M = [500, 1000, 2000, 5000];

export interface Gap {
  /** Metres from the street found before. */
  metres: number;
  name: string;
  previous: string;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : 0;
};

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** The chart for `gaps`, the i-th between find i and find i + 1; `reveal(n)` shows the first n during a replay. */
export class GapChart {
  readonly element: HTMLElement;
  private readonly clip: SVGRectElement;
  private readonly x: (i: number) => number;
  private readonly readout: HTMLElement;
  /** Shown once the replay has shown every find: it sums up the whole run. */
  private readonly summary: HTMLElement;
  private shown: number;

  constructor(private readonly gaps: Gap[], random: number) {
    const n = gaps.length;
    // A linear scale from 0, up to the first tick above the farthest gap.
    const far = Math.max(random, ...gaps.map((g) => g.metres));
    const step = STEPS_M.find((s) => far / s <= 5) ?? STEPS_M.at(-1)!;
    const top = Math.max(step, Math.ceil(far / step) * step);
    this.x = (i) => PAD.left + (n > 1 ? (i / (n - 1)) * (W - PAD.left - PAD.right) : 0);
    const y = (m: number) => {
      return H - PAD.bottom - (m / top) * (H - PAD.top - PAD.bottom);
    };
    const chart = svg("svg", { class: "gap-chart", viewBox: `0 0 ${W} ${H}`, role: "img" });
    chart.setAttribute("aria-label", tr("Distance of each find from the one before", "Distance de chaque trouvaille à la précédente"));
    const clipPath = svg("clipPath", { id: "gap-reveal" });
    this.clip = svg("rect", { x: 0, y: 0, width: W, height: H });
    clipPath.append(this.clip);
    chart.append(clipPath);
    for (let m = 0; m <= top; m += step) {
      chart.append(svg("line", { class: "grid", x1: PAD.left, x2: W - PAD.right, y1: y(m), y2: y(m) }));
      const label = svg("text", { class: "tick", x: PAD.left - 4, y: y(m) + 3, "text-anchor": "end" });
      label.textContent = m === 0 ? "0" : m < 1000 ? `${m} m` : `${num(m / 1000, m % 1000 ? 1 : 0)} km`;
      chart.append(label);
    }
    const axis = svg("text", { class: "tick", x: W - PAD.right, y: H - 4, "text-anchor": "end" });
    axis.textContent = tr(`finds in order, 1 to ${num(n + 1)}`, `trouvailles dans l'ordre, de 1 à ${num(n + 1)}`);
    chart.append(axis);
    // Random pairs of your own finds: where the points sit when the order says nothing.
    chart.append(svg("line", { class: "random", x1: PAD.left, x2: W - PAD.right, y1: y(random), y2: y(random) }));
    const randomLabel = svg("text", { class: "random-label", x: PAD.left + 3, y: y(random) - 3 });
    randomLabel.textContent = `${tr("at random", "au hasard")} ${formatKm(random / 1000)}`;
    chart.append(randomLabel);
    const data = svg("g", { "clip-path": "url(#gap-reveal)" });
    data.append(svg("path", { class: "dots", d: gaps.map((g, i) => `M${this.x(i).toFixed(1)} ${y(g.metres).toFixed(1)}h0`).join("") }));
    // Median of the last `window` gaps, so the line only uses finds the replay has shown.
    const window = Math.max(5, Math.min(75, Math.round(n / 12)));
    const trend = gaps.map((_, i) => median(gaps.slice(Math.max(0, i - window + 1), i + 1).map((g) => g.metres)));
    data.append(svg("path", { class: "trend", d: trend.map((m, i) => `${i ? "L" : "M"}${this.x(i).toFixed(1)} ${y(m).toFixed(1)}`).join("") }));
    const cursor = svg("line", { class: "cursor", y1: PAD.top, y2: H - PAD.bottom, visibility: "hidden" });
    chart.append(data, cursor);

    const quarter = Math.max(1, Math.floor(n / 4));
    const summary = h(
      "p",
      { class: "gap-summary" },
      tr("Median distance to the find before: ", "Distance médiane à la trouvaille d'avant : "),
      tr("first quarter ", "premier quart "),
      h("strong", {}, formatKm(median(gaps.slice(0, quarter).map((g) => g.metres)) / 1000)),
      tr(" · last quarter ", " · dernier quart "),
      h("strong", {}, formatKm(median(gaps.slice(-quarter).map((g) => g.metres)) / 1000)),
      tr(" · at random ", " · au hasard "),
      h("strong", {}, formatKm(random / 1000)),
      tr(`. Line: median of the last ${window}.`, `. Ligne : médiane des ${window} dernières.`),
    );
    this.readout = h("p", { class: "gap-readout muted" }, " ");
    chart.addEventListener("pointermove", (e) => {
      const box = chart.getBoundingClientRect();
      const at = ((e.clientX - box.left) / box.width) * W;
      const i = Math.round(((at - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
      if (i < 0 || i >= this.shown) return this.hover(null, cursor);
      this.hover(i, cursor);
    });
    chart.addEventListener("pointerleave", () => this.hover(null, cursor));
    this.summary = summary;
    this.element = h("div", { class: "gap-chart-box" }, chart, this.readout, summary);
    this.shown = n;
  }

  /** Shows the first `count` gaps; the rest stays hidden until the replay gets there. */
  reveal(count: number): void {
    this.shown = Math.min(count, this.gaps.length);
    const edge = this.shown >= this.gaps.length ? W : this.x(Math.max(0, this.shown - 1)) + 1;
    this.clip.setAttribute("width", String(edge));
    this.summary.hidden = this.shown < this.gaps.length;
  }

  private hover(i: number | null, cursor: SVGLineElement): void {
    cursor.setAttribute("visibility", i === null ? "hidden" : "visible");
    if (i === null) return void this.readout.replaceChildren(" ");
    const g = this.gaps[i];
    cursor.setAttribute("x1", String(this.x(i)));
    cursor.setAttribute("x2", String(this.x(i)));
    this.readout.replaceChildren(`${num(i + 2)}. ${g.name}${tr(": ", " : ")}`, h("strong", {}, formatKm(g.metres / 1000)), ` ${tr("from", "de")} ${g.previous}`);
  }
}
