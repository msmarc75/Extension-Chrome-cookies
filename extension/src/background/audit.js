/*
 * Capture A — what a site deposits before the visitor can say anything.
 *
 * Two invariants make this measurement worth anything, and both are easy to
 * break by accident later:
 *
 *   The debugger attaches BEFORE navigation. Attaching after it means the
 *   first requests — which are exactly the interesting ones — have already
 *   gone out unobserved.
 *
 *   Nothing touches the page during the window. No click, no scroll, no
 *   simulated pointer movement. Several consent platforms read any input event
 *   as implied consent, so a single stray event would turn the most
 *   incriminating measurement in the report into a meaningless one. There is
 *   no call to the CDP `Input` domain anywhere in this file, and there must
 *   not be one.
 */

import { CaptureBuilder } from './capture.js';
import { withSession } from './debugger-session.js';
import { COLLECT_EXPRESSION, INSTRUMENT_SOURCE, parsePageMarks } from './page-instrument.js';
import { assess } from '../engine/index.js';
import { locateBanner } from '../content/banner-detector.js';
import { identifyCmp } from '../content/cmp-adapters/index.js';
import { express, readProfile, resetOrigin } from '../content/interaction-driver.js';

/** Length of the observation window, in milliseconds. */
export const OBSERVATION_MS = 5_000;

/** Ceiling on a whole capture, after which the debugger is released regardless. */
const SESSION_BUDGET_MS = 60_000;

/** Budget for each end-of-window question put to the page. */
const SNAPSHOT_TIMEOUT_MS = 3_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let auditInFlight = false;

export class AuditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuditError';
    this.code = code;
  }
}

