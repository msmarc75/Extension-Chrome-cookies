/*
 * Identification without storage, before the visitor could answer.
 *
 * Reading pixels back off a canvas, asking WebGL which GPU is installed,
 * opening an audio context: the classic ways to build an identifier that leaves
 * nothing behind to find. Article 5(3) covers gaining access to information in
 * the terminal, which is precisely what these do.
 *
 * Each also has honest uses — charts read canvases, maps use WebGL — so a
 * single call is a question, not a finding. Several distinct techniques inside
 * five seconds, before anything has been asked, is a pattern.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, temperForProfile, warn } from '../rule.js';

export const preConsentFingerprint = defineRule({
  id: 'PRE_CONSENT_FINGERPRINT',
  category: CATEGORY.DEPOSIT,
  severity: SEVERITY.MAJOR,
  weight: 6,
  title: 'Fingerprinting surface reached before consent',
  legalBasis: [
    { source: 'ePrivacy', ref: 'art. 5(3)' },
    { source: 'CNIL', ref: 'délib. 2020-091' },
    { source: 'EDPB', ref: 'Guidelines 2/2023 on Technical Scope of Art. 5(3)' },
  ],
  remediation:
    'Gate canvas read-back, WebGL renderer queries and audio-context creation on consent, exactly as you would a cookie. Where the use is genuinely functional — a chart, a map — it should be reachable without touching the identifying parameters.',
  falsePositiveNotes:
    'A single call is reported as a question, never as a breach: charts read canvases and maps use WebGL for entirely ordinary reasons. Only two or more distinct techniques within the untouched window are treated as a finding, and the report names each API and when it was reached so the claim can be checked against the page’s own code.',

  evaluate(audit) {
    const capture = audit.captureA;
    if (!capture || capture.window.navigationCommittedAt === null) {
      return notApplicable('the page never loaded, so nothing could be observed');
    }
    if (!Array.isArray(capture.fingerprinting)) {
      return notApplicable('this capture predates fingerprint instrumentation');
    }

    const calls = capture.fingerprinting;
    if (calls.length === 0) return pass([], { measured: { techniques: 0 } });

    const asEvidence = calls.map((call) =>
      evidence(call.api, `first reached at ${Math.round(call.tMs)} ms`, call.tMs),
    );
    const families = new Set(calls.map((call) => call.api.split('.')[0]));
    const measured = { techniques: calls.length, families: families.size };

    if (families.size < 2) {
      return warn(asEvidence, {
        measured,
        because:
          'One technique on its own has ordinary uses. It is recorded so it can be checked, not counted as a finding.',
      });
    }

    return temperForProfile(fail(asEvidence, { measured }), capture);
  },
});
