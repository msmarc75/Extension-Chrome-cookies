/*
 * What kind of third party is this, and does it count against the site?
 *
 * The plan called for DuckDuckGo's Tracker Radar. It is licensed CC BY-NC-SA
 * 4.0 — NonCommercial — and this is a paid product, so it cannot ship here
 * without a commercial licence from DuckDuckGo. The table in data/trackers.js
 * is written by this project instead, from public facts about who operates each
 * domain, seeded from the third-party hosts actually observed across its own
 * corpus. See docs/methodology.md.
 *
 * Two consequences follow, and both are deliberate.
 *
 * The list is short, so it misses trackers. That is the safe direction: only
 * advertising, analytics and social count as a deposit to answer for, and
 * anything unrecognised is reported as *unclassified*, never as clean. A
 * blocking finding built on a guess is worse than ten findings missed — a
 * practitioner who is contradicted once stops using the tool.
 *
 * And "third party" is not "tracker". The BBC serves its assets from
 * bbci.co.uk, Le Monde from lemde.fr, The Guardian from guim.co.uk. Every one
 * of those is a different registrable domain and none is a tracker. Counting
 * them would have produced a false positive on a blocking rule for a third of
 * the corpus.
 */

import { registrableDomain } from '../shared/hosts.js';
import { TRACKER_TABLE as TABLE } from './data/trackers.js';

/** Categories that constitute a deposit the site has to answer for. */
export const COUNTS_AS_DEPOSIT = Object.freeze(['advertising', 'analytics', 'social']);

const DOMAINS = new Map(Object.entries(TABLE.domains));

/**
 * @param {string|null} host
 * @returns {{category: string, entity: string|null, matched: string|null}}
 *   category is one of the keys of TABLE.categories, or 'unclassified'
 */
export function classifyHost(host) {
  if (typeof host !== 'string' || host.length === 0) {
    return { category: 'unclassified', entity: null, matched: null };
  }
  const lower = host.toLowerCase();

  /*
   * Try the full host first, then walk up the labels. `sdk.privacy-center.org`
   * matches on `privacy-center.org`; `ep2.adtrafficquality.google` matches on
   * `adtrafficquality.google` even though that is not its registrable domain.
   */
  const labels = lower.split('.');
  for (let index = 0; index < labels.length - 1; index += 1) {
    const candidate = labels.slice(index).join('.');
    const entry = DOMAINS.get(candidate);
    if (entry) {
      return { category: entry[0], entity: entry[1] ?? null, matched: candidate };
    }
  }

  return { category: 'unclassified', entity: null, matched: null };
}

/** True when a host's category is one the report treats as a deposit. */
export function isDeposit(host) {
  return COUNTS_AS_DEPOSIT.includes(classifyHost(host).category);
}

/**
 * Summarise the third parties a capture reached, grouped by registrable domain
 * and ordered by when each was first contacted.
 *
 * @param {object} capture a capture matching shared/schema/capture.schema.json
 */
export function classifyCapture(capture) {
  const byDomain = new Map();

  for (const request of capture.requests) {
    if (request.party !== 'third') continue;
    const domain = registrableDomain(request.host) ?? request.host;
    if (!byDomain.has(domain)) {
      const { category, entity, matched } = classifyHost(request.host);
      byDomain.set(domain, {
        domain,
        category,
        entity,
        matched,
        firstSeenMs: request.tMs,
        requests: 0,
        hosts: new Set(),
      });
    }
    const record = byDomain.get(domain);
    record.requests += 1;
    record.hosts.add(request.host);
    record.firstSeenMs = Math.min(record.firstSeenMs, request.tMs);
  }

  const all = [...byDomain.values()]
    .map((record) => ({ ...record, hosts: [...record.hosts].sort() }))
    .sort((a, b) => a.firstSeenMs - b.firstSeenMs);

  return {
    all,
    deposits: all.filter((record) => COUNTS_AS_DEPOSIT.includes(record.category)),
    unclassified: all.filter((record) => record.category === 'unclassified'),
    listVersion: TABLE.version,
  };
}
