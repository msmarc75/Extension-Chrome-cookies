#!/usr/bin/env node
/*
 * Runs capture A against a list of real sites and writes the evidence out for
 * a human to read.
 *
 * The end-to-end suite proves the machinery is correct against a fixture whose
 * every byte is known. This proves it is *useful*: that on a real French news
 * site, with a real consent banner nobody has touched, the capture actually
 * contains the advertising and analytics calls a practitioner would expect to
 * find, at plausible times.
 *
 * It is not part of `npm test`: it needs the open internet, real sites change
 * under it, and its output is a document to be read rather than an assertion to
 * be passed. Run it with `npm run verify:capture`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrableDomain } from '../extension/src/shared/hosts.js';
import { SANDBOX_CAVEAT, launchHarness, sandboxed } from './lib/harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'docs', 'verification');
const SITES = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/sites/phase2.json'), 'utf8'));

const OBSERVATION_MS = 5_000;

/* --- The run --------------------------------------------------------------- */

async function main() {
  const { context, close } = await launchHarness({ extension: true });

  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);

  const results = [];
  for (const site of SITES.sites) {
    process.stdout.write(`… ${site.url}\n`);
    const response = await page.evaluate(
      ([url, observationMs]) =>
        chrome.runtime.sendMessage({
          protocol: 1,
          kind: 'request',
          id: crypto.randomUUID(),
          type: 'capture_pre_consent',
          payload: { url, mode: 'current', observationMs },
          sentAt: Date.now(),
        }),
      [site.url, OBSERVATION_MS],
    );

    results.push(
      response.ok
        ? { site, capture: response.data }
        : { site, error: response.error.message },
    );
  }

  await close();

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(join(OUT_DIR, `capture-a-${stamp}.json`), JSON.stringify(results, null, 2));
  const report = renderReport(results, stamp);
  writeFileSync(join(OUT_DIR, `capture-a-${stamp}.md`), report);
  process.stdout.write(`\n${report}`);
}

/* --- Reading the evidence --------------------------------------------------- */

function thirdPartyDomains(capture) {
  const byDomain = new Map();
  for (const request of capture.requests) {
    if (request.party !== 'third') continue;
    const domain = registrableDomain(request.host);
    if (!byDomain.has(domain)) byDomain.set(domain, { domain, tMs: request.tMs, count: 0 });
    byDomain.get(domain).count += 1;
  }
  return [...byDomain.values()].sort((a, b) => a.tMs - b.tMs);
}

function renderReport(results, stamp) {
  const lines = [
    `# Capture A — verification run, ${stamp}`,
    '',
    'Every figure below was measured with no interaction whatsoever: the page was',
    'loaded in a clean profile, watched for five seconds, and never touched. Whatever',
    'appears here, the visitor received before being asked anything.',
    '',
    ...(sandboxed() ? [...SANDBOX_CAVEAT, '', ...['> What the run establishes is that capture A sees what the page asks for.', '']] : []),
    '| Site | 3rd-party domains | Requests | Cookies (3rd) | Storage | First deposit |',
    '|---|---|---|---|---|---|',
  ];

  for (const result of results) {
    if (result.error) {
      lines.push(`| ${result.site.url} | — | — | — | — | **${result.error}** |`);
      continue;
    }
    const capture = result.capture;
    const domains = thirdPartyDomains(capture);
    const thirdPartyCookies = capture.cookies.filter((c) => c.party === 'third').length;
    const timed = [
      ...capture.requests.filter((r) => r.party === 'third').map((r) => r.tMs),
      ...capture.cookies.map((c) => c.tMs),
      ...capture.storage.map((s) => s.tMs),
    ].filter((t) => typeof t === 'number');
    const first = timed.length > 0 ? `${Math.round(Math.min(...timed))} ms` : 'none';

    lines.push(
      `| ${capture.target.finalUrl ?? result.site.url} | ${domains.length} | ` +
        `${capture.requests.length} | ${capture.cookies.length} (${thirdPartyCookies}) | ` +
        `${capture.storage.length} | ${first} |`,
    );
  }

  lines.push('', '## Third parties reached before consent, in the order they were called', '');

  for (const result of results) {
    if (result.error) continue;
    const domains = thirdPartyDomains(result.capture);
    lines.push(`### ${result.site.url}`, '');
    if (result.capture.notes.length > 0) {
      lines.push(`Notes: ${result.capture.notes.map((n) => n.code).join(', ')}`, '');
    }
    if (domains.length === 0) {
      lines.push('No third party contacted.', '');
      continue;
    }
    for (const { domain, tMs, count } of domains) {
      lines.push(`- \`${domain}\` — first at ${Math.round(tMs)} ms, ${count} request(s)`);
    }
    const cookies = result.capture.cookies;
    if (cookies.length > 0) {
      lines.push('', 'Cookies:');
      for (const cookie of cookies.slice(0, 25)) {
        const when = cookie.tMs === null ? 'undated' : `${Math.round(cookie.tMs)} ms`;
        lines.push(`- \`${cookie.name}\` on \`${cookie.host}\` (${cookie.party}, ${when})`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

await main();
