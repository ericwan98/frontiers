// A seed names a game: the map, how many regions, a code that fixes their order, and the mode.
// Two players on the same seed get the same regions in the same order.
import { shuffle } from "./game.ts";

export interface Seed {
  mapId: string;
  count: number;
  code: string;
  easy: boolean;
}

// No 0/O, 1/I/L: seeds get read out loud and retyped.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 5;

export function newSeed(mapId: string, count: number, easy: boolean, random: () => number = Math.random): Seed {
  const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join("");
  return { mapId, count, code, easy };
}

export const dayCode = (day: Date) =>
  [day.getFullYear(), day.getMonth() + 1, day.getDate()].map((n) => String(n).padStart(2, "0")).join("");

/** Today's game: the same for everyone on the same day, e.g. europe-10-20261118. */
export function dailySeed(mapId: string, count: number, easy: boolean, today = new Date()): Seed {
  return { mapId, count, code: dayCode(today), easy };
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

const EASY_SUFFIX = "-easy";
const orderKey = ({ mapId, count, code }: Seed) => `${mapId}-${count}-${code}`;
export const formatSeed = (seed: Seed) => orderKey(seed) + (seed.easy ? EASY_SUFFIX : "");

/** Reads a pasted seed, forgiving case and stray spaces; null if it isn't one. */
export function parseSeed(text: string): Seed | null {
  const match = /^([a-z]+(?:-[a-z]+)*)-(\d{1,3})-([a-z0-9]{1,16})(-easy)?$/i.exec(text.trim());
  if (!match) return null;
  return { mapId: match[1].toLowerCase(), count: Number(match[2]), code: match[3].toUpperCase(), easy: !!match[4] };
}

/**
 * The regions the seed plays, in order, the same in both modes. Sorting first keeps it
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
