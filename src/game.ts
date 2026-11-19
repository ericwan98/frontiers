import { difference, intersection, loop, union, type MultiPolygon, type Pair, type Ring } from "./geometry.ts";
import { pinScore, score, type Score } from "./scoring.ts";

/** Draw each region's borders, or drop a pin on its capital. */
export type Mode = "borders" | "cities";

export interface City {
  name: string;
  at: Pair;
}

export interface Region {
  id: string;
  name: string;
  /** Map label when the name is too long, e.g. "11e". */
  short?: string;
  geometry: MultiPolygon;
  /** Countries have one; maps where every region has one can be played in cities mode. */
  capital?: City;
}

/** A map to play, in projected units (see scripts/build-*.mjs). */
export interface GameMap {
  id: string;
  name: string;
  width: number;
  height: number;
  kmPerUnit: number;
  /** Union of the regions in play: drawings are clipped to it. */
  land: MultiPolygon;
  /** Neighbouring land, drawn for context, never in play. */
  context: MultiPolygon;
  /** Rivers and canals drawn over the land as landmarks; the regions still cover them. */
  water?: MultiPolygon;
  regions: Region[];
}

export interface Stroke {
  ring: Ring;
  erase: boolean;
}

export interface Placement {
  regionId: string;
  /** Empty in cities mode. */
  shape: MultiPolygon;
  /** Where the pin went, in cities mode; absent when skipped. */
  pin?: Pair;
  /** null when the region was skipped. */
  score: Score | null;
}

export type Phase = "drawing" | "reveal" | "over";

/** Points per region in game order; null where it was skipped. */
export type Scores = (number | null)[];

export interface SavedGame {
  mapId: string;
  /** Missing on games saved before seeds existed. */
  seed?: string;
  /** Missing on games saved before cities mode. */
  mode?: Mode;
  easy?: boolean;
  /** Scores of the friend whose link started this game. */
  rival?: Scores;
  order: string[];
  placements: Placement[];
}

export class Game {
  readonly map: GameMap;
  /** Shareable name of this game's order and mode, see seed.ts. */
  readonly seed: string | null;
  readonly mode: Mode;
  /** Easy mode shows each region's real border right after it is drawn. */
  readonly easy: boolean;
  /** Scores of the friend whose link started this game, to compare with. */
  readonly rival: Scores | null;
  readonly order: Region[];
  readonly placements: Placement[] = [];
  phase: Phase = "drawing";
  /** Everything already claimed: a new drawing never overlaps it. */
  taken: MultiPolygon = [];
  strokes: Stroke[] = [];
  draft: MultiPolygon = [];
  /** The pin about to be submitted, in cities mode. */
  pin: Pair | null = null;

  constructor(
    map: GameMap,
    order: string[],
    {
      placements = [],
      seed = null,
      mode = "borders",
      easy = false,
      rival = null,
    }: { placements?: Placement[]; seed?: string | null; mode?: Mode; easy?: boolean; rival?: Scores | null } = {},
  ) {
    const byId = new Map(map.regions.map((r) => [r.id, r]));
    this.map = map;
    this.seed = seed;
    this.mode = mode;
    this.easy = easy;
    this.rival = rival?.length === order.length ? rival : null;
    this.order = order.map((id) => {
      const region = byId.get(id);
      if (!region) throw new Error(`unknown region ${id}`);
      if (mode === "cities" && !region.capital) throw new Error(`${id} has no capital`);
      return region;
    });
    for (const p of placements) this.place(p);
    if (this.placements.length === this.order.length) this.phase = "over";
  }

  get current(): Region | undefined {
    return this.order[this.placements.length];
  }

  get lastPlacement(): Placement | undefined {
    return this.placements.at(-1);
  }

  get total(): number {
    return this.placements.reduce((sum, p) => sum + (p.score?.points ?? 0), 0);
  }

  get scores(): Scores {
    return this.placements.map((p) => p.score?.points ?? null);
  }

  /** "Europe", or "Europe capitals" in cities mode. */
  get title(): string {
    return this.mode === "cities" ? `${this.map.name} capitals` : this.map.name;
  }

  region(id: string): Region {
    return this.order.find((r) => r.id === id)!;
  }

  /** What the player is asked to place: the region, or its capital in cities mode. */
  target(id: string): string {
    const region = this.region(id);
    return this.mode === "cities" ? region.capital!.name : region.name;
  }

  /** Puts the pin down, or moves it; false outside cities mode or between turns. */
  drop(at: Pair): boolean {
    if (this.phase !== "drawing" || this.mode !== "cities") return false;
    this.pin = at;
    return true;
  }

  /** Adds a stroke to the draft; false when it claimed nothing new (sea, or land already taken). */
  addStroke(stroke: Stroke): boolean {
    if (this.phase !== "drawing") return false;
    const shape = loop(stroke.ring);
    if (stroke.erase) {
      this.draft = difference(this.draft, shape);
    } else {
      const claimable = this.claimable(shape);
      if (claimable.length === 0) return false;
      this.draft = union(this.draft, claimable);
    }
    this.strokes.push(stroke);
    return true;
  }

  undo(): void {
    this.pin = null;
    this.strokes.pop();
    this.draft = this.strokes.reduce((draft, s) => {
      const shape = loop(s.ring);
      return s.erase ? difference(draft, shape) : union(draft, this.claimable(shape));
    }, [] as MultiPolygon);
  }

  clear(): void {
    this.strokes = [];
    this.draft = [];
    this.pin = null;
  }

  submit(): Placement | undefined {
    const region = this.current;
    if (this.phase !== "drawing" || !region) return undefined;
    if (this.mode === "cities") {
      if (!this.pin) return undefined;
      return this.commit({ regionId: region.id, shape: [], pin: this.pin, score: pinScore(this.pin, region.capital!.at, this.map) });
    }
    if (this.draft.length === 0) return undefined;
    return this.commit({
      regionId: region.id,
      shape: this.draft,
      score: score(this.draft, region.geometry, this.map),
    });
  }

  skip(): Placement | undefined {
    const region = this.current;
    if (this.phase !== "drawing" || !region) return undefined;
    return this.commit({ regionId: region.id, shape: [], score: null });
  }

  next(): void {
    if (this.phase === "reveal") this.phase = this.current ? "drawing" : "over";
  }

  save(): SavedGame {
    return {
      mapId: this.map.id,
      ...(this.seed ? { seed: this.seed } : {}),
      mode: this.mode,
      easy: this.easy,
      ...(this.rival ? { rival: this.rival } : {}),
      order: this.order.map((r) => r.id),
      placements: this.placements,
    };
  }

  private commit(placement: Placement): Placement {
    this.place(placement);
    this.clear();
    this.phase = "reveal";
    return placement;
  }

  private place(placement: Placement): void {
    this.placements.push(placement);
    if (placement.shape.length) this.taken = union(this.taken, placement.shape);
  }

  private claimable(shape: MultiPolygon): MultiPolygon {
    return difference(intersection(shape, this.map.land), this.taken);
  }
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
