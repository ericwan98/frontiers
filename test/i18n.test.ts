import { describe, expect, it } from "vitest";
import names from "../src/maps/fr-names.json";
import { MAPS } from "../src/maps/index.ts";

const fr = names as Record<string, Record<string, { name: string; capital?: string }>>;

describe("French names", () => {
  it.each(MAPS.map((m) => [m.id, m] as const))("cover every region and capital of %s", async (_, entry) => {
    const map = await entry.load();
    const missing = map.regions.filter((r) => !fr[map.id]?.[r.id]?.name || (r.capital && !fr[map.id][r.id].capital));
    expect(missing.map((r) => r.id)).toEqual([]);
  });
});
