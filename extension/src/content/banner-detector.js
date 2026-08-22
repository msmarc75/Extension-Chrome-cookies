/*
 * Which box on the page is the consent banner, and which of its buttons is
 * which.
 *
 * When the platform is recognised, its own markup names the banner and this is
 * nearly free. When it is not — which is most of the web — the banner has to be
 * found by what it looks like and what its buttons say. That fallback is
 * honest work, and the report says so in as many words: a finding built on a
 * guessed banner is worth less than one built on a known platform, and the
 * reader has to be able to tell them apart.
 *
 * A pure function of a page profile. No browser here.
 */

import { classifyControl } from './label-match.js';
import { adapterById } from './cmp-adapters/index.js';

/** Words that make a block of text look like a consent notice. */
const CONSENT_TEXT = [
  'cookie',
  'consent',
  'consentement',
  'traceur',
  'donnees personnelles',
  'vie privee',
  'privacy',
  'personal data',
  'gdpr',
  'rgpd',
  'datenschutz',
  'einwilligung',
  'privacidad',
  'privacidade',
  'informativa',
  'partner',
  'partenaires',
  'finalites',
  'purposes',
];

const fold = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Best control of each intent inside a container. */
function readControls(container) {
  const found = { accept: null, refuse: null, preferences: null, policy: null };

  for (const control of container.controls) {
    if (!control.visible || control.disabled) continue;
    const classified = classifyControl(control);
    if (classified.intent === 'unknown') continue;

    const current = found[classified.intent];
    if (!current || classified.score > current.match.score) {
      found[classified.intent] = { control, match: classified };
    }
  }

  return found;
}

/**
 * Score a container on how much it behaves like a consent banner.
 * Returns the score and the reasons, because the reasons are what the report
 * shows when it has to admit the banner was guessed at.
 */
function scoreContainer(container) {
  const controls = readControls(container);
  const text = fold(container.text);
  const reasons = [];
  let score = 0;

  if (controls.accept && (controls.refuse || controls.preferences)) {
    score += 5;
    reasons.push('offers a choice, not just an acceptance');
  } else if (controls.accept) {
    score += 3;
    reasons.push('offers an acceptance');
  }

  const words = CONSENT_TEXT.filter((word) => text.includes(word));
  if (words.length > 0) {
    score += Math.min(3, words.length);
    reasons.push(`text mentions ${words.slice(0, 3).join(', ')}`);
  }

  if (container.namedForConsent) {
    score += 3;
    reasons.push('named for consent in its markup');
  }

  if (container.position === 'fixed' || container.position === 'sticky') {
    score += 2;
    reasons.push(`pinned to the viewport (${container.position})`);
  }

  if (container.ariaModal || container.role === 'dialog' || container.role === 'alertdialog') {
    score += 2;
    reasons.push('declared as a dialog');
  }

  const zIndex = Number.parseInt(container.zIndex, 10);
  if (Number.isFinite(zIndex) && zIndex >= 1000) {
    score += 1;
    reasons.push(`z-index ${zIndex}`);
  }

  /*
   * A sliver is furniture and a full-bleed layer is usually the backdrop. What
   * a banner occupies is somewhere in between.
   */
  if (container.viewportShare >= 0.03 && container.viewportShare <= 0.9) {
    score += 2;
    reasons.push(`covers ${Math.round(container.viewportShare * 100)}% of the viewport`);
  }

  return { score, reasons, controls };
}

/** Below this, what was found is furniture rather than a banner. */
const HEURISTIC_THRESHOLD = 7;

/**
 * @param {object} profile a page profile
 * @param {object} cmp the result of identifyCmp
 * @returns {{
 *   found: boolean,
 *   method: 'platform-markup'|'heuristic'|'frame-only'|'none',
 *   confidence: 'certain'|'likely'|'heuristic'|'none',
 *   container: object|null,
 *   controls: object,
 *   reasons: string[],
 *   disclosure: string|null,
 * }}
 */
export function locateBanner(profile, cmp) {
  const scored = profile.containers
    .map((container) => ({ container, ...scoreContainer(container) }))
    .sort((a, b) => b.score - a.score);

  /* When the platform is known, its own markup settles which box is the banner. */
  const adapter = cmp?.id ? adapterById(cmp.id) : null;
  const byMarkup = adapter?.markers?.length
    ? scored.find(({ container }) =>
        adapter.markers.some(
          (marker) =>
            marker.test(container.id ?? '') ||
            container.classes.some((className) => marker.test(className)) ||
            marker.test(container.path),
        ),
      )
    : null;

  const hasChoice = (candidate) => Boolean(candidate?.controls.accept || candidate?.controls.refuse);

  if (byMarkup) {
    /*
     * The element the platform names is sometimes only the wrapper — Sourcepoint
     * names a `sp_message_container` whose entire content lives in an iframe.
     * When the named box holds no buttons and another box does, the buttons win:
     * a banner with no controls is not something an audit can say anything about.
     */
    const withControls = hasChoice(byMarkup)
      ? byMarkup
      : (scored.find((candidate) => hasChoice(candidate) && candidate.score >= HEURISTIC_THRESHOLD) ??
        byMarkup);

    return {
      found: true,
      method: 'platform-markup',
      confidence: cmp.confidence === 'certain' ? 'certain' : 'likely',
      container: withControls.container,
      controls: withControls.controls,
      reasons:
        withControls === byMarkup
          ? [`${cmp.name} markup`, ...byMarkup.reasons]
          : [`${cmp.name} markup on ${byMarkup.container.path}`, 'controls found in', ...withControls.reasons],
      disclosure:
        withControls === byMarkup
          ? null
          : `${cmp.name} was identified from its own markup, but its buttons were found in a separate box — typically its banner frame.`,
    };
  }

  const best = scored[0];
  if (best && best.score >= HEURISTIC_THRESHOLD) {
    const knownPlatform = cmp?.confidence === 'certain';
    return {
      found: true,
      method: 'heuristic',
      confidence: knownPlatform ? 'likely' : 'heuristic',
      container: best.container,
      controls: best.controls,
      reasons: best.reasons,
      disclosure: knownPlatform
        ? `${cmp.name} was identified, but its banner was located by appearance rather than by its own markup.`
        : 'No known consent platform was identified. The banner was located by appearance and by what its buttons say, so these findings are weaker than usual.',
    };
  }

  /*
   * Several platforms render the banner inside a cross-origin iframe, where
   * nothing above can see it. Reporting "no banner" there would be a false
   * negative of the worst kind — the site looks compliant because the tool
   * went blind.
   */
  const consentFrame = profile.frames.find((frame) => /consent|cmp|privacy|cookie/i.test(frame.src));
  if (consentFrame) {
    return {
      found: false,
      method: 'frame-only',
      confidence: 'none',
      container: null,
      controls: { accept: null, refuse: null, preferences: null, policy: null },
      reasons: [`a consent iframe is present: ${consentFrame.src.slice(0, 120)}`],
      disclosure:
        'The banner is rendered inside a separate frame, which this capture could not read into. Its contents were not examined.',
    };
  }

  return {
    found: false,
    method: 'none',
    confidence: 'none',
    container: null,
    controls: { accept: null, refuse: null, preferences: null, policy: null },
    reasons: best ? [`best candidate scored ${best.score}, below the threshold`] : ['no candidate'],
    disclosure: null,
  };
}
