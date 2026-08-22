/*
 * Does the banner say what the data is for, before asking?
 *
 * Consent is informed or it is not consent. A notice that says "we use cookies
 * to improve your experience" and nothing else has not told the visitor what
 * they are agreeing to.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, warn } from '../rule.js';

/* Named purposes, in the languages the banner corpus actually spoke. */
const PURPOSE_WORDS = [
  'publicit', 'advertis', 'werbung', 'publicidad', 'pubblicit',
  'personnalis', 'personalis', 'personaliz',
  'mesure', 'audience', 'analyt', 'statist', 'messung',
  'contenu', 'content', 'inhalt', 'contenido', 'contenut',
  'geolocalisation', 'geolocation', 'standortdaten',
  'profil', 'profiling',
  'reseaux sociaux', 'social media', 'soziale medien',
];

const fold = (value) =>
  String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const purposesStated = defineRule({
  id: 'PURPOSES_STATED',
  category: CATEGORY.INFORMATION,
  severity: SEVERITY.MAJOR,
  weight: 6,
  title: 'Purposes stated before the choice',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 4(11), art. 13(1)(c)' },
    { source: 'CNIL', ref: 'délib. 2020-091, art. 2' },
    { source: 'EDPB', ref: 'Guidelines 05/2020, §§ 62-64' },
  ],
  remediation:
    'Name the purposes on the first screen, in the visitor’s terms: advertising, audience measurement, personalised content. A link to the policy is not a substitute for saying it here.',

  evaluate(audit) {
    const banner = audit.banner;
    if (!banner?.found) return notApplicable('no banner was located');

    const text = fold(banner.container?.text ?? '');
    if (text.length === 0) {
      return notApplicable('the banner carried no readable text');
    }

    const named = [...new Set(PURPOSE_WORDS.filter((word) => text.includes(word)))];
    const measured = { purposeWords: named.length, textLength: text.length };

    if (named.length >= 2) {
      return pass([evidence('Purposes named on the first screen', named.slice(0, 6).join(', '))], { measured });
    }
    if (named.length === 1) {
      return warn(
        [evidence('Only one purpose is named on the first screen', named[0])],
        { measured },
      );
    }
    return fail(
      [
        evidence('No purpose is named on the first screen', `${text.length} characters of text, none of them a purpose`),
      ],
      { measured },
    );
  },
});
