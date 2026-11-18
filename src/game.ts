import { difference, intersection, loop, union, type MultiPolygon, type Ring } from "./geometry.ts";
import { score, type Score } from "./scoring.ts";

export interface Region {
  id: string;
  name: string;
  /** Map label when the name is too long, e.g. "11e". */
  short?: string;
  geometry: MultiPolygon;
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
  shape: MultiPolygon;
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

  constructor(
    map: GameMap,
    order: string[],
    {
      placements = [],
      seed = null,
      easy = false,
      rival = null,
    }: { placements?: Placement[]; seed?: string | null; easy?: boolean; rival?: Scores | null } = {},
  ) {
    const byId = new Map(map.regions.map((r) => [r.id, r]));
    this.map = map;
    this.seed = seed;
    this.easy = easy;
    this.rival = rival?.length === order.length ? rival : null;
    this.order = order.map((id) => {
      const region = byId.get(id);
      if (!region) throw new Error(`unknown region ${id}`);
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

  region(id: string): Region {
    return this.order.find((r) => r.id === id)!;
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
    this.strokes.pop();
    this.draft = this.strokes.reduce((draft, s) => {
      const shape = loop(s.ring);
      return s.erase ? difference(draft, shape) : union(draft, this.claimable(shape));
    }, [] as MultiPolygon);
  }

  clear(): void {
    this.strokes = [];
    this.draft = [];
  }

  submit(): Placement | undefined {
    const region = this.current;
    if (this.phase !== "drawing" || !region || this.draft.length === 0) return undefined;
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
