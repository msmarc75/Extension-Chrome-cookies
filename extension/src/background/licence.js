/*
 * What this installation is allowed to do, and what it does when it cannot ask.
 *
 * The hard part of licensing an extension is not checking a key. It is
 * deciding what happens on the morning the licence server is unreachable —
 * because it will be: the laptop is on a train, the office proxy blocks an
 * unknown domain, the service is being deployed. A tool that stops working then
 * has told a paying customer that their purchase depends on our uptime.
 *
 * So the rule here is **fail open, with an end to it**:
 *
 *   A verification is trusted for 7 days (the server says when to ask again).
 *   If the service cannot be reached after that, the last good answer is
 *   honoured for a further 7 days of grace, and the popup says so plainly.
 *   Past that, the installation drops to the free tier — it never stops
 *   working, it stops being paid-for.
 *
 * The counter for the free tier is local and only local. A quota enforced by a
 * server would mean telling that server every time someone audits a page, which
 * is a record of their browsing. Local counting can be reset by a determined
 * user; that is a price worth paying, and it is cheaper than the alternative in
 * every sense that matters.
 */

const KEY = 'licence';
const COUNTER_KEY = 'freeAudits';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a verification is good for before the client should ask again. */
export const CACHE_MS = 7 * DAY_MS;

/** How long a stale-but-good answer is honoured when the service is unreachable. */
export const GRACE_MS = 7 * DAY_MS;

/** What the free tier allows in a calendar month. */
export const FREE_AUDITS_PER_MONTH = 5;

/** Plans, mirrored from the server so an offline client can still reason. */
export const ENTITLEMENTS = Object.freeze({
  free: { label: 'Free', auditsPerMonth: FREE_AUDITS_PER_MONTH, policyAnalysis: false },
  pro: { label: 'Pro', auditsPerMonth: null, policyAnalysis: true },
  agency: { label: 'Agency', auditsPerMonth: null, policyAnalysis: true },
});

const local = () => chrome.storage.local;

/** The month a counter belongs to. Calendar months, in the user's own zone. */
export const monthOf = (at = Date.now()) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

/** @returns {Promise<object>} what is stored about the licence, never null */
export async function storedLicence() {
  const stored = await local().get(KEY);
  const licence = stored?.[KEY];
  return {
    key: licence?.key ?? null,
    plan: licence?.plan ?? 'free',
    valid: licence?.valid === true,
    reason: licence?.reason ?? null,
    checkedAt: licence?.checkedAt ?? null,
    recheckAfter: licence?.recheckAfter ?? null,
    expiresAt: licence?.expiresAt ?? null,
    lastError: licence?.lastError ?? null,
  };
}

/**
 * Remember a key without claiming anything about it: verification decides.
 *
 * Entering the *same* key again keeps what is already known about it. That is
 * not a nicety: a customer who re-pastes their key while the service happens to
 * be unreachable would otherwise have thrown away a good verification and
 * dropped themselves to the free tier — the exact opposite of what they were
 * trying to do.
 */
export async function setLicenceKey(key) {
  const trimmed = String(key ?? '').trim().toUpperCase();
  const stored = await storedLicence();
  if (trimmed && trimmed === stored.key) return stored;

  await local().set({
    [KEY]: { key: trimmed || null, plan: 'free', valid: false, reason: null, checkedAt: null, recheckAfter: null, expiresAt: null, lastError: null },
  });
  return storedLicence();
}

export async function forgetLicence() {
  await local().remove(KEY);
  return storedLicence();
}

/**
 * Ask the service whether this key is good, unless a recent answer stands.
 *
 * @param {object} [options]
 * @param {boolean} [options.force] ask even if the cached answer is fresh
 * @param {(url: string, init: object) => Promise<Response>} [options.request]
 * @param {string} [options.origin]
 * @param {number} [options.now]
 */
