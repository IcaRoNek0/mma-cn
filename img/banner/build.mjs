// Renders the GitHub social preview (1280x640) from the app icon and the README screenshot.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import opentype from "opentype.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const OUT = path.join(here, "github-social-preview.png");
const FONTS = { 400: path.join(here, "fonts/OpenSans-Regular.ttf"), 600: path.join(here, "fonts/OpenSans-SemiBold.ttf") };
const ICON = path.join(root, "app/public/icon-1024.png");
const SHOT = path.join(root, "img/preview.png");

const W = 1280, H = 640;
const SURFACE_0 = "#252521", SURFACE_LO = "#1c1c19", SURFACE_1 = "#2d2d28";
const BORDER = "rgba(255,255,255,0.08)";
const TEXT_1 = "#f4f3ef", TEXT_2 = "#b5b2a6", ACCENT = "#1098ad";

const TITLE = "Map Making App";
const TAGLINE = "A local-first GeoGuessr map editor";
const CHIPS = ["offline", "millions of locations", "plugins"];

const PLATE_W = Math.floor(W * 0.39);
const LEFT = Math.floor(W * 0.05);
const SHOT_H = Math.floor(H * 0.94);
const SHOT_SRC = { w: 2556, h: 1360 };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const dataUri = async (file) => `data:image/png;base64,${(await readFile(file)).toString("base64")}`;

const fontBuffers = await Promise.all(Object.values(FONTS).map((f) => readFile(f)));
const fonts = Object.fromEntries(Object.keys(FONTS).map((w, i) => [w, opentype.parse(fontBuffers[i].buffer.slice(
  fontBuffers[i].byteOffset, fontBuffers[i].byteOffset + fontBuffers[i].byteLength))]));
const metrics = (weight, size) => {
  const f = fonts[weight], u = size / f.unitsPerEm;
  return {
    ascent: f.ascender * u, descent: -f.descender * u, xHeight: f.tables.os2.sxHeight * u,
    width: (s) => f.getAdvanceWidth(s, size),
  };
};

function text(s, size, weight, color, x, top) {
  const m = metrics(weight, size);
  const h = Math.floor(m.ascent) + Math.floor(m.descent) + 8;
  const svg = `<text x="${x + 4}" y="${top + 4 + Math.floor(m.ascent)}" font-family="Open Sans" font-weight="${weight}" font-size="${size}" fill="${color}">${esc(s)}</text>`;
  return { svg, h };
}

function chip(s, x, y, size = 15, padX = 14, padY = 8) {
  const m = metrics(400, size);
  const w = Math.round(m.width(s)) + padX * 2, h = size + padY * 2;
  const baseline = y + h / 2 + m.xHeight / 2;
  const svg = `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="6" fill="${SURFACE_1}" stroke="${BORDER}"/>` +
    `<text x="${x + padX}" y="${baseline}" font-family="Open Sans" font-weight="400" font-size="${size}" fill="${TEXT_2}">${esc(s)}</text>`;
  return { svg, w, h };
}

async function build() {
  const shotW = W - PLATE_W - 32;
  const shotX = PLATE_W, shotY = Math.floor((H - (SHOT_H + 2)) / 2);
  const shotScaledW = SHOT_SRC.w * SHOT_H / SHOT_SRC.h;

  const iconPx = 144;
  const title = metrics(600, 48), tag = metrics(400, 21);
  const titleH = Math.floor(title.ascent) + Math.floor(title.descent) + 8;
  const tagH = Math.floor(tag.ascent) + Math.floor(tag.descent) + 8;
  const chipH = 15 + 16;
  let y = Math.floor((H - (iconPx + 22 + titleH + tagH + 34 + chipH)) / 2);
  const iconY = y; y += iconPx + 22;
  const titleEl = text(TITLE, 48, 600, TEXT_1, LEFT - 4, y); y += titleEl.h;
  const tagEl = text(TAGLINE, 21, 400, TEXT_2, LEFT - 3, y); y += tagEl.h + 34;
  let cx = LEFT, chips = "";
  for (const s of CHIPS) { const c = chip(s, cx, y); chips += c.svg; cx += c.w + 10; }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SURFACE_0}"/><stop offset="1" stop-color="${SURFACE_LO}"/></linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${W * 0.08}"/></filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22"/></filter>
    <clipPath id="win"><rect x="${shotX + 1}" y="${shotY + 1}" width="${shotW}" height="${SHOT_H}" rx="14"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="${W * 0.2}" cy="${H * 0.3}" rx="${W * 0.4}" ry="${H * 0.6}" fill="${ACCENT}" fill-opacity="${28 / 255}" filter="url(#glow)"/>
  <rect x="${shotX + 6}" y="${shotY + 18}" width="${shotW - 6}" height="${SHOT_H + 2}" rx="18" fill="black" fill-opacity="${150 / 255}" filter="url(#shadow)"/>
  <image x="${shotX + 1}" y="${shotY + 1}" width="${shotScaledW}" height="${SHOT_H}" clip-path="url(#win)" href="${await dataUri(SHOT)}"/>
  <rect x="${shotX + 0.5}" y="${shotY + 0.5}" width="${shotW + 1}" height="${SHOT_H + 1}" rx="15" fill="none" stroke="${BORDER}"/>
  <image x="${LEFT - 6}" y="${iconY}" width="${iconPx}" height="${iconPx}" href="${await dataUri(ICON)}"/>
  ${titleEl.svg}
  ${tagEl.svg}
  ${chips}
</svg>`;

  await initWasm(await readFile(path.join(here, "node_modules/@resvg/resvg-wasm/index_bg.wasm")));
  const png = new Resvg(svg, {
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: "Open Sans" },
  }).render().asPng();
  await writeFile(OUT, png);
  console.log(`${path.basename(OUT)}: ${W}x${H}, ${(png.length / 1e6).toFixed(2)} MB`);
}

await build();
