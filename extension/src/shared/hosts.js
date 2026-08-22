/*
 * Host and party classification.
 *
 * "Third party" here means "not the site being audited". Deciding that
 * correctly needs the registrable domain, and deciding *that* correctly needs
 * the Public Suffix List. This module ships a compact approximation: the
 * last two labels, plus a short table of the multi-label suffixes that show up
 * in European auditing (`co.uk`, `com.br`, the delegated `.fr` zones…).
 *
 * The approximation is deliberate and scoped. The full list arrives in phase 4
 * with the DuckDuckGo Tracker Radar data, which carries entity ownership and
 * makes a far better job of the same question. Until then `party` is a
 * convenience for reading a capture, never the basis of a finding.
 */

/* Multi-label public suffixes. Not exhaustive — see the note above. */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'me.uk',
  'net.uk',
  'sch.uk',
  'asso.fr',
  'com.fr',
  'nom.fr',
  'tm.fr',
  'prd.fr',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'co.nz',
  'com.br',
  'com.mx',
  'com.ar',
  'com.tr',
  'com.sg',
  'com.hk',
  'com.cn',
  'co.za',
  'co.in',
  'co.kr',
  'com.es',
  'com.pl',
  'com.ua',
]);

/** The host of a URL, lowercased, or null when the URL carries none. */
export function hostOf(url) {
  try {
    const { hostname } = new URL(url);
    return hostname ? hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Strip the leading dot a cookie `Domain` attribute may carry. */
export function normaliseCookieDomain(domain) {
  if (typeof domain !== 'string' || domain.length === 0) return null;
  return (domain.startsWith('.') ? domain.slice(1) : domain).toLowerCase();
}

/**
 * The registrable domain of a host — `www.lemonde.fr` → `lemonde.fr`,
 * `ads.bbc.co.uk` → `bbc.co.uk`. IP addresses and single-label hosts are
 * returned unchanged.
 */
export function registrableDomain(host) {
  if (!host) return null;
  const lower = host.toLowerCase();
  if (/^\[|^\d+\.\d+\.\d+\.\d+$/.test(lower)) return lower;

  const labels = lower.split('.');
  if (labels.length <= 2) return lower;

  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * Classify a host against the site being audited.
 * @param {string|null} host
 * @param {string|null} siteHost the host of the audited page
 * @returns {'first'|'third'|'unknown'}
 */
export function partyOf(host, siteHost) {
  if (!host || !siteHost) return 'unknown';
  const site = registrableDomain(siteHost);
  const candidate = registrableDomain(host);
  if (!site || !candidate) return 'unknown';
  return candidate === site ? 'first' : 'third';
}
