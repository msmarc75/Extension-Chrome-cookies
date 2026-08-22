/*
 * localStorage, sessionStorage and the quota-visible stores, written before the
 * visitor could answer.
 *
 * Article 5(3) is about gaining access to, or storing information in, the
 * terminal — the mechanism is beside the point. A site that moved its
 * identifier out of a cookie and into localStorage has changed the storage, not
 * the question.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, temperForProfile } from '../rule.js';

/* Keys whose whole purpose is to remember the answer to the question. */
const CONSENT_RECORD = /consent|didomi|optanon|axeptio|cookiebot|tarteaucitron|gdpr|rgpd|euconsent/i;

export const preConsentStorage = defineRule({
  id: 'PRE_CONSENT_STORAGE',
  category: CATEGORY.DEPOSIT,
  severity: SEVERITY.MAJOR,
  weight: 7,
  title: 'Terminal storage written before consent',
  legalBasis: [
    { source: 'ePrivacy', ref: 'art. 5(3)' },
    { source: 'LIL', ref: 'art. 82' },
    { source: 'CNIL', ref: 'délib. 2020-091' },
  ],
  remediation:
    'Treat localStorage, sessionStorage and IndexedDB exactly as cookies: nothing written until a choice is recorded, beyond what the service the visitor asked for strictly requires.',
  falsePositiveNotes:
    'Keys whose name shows they record the consent choice itself are set aside. A store visible only through a quota reading is reported without a key or a time and is not counted, since it cannot be shown to predate the choice.',

  evaluate(audit) {
    const capture = audit.captureA;
    if (!capture || capture.window.navigationCommittedAt === null) {
      return notApplicable('the page never loaded, so nothing could be observed');
    }

    const dated = capture.storage.filter(
      (entry) => entry.source === 'event' && typeof entry.tMs === 'number',
    );
    const counted = dated.filter((entry) => !CONSENT_RECORD.test(entry.key ?? ''));
    const undated = capture.storage.filter((entry) => entry.source === 'snapshot');

    const listed = undated.length
      ? [
          evidence(
            `${undated.length} further store(s) were found non-empty at the end of the window`,
            undated.map((entry) => entry.key ?? entry.type).slice(0, 10).join(', '),
          ),
        ]
      : [];

    if (counted.length === 0) {
      return pass(listed, { measured: { counted: 0, undated: undated.length } });
    }

    return temperForProfile(
      fail(
        [
          ...counted.map((entry) =>
            evidence(
              `${entry.type} key "${entry.key}"`,
              `${entry.bytes ?? '?'} bytes at ${Math.round(entry.tMs)} ms`,
              entry.tMs,
            ),
          ),
          ...listed,
        ],
        {
          measured: {
            counted: counted.length,
            undated: undated.length,
            firstAtMs: Math.round(Math.min(...counted.map((entry) => entry.tMs))),
          },
        },
      ),
      capture,
    );
  },
});
