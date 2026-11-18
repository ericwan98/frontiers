import "./style.css";
import { Game, type GameMap, type Placement, type SavedGame, type Scores } from "./game.ts";
import { awards, formatKm } from "./awards.ts";
import { confetti } from "./confetti.ts";
import { renderPng } from "./image.ts";
import { MAPS, type MapEntry } from "./maps/index.ts";
import { MAX_POINTS, square, verdict } from "./scoring.ts";
import { dailySeed, dayCode, formatSeed, newSeed, parseSeed, seededOrder, streak, type Seed } from "./seed.ts";
import { fanfare, isMuted, scoreSound, setMuted } from "./sound.ts";
import { challengeUrl, readChallenge, readPasted, shareText, sum, type Challenge } from "./share.ts";
import { colorFor, MapView } from "./view.ts";

const QUICK_COUNT = 10;
/** Maps with more regions than this also offer a quick game. */
const QUICK_FROM = 15;
const LAST_MAP_KEY = "frontiers:map";
const EASY_KEY = "frontiers:easy";
/** Total of the last finished game on each seed. */
const PLAYED_KEY = "frontiers:played";
const MAX_PLAYED = 200;
const REPLAY_MS = 1100;
const saveKey = (mapId: string) => `frontiers:${mapId}:game`;
const bestKey = (mapId: string) => `frontiers:${mapId}:best`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function h(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);


let entry: MapEntry = MAPS.find((m) => m.id === localStorage.getItem(LAST_MAP_KEY)) ?? MAPS[0];
let map: GameMap | null = null;
let view: MapView | null = null;
let game: Game | null = null;
let showTruth = false;
let endCardOpen = true;
/** Stepping through a finished game, `at` being the placement on show. */
let replay: { at: number; playing: boolean } | null = null;
let replayTimer = 0;

/** Puts `next` on screen; resolves false if another map was picked while it loaded. */
async function useMap(next: MapEntry): Promise<boolean> {
  entry = next;
  localStorage.setItem(LAST_MAP_KEY, next.id);
  if (map?.id === next.id) return true;
  const loaded = await next.load();
  if (entry !== next) return false;
  map = loaded;
  view?.destroy();
  view = new MapView($("stage"), map);
  setEraser(false);
  view.onStroke = (stroke) => {
    if (!game) return;
    if (!game.addStroke(stroke)) toast("Nothing left to claim there. Draw on free land.");
    render();
  };
  render();
  return true;
}

function loadSaved(mapId: string): SavedGame | null {
  try {
    const saved = JSON.parse(localStorage.getItem(saveKey(mapId)) ?? "null") as SavedGame | null;
    return saved?.mapId === mapId && saved.placements.length < saved.order.length ? saved : null;
  } catch {
    return null;
  }
}

function loadBest(mapId: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(bestKey(mapId)) ?? "{}");
  } catch {
    return {};
  }
}

