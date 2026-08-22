/*
 * Cookiebot (Usercentrics) — common on smaller European sites.
 *
 * `submitCustomConsent` takes the three category flags the banner itself
 * toggles. Refusing means all three false; strictly necessary is not one of
 * them and is never in question.
 */

export const cookiebot = {
  id: 'cookiebot',
  name: 'Cookiebot',
  globals: ['Cookiebot', 'CookieConsent'],
  tcfCmpIds: [],
  markers: [/cookiebot/i, /cybotcookiebot/i],
  frameHosts: [/(^|\.)cookiebot\.com$/i],

  refuseAllSource: `(async () => {
    if (typeof Cookiebot === 'undefined' || typeof Cookiebot.submitCustomConsent !== 'function') {
      return { ok: false, reason: 'api-absent' };
    }
    Cookiebot.submitCustomConsent(false, false, false);
    return { ok: true, via: 'api', call: 'Cookiebot.submitCustomConsent(false, false, false)' };
  })()`,

  acceptAllSource: `(async () => {
    if (typeof Cookiebot === 'undefined' || typeof Cookiebot.submitCustomConsent !== 'function') {
      return { ok: false, reason: 'api-absent' };
    }
    Cookiebot.submitCustomConsent(true, true, true);
    return { ok: true, via: 'api', call: 'Cookiebot.submitCustomConsent(true, true, true)' };
  })()`,
};
