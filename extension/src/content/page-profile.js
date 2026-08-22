/*
 * Reads the page once, into a structure the detector can reason about offline.
 *
 * Why not a content script: content scripts run in an isolated world and cannot
 * see `window.__tcfapi`, `window.Didomi` or `window.OneTrust` — which are the
 * most reliable identifiers a page offers. Reaching the main world would mean
 * `chrome.scripting` with `<all_urls>` host permissions, a permission the store
 * scrutinises and that this product does not otherwise need. The audit already
 * holds a debugger session, so the page is read through `Runtime.evaluate`
 * instead: main world, no extra permission, and it is already attached.
 *
 * The split matters for testing as much as for permissions. This file produces
 * a *profile*; the adapters that decide which platform is asking, and the
 * heuristics that guess when none is recognised, are ordinary functions over
 * that profile. They run under Node against recorded profiles, with no browser
 * anywhere near them.
 *
 * Reading is not interacting. Nothing here dispatches an event, focuses, or
 * scrolls.
 */

/** Globals whose presence names a consent platform, or hints at one. */
export const CONSENT_GLOBALS = [
  '__tcfapi',
  '__cmp',
  '__gpp',
  '__uspapi',
  'OneTrust',
  'Optanon',
  'OptanonWrapper',
  'Didomi',
  'didomiOnReady',
  'Cookiebot',
  'CookieConsent',
  'axeptioSDK',
  '_axcb',
  'Sirdata',
  'UC_UI',
  'usercentrics',
  'Osano',
  'Termly',
  'Cookiehub',
  'klaro',
  'tarteaucitron',
  '_sp_',
  '_sp_queue',
  'consentmanager',
];

/** Words that make an element worth looking at, in the languages we target. */
const CONSENT_WORDS = [
  'cookie',
  'consent',
  'consentement',
  'gdpr',
  'rgpd',
  'privacy',
  'confidentialite',
  'datenschutz',
  'zustimmung',
  'privacidad',
  'privacidade',
  'privacy-mgmt',
  'cmp',
  'didomi',
  'onetrust',
  'optanon',
  'axeptio',
  'usercentrics',
  'sourcepoint',
  'quantcast',
  'sirdata',
  'tarteaucitron',
  'trustarc',
  'osano',
  'termly',
];

/** Caps, so a hostile or merely enormous page cannot produce an unbounded profile. */
const LIMITS = {
  containers: 14,
  controlsPerContainer: 40,
  textPreview: 600,
  controlText: 160,
  classNames: 12,
};

/**
 * Build the expression evaluated in the page. Self-contained by necessity: it
 * is sent as text and shares nothing with this module beyond the values
 * interpolated below.
 *
 * `relaxed` is for reading *inside a frame*. In the top document a banner
 * announces itself by being pinned over the content; inside a consent frame the
 * banner *is* the document, laid out statically and filling it, and the overlay
 * test would reject it. Applying the relaxed rule to the top document instead
 * would make every large section of every page a candidate.
 *
 * @param {{relaxed?: boolean}} [options]
 */
