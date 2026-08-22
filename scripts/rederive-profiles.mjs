#!/usr/bin/env node
/*
 * Re-reads the saved pages with the current collector, without touching the
 * network.
 *
 * The corpus takes ten minutes to record and the sites move under it, so tuning
 * the collector against live pages would mean tuning against a moving target
 * and waiting ten minutes to see each result. The saved `page.html` files are
 * fixed, so the loop is seconds, and every fixture stays comparable to every
 * other.
 *
 * What a saved page cannot give back is `window.__tcfapi` and friends — the
 * fixtures are deliberately inert. Those fields are kept from the live
 * recording and only the DOM-derived parts are replaced.
 *
 * Run with `npm run rederive:profiles` after changing page-profile.js.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PROFILE_EXPRESSION, parsePageProfile } from '../extension/src/content/page-profile.js';
import { launchHarness } from './lib/harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BANNERS = join(ROOT, 'tests', 'fixtures', 'banners');

async function main() {
  const slugs = readdirSync(BANNERS).filter((slug) =>
    existsSync(join(BANNERS, slug, 'page.html')),
  );
  if (slugs.length === 0) {
    process.stderr.write(
      'No saved pages. Run `npm run capture:fixtures` first — page.html is not committed.\n',
    );
    process.exit(1);
  }

  const { context, close } = await launchHarness();
  const page = await context.newPage();
  const rows = [];

  for (const slug of slugs) {
    const directory = join(BANNERS, slug);
    await page.goto(pathToFileURL(join(directory, 'page.html')).href, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    /* Give layout a moment: geometry is half of what the profile records. */
    await page.waitForTimeout(300);

    const derived = await page.evaluate(PROFILE_EXPRESSION).then(parsePageProfile);

    const path = join(directory, 'profile.json');
    const live = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};

    const merged = {
      ...derived,
      /* Only a live page can answer these. */
      url: live.url ?? derived.url,
      globals: live.globals ?? [],
      tcf: live.tcf ?? null,
      rederivedFromSavedPage: true,
    };
    writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);

    rows.push({ slug, containers: merged.containers.length });
  }

  await close();

  for (const row of rows) {
    process.stdout.write(`${row.slug.padEnd(18)} ${String(row.containers).padStart(3)} containers\n`);
  }
}

await main();
