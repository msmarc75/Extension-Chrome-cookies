#!/usr/bin/env node
/*
 * Records real privacy policies as fixtures, the way the extension reaches them.
 *
 * Discovery is not shortcut: the homepage is loaded, its profile read with the
 * extension's own expression, the banner located with the extension's own
 * detector, and the policy link taken from the banner's policy control — the
 * document the site itself puts forward as the answer to the question being
 * asked. Only where that has no chance (a portal page with no banner and no
 * link) does the site list name a URL, and it says why.
 *
 * That means this script tests the extraction path as much as it produces
 * fixtures. A policy the extension could not have reached does not enter the
 * corpus by the back door.
 *
 * Writes, per site:
 *   policy.txt — the extracted text, exactly what would be posted for analysis
 *   meta.json  — where it came from, how it was found, when, and how long it is
 *
 * Run with `npm run capture:policies`. It touches the network and real sites
 * change under it, so it is never part of `npm test`.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { locateBanner } from '../extension/src/content/banner-detector.js';
import { identifyCmp } from '../extension/src/content/cmp-adapters/index.js';
import { PROFILE_EXPRESSION, parsePageProfile } from '../extension/src/content/page-profile.js';
import {
  POLICY_TEXT_EXPRESSION,
  nextPolicyHop,
  parsePolicyText,
  policyUrlFrom,
} from '../extension/src/content/policy-text.js';
import { launchHarness } from './lib/harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITES = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/sites/phase5.json'), 'utf8'));
const OUT_DIR = join(ROOT, 'tests', 'fixtures', 'policies');

const HOME_SETTLE_MS = 8_000;
const POLICY_SETTLE_MS = 6_000;
const HUB_CHARACTERS = 2_500;
const NAVIGATION_TIMEOUT_MS = 30_000;

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]?.split(',')
  : null;

async function findPolicyUrl(page, site) {
  if (site.policyUrl) return { url: site.policyUrl, via: 'site-list' };

  const raw = await page.evaluate(PROFILE_EXPRESSION).catch(() => null);
  const profile = parsePageProfile(raw);
  const cmp = identifyCmp(profile);
  const banner = locateBanner(profile, cmp);
  return policyUrlFrom(banner, profile);
}

async function record(context, site) {
  const page = await context.newPage();
  const meta = {
    slug: site.slug,
    home: site.url,
    country: site.country ?? null,
    recordedAt: new Date().toISOString(),
    policyUrl: null,
    finalUrl: null,
    via: null,
    from: null,
    characters: 0,
    truncated: false,
    error: null,
  };

  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(HOME_SETTLE_MS);

    const { url, via } = await findPolicyUrl(page, site);
    meta.policyUrl = url;
    meta.via = via;
    if (!url) {
      meta.error = 'no policy link was found on the page';
      return { meta, text: '' };
    }

    const visit = async (target) => {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      await page.waitForTimeout(POLICY_SETTLE_MS);
      return parsePolicyText(await page.evaluate(POLICY_TEXT_EXPRESSION));
    };

    let read = await visit(url);
    /* The same one hop the extension takes when it lands on a hub page. */
    if (read.text.length < HUB_CHARACTERS) {
      const hop = nextPolicyHop(read);
      if (hop) {
        const deeper = await visit(hop).catch(() => null);
        if (deeper && deeper.text.length > read.text.length) {
          read = deeper;
          meta.via = `${meta.via}+hop`;
        }
      }
    }
    meta.finalUrl = read.url;
    meta.from = read.from;
    meta.characters = read.text.length;
    meta.truncated = read.truncated;
    meta.title = read.title;
    meta.lang = read.lang;
    if (read.text.length < 400) meta.error = `only ${read.text.length} characters of text`;
    return { meta, text: read.text };
  } catch (cause) {
    meta.error = String(cause?.message ?? cause).split('\n')[0];
    return { meta, text: '' };
  } finally {
    await page.close().catch(() => {});
  }
}

const harness = await launchHarness();
const results = [];

try {
  for (const site of SITES.sites) {
    if (only && !only.includes(site.slug)) continue;

    const { meta, text } = await record(harness.context, site);
    const directory = join(OUT_DIR, site.slug);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    /* A failed re-capture must not leave the previous run's text behind: a
       stale fixture whose meta says it failed is the worst of both. */
    if (text) writeFileSync(join(directory, 'policy.txt'), text, 'utf8');
    else rmSync(join(directory, 'policy.txt'), { force: true });

    results.push(meta);
    process.stdout.write(
      `${meta.error ? '·' : '✓'} ${site.slug.padEnd(16)} ${String(meta.characters).padStart(7)} chars  ${meta.via ?? '—'}  ${meta.error ?? meta.finalUrl ?? ''}\n`,
    );
  }
} finally {
  await harness.close();
}

const usable = results.filter((meta) => !meta.error).length;
process.stdout.write(`\n${usable}/${results.length} policies recorded\n`);