export function profileExpression({ relaxed = false } = {}) {
  return `(async () => {
  const GLOBALS = ${JSON.stringify(CONSENT_GLOBALS)};
  const WORDS = ${JSON.stringify(CONSENT_WORDS)};
  const LIMITS = ${JSON.stringify(LIMITS)};
  const RELAXED = ${relaxed ? 'true' : 'false'};

  const fold = (value) =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '');

  const squash = (value, max) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);

  const present = GLOBALS.filter((name) => {
    try { return typeof globalThis[name] !== 'undefined'; } catch (_) { return false; }
  });

  /* The TCF API names its own vendor: cmpId is a registered number. */
  const tcf = await new Promise((resolve) => {
    if (typeof globalThis.__tcfapi !== 'function') return resolve(null);
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => done({ unresponsive: true }), 2500);
    try {
      globalThis.__tcfapi('getTCData', 2, (data, success) => {
        clearTimeout(timer);
        done(success && data ? {
          cmpId: data.cmpId ?? null,
          cmpVersion: data.cmpVersion ?? null,
          tcfPolicyVersion: data.tcfPolicyVersion ?? null,
          cmpStatus: data.cmpStatus ?? null,
          eventStatus: data.eventStatus ?? null,
          gdprApplies: data.gdprApplies ?? null,
          isServiceSpecific: data.isServiceSpecific ?? null,
          purposeConsents: data.purpose && data.purpose.consents
            ? Object.keys(data.purpose.consents).filter((k) => data.purpose.consents[k])
            : [],
        } : { failed: true });
      });
    } catch (cause) {
      clearTimeout(timer);
      done({ error: String(cause).slice(0, 200) });
    }
  });

  /* Every element in the document and in every open shadow root. */
  const all = [];
  const collect = (root, depth) => {
    if (depth > 6) return;
    let elements;
    try { elements = root.querySelectorAll('*'); } catch (_) { return; }
    for (const element of elements) {
      all.push(element);
      if (element.shadowRoot) collect(element.shadowRoot, depth + 1);
    }
  };
  collect(document, 0);

  const viewport = { width: innerWidth, height: innerHeight };
  const viewportArea = Math.max(1, viewport.width * viewport.height);

  const visible = (element, style, rect) =>
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number(style.opacity) !== 0 &&
    rect.width > 0 &&
    rect.height > 0;

  const identity = (element) =>
    fold(
      element.id + ' ' + (element.className && element.className.baseVal !== undefined
        ? element.className.baseVal
        : element.className || '') + ' ' +
      (element.getAttribute('data-testid') || '') + ' ' +
      (element.getAttribute('aria-label') || '') + ' ' +
      element.tagName,
    );

  const pathOf = (element) => {
    const parts = [];
    let node = element;
    let hops = 0;
    while (node && node.nodeType === 1 && hops < 8) {
      let part = node.tagName.toLowerCase();
      if (node.id) { part += '#' + node.id; parts.unshift(part); break; }
      const classes = (node.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean);
      if (classes.length > 0) part += '.' + classes.slice(0, 2).join('.');
      parts.unshift(part);
      node = node.parentElement || (node.getRootNode() && node.getRootNode().host) || null;
      hops += 1;
    }
    return parts.join(' > ');
  };

  /*
   * A container is worth recording when it names itself after consent, or when
   * it behaves like an overlay: pinned, visible, and occupying enough of the
   * viewport to be something the visitor must deal with.
   */
  const candidates = [];
  for (const element of all) {
    /*
     * The document and its body are never the banner, and several platforms
     * put a marker class on one of them while the notice is open — which would
     * otherwise make the whole page look like the banner and swallow it.
     */
    if (element === document.documentElement || element === document.body) continue;

    let style;
    let rect;
    try {
      style = getComputedStyle(element);
      rect = element.getBoundingClientRect();
    } catch (_) { continue; }
    if (!visible(element, style, rect)) continue;

    const named = WORDS.some((word) => identity(element).includes(word));
    const pinned = style.position === 'fixed' || style.position === 'sticky';
    const modal =
      element.getAttribute('role') === 'dialog' ||
      element.getAttribute('role') === 'alertdialog' ||
      element.getAttribute('aria-modal') === 'true' ||
      (element.tagName === 'DIALOG' && element.hasAttribute('open'));
    const area = (rect.width * rect.height) / viewportArea;

    const overlay = pinned && area >= 0.02;
    /* Inside a frame, filling a good part of it is the same signal. */
    const fillsFrame = RELAXED && area >= 0.15;
    if (!named && !modal && !overlay && !fillsFrame) continue;
    candidates.push({ element, style, rect, named, pinned, modal, area });
  }

  /*
   * Elements sharing a bounding box are the same visual box wrapped several
   * times over; keep the outermost of each. Genuinely nested boxes are all
   * kept: which one is the banner is a decision for the detector, and a
   * wrapper discarded here cannot be recovered there.
   */
  const boxKey = (candidate) => [
    Math.round(candidate.rect.x), Math.round(candidate.rect.y),
    Math.round(candidate.rect.width), Math.round(candidate.rect.height),
  ].join();

  /*
   * Drop a candidate only when another candidate with the same box *contains*
   * it — that pair is one visual box wrapped twice. Two boxes that merely
   * coincide are not: a preferences panel opening exactly where the notice sat
   * is a different element with different buttons, and collapsing the two would
   * hide the refusal behind the acceptance.
   */
  const deduped = candidates.filter(
    (candidate) => !candidates.some(
      (other) =>
        other !== candidate &&
        boxKey(other) === boxKey(candidate) &&
        other.element.contains(candidate.element),
    ),
  );

  const score = (candidate) =>
    (candidate.named ? 4 : 0) + (candidate.modal ? 2 : 0) + (candidate.pinned ? 2 : 0) +
    Math.min(2, candidate.area * 4);

  const chosen = deduped
    .sort((a, b) => score(b) - score(a))
    .slice(0, LIMITS.containers);

  /*
   * The bit of a control that a prominence comparison needs. Colours come back
   * from getComputedStyle already resolved to rgb()/rgba(), so the engine can
   * parse them without knowing anything about the page's stylesheets. A
   * transparent background is walked up the ancestors, because a button painted
   * by its container still looks painted to the visitor.
   */
  const paintedBackground = (element) => {
    let node = element;
    for (let hops = 0; node && hops < 8; hops += 1) {
      let colour;
      try { colour = getComputedStyle(node).backgroundColor; } catch (_) { return null; }
      if (colour && !/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(colour) && colour !== 'transparent') {
        return colour;
      }
      node = node.parentElement || (node.getRootNode() && node.getRootNode().host) || null;
    }
    return null;
  };

  const controlOf = (element) => {
    let style;
    let rect;
    try {
      style = getComputedStyle(element);
      rect = element.getBoundingClientRect();
    } catch (_) { return null; }
    return {
      styles: {
        color: style.color || null,
        backgroundColor: paintedBackground(element),
        ownBackgroundColor: style.backgroundColor || null,
        fontSize: Number.parseFloat(style.fontSize) || null,
        fontWeight: style.fontWeight || null,
        borderColor: style.borderTopColor || null,
        borderWidth: Number.parseFloat(style.borderTopWidth) || 0,
        opacity: Number.parseFloat(style.opacity),
        textDecorationLine: style.textDecorationLine || null,
      },
      path: pathOf(element),
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type') || null,
      role: element.getAttribute('role') || null,
      id: element.id || null,
      classes: (element.getAttribute('class') || '').trim().split(/\\s+/)
        .filter(Boolean).slice(0, LIMITS.classNames),
      text: squash(element.innerText || element.textContent || '', LIMITS.controlText),
      ariaLabel: squash(element.getAttribute('aria-label') || '', LIMITS.controlText) || null,
      title: squash(element.getAttribute('title') || '', LIMITS.controlText) || null,
      /* Resolved against the document, because the policy is fetched from
         another page and a relative href would be read against the wrong one. */
      href: element.tagName === 'A' ? (element.href || null) : null,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y),
              width: Math.round(rect.width), height: Math.round(rect.height) },
      visible: visible(element, style, rect),
      disabled: Boolean(element.disabled),
    };
  };

  const containers = chosen.map((candidate) => {
    const root = candidate.element;
    const controls = [];
    const seen = new Set();
    const gather = (node, depth) => {
      if (depth > 6 || controls.length >= LIMITS.controlsPerContainer) return;
      let found;
      try {
        found = node.querySelectorAll(
          'button, a[href], [role="button"], [role="link"], input[type="button"], input[type="submit"], summary',
        );
      } catch (_) { return; }
      for (const element of found) {
        if (seen.has(element) || controls.length >= LIMITS.controlsPerContainer) continue;
        seen.add(element);
        const control = controlOf(element);
        if (control) controls.push(control);
      }
      let hosts;
      try { hosts = node.querySelectorAll('*'); } catch (_) { return; }
      for (const host of hosts) {
        if (host.shadowRoot) gather(host.shadowRoot, depth + 1);
      }
    };
    gather(root, 0);

    /*
     * Switches and checkboxes, with the state they were in before anyone
     * touched them. A purpose that starts switched on is consent nobody gave.
     */
    const inputs = [];
    const gatherInputs = (node, depth) => {
      if (depth > 6 || inputs.length >= LIMITS.controlsPerContainer) return;
      let found;
      try {
        found = node.querySelectorAll(
          'input[type="checkbox"], input[type="radio"], [role="switch"], [role="checkbox"]',
        );
      } catch (_) { return; }
      for (const element of found) {
        if (inputs.length >= LIMITS.controlsPerContainer) break;
        let style;
        let rect;
        try {
          style = getComputedStyle(element);
          rect = element.getBoundingClientRect();
        } catch (_) { continue; }
        const aria = element.getAttribute('aria-checked');
        const labelled =
          (element.id && root.querySelector('label[for="' + CSS.escape(element.id) + '"]')) ||
          element.closest('label');
        inputs.push({
          path: pathOf(element),
          type: element.getAttribute('type') || element.getAttribute('role') || null,
          checked: aria === null ? Boolean(element.checked) : aria === 'true',
          disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true',
          name: element.getAttribute('name') || null,
          label: squash(
            (labelled && labelled.innerText) || element.getAttribute('aria-label') || '',
            LIMITS.controlText,
          ),
          visible: visible(element, style, rect),
        });
      }
      let hosts;
      try { hosts = node.querySelectorAll('*'); } catch (_) { return; }
      for (const host of hosts) if (host.shadowRoot) gatherInputs(host.shadowRoot, depth + 1);
    };
    gatherInputs(root, 0);

    return {
      path: pathOf(root),
      tag: root.tagName.toLowerCase(),
      id: root.id || null,
      classes: (root.getAttribute('class') || '').trim().split(/\\s+/)
        .filter(Boolean).slice(0, LIMITS.classNames),
      role: root.getAttribute('role') || null,
      ariaModal: root.getAttribute('aria-modal') === 'true',
      position: candidate.style.position,
      zIndex: candidate.style.zIndex,
      rect: { x: Math.round(candidate.rect.x), y: Math.round(candidate.rect.y),
              width: Math.round(candidate.rect.width), height: Math.round(candidate.rect.height) },
      viewportShare: Number(candidate.area.toFixed(4)),
      namedForConsent: candidate.named,
      text: squash(root.innerText || root.textContent || '', LIMITS.textPreview),
      inShadow: root.getRootNode() !== document,
      controls,
      inputs,
    };
  });

  /* Iframes are how several platforms render their banner. */
  const frames = [];
  try {
    for (const frame of document.querySelectorAll('iframe')) {
      const source = frame.getAttribute('src') || '';
      if (!source) continue;
      frames.push({ src: source.slice(0, 300), name: frame.getAttribute('name') || null });
    }
  } catch (_) {}

  /*
   * Where the site says its policy lives. Collected from the whole document
   * rather than from the banner, because the banner is where the *good* answer
   * is and this is the fallback for when it has none.
   */
  const policyLinks = [];
  try {
    const POLICY_WORDS = /privacy|confidentialit|datenschutz|privacidad|privacy|cookie|rgpd|gdpr|donnees personnelles|personal data|informativa/;
    const seenHref = new Set();
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = anchor.href || '';
      if (!href.startsWith('http') || seenHref.has(href)) continue;
      const label = fold(anchor.innerText || anchor.textContent || '');
      if (!POLICY_WORDS.test(label) && !POLICY_WORDS.test(fold(href))) continue;
      seenHref.add(href);
      policyLinks.push({ href: href.slice(0, 500), text: squash(label, 120) });
      if (policyLinks.length >= 24) break;
    }
  } catch (_) {}

  return JSON.stringify({
    url: location.href,
    title: squash(document.title, 200),
    lang: (document.documentElement.lang || '').slice(0, 16) || null,
    viewport,
    globals: present,
    tcf,
    containers,
    frames: frames.slice(0, 20),
    policyLinks,
  });
})()`;
}

