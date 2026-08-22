/*
 * Advertising, analytics and social calls made before the visitor could answer.
 *
 * The most incriminating measurement the report carries, and therefore the one
 * held to the strictest false-positive standard: only domains the tracker table
 * positively classifies count. A third party nobody recognised is reported as
 * unclassified — the practitioner is told it is there and left to judge — and a
 * consent platform is never counted, because loading one is how a site asks.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, temperForProfile, warn } from '../rule.js';
import { classifyCapture } from '../tracker-classifier.js';

export const preConsentTrackers = defineRule({
  id: 'PRE_CONSENT_TRACKERS',
  category: CATEGORY.DEPOSIT,
  severity: SEVERITY.BLOCKING,
  weight: 12,
  title: 'Trackers contacted before consent',
  legalBasis: [
    { source: 'ePrivacy', ref: 'art. 5(3)' },
    { source: 'GDPR', ref: 'art. 6(1)(a)' },
    { source: 'LIL', ref: 'art. 82' },
    { source: 'CNIL', ref: 'délib. 2020-091' },
  ],
  remediation:
    'Hold every advertising, analytics and social tag until consent is recorded. Loading the tag manager itself is not enough of a delay: the tags it fires must be gated on the consent signal, not on the manager being ready.',
  falsePositiveNotes:
    'A domain is only counted when the shipped table classifies it. Publishers commonly serve their own assets from a separate registrable domain — bbci.co.uk for the BBC, guim.co.uk for The Guardian — which is why an unrecognised third party is never counted. Advertising and social calls are a failure outright, since no exemption covers them; where the only calls are to audience measurement, the verdict is a warning, because the CNIL exempts measurement under conditions that cannot be checked from outside the site. The table is short and misses trackers; the miss is deliberate.',

  evaluate(audit) {
    const capture = audit.captureA;
    if (!capture || capture.window.navigationCommittedAt === null) {
      return notApplicable('the page never loaded, so nothing could be observed');
    }

    const { deposits, unclassified } = classifyCapture(capture);
    const notes = unclassified.length
      ? [
          evidence(
            `${unclassified.length} further third-party domain(s) were contacted but are not in the shipped table`,
            unclassified.slice(0, 12).map((entry) => entry.domain).join(', '),
          ),
        ]
      : [];

    if (deposits.length === 0) {
      return pass(notes, { measured: { trackerDomains: 0, unclassified: unclassified.length } });
    }

    /*
     * Advertising and social have no exemption available to them. Audience
     * measurement does, under conditions invisible from here — so a page whose
     * only pre-consent calls are to measurement gets the question, not the
     * finding.
     */
    const unexemptable = deposits.filter(
      (entry) => entry.category === 'advertising' || entry.category === 'social',
    );

    const found = deposits.map((entry) =>
      evidence(
        `${entry.domain} (${entry.category}${entry.entity ? `, ${entry.entity}` : ''})`,
        `${entry.requests} request(s), first at ${Math.round(entry.firstSeenMs)} ms`,
        entry.firstSeenMs,
      ),
    );

    const measured = {
      trackerDomains: deposits.length,
      advertisingOrSocial: unexemptable.length,
      unclassified: unclassified.length,
      firstAtMs: Math.round(deposits[0].firstSeenMs),
    };

    if (unexemptable.length === 0) {
      return warn(
        [
          ...found,
          evidence(
            'All of these are audience measurement',
            'the CNIL exempts measurement when it is confined to the site’s own audience and shared with nobody — conditions this tool cannot verify. Check the configuration before concluding.',
          ),
          ...notes,
        ],
        { measured },
      );
    }

    return temperForProfile(fail([...found, ...notes], { measured }), capture);
  },
});
