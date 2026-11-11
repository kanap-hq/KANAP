import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { checkSentence } from './budgetFileText';

// A new dimension value the analytics rules refuse: the check sends a code and its values, never its
// English sentence alone, and the dialog and Kad's card say it in the person's language.

const tooLong = {
  message: 'Name must be 200 characters or fewer.',
  code: 'BUDGET_FILE_DIMENSION_VALUE_TOO_LONG',
  params: { name: 'Nature', max: 200 },
};
const hidden = {
  message: 'Name cannot contain control or invisible characters.',
  code: 'BUDGET_FILE_DIMENSION_VALUE_CHARACTERS',
  params: { name: 'Nature' },
};

describe('checkSentence of a refused dimension value', () => {
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it('says it in the four languages', async () => {
    const said: Record<string, string[]> = {};
    for (const lng of ['en', 'fr', 'de', 'es']) {
      await i18n.changeLanguage(lng);
      said[lng] = [checkSentence(tooLong, i18n.t), checkSentence(hidden, i18n.t)];
    }
    expect(said.en).toEqual([
      'A value of Nature must be 200 characters or fewer.',
      'A value of Nature cannot contain control or invisible characters.',
    ]);
    expect(said.fr[0]).toBe('Une valeur de Nature ne doit pas dépasser 200 caractères.');
    expect(said.fr[1]).toBe('Une valeur de Nature ne peut pas contenir de caractères de contrôle ou invisibles.');
    expect(said.de[0]).toBe('Ein Wert von Nature darf höchstens 200 Zeichen lang sein.');
    expect(said.es[0]).toBe('Un valor de Nature no puede superar los 200 caracteres.');
  });
});
