#!/usr/bin/env node
/*
 * The store screenshots, taken from a real audit.
 *
 * Not mock-ups. The Chrome Web Store shows these to people deciding whether to
 * trust the thing, and a screenshot assembled by hand is a claim nobody checked
 * — so this runs the extension against a live site and photographs what came
 * back, at the 1280×800 the store asks for.
 *
 * Run with `npm run store:screenshots -- https://www.lemonde.fr/`. It touches
 * the network and is never part of `npm test`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchHarness } from './lib/harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs', 'store', 'screenshots');

/* What the store wants, exactly. Anything else is rejected or letterboxed. */
const WIDTH = 1280;
const HEIGHT = 800;

const target = process.argv.find((argument) => argument.startsWith('http')) ?? 'https://www.lemonde.fr/';

const harness = await launchHarness({ extension: true, deviceScaleFactor: 2 });

try {
  const worker =
    harness.context.serviceWorkers()[0] ?? (await harness.context.waitForEvent('serviceworker'));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ready = await worker
      .evaluate(() => Boolean(globalThis.chrome?.debugger && globalThis.setTimeout))
      .catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const extensionId = new URL(worker.url()).host;

  /* A licence, so the screenshots show the product rather than its paywall. */
  const popup = await harness.context.newPage();
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);
  await popup.evaluate(
    ([until]) =>
      chrome.storage.local.set({
        licence: {
          key: 'CA-DEMO-DEMO-DEMO-DEMO',
          plan: 'pro',
          valid: true,
          checkedAt: Date.now(),
          recheckAfter: until,
          expiresAt: until,
          lastError: null,
        },
      }),
    [Date.now() + 30 * 24 * 60 * 60 * 1000],
  );

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
  if (!response?.ok) throw new Error(`the audit failed: ${JSON.stringify(response?.error)}`);

  mkdirSync(OUT, { recursive: true });

  const report = await harness.context.newPage();
  await report.setViewportSize({ width: WIDTH, height: HEIGHT });
  await report.goto(
    `chrome-extension://${extensionId}/src/ui/report/report.html?audit=${response.data.auditId}`,
  );
  await report.waitForSelector('.ca-lane');

  /**
   * A shot of exactly 1280×800, framed on one section.
   *
   * Scrolled to the element rather than cropped around it: the store's frame is
   * fixed, and a section photographed with the page's own margins around it is
   * what a user will actually see.
   */
  const frame = async (name, selector, offset = -80) => {
    const box = await report.locator(selector).first().boundingBox();
    const top = Math.max(0, (box?.y ?? 0) + (await report.evaluate(() => window.scrollY)) + offset);
    await report.evaluate((to) => window.scrollTo(0, to), top);
    await report.waitForTimeout(150);
    const shot = await report.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    writeFileSync(join(OUT, name), shot);
    process.stdout.write(`  ${name}\n`);
  };

  /* 1 — the timeline, which is the product. */
  await frame('1-deposit-timeline.png', '.ca-timeline', -180);
  /* 2 — the verdict, with everything that qualifies it. */
  await frame('2-verdict.png', '.ca-score', -60);
  /* 3 — a finding with its evidence and its remediation. */
  await frame('3-findings.png', '.ca-finding', -60);
  /* 4 — the policy table, where each row carries the sentence it rests on. */
  const policy = await report.locator('[data-field="policy-section"]').isVisible();
  if (policy) await frame('4-policy.png', '.ca-table', -60);
  else process.stdout.write('  (no policy analysis in this audit — screenshot 4 skipped)\n');

  /*
   * 5 — the popup, showing the result of an audit rather than its start screen:
   * it is the screen a user spends time on. Driven through the extension's own
   * button, in the current-profile mode this harness can reach.
   */
  /*
   * The popup, showing the audit that was just run — which is what it shows
   * when a user reopens it, and the screen they spend time on. No clicking
   * needed: the result is read back from the same local history the report uses.
   */
  await popup.reload();
  await popup.waitForSelector('[data-view="result"]:not([hidden])', { timeout: 60_000 });
  const shot = await popup.screenshot();
  const canvas = await harness.context.newPage();
  await canvas.setViewportSize({ width: WIDTH, height: HEIGHT });
  await canvas.setContent(
    `<div style="width:${WIDTH}px;height:${HEIGHT}px;display:grid;place-items:center;background:#f2efe9">
       <img src="data:image/png;base64,${shot.toString('base64')}"
            style="height:720px;box-shadow:0 8px 40px rgba(0,0,0,.18);border-radius:6px">
     </div>`,
  );
  writeFileSync(
    join(OUT, '5-popup.png'),
    await canvas.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } }),
  );
  process.stdout.write('  5-popup.png\n');

  process.stdout.write(`\nwrote ${WIDTH}×${HEIGHT} screenshots to docs/store/screenshots\n`);
} finally {
  await harness.close();
}
