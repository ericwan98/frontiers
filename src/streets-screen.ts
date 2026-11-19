import { formatKm } from "./awards.ts";
import { button, h } from "./dom.ts";
import type { GameMap } from "./game.ts";
import type { StreetGroup, Streets } from "./streets.ts";
import type { FoundStreet, MapView } from "./view.ts";

const RECENT = 8;

const foundKey = (mapId: string) => `frontiers:${mapId}-streets:found`;

/** Names found so far on a map, oldest first, as saved in this browser. */
export function loadFound(mapId: string): string[] {
  try {
    const names = JSON.parse(localStorage.getItem(foundKey(mapId)) ?? "[]");
    return Array.isArray(names) ? names.filter((n) => typeof n === "string") : [];
  } catch {
    return [];
  }
}

export function forgetFound(mapId: string): void {
  localStorage.removeItem(foundKey(mapId));
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const percent = (share: number) => (share > 0 && share < 0.0001 ? "<0.01%" : `${(share * 100).toFixed(share < 0.1 ? 2 : 1)}%`);
const count = (n: number) => n.toLocaleString("en");

function voieList(g: StreetGroup): string {
  const names = g.voies.map((v) => v.n);
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

const longestOrigin = (g: StreetGroup) => g.voies.reduce((best, v) => ((v.o ?? "").length > best.length ? v.o! : best), "");

/** The free-play screen: name streets, watch them light up. Progress is saved after every find. */
export class StreetsScreen {
  private readonly panel: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly message: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly recent: HTMLElement;
  private readonly byArrondissement: HTMLElement;
  private readonly found: StreetGroup[];
  private latest: StreetGroup | null = null;

  constructor(
    private readonly streets: Streets,
    private readonly map: GameMap,
    private readonly view: MapView,
    stage: HTMLElement,
    onBack: () => void,
  ) {
    const groups = loadFound(map.id).map((name) => streets.groupOf(name));
    this.found = [...new Set(groups.filter((g) => g !== undefined))];

    this.input = h("input", {
      type: "text",
      placeholder: "Name a street, e.g. Rivoli",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "go",
      "aria-label": "Street name",
    }) as HTMLInputElement;
    const form = h("form", { class: "street-form" }, this.input, h("button", { type: "submit", class: "primary" }, "Find"));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.answer(this.input.value);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.input.value = "";
    });
    this.message = h("p", { class: "street-message", role: "status" });
    this.stats = h("p", { class: "street-stats" });
    this.bar = h("span");
    this.recent = h("ul", { class: "street-recent" });
    this.byArrondissement = h("div", { class: "street-arrondissements" });
    this.panel = h(
      "aside",
      { class: "streets-panel" },
      h("div", { class: "street-top" }, button(`← ${map.name}`, onBack, "link"), h("strong", {}, `${map.name} streets`)),
      form,
      this.message,
      this.stats,
      h("div", { class: "street-bar" }, this.bar),
      h("details", {}, h("summary", {}, "Latest finds"), this.recent),
      h("details", {}, h("summary", {}, "By arrondissement"), this.byArrondissement),
    );
    stage.append(this.panel);

    // Arrondissement borders and names help find your way; the game is about the streets.
    view.setTruth(map.regions.map((r) => r.geometry));
    view.setPlaced(map.regions.map((r) => ({ name: r.short ?? r.name, shape: r.geometry, color: "none" })));
    view.setStreetBase(streets.data.unnamed + streets.data.voies.map((v) => v.d).join(""));
    this.update();
    if (matchMedia("(pointer: fine)").matches) this.input.focus();
  }

  destroy(): void {
    this.panel.remove();
    this.view.setStreetBase(null);
    this.view.setTruth([]);
    this.view.setPlaced([]);
  }

  private answer(text: string): void {
    const answer = this.streets.match(text);
    if (answer.kind === "unknown") return this.say(text.trim() ? `No street of ${this.map.name} is called “${text.trim()}”.` : "");
    if (answer.kind === "ambiguous") {
      return this.say(`Several names are one letter away from “${text.trim()}”: check the spelling.`);
    }
    const fresh = answer.groups.filter((g) => !this.found.includes(g));
    this.input.value = "";
    if (fresh.length === 0) {
      this.latest = answer.groups[0];
      this.update();
      return this.say(`Already found: ${answer.groups.map((g) => voieList(g)).join("; ")}.`);
    }
    this.found.push(...fresh);
    this.latest = fresh[0];
    localStorage.setItem(foundKey(this.map.id), JSON.stringify(this.found.map((g) => g.name)));
    this.update();
    const share = fresh.reduce((s, g) => s + g.m2, 0) / this.streets.totalM2;
    const metres = fresh.reduce((s, g) => s + g.metres, 0);
    const what = fresh.map((g) => capital(voieList(g))).join("; ");
    // Voies named after another one say so ("Voisinage de la rue de Bercy"): the longest note says more.
    const origin = fresh.length === 1 && longestOrigin(fresh[0]);
    this.message.replaceChildren(
      button(what, () => this.zoomTo(fresh), "link street-name"),
      ` +${percent(share)} · ${formatKm(metres / 1000)}${answer.typo ? " (one letter off, forgiven)" : ""}`,
      ...(origin ? [h("span", { class: "muted street-origin" }, origin)] : []),
    );
  }

  private say(text: string): void {
    this.message.replaceChildren(text);
  }

  private zoomTo(groups: StreetGroup[]): void {
    this.latest = groups[0];
    this.update();
    this.view.fitBoxes(groups.flatMap((g) => g.voies.map((v) => v.b)), 3);
  }

  private update(): void {
    const p = this.streets.progress(this.found);
    const share = p.m2 / this.streets.totalM2;
    this.stats.replaceChildren(
      h("strong", {}, count(p.names)),
      ` / ${count(this.streets.groups.length)} names · `,
      h("strong", {}, percent(share)),
      " of the street area · ",
      h("strong", {}, formatKm(p.metres / 1000)),
      ` of ${formatKm(this.streets.totalMetres / 1000)}`,
      h("span", { class: "muted" }, ` · ${count(p.voies)} / ${count(this.streets.data.voies.length)} voies`),
    );
    this.bar.style.width = `${Math.min(100, share * 100)}%`;
    this.recent.replaceChildren(
      ...this.found
        .slice(-RECENT)
        .reverse()
        .map((g) => {
          const b = button(capital(voieList(g)), () => this.zoomTo([g]), "link");
          b.title = longestOrigin(g);
          return h("li", {}, b);
        }),
    );
    if (this.found.length === 0) this.recent.replaceChildren(h("li", { class: "muted" }, "Nothing yet."));
    this.byArrondissement.replaceChildren(
      ...p.arrondissements.map((s, i) =>
        h(
          "span",
          { style: `--share: ${(s * 100).toFixed(1)}%` },
          h("b", {}, this.map.regions.find((r) => r.id === String(i + 1))?.short ?? String(i + 1)),
          ` ${percent(s)}`,
        ),
      ),
    );
    const view = (g: StreetGroup): FoundStreet => ({
      id: g.id,
      name: voieList(g),
      d: g.voies.map((v) => v.d).join(""),
    });
    this.view.setFoundStreets(this.found.map(view), this.latest ? view(this.latest) : null);
  }
}
