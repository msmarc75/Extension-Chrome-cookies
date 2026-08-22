/*
 * Sourcepoint — large English-language publishers, and the reason the corpus
 * needed an adapter the plan did not list: The Guardian runs it, and it renders
 * its banner inside an iframe, which is the case a DOM-only detector misses.
 *
 * Its messaging API is not documented well enough to drive a refusal from, so
 * the refusal goes through the button.
 */

export const sourcepoint = {
  id: 'sourcepoint',
  name: 'Sourcepoint',
  globals: ['_sp_', '_sp_queue'],
  /*
   * Observed in the corpus alongside `window._sp_`: 6 on the BBC, The
   * Independent, Der Spiegel, Zeit, heise and programme-tv, 35 on Focus. The
   * registry is not public in a form this project can vendor, so these are
   * recorded from what was actually seen rather than asserted from a list.
   */
  tcfCmpIds: [6, 35],
  markers: [/sp_message/i, /sp-message/i, /sourcepoint/i],
  frameHosts: [/(^|\.)privacy-mgmt\.com$/i, /(^|\.)sp-prod\.net$/i],
};
