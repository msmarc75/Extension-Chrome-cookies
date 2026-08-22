#!/usr/bin/env node
/*
 * Phase 4 acceptance: run the rulebook over the whole corpus and print every
 * blocking failure with the evidence that produced it.
 *
 * The criterion is zero false positives on blocking rules, and the only way to
 * establish that is to read them. So this prints them — all of them, with the
 * observation behind each — rather than reporting a count. A false positive on
 * a blocking rule costs the product a professional's trust permanently; ten
 * false negatives cost it a feature request.
 *
 * Inputs, both already recorded, neither needing the network:
 *   tests/fixtures/banners/<slug>/profile.json — the page as the detector sees
 *     it, which is what the fairness and information rules read.
 *   docs/verification/banners-live-*.json — the capture A taken from each site,
 *     which is what the deposit rules read. Not committed (3 MB); regenerate
 *     with `npm run verify:banners -- --live`.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateBanner } from '../extension/src/content/banner-detector.js';
import { identifyCmp } from '../extension/src/content/cmp-adapters/index.js';
import { assess } from '../extension/src/engine/index.js';
import { SEVERITY, VERDICT } from '../extension/src/engine/rule.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BANNERS = join(ROOT, 'tests', 'fixtures', 'banners');
const OUT_DIR = join(ROOT, 'docs', 'verification');

/** Capture A per slug, from the most recent live banner run on disk. */
function capturesBySlug() {
  const runs = existsSync(OUT_DIR)
    ? readdirSync(OUT_DIR).filter((name) => /^banners-live-.*\.json$/.test(name)).sort()
    : [];
  if (runs.length === 0) return new Map();

  const results = JSON.parse(readFileSync(join(OUT_DIR, runs.at(-1)), 'utf8'));
  return new Map(
    results
      .filter((entry) => entry.probe?.captureA)
      .map((entry) => [entry.site.slug, entry.probe.captureA]),
  );
}

const emptyCapture = (url) => ({
  schemaVersion: 1,
  phase: 'A',
  target: { requestedUrl: url, finalUrl: url, origin: null },
  profile: 'incognito-fresh',
  window: { startedAt: 0, durationMs: 5000, navigationCommittedAt: null },
  interaction: 'none',
  requests: [],
  cookies: [],
  storage: [],
  fingerprinting: [],
  notes: [],
});

function audits() {
  const captures = capturesBySlug();

  return readdirSync(BANNERS)
    .filter((slug) => existsSync(join(BANNERS, slug, 'profile.json')))
    .sort()
    .map((slug) => {
      const profile = JSON.parse(readFileSync(join(BANNERS, slug, 'profile.json'), 'utf8'));
      const cmp = identifyCmp(profile);
      const banner = locateBanner(profile, cmp);
      return {
        slug,
        audit: {
          captureA: captures.get(slug) ?? emptyCapture(profile.url ?? `https://${slug}/`),
          profile,
          cmp,
          banner,
        },
        hasCapture: captures.has(slug),
      };
    });
}

function main() {
  const rows = [];
  const blockingFindings = [];

  for (const { slug, audit, hasCapture } of audits()) {
    const report = assess(audit);
    rows.push({ slug, report, hasCapture });

    for (const finding of report.findings) {
      if (finding.severity !== SEVERITY.BLOCKING || finding.verdict !== VERDICT.FAIL) continue;
      blockingFindings.push({ slug, finding, pass: 'as measured' });
    }

    /*
     * The recorded captures were taken in the harness's own profile, because
     * an automated browser cannot tick Chrome's incognito box. The engine
     * therefore tempers every deposit failure to a warning — correctly, but it
     * means the blocking deposit rules are never exercised by the corpus as
     * shipped, and those are exactly the rules the acceptance criterion is
     * about. This second pass asks what they would have said in a clean
     * profile, so their output can actually be read.
     */
    if (!hasCapture || audit.captureA.profile !== 'current') continue;
    const asFirstVisit = assess({
      ...audit,
      captureA: { ...audit.captureA, profile: 'incognito-fresh' },
    });
    for (const finding of asFirstVisit.findings) {
      if (finding.severity !== SEVERITY.BLOCKING || finding.verdict !== VERDICT.FAIL) continue;
      if (report.findings.find((f) => f.id === finding.id)?.verdict === VERDICT.FAIL) continue;
      blockingFindings.push({ slug, finding, pass: 'as if first visit' });
    }
  }

  const lines = [
    '# Rule engine over the corpus',
    '',
    `${rows.length} fixtures. ${blockingFindings.length} blocking failure(s), every one printed below with its evidence.`,
    '',
    '| Fixture | Score | Band | Provisional | Fail | Warn | N/A | Blocking |',
    '|---|---|---|---|---|---|---|---|',
  ];

  for (const { slug, report, hasCapture } of rows) {
    lines.push(
      `| ${slug}${hasCapture ? '' : ' *(no capture)*'} | ${report.score} | ${report.band.key} | ` +
        `${report.provisional ? 'yes' : 'no'} | ${report.counts.fail} | ${report.counts.warn} | ` +
        `${report.counts.not_applicable} | ${report.blockingFailures.join(', ') || '—'} |`,
    );
  }

  lines.push('', '## Every blocking failure, with its evidence', '');
  if (blockingFindings.length === 0) {
    lines.push('None.', '');
  }
  {
  let currentSlug = null;
  for (const { slug, finding, pass } of blockingFindings) {
    void currentSlug;
    currentSlug = slug;
    lines.push(`### ${slug} — ${finding.id} *(${pass})*`, '');
    lines.push(`*${finding.title}*`, '');
    for (const item of finding.evidence) {
      lines.push(`- ${item.what}${item.detail ? ` — ${item.detail}` : ''}`);
    }
    if (finding.measured) lines.push('', `Measured: \`${JSON.stringify(finding.measured)}\``);
    lines.push('');
  }
  }

  const report = `${lines.join('\n')}\n`;
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(join(OUT_DIR, `rules-${stamp}.md`), report);
  process.stdout.write(report);
}

main();
