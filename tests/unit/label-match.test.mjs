import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyControl,
  classifyLabel,
  normaliseLabel,
} from '../../extension/src/content/label-match.js';

const intentOf = (text) => classifyLabel(text).intent;

describe('normaliseLabel', () => {
  it('folds case, accents, punctuation and whitespace', () => {
    assert.equal(normaliseLabel('  TOUT   REFUSER !  '), 'tout refuser');
    assert.equal(normaliseLabel('Paramétrer'), 'parametrer');
    assert.equal(normaliseLabel('J’accepte'), 'j accepte');
  });

  it('survives nothing at all', () => {
    assert.equal(normaliseLabel(null), '');
    assert.equal(normaliseLabel(undefined), '');
  });
});

describe('classifyLabel', () => {
  it('reads a refusal in every language the table covers', () => {
    for (const label of [
      'Tout refuser',
      'Refuser',
      'Reject all',
      'Decline',
      'Necessary only',
      'Alle ablehnen',
      'Nur notwendige Cookies',
      'Rechazar todo',
      'Rifiuta tutto',
      'Alles weigeren',
      'Rejeitar tudo',
    ]) {
      assert.equal(intentOf(label), 'refuse', label);
    }
  });

  it('reads an acceptance in every language the table covers', () => {
    for (const label of [
      'Tout accepter',
      "J'accepte",
      'Accept all cookies',
      'I agree',
      'Alle akzeptieren',
      'Ich stimme zu',
      'Aceptar todo',
      'Accetta tutto',
      'Alles accepteren',
      'Aceitar tudo',
    ]) {
      assert.equal(intentOf(label), 'accept', label);
    }
  });

  it('reads "continue without accepting" as the refusal it is', () => {
    // The dark pattern this table exists for: the phrase contains the word
    // "accepter", so first-match-wins would call it consent and the audit
    // would report the opposite of what happened.
    assert.equal(intentOf('Continuer sans accepter'), 'refuse');
    assert.equal(intentOf('Continue without accepting'), 'refuse');
    assert.equal(intentOf('Continuer sans accepter →'), 'refuse');
  });

  it('reads "ablehnen und weiter" as a refusal, not a continuation', () => {
    assert.equal(intentOf('Ablehnen und weiter'), 'refuse');
  });

  it('prefers the longer phrase when two patterns both match', () => {
    assert.equal(classifyLabel('Nur notwendige Cookies').matched, 'nur notwendige');
    assert.equal(classifyLabel('Continuer sans accepter').matched, 'continuer sans accepter');
  });

  it('separates preferences from either answer', () => {
    for (const label of [
      'Paramétrer mes choix',
      'Personnaliser',
      'Manage preferences',
      'Cookie settings',
      'Einstellungen',
      'Impostazioni',
    ]) {
      assert.equal(intentOf(label), 'preferences', label);
    }
  });

  it('recognises a link to the policy', () => {
    assert.equal(intentOf('Politique de confidentialité'), 'policy');
    assert.equal(intentOf('Privacy Policy'), 'policy');
    assert.equal(intentOf('Datenschutzerklärung'), 'policy');
  });

  it('scores an exact label above one merely containing the phrase', () => {
    assert.ok(classifyLabel('Tout refuser').score > classifyLabel('Cliquez ici pour tout refuser').score);
  });

  it('says nothing rather than guessing', () => {
    for (const label of ['', '   ', 'Menu', "S'abonner", 'Se connecter', 'Rechercher']) {
      assert.equal(intentOf(label), 'unknown', label);
    }
  });

  it('ignores a wall of text that happens to contain a keyword', () => {
    // Banner body copy is not a button, and treating it as one would put the
    // click somewhere unpredictable.
    const paragraph = 'x'.repeat(130) + ' accepter';
    assert.equal(intentOf(paragraph), 'unknown');
  });
});

describe('classifyControl', () => {
  it('falls back to the accessible name when the button carries only an icon', () => {
    assert.equal(classifyControl({ text: '', ariaLabel: 'Tout refuser' }).intent, 'refuse');
    assert.equal(classifyControl({ text: '✕', title: 'Reject all' }).intent, 'refuse');
  });

  it('prefers the visible text over the accessible name', () => {
    const result = classifyControl({ text: 'Tout accepter', ariaLabel: 'Refuser' });

    assert.equal(result.intent, 'accept');
  });

  it('returns unknown for a control with no label anywhere', () => {
    assert.equal(classifyControl({ text: '', ariaLabel: null, title: null }).intent, 'unknown');
    assert.equal(classifyControl(undefined).intent, 'unknown');
  });
});
