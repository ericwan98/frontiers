// Turns the finished map into a PNG with a title, for sharing the result as a picture.
import type { Game } from "./game.ts";
import { MAX_POINTS } from "./scoring.ts";

const SCALE = 2;
const HEADER = 64;
const FOOTER = 30;

/** Renders `svg` (from MapView.snapshot) under a header naming the game and its score. */
export async function renderPng(g: Game, svg: SVGSVGElement): Promise<Blob> {
  const { width, height } = g.map;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width * SCALE;
    canvas.height = (HEADER + height + FOOTER) * SCALE;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(0, 0, width, HEADER + height + FOOTER);
    ctx.drawImage(image, 0, HEADER, width, height);

    ctx.fillStyle = "#1f2328";
    ctx.textBaseline = "middle";
    ctx.font = "800 26px system-ui, sans-serif";
    ctx.fillText(`${g.title}, according to me`, 20, HEADER / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fa500f";
    ctx.fillText(`${g.total} / ${g.order.length * MAX_POINTS}`, width - 20, HEADER / 2);
    ctx.font = "500 13px system-ui, sans-serif";
    ctx.fillStyle = "#66707a";
    ctx.fillText(g.seed ? `Frontiers · seed ${g.seed}` : "Frontiers", width - 20, HEADER + height + FOOTER / 2);

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas export failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
