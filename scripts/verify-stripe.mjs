#!/usr/bin/env node
/*
 * The purchase, against Stripe's own test mode.
 *
 * Everything about licensing that can be checked without a Stripe account is
 * checked in the test suite — including webhook signatures, which are generated
 * there by Stripe's own library. What is left is the part that needs Stripe:
 * that a Checkout session is really created, that a test card really completes
 * it, and that the webhook Stripe really sends produces a licence this service
 * really accepts.
 *
 * Run it like this:
 *
 *   # in one terminal, forward Stripe's webhooks to the local service
 *   stripe listen --forward-to localhost:8787/stripe/webhook
 *
 *   # in another, with the secret that `stripe listen` printed
 *   STRIPE_SECRET_KEY=sk_test_… \
 *   STRIPE_PRICE_PRO=price_… \
 *   STRIPE_WEBHOOK_SECRET=whsec_… \
 *   npm run verify:stripe
 *
 * It prints a Checkout URL, waits for a human to pay with 4242 4242 4242 4242,
 * then checks that a licence was issued and that verifying it answers the way
 * the extension expects. The whole run is in test mode; no money moves.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AnalysisCache } from '../server/cache.mjs';
import { createBilling, priceFor } from '../server/billing.mjs';
import { LicenceStore, verifyLicence } from '../server/licence.mjs';
import { createAnalysisServer } from '../server/index.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 3_000;

const say = (line) => process.stdout.write(`${line}\n`);

if (!process.env.STRIPE_SECRET_KEY) {
  say('STRIPE_SECRET_KEY is not set — nothing to verify against.');
  say('This run needs Stripe test-mode keys; see the header of this file.');
  process.exit(1);
}
if (!/^sk_test_/.test(process.env.STRIPE_SECRET_KEY)) {
  say('Refusing to run: STRIPE_SECRET_KEY is not a test key.');
  say('This script completes a real purchase flow. It runs in test mode only.');
  process.exit(1);
}
if (!priceFor('pro')) {
  say('STRIPE_PRICE_PRO is not set — there is no price to sell.');
  process.exit(1);
}

const licenceDir = process.env.CONSENT_AUDIT_LICENCE_DIR ?? mkdtempSync(join(tmpdir(), 'consent-audit-verify-licences-'));
const licences = new LicenceStore(licenceDir);
const billing = createBilling();

const server = createAnalysisServer({
  cache: new AnalysisCache(mkdtempSync(join(tmpdir(), 'consent-audit-verify-cache-'))),
  licences,
  billing,
  checkoutUrls: {
    successUrl: 'https://consent-audit.dev/thanks',
    cancelUrl: 'https://consent-audit.dev/pricing',
  },
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
say(`service on :${PORT}, licences in ${licenceDir}`);

const before = licences.all().length;

const checkout = await (
  await fetch(`http://127.0.0.1:${PORT}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan: 'pro', email: process.env.STRIPE_TEST_EMAIL ?? null }),
  })
).json();

if (!checkout.ok) {
  say(`checkout could not be created: ${JSON.stringify(checkout.error)}`);
  server.close();
  process.exit(1);
}

say('');
say('Open this and pay with 4242 4242 4242 4242, any future expiry, any CVC:');
say(`  ${checkout.data.url}`);
say('');
say('Waiting for Stripe to deliver the webhook…');

const startedAt = Date.now();
let issued = null;

while (Date.now() - startedAt < WAIT_MS) {
  const found = licences.all();
  if (found.length > before) {
    issued = found[found.length - 1];
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}

if (!issued) {
  say('');
  say('No licence was issued within ten minutes.');
  say('If the payment went through, `stripe listen` was probably not forwarding');
  say(`to localhost:${PORT}/stripe/webhook, or STRIPE_WEBHOOK_SECRET does not match`);
  say('the secret it printed.');
  server.close();
  process.exit(1);
}

say('');
say(`licence issued: ${issued.key}`);
say(`  plan ${issued.plan}, ${issued.email ?? 'no email'}, subscription ${issued.subscriptionId ?? '—'}`);

/* And the question the extension asks, asked the way the extension asks it. */
const verified = await (
  await fetch(`http://127.0.0.1:${PORT}/licence/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: issued.key }),
  })
).json();

const local = verifyLicence(licences, issued.key);
const days = Math.round((verified.data.recheckAfter - Date.now()) / (24 * 60 * 60 * 1000));

say('');
say(`verify → valid: ${verified.data.valid}, plan: ${verified.data.plan}, recheck in ${days} day(s)`);
say(`policy analysis included: ${local.entitlements?.policyAnalysis === true}`);
say('');
say(
  verified.data.valid && verified.data.plan === 'pro' && days === 7
    ? 'PASS — a test purchase produced a licence the extension will accept for seven days.'
    : 'FAIL — the licence was issued but does not verify as expected.',
);

server.close();
process.exitCode = verified.data.valid ? 0 : 1;
