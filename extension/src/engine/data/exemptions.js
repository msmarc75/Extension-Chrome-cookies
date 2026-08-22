/*
 * Cookies that do not require consent.
 *
 * This table is what separates a credible tool from an alarm generator. A
 * session cookie, a load balancer's affinity cookie, a CSRF token, a bot-
 * management cookie, the cookie recording the visitor's own refusal — none of
 * those is a breach, and a report that lists them alongside an ad exchange's
 * identifier is a report a practitioner stops trusting.
 *
 * The exemption in law is narrow: strictly necessary for a service the user
 * asked for (ePrivacy art. 5(3), second exception), plus the audience-
 * measurement carve-out the CNIL grants under conditions this tool cannot
 * verify from the outside — which is why measurement is flagged for review, not
 * silently exempted.
 *
 * Every entry says which exemption it claims and why. An entry that cannot say
 * so does not belong here.
 */

/** Grounds on which a cookie can escape the consent requirement. */
export const GROUND = Object.freeze({
  SESSION: 'session or authentication',
  SECURITY: 'security, anti-fraud or bot management',
  BALANCING: 'load balancing or server affinity',
  CART: 'shopping cart or transaction state',
  PREFERENCE: 'a display preference the visitor set',
  CONSENT_RECORD: 'recording the visitor’s own consent choice',
  MEASUREMENT: 'audience measurement — exempt only under conditions this tool cannot verify',
});

/**
 * Matched against the cookie name. Anchored patterns, deliberately: a
 * substring match on "id" would exempt half the web.
 */
const PATTERNS = [
  { re: /^PHPSESSID$/i, ground: GROUND.SESSION, note: 'PHP session identifier' },
  { re: /^JSESSIONID$/i, ground: GROUND.SESSION, note: 'Java servlet session identifier' },
  { re: /^ASP\.NET_SessionId$/i, ground: GROUND.SESSION, note: 'ASP.NET session identifier' },
  { re: /^(?:sess|session)(?:_?id)?$/i, ground: GROUND.SESSION, note: 'session identifier' },
  { re: /^connect\.sid$/i, ground: GROUND.SESSION, note: 'Express session identifier' },
  { re: /^laravel_session$/i, ground: GROUND.SESSION, note: 'Laravel session identifier' },
  { re: /^_?rails_session$/i, ground: GROUND.SESSION, note: 'Rails session identifier' },
  { re: /^wordpress_logged_in_/i, ground: GROUND.SESSION, note: 'WordPress authentication' },
  { re: /^(?:auth|token|access_token|refresh_token|jwt)$/i, ground: GROUND.SESSION, note: 'authentication token' },

  { re: /^(?:csrf|_csrf|csrftoken|CSRF-TOKEN|XSRF-TOKEN)$/i, ground: GROUND.SECURITY, note: 'cross-site request forgery token' },
  { re: /^__Host-/i, ground: GROUND.SECURITY, note: 'host-locked cookie prefix' },
  { re: /^__Secure-/i, ground: GROUND.SECURITY, note: 'secure cookie prefix' },
  { re: /^cf_clearance$/i, ground: GROUND.SECURITY, note: 'Cloudflare challenge clearance' },
  { re: /^__cf_bm$/i, ground: GROUND.SECURITY, note: 'Cloudflare bot management' },
  { re: /^(?:bm_s|bm_sv|bm_sz|bm_so|bm_lso|ak_bmsc|_abck)$/i, ground: GROUND.SECURITY, note: 'Akamai bot manager' },
  { re: /^(?:incap_ses|visid_incap|nlbi)_/i, ground: GROUND.SECURITY, note: 'Imperva protection' },
  { re: /^datadome$/i, ground: GROUND.SECURITY, note: 'DataDome bot protection' },
  { re: /^reese84$/i, ground: GROUND.SECURITY, note: 'Imperva/Distil bot protection' },

  { re: /^AWSALB(?:CORS)?$/i, ground: GROUND.BALANCING, note: 'AWS load balancer affinity' },
  { re: /^BIGipServer/i, ground: GROUND.BALANCING, note: 'F5 BIG-IP server affinity' },
  { re: /^(?:SERVERID|srv_id|route|lb)$/i, ground: GROUND.BALANCING, note: 'server affinity' },

  { re: /^(?:cart|basket|panier|woocommerce_cart_hash)$/i, ground: GROUND.CART, note: 'shopping cart state' },
  { re: /^wp-settings/i, ground: GROUND.PREFERENCE, note: 'WordPress display preference' },
  { re: /^(?:lang|language|locale|i18n|theme|darkmode|timezone|tz)$/i, ground: GROUND.PREFERENCE, note: 'display preference' },

  { re: /^euconsent(?:-v2)?$/i, ground: GROUND.CONSENT_RECORD, note: 'IAB TCF consent string' },
  { re: /^didomi_token$/i, ground: GROUND.CONSENT_RECORD, note: 'Didomi consent record' },
  { re: /^OptanonConsent$/i, ground: GROUND.CONSENT_RECORD, note: 'OneTrust consent record' },
  { re: /^OptanonAlertBoxClosed$/i, ground: GROUND.CONSENT_RECORD, note: 'OneTrust notice state' },
  { re: /^CookieConsent$/i, ground: GROUND.CONSENT_RECORD, note: 'Cookiebot consent record' },
  { re: /^(?:cookie|cookies)[_-]?(?:consent|policy|accepted|notice|banner|choice|prefs?|preferences)/i, ground: GROUND.CONSENT_RECORD, note: 'consent record' },
  { re: /^(?:consent|rgpd|gdpr)[_-]?/i, ground: GROUND.CONSENT_RECORD, note: 'consent record' },
  { re: /^(?:seen_?cookie|hide_?cookie|accept_?cookies?)/i, ground: GROUND.CONSENT_RECORD, note: 'consent notice dismissed' },
  { re: /^axeptio_/i, ground: GROUND.CONSENT_RECORD, note: 'Axeptio consent record' },
  { re: /^consentUUID$/i, ground: GROUND.CONSENT_RECORD, note: 'Sourcepoint consent record' },
  { re: /^_sp_(?:v1_|su|enable_dfp)/i, ground: GROUND.CONSENT_RECORD, note: 'Sourcepoint notice state' },
  { re: /^tarteaucitron$/i, ground: GROUND.CONSENT_RECORD, note: 'tarteaucitron consent record' },

  /*
   * Audience measurement. The CNIL exempts it only when it is limited to
   * measuring the site's own audience, produces no cross-site profile, and its
   * data is not shared — none of which is visible from outside. Flagged for a
   * human to check rather than exempted outright.
   */
  { re: /^(?:_pk_|_matomo|piwik)/i, ground: GROUND.MEASUREMENT, note: 'Matomo/Piwik audience measurement', needsReview: true },
  { re: /^(?:atuserid|atidvisitor|atauthority|atid|atidx)$/i, ground: GROUND.MEASUREMENT, note: 'AT Internet audience measurement', needsReview: true },
  { re: /^(?:xtvrn|xtan|xtant)/i, ground: GROUND.MEASUREMENT, note: 'Xiti audience measurement', needsReview: true },
];