function loadPlayed(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PLAYED_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function recordPlayed(seed: string, total: number): void {
  const played = Object.entries(loadPlayed()).filter(([s]) => s !== seed);
  played.push([seed, total]);
  localStorage.setItem(PLAYED_KEY, JSON.stringify(Object.fromEntries(played.slice(-MAX_PLAYED))));
}

/** Best scores are kept per game length and mode: easy scores don't compare. */
const bestFor = (count: number, easy: boolean) => (easy ? `${count}-easy` : String(count));

function persist(g: Game): void {
  const id = g.map.id;
  if (g.phase === "over") {
    localStorage.removeItem(saveKey(id));
    const best = loadBest(id);
    const key = bestFor(g.order.length, g.easy);
    if ((best[key] ?? -1) < g.total) localStorage.setItem(bestKey(id), JSON.stringify({ ...best, [key]: g.total }));
    if (g.seed) recordPlayed(g.seed, g.total);
  } else {
    localStorage.setItem(saveKey(id), JSON.stringify(g.save()));
  }
}

function start(m: GameMap, seed: Seed, rival: Scores | null = null): void {
  const order = seededOrder(seed, m.regions.map((r) => r.id));
  game = new Game(m, order, { seed: formatSeed(seed), easy: seed.easy, rival });
  stopReplay();
  showTruth = false;
  endCardOpen = true;
  setEraser(false);
  view?.resetZoom();
  persist(game);
  render();
}

function resume(m: GameMap, saved: SavedGame, rival: Scores | null = null): void {
  game = new Game(m, saved.order, {
    placements: saved.placements,
    seed: saved.seed ?? null,
    easy: saved.easy,
    rival: rival ?? saved.rival ?? null,
  });
  persist(game);
  render();
}

/** Starts the game a friend shared, or resumes it if it is the one in progress. */
async function playSeed({ seed, rival }: Challenge): Promise<void> {
  const target = MAPS.find((m) => m.id === seed.mapId)!;
  if (!(await useMap(target)) || !map) return;
  const saved = loadSaved(map.id);
  if (saved?.seed === formatSeed(seed)) resume(map, saved, rival);
  else start(map, seed, rival);
}

/** Error to show for a pasted seed, or null if it can be played. */
function seedProblem(seed: Seed | null): string | null {
  if (!seed) return "Paste a link or a seed like europe-10-K3F9X.";
  const target = MAPS.find((m) => m.id === seed.mapId);
  if (!target) return `No map called "${seed.mapId}".`;
  if (seed.count < 1 || seed.count > target.count) return `${target.name} has ${target.count} ${target.noun[1]}.`;
  return null;
}

function copy(text: string, done: string): void {
  navigator.clipboard.writeText(text).then(
    () => toast(done),
    () => toast(text),
  );
}

const touchScreen = () => matchMedia("(pointer: coarse)").matches;

const imageFile = (g: Game, blob: Blob) =>
  new File([blob], `frontiers-${g.seed ?? g.map.id}.png`, { type: "image/png" });

/** Phones get the share sheet; elsewhere the image goes to the clipboard, or downloads. */
async function shareImage(g: Game): Promise<void> {
  const png = renderPng(g, view!.snapshot());
  if (touchScreen() && navigator.canShare) {
    const file = imageFile(g, await png);
    if (navigator.canShare({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {});
  }
  try {
    // Safari only allows the write if the item is created right in the click, so it takes a promise.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast("Image copied: paste it in the group chat");
  } catch (error) {
    console.warn("image copy failed, downloading instead", error);
    download(imageFile(g, await png));
  }
}

function download(file: File): void {
  const a = h("a", { href: URL.createObjectURL(file), download: file.name }) as HTMLAnchorElement;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast(`Saved ${file.name}`);
}

const invite = (seed: string) => copy(challengeUrl(seed), "Link copied: friends who open it get the same order");

let toastTimer = 0;
function toast(message: string): void {
  const t = $("toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 2200);
}

function submit(): void {
  if (!game) return;
  const placement = game.submit();
  if (!placement) return toast("Draw something first, or skip.");
  const points = placement.score?.points ?? 0;
  scoreSound(points);
  if (points >= 85) confetti(60);
  setEraser(false);
  persist(game);
  render();
}

function skip(): void {
  if (!game?.skip()) return;
  setEraser(false);
  persist(game);
  render();
}

function next(): void {
  if (!game) return;
  game.next();
  const g = game;
  const before = loadBest(g.map.id)[bestFor(g.order.length, g.easy)];
  persist(g);
  render();
  if (g.phase === "over" && celebrates(g, before)) {
    fanfare();
    confetti();
  }
}

/** A finished game is worth confetti if it beat the friend, the best score, or got two thirds of the points. */
function celebrates(g: Game, best: number | undefined): boolean {
  if (g.rival) return g.total > sum(g.rival);
  return (best !== undefined && g.total > best) || g.total >= (g.order.length * MAX_POINTS * 2) / 3;
}

function setSound(on: boolean): void {
  setMuted(!on);
  const b = $("sound");
  b.textContent = on ? "🔊" : "🔇";
  b.setAttribute("aria-label", on ? "Mute sounds" : "Turn sounds on");
  b.title = b.getAttribute("aria-label")!;
}

function setEraser(on: boolean): void {
  if (view) view.eraseMode = on;
  $("eraser").setAttribute("aria-pressed", String(on));
}

function label(g: Game, regionId: string): string {
  const region = g.region(regionId);
  return region.short ?? region.name;
}

function placedItems(g: Game, upTo = g.placements.length, focus = -1) {
  return g.placements.slice(0, upTo).flatMap((p, i) =>
    p.shape.length ? [{ name: label(g, p.regionId), shape: p.shape, color: colorFor(i), focus: i === focus }] : [],
  );
}

/** Shows the finished map as it was after placement `at`; playing moves on by itself. */
function inspect(at: number, playing = false): void {
  const g = game;
  if (!g) return;
  clearInterval(replayTimer);
  replay = { at, playing };
  endCardOpen = false;
  if (playing) {
    view?.resetZoom();
    replayTimer = window.setInterval(() => {
      if (!replay) return clearInterval(replayTimer);
      if (replay.at + 1 < g.placements.length) replay.at++;
      if (replay.at + 1 >= g.placements.length) {
        replay.playing = false;
        clearInterval(replayTimer);
      }
      render();
    }, REPLAY_MS);
  } else {
    const p = g.placements[at];
    view?.fit([p.shape, g.region(p.regionId).geometry]);
  }
  render();
}

function stopReplay(): void {
  clearInterval(replayTimer);
  replay = null;
}

function closeReplay(): void {
  stopReplay();
  view?.resetZoom();
  endCardOpen = true;
  render();
}

function replayCard(g: Game, at: number, playing: boolean): HTMLElement[] {
  const last = g.placements.length - 1;
  const prev = button("◀", () => inspect(at - 1));
  prev.disabled = at === 0;
  prev.title = "Previous (←)";
  const nextOne = button("▶", () => inspect(at + 1));
  nextOne.disabled = at === last;
  nextOne.title = "Next (→)";
  const play = button(playing ? "Pause" : "Play", () => (playing ? inspect(at) : inspect(at === last ? 0 : at, true)));
  return [
    h("p", { class: "muted replay-step" }, `Replay · ${at + 1} / ${g.placements.length}`),
    resultCard(g, g.placements[at]),
    h("div", { class: "replay-controls" }, prev, play, nextOne, button("Results", closeReplay, "primary")),
  ];
}

function resultCard(g: Game, p: Placement): HTMLElement {
  const name = g.region(p.regionId).name;
  if (!p.score) return h("div", {}, h("h2", {}, name), h("p", { class: "muted" }, "Skipped. 0 points."), ...rivalLine(g, p));
  const { points, overlap, distanceKm } = p.score;
  return h(
    "div",
    {},
    h("h2", {}, name),
    h("div", { class: "points" }, `${points}`, h("small", {}, ` / ${MAX_POINTS}`)),
    h("p", { class: "verdict" }, verdict(points)),
    h(
      "p",
      { class: "muted" },
      `${Math.round(overlap * 100)}% overlap · ${formatKm(distanceKm ?? 0)} off${g.easy ? " · real border dashed" : ""}`,
    ),
    ...rivalLine(g, p),
  );
}

function rivalLine(g: Game, p: Placement): HTMLElement[] {
  if (!g.rival) return [];
  const theirs = g.rival[g.placements.indexOf(p)];
  const mine = p.score?.points ?? 0;
  const text = theirs === null ? "Your friend skipped it" : `Your friend: ${theirs} ${square(theirs)}`;
  const mood = mine > (theirs ?? 0) ? " · you take it" : mine === (theirs ?? 0) ? " · tie" : " · they take it";
  return [h("p", { class: "rival" }, text + mood)];
}

function endCard(g: Game): HTMLElement {
  const max = g.order.length * MAX_POINTS;
  const best = loadBest(g.map.id)[bestFor(g.order.length, g.easy)] ?? g.total;
  const rival = g.rival;
  const rows = g.placements
    .map((p, i) => ({ p, i, theirs: rival?.[i] }))
    .sort((a, b) => (b.p.score?.points ?? -1) - (a.p.score?.points ?? -1))
    .map(({ p, i, theirs }) => {
      const row = h(
        "li",
        { title: "Show it on the map" },
        h("span", {}, g.region(p.regionId).name),
        h("span", { class: "muted" }, p.score ? `${p.score.points}` : "skipped"),
        ...(rival ? [h("span", { class: "muted" }, theirs === null ? "skipped" : `${theirs}`)] : []),
      );
      row.addEventListener("click", () => inspect(i));
      return row;
    });
  const truthToggle = h("input", { type: "checkbox", id: "truth-toggle" }) as HTMLInputElement;
  truthToggle.checked = showTruth;
  truthToggle.addEventListener("change", () => {
    showTruth = truthToggle.checked;
    render();
  });
  const many = entry.noun[1];
  return h(
    "div",
    { class: "card end" },
    h("h1", {}, `${g.map.name}, according to you`),
    h("div", { class: "points" }, `${g.total}`, h("small", {}, ` / ${max}`)),
    ...(rival ? [duel(g, rival)] : []),
    h("p", { class: "muted" }, `Best on ${g.order.length} ${many}${g.easy ? " in easy mode" : ""}: ${best}`),
    ...awardList(g),
    ...(rival ? [h("p", { class: "ranking-head muted" }, h("span", {}, "You"), h("span", {}, "Friend"))] : []),
    h("ol", { class: rival ? "ranking vs" : "ranking" }, ...rows),
    h("label", { class: "toggle" }, truthToggle, " Show the real borders"),
    ...(g.seed
      ? [
          h(
            "div",
            { class: "share" },
            button("Copy result", () => copy(shareText(g, many), "Result copied: paste it in the group chat"), "primary"),
            button("Copy link", () =>
              copy(challengeUrl(g.seed!, g.scores), "Link copied: whoever opens it plays the same game against you"),
            ),
            button(touchScreen() ? "Share image" : "Copy image", () => void shareImage(g)),
            button("Download image", () => void renderPng(g, view!.snapshot()).then((png) => download(imageFile(g, png)))),
            h("span", { class: "seed-line muted" }, "Seed ", h("code", {}, g.seed)),
          ),
        ]
      : []),
    h(
      "div",
      { class: "actions" },
      button("▶ Replay", () => inspect(0, true)),
      button("Look at the map", () => {
        endCardOpen = false;
        render();
      }),
      button("Play again", showStart),
      button("Other maps", showPicker),
    ),
  );
}

function awardList(g: Game): HTMLElement[] {
  const won = awards(g);
  if (won.length === 0) return [];
  const items = won.map((a) => {
    const at = g.placements.findIndex((p) => p.regionId === a.regionId);
    const b = button("", () => inspect(at), "award");
    b.title = "Show it on the map";
    b.append(h("span", { class: "award-emoji" }, a.emoji), h("span", {}, h("strong", {}, a.title), " ", a.says("Your")));
    return h("li", {}, b);
  });
  return [h("ul", { class: "awards" }, ...items)];
}

function duel(g: Game, rival: Scores): HTMLElement {
  const theirs = sum(rival);
  const won = g.scores.filter((mine, i) => (mine ?? 0) > (rival[i] ?? 0)).length;
  const lost = g.scores.filter((mine, i) => (mine ?? 0) < (rival[i] ?? 0)).length;
  const headline =
    g.total > theirs ? `You win by ${g.total - theirs} 🎉` : g.total < theirs ? `Your friend wins by ${theirs - g.total}` : "Dead heat";
  return h(
    "div",
    { class: "duel" },
    h("strong", {}, headline),
    h("span", { class: "muted" }, `Friend: ${theirs} · ${entry.noun[1]} won ${won}, lost ${lost}`),
  );
}

function button(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = h("button", { class: cls, type: "button" }, label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

/** Marks a button as the Enter key's, on screens that have one. */
function withKey(b: HTMLButtonElement): HTMLButtonElement {
  b.append(h("span", { class: "key" }, " ⏎"));
  return b;
}

function bestLine(best: Record<string, number>, count: number, easy: boolean): string {
  const b = best[bestFor(count, easy)];
  return b === undefined ? "" : ` · best ${b}`;
}

function showPicker(): void {
  game = null;
  stopReplay();
  showTruth = false;
  const cards = MAPS.map((m) => {
    const saved = loadSaved(m.id);
    const best = loadBest(m.id)[String(m.count)];
    const status = saved
      ? `In progress: ${saved.placements.length}/${saved.order.length}`
      : best !== undefined
        ? `Best ${best} / ${m.count * MAX_POINTS}`
        : "";
    const card = button("", () => void pick(m), m === entry ? "map-card current" : "map-card");
    card.append(
      h("strong", {}, m.name),
      h("span", { class: "muted" }, `${m.count} ${m.noun[1]}`),
      h("span", { class: "muted" }, status),
    );
    return card;
  });
  $("overlay").replaceChildren(
    h(
      "div",
      { class: "card start" },
      h("h1", {}, "Frontiers"),
      h("p", { class: "lead" }, "Draw borders from memory, on a map that has none. Pick a map:"),
      ...streakLine(),
      h("div", { class: "maps" }, ...cards),
      seedForm(),
    ),
  );
  render();
}

function seedForm(): HTMLElement {
  const input = h("input", {
    type: "text",
    name: "seed",
    placeholder: "Link or seed, e.g. europe-10-K3F9X",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Seed",
  }) as HTMLInputElement;
  input.addEventListener("input", () => input.setCustomValidity(""));
  const form = h(
    "form",
    { class: "seed-form" },
    h("label", { for: "seed-input" }, "Got a link or a seed from a friend? Paste it to play the same game:"),
    h("div", { class: "seed-row" }, input, h("button", { type: "submit" }, "Play")),
  );
  input.id = "seed-input";
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const challenge = readPasted(input.value);
    const problem = seedProblem(challenge?.seed ?? null);
    input.setCustomValidity(problem ?? "");
    if (problem) return void input.reportValidity();
    void playSeed(challenge!);
  });
  return form;
}

async function pick(m: MapEntry): Promise<void> {
  $("overlay").setAttribute("aria-busy", "true");
  const ok = await useMap(m);
  $("overlay").removeAttribute("aria-busy");
  if (ok) showStart();
}

function showStart(): void {
  if (!map) return;
  const m = map;
  game = null;
  stopReplay();
  showTruth = false;
  view?.resetZoom();
  // A save from an older version of the map (say, with Alaska) can't be resumed.
  const ids = new Set(m.regions.map((r) => r.id));
  const stored = loadSaved(m.id);
  const saved = stored?.order.every((id) => ids.has(id)) ? stored : null;
  if (stored && !saved) localStorage.removeItem(saveKey(m.id));
  const best = loadBest(m.id);
  const n = m.regions.length;
  const [one, many] = entry.noun;
  const easy = localStorage.getItem(EASY_KEY) === "1";
  const easyToggle = h("input", { type: "checkbox", id: "easy-toggle" }) as HTMLInputElement;
  easyToggle.checked = easy;
  easyToggle.addEventListener("change", () => {
    localStorage.setItem(EASY_KEY, easyToggle.checked ? "1" : "0");
    showStart();
  });
  $("overlay").replaceChildren(
    h(
      "div",
      { class: "card start" },
      h("h1", {}, m.name),
      h("p", { class: "lead" }, entry.question),
      h(
        "ul",
        {},
        h("li", {}, `You get ${an(one)}. Draw its borders on the map by dragging a loop around it.`),
        h("li", {}, "Edges are free: your drawing is cut to the land. Draw more loops to add islands."),
        h("li", {}, `Land you already gave to ${an(one)} is taken. Next ${many} fit around your mistakes.`),
        h(
          "li",
          {},
          `Score: up to 100 per ${one}, for the overlap with the real thing and for being in the right place. The real borders show up only at the end.`,
        ),
      ),
      h(
        "label",
        { class: "toggle" },
        easyToggle,
        ` Easy mode: show the real border right after each ${one}`,
      ),
      h(
        "div",
        { class: "actions" },
        ...(saved
          ? [button(
                `Resume (${saved.placements.length}/${saved.order.length}${saved.easy ? ", easy" : ""})`,
                () => resume(m, saved),
                "primary",
              )]
          : []),
        dailyButton(m, Math.min(n, QUICK_COUNT), easy),
        button(`All ${n} ${many}${bestLine(best, n, easy)}`, () => start(m, newSeed(m.id, n, easy)), saved ? "" : "primary"),
        ...(n > QUICK_FROM
          ? [
              button(`Quick game: ${QUICK_COUNT}${bestLine(best, QUICK_COUNT, easy)}`, () =>
                start(m, newSeed(m.id, QUICK_COUNT, easy)),
              ),
            ]
          : []),
        button("← Other maps", showPicker, "link"),
      ),
    ),
  );
  render();
}

/** Same seed for everyone today: friends can compare without sending anything first. */
function dailyButton(m: GameMap, count: number, easy: boolean): HTMLButtonElement {
  const seed = dailySeed(m.id, count, easy);
  const played = loadPlayed()[formatSeed(seed)];
  const days = streak(Object.keys(loadPlayed()));
  const label = `Today's ${count}${played === undefined ? (days ? ` · 🔥 ${days}` : "") : ` · you scored ${played}`}`;
  return button(label, () => start(m, seed));
}

function streakLine(): HTMLElement[] {
  const seeds = Object.keys(loadPlayed());
  const days = streak(seeds);
  if (days === 0) return [];
  const today = dayCode(new Date());
  const done = seeds.some((s) => parseSeed(s)?.code === today);
  const nudge = done ? ": come back tomorrow" : ": play one of today's games to keep it";
  return [h("p", { class: "streak" }, `🔥 ${days}-day streak`, h("span", { class: "muted" }, nudge))];
}

/** Landing screen for a link a friend sent. */
async function showChallenge({ seed, rival }: Challenge): Promise<void> {
  const target = MAPS.find((m) => m.id === seed.mapId)!;
  const [, many] = target.noun;
  const played = loadPlayed()[formatSeed(seed)];
  const what = `${target.name}, ${seed.count} ${many}${seed.easy ? ", easy mode" : ""}.`;
  $("overlay").replaceChildren(
    h(
      "div",
      { class: "card start" },
      h("h1", {}, rival ? "You've been challenged" : "Frontiers"),
      h("p", { class: "lead" }, "Draw borders from memory, on a map that has none."),
      h(
        "p",
        {},
        rival
          ? `${what} Your friend scored ${sum(rival)} / ${seed.count * MAX_POINTS}. Same ${many}, same order: can you beat them?`
          : `A friend sent you a game: ${what} Same ${many}, same order.`,
      ),
      ...(played === undefined ? [] : [h("p", { class: "muted" }, `You already played it: ${played}.`)]),
      h(
        "div",
        { class: "actions" },
        button(rival ? "Accept the challenge" : "Play", () => void playSeed({ seed, rival }), "primary"),
        button("See all maps", showPicker, "link"),
      ),
    ),
  );
  await useMap(target);
}

function render(): void {
  const overlay = $("overlay");
  const g = game;
  overlay.hidden = g !== null && !(g.phase === "over" && endCardOpen);
  $("hud").hidden = g === null;
  if (!view) return;
  const shown = g?.phase === "over" ? replay : null;
  view.setPlaced(!g ? [] : shown ? placedItems(g, shown.at + 1, shown.at) : placedItems(g));
  view.setDraft(g?.draft ?? [], colorFor(g?.placements.length ?? 0));
  view.drawingEnabled = g?.phase === "drawing";
  if (!g) return view.setTruth([]);

  const last = g.lastPlacement;
  // Real borders stay hidden until the end, as they give away the neighbours. Easy mode shows
  // each one while its score is up.
  if (shown) view.setTruth([g.region(g.placements[shown.at].regionId).geometry]);
  else if (g.phase === "over") view.setTruth(showTruth ? g.order.map((r) => r.geometry) : []);
  else view.setTruth(g.easy && g.phase === "reveal" && last ? [g.region(last.regionId).geometry] : []);

  const done = g.placements.length;
  $("map-name").textContent = g.easy ? `${g.map.name} · easy mode` : g.map.name;
  $("progress").textContent = `${Math.min(done + (g.phase === "drawing" ? 1 : 0), g.order.length)} / ${g.order.length}`;
  $("total").textContent = `${g.total} pts`;
  const seedButton = $("seed");
  seedButton.hidden = !g.seed;
  seedButton.replaceChildren("Invite ", h("code", {}, g.seed ?? ""));
  const prompt = $("prompt");
  if (g.phase === "drawing") prompt.replaceChildren("Draw ", h("strong", {}, g.current!.name));
  else if (g.phase === "reveal") prompt.replaceChildren(h("strong", {}, g.region(last!.regionId).name));
  else prompt.replaceChildren(h("strong", {}, shown ? "Replay" : "Finished"));

  $("tools").hidden = g.phase !== "drawing";
  $<HTMLButtonElement>("undo").disabled = g.strokes.length === 0;
  $<HTMLButtonElement>("clear").disabled = g.strokes.length === 0;
  $<HTMLButtonElement>("submit").disabled = g.draft.length === 0;

  const result = $("result");
  result.hidden = g.phase !== "reveal" && !shown;
  if (shown) result.replaceChildren(...replayCard(g, shown.at, shown.playing));
  else if (g.phase === "reveal" && last) {
    result.replaceChildren(
      resultCard(g, last),
      withKey(button(g.current ? `Next ${entry.noun[0]}` : "See the results", next, "primary")),
    );
  }
  if (g.phase === "over") {
    if (endCardOpen) overlay.replaceChildren(endCard(g));
    $("results-button").hidden = endCardOpen || !!shown;
  } else {
    $("results-button").hidden = true;
  }
}

$("undo").addEventListener("click", () => {
  game?.undo();
  render();
});
$("clear").addEventListener("click", () => {
  game?.clear();
  render();
});
$("eraser").addEventListener("click", () => setEraser(!view?.eraseMode));
$("skip").addEventListener("click", skip);
$("submit").addEventListener("click", submit);
$("menu").addEventListener("click", showPicker);
$("seed").addEventListener("click", () => game?.seed && invite(game.seed));
$("zoom-in").addEventListener("click", () => view?.zoomBy(1.6));
$("zoom-out").addEventListener("click", () => view?.zoomBy(1 / 1.6));
$("zoom-reset").addEventListener("click", () => view?.resetZoom());
$("results-button").addEventListener("click", closeReplay);
$("sound").addEventListener("click", () => setSound(isMuted()));
setSound(!isMuted());

window.addEventListener("keydown", (e) => {
  if (!game || e.target instanceof HTMLInputElement) return;
  if (replay && game.phase === "over") {
    const last = game.placements.length - 1;
    if (e.key === "ArrowLeft") inspect(Math.max(0, replay.at - 1));
    else if (e.key === "ArrowRight") inspect(Math.min(last, replay.at + 1));
    else if (e.key === "Escape") closeReplay();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (game.phase === "drawing") submit();
    else if (game.phase === "reveal") next();
  } else if ((e.key === "z" && (e.metaKey || e.ctrlKey)) || e.key === "Backspace") {
    e.preventDefault();
    game.undo();
    render();
  } else if (e.key === "e" && game.phase === "drawing") {
    setEraser(!view?.eraseMode);
  } else if (e.key === "Escape") {
    game.clear();
    render();
  } else if (e.key === "+" || e.key === "=") view?.zoomBy(1.6);
  else if (e.key === "-") view?.zoomBy(1 / 1.6);
  else if (e.key === "0") view?.resetZoom();
});

// A friend's link opens their game; otherwise the picker opens over the last map played,
// loaded in the background.
const linked = readChallenge(new URLSearchParams(location.search));
history.replaceState(null, "", location.pathname);
if (linked && !seedProblem(linked.seed)) void showChallenge(linked);
else {
  showPicker();
  void useMap(entry);
}