/** The collector for a top-level document. */
export const PROFILE_EXPRESSION = profileExpression();

/** The collector for a frame, where the banner is the whole document. */
export const FRAME_PROFILE_EXPRESSION = profileExpression({ relaxed: true });

/*
 * Built fresh each time rather than shared. Callers merge frames into a
 * profile, and a frozen singleton would turn "the page could not be read" into
 * a thrown error halfway through an audit.
 */
const emptyProfile = () => ({
  url: null,
  title: '',
  lang: null,
  viewport: { width: 0, height: 0 },
  globals: [],
  tcf: null,
  containers: [],
  frames: [],
  policyLinks: [],
  unreadable: true,
});

/**
 * Parse what the expression returned. The page can reach everything the
 * expression touches, so nothing that comes back may be trusted on its shape.
 *
 * @param {unknown} raw JSON string returned by Runtime.evaluate
 */
export function parsePageProfile(raw) {
  if (typeof raw !== 'string') return emptyProfile();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyProfile();
  }
  /* An array is JSON, and an object, and not a profile. */
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return emptyProfile();
  }

  return {
    url: typeof parsed.url === 'string' ? parsed.url : null,
    title: typeof parsed.title === 'string' ? parsed.title : '',
    lang: typeof parsed.lang === 'string' ? parsed.lang : null,
    viewport: {
      width: Number(parsed.viewport?.width) || 0,
      height: Number(parsed.viewport?.height) || 0,
    },
    globals: Array.isArray(parsed.globals)
      ? parsed.globals.filter((name) => typeof name === 'string')
      : [],
    tcf: typeof parsed.tcf === 'object' ? parsed.tcf : null,
    containers: Array.isArray(parsed.containers)
      ? parsed.containers.filter((c) => typeof c === 'object' && c !== null).map(normaliseContainer)
      : [],
    frames: Array.isArray(parsed.frames)
      ? parsed.frames.filter((f) => typeof f?.src === 'string')
      : [],
    policyLinks: Array.isArray(parsed.policyLinks)
      ? parsed.policyLinks
          .filter((link) => typeof link?.href === 'string')
          .map((link) => ({ href: link.href, text: String(link.text ?? '') }))
      : [],
    unreadable: false,
  };
}

