#!/usr/bin/env node
/*
 * Build = validate, then copy.
 *
 * There is no bundler and no transpiler: MV3 loads ES modules natively in both
 * the service worker and the popup, so a build step that rewrote the sources
 * would only stand between a stack trace and the file it points at. What the
 * build does earn its keep on is validation — a manifest that references a file
 * that does not exist fails silently at load time with a message Chrome shows
 * once and then forgets.
 */

import { cpSync, existsSync, globSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = join(ROOT, 'extension');
const OUT = join(ROOT, 'dist', 'extension');

const errors = [];

function fail(message) {
  errors.push(message);
}

function requireFile(path, referencedBy) {
  if (!existsSync(join(SOURCE, path))) {
    fail(`${referencedBy} references missing file: ${path}`);
  }
}

/* ---- Manifest ----------------------------------------------------------- */

const manifestPath = join(SOURCE, 'manifest.json');
if (!existsSync(manifestPath)) {
  process.stderr.write('build: extension/manifest.json is missing\n');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (cause) {
  process.stderr.write(`build: manifest.json is not valid JSON — ${cause.message}\n`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) {
  fail(`manifest_version must be 3, found ${manifest.manifest_version}`);
}
for (const key of ['name', 'version', 'description']) {
  if (!manifest[key]) fail(`manifest.json is missing "${key}"`);
}
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) {
  fail(`manifest version "${manifest.version}" is not a Chrome-accepted version string`);
}

if (manifest.background?.service_worker) {
  requireFile(manifest.background.service_worker, 'manifest.background');
  if (manifest.background.type !== 'module') {
    fail('manifest.background.type must be "module" — the sources use ES imports');
  }
}
if (manifest.action?.default_popup) {
  requireFile(manifest.action.default_popup, 'manifest.action');
}
for (const [size, path] of Object.entries(manifest.icons ?? {})) {
  requireFile(path, `manifest.icons["${size}"]`);
}
for (const [size, path] of Object.entries(manifest.action?.default_icon ?? {})) {
  requireFile(path, `manifest.action.default_icon["${size}"]`);
}

/* ---- Document references ------------------------------------------------ */

const ASSET_REFERENCE = /(?:href|src)\s*=\s*"([^"]+)"/gi;

for (const file of globSync('**/*.html', { cwd: SOURCE })) {
  const source = readFileSync(join(SOURCE, file), 'utf8');
  for (const [, reference] of source.matchAll(ASSET_REFERENCE)) {
    if (/^(?:https?:|data:|#|mailto:)/i.test(reference)) {
      fail(`${file} references an external resource (blocked by the MV3 CSP): ${reference}`);
      continue;
    }
    const resolved = resolve(dirname(join(SOURCE, file)), reference);
    if (!existsSync(resolved)) {
      fail(`${file} references missing file: ${reference}`);
    }
  }
}

/* ---- Module references -------------------------------------------------- */

const IMPORT_SPECIFIER = /(?:^|\n)\s*import\s[^'"]*['"]([^'"]+)['"]/g;

for (const file of globSync('**/*.js', { cwd: SOURCE })) {
  const source = readFileSync(join(SOURCE, file), 'utf8');
  for (const [, specifier] of source.matchAll(IMPORT_SPECIFIER)) {
    if (!specifier.startsWith('.')) {
      fail(`${file} imports a bare specifier "${specifier}" — no bundler resolves it`);
      continue;
    }
    const resolved = resolve(dirname(join(SOURCE, file)), specifier);
    if (!existsSync(resolved)) {
      fail(`${file} imports missing module: ${specifier}`);
    }
  }
}

/* ---- Emit --------------------------------------------------------------- */

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`  ${error}\n`);
  process.stderr.write(`\nbuild: ${errors.length} problem(s), nothing written\n`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
cpSync(SOURCE, OUT, { recursive: true });

const written = globSync('**/*', { cwd: OUT }).length;
process.stdout.write(
  `build: ${manifest.name} ${manifest.version} → ${relative(ROOT, OUT)} (${written} entries)\n`,
);
