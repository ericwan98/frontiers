// A seed names a game: the map, borders or cities, how many regions, a code that fixes their
// order, and the level. Two players on the same seed get the same regions in the same order.
import { shuffle, type Level, type Mode } from "./game.ts";

export interface Seed {
  mapId: string;
  mode: Mode;
  count: number;
  code: string;
  level: Level;
}

/** A seed without its code: what the player picked. */
export type Setup = Omit<Seed, "code">;

// No 0/O, 1/I/L: seeds get read out loud and retyped.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 5;

export function newSeed(setup: Setup, random: () => number = Math.random): Seed {
  const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join("");
  return { ...setup, code };
}

export const dayCode = (day: Date) =>
  [day.getFullYear(), day.getMonth() + 1, day.getDate()].map((n) => String(n).padStart(2, "0")).join("");

/** Today's game: the same for everyone on the same day, e.g. europe-10-20261118. */
export function dailySeed(setup: Setup, today = new Date()): Seed {
  return { ...setup, code: dayCode(today) };
}

/**
 * Days in a row with a daily game finished, on any map. Until today's is played, the streak
 * still counts up to yesterday.
 */
export function streak(playedSeeds: Iterable<string>, today = new Date()): number {
  const days = new Set([...playedSeeds].map((s) => parseSeed(s)?.code));
  const day = new Date(today);
  if (!days.has(dayCode(day))) day.setDate(day.getDate() - 1);
  let n = 0;
  for (; days.has(dayCode(day)); n++) day.setDate(day.getDate() - 1);
  return n;
}

/** Seed ending of each level. Normal was called easy before there were levels: its old seeds end in -easy. */
const LEVEL_SUFFIX: Record<Level, string> = { easy: "-guided", normal: "-normal", hard: "" };
const OLD_NORMAL_SUFFIX = "-easy";
// After the map id: europe-cities-10-K3F9X. Seeds from before cities have no mode, and are borders.
const CITIES_SUFFIX = "-cities";
const orderKey = ({ mapId, mode, count, code }: Seed) =>
  `${mapId}${mode === "cities" ? CITIES_SUFFIX : ""}-${count}-${code}`;
export const formatSeed = (seed: Seed) => orderKey(seed) + LEVEL_SUFFIX[seed.level];

/** True when two seeds name the same game: an old europe-10-K3F9X-easy is europe-10-K3F9X-normal. */
export function sameSeed(a: string, b: string): boolean {
  const [x, y] = [parseSeed(a), parseSeed(b)];
  return x && y ? formatSeed(x) === formatSeed(y) : a === b;
}

/** Reads a pasted seed, forgiving case and stray spaces; null if it isn't one. */
export function parseSeed(text: string): Seed | null {
  const match = /^([a-z]+(?:-[a-z]+)*)-(\d{1,3})-([a-z0-9]{1,16})(-easy|-normal|-guided)?$/i.exec(text.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const cities = name.endsWith(CITIES_SUFFIX);
  return {
    mapId: cities ? name.slice(0, -CITIES_SUFFIX.length) : name,
    mode: cities ? "cities" : "borders",
    count: Number(match[2]),
    code: match[3].toUpperCase(),
    level: levelOfSuffix(match[4]?.toLowerCase() ?? ""),
  };
}

function levelOfSuffix(suffix: string): Level {
  if (suffix === OLD_NORMAL_SUFFIX) return "normal";
  return (Object.keys(LEVEL_SUFFIX) as Level[]).find((l) => LEVEL_SUFFIX[l] === suffix) ?? "hard";
}

/**
 * The regions the seed plays, in order, the same at every level. Sorting first keeps it
 * independent of the map file's order.
 */
export function seededOrder(seed: Seed, regionIds: readonly string[]): string[] {
  return shuffle([...regionIds].sort(), seededRandom(orderKey(seed))).slice(0, seed.count);
}

// FNV-1a hash of the seed into mulberry32: small, fast, and the same in every browser.
function seededRandom(text: string): () => number {
  let state = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 0x01000193);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
