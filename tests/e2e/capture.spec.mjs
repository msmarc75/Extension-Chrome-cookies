/*
 * Capture A against a real Chromium, a real debugger session and a real site.
 *
 * The unit tests prove the builder reads a CDP stream correctly. These prove
 * that the stream arrives at all, that it arrives early enough, and that the
 * whole thing is schema-valid coming out of the browser.
 */

import { readFileSync } from 'node:fs';
import { validate } from '../../shared/schema/validate.mjs';
import { callBackground, expect, test } from './fixtures.mjs';
import { startFixtureSite } from './fixture-site.mjs';

const schema = JSON.parse(
  readFileSync(new URL('../../shared/schema/capture.schema.json', import.meta.url), 'utf8'),
);

/** @type {Awaited<ReturnType<typeof startFixtureSite>>} */
let site;

test.beforeAll(async () => {
  site = await startFixtureSite();
});

test.afterAll(async () => {
  await site.close();
});

async function capture(page, url, observationMs = 1200) {
  const response = await callBackground(page, 'capture_pre_consent', {
    url,
    mode: 'current',
    observationMs,
  });
  expect(response.ok, response.ok ? '' : JSON.stringify(response.error)).toBe(true);
  return response.data;
}

test('the capture coming out of the browser matches the shared schema', async ({
  extensionPage,
}) => {
  const result = await capture(extensionPage, `${site.origin}/`);
  const { valid, errors } = validate(result, schema);

  expect(errors).toEqual([]);
  expect(valid).toBe(true);
});

test('it records the site, the third party, and which is which', async ({ extensionPage }) => {
  const result = await capture(extensionPage, `${site.origin}/`);

  const document = result.requests.find((r) => r.url === `${site.origin}/`);
  expect(document, 'the document request itself was not observed').toBeTruthy();
  expect(document.party).toBe('first');
  expect(document.status).toBe(200);
  expect(document.resourceType).toBe('Document');

  const tracker = result.requests.find((r) => r.url.endsWith('/tracker.js'));
  expect(tracker, 'the third-party script was not observed').toBeTruthy();
  expect(tracker.party).toBe('third');

  const pixel = result.requests.find((r) => r.url.includes('/pixel.gif'));
  expect(pixel, 'the third-party pixel was not observed').toBeTruthy();
  expect(pixel.party).toBe('third');
  expect(pixel.initiator.type).not.toBe('other');
});

test('the document request is observed, so the debugger attached before navigation', async ({
  extensionPage,
}) => {
  // This is the single assertion that guards the ordering the whole product
  // rests on. Attach after navigation and the document request is simply gone.
  const result = await capture(extensionPage, `${site.origin}/`);
  const first = result.requests[0];

  expect(first.url).toBe(`${site.origin}/`);
  expect(first.tMs).toBeGreaterThanOrEqual(0);
  expect(first.tMs).toBeLessThan(1000);
});

test('it dates the cookies the site set before asking anything', async ({ extensionPage }) => {
  const result = await capture(extensionPage, `${site.origin}/`);
  const byName = Object.fromEntries(result.cookies.map((c) => [c.name, c]));

  expect(byName.FIXTURESESSID, 'the header-set session cookie is missing').toBeTruthy();
  expect(byName.FIXTURESESSID.httpOnly).toBe(true);
  expect(byName.FIXTURESESSID.session).toBe(true);
  expect(byName.FIXTURESESSID.tMs).toBeGreaterThanOrEqual(0);

  expect(byName.ab_variant.session).toBe(false);
  expect(byName.ab_variant.expiresAt).toBeGreaterThan(Date.now());

  // Written from script. The protocol says nothing about when; the in-page
  // instrument watched the assignment, so it lands on the timeline anyway.
  expect(byName.written_by_script, 'the script-set cookie is missing').toBeTruthy();
  expect(byName.written_by_script.tMs).toBeGreaterThanOrEqual(0);
  expect(byName.written_by_script.tMs).toBeLessThan(2000);

  for (const cookie of result.cookies) {
    expect(cookie).not.toHaveProperty('value');
  }
});

test('it records the storage write with its key and its moment', async ({ extensionPage }) => {
  const result = await capture(extensionPage, `${site.origin}/`);
  const local = result.storage.find((s) => s.key === 'visitor_id');

  expect(local, 'the localStorage write was not observed').toBeTruthy();
  expect(local.type).toBe('localStorage');
  expect(local.source).toBe('event');
  expect(local.tMs).toBeGreaterThanOrEqual(0);
  expect(local.origin).toBe(site.origin);
});

test('the capture declares what it is and how it was taken', async ({ extensionPage }) => {
  const result = await capture(extensionPage, `${site.origin}/`);

  expect(result.phase).toBe('A');
  expect(result.interaction).toBe('none');
  expect(result.profile).toBe('current');
  expect(result.target.finalUrl).toBe(`${site.origin}/`);
  expect(result.window.navigationCommittedAt).not.toBeNull();
  expect(result.notes).toEqual([]);
});

test('a page that never answers still yields a capture and releases the tab', async ({
  extensionPage,
}) => {
  const before = await callBackground(extensionPage, 'get_status');
  const startedAt = Date.now();
  const result = await capture(extensionPage, site.slowUrl, 800);

  expect(result.requests.length).toBeGreaterThan(0);
  expect(result.requests[0].status).toBeNull();
  expect(result.window.navigationCommittedAt).toBeNull();
  expect(result.notes.map((n) => n.code)).toContain('NAVIGATION_INCOMPLETE');

  // A page that never answers must not be able to stretch the audit: the
  // window is closed on time and the page is not questioned afterwards.
  expect(Date.now() - startedAt).toBeLessThan(8000);

  const after = await callBackground(extensionPage, 'get_status');
  expect(after.data.liveDebuggerSessions).toBe(before.data.liveDebuggerSessions);
});

test('an unauditable scheme is refused before a tab is ever opened', async ({ extensionPage }) => {
  const response = await callBackground(extensionPage, 'capture_pre_consent', {
    url: 'chrome://settings',
    mode: 'current',
  });

  expect(response.ok).toBe(false);
  expect(response.error.message).toContain('UNSUPPORTED_SCHEME');
});
