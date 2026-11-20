import "./style.css";
import { Game, gameTitle, LEVELS, levelName, levelOf, type GameMap, type Level, type Mode, type Placement, type SavedGame, type Scores } from "./game.ts";
import { awards, formatKm } from "./awards.ts";
import { confetti } from "./confetti.ts";
import { $, button, h } from "./dom.ts";
import { lang, num, percent, setLang, SWITCHED_KEY, tr } from "./i18n.ts";
import { renderPng } from "./image.ts";
import { MAPS, type MapEntry } from "./maps/index.ts";
import { pointsBox } from "./geometry.ts";
import { BULLSEYE_SHARE, MAX_POINTS, square, verdict } from "./scoring.ts";
import { dailySeed, dayCode, formatSeed, newSeed, parseSeed, sameSeed, seededOrder, streak, type Seed, type Setup } from "./seed.ts";
import { fanfare, isMuted, scoreSound, setMuted } from "./sound.ts";
import { Streets, unpackNames } from "./streets.ts";
import { addFound, forgetFound, loadFound, STREETS_PARAM, streetsTitle, StreetsScreen } from "./streets-screen.ts";
import { challengeUrl, readChallenge, readPasted, shareText, sum, type Challenge } from "./share.ts";
import { colorFor, MapView, type Pin, type TruthPin } from "./view.ts";

const QUICK_COUNT = 10;
/** Maps with more regions than this also offer a quick game. */
const QUICK_FROM = 15;
const LAST_MAP_KEY = "frontiers:map";
const LEVEL_KEY = "frontiers:level";
/** Before levels: "1" picked today's normal level, "0" today's hard. */
const OLD_EASY_KEY = "frontiers:easy";
/** The mode last picked on each map; before there was one per map, one for all of them. */
const modeKey = (mapId: string) => `frontiers:${mapId}:mode`;
const OLD_MODE_KEY = "frontiers:mode";
/** Total of the last finished game on each seed. */
const PLAYED_KEY = "frontiers:played";
/** "1" while the satellite view is on, on every map that has one. Display only: scores are the same. */
const SATELLITE_KEY = "frontiers:satellite";
const MAX_PLAYED = 200;
const REPLAY_MS = 1100;
/** Where a map's game and best scores are stored: each mode has its own. */
const slot = (mapId: string, mode: Mode) => (mode === "cities" ? `${mapId}-cities` : mapId);
const saveKey = (mapId: string, mode: Mode) => `frontiers:${slot(mapId, mode)}:game`;
const bestKey = (mapId: string, mode: Mode) => `frontiers:${slot(mapId, mode)}:best`;
const CAPITALS: [string, string] = tr(["capital", "capitals"], ["capitale", "capitales"]);

