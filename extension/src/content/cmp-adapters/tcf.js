/*
 * IAB TCF v2.2 — a framework, not a platform.
 *
 * One adapter covers thousands of sites, which is why it is written first. What
 * it gives is identity and state: `cmpId` is a registered number naming the
 * vendor, and `eventStatus` says whether the banner is on screen right now.
 *
 * What it does not give is a way to refuse. The framework has no reject call —
 * declining is a UI act by design — so refusal goes through the button, and the
 * result is checked against `getTCData` afterwards, which is the one thing TCF
 * does answer honestly.
 */

export const tcf = {
  id: 'tcf',
  name: 'IAB TCF',
  globals: ['__tcfapi'],
  tcfCmpIds: [],
  markers: [],
  frameHosts: [],

  /* Read back after a refusal: consent recorded for no purpose at all. */
  verifySource: `(async () => new Promise((resolve) => {
    if (typeof __tcfapi !== 'function') return resolve({ available: false });
    const timer = setTimeout(() => resolve({ available: true, unresponsive: true }), 2500);
    try {
      __tcfapi('getTCData', 2, (data, success) => {
        clearTimeout(timer);
        if (!success || !data) return resolve({ available: true, failed: true });
        const consents = data.purpose && data.purpose.consents ? data.purpose.consents : {};
        const granted = Object.keys(consents).filter((key) => consents[key]);
        resolve({
          available: true,
          cmpStatus: data.cmpStatus ?? null,
          eventStatus: data.eventStatus ?? null,
          purposeConsents: granted,
        });
      });
    } catch (cause) {
      clearTimeout(timer);
      resolve({ available: true, error: String(cause).slice(0, 200) });
    }
  }))()`,
};
