/*
 * OneTrust — the enterprise default, and the one whose markup is most stable.
 * `RejectAll` and `AllowAll` are documented and are what its own buttons call.
 */

export const onetrust = {
  id: 'onetrust',
  name: 'OneTrust',
  globals: ['OneTrust', 'Optanon', 'OptanonWrapper'],
  /* Observed alongside `window.OneTrust` on irishtimes.com. */
  tcfCmpIds: [28],
  markers: [/onetrust/i, /optanon/i, /ot-sdk/i],
  frameHosts: [/(^|\.)onetrust\.com$/i, /(^|\.)cookielaw\.org$/i],

  refuseAllSource: `(async () => {
    if (typeof OneTrust === 'undefined' || typeof OneTrust.RejectAll !== 'function') {
      return { ok: false, reason: 'api-absent' };
    }
    OneTrust.RejectAll();
    return { ok: true, via: 'api', call: 'OneTrust.RejectAll()' };
  })()`,

  acceptAllSource: `(async () => {
    if (typeof OneTrust === 'undefined' || typeof OneTrust.AllowAll !== 'function') {
      return { ok: false, reason: 'api-absent' };
    }
    OneTrust.AllowAll();
    return { ok: true, via: 'api', call: 'OneTrust.AllowAll()' };
  })()`,
};
