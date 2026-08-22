/*
 * Licensing, in the browser, against a real licence server.
 *
 * The server is the project's own, started here with a Stripe double that signs
 * webhooks with Stripe's own library. So the path exercised is the whole one: a
 * purchase completes, a key is issued, the extension is given that key, checks
 * it, caches the answer, and lets the audit do what the plan allows.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';

import { AnalysisCache } from '../../server/cache.mjs';
import { LicenceStore } from '../../server/licence.mjs';
import { createAnalysisServer } from '../../server/index.mjs';
import { callBackground, expect, test } from './fixtures.mjs';
import { startBannerSite } from './banner-site.mjs';

const WEBHOOK_SECRET = 'whsec_end_to_end';
const stripe = new Stripe('sk_test_not_a_real_key');

/** @type {Awaited<ReturnType<typeof startBannerSite>>} */
let site;
let service;
let licences;
const directories = [];

const completedSession = () =>
  JSON.stringify({
    id: 'evt_e2e',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_e2e',
        payment_status: 'paid',
        customer: 'cus_e2e',
        subscription: 'sub_e2e',
        customer_details: { email: 'dpo@example.fr' },
        metadata: { plan: 'pro' },
      },
    },
  });

test.beforeAll(async () => {
  site = await startBannerSite();

  const licenceDir = mkdtempSync(join(tmpdir(), 'consent-audit-e2e-licences-'));
  const cacheDir = mkdtempSync(join(tmpdir(), 'consent-audit-e2e-cache-'));
  directories.push(licenceDir, cacheDir);
  licences = new LicenceStore(licenceDir);

  const server = createAnalysisServer({
    cache: new AnalysisCache(cacheDir),
    licences,
    ask: async () => ({ model: 'stub', mentions: [] }),
    billing: {
      constructEvent: (raw, signature) =>
        stripe.webhooks.constructEvent(raw, signature, WEBHOOK_SECRET),
      createCheckout: async ({ plan }) => ({
        id: `cs_${plan}`,
        url: `https://checkout.stripe.test/${plan}`,
      }),
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  service = {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  };
});

test.afterAll(async () => {
  await site.close();
  await service.close();
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/** Complete a purchase the way Stripe would, and return the issued key. */
async function purchase() {
  const body = completedSession();
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  });
  const response = await fetch(`${service.origin}/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body,
  });
  expect(response.status).toBe(200);
  return licences.all()[0].key;
}

const audit = (page, extra = {}) =>
  callBackground(page, 'probe_banner', {
    url: `${site.origin}/plain`,
    mode: 'current',
    observationMs: 500,
    act: false,
    analysePolicy: false,
    ...extra,
  });

test('a fresh installation is on the free plan, with its allowance intact', async ({
  extensionPage,
}) => {
  const state = await callBackground(extensionPage, 'licence_state');

  expect(state.ok).toBe(true);
  expect(state.data.allowance.plan).toBe('free');
  expect(state.data.allowance.auditsLeft).toBe(5);
  expect(state.data.allowance.policyAnalysis).toBe(false);
});

test('a purchased key is accepted, and unlocks what it paid for', async ({ extensionPage }) => {
  const key = await purchase();

  const saved = await callBackground(extensionPage, 'licence_set', {
    key,
    origin: service.origin,
  });

  expect(saved.ok).toBe(true);
  expect(saved.data.licence.valid).toBe(true);
  expect(saved.data.licence.plan).toBe('pro');
  expect(saved.data.allowance.policyAnalysis).toBe(true);
  expect(saved.data.allowance.auditsLeft).toBeNull();

  /* And the answer is cached with a date to ask again — seven days out. */
  const week = 7 * 24 * 60 * 60 * 1000;
  expect(saved.data.licence.recheckAfter - Date.now()).toBeGreaterThan(week * 0.9);
});

test('a key that was never issued is refused, and the refusal is explained', async ({
  extensionPage,
}) => {
  const saved = await callBackground(extensionPage, 'licence_set', {
    key: 'CA-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
    origin: service.origin,
  });

  expect(saved.data.licence.valid).toBe(false);
  expect(saved.data.licence.reason).toBe('UNKNOWN_KEY');
  expect(saved.data.allowance.plan).toBe('free');
});

test('an unreachable service does not cut off a paying installation', async ({
  extensionPage,
}) => {
  const key = await purchase();
  await callBackground(extensionPage, 'licence_set', { key, origin: service.origin });

  /* The same call, pointed at a port nothing is listening on. */
  const degraded = await callBackground(extensionPage, 'licence_set', {
    key,
    origin: 'http://127.0.0.1:1',
  });

  expect(degraded.data.allowance.plan).toBe('pro');
  expect(degraded.data.licence.lastError).toMatch(/UNREACHABLE/);
});

test('the free allowance is counted, and the audit is refused once it is spent', async ({
  extensionPage,
}) => {
  /* Seven audits and a purchase, each opening a tab of its own. */
  test.setTimeout(120_000);
  for (let index = 0; index < 5; index += 1) {
    const response = await audit(extensionPage);
    expect(response.ok, `audit ${index} was refused`).toBe(true);
    expect(response.data.allowance.plan).toBe('free');
    expect(response.data.allowance.auditsLeft).toBe(4 - index);
  }

  const refused = await audit(extensionPage);
  expect(refused.ok).toBe(false);
  expect(refused.error.message).toContain('ALLOWANCE_EXHAUSTED');

  /* A licence lifts it immediately, with no reinstall and no restart. */
  const key = await purchase();
  await callBackground(extensionPage, 'licence_set', { key, origin: service.origin });

  const allowed = await audit(extensionPage);
  expect(allowed.ok).toBe(true);
  expect(allowed.data.allowance.plan).toBe('pro');
});

test('the free plan is told about policy analysis rather than billed for it', async ({
  extensionPage,
}) => {
  const response = await audit(extensionPage, { analysePolicy: true });

  expect(response.ok).toBe(true);
  expect(response.data.policy.analysis ?? null).toBeNull();
  expect(response.data.policy.error.code).toBe('PLAN_WITHOUT_POLICY_ANALYSIS');
});

test('the popup shows the plan without being asked', async ({ extensionPage }) => {
  await extensionPage.reload();
  await expect(extensionPage.locator('[data-field="plan-line"]')).toContainText('Plan: free');
  await expect(extensionPage.locator('[data-field="plan-line"]')).toContainText(
    'audits left this month',
  );
});
