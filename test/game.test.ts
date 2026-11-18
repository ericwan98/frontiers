import { describe, expect, it } from "vitest";
import { awards } from "../src/awards.ts";
import { Game, shuffle, type GameMap } from "../src/game.ts";
import { area, centroid, simplify, type MultiPolygon, type Ring } from "../src/geometry.ts";
import europe from "../src/maps/europe.json";
import { MAPS } from "../src/maps/index.ts";
import { score, square as tierSquare } from "../src/scoring.ts";
import { dailySeed, formatSeed, newSeed, parseSeed, seededOrder, streak } from "../src/seed.ts";
import { readChallenge, readPasted, shareText } from "../src/share.ts";

const square = (x: number, y: number, s: number): MultiPolygon => [
  [
    [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
      [x, y],
    ],
  ],
];
const loopOf = (x: number, y: number, s: number): Ring => square(x, y, s)[0][0].slice(0, -1);

// Two 10x10 countries side by side, 1 km per unit.
const tiny: GameMap = {
  id: "tiny",
  name: "Tiny",
  width: 30,
  height: 10,
  kmPerUnit: 1,
  land: [[[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]]],
  context: [],
  regions: [
    { id: "a", name: "A", geometry: square(0, 0, 10) },
    { id: "b", name: "B", geometry: square(10, 0, 10) },
  ],
};

describe("geometry", () => {
  it("measures area and centroid, holes included", () => {
    const withHole: MultiPolygon = [[square(0, 0, 10)[0][0], square(0, 0, 5)[0][0]]];
    expect(area(withHole)).toBe(75);
    expect(centroid(square(2, 4, 2))).toEqual([3, 5]);
  });

  it("simplifies a straight run to its ends", () => {
    expect(simplify([[0, 0], [1, 0.01], [2, 0], [3, 0]], 0.1)).toEqual([[0, 0], [3, 0]]);
  });
});

describe("score", () => {
  const scale = { width: 1000, kmPerUnit: 1 };

  it("gives full marks for the exact shape and nothing for an empty drawing", () => {
    expect(score(square(0, 0, 10), square(0, 0, 10), scale).points).toBe(100);
    expect(score([], square(0, 0, 10), scale)).toEqual({ points: 0, overlap: 0, distanceKm: null });
  });

  it("rewards being close even without overlap", () => {
    const near = score(square(10, 0, 10), square(0, 0, 10), scale);
    const far = score(square(500, 0, 10), square(0, 0, 10), scale);
    expect(near.overlap).toBe(0);
    expect(near.points).toBeGreaterThan(0);
    expect(far.points).toBe(0);
  });
});

describe("Game", () => {
  it("clips drawings to land and never overlaps an earlier country", () => {
    const game = new Game(tiny, ["a", "b"]);
    // Greedy A swallows everything, sea included.
    expect(game.addStroke({ ring: loopOf(-5, -5, 40), erase: false })).toBe(true);
    expect(area(game.draft)).toBe(200);
    game.submit();
    expect(game.phase).toBe("reveal");
    game.next();
    // Nothing left for B.
    expect(game.addStroke({ ring: loopOf(10, 0, 10), erase: false })).toBe(false);
    expect(game.submit()).toBeUndefined();
    game.skip();
    game.next();
    expect(game.phase).toBe("over");
  });

  it("subtracts with erase strokes and replays strokes on undo", () => {
    const game = new Game(tiny, ["a", "b"]);
    game.addStroke({ ring: loopOf(0, 0, 20), erase: false });
    game.addStroke({ ring: loopOf(10, 0, 10), erase: true });
    expect(area(game.draft)).toBe(100);
    game.undo();
    expect(area(game.draft)).toBe(200);
    const placement = game.submit()!;
    expect(placement.score!.points).toBeLessThan(100);
    expect(game.total).toBe(placement.score!.points);
  });

  it("resumes from a save", () => {
    const game = new Game(tiny, ["a", "b"]);
    game.addStroke({ ring: loopOf(0, 0, 10), erase: false });
    game.submit();
    const saved = JSON.parse(JSON.stringify(game.save()));
    const resumed = new Game(tiny, saved.order, { placements: saved.placements });
    expect(resumed.current?.id).toBe("b");
    expect(area(resumed.taken)).toBe(100);
  });
});

