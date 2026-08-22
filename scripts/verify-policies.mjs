#!/usr/bin/env node
/*
 * Runs the analysis service over the recorded policy corpus and prints what it
 * found, policy by policy, subject by subject.
 *
 * Two sources, and the report always says which it used:
 *
 *   --live      calls the API with ANTHROPIC_API_KEY. This is the run the
 *               phase's acceptance criteria are about, and it costs money:
 *               roughly $0.17 per uncached policy at the published Opus 5 rate.
 *   (default)   replays `answer.json` beside each fixture, where one exists.
 *               That exercises everything except the model — normalisation,
 *               quote verification, assembly, schema — against real documents,
 *               which is what can be checked without a key.
 *
 * The numbers it reports:
 *
 *   answered   subjects that came back usable rather than unverified. This is
 *              the "detection" figure in the roadmap's phase 5 criteria.
 *   fidelity   claims whose quote was found verbatim in the source, over all
 *              claims of presence. A claim that fails this is discarded by the
 *              pipeline, so fidelity below 100% is not a report that lies — it
 *              is a report with holes in it, and the holes are counted here.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUBJECTS, analysePolicy } from '../server/policy-analysis.mjs';
import { DEFAULT_MODEL, claudeAsk } from '../server/claude.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORPUS = join(ROOT, 'tests', 'fixtures', 'policies');
const OUT = join(ROOT, 'docs', 'verification');

const live = process.argv.includes('--live');
const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]?.split(',')
  : null;

function fixtures() {
  const out = [];
  for (const slug of readdirSync(CORPUS).sort()) {
    const directory = join(CORPUS, slug);
    const policy = join(directory, 'policy.txt');
    if (!existsSync(policy)) continue;
    if (only && !only.includes(slug)) continue;
    out.push({
      slug,
      meta: JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8')),
      text: readFileSync(policy, 'utf8'),
      recorded: existsSync(join(directory, 'answer.json'))
        ? JSON.parse(readFileSync(join(directory, 'answer.json'), 'utf8'))
        : null,
    });
  }
  return out;
}

const ask = live ? claudeAsk() : null;

async function analyse(fixture) {
  if (live) {
    return analysePolicy({ text: fixture.text, url: fixture.meta.finalUrl, ask });
  }
  if (!fixture.recorded) return null;
  return analysePolicy({
    text: fixture.text,
    url: fixture.meta.finalUrl,
    ask: async () => fixture.recorded,
  });
}

const rows = [];
const failures = [];

for (const fixture of fixtures()) {
  let analysis = null;
  let error = null;
  try {
    analysis = await analyse(fixture);
  } catch (cause) {
    error = `${cause?.code ?? 'ERROR'}: ${cause?.message ?? cause}`;
  }

  if (!analysis) {
    rows.push({ slug: fixture.slug, skipped: error ?? 'no recorded answer', analysis: null });
    if (error) failures.push({ slug: fixture.slug, error });
    continue;
  }

  const counts = { present: 0, partial: 0, absent: 0, unverified: 0 };
  for (const mention of analysis.mentions) counts[mention.status] += 1;

  rows.push({
    slug: fixture.slug,
    url: fixture.meta.finalUrl,
    characters: analysis.source.characters,
    truncated: analysis.source.truncated,
    counts,
    analysis,
  });

  process.stdout.write(
    `${fixture.slug.padEnd(14)} present ${String(counts.present).padStart(2)}  partial ${String(counts.partial).padStart(2)}  absent ${String(counts.absent).padStart(2)}  unverified ${String(counts.unverified).padStart(2)}\n`,
  );
}

const analysed = rows.filter((row) => row.analysis);
const subjects = analysed.length * SUBJECTS.length;
const unverified = analysed.reduce((total, row) => total + row.counts.unverified, 0);
const claims = analysed.reduce(
  (total, row) => total + row.counts.present + row.counts.partial + row.counts.unverified,
  0,
);
const verified = claims - unverified;

const pct = (part, whole) => (whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`);

const summary = {
  source: live ? `API (${DEFAULT_MODEL})` : 'recorded answers',
  policies: analysed.length,
  ofCorpus: rows.length,
  answered: subjects - unverified,
  subjects,
  claims,
  verified,
};

process.stdout.write(
  `\n${summary.policies}/${summary.ofCorpus} policies analysed from ${summary.source}\n` +
    `answered ${summary.answered}/${summary.subjects} (${pct(summary.answered, summary.subjects)})  ` +
    `quote fidelity ${summary.verified}/${summary.claims} (${pct(summary.verified, summary.claims)})\n`,
);

/* The document is the deliverable; the console output is for watching it run. */
const date = new Date().toISOString().slice(0, 10);
const lines = [
  '# Policy analysis over the corpus',
  '',
  `Source: **${summary.source}**. ${summary.policies} of ${summary.ofCorpus} recorded policies analysed.`,
  '',
  `| Measure | Value |`,
  `|---|---|`,
  `| Subjects answered rather than unverified | ${summary.answered}/${summary.subjects} (${pct(summary.answered, summary.subjects)}) |`,
  `| Claims of presence whose quote was found verbatim | ${summary.verified}/${summary.claims} (${pct(summary.verified, summary.claims)}) |`,
  '',
  '| Policy | Characters | Present | Partial | Absent | Unverified |',
  '|---|---|---|---|---|---|',
  ...rows.map((row) =>
    row.analysis
      ? `| ${row.slug} | ${row.characters} | ${row.counts.present} | ${row.counts.partial} | ${row.counts.absent} | ${row.counts.unverified} |`
      : `| ${row.slug} | — | — | — | — | *${row.skipped}* |`,
  ),
  '',
  '## Every subject, with the sentence it rests on',
  '',
];

for (const row of analysed) {
  lines.push(`### ${row.slug}`, '', `Source: ${row.url ?? 'unknown'}${row.truncated ? ' (truncated at the analysis ceiling)' : ''}`, '');
  for (const mention of row.analysis.mentions) {
    const quote = mention.quote ? `\n  > ${mention.quote.replace(/\n/g, ' ')}` : '';
    const note = mention.note ? `\n  *${mention.note}*` : '';
    lines.push(`- **${mention.subject}** — ${mention.status}${quote}${note}`);
  }
  if (row.analysis.notes.length > 0) {
    lines.push('', ...row.analysis.notes.map((note) => `- \`${note.code}\` ${note.detail}`));
  }
  lines.push('');
}

if (failures.length > 0) {
  lines.push('## Failures', '', ...failures.map((f) => `- **${f.slug}** — ${f.error}`), '');
}

mkdirSync(OUT, { recursive: true });
const path = join(OUT, `policies-${date}.md`);
writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`\nwrote ${path}\n`);

if (live && failures.length > 0) process.exitCode = 1;