/** French nouns of the game that are feminine; the others are masculine. */
const feminine = (word: string) => ["capitale", "région"].includes(word);
const an = (word: string) =>
  tr(/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`, feminine(word) ? `une ${word}` : `un ${word}`);
/** "Next country", "Région suivante". */
const nextOne = (word: string) =>
  tr(`Next ${word}`, `${word[0].toUpperCase()}${word.slice(1)} ${feminine(word) ? "suivante" : "suivant"}`);
const upper = (word: string) => word[0].toUpperCase() + word.slice(1);


let entry: MapEntry = MAPS.find((m) => m.id === localStorage.getItem(LAST_MAP_KEY)) ?? MAPS[0];
/** What a map is played as: borders, capitals, or naming its streets, which isn't a Game. */
type Choice = Mode | "streets";
/** The mode picked on the start screen, if the map has it. */
function choiceOf(m: MapEntry): Choice {
  const stored = localStorage.getItem(modeKey(m.id)) ?? localStorage.getItem(OLD_MODE_KEY);
  if (stored === "cities" && m.cities) return "cities";
  if (stored === "streets" && m.streets) return "streets";
  return "borders";
}
const modeOf = (m: MapEntry): Mode => (choiceOf(m) === "cities" ? "cities" : "borders");
/** What the player places: the map's regions, or their capitals. */
const nouns = (mode: Mode) => (mode === "cities" ? CAPITALS : entry.noun);
let map: GameMap | null = null;
let view: MapView | null = null;
let game: Game | null = null;
let showTruth = false;
let endCardOpen = true;
/** Stepping through a finished game, `at` being the placement on show. */
let replay: { at: number; playing: boolean } | null = null;
let replayTimer = 0;
/** Street data, parsed once per map. */
const streetsCache = new Map<string, Streets>();
let streetsScreen: StreetsScreen | null = null;

/** Puts `next` on screen; resolves false if another map was picked while it loaded. */
async function useMap(next: MapEntry): Promise<boolean> {
  entry = next;
  localStorage.setItem(LAST_MAP_KEY, next.id);
  if (map?.id === next.id) return true;
  const loaded = await next.load();
  if (entry !== next) return false;
  closeStreets();
  map = loaded;
  view?.destroy();
  view = new MapView($("stage"), map);
  showSatellite();
  setEraser(false);
  view.onStroke = (stroke) => {
    if (!game) return;
    if (!game.addStroke(stroke)) toast(tr("Nothing left to claim there. Draw on free land.", "Plus rien à prendre ici. Dessine sur une terre libre."));
    render();
  };
  view.onPin = (at) => {
    if (game?.drop(at)) render();
  };
  render();
  return true;
}

function loadSaved(mapId: string, mode: Mode): SavedGame | null {
  try {
    const saved = JSON.parse(localStorage.getItem(saveKey(mapId, mode)) ?? "null") as SavedGame | null;
    return saved?.mapId === mapId && (saved.mode ?? "borders") === mode && saved.placements.length < saved.order.length
      ? saved
      : null;
  } catch {
    return null;
  }
}

function loadBest(mapId: string, mode: Mode): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(bestKey(mapId, mode)) ?? "{}");
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

/** The last total on a seed, also one saved under an older name of the seed. */
const playedOn = (seed: Seed) =>
  Object.entries(loadPlayed())
    .filter(([s]) => sameSeed(s, formatSeed(seed)))
    .at(-1)?.[1];

function recordPlayed(seed: string, total: number): void {
  const played = Object.entries(loadPlayed()).filter(([s]) => !sameSeed(s, seed));
  played.push([seed, total]);
  localStorage.setItem(PLAYED_KEY, JSON.stringify(Object.fromEntries(played.slice(-MAX_PLAYED))));
}

/** Best scores are kept per game length and level, as scores at different levels don't compare. */
const BEST_SUFFIX: Record<Level, string> = { easy: "-guided", normal: "-easy", hard: "" };
const bestFor = (count: number, level: Level) => `${count}${BEST_SUFFIX[level]}`;

function pickedLevel(): Level {
  const stored = localStorage.getItem(LEVEL_KEY);
  if (LEVELS.includes(stored as Level)) return stored as Level;
  return localStorage.getItem(OLD_EASY_KEY) === "0" ? "hard" : "normal";
}

function persist(g: Game): void {
  const [id, mode] = [g.map.id, g.mode];
  if (g.phase === "over") {
    localStorage.removeItem(saveKey(id, mode));
    const best = loadBest(id, mode);
    const key = bestFor(g.order.length, g.level);
    if ((best[key] ?? -1) < g.total) localStorage.setItem(bestKey(id, mode), JSON.stringify({ ...best, [key]: g.total }));
    if (g.seed) recordPlayed(g.seed, g.total);
  } else {
    localStorage.setItem(saveKey(id, mode), JSON.stringify(g.save()));
  }
}

function start(m: GameMap, seed: Seed, rival: Scores | null = null): void {
  const order = seededOrder(seed, m.regions.map((r) => r.id));
  game = new Game(m, order, { seed: formatSeed(seed), mode: seed.mode, level: seed.level, rival });
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
    mode: saved.mode,
    level: levelOf(saved),
    rival: rival ?? saved.rival ?? null,
  });
  persist(game);
  render();
}

/** Starts the game a friend shared, or resumes it if it is the one in progress. */
async function playSeed({ seed, rival }: Challenge): Promise<void> {
  const target = MAPS.find((m) => m.id === seed.mapId)!;
  if (!(await useMap(target)) || !map) return;
  const saved = loadSaved(map.id, seed.mode);
  if (saved?.seed && sameSeed(saved.seed, formatSeed(seed))) resume(map, saved, rival);
  else start(map, seed, rival);
}

/** Error to show for a pasted seed, or null if it can be played. */
function seedProblem(seed: Seed | null): string | null {
  if (!seed) return tr("Paste a link or a seed like europe-10-K3F9X.", "Colle un lien ou une graine comme europe-10-K3F9X.");
  const target = MAPS.find((m) => m.id === seed.mapId);
  if (!target) return tr(`No map called "${seed.mapId}".`, `Aucune carte ne s'appelle « ${seed.mapId} ».`);
  if (seed.mode === "cities" && !target.cities) return tr(`${target.name} has no capitals to find.`, `${target.name} : pas de capitales à trouver.`);
  if (seed.count < 1 || seed.count > target.count) return tr(`${target.name} has ${target.count} ${target.noun[1]}.`, `${target.name} compte ${target.count} ${target.noun[1]}.`);
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
    toast(tr("Image copied: paste it in the group chat", "Image copiée : colle-la dans le groupe"));
  } catch (error) {
    console.warn("image copy failed, downloading instead", error);
    download(imageFile(g, await png));
  }
}

function download(file: File): void {
  const a = h("a", { href: URL.createObjectURL(file), download: file.name }) as HTMLAnchorElement;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast(tr(`Saved ${file.name}`, `${file.name} enregistré`));
}

const invite = (seed: string) => copy(challengeUrl(seed), tr("Link copied: friends who open it get the same order", "Lien copié : tes amis qui l'ouvrent ont le même ordre"));

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
  if (!placement) return toast(
      game.mode === "cities"
        ? tr("Drop a pin first, or skip.", "Pose d'abord une épingle, ou passe.")
        : tr("Draw something first, or skip.", "Dessine d'abord quelque chose, ou passe."),
    );
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
  const before = loadBest(g.map.id, g.mode)[bestFor(g.order.length, g.level)];
  // Pins are blind until the end, where seeing how far off they were is the fun part.
  if (g.phase === "over" && g.mode === "cities") showTruth = true;
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
  b.setAttribute("aria-label", on ? tr("Mute sounds", "Couper le son") : tr("Turn sounds on", "Activer le son"));
  b.title = b.getAttribute("aria-label")!;
}

function setSatellite(on: boolean): void {
  if (on) localStorage.setItem(SATELLITE_KEY, "1");
  else localStorage.removeItem(SATELLITE_KEY);
  showSatellite();
}

/** Matches the satellite button and picture to the stored choice and the map on screen. */
function showSatellite(): void {
  const on = localStorage.getItem(SATELLITE_KEY) === "1";
  const b = $("satellite");
  b.hidden = !entry.satellite;
  b.setAttribute("aria-pressed", String(on));
  view?.setSatellite(on ? entry.satellite : undefined);
}

function setEraser(on: boolean): void {
  if (view) view.eraseMode = on;
  $("eraser").setAttribute("aria-pressed", String(on));
}

function label(g: Game, regionId: string): string {
  const region = g.region(regionId);
  return region.short ?? region.name;
}

/** In easy mode, during the game, the real region takes the place of every placement but the one whose score is up. */
const shownReal = (g: Game, i: number) =>
  g.level === "easy" && g.phase !== "over" && i < g.placements.length - (g.phase === "reveal" ? 1 : 0);

