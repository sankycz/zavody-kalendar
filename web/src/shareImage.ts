import qrcode from "qrcode-generator";
import type { EventDetail } from "../../src/shared/types.ts";
import { DISCIPLINE_COLOR, DISCIPLINE_ICON } from "./Badges.tsx";
import { MAP_STYLES } from "./basemap.ts";
import { posterDate } from "./format.ts";
import { DISCIPLINE_LABEL, LEVEL_LABEL } from "./labels.ts";
import { maplibregl } from "./maplibre.ts";

// Picture of a race for Instagram / Facebook Stories (1080×1920, design "Plakát"):
// the dark map around the place, a skewed date badge, the name in big italics
// and a QR code to the race page. Drawn in the browser, nothing stored on the server.

export const SHARE_W = 1080;
export const SHARE_H = 1920;

/** Instagram covers about this much at the top and bottom with its own UI. */
const PAD_X = 72;
const PIN_Y = 640;
const CONTENT_TOP = 880;
const CONTENT_BOTTOM = 1400;
const FONT = `"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const BG = "#06070b";
const RED = "#e11d2e";
const ORANGE = "#ff7a18";

export type ShareCard = Pick<
  EventDetail,
  "id" | "name" | "date_from" | "date_to" | "discipline" | "level" | "status" | "location_name"
> & {
  /** Page the QR code opens. */
  url: string;
  /** Shown under the QR code, e.g. "zavody-aut.cz". */
  host: string;
};

/** Splits `text` into at most `maxLines` lines of `maxWidth`; null when it does not fit. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] | null {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      if (!line || ctx.measureText(word).width > maxWidth) return null;
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length <= maxLines ? lines : null;
}

/** Fills `maxLines` lines word by word and cuts the rest with an ellipsis. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else if (lines.length + 1 < maxLines) {
      lines.push(line);
      line = word;
    } else {
      while (line && ctx.measureText(`${line}…`).width > maxWidth) line = line.slice(0, -1);
      lines.push(`${line.trimEnd()}…`);
      return lines;
    }
  }
  lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const s = size / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const g = ctx.createLinearGradient(0, 0, 64, 64);
  g.addColorStop(0, RED);
  g.addColorStop(1, ORANGE);
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, 64, 64, 15);
  ctx.fill();
  const flag = new Path2D("M19 52V13M19 13h26l-5 9.5 5 9.5H19");
  ctx.fillStyle = ctx.strokeStyle = "#fff";
  ctx.lineWidth = 5.5;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.fill(flag);
  ctx.stroke(flag);
  ctx.restore();
}

function drawPin(ctx: CanvasRenderingContext2D, color: string, label: string | null) {
  const x = SHARE_W / 2;
  const glow = ctx.createRadialGradient(x, PIN_Y, 0, x, PIN_Y, 170);
  glow.addColorStop(0, `${color}55`);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(x - 170, PIN_Y - 170, 340, 340);
  ctx.strokeStyle = `${color}88`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, PIN_Y, 66, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(x, PIN_Y, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (!label) return;
  ctx.font = `800 36px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = 10;
  ctx.strokeStyle = BG;
  ctx.strokeText(label, x, PIN_Y - 92);
  ctx.fillStyle = "#eef0f5";
  ctx.fillText(label, x, PIN_Y - 92);
  ctx.textAlign = "left";
}

/** Racing livery: three slanted stripes in the top right corner. */
function drawLivery(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.translate(1050, 325);
  ctx.rotate((18 * Math.PI) / 180);
  ["#ef4444", ORANGE, "#ffffff"].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(-150 + i * 72, -625, 46, 1250);
  });
  ctx.restore();
}

function drawQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const pad = 18;
  ctx.fillStyle = "#fff";
  roundRect(ctx, x, y, size, size, 28);
  ctx.fill();
  const cell = (size - pad * 2) / n;
  ctx.fillStyle = BG;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c)) ctx.fillRect(x + pad + c * cell, y + pad + r * cell, Math.ceil(cell), Math.ceil(cell));
}

