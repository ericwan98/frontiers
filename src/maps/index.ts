import type { GameMap } from "../game.ts";
import { lang, tr } from "../i18n.ts";
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
  /** URL of the map's satellite image, from `npm run satellite`; fetched only when the player turns it on. */
  satellite?: string;
  load: () => Promise<GameMap>;
}

// JSON imports type their coordinates as number[][], looser than MultiPolygon.
const asMap = (module: { default: unknown }) => module.default as GameMap;

type FrNames = Record<string, Record<string, { name: string; capital?: string }>>;

/** In French, the map with French region and capital names from fr-names.json. Saves use ids, never names. */
async function localized(map: GameMap): Promise<GameMap> {
  if (lang !== "fr") return map;
  const names = ((await import("./fr-names.json")).default as FrNames)[map.id] ?? {};
  return {
    ...map,
    name: MAPS.find((e) => e.id === map.id)?.name ?? map.name,
    regions: map.regions.map((r) => {
      const fr = names[r.id];
      if (!fr) return r;
      return { ...r, name: fr.name, ...(r.capital && fr.capital ? { capital: { ...r.capital, name: fr.capital } } : {}) };
    }),
  };
}

// Maps load on demand: together they weigh about 1.3 MB, and the Paris streets 1.8 MB more.
export const MAPS: MapEntry[] = [
  {
    id: "world",
    name: tr("World", "Monde"),
    count: 165,
    noun: tr(["country", "countries"], ["pays", "pays"]),
    question: tr("How well do you know the world map?", "Connais-tu bien la carte du monde ?"),
    cities: { question: tr("Can you find the world's capitals?", "Sauras-tu placer les capitales du monde ?") },
    satellite: new URL("./satellite/world.webp", import.meta.url).href,
    load: () => import("./world.json").then(asMap).then(localized),
  },
  {
    id: "europe",
    name: "Europe",
    count: 41,
    noun: tr(["country", "countries"], ["pays", "pays"]),
    question: tr("How well do you know the borders of Europe?", "Connais-tu bien les frontières de l'Europe ?"),
    cities: { question: tr("Can you find the capitals of Europe?", "Sauras-tu placer les capitales de l'Europe ?") },
    satellite: new URL("./satellite/europe.webp", import.meta.url).href,
    load: () => import("./europe.json").then(asMap).then(localized),
  },
  {
    id: "africa",
    name: tr("Africa", "Afrique"),
    count: 49,
    noun: tr(["country", "countries"], ["pays", "pays"]),
    question: tr("How well do you know the borders of Africa?", "Connais-tu bien les frontières de l'Afrique ?"),
    cities: { question: tr("Can you find the capitals of Africa?", "Sauras-tu placer les capitales de l'Afrique ?") },
    satellite: new URL("./satellite/africa.webp", import.meta.url).href,
    load: () => import("./africa.json").then(asMap).then(localized),
  },
  {
    id: "south-america",
    name: tr("South America", "Amérique du Sud"),
    count: 12,
    noun: tr(["country", "countries"], ["pays", "pays"]),
    question: tr("How well do you know the borders of South America?", "Connais-tu bien les frontières de l'Amérique du Sud ?"),
    cities: { question: tr("Can you find the capitals of South America?", "Sauras-tu placer les capitales de l'Amérique du Sud ?") },
    satellite: new URL("./satellite/south-america.webp", import.meta.url).href,
    load: () => import("./south-america.json").then(asMap).then(localized),
  },
  {
    id: "us",
    name: tr("United States", "États-Unis"),
    count: 48,
    noun: tr(["state", "states"], ["État", "États"]),
    question: tr("How well do you know the US states?", "Connais-tu bien les États américains ?"),
    satellite: new URL("./satellite/us.webp", import.meta.url).href,
    load: () => import("./us.json").then(asMap).then(localized),
  },
  {
    id: "france",
    name: "France",
    count: 13,
    noun: tr(["region", "regions"], ["région", "régions"]),
    question: tr("How well do you know the regions of France?", "Connais-tu bien les régions de France ?"),
    satellite: new URL("./satellite/france.webp", import.meta.url).href,
    load: () => import("./france.json").then(asMap).then(localized),
  },
  {
    id: "paris",
    name: "Paris",
    count: 20,
    noun: ["arrondissement", "arrondissements"],
    question: tr("How well do you know the arrondissements of Paris?", "Connais-tu bien les arrondissements de Paris ?"),
    streets: {
      question: tr("How many streets of Paris can you name?", "Combien de rues de Paris sauras-tu nommer ?"),
      load: () => import("./paris-streets.json").then((m) => m.default as StreetsData),
    },
    load: () => import("./paris.json").then(asMap).then(localized),
  },
];