function placedItems(g: Game, upTo = g.placements.length, focus = -1) {
  return g.placements.slice(0, upTo).flatMap((p, i) => {
    const shape = shownReal(g, i) ? g.region(p.regionId).geometry : p.shape;
    return shape.length ? [{ name: label(g, p.regionId), shape, color: colorFor(i), focus: i === focus }] : [];
  });
}

function placedPins(g: Game, upTo = g.placements.length, focus = -1): Pin[] {
  return g.placements.slice(0, upTo).flatMap((p, i) => {
    const at = shownReal(g, i) ? g.region(p.regionId).capital!.at : p.pin;
    return at ? [{ name: g.target(p.regionId), at, color: colorFor(i), focus: i === focus }] : [];
  });
}

function truthPin(g: Game, p: Placement, label: boolean): TruthPin {
  const { name, at } = g.region(p.regionId).capital!;
  return { at, from: p.pin, name, label };
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
    const region = g.region(p.regionId);
    if (g.mode === "cities") view?.fitBoxes([pointsBox(p.pin ? [p.pin, region.capital!.at] : [region.capital!.at])], 4);
    else view?.fit([p.shape, region.geometry]);
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
  prev.title = tr("Previous (←)", "Précédent (←)");
  const forward = button("▶", () => inspect(at + 1));
  forward.disabled = at === last;
  forward.title = tr("Next (→)", "Suivant (→)");
  const play = button(playing ? "Pause" : tr("Play", "Lecture"), () => (playing ? inspect(at) : inspect(at === last ? 0 : at, true)));
  return [
    h("p", { class: "muted replay-step" }, `${tr("Replay", "Revoir")} · ${at + 1} / ${g.placements.length}`),
    resultCard(g, g.placements[at]),
    h("div", { class: "replay-controls" }, prev, play, forward, button(tr("Results", "Résultats"), closeReplay, "primary")),
  ];
}

function resultCard(g: Game, p: Placement): HTMLElement {
  const region = g.region(p.regionId);
  const title = g.mode === "cities" ? h("h2", {}, g.target(p.regionId), h("small", { class: "muted" }, ` ${region.name}`)) : h("h2", {}, region.name);
  if (!p.score) return h("div", {}, title, h("p", { class: "muted" }, tr("Skipped. 0 points.", "Passé. 0 point.")), ...rivalLine(g, p));
  const { points, overlap, distanceKm } = p.score;
  const off = tr(`${formatKm(distanceKm ?? 0)} off`, `à ${formatKm(distanceKm ?? 0)}`);
  const help =
    g.level === "hard"
      ? ""
      : g.mode === "cities"
        ? tr(" · real spot circled", " · vrai lieu entouré")
        : tr(" · real border dashed", " · vraie frontière en pointillés");
  const next = g.phase === "reveal" && g.level === "easy" ? (g.mode === "cities" ? tr(", your pin goes there", ", ton épingle y va") : tr(", it takes your drawing's place", ", elle remplace ton dessin")) : "";
  const detail = g.mode === "cities" ? `${off}${help}${next}` : `${percent(overlap ?? 0)} ${tr("overlap", "de recouvrement")} · ${off}${help}${next}`;
  return h(
    "div",
    {},
    title,
    h("div", { class: "points" }, `${points}`, h("small", {}, ` / ${MAX_POINTS}`)),
    h("p", { class: "verdict" }, verdict(points)),
    h("p", { class: "muted" }, detail),
    ...rivalLine(g, p),
  );
}

function rivalLine(g: Game, p: Placement): HTMLElement[] {
  if (!g.rival) return [];
  const theirs = g.rival[g.placements.indexOf(p)];
  const mine = p.score?.points ?? 0;
  const text =
    theirs === null ? tr("Your friend skipped it", "Ton ami l'a passé") : `${tr("Your friend:", "Ton ami :")} ${theirs} ${square(theirs)}`;
  const mood =
    mine > (theirs ?? 0)
      ? tr(" · you take it", " · pour toi")
      : mine === (theirs ?? 0)
        ? tr(" · tie", " · égalité")
        : tr(" · they take it", " · pour ton ami");
  return [h("p", { class: "rival" }, text + mood)];
}

