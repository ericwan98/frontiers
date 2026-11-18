// A burst of paper over the page, for a great drawing or a won challenge.
const COLORS = ["#fa500f", "#ffd800", "#ff8205", "#e10500", "#2e7d32", "#1565c0"];
const DURATION_MS = 2600;
const GRAVITY = 0.35;

export function confetti(pieces = 160): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  const ratio = devicePixelRatio || 1;
  const [w, h] = [innerWidth, innerHeight];
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  document.body.append(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ratio, ratio);
  const bits = Array.from({ length: pieces }, (_, i) => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.3,
    y: h * 0.4,
    vx: (Math.random() - 0.5) * 16,
    vy: -4 - Math.random() * 14,
    size: 5 + Math.random() * 6,
    angle: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.4,
    color: COLORS[i % COLORS.length],
  }));
  const start = performance.now();
  let last = start;
  const frame = (now: number) => {
    // Steps are scaled to 60 fps so a 120 Hz screen doesn't play it twice as fast.
    const k = Math.min(3, (now - last) / (1000 / 60));
    last = now;
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.min(1, (DURATION_MS - t) / (DURATION_MS * 0.4));
    for (const b of bits) {
      b.vy += GRAVITY * k;
      b.vx *= 0.99 ** k;
      b.x += b.vx * k;
      b.y += b.vy * k;
      b.angle += b.spin * k;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.size / 2, -b.size / 4, b.size, (b.size / 2) * Math.abs(Math.cos(b.angle * 2)) + 1);
      ctx.restore();
    }
    if (t < DURATION_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
