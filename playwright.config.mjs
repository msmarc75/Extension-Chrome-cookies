import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // An unpacked extension is loaded through a persistent browser profile, and
  // two of those racing over the same Chromium build is a flake factory.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
});
