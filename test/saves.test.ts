// Players keep weeks of street finds in their browser. These tests pin what those saves rely on:
// if one fails, the change would lose or alter someone's progress. Don't update them to pass.
import { beforeEach, describe, expect, it } from "vitest";
import data from "../src/maps/paris-streets.json";
import { packNames, Streets, unpackNames, type StreetsData } from "../src/streets.ts";

const streets = new Streets(data as StreetsData);
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage;
const { addFound, loadFound } = await import("../src/streets-screen.ts");

async function sha256(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The key and format every save since the first streets release uses. */
const KEY = "frontiers:paris-streets:found";

describe("Paris street saves", () => {
  beforeEach(() => store.clear());

  it("are read from the same key, in the same format", () => {
    store.set(KEY, JSON.stringify(["Rivoli", "Bercy", "Périphérique"]));
    expect(loadFound("paris")).toEqual(["Rivoli", "Bercy", "Périphérique"]);
  });

  it("still count every name ever saved: names can be added to the data, never lost", () => {
    // Saves hold names from `order`, which only grows; each must still find its streets.
    const lost = data.order.filter((name) => !streets.groupOf(name));
    expect(lost).toEqual([]);
  });

  it("keep the first 5,401 names of the order as they were", async () => {
    expect(await sha256(data.order.slice(0, 5401).join("\n"))).toBe(
      "818f717d04b1bb08b3bf0d0f27db3e76fe503c8d39ac40a7fd328d0e5391deff",
    );
  });

  it("group the first 5,401 names as they were: a merge would lower counts, a split raise them", async () => {
    // Each name stands for the first name of its group in `order`, so ids may change but not who is with whom.
    const first = new Map<unknown, number>();
    const groups = data.order.slice(0, 5401).map((name, i) => {
      const g = streets.groupOf(name);
      if (!first.has(g)) first.set(g, i);
      return first.get(g);
    });
    expect(await sha256(groups.join(","))).toBe("63b03f601688e35b42ff60247b69515fd48d534a0ed663146273f413154ff9e6");
  });

  it("never drop a saved name, even one the data doesn't know", () => {
    store.set(KEY, JSON.stringify(["Rue Disparue", "Rivoli"]));
    addFound("paris", ["Bercy"]);
    expect(loadFound("paris")).toEqual(["Rue Disparue", "Rivoli", "Bercy"]);
  });

  it("open progress links made on 2026-11-19", async () => {
    expect(await unpackNames(data.order, "1Y2CgFDRQbMIoGIyAA12AcWDcwcAAAA")).toEqual(["Bercy", "Périphérique", "Rivoli"]);
    const names = new Set(["Bercy", "Périphérique", "Rivoli"]);
    expect(await packNames(data.order, (n) => names.has(n))).toBe("1Y2CgFDRQbMIoGIyAA12AcWDcwcAAAA");
  });
});