/** Draws the whole picture; `map` is the rendered map (null: offline / no WebGL). */
export function drawShareImage(ctx: CanvasRenderingContext2D, card: ShareCard, map: CanvasImageSource | null) {
  const color = DISCIPLINE_COLOR[card.discipline];
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  if (map) ctx.drawImage(map, 0, 0, SHARE_W, SHARE_H);
  drawPin(ctx, color, map ? card.location_name : null);

  const shade = ctx.createLinearGradient(0, 0, 0, SHARE_H);
  shade.addColorStop(0, "rgb(6 7 11 / 0.85)");
  shade.addColorStop(0.17, "rgb(6 7 11 / 0)");
  shade.addColorStop(0.36, "rgb(6 7 11 / 0)");
  shade.addColorStop(0.55, "rgb(6 7 11 / 0.94)");
  shade.addColorStop(1, BG);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  drawLivery(ctx);

  ctx.textBaseline = "alphabetic";
  drawLogo(ctx, PAD_X, 150, 64);
  ctx.fillStyle = "#fff";
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText("Závody aut v ČR", PAD_X + 82, 194);

  // Date badge, skewed like a race number.
  const cancelled = card.status === "cancelled";
  const date = cancelled ? `ZRUŠENO · ${posterDate(card.date_from, card.date_to)}` : posterDate(card.date_from, card.date_to);
  let dateSize = 88;
  ctx.font = `italic 900 ${dateSize}px ${FONT}`;
  while (ctx.measureText(date).width > SHARE_W - PAD_X * 2 - 90 && dateSize > 48) {
    dateSize -= 4;
    ctx.font = `italic 900 ${dateSize}px ${FONT}`;
  }
  const badgeW = ctx.measureText(date).width + 68;
  const badgeH = dateSize * 1.18 + 32;
  const badgeX = PAD_X + 10;
  ctx.save();
  ctx.translate(badgeX, CONTENT_TOP + badgeH / 2);
  ctx.transform(1, 0, Math.tan((-8 * Math.PI) / 180), 1, 0, 0);
  const badge = ctx.createLinearGradient(0, 0, badgeW, 0);
  badge.addColorStop(0, cancelled ? "#4b5160" : RED);
  badge.addColorStop(1, cancelled ? "#6b7280" : ORANGE);
  ctx.shadowColor = cancelled ? "transparent" : "rgb(225 29 46 / 0.45)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = badge;
  roundRect(ctx, 0, -badgeH / 2, badgeW, badgeH, 22);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#fff";
  ctx.fillText(date, badgeX + 34, CONTENT_TOP + badgeH / 2 + dateSize * 0.36);

  // Name: as big as fits in at most four lines above the footer.
  const meta = 50;
  const nameTop = CONTENT_TOP + badgeH + 44;
  const room = CONTENT_BOTTOM - nameTop - meta - 30;
  const width = SHARE_W - PAD_X * 2;
  const name = card.name.toUpperCase();
  let size = 140;
  let lines: string[] | null = null;
  for (; size > 48; size -= 4) {
    ctx.font = `italic 900 ${size}px ${FONT}`;
    lines = wrap(ctx, name, width, Math.min(4, Math.floor(room / (size * 1.0))));
    if (lines) break;
  }
  if (!lines) lines = ellipsize(ctx, name, width, Math.floor(room / (size * 1.0)));
  ctx.fillStyle = cancelled ? "rgb(255 255 255 / 0.55)" : "#fff";
  let y = nameTop;
  for (const line of lines) {
    y += size * 1.0;
    ctx.fillText(line, PAD_X - 4, y);
  }

  // Discipline · place · level
  y += 30 + meta * 0.8;
  const icon = new Path2D(DISCIPLINE_ICON[card.discipline]);
  ctx.save();
  ctx.translate(PAD_X, y - 34);
  ctx.scale(40 / 24, 40 / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.stroke(icon);
  ctx.restore();
  ctx.font = `600 40px ${FONT}`;
  let x = PAD_X + 58;
  const parts = [DISCIPLINE_LABEL[card.discipline], card.location_name, LEVEL_LABEL[card.level]].filter((p): p is string => !!p);
  parts.forEach((p, i) => {
    if (i > 0) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 12, y - 14, 6, 0, Math.PI * 2);
      ctx.fill();
      x += 42;
    }
    ctx.fillStyle = "rgb(255 255 255 / 0.8)";
    if (x + ctx.measureText(p).width > SHARE_W - PAD_X) return;
    ctx.fillText(p, x, y);
    x += ctx.measureText(p).width + 18;
  });

  // Footer: QR code to the race page, in Instagram's safe area.
  const qrSize = 230;
  const qrX = SHARE_W - PAD_X - qrSize;
  const qrY = 1432;
  drawQr(ctx, card.url, qrX, qrY, qrSize);
  ctx.fillStyle = "#fff";
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText("Naskenuj a jeď", PAD_X, qrY + 96);
  ctx.fillStyle = "rgb(255 255 255 / 0.6)";
  ctx.font = `500 32px ${FONT}`;
  ctx.fillText("Termíny, mapa a živé info", PAD_X, qrY + 142);
  ctx.fillStyle = "rgb(255 255 255 / 0.85)";
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText(card.host, PAD_X, qrY + 188);
}

/**
 * The map around the race as a picture: an off-screen MapLibre map (dark style)
 * at 2× pixel ratio, read once it has drawn every tile. Null when there is no
 * WebGL, no network or it takes too long.
 */
function renderMap(lng: number, lat: number): Promise<HTMLCanvasElement | null> {
  const box = document.createElement("div");
  box.style.cssText = `position:fixed;left:-10000px;top:0;width:${SHARE_W / 2}px;height:${SHARE_H / 2}px;pointer-events:none`;
  document.body.append(box);
  return new Promise((resolve) => {
    let map: maplibregl.Map | null = null;
    let timer = 0;
    const done = (ok: boolean) => {
      clearTimeout(timer);
      let out: HTMLCanvasElement | null = null;
      if (ok && map) {
        out = document.createElement("canvas");
        out.width = SHARE_W;
        out.height = SHARE_H;
        out.getContext("2d")?.drawImage(map.getCanvas(), 0, 0, SHARE_W, SHARE_H);
      }
      map?.remove();
      box.remove();
      resolve(out);
    };
    try {
      map = new maplibregl.Map({
        container: box,
        style: MAP_STYLES.dark,
        center: [lng, lat],
        zoom: 11.2,
        pixelRatio: 2,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
    } catch {
      return done(false);
    }
    // The pin sits above the middle, where the picture is not shaded.
    map.setPadding({ top: 0, bottom: SHARE_H / 2 - PIN_Y, left: 0, right: 0 });
    map.once("idle", () => done(true));
    map.on("error", () => undefined);
    timer = window.setTimeout(() => done(false), 10_000);
  });
}

export async function createShareImage(card: ShareCard, point: { lat: number; lng: number } | null): Promise<Blob> {
  const map = point ? await renderMap(point.lng, point.lat) : null;
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas není k dispozici");
  await document.fonts?.ready;
  drawShareImage(ctx, card, map);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Obrázek se nepodařilo vytvořit"))), "image/png"),
  );
}
