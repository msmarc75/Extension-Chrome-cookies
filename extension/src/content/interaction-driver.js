/*
 * Refusing, accepting, and starting over.
 *
 * Everything here runs *after* the observation window has closed. Nothing in
 * this file may be called before capture A is complete: a single click landing
 * early would be read by several consent platforms as agreement, and would
 * destroy the one measurement that cannot be taken twice.
 *
 * Two routes to a refusal, in order of how much they can be trusted:
 *
 *   The platform's own call — `Didomi.setUserDisagreeToAll()`, and its
 *   equivalents. This is the same call the platform's own button makes, and it
 *   does not depend on a button still being where it was last week.
 *
 *   The button. Used when the platform publishes no refusal call, or is not
 *   recognised at all. The service worker decides *which* label to press; the
 *   page finds it and presses it. The label table stays in one place that way.
 *
 * Either way the outcome is verified rather than assumed. A refusal that
 * silently did nothing, reported as a refusal, would put a false statement in
 * a client's report — so the banner is re-read afterwards, and where the TCF
 * API exists it is asked what it now records.
 */

import { adapterById, tcf } from './cmp-adapters/index.js';
import { FRAME_PROFILE_EXPRESSION, PROFILE_EXPRESSION, parsePageProfile } from './page-profile.js';
import { classifyControl, normaliseLabel } from './label-match.js';

/** How long to let a platform settle after being told to refuse. */
const SETTLE_MS = 1_500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Find a visible control by its exact label and press it.
 *
 * The label is decided by the caller, so the multilingual table lives in one
 * place. Matching is on the normalised label — accents folded, punctuation
 * dropped, whitespace collapsed — because "Tout refuser" and "TOUT REFUSER !"
 * are the same button.
 */
function clickByLabelSource(label, containerHint) {
  return `(() => {
    const WANTED = ${JSON.stringify(label)};
    const HINT = ${JSON.stringify(containerHint ?? '')};

    const fold = (value) => String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .replace(/[^\\p{L}\\p{N}\\s]/gu, ' ')
      .replace(/\\s+/g, ' ')
      .trim();

    const all = [];
    const walk = (root, depth) => {
      if (depth > 6) return;
      let elements;
      try { elements = root.querySelectorAll('button, a[href], [role="button"], [role="link"], input[type="button"], input[type="submit"], summary'); }
      catch (_) { return; }
      for (const element of elements) all.push(element);
      let hosts;
      try { hosts = root.querySelectorAll('*'); } catch (_) { return; }
      for (const host of hosts) if (host.shadowRoot) walk(host.shadowRoot, depth + 1);
    };
    walk(document, 0);

    const visible = (element) => {
      try {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      } catch (_) { return false; }
    };

    const labelOf = (element) => {
      for (const source of [element.innerText, element.textContent,
                            element.getAttribute('aria-label'), element.getAttribute('title')]) {
        const folded = fold(source);
        if (folded) return folded;
      }
      return '';
    };

    const matches = all.filter((element) => visible(element) && labelOf(element) === WANTED);
    if (matches.length === 0) {
      return { ok: false, reason: 'label-not-found', label: WANTED,
               candidates: all.filter(visible).slice(0, 25).map(labelOf) };
    }

    /* Prefer one inside the container the detector settled on. */
    const inHint = HINT
      ? matches.find((element) => {
          let node = element;
          for (let hops = 0; node && hops < 12; hops += 1) {
            if (node.id && HINT.includes(node.id)) return true;
            const classes = (node.getAttribute && node.getAttribute('class')) || '';
            if (classes && classes.split(/\\s+/).some((name) => name && HINT.includes(name))) return true;
            node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
          }
          return false;
        })
      : null;

    const target = inHint || matches[0];
    const rect = target.getBoundingClientRect();
    try { target.click(); } catch (cause) {
      return { ok: false, reason: 'click-threw', detail: String(cause).slice(0, 200) };
    }
    return {
      ok: true,
      label: WANTED,
      matchedInContainer: Boolean(inHint),
      duplicates: matches.length,
      point: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
    };
  })()`;
}

/**
 * The clearest refusal anywhere on the page.
 *
 * Used after a preferences panel has been opened, where the refusal is no
 * longer inside the box the detector calls the banner. Only an explicit refusal
 * label counts: a panel whose toggles happen to start off, saved with a neutral
 * "Save" button, is not something this tool will call a refusal.
 */
function findRefusal(profile) {
  let best = null;

  for (const container of profile.containers) {
    for (const control of container.controls) {
      if (!control.visible || control.disabled) continue;
      const match = classifyControl(control);
      if (match.intent !== 'refuse') continue;
      if (!best || match.score > best.control.match.score) {
        best = { banner: { container }, control: { control, match } };
      }
    }
  }

  return best;
}

