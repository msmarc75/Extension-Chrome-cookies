/*
 * Phase 2 acceptance: no orphan debugger session after a hundred audits.
 *
 * An attachment that outlives its audit is a defect the user cannot clear —
 * Chrome pins its warning bar to the tab and leaves it there. The run below
 * deliberately mixes the paths that would leak one: ordinary captures, a page
 * that never answers, and a URL refused before any tab is opened.
 */

import { callBackground, expect, test } from './fixtures.mjs';
import { startFixtureSite } from './fixture-site.mjs';

const AUDITS = 100;
const OBSERVATION_MS = 150;

/** @type {Awaited<ReturnType<typeof startFixtureSite>>} */
let site;

test.beforeAll(async () => {
  site = await startFixtureSite();
});

test.afterAll(async () => {
  await site.close();
});

/*
 * Which targets is the *extension* attached to?
 *
 * `getTargets()` reports `attached` for anyone's session, and the test harness
 * drives Chromium over CDP itself, so that flag says nothing. Only the owner of
 * a session can detach it — so attempting to detach, and counting what
 * succeeds, measures exactly the extension's own attachments. In a passing run
 * every attempt fails and nothing is released.
 */
const releaseExtensionSessions = (worker) =>
  worker.evaluate(async () => {
    const targets = await chrome.debugger.getTargets();
    const released = [];
    for (const target of targets) {
      if (typeof target.tabId !== 'number') continue;
      try {
        await chrome.debugger.detach({ tabId: target.tabId });
        released.push(target.url);
      } catch {
        /* Not ours. */
      }
    }
    return released;
  });

test('a hundred audits leave no debugger session behind', async ({
  extensionPage,
  worker,
  context,
}) => {
  test.setTimeout(300_000);

  const tabsBefore = context.pages().length;
  expect(await releaseExtensionSessions(worker)).toEqual([]);

  let completed = 0;
  let refused = 0;

  for (let index = 0; index < AUDITS; index += 1) {
    /* Every seventh audit hangs; every eleventh is refused outright. */
    const url =
      index % 11 === 10
        ? 'chrome://settings'
        : index % 7 === 6
          ? site.slowUrl
          : `${site.origin}/?run=${index}`;

    const response = await callBackground(extensionPage, 'capture_pre_consent', {
      url,
      mode: 'current',
      observationMs: OBSERVATION_MS,
    });

    if (response.ok) {
      completed += 1;
      expect(response.data.schemaVersion).toBe(1);
    } else {
      refused += 1;
      expect(response.error.message).toContain('UNSUPPORTED_SCHEME');
    }

    const status = await callBackground(extensionPage, 'get_status');
    expect(status.data.liveDebuggerSessions, `after audit ${index}`).toBe(0);
  }

  expect(completed + refused).toBe(AUDITS);
  expect(refused).toBeGreaterThan(0);

  expect(await releaseExtensionSessions(worker)).toEqual([]);
  expect(context.pages().length, 'audit tabs were left open').toBe(tabsBefore);
});

test('a second audit is refused while one is running, not silently queued', async ({
  extensionPage,
}) => {
  const first = callBackground(extensionPage, 'capture_pre_consent', {
    url: `${site.origin}/`,
    mode: 'current',
    observationMs: 1500,
  });
  /* Give the first one time to take the lock before the second arrives. */
  await new Promise((resolve) => setTimeout(resolve, 250));
  const second = await callBackground(extensionPage, 'capture_pre_consent', {
    url: `${site.origin}/`,
    mode: 'current',
    observationMs: 200,
  });

  expect(second.ok).toBe(false);
  expect(second.error.message).toContain('BUSY');
  expect((await first).ok).toBe(true);
});
