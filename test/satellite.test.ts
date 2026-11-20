import { describe, expect, it } from "vitest";
import { MAPS } from "../src/maps/index.ts";
import { rebuild, tiler, type ProjectionSpec } from "../src/satellite.ts";

const entry = (id: string) => MAPS.find((m) => m.id === id)!;
const spec = (id: string): Promise<ProjectionSpec> => entry(id).satellite!.projection();
const ids = MAPS.filter((m) => m.satellite).map((m) => m.id);

describe("satellite tiles", () => {
  it.each(ids)("%s: the page rebuilds the builder's projection", async (id) => {
    const s = await spec(id);
    const projection = rebuild(s);
    for (const [lon, lat, x, y] of s.checks) {
      const [px, py] = projection([lon, lat])!;
      expect(Math.hypot(px - x, py - y)).toBeLessThan(1e-6);
    }
  });

  // Each tile is bent onto the map with one affine transform; where it misses the projection, neighbours show a seam.
  it.each(ids)("%s: tiles land within a screen pixel of their place", async (id) => {
    const s = await spec(id);
    const { width, height } = await entry(id).load();
    const projection = rebuild(s);
    const t = tiler(s);
    for (const zoom of [2, 4, 8, 16]) {
      const pixelsPerUnit = 2 * zoom;
      const [w, h] = [width / zoom, height / zoom];
      const box = [width / 2 - w / 2, height / 2 - h / 2, width / 2 + w / 2, height / 2 + h / 2] as const;
      const tiles = t.tiles([...box], pixelsPerUnit);
      expect(tiles.length, `zoom ${zoom}`).toBeGreaterThan(0);
      expect(tiles.length).toBeLessThanOrEqual(128);
      let worst = 0;
      for (const tile of tiles) {
        const [z, c, r] = tile.key.split("/").map(Number);
        const n = 2 ** z;
        tile.pieces.forEach((transform, i) => {
          const [a, b, cc, d, e, f] = transform.slice(7, -1).split(" ").map(Number);
          const size = 1 / tile.split;
          const [u0, v0] = [(i % tile.split) * size, Math.floor(i / tile.split) * size];
          for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.5, 0], [0, 0.5]]) {
            const lon = ((c + u0 + u * size) / n) * 360 - 180;
            const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (r + v0 + v * size)) / n))) * 180) / Math.PI;
            const [x, y] = projection([lon, lat])!;
            // Pieces are a device pixel larger on every side, on purpose: that pixel is not an error.
            const [mx, my] = [a * u + cc * v + e, b * u + d * v + f];
            worst = Math.max(worst, Math.max(0, Math.hypot(mx - x, my - y) * pixelsPerUnit - Math.SQRT2));
          }
        });
      }
      const pieces = tiles.reduce((sum, tile) => sum + tile.pieces.length, 0);
      console.log(`${id} zoom ${zoom}: ${tiles.length} tiles at level ${tiles[0].key.split("/")[0]}, ${pieces} pieces, worst ${worst.toFixed(2)} px`);
      expect(worst, `zoom ${zoom}, ${tiles.length} tiles at level ${tiles[0].key.split("/")[0]}`).toBeLessThan(1);
    }
  });

  it("leaves the base image alone while it is sharp enough", async () => {
    const s = await spec("europe");
    expect(tiler(s).tiles([0, 0, 1000, 800], s.pixelsPerUnit)).toEqual([]);
  });
});