/** Press one control found by the detector, in whichever frame it lives. */
function pressControl(session, banner, found) {
  const label = normaliseLabel(
    found.match.label || found.control.text || found.control.ariaLabel,
  );
  const hint = banner.container
    ? `${banner.container.id ?? ''} ${banner.container.classes.join(' ')}`
    : '';
  return evaluate(session, clickByLabelSource(label, hint), {
    contextId: banner.container?.frameContextId,
    sessionId: banner.container?.frameSessionId,
  });
}

async function evaluate(session, expression, { awaitPromise = false, contextId, sessionId } = {}) {
  const result = await session.trySend(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise, ...(contextId ? { contextId } : {}) },
    { timeoutMs: 5_000, sessionId },
  );
  if (!result || result.exceptionDetails) return null;
  return result.result?.value ?? null;
}

/** How many frames are worth reading before the profile stops being useful. */
const MAX_FRAMES = 12;

/**
 * Read the page again, through the same collector the detector was built on —
 * and through every frame, not only the top one.
 *
 * Sourcepoint, Quantcast and several others put the whole banner inside a
 * cross-origin iframe. Read only the main frame and the audit finds an empty
 * wrapper, concludes there is no banner, and reports a site as having nothing
 * to answer for. That is the most expensive false negative this tool can make,
 * so each frame is read in its own execution context and the containers are
 * merged, each tagged with the frame it came from.
 */
export async function readProfile(session) {
  const main = parsePageProfile(
    await evaluate(session, PROFILE_EXPRESSION, { awaitPromise: true }),
  );

  const contexts = (session.frameContexts?.() ?? []).slice(0, MAX_FRAMES);

  const mainOrigin = (() => {
    try {
      return main.url ? new URL(main.url).origin : null;
    } catch {
      return null;
    }
  })();

  for (const context of contexts) {
    /* The top frame has already been read, without needing a context id. */
    if (context.origin && context.origin === mainOrigin && main.containers.length > 0) continue;

    const sub = parsePageProfile(
      await evaluate(session, FRAME_PROFILE_EXPRESSION, {
        awaitPromise: true,
        contextId: context.id,
      }),
    );
    if (sub.unreadable || sub.containers.length === 0) continue;
    if (sub.url && sub.url === main.url) continue;

    for (const container of sub.containers) {
      main.containers.push({
        ...container,
        frameContextId: context.id,
        frameOrigin: context.origin ?? sub.url ?? null,
      });
    }
    if (!main.tcf && sub.tcf) main.tcf = sub.tcf;
  }

  /*
   * And the frames that are not in this process at all. A cross-*site* iframe
   * gets its own renderer, and none of the contexts above can see it; only a
   * session of its own can. Consent-looking frames are read first, so a page
   * carrying a dozen ad frames still gets its banner read within the cap.
   */
  const children = (session.childSessions?.() ?? [])
    .slice()
    .sort((a, b) => consentLikelihood(b.url) - consentLikelihood(a.url))
    .slice(0, MAX_FRAMES);

  main.framesExamined = { sameProcess: contexts.length, outOfProcess: children.length, read: 0 };


  for (const child of children) {
    await session.trySend('Runtime.enable', {}, { sessionId: child.sessionId, timeoutMs: 3_000 });
    const sub = parsePageProfile(
      await evaluate(session, FRAME_PROFILE_EXPRESSION, {
        awaitPromise: true,
        sessionId: child.sessionId,
      }),
    );
    if (sub.unreadable || sub.containers.length === 0) continue;
    main.framesExamined.read += 1;

    for (const container of sub.containers) {
      main.containers.push({
        ...container,
        frameSessionId: child.sessionId,
        frameOrigin: sub.url ?? child.url ?? null,
      });
    }
    if (!main.tcf && sub.tcf) main.tcf = sub.tcf;
  }

  return main;
}

const CONSENT_FRAME = /consent|cmp|privacy|cookie|gdpr|sourcepoint|didomi|onetrust|quantcast/i;

function consentLikelihood(url) {
  return CONSENT_FRAME.test(String(url ?? '')) ? 1 : 0;
}

/**
 * A trusted click, dispatched by the browser rather than by script.
 *
 * Some platforms only act on events with `isTrusted`, which `element.click()`
 * cannot produce. This is the second attempt, not the first, because it needs
 * the element to be where the page said it was.
 */
