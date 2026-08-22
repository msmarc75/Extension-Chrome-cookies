/*
 * Which platform is asking for consent, and how sure are we.
 *
 * Every adapter answers with evidence rather than a boolean, because the report
 * has to say *why* it named a platform. "Didomi, because window.Didomi exists
 * and the TCF API reports CMP 7" is checkable by the reader. "Didomi" is not.
 *
 * Confidence matters as much as the name. A platform identified from a global
 * or a registered TCF id is certain; one identified only from class names is
 * likely; a banner found by reading button labels is a guess, is labelled as a
 * guess on the report, and never carries the same weight.
 *
 * These are plain functions over a page profile. Nothing here touches a browser
 * — see ../page-profile.js for why the page is read once, into a structure.
 */

import { axeptio } from './axeptio.js';
import { cookiebot } from './cookiebot.js';
import { didomi } from './didomi.js';
import { onetrust } from './onetrust.js';
import { sourcepoint } from './sourcepoint.js';
import { tarteaucitron } from './tarteaucitron.js';
import { tcf } from './tcf.js';

/*
 * Ordered by how specifically each identifies a vendor. TCF comes last on
 * purpose: it is a framework many of the others implement, so a page running
 * Didomi over TCF should be reported as Didomi, with TCF as the transport.
 */
export const ADAPTERS = [didomi, onetrust, cookiebot, axeptio, sourcepoint, tarteaucitron, tcf];

export { tcf };

const byId = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

export const adapterById = (id) => byId.get(id) ?? null;

function hostOf(url) {
  try {
    return new URL(url, 'https://example.invalid').host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Weigh one adapter against a page profile.
 * @returns {{id: string, name: string, confidence: 'certain'|'likely'|null, evidence: string[]}}
 */
export function matchAdapter(adapter, profile) {
  const evidence = [];
  let certain = false;

  for (const global of adapter.globals ?? []) {
    if (profile.globals.includes(global)) {
      evidence.push(`window.${global}`);
      certain = true;
    }
  }

  const cmpId = profile.tcf?.cmpId;
  if (typeof cmpId === 'number' && (adapter.tcfCmpIds ?? []).includes(cmpId)) {
    evidence.push(`TCF cmpId ${cmpId}`);
    certain = true;
  }

  for (const marker of adapter.markers ?? []) {
    const container = profile.containers.find(
      (candidate) =>
        marker.test(candidate.id ?? '') ||
        candidate.classes.some((className) => marker.test(className)) ||
        marker.test(candidate.path),
    );
    if (container) {
      evidence.push(`markup ${marker.source} on ${container.path}`);
    }
  }

  for (const pattern of adapter.frameHosts ?? []) {
    const frame = profile.frames.find((candidate) => pattern.test(hostOf(candidate.src)));
    if (frame) {
      evidence.push(`iframe ${hostOf(frame.src)}`);
      certain = true;
    }
  }

  return {
    id: adapter.id,
    name: adapter.name,
    confidence: evidence.length === 0 ? null : certain ? 'certain' : 'likely',
    evidence,
  };
}

/**
 * Name the consent platform, or say plainly that none was recognised.
 *
 * @param {object} profile
 * @returns {{
 *   id: string|null,
 *   name: string,
 *   confidence: 'certain'|'likely'|'heuristic'|'none',
 *   evidence: string[],
 *   tcf: object|null,
 *   alternatives: Array<{id: string, evidence: string[]}>,
 * }}
 */
export function identifyCmp(profile) {
  const matches = ADAPTERS.map((adapter) => matchAdapter(adapter, profile)).filter(
    (match) => match.confidence !== null,
  );

  const rank = (match) =>
    (match.confidence === 'certain' ? 100 : 0) +
    match.evidence.length +
    /* TCF is the transport under several of these; prefer a named vendor. */
    (match.id === 'tcf' ? -50 : 0);

  matches.sort((a, b) => rank(b) - rank(a));
  const [best, ...rest] = matches;

  if (!best) {
    return {
      id: null,
      name: 'No known consent platform',
      confidence: 'none',
      evidence: [],
      tcf: profile.tcf ?? null,
      alternatives: [],
    };
  }

  /*
   * A TCF stub with no vendor behind it is worth naming as what it is: the
   * framework is present, the platform is not identified, and the report should
   * not imply more than that.
   */
  if (best.id === 'tcf') {
    const id = profile.tcf?.cmpId;
    return {
      id: 'tcf',
      name: typeof id === 'number' ? `TCF CMP #${id}` : 'TCF (vendor unidentified)',
      confidence: best.confidence,
      evidence: best.evidence,
      tcf: profile.tcf ?? null,
      alternatives: rest.map(({ id: alternativeId, evidence }) => ({ id: alternativeId, evidence })),
    };
  }

  return {
    ...best,
    tcf: profile.tcf ?? null,
    alternatives: rest.map(({ id, evidence }) => ({ id, evidence })),
  };
}