describe.each(MAPS)("$name map", (entry) => {
  it("matches the catalog, with every region once and inside the frame", async () => {
    const map = await entry.load();
    expect(map.id).toBe(entry.id);
    expect(map.regions).toHaveLength(entry.count);
    const ids = map.regions.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of map.regions) expect(area(r.geometry)).toBeGreaterThan(0);
  });
});

// Real areas, give or take generalisation and water: an equal-area projection keeps them.
it.each([
  ["us", "Texas", 660_000, 700_000],
  ["us", "Rhode Island", 2_500, 3_200],
  ["france", "Île-de-France", 11_700, 12_300],
  ["france", "Corsica", 8_400, 9_000],
  ["paris", "11th arrondissement", 3.5, 3.8],
  ["paris", "12th arrondissement", 15.9, 16.6],
  ["africa", "Egypt", 980_000, 1_020_000],
  ["south-america", "Uruguay", 170_000, 182_000],
  // 110m outlines are coarse, and France is only its European part.
  ["world", "France", 520_000, 580_000],
  ["world", "Brazil", 8_200_000, 8_800_000],
])("%s: %s has its real size", async (id, name, min, max) => {
  const map = await MAPS.find((m) => m.id === id)!.load();
  const km2 = area(map.regions.find((r) => r.name === name)!.geometry) * map.kmPerUnit ** 2;
  expect(km2).toBeGreaterThan(min);
  expect(km2).toBeLessThan(max);
});

describe("europe map", () => {
  const map = europe as GameMap;

  it("is equal-area: Luxembourg and France have their real size", () => {
    const km2 = (id: string) => area(map.regions.find((r) => r.id === id)!.geometry) * map.kmPerUnit ** 2;
    expect(km2("lu")).toBeGreaterThan(2400);
    expect(km2("lu")).toBeLessThan(2800);
    // Metropolitan France with Corsica: about 551 700 km².
    expect(km2("fr")).toBeGreaterThan(530_000);
    expect(km2("fr")).toBeLessThan(570_000);
  });

  it("puts Crimea in Ukraine", () => {
    const region = (id: string) => map.regions.find((r) => r.id === id)!.geometry;
    // Crimea's tip is the southernmost point of Ukraine and of no Russian polygon west of Kerch.
    const southernmost = (g: MultiPolygon) => Math.max(...g.flatMap((p) => p[0].map(([, y]) => y)));
    const crimeaTip = southernmost(region("ua"));
    expect(crimeaTip).toBeGreaterThan(610);
    const russianNearCrimea = region("ru").flatMap((p) => p[0]).filter(([x, y]) => x < 790 && y > 590);
    expect(russianNearCrimea).toEqual([]);
  });

  it("shuffles without losing countries", () => {
    const ids = map.regions.map((r) => r.id);
    expect(shuffle(ids).sort()).toEqual([...ids].sort());
  });
});

describe("seed", () => {
  const ids = (europe as GameMap).regions.map((r) => r.id);

  it("round-trips, forgiving case and spaces", () => {
    const seed = newSeed("europe", 10, false);
    expect(formatSeed(seed)).toMatch(/^europe-10-[2-9A-Z]{5}$/);
    expect(parseSeed(` ${formatSeed(seed).toLowerCase()} `)).toEqual(seed);
    const easy = newSeed("paris", 20, true);
    expect(formatSeed(easy)).toMatch(/^paris-20-[2-9A-Z]{5}-easy$/);
    expect(parseSeed(formatSeed(easy))).toEqual(easy);
    expect(parseSeed("europe 10 ABCDE")).toBeNull();
  });

  it("gives everyone the same order, whatever the order of the map file", () => {
    const seed = { mapId: "europe", count: 10, code: "K3F9X", easy: false };
    const order = seededOrder(seed, ids);
    expect(order).toHaveLength(10);
    expect(new Set(order).size).toBe(10);
    expect(seededOrder(seed, [...ids].reverse())).toEqual(order);
    expect(seededOrder({ ...seed, code: "K3F9Y" }, ids)).not.toEqual(order);
    expect(seededOrder({ ...seed, easy: true }, ids)).toEqual(order);
  });

  it("is saved with the game, with the mode", () => {
    const game = new Game(tiny, ["a", "b"], { seed: "tiny-2-ABCDE-easy", easy: true });
    const saved = JSON.parse(JSON.stringify(game.save()));
    const resumed = new Game(tiny, saved.order, saved);
    expect(resumed.seed).toBe("tiny-2-ABCDE-easy");
    expect(resumed.easy).toBe(true);
  });
});

