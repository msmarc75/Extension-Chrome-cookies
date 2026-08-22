/*
 * Phase 1 acceptance: the extension loads without error, the popup opens, and
 * a message makes the round trip to the service worker and back.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../../dist/extension/manifest.json', import.meta.url), 'utf8'),
);

const popupUrl = (extensionId) =>
  `chrome-extension://${extensionId}/${manifest.action.default_popup}`;

test('the service worker registers under the extension id', async ({ worker, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  expect(worker.url()).toBe(
    `chrome-extension://${extensionId}/${manifest.background.service_worker}`,
  );
});

test('the popup opens and reports the round trip as clear', async ({ page, extensionId }) => {
  await page.goto(popupUrl(extensionId));

  const verdict = page.locator('[data-field="verdict"]');
  await expect(verdict).toHaveAttribute('data-state', 'clear');
  await expect(page.locator('[data-field="verdict-label"]')).toHaveText(
    'Service worker responding',
  );

  // The state is legible without colour: a mark and a label carry it too.
  await expect(page.locator('[data-field="verdict-mark"]')).toHaveText('✓');

  await expect(page.locator('[data-field="version"]')).toHaveText(`v${manifest.version}`);
  await expect(page.locator('[data-field="protocol"]')).toHaveText('v1');
  await expect(page.locator('[data-field="latency"]')).toHaveText(/^\d+\.\d ms$/);
  await expect(page.locator('[data-field="worker"]')).toHaveText(/^up \d+ ms$/);
});

test('the self-check button re-runs the round trip', async ({ page, extensionId }) => {
  await page.goto(popupUrl(extensionId));
  await expect(page.locator('[data-field="latency"]')).not.toHaveText('—');

  await page.locator('[data-field="latency"]').evaluate((node) => {
    node.textContent = 'stale';
  });
  await page.locator('[data-action="self-check"]').click();

  await expect(page.locator('[data-field="latency"]')).toHaveText(/^\d+\.\d ms$/);
  await expect(page.locator('[data-action="self-check"]')).toBeEnabled();
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

  await page.goto(popupUrl(extensionId));
  await expect(page.locator('[data-field="verdict"]')).toHaveAttribute('data-state', 'clear');
  await page.locator('[data-action="self-check"]').click();
  await expect(page.locator('[data-action="self-check"]')).toBeEnabled();

  expect(problems).toEqual([]);
});

test('the popup renders at its declared 400 × 600 footprint', async ({ page, extensionId }) => {
  await page.goto(popupUrl(extensionId));

  const box = await page.locator('body').boundingBox();
  expect(box.width).toBe(400);
  expect(box.height).toBe(600);
});
