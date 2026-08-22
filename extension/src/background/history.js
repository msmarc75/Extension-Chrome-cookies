/*
 * Audits the user has already run, kept on their own machine.
 *
 * Local by design and not by omission. An audit records what a site does to a
 * visitor, and the visitor here is the user: a history of the pages they
 * audited is a history of pages they visited, and sending that to a server
 * would be a worse disclosure than any this tool reports. Nothing in this file
 * touches the network.
 *
 * Two things it must survive. `chrome.storage.local` holds a few megabytes, and
 * a capture of a heavy news homepage is not small — so what is kept is a record
 * trimmed to what the report actually renders, the index is separate from the
 * entries so listing does not load them all, and the oldest are dropped once
 * the shelf is full.
 */

import { summarise } from '../ui/popup/summary.js';

const INDEX_KEY = 'auditHistory';
const ENTRY_PREFIX = 'audit:';

/** How many audits are kept. Beyond this the oldest is dropped. */
export const HISTORY_LIMIT = 30;

/** Ceiling on the events kept for one audit's timeline. */
const MAX_EVENTS = 400;

const local = () => chrome.storage.local;

/**
 * A short, sortable, collision-resistant id. Not a UUID: it is a storage key
 * the user may see in a URL, and a readable timestamp in it is worth more here
 * than the last few bits of entropy.
 */
export function auditId(at = Date.now()) {
  const stamp = new Date(at).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${suffix}`;
}

/**
 * Cut an audit down to what the report renders.
 *
 * The capture's request list is the big one — a news homepage makes hundreds of
 * calls — and the report only ever draws the third-party ones. What is dropped
 * is recorded as a count, so a reader is never shown a shortened list that
 * looks complete.
 *
 * @param {object} result what probeBanner returned
 * @param {{id?: string, at?: number}} [meta]
 */
export function trimForHistory(result, { id = auditId(), at = Date.now() } = {}) {
  const capture = result?.captureA ?? {};
  const thirdParty = (capture.requests ?? []).filter((request) => request.party === 'third');
  const kept = thirdParty.slice(0, MAX_EVENTS);

  return {
    id,
    at,
    target: result?.target ?? null,
    /*
     * The four figures, computed from the *whole* capture before it is trimmed.
     * Recomputing them from the stored record would count only the third-party
     * requests that were kept and quietly report a smaller total than was
     * observed.
     */
    summary: summarise(capture.requests ? capture : { requests: [], cookies: [], storage: [] }),
    finalUrl: result?.finalUrl ?? null,
    profile: capture.profile ?? null,
    capture: {
      profile: capture.profile ?? null,
      window: capture.window ?? null,
      interaction: capture.interaction ?? 'none',
      requests: kept,
      requestsTotal: (capture.requests ?? []).length,
      requestsThirdParty: thirdParty.length,
      requestsDropped: Math.max(0, thirdParty.length - kept.length),
      cookies: capture.cookies ?? [],
      storage: capture.storage ?? [],
      fingerprinting: capture.fingerprinting ?? [],
      notes: capture.notes ?? [],
    },
    cmp: result?.cmp ?? null,
    banner: result?.banner ?? null,
    refusal: result?.refusal ?? null,
    acceptance: result?.acceptance ?? null,
    policy: result?.policy
      ? {
          url: result.policy.url ?? null,
          finalUrl: result.policy.finalUrl ?? null,
          via: result.policy.via ?? null,
          characters: result.policy.characters ?? 0,
          error: result.policy.error ?? null,
          analysis: result.policy.analysis ?? null,
          /* The policy text itself is not kept: it is the site's document, it
             is large, and the analysis already carries every sentence the
             report quotes from it. */
        }
      : null,
    report: result?.report ?? null,
  };
}

/** The index: enough to list past audits without loading any of them. */
const indexEntry = (record) => ({
  id: record.id,
  at: record.at,
  site: record.finalUrl ?? record.target ?? null,
  score: record.report?.score ?? null,
  band: record.report?.band?.key ?? null,
  provisional: record.report?.provisional ?? null,
  blockingFailures: record.report?.blockingFailures ?? [],
  profile: record.profile ?? null,
});

/** @returns {Promise<Array<object>>} newest first */
export async function listAudits() {
  const stored = await local().get(INDEX_KEY);
  const index = Array.isArray(stored?.[INDEX_KEY]) ? stored[INDEX_KEY] : [];
  return [...index].sort((a, b) => b.at - a.at);
}

/** @returns {Promise<object|null>} */
export async function getAudit(id) {
  if (typeof id !== 'string' || !id) return null;
  const key = `${ENTRY_PREFIX}${id}`;
  const stored = await local().get(key);
  return stored?.[key] ?? null;
}

/**
 * Keep one audit.
 *
 * @param {object} result what probeBanner returned
 * @returns {Promise<{id: string, at: number, dropped: Array<string>}>}
 */
export async function saveAudit(result, { id = auditId(), at = Date.now() } = {}) {
  const record = trimForHistory(result, { id, at });
  const index = await listAudits();
  const next = [indexEntry(record), ...index.filter((entry) => entry.id !== id)];

  const dropped = next.slice(HISTORY_LIMIT).map((entry) => entry.id);
  await local().set({
    [INDEX_KEY]: next.slice(0, HISTORY_LIMIT),
    [`${ENTRY_PREFIX}${id}`]: record,
  });
  if (dropped.length > 0) {
    await local().remove(dropped.map((old) => `${ENTRY_PREFIX}${old}`));
  }

  return { id, at, dropped };
}

/** @returns {Promise<boolean>} whether anything was there to delete */
export async function deleteAudit(id) {
  const index = await listAudits();
  const next = index.filter((entry) => entry.id !== id);
  await local().set({ [INDEX_KEY]: next });
  await local().remove(`${ENTRY_PREFIX}${id}`);
  return next.length !== index.length;
}

/** @returns {Promise<number>} how many audits were forgotten */
export async function clearHistory() {
  const index = await listAudits();
  await local().remove(index.map((entry) => `${ENTRY_PREFIX}${entry.id}`));
  await local().set({ [INDEX_KEY]: [] });
  return index.length;
}
