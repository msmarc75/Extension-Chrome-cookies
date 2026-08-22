#!/usr/bin/env node
/*
 * Generates extension/assets/icons/icon-{16,32,48,128}.png.
 *
 * The mark is the product's signature object in miniature: a deposit timeline.
 * One red deposit sits before the consent divider, one green after it — the
 * whole argument of the tool in three shapes. Colours are read from tokens.css,
 * never written here.
 *
 * Run with `npm run icons` after changing the mark or the palette.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';
import { readTokens, tokenRgb } from './lib/tokens.mjs';

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 8;
const OUT_DIR = fileURLToPath(new URL('../extension/assets/icons/', import.meta.url));

/* Normalised geometry, in units of the icon's edge length. */
const GEOMETRY = {
  cornerRadius: 0.18,
  axis: { y: 0.5, from: 0.1, to: 0.9, thickness: 0.05 },
  divider: { x: 0.55, from: 0.16, to: 0.84, thickness: 0.09 },
  before: { x: 0.29, y: 0.5, radius: 0.135 },
  after: { x: 0.79, y: 0.5, radius: 0.135 },
};

function insideRoundedSquare(x, y, radius) {
  const dx = Math.max(radius - x, 0, x - (1 - radius));
  const dy = Math.max(radius - y, 0, y - (1 - radius));
  if (dx === 0 || dy === 0) return true;
  return dx * dx + dy * dy <= radius * radius;
}

function insideHorizontalBar(x, y, bar) {
  return x >= bar.from && x <= bar.to && Math.abs(y - bar.y) <= bar.thickness / 2;
}

function insideVerticalBar(x, y, bar) {
  return y >= bar.from && y <= bar.to && Math.abs(x - bar.x) <= bar.thickness / 2;
}

function insideDisc(x, y, disc) {
  const dx = x - disc.x;
  const dy = y - disc.y;
  return dx * dx + dy * dy <= disc.radius * disc.radius;
}

/** @returns {[number, number, number, number]|null} RGBA at a normalised point */
function sample(x, y, palette) {
  if (!insideRoundedSquare(x, y, GEOMETRY.cornerRadius)) return null;
  if (insideDisc(x, y, GEOMETRY.before)) return [...palette.breach, 255];
  if (insideDisc(x, y, GEOMETRY.after)) return [...palette.clear, 255];
  if (insideVerticalBar(x, y, GEOMETRY.divider)) return [...palette.paper, 255];
  if (insideHorizontalBar(x, y, GEOMETRY.axis)) return [...palette.paper, 255];
  return [...palette.ink, 255];
}

/** Supersample then box-filter in premultiplied space, so edges do not fringe. */
function render(size, palette) {
  const out = new Uint8Array(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);
  const samplesPerPixel = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px * SUPERSAMPLE + sx + 0.5) * step;
          const y = (py * SUPERSAMPLE + sy + 0.5) * step;
          const rgba = sample(x, y, palette);
          if (rgba === null) continue;
          const alpha = rgba[3] / 255;
          r += rgba[0] * alpha;
          g += rgba[1] * alpha;
          b += rgba[2] * alpha;
          a += alpha;
        }
      }
      const offset = (py * size + px) * 4;
      if (a === 0) continue;
      out[offset] = Math.round(r / a);
      out[offset + 1] = Math.round(g / a);
      out[offset + 2] = Math.round(b / a);
      out[offset + 3] = Math.round((a / samplesPerPixel) * 255);
    }
  }
  return out;
}

const tokens = readTokens();
const palette = {
  ink: tokenRgb(tokens, '--ca-ink'),
  paper: tokenRgb(tokens, '--ca-paper'),
  breach: tokenRgb(tokens, '--ca-breach'),
  clear: tokenRgb(tokens, '--ca-clear'),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, size, render(size, palette));
  writeFileSync(new URL(`icon-${size}.png`, `file://${OUT_DIR}`), png);
  process.stdout.write(`icon-${size}.png  ${png.length} bytes\n`);
}
