/*
 * Licences: issuing them, storing them, answering questions about them.
 *
 * The shape of the thing is decided by where it has to work. The extension runs
 * in a browser that will be offline, on a laptop that will be shut, behind a
 * corporate proxy that will block this service on a Tuesday for no reason
 * anybody can explain — so a licence is a *key the client can check locally for
 * seven days*, not a permission asked for on every use. This file issues and
 * answers; extension/src/background/licence.js is the half that decides what to
 * do when the answer does not arrive.
 *
 * What is stored is deliberately thin: a key, a plan, a status, two dates and
 * the Stripe ids needed to reconcile a refund. No audit, no site, no report —
 * the licence server must never learn what its customers audit, and the only
 * way to guarantee that is not to have the data.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How long a verification may be trusted by the client without asking again. */
export const CACHE_DAYS = 7;

/** What each plan allows. The extension enforces it; this states it. */
export const PLANS = Object.freeze({
  free: { id: 'free', label: 'Free', auditsPerMonth: 5, policyAnalysis: false, batch: false },
  pro: { id: 'pro', label: 'Pro', auditsPerMonth: null, policyAnalysis: true, batch: false },
  agency: { id: 'agency', label: 'Agency', auditsPerMonth: null, policyAnalysis: true, batch: true },
});

export const STATUS = Object.freeze({
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
});

/*
 * Key format: CA-XXXX-XXXX-XXXX-XXXX, Crockford's alphabet without the letters
 * that get misread. A customer reads this off an invoice and types it into a
 * popup; an O/0 confusion in that moment is a support ticket.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newLicenceKey(random = randomBytes) {
  const bytes = random(16);
  let out = '';
  for (let index = 0; index < 16; index += 1) {
    out += ALPHABET[bytes[index] % ALPHABET.length];
    if (index % 4 === 3 && index !== 15) out += '-';
  }
  return `CA-${out}`;
}

export const isLicenceKey = (value) => /^CA-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(String(value ?? ''));

/*
 * Stored under the hash of the key, never under the key itself. Whoever ends up
 * reading a backup of this directory learns which licences exist and what they
 * are worth, and cannot use one.
 */
const fileFor = (key) => `${createHash('sha256').update(String(key)).digest('hex')}.json`;

export class LicenceStore {
  /** @param {string} directory */
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
  }

  #path(key) {
    if (!isLicenceKey(key)) throw new Error('Not a licence key');
    return join(this.directory, fileFor(key));
  }

  /** @returns {object|null} */
  read(key) {
    let path;
    try {
      path = this.#path(key);
    } catch {
      return null;
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }

  write(record) {
    const path = this.#path(record.key);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
    return record;
  }

  /** Every record, for reconciliation. Not an endpoint — an operator's tool. */
  all() {
    return readdirSync(this.directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        try {
          return JSON.parse(readFileSync(join(this.directory, name), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  /** Find by Stripe id, which is what a webhook carries instead of a key. */
  findBy(field, value) {
    if (!value) return null;
    return this.all().find((record) => record[field] === value) ?? null;
  }
}

/**
 * Issue a licence for a completed payment.
 *
 * Idempotent on the Stripe session id: webhooks are delivered more than once by
 * design, and a customer who is sent two keys for one payment has been given a
 * problem rather than a product.
 */
export function issueLicence(store, { plan, email, sessionId, customerId, subscriptionId, now = Date.now(), key = newLicenceKey() }) {
  const existing = store.findBy('sessionId', sessionId);
  if (existing) return { record: existing, reissued: true };

  const record = {
    key,
    plan: PLANS[plan] ? plan : 'pro',
    status: STATUS.ACTIVE,
    email: email ?? null,
    issuedAt: now,
    /* A year, renewed by the subscription's own webhook. An expiry the client
       can read is what lets it fail open safely: it knows when to stop. */
    expiresAt: now + 365 * 24 * 60 * 60 * 1000,
    sessionId: sessionId ?? null,
    customerId: customerId ?? null,
    subscriptionId: subscriptionId ?? null,
    revokedAt: null,
    revokedReason: null,
  };
  store.write(record);
  return { record, reissued: false };
}

/** Mark a licence as no longer paid for. The key stays; the status changes. */
export function revokeLicence(store, record, { reason = STATUS.CANCELLED, now = Date.now() } = {}) {
  const revoked = { ...record, status: reason, revokedAt: now, revokedReason: reason };
  store.write(revoked);
  return revoked;
}

/**
 * The answer the extension caches for seven days.
 *
 * Everything the client needs to decide what it may do while it cannot reach
 * this service again: the plan, when the answer stops being trustworthy, and
 * when the licence itself ends.
 */
export function verifyLicence(store, key, { now = Date.now() } = {}) {
  if (!isLicenceKey(key)) {
    return { valid: false, reason: 'MALFORMED_KEY', plan: 'free' };
  }

  const record = store.read(key);
  if (!record) {
    return { valid: false, reason: 'UNKNOWN_KEY', plan: 'free' };
  }

  /* Constant time, though the value is a hashed lookup already: a comparison
     that leaks its position is a comparison worth nothing. */
  const a = Buffer.from(record.key);
  const b = Buffer.from(String(key));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'UNKNOWN_KEY', plan: 'free' };
  }

  if (record.status !== STATUS.ACTIVE) {
    return { valid: false, reason: record.status.toUpperCase(), plan: 'free', revokedAt: record.revokedAt };
  }
  if (record.expiresAt <= now) {
    return { valid: false, reason: 'EXPIRED', plan: 'free', expiresAt: record.expiresAt };
  }

  return {
    valid: true,
    reason: null,
    plan: record.plan,
    entitlements: PLANS[record.plan] ?? PLANS.free,
    expiresAt: record.expiresAt,
    /* When the client must ask again. It may keep working past this if it
       cannot reach us — see the extension's own licence module. */
    recheckAfter: now + CACHE_DAYS * 24 * 60 * 60 * 1000,
    checkedAt: now,
  };
}
