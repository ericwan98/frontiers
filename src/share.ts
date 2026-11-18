// What players send each other. A link replays the same seed and can carry the sender's
// scores, so whoever opens it gets compared region by region.
import { awards } from "./awards.ts";
import type { Game, Scores } from "./game.ts";
import { MAX_POINTS, square } from "./scoring.ts";
import { parseSeed, type Seed } from "./seed.ts";

export interface Challenge {
  seed: Seed;
  rival: Scores | null;
}

const SKIPPED = "x";
const SQUARES_PER_ROW = 10;

export function challengeUrl(seed: string, scores?: Scores): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("seed", seed);
  if (scores) url.searchParams.set("vs", scores.map((s) => s ?? SKIPPED).join("."));
  return url.toString();
}

/** Reads a link's query string; null without a well-formed seed. Bad scores are dropped. */
export function readChallenge(params: URLSearchParams): Challenge | null {
  const seed = parseSeed(params.get("seed") ?? "");
  if (!seed) return null;
  const parts = params.get("vs")?.split(".") ?? [];
  const rival = parts.map((p) => (p === SKIPPED ? null : /^\d{1,3}$/.test(p) ? Number(p) : NaN));
  const valid = rival.length === seed.count && rival.every((p) => p === null || p <= MAX_POINTS);
  return { seed, rival: valid ? rival : null };
}

/** Reads a pasted link or bare seed. */
export function readPasted(text: string): Challenge | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return readChallenge(new URLSearchParams({ seed: trimmed }));
  try {
    return readChallenge(new URL(trimmed).searchParams);
  } catch {
    return null;
  }
}

export const sum = (scores: Scores) => scores.reduce<number>((total, p) => total + (p ?? 0), 0);

/** A few lines for a group chat, Wordle style. */
export function shareText(g: Game, noun: string): string {
  const squares = g.scores.map(square);
  const rows = [];
  for (let i = 0; i < squares.length; i += SQUARES_PER_ROW) rows.push(squares.slice(i, i + SQUARES_PER_ROW).join(""));
  // A good shot is less fun to read about than a blunder.
  const blunder = g.phase === "over" ? awards(g).find((a) => a.title !== "Sniper") : undefined;
  return [
    `Frontiers · ${g.map.name}, ${g.order.length} ${noun}${g.easy ? " (easy)" : ""}`,
    `${g.total} / ${g.order.length * MAX_POINTS}`,
    ...rows,
    ...(blunder ? [`${blunder.emoji} ${blunder.says("My")}`] : []),
    ...(g.seed ? [`Beat me: ${challengeUrl(g.seed, g.scores)}`] : []),
  ].join("\n");
}