describe("awards", () => {
  // Plays A with `drawing`, then skips B.
  const finished = (drawing: Ring) => {
    const game = new Game(tiny, ["a", "b"], { seed: "tiny-2-ABCDE" });
    game.addStroke({ ring: drawing, erase: false });
    game.submit();
    game.next();
    game.skip();
    game.next();
    return game;
  };
  const said = (game: Game) => awards(game).map((a) => `${a.emoji} ${a.says("Your")}`);

  it("calls out a drawing that eats its neighbour", () => {
    expect(said(finished(loopOf(0, 0, 20)))).toEqual(["🏴‍☠️ Your A took 100% of B", "🎈 Your A is 2.0× its real size"]);
  });

  it("praises a perfect drawing and shrinks a tiny one", () => {
    expect(said(finished(loopOf(0, 0, 10)))).toEqual(["🎯 Your A overlaps the real one by 100%"]);
    expect(said(finished(loopOf(0, 0, 3)))).toContain("🔬 Your A is 9% of its real size");
  });

  it("puts the worst blunder in the result", () => {
    globalThis.location = new URL("https://frontiers.example/") as unknown as Location;
    expect(shareText(finished(loopOf(0, 0, 20)), "squares")).toContain("\n🏴‍☠️ My A took 100% of B\n");
    expect(shareText(finished(loopOf(0, 0, 10)), "squares")).not.toContain("🎯");
  });
});

describe("sharing", () => {
  const seed = { mapId: "europe", count: 3, code: "K3F9X", easy: false };

  it("reads a challenge link with the sender's scores", () => {
    const link = "https://frontiers.example/?seed=europe-3-K3F9X&vs=72.x.100";
    expect(readPasted(link)).toEqual({ seed, rival: [72, null, 100] });
    expect(readPasted(" europe-3-k3f9x ")).toEqual({ seed, rival: null });
    expect(readPasted("https://frontiers.example/")).toBeNull();
  });

  it("drops scores that don't fit the seed", () => {
    const read = (vs: string) => readChallenge(new URLSearchParams({ seed: "europe-3-K3F9X", vs }))?.rival;
    expect(read("72.15")).toBeNull();
    expect(read("72.15.101")).toBeNull();
    expect(read("72.15.-1")).toBeNull();
  });

  it("keeps the rival's scores through a save", () => {
    const game = new Game(tiny, ["a", "b"], { seed: "tiny-2-ABCDE", rival: [50, null] });
    const resumed = new Game(tiny, ["a", "b"], JSON.parse(JSON.stringify(game.save())));
    expect(resumed.rival).toEqual([50, null]);
    expect(new Game(tiny, ["a", "b"], { rival: [50] }).rival).toBeNull();
  });

  it("writes a result with a square per region", () => {
    globalThis.location = new URL("https://frontiers.example/") as unknown as Location;
    const game = new Game(tiny, ["a", "b"], { seed: "tiny-2-ABCDE" });
    game.addStroke({ ring: loopOf(0, 0, 10), erase: false });
    game.submit();
    game.next();
    game.skip();
    expect(shareText(game, "squares").split("\n")).toEqual([
      "Frontiers · Tiny, 2 squares",
      "100 / 200",
      `${tierSquare(100)}${tierSquare(null)}`,
      "Beat me: https://frontiers.example/?seed=tiny-2-ABCDE&vs=100.x",
    ]);
  });

  it("names today's seed after the date", () => {
    expect(formatSeed(dailySeed("france", 10, false, new Date(2026, 10, 8)))).toBe("france-10-20261108");
  });

  it("reads seeds of maps with a hyphen in their id", () => {
    expect(parseSeed("south-america-12-K3F9X-easy")).toEqual({ mapId: "south-america", count: 12, code: "K3F9X", easy: true });
  });

  it("counts a streak of daily games across months, maps and modes", () => {
    const played = ["us-10-20261031", "europe-10-20261101-easy", "paris-10-K3F9X", "france-10-20261102"];
    expect(streak(played, new Date(2026, 10, 2))).toBe(3);
    // Today's not played yet: the streak holds until midnight.
    expect(streak(played, new Date(2026, 10, 3))).toBe(3);
    expect(streak(played, new Date(2026, 10, 4))).toBe(0);
  });
});
