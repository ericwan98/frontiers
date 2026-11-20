import { formatKm } from "./awards.ts";
import { confetti } from "./confetti.ts";
import { button, h } from "./dom.ts";
import type { GameMap } from "./game.ts";
import { num, percent as pct, tr } from "./i18n.ts";
import { fanfare } from "./sound.ts";
import { packNames, type StreetGroup, type Streets } from "./streets.ts";
import type { FoundStreet, MapView } from "./view.ts";

const RECENT = 8;
/** Shares of the street area, and numbers of names, that are worth a celebration. */
const AREA_MILESTONES = [0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const NAME_MILESTONES = [100, 250, 500, 1000, 2000, 3000, 4000, 5000];
/** A timelapse shows finds in the order they were saved: this long per find, within these bounds. */
const TIMELAPSE_MS = { each: 30, min: 4000, max: 25000 };
const REPLAY = tr("Replay your finds", "Revoir tes trouvailles");

export const streetsTitle = (mapName: string) => tr(`${mapName} streets`, `Rues de ${mapName}`);

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

/** Adds names to the end of the saved ones, as if just found. */
export function addFound(mapId: string, names: string[]): void {
  localStorage.setItem(foundKey(mapId), JSON.stringify([...loadFound(mapId), ...names]));
}

/** Query parameter of a progress link: `?streets=<map id>.<code>`. */
export const STREETS_PARAM = "streets";

export function forgetFound(mapId: string): void {
  localStorage.removeItem(foundKey(mapId));
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const percent = (share: number) => (share > 0 && share < 0.0001 ? `<${pct(0.0001, 2)}` : pct(share, share < 0.1 ? 2 : 1));
const count = (n: number) => num(n);

function voieList(g: StreetGroup): string {
  const names = g.voies.map((v) => v.n);
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} ${tr("and", "et")} ${names.length - 3} ${tr("more", "autres")}`;
}

const longestOrigin = (g: StreetGroup) => g.voies.reduce((best, v) => ((v.o ?? "").length > best.length ? v.o! : best), "");

/** The biggest of `milestones` passed on the way from `before` to `after`. */
const passed = (milestones: number[], before: number, after: number) =>
  milestones.filter((m) => before < m && m <= after).pop();

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
  private readonly more: HTMLButtonElement;
  private readonly replay: HTMLButtonElement;
  private timelapseFrame = 0;

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
      placeholder: tr("Name a street, e.g. Rivoli", "Nomme une rue, ex. Rivoli"),
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "go",
      "aria-label": tr("Street name", "Nom de rue"),
    }) as HTMLInputElement;
    const form = h("form", { class: "street-form" }, this.input, h("button", { type: "submit", class: "primary" }, tr("Find", "Trouver")));
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
    // On a phone the panel starts folded to the input and a short count, to leave the map room.
    this.more = button(tr("More", "Plus"), () => this.unfold(!this.panel.classList.contains("unfolded")), "link street-more");
    this.more.setAttribute("aria-expanded", "false");
    this.replay = button(REPLAY, () => this.timelapse(), "link");
    this.panel = h(
      "aside",
      { class: "streets-panel" },
      h(
        "div",
        { class: "street-top" },
        button(`← ${map.name}`, onBack, "link"),
        h("strong", {}, streetsTitle(map.name)),
        this.more,
      ),
      form,
      this.message,
      this.stats,
      h("div", { class: "street-bar" }, this.bar),
      h("details", {}, h("summary", {}, tr("Latest finds", "Dernières trouvailles")), this.recent),
      h("details", {}, h("summary", {}, tr("By arrondissement", "Par arrondissement")), this.byArrondissement),
      h(
        "p",
        { class: "street-actions" },
        this.replay,
        button(tr("Copy a link to merge your finds", "Copier un lien pour fusionner tes trouvailles"), () => void this.share(), "link"),
      ),
    );
    stage.append(this.panel);

    // Arrondissement borders and names help find your way; the game is about the streets.
    view.setTruth(map.regions.map((r) => r.geometry));
    view.setPlaced(map.regions.map((r) => ({ name: r.short ?? r.name, shape: r.geometry, color: "none" })));
    view.setStreetBase(streets.data.unnamed + streets.data.voies.map((v) => v.d).join(""));
    view.onStreet = (id) => {
      const g = id === null ? undefined : streets.group(id);
      if (g) this.tell(g);
    };
    // A portrait phone shows the whole city as a thin strip: start closer, on the centre.
    if (matchMedia("(max-width: 700px) and (orientation: portrait)").matches) view.zoomBy(1.8);
    this.update();
    if (matchMedia("(pointer: fine)").matches) this.input.focus();
  }

  destroy(): void {
    cancelAnimationFrame(this.timelapseFrame);
    this.panel.remove();
    this.view.onStreet = () => {};
    this.view.setStreetBase(null);
    this.view.setTruth([]);
    this.view.setPlaced([]);
  }

  private answer(text: string): void {
    this.endTimelapse();
    const answer = this.streets.match(text);
    const asked = text.trim();
    if (answer.kind === "unknown") {
      return this.say(asked ? tr(`No street of ${this.map.name} is called “${asked}”.`, `Aucune rue de ${this.map.name} ne s'appelle « ${asked} ».`) : "");
    }
    if (answer.kind === "ambiguous") {
      return this.say(tr(`Several names are one letter away from “${asked}”: check the spelling.`, `Plusieurs noms sont à une lettre de « ${asked} » : vérifie l'orthographe.`));
    }
    const fresh = answer.groups.filter((g) => !this.found.includes(g));
    this.input.value = "";
    if (fresh.length === 0) {
      this.latest = answer.groups[0];
      this.update();
      return this.say(`${tr("Already found:", "Déjà trouvé :")} ${answer.groups.map((g) => voieList(g)).join("; ")}.`);
    }
    const before = this.streets.progress(this.found);
    this.found.push(...fresh);
    this.latest = fresh[0];
    // Append, never rewrite: a saved name the data no longer knows must survive until it comes back.
    addFound(this.map.id, fresh.map((g) => g.name));
    this.update();
    const share = fresh.reduce((s, g) => s + g.m2, 0) / this.streets.totalM2;
    const metres = fresh.reduce((s, g) => s + g.metres, 0);
    this.describe(fresh, ` +${percent(share)} · ${formatKm(metres / 1000)}${answer.typo ? tr(" (one letter off, forgiven)", " (une lettre fausse, pardonnée)") : ""}`);
    this.celebrate(before.m2 / this.streets.totalM2, before.names);
  }

  /** A found street tapped on the map: what it is and where its name comes from. */
  private tell(g: StreetGroup): void {
    this.endTimelapse();
    this.latest = g;
    this.update();
    const arrondissements = [...new Set(g.voies.flatMap((v) => v.a))]
      .sort((a, b) => a - b)
      .map((a) => this.map.regions.find((r) => r.id === String(a))?.short ?? String(a));
    this.describe([g], ` · ${percent(g.m2 / this.streets.totalM2)} · ${formatKm(g.metres / 1000)} · ${arrondissements.join(", ")}`);
  }

  private describe(groups: StreetGroup[], detail: string): void {
    const what = groups.map((g) => capital(voieList(g))).join("; ");
    // Voies named after another one say so ("Voisinage de la rue de Bercy"): the longest note says more.
    const origin = groups.length === 1 && longestOrigin(groups[0]);
    this.message.replaceChildren(
      button(what, () => this.zoomTo(groups), "link street-name"),
      detail,
      ...(origin ? [h("span", { class: "muted street-origin" }, origin)] : []),
    );
  }

  /** Confetti when this find passes a milestone, of street area or of names. */
  private celebrate(shareBefore: number, namesBefore: number): void {
    const p = this.streets.progress(this.found);
    const area = passed(AREA_MILESTONES, shareBefore, p.m2 / this.streets.totalM2);
    const names = passed(NAME_MILESTONES, namesBefore, p.names);
    const text = area
      ? tr(`${pct(area)} of the street area of ${this.map.name}!`, `${pct(area)} de la surface des rues de ${this.map.name} !`)
      : names && tr(`${count(names)} names of ${this.map.name} streets!`, `${count(names)} noms de rues de ${this.map.name} !`);
    if (!text) return;
    this.message.prepend(h("strong", { class: "street-milestone" }, `🎉 ${text}`));
    fanfare();
    confetti();
  }

  /** A link that adds these finds to whichever browser opens it: another device, or a friend's. */
  private async share(): Promise<void> {
    const found = new Set(this.found);
    const code = await packNames(this.streets.data.order, (name) => found.has(this.streets.groupOf(name)!));
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set(STREETS_PARAM, `${this.map.id}.${code}`);
    const what = tr(
      `Open it in another browser, or send it to a friend: your ${count(this.found.length)} names are added to theirs.`,
      `Ouvre-le dans un autre navigateur, ou envoie-le à un ami : tes ${count(this.found.length)} noms s'ajoutent aux siens.`,
    );
    try {
      await navigator.clipboard.writeText(url.toString());
      this.say(`${tr("Link copied.", "Lien copié.")} ${what}`);
    } catch {
      this.message.replaceChildren(`${what} `, h("input", { class: "street-link", readonly: "", value: url.toString() }));
    }
  }

  /** Lights up the finds again one by one, in the order they were saved. */
  private timelapse(): void {
    if (this.timelapseFrame) {
      this.endTimelapse();
      return this.say("");
    }
    const all = [...this.found];
    if (all.length === 0) return this.say(tr("Find a street first.", "Trouve d'abord une rue."));
    const duration = Math.min(TIMELAPSE_MS.max, Math.max(TIMELAPSE_MS.min, all.length * TIMELAPSE_MS.each));
    this.view.resetZoom();
    this.replay.textContent = tr("Stop the replay", "Arrêter");
    const start = performance.now();
    const step = (now: number) => {
      const n = Math.min(all.length, Math.max(1, Math.ceil(((now - start) / duration) * all.length)));
      this.update(all.slice(0, n), all[n - 1]);
      this.say(`${tr("Replay:", "Revoir :")} ${count(n)} / ${count(all.length)} ${tr("names", "noms")}`);
      this.timelapseFrame = n < all.length ? requestAnimationFrame(step) : 0;
      if (!this.timelapseFrame) this.replay.textContent = REPLAY;
    };
    this.timelapseFrame = requestAnimationFrame(step);
  }

  private endTimelapse(): void {
    if (!this.timelapseFrame) return;
    cancelAnimationFrame(this.timelapseFrame);
    this.timelapseFrame = 0;
    this.replay.textContent = REPLAY;
    this.update();
  }

  private unfold(on: boolean): void {
    this.panel.classList.toggle("unfolded", on);
    this.more.textContent = on ? tr("Less", "Moins") : tr("More", "Plus");
    this.more.setAttribute("aria-expanded", String(on));
  }

  private say(text: string): void {
    this.message.replaceChildren(text);
  }

  private zoomTo(groups: StreetGroup[]): void {
    this.latest = groups[0];
    this.update();
    this.view.fitBoxes(groups.flatMap((g) => g.voies.map((v) => v.b)), 3);
  }

  /** Shows `found` on the map and in the counters: all finds, or the first ones during a replay. */
  private update(found = this.found, latest = this.latest): void {
    const p = this.streets.progress(found);
    const share = p.m2 / this.streets.totalM2;
    this.stats.replaceChildren(
      h("strong", {}, count(p.names)),
      h("span", { class: "street-long" }, ` / ${count(this.streets.groups.length)}`),
      tr(" names · ", " noms · "),
      h("strong", {}, percent(share)),
      h("span", { class: "street-long" }, tr(" of the street area", " de la surface des rues")),
      " · ",
      h("strong", {}, formatKm(p.metres / 1000)),
      h("span", { class: "street-long" }, ` ${tr("of", "sur")} ${formatKm(this.streets.totalMetres / 1000)}`),
      h("span", { class: "muted street-long" }, ` · ${count(p.voies)} / ${count(this.streets.data.voies.length)} voies`),
    );
    this.bar.style.width = `${Math.min(100, share * 100)}%`;
    this.recent.replaceChildren(
      ...found
        .slice(-RECENT)
        .reverse()
        .map((g) => {
          const b = button(capital(voieList(g)), () => this.zoomTo([g]), "link");
          b.title = longestOrigin(g);
          return h("li", {}, b);
        }),
    );
    if (found.length === 0) this.recent.replaceChildren(h("li", { class: "muted" }, tr("Nothing yet.", "Rien pour l'instant.")));
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
    this.view.setFoundStreets(found.map(view), latest ? view(latest) : null);
  }
}
