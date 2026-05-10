import type { ForeheadPlacement } from "@/lib/facecardForehead";

export function drawFaceCardOverlay(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  dpr: number,
  placement: ForeheadPlacement,
  label: string | null,
  mirrorX: boolean,
) {
  const w = Math.floor(cssW * dpr);
  const h = Math.floor(cssH * dpr);
  ctx.clearRect(0, 0, w, h);

  let nx = placement.nx;
  if (mirrorX) nx = 1 - nx;
  const cx = nx * w;
  const cy = placement.ny * h;

  const cardW = Math.min(w * 0.78, 300 * dpr);
  const cardH = Math.max(36 * dpr, Math.min(h * 0.11, 52 * dpr));
  const x = cx - cardW / 2;
  const y = cy - cardH - h * 0.025;

  const rx = 12 * dpr;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 10 * dpr;
  ctx.shadowOffsetY = 3 * dpr;
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = Math.max(1, dpr);
  roundRect(ctx, x, y, cardW, cardH, rx);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const pad = 10 * dpr;
  const innerW = cardW - pad * 2;

  if (label && label.trim()) {
    let fs = Math.round(15 * dpr);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#0a0a0a";
    for (; fs >= 9 * dpr; fs -= Math.max(1, dpr)) {
      ctx.font = `800 ${fs}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
      const lines = wrapLines(ctx, label.trim(), innerW);
      const lineH = fs * 1.15;
      const blockH = lines.length * lineH;
      if (blockH <= cardH - pad * 2 || fs <= 9 * dpr) {
        let ty = y + cardH / 2 - blockH / 2 + lineH / 2;
        for (const line of lines) {
          ctx.fillText(line, cx, ty);
          ty += lineH;
        }
        break;
      }
    }
  } else {
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 2 * dpr;
    const lx = x + cardW * 0.22;
    const rx2 = x + cardW * 0.78;
    const my = y + cardH / 2;
    ctx.beginPath();
    ctx.moveTo(lx, my - cardH * 0.15);
    ctx.lineTo(rx2, my - cardH * 0.15);
    ctx.moveTo(lx, my);
    ctx.lineTo(rx2, my);
    ctx.moveTo(lx, my + cardH * 0.15);
    ctx.lineTo(rx2, my + cardH * 0.15);
    ctx.stroke();
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(trial).width <= maxW) {
      cur = trial;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
