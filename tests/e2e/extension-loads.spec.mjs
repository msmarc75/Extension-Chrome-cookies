/*
 * The extension loads without error, the popup opens, and a message makes the
 * round trip to the service worker and back.
 */

import { readFileSync } from 'node:fs';
import { callBackground, expect, test } from './fixtures.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../../dist/extension/manifest.json', import.meta.url), 'utf8'),
);

test('the service worker registers under the extension id', async ({ worker, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  expect(worker.url()).toBe(
    `chrome-extension://${extensionId}/${manifest.background.service_worker}`,
  );
});

test('a message makes the round trip', async ({ extensionPage }) => {
  const response = await callBackground(extensionPage, 'ping', { hello: 'world' });

  expect(response.ok).toBe(true);
  expect(response.data.pong).toBe(true);
  expect(response.data.echo).toEqual({ hello: 'world' });
});

test('the popup reads its own version off the service worker', async ({ extensionPage }) => {
  await expect(extensionPage.locator('[data-field="version"]')).toHaveText(`v${manifest.version}`);
});

test('without incognito access the popup says so instead of failing', async ({ extensionPage }) => {
  // An automated profile has no way to tick Chrome's incognito box, so this is
  // the state the harness always lands in — and it is a state real users hit.
  await expect(extensionPage.locator('[data-view="blocked"]')).toBeVisible();
  await expect(extensionPage.locator('[data-view="ready"]')).toBeHidden();
  await expect(extensionPage.locator('[data-view="blocked"] h2')).toHaveText(
    'Incognito access required',
  );
});

test('nothing logs an error while the popup runs', async ({ page, extensionId, worker }) => {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`popup console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`popup uncaught: ${error.message}`));
  worker.on('console', (message) => {
    if (message.type() === 'error') problems.push(`worker console: ${message.text()}`);
  });

  await page.goto(`chrome-extension://${extensionId}/${manifest.action.default_popup}`);
  await expect(page.locator('[data-view="blocked"]')).toBeVisible();

  expect(problems).toEqual([]);
});

test('the popup renders at its declared 400 × 600 footprint', async ({ extensionPage }) => {
  const box = await extensionPage.locator('body').boundingBox();

  expect(box.width).toBe(400);
  expect(box.height).toBe(600);
});
