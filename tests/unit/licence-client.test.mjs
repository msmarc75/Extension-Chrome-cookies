/*
 * The half of licensing that decides what to do when the answer does not come.
 *
 * Every branch here is a morning somebody has had: the laptop on a train, the
 * office proxy that blocks an unknown domain, the service being redeployed, the
 * card that expired last week. What the tests below pin down is that none of
 * those turns a paying customer's tool off, and that none of them turns the
 * free tier into an unlimited one either.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const wanted = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of wanted) if (store.has(key)) out[key] = store.get(key);
        return out;
      },
      set: async (entries) => {
        for (const [key, value] of Object.entries(entries)) store.set(key, value);
      },
      remove: async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
      },
    },
  },
};

const {
  CACHE_MS,
  FREE_AUDITS_PER_MONTH,
  GRACE_MS,
  auditAllowance,
  auditCounter,
  countAudit,
  entitlementsFor,
  monthOf,
  setLicenceKey,
  storedLicence,
  verifyLicence,
} = await import('../../extension/src/background/licence.js');

const KEY = 'CA-ABCD-EFGH-JKMN-PQRS';
const NOW = Date.parse('2026-08-22T09:00:00Z');

const answering = (data, { status = 200 } = {}) =>
  async () => ({
    ok: status < 400,
    status,
    json: async () => ({ ok: status < 400, data }),
  });

const refusing = () => async () => {
  throw new Error('net::ERR_NAME_NOT_RESOLVED');
};

beforeEach(() => store.clear());

describe('asking the service', () => {
  it('stores what it was told, and when to ask again', async () => {
    await setLicenceKey(KEY);
    const licence = await verifyLicence({
      now: NOW,
      origin: 'https://service.test',
      request: answering({
        valid: true,
        plan: 'pro',
        expiresAt: NOW + 365 * 24 * 60 * 60 * 1000,
        recheckAfter: NOW + CACHE_MS,
      }),
    });

    assert.equal(licence.valid, true);
    assert.equal(licence.plan, 'pro');
    assert.equal(licence.recheckAfter, NOW + CACHE_MS);
    assert.equal((await storedLicence()).plan, 'pro');
  });

  it('does not ask again while the answer is fresh', async () => {
    await setLicenceKey(KEY);
    let calls = 0;
    const request = async (...args) => {
      calls += 1;
      return answering({ valid: true, plan: 'pro', recheckAfter: NOW + CACHE_MS })(...args);
    };

    await verifyLicence({ now: NOW, origin: 'https://service.test', request });
    await verifyLicence({ now: NOW + CACHE_MS - 1, origin: 'https://service.test', request });
    assert.equal(calls, 1);

    await verifyLicence({ now: NOW + CACHE_MS + 1, origin: 'https://service.test', request });
    assert.equal(calls, 2);
  });

  it('keeps the last good answer when the service cannot be reached', async () => {
    await setLicenceKey(KEY);
    await verifyLicence({
      now: NOW,
      origin: 'https://service.test',
      request: answering({ valid: true, plan: 'pro', recheckAfter: NOW + CACHE_MS }),
    });

    const later = await verifyLicence({
      now: NOW + CACHE_MS + 1,
      origin: 'https://service.test',
      request: refusing(),
    });

    assert.equal(later.valid, true, 'a paying customer was cut off by our own outage');
    assert.equal(later.degraded, true);
    assert.match(later.lastError, /UNREACHABLE/);
  });

  it('does not invent a licence for an installation that never had one', async () => {
    const licence = await verifyLicence({ now: NOW, origin: 'https://service.test', request: refusing() });
    assert.equal(licence.valid, false);
    assert.equal(licence.reason, 'NO_KEY');
  });
});

describe('what the installation may do', () => {
  const paid = (overrides = {}) => ({
    key: KEY,
    plan: 'pro',
    valid: true,
    reason: null,
    checkedAt: NOW,
    recheckAfter: NOW + CACHE_MS,
    expiresAt: NOW + 365 * 24 * 60 * 60 * 1000,
    lastError: null,
    ...overrides,
  });
  const counter = (used = 0, at = NOW) => ({ used, month: monthOf(at) });

  it('gives a fresh licence everything it paid for', () => {
    const state = entitlementsFor(paid(), counter(), NOW);
    assert.equal(state.plan, 'pro');
    assert.equal(state.entitlements.policyAnalysis, true);
    assert.equal(state.auditsLeft, null);
    assert.equal(state.degraded, false);
  });

  it('honours a stale one through the grace period, and says it is doing so', () => {
    const state = entitlementsFor(paid(), counter(), NOW + CACHE_MS + 1);

    assert.equal(state.plan, 'pro');
    assert.equal(state.degraded, true);
    assert.match(state.note, /could not be reached/);
  });

  it('drops to the free allowance once the grace is over, and never below it', () => {
    const lapsed = NOW + CACHE_MS + GRACE_MS + 1;
    const state = entitlementsFor(paid(), counter(2, lapsed), lapsed);

    assert.equal(state.plan, 'free');
    assert.equal(state.entitlements.policyAnalysis, false);
    assert.equal(state.auditsLeft, FREE_AUDITS_PER_MONTH - 2);
    assert.match(state.note, /two weeks/);
  });

  it('drops immediately when the licence itself has ended', () => {
    /* An expiry is not an outage: the answer arrived and said no. */
    const state = entitlementsFor(paid({ expiresAt: NOW - 1 }), counter(), NOW);

    assert.equal(state.plan, 'free');
    assert.match(state.note, /has ended/);
  });

  it('counts the free allowance by calendar month', () => {
    const august = entitlementsFor({ valid: false, plan: 'free' }, counter(5), NOW);
    assert.equal(august.auditsLeft, 0);

    /* A counter from another month is not this month's usage. */
    const september = entitlementsFor(
      { valid: false, plan: 'free' },
      counter(5, NOW),
      Date.parse('2026-09-01T09:00:00Z'),
    );
    assert.equal(september.auditsLeft, FREE_AUDITS_PER_MONTH);
  });
});

describe('the local counter', () => {
  it('counts audits, and forgets them when the month turns', async () => {
    await countAudit(NOW);
    await countAudit(NOW);
    assert.equal((await auditCounter(NOW)).used, 2);

    const nextMonth = Date.parse('2026-09-02T09:00:00Z');
    assert.equal((await auditCounter(nextMonth)).used, 0);
  });

  it('refuses the audit after the allowance is spent, and says why', async () => {
    for (let index = 0; index < FREE_AUDITS_PER_MONTH; index += 1) await countAudit(NOW);

    const allowance = await auditAllowance(NOW);
    assert.equal(allowance.allowed, false);
    assert.equal(allowance.auditsLeft, 0);
    assert.match(allowance.reason, /allowance of 5 audits/);
    assert.equal(allowance.policyAnalysis, false);
  });

  it('never refuses a paying installation', async () => {
    store.set('licence', {
      key: KEY,
      plan: 'pro',
      valid: true,
      checkedAt: NOW,
      recheckAfter: NOW + CACHE_MS,
      expiresAt: NOW + CACHE_MS * 52,
    });
    for (let index = 0; index < 50; index += 1) await countAudit(NOW);

    const allowance = await auditAllowance(NOW);
    assert.equal(allowance.allowed, true);
    assert.equal(allowance.auditsLeft, null);
    assert.equal(allowance.policyAnalysis, true);
  });
});