/** Only http(s) can be audited: everything else refuses the debugger anyway. */
export function normaliseTargetUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new AuditError('BAD_URL', `Not a URL: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AuditError('UNSUPPORTED_SCHEME', `${url.protocol} pages cannot be audited`);
  }
  return url.toString();
}

/**
 * Can this installation take a first-visit measurement?
 *
 * A profile that already holds the site's cookies measures a *returning*
 * visitor: the banner may not even appear, and the capture would understate
 * what a first-time visitor receives. Incognito is what gives a clean slate
 * without deleting anything the user owns, and Chrome only grants it if the
 * user ticks the box.
 */
export async function auditCapability() {
  const incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
  if (!incognitoAllowed) {
    return {
      canAudit: false,
      reason: 'INCOGNITO_NOT_ALLOWED',
      profile: null,
    };
  }
  const windows = await chrome.windows.getAll({});
  const alreadyOpen = windows.some((window) => window.incognito);
  return {
    canAudit: true,
    reason: null,
    profile: alreadyOpen ? 'incognito-shared' : 'incognito-fresh',
  };
}

/**
 * Open the surface the audit runs on.
 *
 * `incognito` is the production path: a window of its own, unfocused so the
 * audit does not steal the user's place, closed at the end.
 *
 * `current` opens an ordinary background tab instead. It measures a returning
 * visitor rather than a first one, which the capture records in its `profile`
 * field and the report discloses. It exists because automated verification
 * cannot tick Chrome's incognito checkbox, and because re-auditing in the
 * user's own profile is a question a DPO does legitimately ask.
 */
async function openAuditSurface(mode) {
  if (mode === 'incognito') {
    const capability = await auditCapability();
    if (!capability.canAudit) {
      throw new AuditError(
        capability.reason,
        'Consent Audit needs to run in an incognito window to measure a first visit',
      );
    }
    const window = await chrome.windows.create({
      incognito: true,
      url: 'about:blank',
      focused: false,
    });
    const tab = window.tabs?.[0];
    if (!tab?.id) throw new AuditError('NO_TAB', 'Chrome opened a window without a tab');
    return {
      tabId: tab.id,
      profile: capability.profile,
      close: () => chrome.windows.remove(window.id),
    };
  }

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  if (!tab.id) throw new AuditError('NO_TAB', 'Chrome opened a tab without an id');
  return {
    tabId: tab.id,
    profile: 'current',
    close: () => chrome.tabs.remove(tab.id),
  };
}

/**
 * Watch a page for a fixed window and turn what happened into a capture.
 *
 * Shared by every phase of the cycle. Phase A is the one that must not be
 * touched; B and C are taken after an interaction the caller has already
 * performed, and say so in the capture they produce.
 *
 * @param {object} options
 * @param {{send: Function, trySend: Function}} options.session
 * @param {'A'|'B'|'C'} options.phase
 * @param {string} options.target
 * @param {string} options.profile which kind of browser profile this is
 * @param {'none'|'refuse-all'|'accept-all'} options.interaction
 * @param {number} options.observationMs
 * @param {(builder: CaptureBuilder) => void} options.attach hands the caller the builder
 * @returns {Promise<object>} a capture matching shared/schema/capture.schema.json
 */
async function observe({
  session,
  phase,
  target,
  profile,
  interaction,
  observationMs,
  attach,
  instrumented,
}) {
  const startedAt = Date.now();
  const builder = new CaptureBuilder({
    phase,
    requestedUrl: target,
    profile,
    startedAt,
    interaction,
  });
  attach(builder);

  if (instrumented === null) {
    builder.note(
      'INSTRUMENT_NOT_INSTALLED',
      'Storage writes and script-set cookies cannot be dated in this capture',
    );
  }

  /*
   * The navigation is started, not awaited. `Page.navigate` settles when the
   * navigation commits, and a page that never answers would otherwise stretch
   * the window to whatever the server felt like — or hang the audit outright.
   */
  let navigation = null;
  void session
    .send('Page.navigate', { url: target })
    .then((result) => {
      navigation = result ?? {};
    })
    .catch((cause) => {
      navigation = { errorText: cause.message };
    });

  await sleep(Math.max(0, observationMs - (Date.now() - startedAt)));

  if (navigation?.errorText) {
    builder.note('NAVIGATION_FAILED', navigation.errorText);
  } else if (navigation === null) {
    builder.note('NAVIGATION_INCOMPLETE', `The page had not committed after ${observationMs} ms`);
  }

  /* Only now, with the window closed, may the page be questioned. */
  const budget = { timeoutMs: SNAPSHOT_TIMEOUT_MS };
  const jar = await session.trySend('Network.getCookies', {}, budget);
  if (jar === null) builder.note('COOKIE_SNAPSHOT_UNAVAILABLE', 'Network.getCookies failed');

  /*
   * Nothing to read from a document that never arrived, and asking would block
   * until the pending navigation resolves — which, for the page that provoked
   * this branch, is never.
   */
  let pageMarks = null;
  let usage = null;
  if (builder.navigationCommittedAt !== null) {
    const collected = await session.trySend(
      'Runtime.evaluate',
      { expression: COLLECT_EXPRESSION, returnByValue: true },
      budget,
    );
    if (collected === null) {
      builder.note('PAGE_MARKS_UNAVAILABLE', 'The page could not be read back');
    }
    pageMarks = parsePageMarks(collected?.result?.value);

    const origin = safeOrigin(builder.finalUrl ?? target);
    usage = origin ? await session.trySend('Storage.getUsageAndQuota', { origin }, budget) : null;
  }

  return builder.finish({
    durationMs: Date.now() - startedAt,
    jarCookies: jar?.cookies ?? [],
    usageBreakdown: usage?.usageBreakdown ?? [],
    pageMarks,
  });
}

/** Bring up the domains and the in-page instrument. All of it before navigation. */
async function arm(session) {
  await session.send('Network.enable');
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  /*
   * Auto-attach is what makes a cross-site consent frame readable at all: it
   * runs in its own renderer, and the tab's own session is blind to it. The
   * banner of several large platforms lives in exactly such a frame.
   */
  await session.trySend('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  return session.trySend('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT_SOURCE });
}

/**
 * Run capture A against a URL.
 *
 * @param {object} options
 * @param {string} options.url
 * @param {'incognito'|'current'} [options.mode]
 * @param {number} [options.observationMs]
 * @returns {Promise<object>} a capture matching shared/schema/capture.schema.json
 */
export async function captureBeforeConsent({
  url,
  mode = 'incognito',
  observationMs = OBSERVATION_MS,
} = {}) {
  if (auditInFlight) {
    throw new AuditError('BUSY', 'An audit is already running');
  }
  const target = normaliseTargetUrl(url);
  auditInFlight = true;

  const surface = await openAuditSurface(mode);
  /** @type {CaptureBuilder|null} */
  let builder = null;

  try {
    return await withSession(
      surface.tabId,
      (method, params) => builder?.onEvent(method, params),
      async (session) => {
        const instrumented = await arm(session);
        return observe({
          session,
          phase: 'A',
          target,
          profile: surface.profile,
          interaction: 'none',
          observationMs,
          instrumented,
          attach: (created) => {
            builder = created;
          },
        });
      },
      { budgetMs: SESSION_BUDGET_MS },
    );
  } finally {
    auditInFlight = false;
    try {
      await surface.close();
    } catch {
      /* The user may have closed it first. */
    }
  }
}

/**
 * Capture A, then find the banner, then try to refuse and to accept.
 *
 * The order is the same as the real cycle and for the same reason: the
 * observation window runs first and untouched, and only once it has closed does
 * anything reach for a button. Reversing that would make the measurement
 * capture A exists for worthless.
 *
 * @param {object} options
 * @param {string} options.url
 * @param {'incognito'|'current'} [options.mode]
 * @param {number} [options.observationMs]
 * @param {boolean} [options.act] whether to attempt refusal and acceptance
 */
export async function probeBanner({
  url,
  mode = 'incognito',
  observationMs = OBSERVATION_MS,
  act = true,
} = {}) {
  if (auditInFlight) {
    throw new AuditError('BUSY', 'An audit is already running');
  }
  const target = normaliseTargetUrl(url);
  auditInFlight = true;

  const surface = await openAuditSurface(mode);
  /** @type {CaptureBuilder|null} */
  let builder = null;

  try {
    return await withSession(
      surface.tabId,
      (method, params) => builder?.onEvent(method, params),
      async (session) => {
        const instrumented = await arm(session);
        const captureA = await observe({
          session,
          phase: 'A',
          target,
          profile: surface.profile,
          interaction: 'none',
          observationMs,
          instrumented,
          attach: (created) => {
            builder = created;
          },
        });

        /*
         * A consent frame can attach after the observation window closes —
         * they are loaded late by design, and an out-of-process one only
         * becomes readable once its own session is attached. Reading once and
         * concluding "no banner" would report a site as having nothing to
         * answer for because the tool looked too early.
         */
        let profile = await readProfile(session);
        let cmp = identifyCmp(profile);
        let banner = locateBanner(profile, cmp);

        const incomplete = () =>
          !banner.found || (!banner.controls.accept && !banner.controls.refuse);

        for (let attempt = 0; attempt < 2 && incomplete(); attempt += 1) {
          await sleep(1_000);
          profile = await readProfile(session);
          cmp = identifyCmp(profile);
          banner = locateBanner(profile, cmp);
        }

        const result = {
          target,
          finalUrl: captureA.target.finalUrl,
          captureA,
          cmp,
          banner: {
            found: banner.found,
            method: banner.method,
            confidence: banner.confidence,
            reasons: banner.reasons,
            disclosure: banner.disclosure,
            container: banner.container
              ? {
                  path: banner.container.path,
                  text: banner.container.text.slice(0, 300),
                  viewportShare: banner.container.viewportShare,
                }
              : null,
            controls: Object.fromEntries(
              Object.entries(banner.controls).map(([intent, found]) => [
                intent,
                found ? { label: found.match.label, score: found.match.score } : null,
              ]),
            ),
          },
          framesExamined: profile.framesExamined ?? null,
          refusal: null,
          acceptance: null,
          report: null,
        };

        /*
         * The rulebook reads the detector's own output, not the summary above:
         * the fairness rules need the controls' geometry and colours, which the
         * summary deliberately drops.
         */
        const judge = () =>
          assess({ captureA, profile, cmp, banner, refusal: result.refusal });

        if (!act) {
          result.report = judge();
          return result;
        }

        result.refusal = await express({ session, cmp, banner, intent: 'refuse' });

        /* Start over before asking the opposite question. */
        const origin = safeOrigin(captureA.target.finalUrl ?? target);
        if (origin) {
          await resetOrigin(session, { origin, url: target });
          await sleep(observationMs);
          const freshProfile = await readProfile(session);
          const freshCmp = identifyCmp(freshProfile);
          const freshBanner = locateBanner(freshProfile, freshCmp);
          result.acceptance = await express({
            session,
            cmp: freshCmp,
            banner: freshBanner,
            intent: 'accept',
          });
          /* The page as it stands once consent is given — WITHDRAWAL_ACCESSIBLE
             has nothing to look at before that. */
          result.profileAfterAcceptance = await readProfile(session);
        }

        result.report = assess({
          captureA,
          profile,
          cmp,
          banner,
          refusal: result.refusal,
          profileAfterAcceptance: result.profileAfterAcceptance ?? null,
        });
        return result;
      },
      { budgetMs: SESSION_BUDGET_MS },
    );
  } finally {
    auditInFlight = false;
    try {
      await surface.close();
    } catch {
      /* The user may have closed it first. */
    }
  }
}

function safeOrigin(url) {
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}
