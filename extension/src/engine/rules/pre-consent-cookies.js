/*
 * Cookies written before the visitor could answer, minus the ones that never
 * needed an answer.
 *
 * The exemption table is what makes this rule usable. A session cookie, a bot
 * manager's cookie, the cookie recording the visitor's own refusal — listing
 * those as breaches is how a compliance tool loses a professional on the first
 * try.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, temperForProfile, warn } from '../rule.js';
import { exemptionFor, knownTrackerCookie } from '../data/exemptions.js';
import { classifyHost } from '../tracker-classifier.js';

export const preConsentCookies = defineRule({
  id: 'PRE_CONSENT_COOKIES',
  category: CATEGORY.DEPOSIT,
  severity: SEVERITY.BLOCKING,
  weight: 10,
  title: 'Cookies written before consent',
  legalBasis: [
    { source: 'ePrivacy', ref: 'art. 5(3)' },
    { source: 'LIL', ref: 'art. 82' },
    { source: 'CNIL', ref: 'délib. 2020-091' },
  ],
  remediation:
    'Write nothing but strictly necessary cookies until a choice is recorded. Where audience measurement is claimed as exempt, keep the evidence that it meets the CNIL’s conditions — own-site only, no cross-site profile, no onward sharing.',
  falsePositiveNotes:
    'A cookie is only counted when it can be positively identified as non-necessary: written by a domain classified as advertising or social, or bearing a name that is a known tracker identifier. Everything else — a site’s own operational cookie whose purpose cannot be read from outside — is raised for review, because "not on the exemption list" is not the same as "not necessary" and treating it as such flagged Wikipedia on the first run. Audience measurement is raised for review too: its exemption depends on a configuration invisible from outside. A cookie found in the jar with no observable moment of writing cannot be shown to predate the choice and is never counted.',

  evaluate(audit) {
    const capture = audit.captureA;
    if (!capture || capture.window.navigationCommittedAt === null) {
      return notApplicable('the page never loaded, so nothing could be observed');
    }

    const counted = [];
    const review = [];
    const exempted = [];

    for (const cookie of capture.cookies) {
      const exemption = exemptionFor(cookie);
      if (exemption.exempt && !exemption.needsReview) {
        exempted.push({ cookie, exemption });
        continue;
      }
      if (exemption.needsReview) {
        review.push({ cookie, exemption });
        continue;
      }
      /* Undatable means unprovable. It is listed, never counted. */
      if (cookie.tMs === null) {
        review.push({ cookie, exemption: { note: 'written from script, moment not observable' } });
        continue;
      }

      /*
       * Counted only on positive identification. The host is classified as
       * advertising or social — categories for which no exemption exists — or
       * the name is a known tracker identifier, which is how most of them are
       * set on the site's own domain now. Anything else is a cookie whose
       * purpose cannot be read from outside, and guessing produced a blocking
       * failure against Wikipedia.
       */
      const host = classifyHost(cookie.host);
      const known = knownTrackerCookie(cookie);
      if (host.category === 'advertising' || host.category === 'social') {
        counted.push({ cookie, why: `set by ${host.matched} (${host.category}${host.entity ? `, ${host.entity}` : ''})` });
      } else if (known.known) {
        counted.push({ cookie, why: known.note });
      } else {
        review.push({
          cookie,
          exemption: { note: 'purpose not determinable from outside the site' },
        });
      }
    }

    const asEvidence = (cookie, detail) =>
      evidence(
        `${cookie.name} on ${cookie.host}`,
        detail ??
          `${cookie.party}-party, ${cookie.session ? 'session' : 'persistent'}, at ${Math.round(cookie.tMs)} ms`,
        cookie.tMs,
      );

    const reviewEvidence = review.map(({ cookie, exemption }) =>
      asEvidence(cookie, `raised for review — ${exemption.note}`),
    );

    if (counted.length === 0) {
      const result = review.length > 0
        ? warn(reviewEvidence, { measured: { counted: 0, forReview: review.length, exempted: exempted.length } })
        : pass([], { measured: { counted: 0, forReview: 0, exempted: exempted.length } });
      return result;
    }

    return temperForProfile(
      fail(
        [
          ...counted.map(({ cookie, why }) =>
            asEvidence(
              cookie,
              `${why}; ${cookie.session ? 'session' : 'persistent'}, at ${Math.round(cookie.tMs)} ms`,
            ),
          ),
          ...reviewEvidence,
        ],
        {
          measured: {
            counted: counted.length,
            forReview: review.length,
            exempted: exempted.length,
            firstAtMs: Math.round(Math.min(...counted.map(({ cookie }) => cookie.tMs))),
          },
        },
      ),
      capture,
    );
  },
});
