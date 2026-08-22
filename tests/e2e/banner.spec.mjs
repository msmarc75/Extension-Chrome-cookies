/*
 * Banner detection and refusal, end to end, against pages whose every byte is
 * known.
 *
 * The shapes come from the recorded corpus: a plain bar, a refusal one layer
 * deeper than the acceptance, a banner behind a shadow boundary, one inside a
 * cross-origin frame, and a page with nothing to consent to at all.
 */

import { callBackground, expect, test } from './fixtures.mjs';
import { startBannerSite } from './banner-site.mjs';

/** @type {Awaited<ReturnType<typeof startBannerSite>>} */
let site;

test.beforeAll(async () => {
  site = await startBannerSite();
});

test.afterAll(async () => {
  await site.close();
});

async function probe(page, path, { act = true } = {}) {
  const response = await callBackground(page, 'probe_banner', {
    url: `${site.origin}${path}`,
    mode: 'current',
    observationMs: 800,
    act,
  });
  expect(response.ok, response.ok ? '' : JSON.stringify(response.error)).toBe(true);
  return response.data;
}

test('capture A is taken before anything is pressed', async ({ extensionPage }) => {
  // The ordering the whole product rests on. If the probe ever interacted
  // first, this capture would be of a page that had already been answered.
  const result = await probe(extensionPage, '/plain');

  expect(result.captureA.phase).toBe('A');
  expect(result.captureA.interaction).toBe('none');
  expect(result.captureA.requests.length).toBeGreaterThan(0);
});

test('it finds a plain first-party banner and reads both answers', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/plain', { act: false });

  expect(result.banner.found).toBe(true);
  expect(result.cmp.id).toBeNull();
  expect(result.banner.confidence).toBe('heuristic');
  expect(result.banner.disclosure).toContain('No known consent platform');
  expect(result.banner.controls.accept.label).toBe('tout accepter');
  expect(result.banner.controls.refuse.label).toBe('tout refuser');
  expect(result.banner.controls.policy.label).toBe('politique de confidentialite');
});

test('it refuses on a plain banner, and the banner goes away', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/plain');

  expect(result.refusal.ok).toBe(true);
  expect(result.refusal.layer).toBe(1);
  expect(result.refusal.bannerGone).toBe(true);
});

test('it reaches a banner behind a shadow boundary', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/shadow');

  expect(result.banner.found).toBe(true);
  // "Continuer sans accepter" is a refusal despite containing "accepter".
  expect(result.banner.controls.refuse.label).toBe('continuer sans accepter');
  expect(result.refusal.ok).toBe(true);
});

test('it reaches a banner inside a cross-origin frame', async ({ extensionPage }) => {
  // Read only the top frame and this page looks like an empty wrapper — a site
  // with nothing to answer for. It is the most expensive miss available.
  const result = await probe(extensionPage, '/framed');

  expect(result.banner.found).toBe(true);
  expect(result.banner.controls.refuse.label).toBe('alle ablehnen');
  expect(result.refusal.ok).toBe(true);
});

test('it opens preferences when the first layer offers no refusal', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/second-layer');

  expect(result.banner.controls.accept.label).toBe('zustimmen');
  expect(result.banner.controls.refuse).toBeNull();
  expect(result.banner.controls.preferences.label).toBe('einstellungen');

  expect(result.refusal.ok).toBe(true);
  // Recorded, because a refusal buried a click deeper than the acceptance is
  // the imbalance the guidelines are about.
  expect(result.refusal.layer).toBe(2);
  expect(result.refusal.via).toBe('button-second-layer');
});

test('it finds no banner on a page that has none', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/clean', { act: false });

  expect(result.banner.found).toBe(false);
  expect(result.banner.method).toBe('none');
  expect(result.cmp.confidence).toBe('none');
});

test('it accepts as well as refuses, after starting over', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/plain');

  expect(result.refusal.ok).toBe(true);
  // The reset reloads the page, so the banner is back to be accepted.
  expect(result.acceptance.ok).toBe(true);
  expect(result.acceptance.bannerGone).toBe(true);
});

test('it judges what it measured, and never shows the score alone', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/plain');

  expect(result.report).toBeTruthy();
  expect(result.report.score).toBeGreaterThanOrEqual(0);
  expect(result.report.band.label.length).toBeGreaterThan(0);
  expect(result.report.findings.length).toBeGreaterThan(10);

  // Every failure carries the observation that produced it.
  for (const finding of result.report.findings) {
    if (finding.verdict !== 'fail') continue;
    expect(finding.evidence.length, `${finding.id} failed with no evidence`).toBeGreaterThan(0);
    expect(finding.legalBasis.length).toBeGreaterThan(0);
    expect(finding.remediation.length).toBeGreaterThan(20);
  }

  // And the report says what limited it.
  expect(result.report.disclosures.some((d) => /own profile/.test(d))).toBe(true);
});

test('a page with nothing to consent to is not marked down for it', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/clean', { act: false });

  expect(result.report.blockingFailures).toEqual([]);
  expect(result.report.provisional).toBe(true);
});
