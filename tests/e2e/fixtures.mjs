/*
 * Loads the built extension into a real Chromium profile.
 *
 * An unpacked extension needs a persistent context, so each test gets its own
 * throwaway user-data directory: a leaked profile between runs would carry
 * storage across tests and quietly invalidate exactly the kind of
 * before/after measurement this product exists to make.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, test as base } from '@playwright/test';

const EXTENSION_PATH = fileURLToPath(new URL('../../dist/extension', import.meta.url));

/* The container ships a Chromium that predates this Playwright release, so the
 * bundled download is skipped and the pre-installed binary is used instead. */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';

function executablePath() {
  const override = process.env.CHROMIUM_PATH;
  if (override) return override;
  return existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined;
}

export const test = base.extend({
  /** A persistent context with the built extension loaded. */
  context: async ({}, use) => {
    if (!existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`No build at ${EXTENSION_PATH} — run \`npm run build\` first`);
    }

    const profile = mkdtempSync(join(tmpdir(), 'consent-audit-profile-'));
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: executablePath(),
      channel: executablePath() ? undefined : 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    });

    try {
      await use(context);
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    }
  },

  /** The MV3 service worker registration, awaited. */
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  /** The extension id Chrome assigned to the unpacked build. */
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },

  /**
   * The popup, open as a tab.
   *
   * It doubles as the harness's way into the message protocol: only a page
   * served from the extension's own origin may talk to the service worker, and
   * a worker cannot deliver a message to itself.
   */
  extensionPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);
    await use(page);
    await page.close();
  },
});

/**
 * Send one protocol request to the service worker from an extension page and
 * return the response envelope.
 */
export function callBackground(page, type, payload = null) {
  return page.evaluate(
    ([messageType, messagePayload]) =>
      chrome.runtime.sendMessage({
        protocol: 1,
        kind: 'request',
        id: crypto.randomUUID(),
        type: messageType,
        payload: messagePayload,
        sentAt: Date.now(),
      }),
    [type, payload],
  );
}

export { expect } from '@playwright/test';