function endCard(g: Game): HTMLElement {
  const max = g.order.length * MAX_POINTS;
  const best = loadBest(g.map.id, g.mode)[bestFor(g.order.length, g.level)] ?? g.total;
  const rival = g.rival;
  const rows = g.placements
    .map((p, i) => ({ p, i, theirs: rival?.[i] }))
    .sort((a, b) => (b.p.score?.points ?? -1) - (a.p.score?.points ?? -1))
    .map(({ p, i, theirs }) => {
      const row = h(
        "li",
        { title: tr("Show it on the map", "Le voir sur la carte") },
        h("span", {}, g.target(p.regionId)),
        h("span", { class: "muted" }, p.score ? `${p.score.points}` : tr("skipped", "passé")),
        ...(rival ? [h("span", { class: "muted" }, theirs === null ? tr("skipped", "passé") : `${theirs}`)] : []),
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
  const many = nouns(g.mode)[1];
  return h(
    "div",
    { class: "card end" },
    h("h1", {}, tr(`${g.title}, according to you`, `${g.title}, selon toi`)),
    h("div", { class: "points" }, `${g.total}`, h("small", {}, ` / ${max}`)),
    ...(rival ? [duel(g, rival)] : []),
    h(
      "p",
      { class: "muted" },
      g.level === "hard"
        ? tr(`Best on ${g.order.length} ${many}: ${best}`, `Record sur ${g.order.length} ${many} : ${best}`)
        : tr(
            `Best on ${g.order.length} ${many} in ${g.level} mode: ${best}`,
            `Record sur ${g.order.length} ${many} en mode ${levelName(g.level)} : ${best}`,
          ),
    ),
    ...awardList(g),
    ...(rival ? [h("p", { class: "ranking-head muted" }, h("span", {}, tr("You", "Toi")), h("span", {}, tr("Friend", "Ami")))] : []),
    h("ol", { class: rival ? "ranking vs" : "ranking" }, ...rows),
    h("label", { class: "toggle" }, truthToggle, g.mode === "cities" ? tr(" Show the real cities", " Montrer les vraies villes") : tr(" Show the real borders", " Montrer les vraies frontières")),
    ...(g.seed
      ? [
          h(
            "div",
            { class: "share" },
            button(
              tr("Copy result", "Copier le résultat"),
              () => copy(shareText(g, many), tr("Result copied: paste it in the group chat", "Résultat copié : colle-le dans le groupe")),
              "primary",
            ),
            button(tr("Copy link", "Copier le lien"), () =>
              copy(
                challengeUrl(g.seed!, g.scores),
                tr("Link copied: whoever opens it plays the same game against you", "Lien copié : qui l'ouvre joue la même partie contre toi"),
              ),
            ),
            button(touchScreen() ? tr("Share image", "Partager l'image") : tr("Copy image", "Copier l'image"), () => void shareImage(g)),
            button(tr("Download image", "Télécharger l'image"), () => void renderPng(g, view!.snapshot()).then((png) => download(imageFile(g, png)))),
            h("span", { class: "seed-line muted" }, tr("Seed ", "Graine "), h("code", {}, g.seed)),
          ),
        ]
      : []),
    h(
      "div",
      { class: "actions" },
      button(tr("▶ Replay", "▶ Revoir"), () => inspect(0, true)),
      button(tr("Look at the map", "Voir la carte"), () => {
        endCardOpen = false;
        render();
      }),
      button(tr("Play again", "Rejouer"), showStart),
      button(tr("Other maps", "Autres cartes"), showPicker),
    ),
  );
}

function awardList(g: Game): HTMLElement[] {
  const won = awards(g);
  if (won.length === 0) return [];
  const items = won.map((a) => {
    const at = g.placements.findIndex((p) => p.regionId === a.regionId);
    const b = button("", () => inspect(at), "award");
    b.title = tr("Show it on the map", "Le voir sur la carte");
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
    g.total > theirs
      ? tr(`You win by ${g.total - theirs} 🎉`, `Tu gagnes de ${g.total - theirs} 🎉`)
      : g.total < theirs
        ? tr(`Your friend wins by ${theirs - g.total}`, `Ton ami gagne de ${theirs - g.total}`)
        : tr("Dead heat", "Égalité parfaite");
  return h(
    "div",
    { class: "duel" },
    h("strong", {}, headline),
    h(
      "span",
      { class: "muted" },
      tr(
        `Friend: ${theirs} · ${nouns(g.mode)[1]} won ${won}, lost ${lost}`,
        `Ami : ${theirs} · ${upper(nouns(g.mode)[1])} : ${won} pour toi, ${lost} pour ton ami`,
      ),
    ),
  );
}

/** Marks a button as the Enter key's, on screens that have one. */
function withKey(b: HTMLButtonElement): HTMLButtonElement {
  b.append(h("span", { class: "key" }, " ⏎"));
  return b;
}

function bestLine(best: Record<string, number>, count: number, level: Level): string {
  const b = best[bestFor(count, level)];
  return b === undefined ? "" : ` · ${tr("best", "record")} ${b}`;
}

function showPicker(): void {
  closeStreets();
  game = null;
  stopReplay();
  showTruth = false;
  const cards = MAPS.map((m) => {
    const saved = loadSaved(m.id, modeOf(m));
    const best = loadBest(m.id, modeOf(m))[String(m.count)];
    const status = choiceOf(m) === "streets"
      ? tr(`Streets: ${loadFound(m.id).length} found`, `Rues : ${loadFound(m.id).length} trouvées`)
      : saved
      ? `${tr("In progress:", "En cours :")} ${saved.placements.length}/${saved.order.length}`
      : best !== undefined
        ? `${tr("Best", "Record")} ${best} / ${m.count * MAX_POINTS}`
        : "";
    const card = button("", () => void pick(m), m === entry ? "map-card current" : "map-card");
    card.append(
      h("strong", {}, m.name),
      h("span", { class: "muted" }, `${m.count} ${m.noun[1]}${m.cities ? tr(", or their capitals", ", ou leurs capitales") : ""}${m.streets ? tr(", or its streets", ", ou ses rues") : ""}`),
      h("span", { class: "muted" }, status),
    );
    return card;
  });
  $("overlay").replaceChildren(
    h(
      "div",
      { class: "card start" },
      h("h1", {}, "Frontiers"),
      h(
        "p",
        { class: "lead" },
        tr(
          "Draw borders or find capitals from memory, on a map that has neither. Pick a map:",
          "Trace les frontières ou trouve les capitales de mémoire, sur une carte qui n'a ni l'un ni l'autre. Choisis une carte :",
        ),
      ),
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
    placeholder: tr("Link or seed, e.g. europe-10-K3F9X", "Lien ou graine, ex. europe-10-K3F9X"),
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": tr("Seed", "Graine"),
  }) as HTMLInputElement;
  input.addEventListener("input", () => input.setCustomValidity(""));
  const form = h(
    "form",
    { class: "seed-form" },
    h(
      "label",
      { for: "seed-input" },
      tr(
        "Got a link or a seed from a friend? Paste it to play the same game:",
        "Un ami t'a envoyé un lien ou une graine ? Colle-le pour jouer la même partie :",
      ),
    ),
    h("div", { class: "seed-row" }, input, h("button", { type: "submit" }, tr("Play", "Jouer"))),
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
  closeStreets();
  game = null;
  stopReplay();
  showTruth = false;
  view?.resetZoom();
  if (choiceOf(entry) === "streets") return showStreetsStart(m);
  // A save from an older version of the map (say, with Alaska) can't be resumed.
  const mode = modeOf(entry);
  const ids = new Set(m.regions.map((r) => r.id));
  const stored = loadSaved(m.id, mode);
  const saved = stored?.order.every((id) => ids.has(id)) ? stored : null;
  if (stored && !saved) localStorage.removeItem(saveKey(m.id, mode));
  const best = loadBest(m.id, mode);
  const n = m.regions.length;
  const [one, many] = nouns(mode);
  const level = pickedLevel();
  const setup = (count: number): Setup => ({ mapId: m.id, count, level, mode });
  $("overlay").replaceChildren(
    h(
      "div",
      { class: "card start" },
      h("h1", {}, gameTitle(m.name, mode)),
      ...modeSwitch(mode),
      h("p", { class: "lead" }, mode === "cities" ? entry.cities!.question : entry.question),
      h("ul", {}, ...rules(m, mode, level).map((rule) => h("li", {}, rule))),
      ...levelSwitch(level, mode, one),
      h(
        "div",
        { class: "actions" },
        ...(saved
          ? [button(
                `${tr("Resume", "Reprendre")} (${saved.placements.length}/${saved.order.length}${levelOf(saved) === "hard" ? "" : `, ${levelName(levelOf(saved))}`})`,
                () => resume(m, saved),
                "primary",
              )]
          : []),
        dailyButton(m, setup(Math.min(n, QUICK_COUNT))),
        button(`${tr("All", "Les")} ${n} ${many}${bestLine(best, n, level)}`, () => start(m, newSeed(setup(n))), saved ? "" : "primary"),
        ...(n > QUICK_FROM
          ? [
              button(`${tr("Quick game:", "Partie rapide :")} ${QUICK_COUNT}${bestLine(best, QUICK_COUNT, level)}`, () =>
                start(m, newSeed(setup(QUICK_COUNT))),
              ),
            ]
          : []),
        button(tr("← Other maps", "← Autres cartes"), showPicker, "link"),
      ),
    ),
  );
  render();
}

/** The three levels, and what the picked one does. */
function levelSwitch(level: Level, mode: Mode, one: string): HTMLElement[] {
  const cities = mode === "cities";
  const says: Record<Level, string> = cities
    ? {
        easy: tr("After each capital, your pin moves to the real spot.", "Après chaque capitale, ton épingle file au vrai endroit."),
        normal: tr("Right after each pin, see where the capital really is.", "Juste après chaque épingle, vois où est vraiment la capitale."),
        hard: tr("The real cities only show at the end.", "Les vraies villes n'apparaissent qu'à la fin."),
      }
    : {
        easy: tr(
          `After each ${one}, the real border takes the place of your drawing: mistakes don't pile up.`,
          `Après chaque ${one}, la vraie frontière remplace ton dessin : les erreurs ne s'accumulent pas.`,
        ),
        normal: tr(
          `Right after each ${one}, the real border shows dashed, then goes away.`,
          `Juste après chaque ${one}, la vraie frontière s'affiche en pointillés, puis disparaît.`,
        ),
        hard: tr("The real borders only show at the end.", "Les vraies frontières n'apparaissent qu'à la fin."),
      };
  const choice = (value: Level) => {
    const b = button(upper(levelName(value)), () => {
      localStorage.setItem(LEVEL_KEY, value);
      showStart();
    });
    b.setAttribute("aria-pressed", String(level === value));
    return b;
  };
  return [
    h("div", { class: "modes levels", role: "group", "aria-label": tr("Level", "Niveau") }, ...LEVELS.map(choice)),
    h("p", { class: "muted level-says" }, says[level]),
  ];
}

/** Borders, capitals or streets, on maps that have more than borders. */
function modeSwitch(mode: Choice): HTMLElement[] {
  if (!entry.cities && !entry.streets) return [];
  const choice = (value: Choice, text: string) => {
    const b = button(text, () => {
      localStorage.setItem(modeKey(entry.id), value);
      showStart();
    });
    b.setAttribute("aria-pressed", String(mode === value));
    return b;
  };
  return [
    h(
      "div",
      { class: "modes", role: "group", "aria-label": "Mode" },
      choice("borders", tr("Borders", "Frontières")),
      ...(entry.cities ? [choice("cities", tr("Capitals", "Capitales"))] : []),
      ...(entry.streets ? [choice("streets", tr("Streets", "Rues"))] : []),
    ),
  ];
}

function showStreetsStart(m: GameMap): void {
  const found = loadFound(m.id).length;
  const actions = [
    button(found ? tr(`Continue (${found} found)`, `Continuer (${found} trouvées)`) : tr("Start", "Commencer"), () => void playStreets(), "primary"),
    ...(found
      ? [button(tr("Start over", "Recommencer"), () => {
          if (!confirm(tr(`Forget the ${found} names you found?`, `Oublier les ${found} noms trouvés ?`))) return;
          forgetFound(m.id);
          showStart();
        })]
      : []),
    button(tr("← Other maps", "← Autres cartes"), showPicker, "link"),
  ];
  $("overlay").replaceChildren(
    h(
      "div",
      { class: "card start" },
      h("h1", {}, streetsTitle(m.name)),
      ...modeSwitch("streets"),
      h("p", { class: "lead" }, entry.streets!.question),
      h(
        "ul",
        {},
        h(
          "li",
          {},
          tr(
            "Type the name of a street: every street with that name lights up. “Bercy” finds the rue, the boulevard, the quai, the pont, the port and the allée de Bercy.",
            "Tape le nom d'une rue : toutes les voies de ce nom s'allument. « Bercy » trouve la rue, le boulevard, le quai, le pont, le port et l'allée de Bercy.",
          ),
        ),
        h("li", {}, tr("“Rue de” is optional: “Rivoli” is enough. One wrong letter is forgiven.", "« Rue de » est facultatif : « Rivoli » suffit. Une lettre fausse est pardonnée.")),
        h(
          "li",
          {},
          tr(
            "The counters show the names you found and the share of the street area they cover. There is no end and no timer: your progress stays in this browser, so come back any time.",
            "Les compteurs montrent les noms trouvés et la part de la surface des rues qu'ils couvrent. Pas de fin, pas de chrono : ta progression reste dans ce navigateur, reviens quand tu veux.",
          ),
        ),
      ),
      h("div", { class: "actions" }, ...actions),
    ),
  );
  render();
}

async function loadStreets(e: MapEntry): Promise<Streets> {
  let streets = streetsCache.get(e.id);
  if (!streets) {
    streets = new Streets(await e.streets!.load());
    streetsCache.set(e.id, streets);
  }
  return streets;
}

async function playStreets(): Promise<void> {
  const [m, e] = [map, entry];
  if (!m || !e.streets) return;
  $("overlay").setAttribute("aria-busy", "true");
  const streets = await loadStreets(e);
  $("overlay").removeAttribute("aria-busy");
  if (map !== m || !view || streetsScreen) return;
  view.resetZoom();
  streetsScreen = new StreetsScreen(streets, m, view, $("stage"), showStart);
  render();
}

/** A progress link: shows what it would add, and merges it into this browser's finds if asked. */
async function showStreetsLink(target: MapEntry, code: string): Promise<void> {
  showPicker();
  $("overlay").setAttribute("aria-busy", "true");
  localStorage.setItem(modeKey(target.id), "streets");
  const [ok, streets] = await Promise.all([useMap(target), loadStreets(target)]);
  const names = await unpackNames(streets.data.order, code);
  $("overlay").removeAttribute("aria-busy");
  if (!ok || entry !== target) return;
  if (!names) {
    showStart();
    return toast(tr("This progress link is broken: copy it again.", "Ce lien de progression est cassé : copie-le à nouveau."));
  }
  const fresh = streets.newFinds(loadFound(target.id), names);
  const total = new Set(names.map((n) => streets.groupOf(n)).filter(Boolean)).size;
  $("overlay").replaceChildren(
    h(
      "div",
      { class: "card start" },
      h("h1", {}, streetsTitle(target.name)),
      h(
        "p",
        { class: "lead" },
        tr(`This link holds ${num(total)} street names. `, `Ce lien contient ${num(total)} noms de rues. `),
        fresh.length
          ? h("strong", {}, tr(`${num(fresh.length)} of them are new to you.`, `${num(fresh.length)} sont nouveaux pour toi.`))
          : tr("You found all of them already.", "Tu les as déjà tous trouvés."),
      ),
      h(
        "p",
        { class: "muted" },
        tr("Merging adds them to the streets found in this browser. Nothing is removed.", "La fusion les ajoute aux rues trouvées dans ce navigateur. Rien n'est retiré."),
      ),
      h(
        "div",
        { class: "actions" },
        fresh.length
          ? button(tr(`Add ${num(fresh.length)} and play`, `Ajouter ${num(fresh.length)} et jouer`), () => {
              addFound(target.id, fresh);
              void playStreets();
            }, "primary")
          : button(tr("Play", "Jouer"), () => void playStreets(), "primary"),
        button(tr("Not now", "Pas maintenant"), showStart, "link"),
      ),
    ),
  );
}

function closeStreets(): void {
  streetsScreen?.destroy();
  streetsScreen = null;
}

/** How to play; when the real borders show depends on the level, which says it under its switch. */
function rules(m: GameMap, mode: Mode, level: Level): string[] {
  const [one, many] = nouns(mode);
  if (mode === "cities") {
    const tap = touchScreen() ? tr("Tap", "Touche") : tr("Click", "Clique");
    const bullseye = formatKm(BULLSEYE_SHARE * m.width * m.kmPerUnit);
    return [
      tr(
        `You get ${an(one)}. ${tap} where you think it is to drop a pin; ${tap.toLowerCase()} again to move it. Drag to pan.`,
        `On te donne ${an(one)}. ${tap} là où tu penses qu'elle est pour poser une épingle ; ${tap.toLowerCase()} encore pour la déplacer. Fais glisser pour te déplacer.`,
      ),
      tr("The map shows coasts but no borders and no cities.", "La carte montre les côtes, mais ni frontières ni villes."),
      tr(
        `Score: up to 100 per ${one}. Within ${bullseye} is a bullseye; points drop off with distance after that.`,
        `Score : jusqu'à 100 par ${one}. À moins de ${bullseye}, c'est dans le mille ; au-delà, les points baissent avec la distance.`,
      ),
    ];
  }
  return [
    tr(
      `You get ${an(one)}. Draw its borders on the map by dragging a loop around it.`,
      `On te donne ${an(one)}. Trace ses frontières sur la carte en dessinant une boucle autour.`,
    ),
    tr(
      "Edges are free: your drawing is cut to the land. Draw more loops to add islands.",
      "Les bords sont offerts : ton dessin est coupé à la terre. Ajoute des boucles pour les îles.",
    ),
    level === "easy"
      ? tr(`Land of the ${many} already played is taken, as far as their real borders go.`, "La terre déjà jouée est prise, jusqu'aux vraies frontières.")
      : tr(
          `Land you already gave to ${an(one)} is taken. Next ${many} fit around your mistakes.`,
          `La terre déjà donnée à ${an(one)} est prise : la suite se cale autour de tes erreurs.`,
        ),
    tr(
      `Score: up to 100 per ${one}, for the overlap with the real thing and for being in the right place.`,
      `Score : jusqu'à 100 par ${one}, pour le recouvrement avec le vrai et pour la bonne position.`,
    ),
  ];
}

/** Same seed for everyone today: friends can compare without sending anything first. */
function dailyButton(m: GameMap, setup: Setup): HTMLButtonElement {
  const { count } = setup;
  const seed = dailySeed(setup);
  const played = playedOn(seed);
  const days = streak(Object.keys(loadPlayed()));
  const label = `${tr(`Today's ${count}`, `Les ${count} du jour`)}${
    played === undefined ? (days ? ` · 🔥 ${days}` : "") : ` · ${tr("you scored", "ton score")} ${played}`
  }`;
  return button(label, () => start(m, seed));
}

function streakLine(): HTMLElement[] {
  const seeds = Object.keys(loadPlayed());
  const days = streak(seeds);
  if (days === 0) return [];
  const today = dayCode(new Date());
  const done = seeds.some((s) => parseSeed(s)?.code === today);
  const nudge = done
    ? tr(": come back tomorrow", " : reviens demain")
    : tr(": play one of today's games to keep it", " : joue une partie du jour pour la garder");
  return [h("p", { class: "streak" }, tr(`🔥 ${days}-day streak`, `🔥 ${days} jours d'affilée`), h("span", { class: "muted" }, nudge))];
}

/** Landing screen for a link a friend sent. */
async function showChallenge({ seed, rival }: Challenge): Promise<void> {
  const target = MAPS.find((m) => m.id === seed.mapId)!;
  const cities = seed.mode === "cities";
  const many = cities ? CAPITALS[1] : target.noun[1];
  const played = playedOn(seed);
  const level = seed.level === "hard" ? "" : `, ${tr(`${seed.level} mode`, `mode ${levelName(seed.level)}`)}`;
  const what = `${gameTitle(target.name, seed.mode)}, ${seed.count} ${many}${level}.`;
  $("overlay").replaceChildren(
    h(
      "div",
      { class: "card start" },
      h("h1", {}, rival ? tr("You've been challenged", "On te lance un défi") : "Frontiers"),
      h(
        "p",
        { class: "lead" },
        cities
          ? tr("Find capitals from memory, on a map that has none.", "Trouve les capitales de mémoire, sur une carte qui n'en a aucune.")
          : tr("Draw borders from memory, on a map that has none.", "Trace les frontières de mémoire, sur une carte qui n'en a aucune."),
      ),
      h(
        "p",
        {},
        rival
          ? tr(
              `${what} Your friend scored ${sum(rival)} / ${seed.count * MAX_POINTS}. Same ${many}, same order: can you beat them?`,
              `${what} Ton ami a fait ${sum(rival)} / ${seed.count * MAX_POINTS}. Mêmes ${many}, même ordre : feras-tu mieux ?`,
            )
          : tr(`A friend sent you a game: ${what} Same ${many}, same order.`, `Un ami t'envoie une partie : ${what} Mêmes ${many}, même ordre.`),
      ),
      ...(played === undefined ? [] : [h("p", { class: "muted" }, tr(`You already played it: ${played}.`, `Tu l'as déjà jouée : ${played}.`))]),
      h(
        "div",
        { class: "actions" },
        button(rival ? tr("Accept the challenge", "Relever le défi") : tr("Play", "Jouer"), () => void playSeed({ seed, rival }), "primary"),
        button(tr("See all maps", "Voir toutes les cartes"), showPicker, "link"),
      ),
    ),
  );
  await useMap(target);
}

function render(): void {
  const overlay = $("overlay");
  const g = game;
  $("stage").classList.toggle("playing-streets", streetsScreen !== null);
  if (streetsScreen) {
    overlay.hidden = true;
    $("hud").hidden = true;
    if (view) view.drawingEnabled = view.pinEnabled = false;
    return;
  }
  overlay.hidden = g !== null && !(g.phase === "over" && endCardOpen);
  $("hud").hidden = g === null;
  if (!view) return;
  const shown = g?.phase === "over" ? replay : null;
  view.setPlaced(!g ? [] : shown ? placedItems(g, shown.at + 1, shown.at) : placedItems(g));
  view.setDraft(g?.draft ?? [], colorFor(g?.placements.length ?? 0));
  const cities = g?.mode === "cities";
  view.drawingEnabled = g?.phase === "drawing" && !cities;
  view.pinEnabled = g?.phase === "drawing" && cities;
  setHints(cities);
  if (!g) {
    view.setPins([]);
    view.setTruthPins([]);
    return view.setTruth([]);
  }

  const last = g.lastPlacement;
  // Real borders and cities stay hidden until the end, as they give away the neighbours. Easy and
  // normal show each one while its score is up.
  const revealed = shown
    ? [g.placements[shown.at]]
    : g.phase === "over"
      ? showTruth ? g.placements : []
      : g.level !== "hard" && g.phase === "reveal" && last ? [last] : [];
  if (cities) {
    const draft: Pin[] = g.pin ? [{ name: g.target(g.current!.id), at: g.pin, color: colorFor(g.placements.length), draft: true }] : [];
    view.setPins(shown ? placedPins(g, shown.at + 1, shown.at) : [...placedPins(g), ...draft]);
    view.setTruthPins(revealed.map((p) => truthPin(g, p, revealed.length === 1)));
    view.setTruth([]);
  } else {
    view.setPins([]);
    view.setTruthPins([]);
    view.setTruth(g.phase === "over" && !shown && showTruth ? g.order.map((r) => r.geometry) : revealed.map((p) => g.region(p.regionId).geometry));
  }

  const done = g.placements.length;
  $("map-name").textContent = g.level === "hard" ? g.title : `${g.title} · ${tr(`${g.level} mode`, `mode ${levelName(g.level)}`)}`;
  $("progress").textContent = `${Math.min(done + (g.phase === "drawing" ? 1 : 0), g.order.length)} / ${g.order.length}`;
  $("total").textContent = `${g.total} pts`;
  const seedButton = $("seed");
  seedButton.hidden = !g.seed;
  seedButton.replaceChildren(tr("Invite ", "Inviter "), h("code", {}, g.seed ?? ""));
  const prompt = $("prompt");
  if (g.phase === "drawing" && cities) {
    prompt.replaceChildren("Place ", h("strong", {}, g.target(g.current!.id)), h("span", { class: "muted" }, `, ${g.current!.name}`));
  } else if (g.phase === "drawing") prompt.replaceChildren(tr("Draw ", "Trace "), h("strong", {}, g.current!.name));
  else if (g.phase === "reveal") prompt.replaceChildren(h("strong", {}, g.target(last!.regionId)));
  else prompt.replaceChildren(h("strong", {}, shown ? tr("Replay", "Revoir") : tr("Finished", "Terminé")));

  $("tools").hidden = g.phase !== "drawing";
  for (const id of ["undo", "clear", "eraser"]) $(id).hidden = cities;
  $<HTMLButtonElement>("undo").disabled = g.strokes.length === 0;
  $<HTMLButtonElement>("clear").disabled = g.strokes.length === 0;
  $<HTMLButtonElement>("submit").disabled = cities ? !g.pin : g.draft.length === 0;

  const result = $("result");
  result.hidden = g.phase !== "reveal" && !shown;
  if (shown) result.replaceChildren(...replayCard(g, shown.at, shown.playing));
  else if (g.phase === "reveal" && last) {
    result.replaceChildren(
      resultCard(g, last),
      withKey(button(g.current ? nextOne(nouns(g.mode)[0]) : tr("See the results", "Voir les résultats"), next, "primary")),
    );
  }
  if (g.phase === "over") {
    if (endCardOpen) overlay.replaceChildren(endCard(g));
    $("results-button").hidden = endCardOpen || !!shown;
  } else {
    $("results-button").hidden = true;
  }
}

const HINTS = tr(
  {
    borders: {
      mouse: "Drag to draw · Shift-drag to erase · Scroll to zoom · Space-drag or right-drag to pan",
      touch: "Draw with one finger · Pinch to zoom · Two fingers to pan",
    },
    cities: { mouse: "Click to drop a pin · Drag to pan · Scroll to zoom", touch: "Tap to drop a pin · Drag to pan · Pinch to zoom" },
  },
  {
    borders: {
      mouse: "Glisse pour tracer · Maj-glisser pour gommer · Molette pour zoomer · Espace-glisser ou clic droit pour te déplacer",
      touch: "Trace avec un doigt · Pince pour zoomer · Deux doigts pour te déplacer",
    },
    cities: {
      mouse: "Clique pour poser une épingle · Glisse pour te déplacer · Molette pour zoomer",
      touch: "Touche pour poser une épingle · Glisse pour te déplacer · Pince pour zoomer",
    },
  },
);

function setHints(cities: boolean): void {
  const hints = HINTS[cities ? "cities" : "borders"];
  $("hint-mouse").textContent = hints.mouse;
  $("hint-touch").textContent = hints.touch;
}

/** index.html is written in English; in French, its texts are swapped here. */
function translatePage(): void {
  document.documentElement.lang = lang;
  const flag = $("lang");
  flag.textContent = tr("🇫🇷", "🇬🇧");
  flag.title = tr("Passer en français", "Switch to English");
  flag.setAttribute("aria-label", flag.title);
  if (lang !== "fr") return;
  const texts: [id: string, text: string | null, title: string | null][] = [
    ["menu", null, "Retour aux cartes (ta partie est sauvegardée)"],
    ["seed", null, "Copier un lien vers cette partie : tes amis qui l'ouvrent ont le même ordre"],
    ["undo", "Annuler", "Annuler la dernière boucle (Ctrl+Z)"],
    ["clear", "Effacer", "Effacer le dessin (Échap)"],
    ["eraser", "Gomme", "Gommer avec tes boucles au lieu de dessiner (E, ou Maj enfoncée)"],
    ["skip", "Passer", "Abandonner celui-ci : 0 point"],
    ["submit", "Valider", "Valider (Entrée)"],
    ["results-button", "Résultats", null],
    ["satellite", null, "Vue satellite"],
  ];
  for (const [id, text, title] of texts) {
    const el = $(id);
    // Keep the children after the text, such as the ⏎ key on Submit.
    if (text !== null) el.firstChild!.textContent = text;
    if (title !== null) el.title = title;
  }
  for (const [id, label] of [["zoom-in", "Zoomer"], ["zoom-out", "Dézoomer"], ["zoom-reset", "Réinitialiser le zoom"], ["satellite", "Vue satellite"]]) {
    $(id).setAttribute("aria-label", label);
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
$("lang").addEventListener("click", () => setLang(tr("fr", "en")));
$("satellite").addEventListener("click", () => setSatellite(localStorage.getItem(SATELLITE_KEY) !== "1"));
translatePage();
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
  } else if (e.key === "e" && game.phase === "drawing" && game.mode === "borders") {
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
const params = new URLSearchParams(location.search);
const linked = readChallenge(params);
const [streetsMap, streetsCode] = params.get(STREETS_PARAM)?.split(".") ?? [];
const streetsTarget = MAPS.find((m) => m.id === streetsMap && m.streets);
history.replaceState(null, "", location.pathname);
if (linked && !seedProblem(linked.seed)) void showChallenge(linked);
else if (streetsTarget && streetsCode) void showStreetsLink(streetsTarget, streetsCode);
else if (sessionStorage.getItem(SWITCHED_KEY)) {
  // Back from a language switch: reopen the map that was on screen, where a game in progress can resume.
  sessionStorage.removeItem(SWITCHED_KEY);
  showPicker();
  void pick(entry);
} else {
  showPicker();
  void useMap(entry);
}