async function clickAtPoint(session, point) {
  const base = { x: point.x, y: point.y, button: 'left', clickCount: 1 };
  const down = await session.trySend('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  const up = await session.trySend('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  return down !== null && up !== null;
}

/** Ask the TCF API what it now records, if there is one to ask. */
async function readTcf(session) {
  return evaluate(session, tcf.verifySource, { awaitPromise: true });
}

/**
 * Did the banner go away?
 *
 * A platform that accepted the instruction takes its notice down. This is the
 * check that stops a refusal which silently did nothing from being reported as
 * a refusal.
 */
function bannerStillPresent(profile, banner) {
  if (!banner?.container) return false;
  return profile.containers.some(
    (container) =>
      container.path === banner.container.path &&
      container.rect.width > 0 &&
      container.rect.height > 0,
  );
}

/**
 * @param {object} options
 * @param {{send: Function, trySend: Function}} options.session
 * @param {object} options.cmp result of identifyCmp
 * @param {object} options.banner result of locateBanner
 * @param {'refuse'|'accept'} options.intent
 * @returns {Promise<{ok: boolean, via: string|null, steps: object[], tcf: object|null, bannerGone: boolean}>}
 */
export async function express({ session, cmp, banner, intent }) {
  const steps = [];
  const adapter = cmp?.id ? adapterById(cmp.id) : null;
  const apiSource = adapter?.[intent === 'refuse' ? 'refuseAllSource' : 'acceptAllSource'] ?? null;

  let via = null;

  if (apiSource) {
    const result = await evaluate(session, apiSource, { awaitPromise: true });
    steps.push({ route: 'platform-api', adapter: adapter.id, result });
    if (result?.ok) via = 'platform-api';
  }

  let layer = 1;
  let activeBanner = banner;

  if (!via) {
    let control = activeBanner?.controls?.[intent === 'refuse' ? 'refuse' : 'accept'];

    /*
     * No way to refuse on the layer the visitor is shown, but a way to open
     * preferences: press that and look again. This is what a person would have
     * to do, and how many layers it took is itself a finding — a refusal buried
     * one click deeper than the acceptance is the imbalance the guidelines are
     * about.
     */
    if (!control && intent === 'refuse' && activeBanner?.controls?.preferences) {
      const opened = await pressControl(session, activeBanner, activeBanner.controls.preferences);
      steps.push({ route: 'open-preferences', result: opened });

      if (opened?.ok) {
        /*
         * A preferences panel is often fetched and animated in. Reading once
         * after a fixed pause catches the fast ones and misses the rest, so the
         * page is re-read until a refusal appears or the budget runs out.
         */
        let deeper = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await sleep(SETTLE_MS);
          deeper = await readProfile(session);
          if (findRefusal(deeper)) break;
        }
        /*
         * The refusal is looked for across the whole page, not only inside
         * whatever `locateBanner` now calls the banner. A preferences panel
         * often opens *beside* the first-layer notice, which still scores
         * higher for being the thing with an accept button on it.
         */
        const found = findRefusal(deeper);
        if (found) {
          activeBanner = found.banner;
          control = found.control;
          layer = 2;
        } else {
          steps.push({
            route: 'second-layer',
            result: { ok: false, reason: 'no-refusal-behind-preferences' },
          });
        }
      }
    }

    if (!control) {
      steps.push({ route: 'button', result: { ok: false, reason: 'no-control-located' } });
      return { ok: false, via: null, layer, steps, tcf: null, bannerGone: false };
    }

    const clicked = await pressControl(session, activeBanner, control);
    steps.push({ route: 'button', layer, result: clicked });
    if (clicked?.ok) via = layer === 1 ? 'button' : 'button-second-layer';

    /*
     * Second attempt with a trusted event, for platforms that only act on
     * `isTrusted`. Skipped for a banner inside a frame: the coordinates the
     * frame reports are its own, and dispatching them at the top level would
     * click something else entirely.
     */
    if (clicked?.ok && clicked.point && !activeBanner.container?.frameContextId) {
      await sleep(SETTLE_MS);
      const afterScript = await readProfile(session);
      if (bannerStillPresent(afterScript, banner)) {
        const dispatched = await clickAtPoint(session, clicked.point);
        steps.push({ route: 'trusted-click', point: clicked.point, result: { ok: dispatched } });
        /* Appended, not replaced: which layer the refusal came from is a finding. */
        if (dispatched) via = `${via}+trusted`;
      }
    }
  }

  await sleep(SETTLE_MS);
  const after = await readProfile(session);
  const bannerGone = !bannerStillPresent(after, activeBanner);
  const tcfState = await readTcf(session);

  /*
   * What counts as success. The banner disappearing is the visible proof. Where
   * TCF is available it is the authoritative one: a refusal that leaves purpose
   * consents recorded did not refuse anything, whatever the screen shows.
   */
  const tcfAgrees =
    tcfState && tcfState.available && Array.isArray(tcfState.purposeConsents)
      ? intent === 'refuse'
        ? tcfState.purposeConsents.length === 0
        : tcfState.purposeConsents.length > 0
      : null;

  const ok = via !== null && (tcfAgrees ?? bannerGone);

  return { ok, via, layer, steps, tcf: tcfState, bannerGone, tcfAgrees };
}

/**
 * Wipe the origin and reload, so the next capture starts from nothing.
 *
 * Scoped to the audited origin: an audit must not touch anything else the
 * browser holds, even in a window of its own.
 */
export async function resetOrigin(session, { origin, url }) {
  const cleared = await session.trySend('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'all',
  });
  await session.trySend('Network.clearBrowserCache');
  const navigated = await session.trySend('Page.navigate', { url });
  return { cleared: cleared !== null, navigated: navigated !== null };
}