export async function verifyLicence({ force = false, request = fetch, origin = null, now = Date.now() } = {}) {
  const stored = await storedLicence();
  if (!stored.key) return { ...stored, plan: 'free', valid: false, reason: 'NO_KEY' };

  if (!force && stored.recheckAfter && now < stored.recheckAfter) {
    return { ...stored, fromCache: true };
  }

  const base = origin ?? (await serviceOrigin());
  let answer = null;
  let failure = null;

  try {
    const response = await request(`${base}/licence/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: stored.key }),
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) {
      failure = payload?.error?.code ?? `HTTP_${response.status}`;
    } else {
      answer = payload.data;
    }
  } catch (cause) {
    failure = `UNREACHABLE: ${cause?.message ?? cause}`;
  }

  if (answer) {
    const next = {
      key: stored.key,
      plan: answer.valid ? answer.plan : 'free',
      valid: answer.valid === true,
      reason: answer.reason ?? null,
      checkedAt: now,
      recheckAfter: answer.recheckAfter ?? now + CACHE_MS,
      expiresAt: answer.expiresAt ?? null,
      lastError: null,
    };
    await local().set({ [KEY]: next });
    return { ...next, fromCache: false };
  }

  /*
   * The service did not answer. What was true last time stays true for the
   * grace period, and the record says why it is being trusted — the popup
   * shows that sentence rather than a green tick it cannot justify.
   */
  const next = { ...stored, lastError: failure };
  await local().set({ [KEY]: next });
  return { ...next, fromCache: true, degraded: true };
}

/**
 * What this installation may do right now.
 *
 * Pure over the stored state and the clock, so every branch — fresh, stale,
 * in grace, lapsed, never verified — is testable without a network.
 *
 * @param {object} licence what `storedLicence` returned
 * @param {{used: number, month: string}} counter
 * @param {number} [now]
 */
export function entitlementsFor(licence, counter, now = Date.now()) {
  const staleAt = licence.recheckAfter ?? 0;
  const lapsedAt = staleAt + GRACE_MS;

  const paid = licence.valid && licence.plan !== 'free';
  const expired = licence.expiresAt !== null && licence.expiresAt <= now;

  if (paid && !expired && now < lapsedAt) {
    return {
      plan: licence.plan,
      entitlements: ENTITLEMENTS[licence.plan] ?? ENTITLEMENTS.free,
      auditsLeft: null,
      degraded: now >= staleAt,
      note:
        now >= staleAt
          ? 'The licence service could not be reached, so the last verification is being honoured. Full features continue until it can be checked again.'
          : null,
    };
  }

  const used = counter.month === monthOf(now) ? counter.used : 0;
  const left = Math.max(0, FREE_AUDITS_PER_MONTH - used);

  return {
    plan: 'free',
    entitlements: ENTITLEMENTS.free,
    auditsLeft: left,
    degraded: paid && expired === false && now >= lapsedAt,
    note: paid
      ? expired
        ? 'This licence has ended. The free allowance applies until it is renewed.'
        : 'The licence service has not been reachable for two weeks, so the free allowance applies until it answers again.'
      : null,
  };
}

/** @returns {Promise<{used: number, month: string}>} */
export async function auditCounter(now = Date.now()) {
  const stored = await local().get(COUNTER_KEY);
  const counter = stored?.[COUNTER_KEY];
  const month = monthOf(now);
  return counter?.month === month
    ? { used: Number(counter.used) || 0, month }
    : { used: 0, month };
}

/** Count one audit against the free allowance. Paid plans still count; they
    are simply never compared against a limit. */
export async function countAudit(now = Date.now()) {
  const counter = await auditCounter(now);
  const next = { used: counter.used + 1, month: counter.month };
  await local().set({ [COUNTER_KEY]: next });
  return next;
}

/**
 * May an audit run?
 *
 * @returns {Promise<{allowed: boolean, plan: string, auditsLeft: number|null, reason: string|null, note: string|null, policyAnalysis: boolean}>}
 */
export async function auditAllowance(now = Date.now()) {
  const [licence, counter] = await Promise.all([storedLicence(), auditCounter(now)]);
  const state = entitlementsFor(licence, counter, now);

  const allowed = state.entitlements.auditsPerMonth === null || state.auditsLeft > 0;
  return {
    allowed,
    plan: state.plan,
    auditsLeft: state.auditsLeft,
    policyAnalysis: state.entitlements.policyAnalysis === true,
    degraded: state.degraded,
    note: state.note,
    reason: allowed
      ? null
      : `The free allowance of ${FREE_AUDITS_PER_MONTH} audits this month is used up.`,
  };
}

/** Where the service lives. Kept beside the analysis client's own setting. */
async function serviceOrigin() {
  const stored = await local().get('serviceOrigin');
  const configured = stored?.serviceOrigin;
  return typeof configured === 'string' && configured
    ? configured.replace(/\/+$/, '')
    : 'https://api.consent-audit.dev';
}

/**
 * Start a purchase. Returns the URL to open; opening it is the caller's job,
 * because a service worker must not open tabs the user did not ask for.
 */
export async function startCheckout({ plan = 'pro', email = null, request = fetch, origin = null } = {}) {
  const base = origin ?? (await serviceOrigin());
  const response = await request(`${base}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan, email }),
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    const error = new Error(payload?.error?.message ?? `The service answered ${response.status}`);
    error.code = payload?.error?.code ?? 'CHECKOUT_FAILED';
    throw error;
  }
  return payload.data;
}
