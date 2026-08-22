/*
 * Can the visitor tell who is asking, and how many of them?
 *
 * "Us and our partners" is not an identification. Where a banner does give a
 * number — and the corpus is full of "our 1117 partners" — that number is
 * itself the finding: a visitor asked to consent to eleven hundred recipients
 * has not been meaningfully informed by being told the count.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, warn } from '../rule.js';

const PARTNER_COUNT = /(\d[\d\s .,]{0,6})\s*(?:partenaires?|partners?|vendors?|fournisseurs?|anbieter|socios|partner)/i;
const NAMES_SOMEONE = /(?:responsable du traitement|data controller|controller|editeur|éditeur|verantwortlich|responsable del tratamiento|titolare)/i;
const LISTS_THEM = /(?:liste (?:de |des )?(?:nos )?partenaires|list of (?:our )?partners|nos partenaires|our partners|partnerliste)/i;

export const controllersIdentified = defineRule({
  id: 'CONTROLLERS_IDENTIFIED',
  category: CATEGORY.INFORMATION,
  severity: SEVERITY.MAJOR,
  weight: 6,
  title: 'Controller and recipients identifiable',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 13(1)(a), art. 13(1)(e)' },
    { source: 'CNIL', ref: 'délib. 2020-091, art. 2' },
    { source: 'EDPB', ref: 'Guidelines 05/2020, § 65' },
  ],
  remediation:
    'Name the controller on the first screen and make the full list of recipients reachable from it in one click. Where the list runs to hundreds, the number itself is worth reconsidering before the wording is.',

  evaluate(audit) {
    const banner = audit.banner;
    if (!banner?.found) return notApplicable('no banner was located');

    const text = banner.container?.text ?? '';
    if (text.length === 0) return notApplicable('the banner carried no readable text');

    const found = [];
    const count = PARTNER_COUNT.exec(text);
    const names = NAMES_SOMEONE.test(text);
    const lists = LISTS_THEM.test(text);

    if (names) found.push(evidence('The controller is named on the first screen', null));
    if (count) {
      found.push(
        evidence(
          'The number of recipients is stated',
          `“${count[0].trim()}”`,
        ),
      );
    }
    if (lists) found.push(evidence('A list of recipients is referenced', null));

    const measured = {
      controllerNamed: names,
      partnerCount: count ? Number.parseInt(count[1].replace(/[^\d]/g, ''), 10) : null,
      listReferenced: lists,
    };

    if (!names && !count && !lists) {
      return fail([evidence('Neither the controller nor the recipients are identifiable from the banner', null)], { measured });
    }
    if (!names) {
      return warn(
        [...found, evidence('The controller itself is not named on the first screen', null)],
        { measured },
      );
    }
    return pass(found, { measured });
  },
});
