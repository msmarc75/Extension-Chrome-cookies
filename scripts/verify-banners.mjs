#!/usr/bin/env node
/*
 * Phase 3 acceptance, measured rather than claimed.
 *
 * Two runs, answering two different questions.
 *
 *   `--offline` (default) reads the committed profiles and reports, for each
 *   one, which platform was named, how the banner was found, and which of its
 *   buttons were recognised. It needs no network, it is deterministic, and it
 *   is the run to use when tuning the detector.
 *
 *   `--live` visits the sites with the extension loaded and runs the real
 *   cycle: capture A untouched, then find the banner, then refuse, then reset
 *   and accept, checking each outcome against the platform's own API and
 *   against the banner going away. Only a live run can say whether a refusal
 *   actually refused.
 *
 * Neither is part of `npm test`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateBanner } from '../extension/src/content/banner-detector.js';
import { identifyCmp } from '../extension/src/content/cmp-adapters/index.js';
import { SANDBOX_CAVEAT, launchHarness, sandboxed } from './lib/harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BANNERS = join(ROOT, 'tests', 'fixtures', 'banners');
const OUT_DIR = join(ROOT, 'docs', 'verification');
const SITES = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/sites/phase3.json'), 'utf8'));

const OBSERVATION_MS = 5_000;

function loadProfiles() {
  return readdirSync(BANNERS)
    .filter((slug) => existsSync(join(BANNERS, slug, 'profile.json')))
    .sort()
    .map((slug) => ({
      slug,
      profile: JSON.parse(readFileSync(join(BANNERS, slug, 'profile.json'), 'utf8')),
      meta: JSON.parse(readFileSync(join(BANNERS, slug, 'meta.json'), 'utf8')),
    }));
}

function assess(profile) {
  const cmp = identifyCmp(profile);
  const banner = locateBanner(profile, cmp);
  return { cmp, banner };
}

/* --- Offline: detection over the committed corpus ---------------------------- */

function offline() {
  const entries = loadProfiles();
  const rows = entries.map(({ slug, profile, meta }) => {
    const { cmp, banner } = assess(profile);
    return {
      slug,
      finalUrl: profile.url ?? meta.requestedUrl,
      cmpId: cmp.id,
      cmpName: cmp.name,
      cmpConfidence: cmp.confidence,
      cmpEvidence: cmp.evidence,
      bannerFound: banner.found,
      bannerMethod: banner.method,
      bannerConfidence: banner.confidence,
      controls: Object.fromEntries(
        Object.entries(banner.controls).map(([intent, found]) => [intent, found?.match.label ?? null]),
      ),
      containers: profile.containers.length,
      disclosure: banner.disclosure,
    };
  });

  const identified = rows.filter((row) => row.cmpId !== null).length;
  const banners = rows.filter((row) => row.bannerFound).length;
  const refusable = rows.filter((row) => row.controls.refuse).length;

  const lines = [
    '# Banner detection over the corpus',
    '',
    `${rows.length} fixtures. Platform named in ${identified}. Banner located in ${banners}. ` +
      `A refusal control found in ${refusable}.`,
    '',
    ...(sandboxed() ? [...SANDBOX_CAVEAT, ''] : []),
    '| Fixture | Platform | Confidence | Banner | Refuse label | Accept label |',
    '|---|---|---|---|---|---|',
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.slug} | ${row.cmpName} | ${row.cmpConfidence} | ${row.bannerMethod} | ` +
        `${row.controls.refuse ?? '—'} | ${row.controls.accept ?? '—'} |`,
    );
  }

  lines.push('', '## Evidence', '');
  for (const row of rows) {
    lines.push(`### ${row.slug}`, '');
    lines.push(`- URL: ${row.finalUrl}`);
    lines.push(`- Platform: ${row.cmpName} (${row.cmpConfidence})`);
    if (row.cmpEvidence.length > 0) lines.push(`- Evidence: ${row.cmpEvidence.join('; ')}`);
    lines.push(`- Banner: ${row.bannerMethod}, confidence ${row.bannerConfidence}`);
    if (row.disclosure) lines.push(`- Disclosure: ${row.disclosure}`);
    lines.push(
      `- Controls: ${Object.entries(row.controls)
        .map(([intent, label]) => `${intent}=${label ?? '—'}`)
        .join(', ')}`,
    );
    lines.push('');
  }

  return { rows, report: lines.join('\n') };
}

/* --- Live: does a refusal actually refuse? ---------------------------------- */

async function live() {
  const { context, close } = await launchHarness({ extension: true });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);

  const results = [];
  for (const site of SITES.sites) {
    process.stdout.write(`… ${site.slug}\n`);
    const response = await page.evaluate(
      ([url, observationMs]) =>
        chrome.runtime.sendMessage({
          protocol: 1,
          kind: 'request',
          id: crypto.randomUUID(),
          type: 'probe_banner',
          payload: { url, mode: 'current', observationMs, act: true },
          sentAt: Date.now(),
        }),
      [site.url, OBSERVATION_MS],
    );
    results.push(response.ok ? { site, probe: response.data } : { site, error: response.error.message });
  }

  await close();

  const usable = results.filter((result) => result.probe);
  const identified = usable.filter((result) => result.probe.cmp.id !== null);
  const refused = usable.filter((result) => result.probe.refusal?.ok);
  const accepted = usable.filter((result) => result.probe.acceptance?.ok);

  const lines = [
    '# Banner detection and refusal, live',
    '',
    `${results.length} sites attempted, ${usable.length} reached. ` +
      `Platform named in ${identified.length}. Refusal succeeded in ${refused.length}. ` +
      `Acceptance succeeded in ${accepted.length}.`,
    '',
    ...(sandboxed() ? [...SANDBOX_CAVEAT, ''] : []),
    '| Site | Platform | Banner | Refusal | Route | Accept |',
    '|---|---|---|---|---|---|',
  ];

  for (const result of results) {
    if (!result.probe) {
      lines.push(`| ${result.site.slug} | — | — | — | — | **${result.error}** |`);
      continue;
    }
    const { cmp, banner, refusal, acceptance } = result.probe;
    lines.push(
      `| ${result.site.slug} | ${cmp.name} | ${banner.method} | ` +
        `${refusal?.ok ? 'yes' : 'no'} | ${refusal?.via ?? '—'} | ` +
        `${acceptance?.ok ? 'yes' : 'no'} |`,
    );
  }

  return { results, report: lines.join('\n') };
}

/* --- Entry ------------------------------------------------------------------ */

const wantsLive = process.argv.includes('--live');
mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);

if (wantsLive) {
  const { results, report } = await live();
  writeFileSync(join(OUT_DIR, `banners-live-${stamp}.json`), JSON.stringify(results, null, 2));
  writeFileSync(join(OUT_DIR, `banners-live-${stamp}.md`), `${report}\n`);
  process.stdout.write(`\n${report}\n`);
} else {
  const { rows, report } = offline();
  writeFileSync(join(OUT_DIR, `banners-detection-${stamp}.json`), JSON.stringify(rows, null, 2));
  writeFileSync(join(OUT_DIR, `banners-detection-${stamp}.md`), `${report}\n`);
  process.stdout.write(`\n${report}\n`);
}