/*
 * Cookie names that identify a visitor for advertising or cross-site
 * measurement. Unlike the exemptions above, these are the opposite signal: a
 * first-party cookie whose *name* is a known tracker identifier can be counted
 * with confidence even though it sits on the site's own domain, which is how
 * most of them are set now.
 */
const KNOWN_TRACKER_NAMES = [
  { re: /^_ga($|_)/, note: 'Google Analytics client identifier' },
  { re: /^_gid$/, note: 'Google Analytics session identifier' },
  { re: /^_gat/, note: 'Google Analytics throttle' },
  { re: /^_gcl_/, note: 'Google Ads click identifier' },
  { re: /^__gads$|^__gpi$|^__eoi$/, note: 'Google advertising identifier' },
  { re: /^_fbp$|^_fbc$|^fr$/, note: 'Meta advertising identifier' },
  { re: /^IDE$|^test_cookie$/, note: 'DoubleClick advertising identifier' },
  { re: /^_pcid$|^_pprv$|^_pctx$|^__utm/, note: 'Piano/Cxense or Urchin identifier' },
  { re: /^cto_/, note: 'Criteo identifier' },
  { re: /^_cc_id$|^panoramaId/, note: 'Lotame identifier' },
  { re: /^_tt_enable_cookie$|^_ttp$/, note: 'TikTok advertising identifier' },
  { re: /^_scid$|^_schn$/, note: 'Snap advertising identifier' },
  { re: /^_uetsid$|^_uetvid$/, note: 'Microsoft advertising identifier' },
  { re: /^_hjSession/, note: 'Hotjar session recording' },
  { re: /^_pk_id|^_pk_ses/, note: 'Matomo visitor identifier' },
  { re: /^li_sugr$|^bcookie$|^lidc$/, note: 'LinkedIn identifier' },
];

/**
 * A cookie whose name is a known tracker identifier, wherever it sits.
 * @param {{name: string}} cookie
 * @returns {{known: boolean, note: string|null}}
 */
export function knownTrackerCookie(cookie) {
  const name = String(cookie?.name ?? '');
  for (const pattern of KNOWN_TRACKER_NAMES) {
    if (pattern.re.test(name)) return { known: true, note: pattern.note };
  }
  return { known: false, note: null };
}

/**
 * @param {{name: string}} cookie
 * @returns {{exempt: boolean, ground: string|null, note: string|null, needsReview: boolean}}
 */
export function exemptionFor(cookie) {
  const name = String(cookie?.name ?? '');
  for (const pattern of PATTERNS) {
    if (pattern.re.test(name)) {
      return {
        exempt: true,
        ground: pattern.ground,
        note: pattern.note,
        needsReview: pattern.needsReview === true,
      };
    }
  }
  return { exempt: false, ground: null, note: null, needsReview: false };
}
