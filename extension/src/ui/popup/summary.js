/*
 * Reading of a capture, for the popup's four figures.
 *
 * Separated from the DOM wiring so the arithmetic that decides what the user
 * is told can be tested without a browser. It is the number in "first deposit
 * at 0.4 s" that ends up quoted in a client report, and it has to be right.
 */

/* One definition of how an instant is printed, shared with the report and with
   the exported file: the same deposit must not read as "413 ms" in one and
   "0.4 s" in another. */
export { formatOffset } from '../../shared/report-model.js';

/**
 * @param {object} capture matching shared/schema/capture.schema.json
 */
export function summarise(capture) {
  const thirdPartyRequests = capture.requests.filter((r) => r.party === 'third');
  const thirdPartyCookies = capture.cookies.filter((c) => c.party === 'third');

  /*
   * "First deposit" counts anything the site put on the visitor or sent about
   * them: a call to a third party, a cookie, a storage write. A first-party
   * request for the page itself is not a deposit — that is the visit.
   */
  const timed = [
    ...thirdPartyRequests.map((r) => r.tMs),
    ...capture.cookies.map((c) => c.tMs),
    ...capture.storage.map((s) => s.tMs),
  ].filter((t) => typeof t === 'number' && Number.isFinite(t));

  return {
    thirdPartyRequests: thirdPartyRequests.length,
    totalRequests: capture.requests.length,
    cookies: capture.cookies.length,
    thirdPartyCookies: thirdPartyCookies.length,
    storage: capture.storage.length,
    firstDepositMs: timed.length > 0 ? Math.min(...timed) : null,
    /* A capture can hold cookies it could not date; saying so beats implying none. */
    undatedCookies: capture.cookies.filter((c) => c.tMs === null).length,
  };
}
