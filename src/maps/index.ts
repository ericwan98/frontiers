import type { GameMap } from "../game.ts";
import type { StreetsData } from "../streets.ts";

export interface MapEntry {
  id: string;
  name: string;
  /** Number of regions; test/game.test.ts checks it against the map file. */
  count: number;
  /** What a region is called: singular, plural. */
  noun: [string, string];
  question: string;
  /** Set on maps whose every region has a capital: they can also be played in cities mode. */
  cities?: { question: string };
  /** Set on maps that also have a name-the-streets mode. */
  streets?: { question: string; load: () => Promise<StreetsData> };
  load: () => Promise<GameMap>;
}

// JSON imports type their coordinates as number[][], looser than MultiPolygon.
const asMap = (module: { default: unknown }) => module.default as GameMap;

// Maps load on demand: together they weigh about 1.3 MB, and the Paris streets 1.8 MB more.
export const MAPS: MapEntry[] = [
  {
    id: "world",
    name: "World",
    count: 165,
    noun: ["country", "countries"],
    question: "How well do you know the world map?",
    cities: { question: "Can you find the world's capitals?" },
    load: () => import("./world.json").then(asMap),
  },
  {
    id: "europe",
    name: "Europe",
    count: 41,
    noun: ["country", "countries"],
    question: "How well do you know the borders of Europe?",
    cities: { question: "Can you find the capitals of Europe?" },
    load: () => import("./europe.json").then(asMap),
  },
  {
    id: "africa",
    name: "Africa",
    count: 49,
    noun: ["country", "countries"],
    question: "How well do you know the borders of Africa?",
    cities: { question: "Can you find the capitals of Africa?" },
    load: () => import("./africa.json").then(asMap),
  },
  {
    id: "south-america",
    name: "South America",
    count: 12,
    noun: ["country", "countries"],
    question: "How well do you know the borders of South America?",
    cities: { question: "Can you find the capitals of South America?" },
    load: () => import("./south-america.json").then(asMap),
  },
  {
    id: "us",
    name: "United States",
    count: 48,
    noun: ["state", "states"],
    question: "How well do you know the US states?",
    load: () => import("./us.json").then(asMap),
  },
  {
    id: "france",
    name: "France",
    count: 13,
    noun: ["region", "regions"],
    question: "How well do you know the regions of France?",
    load: () => import("./france.json").then(asMap),
  },
  {
    id: "paris",
    name: "Paris",
    count: 20,
    noun: ["arrondissement", "arrondissements"],
    question: "How well do you know the arrondissements of Paris?",
    streets: {
      question: "How many streets of Paris can you name?",
      load: () => import("./paris-streets.json").then((m) => m.default as StreetsData),
    },
    load: () => import("./paris.json").then(asMap),
  },
];
