import { describe, expect, it } from "vitest";
import { awards } from "../src/awards.ts";
import { Game, levelOf, shuffle, type GameMap } from "../src/game.ts";
import { area, centroid, contains, simplify, type MultiPolygon, type Ring } from "../src/geometry.ts";
import europe from "../src/maps/europe.json";
import { MAPS } from "../src/maps/index.ts";
import { pinScore, score, square as tierSquare } from "../src/scoring.ts";
import { dailySeed, formatSeed, newSeed, parseSeed, sameSeed, seededOrder, streak } from "../src/seed.ts";
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
    { id: "a", name: "A", geometry: square(0, 0, 10), capital: { name: "Ay", at: [5, 5] } },
    { id: "b", name: "B", geometry: square(10, 0, 10), capital: { name: "Bee", at: [15, 5] } },
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

describe("pinScore", () => {
  const map = { width: 1000, kmPerUnit: 5 };

  it("gives full marks within the bullseye, then less the farther off", () => {
    expect(pinScore([500, 500], [500, 500], map)).toEqual({ points: 100, distanceKm: 0 });
    expect(pinScore([504, 500], [500, 500], map).points).toBe(100);
    const near = pinScore([530, 500], [500, 500], map);
    const far = pinScore([700, 500], [500, 500], map);
    expect(near.distanceKm).toBe(150);
    expect(near.points).toBeLessThan(100);
    expect(far.points).toBeLessThan(near.points);
    expect(pinScore([1000, 0], [0, 1000], map).points).toBe(0);
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

  it("in easy mode, clips the next drawings to the real country, not to the drawing", () => {
    const game = new Game(tiny, ["a", "b"], { level: "easy" });
    game.addStroke({ ring: loopOf(-5, -5, 40), erase: false });
    expect(game.submit()!.score!.points).toBeLessThan(100);
    game.next();
    // The greedy drawing took B's land, but only the real A is taken.
    expect(area(game.taken)).toBe(100);
    expect(game.addStroke({ ring: loopOf(10, 0, 10), erase: false })).toBe(true);
    expect(game.submit()!.score!.points).toBe(100);
    const saved = JSON.parse(JSON.stringify(game.save()));
    expect(saved.placements[0].shape).not.toEqual(tiny.regions[0].geometry);
    const resumed = new Game(tiny, saved.order, { ...saved, level: levelOf(saved) });
    expect(area(resumed.taken)).toBe(200);
  });

  it("in easy mode, counts a skipped country as its real self", () => {
    const game = new Game(tiny, ["a", "b"], { level: "easy" });
    game.skip();
    game.next();
    expect(game.addStroke({ ring: loopOf(0, 0, 10), erase: false })).toBe(false);
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

  it("plays capitals with pins, blind to the borders", () => {
    const game = new Game(tiny, ["a", "b"], { mode: "cities" });
    expect(game.title).toBe("Tiny capitals");
    expect(game.target("a")).toBe("Ay");
    expect(game.submit()).toBeUndefined();
    expect(game.drop([9, 9])).toBe(true);
    expect(game.drop([5, 5])).toBe(true);
    const placed = game.submit()!;
    expect(placed).toMatchObject({ regionId: "a", pin: [5, 5], shape: [], score: { points: 100, distanceKm: 0 } });
    expect(game.drop([1, 1])).toBe(false);
    game.next();
    expect(game.pin).toBeNull();
    const saved = JSON.parse(JSON.stringify(game.save()));
    const resumed = new Game(tiny, saved.order, saved);
    expect(resumed.mode).toBe("cities");
    expect(resumed.placements[0].pin).toEqual([5, 5]);
  });

  it("refuses capitals mode on a map without capitals", () => {
    const bare = { ...tiny, regions: tiny.regions.map(({ capital: _, ...r }) => r) };
    expect(() => new Game(bare, ["a"], { mode: "cities" })).toThrow("a has no capital");
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

  it(entry.cities ? "has a capital for every region, inside the frame" : "has no capitals mode", async () => {
    const map = await entry.load();
    expect(map.regions.every((r) => r.capital)).toBe(!!entry.cities);
    for (const { capital } of map.regions) {
      if (!capital) continue;
      const [x, y] = capital.at;
      expect(x >= 0 && x <= map.width && y >= 0 && y <= map.height, capital.name).toBe(true);
    }
  });
});

it("puts capitals in their country", async () => {
  const map = await MAPS.find((m) => m.id === "europe")!.load();
  const capitalOf = (name: string) => map.regions.find((r) => r.name === name)!.capital!;
  expect(capitalOf("France").name).toBe("Paris");
  expect(capitalOf("Netherlands").name).toBe("Amsterdam");
  expect(contains(map.regions.find((r) => r.name === "Germany")!.geometry, capitalOf("Germany").at)).toBe(true);
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
    const seed = newSeed({ mapId: "europe", count: 10, level: "hard", mode: "borders" });
    expect(formatSeed(seed)).toMatch(/^europe-10-[2-9A-Z]{5}$/);
    expect(parseSeed(` ${formatSeed(seed).toLowerCase()} `)).toEqual(seed);
    const easy = newSeed({ mapId: "paris", count: 20, level: "easy", mode: "borders" });
    expect(formatSeed(easy)).toMatch(/^paris-20-[2-9A-Z]{5}-guided$/);
    expect(parseSeed(formatSeed(easy))).toEqual(easy);
    const normal = newSeed({ mapId: "paris", count: 20, level: "normal", mode: "borders" });
    expect(formatSeed(normal)).toMatch(/^paris-20-[2-9A-Z]{5}-normal$/);
    expect(parseSeed(formatSeed(normal))).toEqual(normal);
    expect(parseSeed("europe 10 ABCDE")).toBeNull();
    const cities = newSeed({ mapId: "south-america", count: 12, level: "normal", mode: "cities" });
    expect(formatSeed(cities)).toMatch(/^south-america-cities-12-[2-9A-Z]{5}-normal$/);
    expect(parseSeed(formatSeed(cities))).toEqual(cities);
  });

  it("gives everyone the same order, whatever the order of the map file", () => {
    const seed = { mapId: "europe", count: 10, code: "K3F9X", level: "hard" as const, mode: "borders" as const };
    const order = seededOrder(seed, ids);
    expect(order).toHaveLength(10);
    expect(new Set(order).size).toBe(10);
    expect(seededOrder(seed, [...ids].reverse())).toEqual(order);
    expect(seededOrder({ ...seed, code: "K3F9Y" }, ids)).not.toEqual(order);
    expect(seededOrder({ ...seed, level: "easy" }, ids)).toEqual(order);
    expect(seededOrder({ ...seed, level: "normal" }, ids)).toEqual(order);
    // Capitals of the day aren't the countries of the day.
    expect(seededOrder({ ...seed, mode: "cities" }, ids)).not.toEqual(order);
  });

  it("is saved with the game, with the mode", () => {
    const game = new Game(tiny, ["a", "b"], { seed: "tiny-2-ABCDE-guided", level: "easy" });
    const saved = JSON.parse(JSON.stringify(game.save()));
    const resumed = new Game(tiny, saved.order, { ...saved, level: levelOf(saved) });
    expect(resumed.seed).toBe("tiny-2-ABCDE-guided");
    expect(resumed.level).toBe("easy");
  });

  it("reads seeds and games from before levels: easy then is normal now", () => {
    expect(parseSeed("europe-10-K3F9X-easy")?.level).toBe("normal");
    expect(parseSeed("europe-10-K3F9X")?.level).toBe("hard");
    expect(sameSeed("europe-10-K3F9X-easy", "europe-10-K3F9X-normal")).toBe(true);
    expect(sameSeed("europe-10-K3F9X-easy", "europe-10-K3F9X-guided")).toBe(false);
    expect(sameSeed("europe-10-K3F9X", "europe-10-K3F9X-normal")).toBe(false);
    const order = ["a", "b"];
    expect(levelOf({ mapId: "tiny", easy: true, order, placements: [] })).toBe("normal");
    expect(levelOf({ mapId: "tiny", easy: false, order, placements: [] })).toBe("hard");
    expect(levelOf({ mapId: "tiny", order, placements: [] })).toBe("hard");
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

  describe("capitals", () => {
    const pinned = (...pins: [number, number][]) => {
      const game = new Game(tiny, ["a", "b"], { seed: "tiny-cities-2-ABCDE", mode: "cities" });
      for (const pin of pins) {
        game.drop(pin);
        game.submit();
        game.next();
      }
      return game;
    };

    it("calls out a capital in the sea or the wrong country", () => {
      expect(said(pinned([5, 5], [25, 5]))).toEqual([
        "🌊 Your Bee is underwater",
        "🧭 Your Bee is 10 km from home",
        "🎯 Your Ay is spot on",
      ]);
      expect(said(pinned([15, 5], [15, 5]))).toEqual([
        "🛂 Your Ay is in B",
        "🧭 Your Ay is 10 km from home",
        "🎯 Your Bee is spot on",
      ]);
    });

    it("leaves the bullseye out of the result", () => {
      globalThis.location = new URL("https://frontiers.example/") as unknown as Location;
      const lines = shareText(pinned([5, 5], [25, 5]), "capitals").split("\n");
      expect(lines[0]).toBe("Frontiers · Tiny capitals, 2 capitals");
      expect(lines).toContain("🌊 My Bee is underwater");
      expect(lines.join("\n")).not.toContain("🎯");
    });
  });
});

describe("sharing", () => {
  const seed = { mapId: "europe", count: 3, code: "K3F9X", level: "hard" as const, mode: "borders" as const };

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
    expect(formatSeed(dailySeed({ mapId: "france", count: 10, level: "hard", mode: "borders" }, new Date(2026, 10, 8)))).toBe(
      "france-10-20261108",
    );
    expect(formatSeed(dailySeed({ mapId: "europe", count: 10, level: "hard", mode: "cities" }, new Date(2026, 10, 8)))).toBe(
      "europe-cities-10-20261108",
    );
  });

  it("reads seeds of maps with a hyphen in their id", () => {
    expect(parseSeed("south-america-12-K3F9X-easy")).toEqual({
      mapId: "south-america",
      count: 12,
      code: "K3F9X",
      level: "normal",
      mode: "borders",
    });
  });

  it("counts a streak of daily games across months, maps and modes", () => {
    const played = ["us-10-20261031", "europe-cities-10-20261101-easy", "paris-10-K3F9X", "france-10-20261102"];
    expect(streak(played, new Date(2026, 10, 2))).toBe(3);
    // Today's not played yet: the streak holds until midnight.
    expect(streak(played, new Date(2026, 10, 3))).toBe(3);
    expect(streak(played, new Date(2026, 10, 4))).toBe(0);
  });
});
