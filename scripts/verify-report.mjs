#!/usr/bin/env node
/*
 * Produces the deliverable, from a real site, and keeps it.
 *
 * The phase 6 criterion is that an exported report is usable as a client annex
 * without retouching. That is not something an assertion can establish — it is
 * something you look at. So this runs the extension against a live site, opens
 * the report page on the audit it produced, prints it exactly as Chrome's "Save
 * as PDF" would, and writes the PDF and both CSVs into docs/verification/.
 *
 * Run with `npm run verify:report -- https://www.lemonde.fr/`. It touches the
 * network, so it is never part of `npm test`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SANDBOX_CAVEAT, launchHarness } from './lib/harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs', 'verification');

const target = process.argv.find((argument) => argument.startsWith('http')) ?? 'https://www.lemonde.fr/';
const slug = new URL(target).host.replace(/^www\./, '').replace(/[^\w.-]+/g, '-');
const date = new Date().toISOString().slice(0, 10);

const harness = await launchHarness({ extension: true });

try {
  const worker =
    harness.context.serviceWorkers()[0] ??
    (await harness.context.waitForEvent('serviceworker'));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ready = await worker
      .evaluate(() => Boolean(globalThis.chrome?.debugger && globalThis.setTimeout))
      .catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const extensionId = new URL(worker.url()).host;
  const popup = await harness.context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);

  process.stdout.write(`auditing ${target}…\n`);
  const response = await popup.evaluate(
    ([url]) =>
      chrome.runtime.sendMessage({
        protocol: 1,
        kind: 'request',
        id: crypto.randomUUID(),
        type: 'probe_banner',
        payload: { url, mode: 'current', observationMs: 5000, act: true, analysePolicy: false },
        sentAt: Date.now(),
      }),
    [target],
  );

  if (!response?.ok) {
    throw new Error(`the audit failed: ${JSON.stringify(response?.error ?? response)}`);
  }

  const result = response.data;
  process.stdout.write(
    `score ${result.report?.score ?? '—'} (${result.report?.band?.key ?? 'no band'}), ` +
      `${result.report?.blockingFailures?.length ?? 0} blocking\n`,
  );

  const report = await harness.context.newPage();
  await report.goto(
    `chrome-extension://${extensionId}/src/ui/report/report.html?audit=${result.auditId}`,
  );
  await report.waitForSelector('.ca-lane');

  mkdirSync(OUT, { recursive: true });
  const base = `report-${slug}-${date}`;

  const pdf = await report.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
  });
  writeFileSync(join(OUT, `${base}.pdf`), pdf);

  /* The exports, taken from the page's own code path rather than recomputed
     here: what is written is what the button produces. */
  for (const [action, kind] of [
    ['csv-findings', 'findings'],
    ['csv-deposits', 'deposits'],
  ]) {
    const download = report.waitForEvent('download');
    await report.click(`[data-action="${action}"]`);
    const file = await download;
    await file.saveAs(join(OUT, `${base}-${kind}.csv`));
  }

  const markers = await report.locator('.ca-marker').count();
  const findings = result.report?.findings ?? [];
  const note = [
    `# Report export — ${slug}`,
    '',
    ...SANDBOX_CAVEAT,
    '',
    `Audited \`${target}\` on ${date}, in the visitor's own profile (this harness cannot`,
    "tick Chrome's incognito checkbox), and printed from the report page exactly as",
    '"Save as PDF" prints it.',
    '',
    `| | |`,
    `|---|---|`,
    `| Score | ${result.report?.score ?? '—'} (${result.report?.band?.label ?? '—'}) |`,
    `| Blocking failures | ${(result.report?.blockingFailures ?? []).join(', ') || 'none'} |`,
    `| Findings | ${findings.filter((f) => f.verdict === 'fail').length} departures, ${findings.filter((f) => f.verdict === 'warn').length} to review |`,
    `| Deposits drawn on the timeline | ${markers} |`,
    `| Consent platform | ${result.cmp?.name ?? 'none recognised'} |`,
    `| Refusal | ${result.refusal?.ok ? `succeeded at layer ${result.refusal.layer}` : 'not completed'} |`,
    '',
    `- [\`${base}.pdf\`](${base}.pdf) — the annex`,
    `- [\`${base}-findings.csv\`](${base}-findings.csv) — one row per rule`,
    `- [\`${base}-deposits.csv\`](${base}-deposits.csv) — one row per observation`,
    '',
  ].join('\n');
  writeFileSync(join(OUT, `${base}.md`), `${note}\n`, 'utf8');

  process.stdout.write(`wrote ${join('docs/verification', base)}.{pdf,md} and both CSVs\n`);
} finally {
  await harness.close();
}
