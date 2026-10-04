"use strict";
/*
 * make-icons.js — Mandarin's icon at every size it's used (v0.6.9): the duck
 * in black on the app's brass, the colours of the old badge turned round.
 * Drawn from public/icons/mandarin-duck.png (the duck alone, transparent).
 *
 *   node tools/icons/make-icons.js
 *
 * Writes the PWA's icons (public/icons: any-purpose with rounded corners,
 * maskable full-bleed, the Apple touch icon, favicon.ico), the site's
 * (docs/mandarin-icon.png) and the Android app's (mipmap-*: the adaptive
 * icon's foreground, and the legacy square and round icons; the adaptive
 * background is @color/icon_background, the same brass).
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "public/icons/mandarin-duck.png");
const BRASS = "#c9a45c";            // --plum in style.css: the app's brass
const INK = { r: 0x11, g: 0x12, b: 0x14 };   // the duck: black, a touch warm of pure

/* The duck alone, black, trimmed to its own edges, `size` px on its longer side. */
async function duck(size) {
  const trimmed = await sharp(SRC).trim().toBuffer();
  // Its shape kept (the alpha), its colour made the ink.
  const { data, info } = await sharp(trimmed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) { data[i] = INK.r; data[i + 1] = INK.g; data[i + 2] = INK.b; }
  return sharp(data, { raw: info }).resize(size, size, { fit: "inside" }).png().toBuffer();
}

/* A canvas of `size`, brass (shaped by `shape`), the duck `scale` of it, centred. */
async function icon(size, { scale, shape = "square", radius = 0.22, transparent = false, nudgeX = 0.02 }) {
  const d = await duck(Math.round(size * scale));
  const meta = await sharp(d).metadata();
  const left = Math.round((size - meta.width) / 2 + size * nudgeX);
  const top = Math.round((size - meta.height) / 2);
  let base;
  if (transparent) {
    base = sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  } else {
    const r = shape === "circle" ? size / 2 : shape === "rounded" ? size * radius : 0;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BRASS}"/></svg>`;
    base = sharp(Buffer.from(svg));
  }
  return base.composite([{ input: d, left, top }]).png().toBuffer();
}

/* favicon.ico: PNG images in an ICO wrapper (16, 32, 48). */
async function ico(file) {
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(sizes.map(s => icon(s, { scale: 0.86, shape: "rounded", radius: 0.2 })));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(file, Buffer.concat([head, ...pngs]));
}

(async () => {
  const out = async (rel, buf) => { fs.writeFileSync(path.join(ROOT, rel), buf); console.log(rel); };
  // The PWA: rounded brass tiles for "any", full-bleed for "maskable" (the duck
  // inside the 80% safe circle), and a square for Apple (iOS rounds it itself).
  for (const s of [192, 256, 384, 512]) await out(`public/icons/icon-${s}.png`, await icon(s, { scale: 0.74, shape: "rounded" }));
  for (const s of [192, 512]) await out(`public/icons/maskable-${s}.png`, await icon(s, { scale: 0.7 }));
  await out("public/icons/apple-touch-icon.png", await icon(180, { scale: 0.72 }));
  await ico(path.join(ROOT, "public/icons/favicon.ico")); console.log("public/icons/favicon.ico");
  await out("docs/mandarin-icon.png", await icon(192, { scale: 0.74, shape: "rounded" }));
  // Android: the adaptive icon's foreground (108dp, the duck inside the 66dp
  // safe zone, on transparent: the brass is the background colour), and the
  // legacy square and round icons for launchers without adaptive icons.
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const res = `android/app/src/main/res/mipmap-${d}`;
    await out(`${res}/ic_launcher_foreground.png`, await icon(Math.round(108 * k), { scale: 0.56, transparent: true }));
    await out(`${res}/ic_launcher.png`, await icon(Math.round(48 * k), { scale: 0.74, shape: "rounded", radius: 0.2 }));
    await out(`${res}/ic_launcher_round.png`, await icon(Math.round(48 * k), { scale: 0.78, shape: "circle" }));
  }
})().catch(e => { console.error(e); process.exit(1); });
