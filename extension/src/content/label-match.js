/*
 * What a button says, and therefore what it does.
 *
 * This is how the generic fallback works at all, and how even a recognised
 * platform's refuse button is found when its API offers no way to decline.
 * Most of the web runs no consent platform this project will ever recognise by
 * name, so the quality of this table is the quality of the fallback.
 *
 * Two traps it exists to avoid. "Continuer sans accepter" contains the word
 * *accepter* and is a refusal — so classification is by best score across all
 * intents, not by first match. And a label is normalised before comparison:
 * accents stripped, punctuation dropped, case folded, whitespace collapsed, or
 * "Tout refuser" and "TOUT REFUSER !" would be different buttons.
 */

/**
 * Fold a label to its comparable form.
 * @param {string} text
 */
export function normaliseLabel(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * Ordered by intent. Within an intent, longer and more specific phrases first —
 * "continuer sans accepter" must be tried before "continuer".
 *
 * Languages: French, English, German, Spanish, Italian, Dutch, Portuguese.
 * These are the markets a European compliance audit is asked about; the table
 * grows when the corpus shows it needs to.
 */
const PATTERNS = {
  refuse: [
    'continuer sans accepter',
    'continuer sans consentir',
    'poursuivre sans accepter',
    'refuser et fermer',
    'tout refuser',
    'refuser tout',
    'refuser',
    'je refuse',
    'non merci',
    'uniquement les cookies necessaires',
    'cookies necessaires uniquement',
    'necessaires uniquement',
    'seulement les necessaires',
    'continue without accepting',
    'reject all',
    'reject everything',
    'decline all',
    'deny all',
    'refuse all',
    'reject',
    'decline',
    'do not accept',
    'do not consent',
    'necessary only',
    'only necessary',
    'only essential',
    'essential only',
    'essential cookies only',
    'strictly necessary only',
    'use necessary cookies only',
    'alle ablehnen',
    'alles ablehnen',
    'ablehnen und weiter',
    'ablehnen',
    'nur notwendige',
    'nur erforderliche',
    'nicht zustimmen',
    'rechazar todo',
    'rechazar todas',
    'rechazar',
    'solo las necesarias',
    'solo necesarias',
    'rifiuta tutto',
    'rifiuta tutti',
    'rifiuta',
    'solo necessari',
    'alles weigeren',
    'weigeren',
    'alleen noodzakelijke',
    'rejeitar tudo',
    'rejeitar',
    'apenas essenciais',
  ],
  accept: [
    'tout accepter',
    'accepter tout',
    'accepter et fermer',
    'accepter et continuer',
    'j accepte',
    'accepter',
    'tout autoriser',
    'autoriser',
    'accept all',
    'accept all cookies',
    'accept and continue',
    'accept and close',
    'i accept',
    'i agree',
    'agree and continue',
    'agree',
    'allow all',
    'yes i agree',
    'got it',
    'accept',
    'alle akzeptieren',
    'alle cookies akzeptieren',
    'akzeptieren',
    'ich stimme zu',
    'stimme zu',
    'zustimmen',
    'einverstanden',
    'aceptar todo',
    'aceptar todas',
    'aceptar',
    'estoy de acuerdo',
    'accetta tutto',
    'accetta tutti',
    'accetta',
    'acconsento',
    'alles accepteren',
    'accepteren',
    'akkoord',
    'aceitar tudo',
    'aceitar',
  ],
  preferences: [
    'parametrer mes choix',
    'parametrer',
    'personnaliser mes choix',
    'personnaliser',
    'gerer mes choix',
    'gerer mes preferences',
    'gerer les cookies',
    'en savoir plus et parametrer',
    'plus d options',
    'mes choix',
    'manage preferences',
    'manage options',
    'manage cookies',
    'manage my choices',
    'manage settings',
    'cookie settings',
    'privacy settings',
    'customise choices',
    'customize choices',
    'customise',
    'customize',
    'more options',
    'preferences',
    'settings',
    'einstellungen',
    'anpassen',
    'mehr optionen',
    'einstellungen verwalten',
    'configurar',
    'personalizar',
    'gestionar opciones',
    'mas opciones',
    'impostazioni',
    'personalizza',
    'gestisci opzioni',
    'instellingen',
    'aanpassen',
    'beheer opties',
    'definicoes',
    'personalizar opcoes',
  ],
  policy: [
    'politique de confidentialite',
    'politique cookies',
    'politique de cookies',
    'charte de confidentialite',
    'vie privee',
    'mentions legales',
    'privacy policy',
    'cookie policy',
    'privacy notice',
    'datenschutzerklarung',
    'datenschutz',
    'cookie richtlinie',
    'politica de privacidad',
    'politica de cookies',
    'informativa sulla privacy',
    'informativa sui cookie',
    'privacybeleid',
    'politica de privacidade',
  ],
};

/** Intents in the order ties are broken: a refusal misread as consent is the costly error. */
const INTENT_ORDER = ['refuse', 'accept', 'preferences', 'policy'];

function scoreAgainst(label, patterns) {
  let best = { score: 0, matched: null };
  for (const pattern of patterns) {
    let score = 0;
    if (label === pattern) score = 1;
    else if (label.startsWith(`${pattern} `) || label.endsWith(` ${pattern}`)) score = 0.85;
    else if (label.includes(pattern)) score = 0.7;
    else continue;

    /*
     * Longer phrases win at equal score: "continuer sans accepter" must beat
     * "continuer", and "nur notwendige" must beat "notwendige".
     */
    if (score > best.score || (score === best.score && pattern.length > (best.matched?.length ?? 0))) {
      best = { score, matched: pattern };
    }
  }
  return best;
}

/**
 * Classify a control's label.
 *
 * @param {string} text visible label; pass aria-label or title when there is none
 * @returns {{intent: 'refuse'|'accept'|'preferences'|'policy'|'unknown', score: number, matched: string|null, label: string}}
 */
export function classifyLabel(text) {
  const label = normaliseLabel(text);
  if (label.length === 0 || label.length > 120) {
    return { intent: 'unknown', score: 0, matched: null, label };
  }

  let winner = { intent: 'unknown', score: 0, matched: null };
  for (const intent of INTENT_ORDER) {
    const { score, matched } = scoreAgainst(label, PATTERNS[intent]);
    if (score > winner.score) winner = { intent, score, matched };
  }

  return { ...winner, label };
}

/**
 * Classify a control from a page profile, falling back through the places a
 * label can hide when the button carries only an icon.
 * @param {{text?: string, ariaLabel?: string|null, title?: string|null}} control
 */
export function classifyControl(control) {
  for (const source of [control?.text, control?.ariaLabel, control?.title]) {
    const result = classifyLabel(source);
    if (result.intent !== 'unknown') return result;
  }
  return { intent: 'unknown', score: 0, matched: null, label: normaliseLabel(control?.text) };
}
