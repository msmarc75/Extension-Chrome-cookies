/*
 * Reads the design tokens out of extension/src/ui/tokens.css.
 *
 * Build scripts that need a colour or a measurement resolve it from here, so
 * tokens.css stays the single source of truth even outside CSS.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TOKENS_PATH = fileURLToPath(
  new URL('../../extension/src/ui/tokens.css', import.meta.url),
);

const DECLARATION = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;

/** @returns {Map<string, string>} token name (with leading `--`) → raw value */
export function readTokens(path = TOKENS_PATH) {
  const css = readFileSync(path, 'utf8');
  const tokens = new Map();
  for (const [, name, value] of css.matchAll(DECLARATION)) {
    tokens.set(name, value.trim());
  }
  if (tokens.size === 0) {
    throw new Error(`No custom properties found in ${path}`);
  }
  return tokens;
}

/** Resolve a token to an `[r, g, b]` triple, failing loudly if it is not a hex colour. */
export function tokenRgb(tokens, name) {
  const value = tokens.get(name);
  if (value === undefined) {
    throw new Error(`Unknown token ${name}`);
  }
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) {
    throw new Error(`Token ${name} is not a 6-digit hex colour: ${value}`);
  }
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}
