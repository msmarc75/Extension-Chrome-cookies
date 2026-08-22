/*
 * Didomi — the most common consent platform on French publishers.
 *
 * Its API offers a documented refusal, which is worth far more than clicking:
 * a click depends on a button being where it was last week, whereas
 * `setUserDisagreeToAll` is the same call the platform's own button makes.
 */

export const didomi = {
  id: 'didomi',
  name: 'Didomi',
  globals: ['Didomi', 'didomiOnReady'],
  /* Confirmed from the corpus: every page carrying `window.Didomi` reports 7. */
  tcfCmpIds: [7],
  markers: [/didomi/i],
  frameHosts: [/(^|\.)didomi\.io$/i],

  refuseAllSource: `(async () => {
    if (typeof Didomi === 'undefined' || typeof Didomi.setUserDisagreeToAll !== 'function') {
      return { ok: false, reason: 'api-absent' };
    }
    Didomi.setUserDisagreeToAll();
    return { ok: true, via: 'api', call: 'Didomi.setUserDisagreeToAll()' };
  })()`,

  acceptAllSource: `(async () => {
    if (typeof Didomi === 'undefined' || typeof Didomi.setUserAgreeToAll !== 'function') {
      return { ok: false, reason: 'api-absent' };
    }
    Didomi.setUserAgreeToAll();
    return { ok: true, via: 'api', call: 'Didomi.setUserAgreeToAll()' };
  })()`,
};
