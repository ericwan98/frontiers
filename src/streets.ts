import type { Box } from "./geometry.ts";

/** One voie of the Paris street register, as scripts/build-paris-streets.mjs writes it. */
export interface Voie {
  /** Full name, e.g. "rue de Rivoli". */
  n: string;
  /** The distinctive part, e.g. "Rivoli": voies that share it are found together. */
  k: string;
  /** Arrondissements it runs through. */
  a: number[];
  /** Footprint area in square metres. */
  m2: number;
  /** Length in metres. */
  l: number;
  b: Box;
  /** Where the name comes from, shortened. */
  o?: string;
  /** Footprint as an SVG path in map units. */
  d: string;
}

export interface StreetsData {
  width: number;
  height: number;
  kmPerUnit: number;
  /** Street types such as "rue" or "quai", which players may type or leave out. */
  types: string[];
  voies: Voie[];
  /** Voies that have a code instead of a name ("voie A/1"): drawn, never asked for. */
  unnamed: string;
}

/** Every voie sharing a name: one answer finds them all. */
export interface StreetGroup {
  id: string;
  name: string;
  voies: Voie[];
  m2: number;
  metres: number;
}

export type Answer =
  | { kind: "found"; groups: StreetGroup[]; typo: boolean }
  | { kind: "ambiguous"; groups: StreetGroup[] }
  | { kind: "unknown" };

export interface Progress {
  names: number;
  voies: number;
  m2: number;
  metres: number;
  /** Share of each arrondissement's street area found, 1er first. */
  arrondissements: number[];
}

const ARTICLES = ["de la", "de l", "des", "du", "de", "d", "aux", "au", "a", "en", "la", "le", "les", "l"];
/** Shorter answers must be spelled exactly: one letter off would match too much. */
const TYPO_FROM = 5;

/** Lower case, no accents or punctuation, "st" spelled out: "Saint-Germain-l'Auxerrois" is "saint germain l auxerrois". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\bste?\b/g, (m) => (m === "st" ? "saint" : "sainte"));
}

/** True when one insertion, deletion, substitution or swap of two neighbours turns `a` into `b`. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) [a, b] = [b, a];
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
  if (a.slice(i + 1) === b.slice(i + 1)) return true;
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

const dropPrefix = (text: string, words: string[]) => {
  for (const w of words) if (text.startsWith(`${w} `)) return text.slice(w.length + 1);
  return text;
};

export class Streets {
  readonly data: StreetsData;
  readonly groups: StreetGroup[];
  readonly totalM2: number;
  readonly totalMetres: number;
  /** Street area of each arrondissement, 1er first. A voie in several counts a share in each. */
  readonly arrondissementM2: number[];
  private readonly byId = new Map<string, StreetGroup>();
  /** Normalized spellings, the distinctive name and the full one, to the groups they find. */
  private readonly keys = new Map<string, StreetGroup[]>();
  private readonly types: string[];

  constructor(data: StreetsData) {
    this.data = data;
    // Longest first, so "grande avenue" goes before "avenue".
    this.types = data.types.map(normalize).sort((a, b) => b.length - a.length);
    for (const v of data.voies) {
      const id = normalize(v.k);
      let group = this.byId.get(id);
      if (!group) {
        group = { id, name: v.k, voies: [], m2: 0, metres: 0 };
        this.byId.set(id, group);
      }
      group.voies.push(v);
      group.m2 += v.m2;
      group.metres += v.l;
    }
    this.groups = [...this.byId.values()];
    for (const g of this.groups) {
      for (const key of new Set([g.id, ...g.voies.map((v) => normalize(v.n))])) {
        const found = this.keys.get(key) ?? [];
        if (!found.includes(g)) found.push(g);
        this.keys.set(key, found);
      }
    }
    this.totalM2 = this.groups.reduce((s, g) => s + g.m2, 0);
    this.totalMetres = this.groups.reduce((s, g) => s + g.metres, 0);
    this.arrondissementM2 = this.shares(data.voies);
  }

  group(id: string): StreetGroup | undefined {
    return this.byId.get(id);
  }

  /** The group a voie name such as "Rivoli" belongs to: how found streets are saved. */
  groupOf(name: string): StreetGroup | undefined {
    return this.byId.get(normalize(name));
  }

  /** What an answer finds: the type and article are optional, and one wrong letter is forgiven. */
  match(input: string): Answer {
    const raw = normalize(input);
    if (!raw) return { kind: "unknown" };
    const untyped = dropPrefix(raw, this.types);
    const tries = [...new Set([raw, untyped, dropPrefix(untyped, ARTICLES), dropPrefix(raw, ARTICLES)])].filter(Boolean);
    const exact = new Set(tries.flatMap((t) => this.keys.get(t) ?? []));
    if (exact.size) return { kind: "found", groups: [...exact], typo: false };
    const close = new Set<StreetGroup>();
    for (const t of tries) {
      if (t.length < TYPO_FROM) continue;
      for (const [key, groups] of this.keys) if (withinOneEdit(t, key)) groups.forEach((g) => close.add(g));
    }
    if (close.size === 1) return { kind: "found", groups: [...close], typo: true };
    return close.size ? { kind: "ambiguous", groups: [...close] } : { kind: "unknown" };
  }

  progress(found: Iterable<StreetGroup>): Progress {
    const groups = [...found];
    const voies = groups.flatMap((g) => g.voies);
    const mine = this.shares(voies);
    return {
      names: groups.length,
      voies: voies.length,
      m2: groups.reduce((s, g) => s + g.m2, 0),
      metres: groups.reduce((s, g) => s + g.metres, 0),
      arrondissements: mine.map((m2, i) => (this.arrondissementM2[i] ? m2 / this.arrondissementM2[i] : 0)),
    };
  }

  private shares(voies: Voie[]): number[] {
    const out = Array<number>(20).fill(0);
    for (const v of voies) for (const a of v.a) if (a >= 1 && a <= 20) out[a - 1] += v.m2 / v.a.length;
    return out;
  }
}
