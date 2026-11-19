import { describe, expect, it } from "vitest";
import paris from "../src/maps/paris.json";
import data from "../src/maps/paris-streets.json";
import { normalize, Streets, withinOneEdit, type StreetsData } from "../src/streets.ts";

const streets = new Streets(data as StreetsData);
const found = (input: string) => {
  const answer = streets.match(input);
  return answer.kind === "found" ? answer.groups.map((g) => g.name).sort() : answer.kind;
};

describe("Paris streets", () => {
  it("has every named voie, inside the Paris map", () => {
    expect(data.voies.length).toBeGreaterThan(6000);
    expect(streets.groups.length).toBeGreaterThan(5000);
    expect(data.width).toBe(paris.width);
    expect(data.height).toBe(paris.height);
    expect(data.kmPerUnit).toBe(paris.kmPerUnit);
    for (const v of data.voies) {
      const [x0, y0, x1, y1] = v.b;
      expect(x0 >= 0 && y0 >= 0 && x1 <= data.width && y1 <= data.height, v.n).toBe(true);
      expect(v.m2, v.n).toBeGreaterThan(0);
    }
    // Paris has about 28 km² of public roads.
    expect(streets.totalM2 / 1e6).toBeGreaterThan(25);
    expect(streets.totalM2 / 1e6).toBeLessThan(30);
  });

  it("normalizes accents, punctuation and saints", () => {
    expect(normalize("Saint-Germain-l'Auxerrois")).toBe("saint germain l auxerrois");
    expect(normalize("St Germain des Prés")).toBe("saint germain des pres");
    expect(normalize("Ste-Marthe")).toBe("sainte marthe");
    expect(normalize("Cœur")).toBe("coeur");
    expect(normalize("Deuxième D.B.")).toBe("deuxieme db");
  });

  it("forgives one letter", () => {
    expect(withinOneEdit("rivoli", "rivoli")).toBe(true);
    expect(withinOneEdit("rivoli", "rivili")).toBe(true);
    expect(withinOneEdit("rivoli", "rivol")).toBe(true);
    expect(withinOneEdit("rivoli", "rivolli")).toBe(true);
    expect(withinOneEdit("rivoli", "irvoli")).toBe(true);
    expect(withinOneEdit("rivoli", "rvioil")).toBe(false);
    expect(withinOneEdit("rivoli", "riv")).toBe(false);
  });

  it("finds a name with or without its type and article", () => {
    expect(found("rivoli")).toEqual(["Rivoli"]);
    expect(found("Rue de Rivoli")).toEqual(["Rivoli"]);
    expect(found("rue rivoli")).toEqual(["Rivoli"]);
    expect(found("de la paix")).toEqual(["Paix"]);
    expect(found("la fayette")).toEqual(["La Fayette"]);
    expect(found("st michel")).toEqual(["Saint-Michel"]);
    expect(found("champs elysees")).toEqual(["Champs Élysées"]);
  });

  it("finds every voie that shares the name", () => {
    const answer = streets.match("Bercy");
    expect(answer.kind).toBe("found");
    if (answer.kind !== "found") return;
    expect(answer.groups[0].voies.map((v) => v.n).sort()).toEqual([
      "allée de Bercy",
      "boulevard de Bercy",
      "pont de Bercy",
      "port de Bercy",
      "quai de Bercy",
      "rue de Bercy",
    ]);
  });

  it("forgives a typo only when one name is close", () => {
    const typo = streets.match("rivili");
    expect(typo).toMatchObject({ kind: "found", typo: true });
    expect(found("lafayette")).toEqual(["La Fayette"]);
    // Short names must be exact.
    expect(found("bak")).toBe("unknown");
    expect(found("xyzzyq")).toBe("unknown");
    expect(found("")).toBe("unknown");
  });

  it("never asks for coded voies", () => {
    expect(data.voies.some((v) => v.k.includes("/"))).toBe(false);
    expect(data.unnamed.length).toBeGreaterThan(0);
  });

  it("measures progress overall and per arrondissement", () => {
    const rivoli = streets.groupOf("Rivoli")!;
    const p = streets.progress([rivoli]);
    expect(p).toMatchObject({ names: 1, voies: 1, m2: rivoli.m2 });
    expect(p.arrondissements[0]).toBeGreaterThan(0);
    expect(p.arrondissements[3]).toBeGreaterThan(0);
    expect(p.arrondissements[10]).toBe(0);
    const all = streets.progress(streets.groups);
    expect(all.m2).toBe(streets.totalM2);
    for (const share of all.arrondissements) expect(share).toBeCloseTo(1, 6);
  });
});