const RECT = { x: 0, y: 0, width: 0, height: 0 };

function normaliseContainer(container) {
  return {
    path: String(container.path ?? ''),
    tag: String(container.tag ?? ''),
    id: container.id ?? null,
    classes: Array.isArray(container.classes) ? container.classes.map(String) : [],
    role: container.role ?? null,
    ariaModal: container.ariaModal === true,
    position: String(container.position ?? ''),
    zIndex: String(container.zIndex ?? ''),
    rect: { ...RECT, ...(container.rect ?? {}) },
    viewportShare: Number(container.viewportShare) || 0,
    namedForConsent: container.namedForConsent === true,
    text: String(container.text ?? ''),
    inShadow: container.inShadow === true,
    controls: Array.isArray(container.controls)
      ? container.controls
          .filter((control) => typeof control === 'object' && control !== null)
          .map((control) => ({
            path: String(control.path ?? ''),
            tag: String(control.tag ?? ''),
            type: control.type ?? null,
            role: control.role ?? null,
            id: control.id ?? null,
            classes: Array.isArray(control.classes) ? control.classes.map(String) : [],
            text: String(control.text ?? ''),
            ariaLabel: control.ariaLabel ?? null,
            title: control.title ?? null,
            href: typeof control.href === 'string' ? control.href : null,
            rect: { ...RECT, ...(control.rect ?? {}) },
            visible: control.visible !== false,
            disabled: control.disabled === true,
            styles: normaliseStyles(control.styles),
          }))
      : [],
    inputs: Array.isArray(container.inputs)
      ? container.inputs
          .filter((input) => typeof input === 'object' && input !== null)
          .map((input) => ({
            path: String(input.path ?? ''),
            type: input.type ?? null,
            checked: input.checked === true,
            disabled: input.disabled === true,
            name: input.name ?? null,
            label: String(input.label ?? ''),
            visible: input.visible !== false,
          }))
      : [],
  };
}

const NO_STYLES = {
  color: null,
  backgroundColor: null,
  ownBackgroundColor: null,
  fontSize: null,
  fontWeight: null,
  borderColor: null,
  borderWidth: 0,
  opacity: 1,
  textDecorationLine: null,
};

function normaliseStyles(styles) {
  if (typeof styles !== 'object' || styles === null) return { ...NO_STYLES };
  const number = (value, fallback) => (Number.isFinite(value) ? value : fallback);
  return {
    color: typeof styles.color === 'string' ? styles.color : null,
    backgroundColor: typeof styles.backgroundColor === 'string' ? styles.backgroundColor : null,
    ownBackgroundColor:
      typeof styles.ownBackgroundColor === 'string' ? styles.ownBackgroundColor : null,
    fontSize: number(styles.fontSize, null),
    fontWeight: styles.fontWeight === undefined ? null : String(styles.fontWeight),
    borderColor: typeof styles.borderColor === 'string' ? styles.borderColor : null,
    borderWidth: number(styles.borderWidth, 0),
    opacity: number(styles.opacity, 1),
    textDecorationLine:
      typeof styles.textDecorationLine === 'string' ? styles.textDecorationLine : null,
  };
}
