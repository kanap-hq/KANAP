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

// A company or supplier name that already ends with a period is followed by no second one. A name
// without a period still takes the sentence's period. German keeps the paying company's name inside
// the sentence ("von {{company}} bezahlt"), so only the slots the template closes with a period use it.

const paidBy = {
  message: 'Cost center FR-DIS-100 belongs to Fromage & Co SA. The line is paid by Fromage & Co Inc.',
  code: 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY',
  params: { costCenter: 'FR-DIS-100', costCenterCompany: 'Fromage & Co SA', company: 'Fromage & Co Inc.' },
};
const belongsTo = {
  message: 'Cost center CC-INC belongs to Fromage & Co Inc. The line is paid by Globex.',
  code: 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY',
  params: { costCenter: 'CC-INC', costCenterCompany: 'Fromage & Co Inc.', company: 'Globex' },
};
const unread = {
  message: 'Cost center FR-DIS-100 belongs to another company. The line is paid by Fromage & Co Inc.',
  code: 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY_UNREAD',
  params: { costCenter: 'FR-DIS-100', company: 'Fromage & Co Inc.' },
};
const far = {
  message: 'Budget 2026 at 500 000, against a median of 11 000 on 3 lines of Acme Ltd.',
  code: 'BUDGET_FILE_AMOUNT_FAR_FROM_SUPPLIER',
  params: { label: 'Budget', year: 2026, amount: '500 000', median: '11 000', count: 3, supplier: 'Acme Ltd.' },
};
const farPlain = {
  message: 'Budget 2026 at 500 000, against a median of 11 000 on 3 lines of Orange.',
  code: 'BUDGET_FILE_AMOUNT_FAR_FROM_SUPPLIER',
  params: { label: 'Budget', year: 2026, amount: '500 000', median: '11 000', count: 3, supplier: 'Orange' },
};

describe('checkSentence of a name that ends with a period', () => {
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it('keeps a single period in the four languages', async () => {
    const said: Record<string, string[]> = {};
    for (const lng of ['en', 'fr', 'de', 'es']) {
      await i18n.changeLanguage(lng);
      said[lng] = [paidBy, belongsTo, unread, far, farPlain].map((sentence) => checkSentence(sentence, i18n.t));
    }
    for (const sentences of Object.values(said)) {
      for (const sentence of sentences) expect(sentence).not.toContain('..');
    }
    expect(said.en).toEqual([
      'Cost center FR-DIS-100 belongs to Fromage & Co SA. The line is paid by Fromage & Co Inc.',
      'Cost center CC-INC belongs to Fromage & Co Inc. The line is paid by Globex.',
      'Cost center FR-DIS-100 belongs to another company. The line is paid by Fromage & Co Inc.',
      'Budget 2026 at 500 000, against a median of 11 000 on 3 lines of Acme Ltd.',
      'Budget 2026 at 500 000, against a median of 11 000 on 3 lines of Orange.',
    ]);
    expect(said.fr).toEqual([
      'Le centre de coûts FR-DIS-100 appartient à Fromage & Co SA. La ligne est payée par Fromage & Co Inc.',
      'Le centre de coûts CC-INC appartient à Fromage & Co Inc. La ligne est payée par Globex.',
      'Le centre de coûts FR-DIS-100 appartient à une autre société. La ligne est payée par Fromage & Co Inc.',
      'Budget 2026 à 500 000, contre une médiane de 11 000 sur 3 lignes de Acme Ltd.',
      'Budget 2026 à 500 000, contre une médiane de 11 000 sur 3 lignes de Orange.',
    ]);
    expect(said.de).toEqual([
      'Die Kostenstelle FR-DIS-100 gehört zu Fromage & Co SA. Die Budgetzeile wird von Fromage & Co Inc. bezahlt.',
      'Die Kostenstelle CC-INC gehört zu Fromage & Co Inc. Die Budgetzeile wird von Globex bezahlt.',
      'Die Kostenstelle FR-DIS-100 gehört zu einer anderen Gesellschaft. Die Budgetzeile wird von Fromage & Co Inc. bezahlt.',
      'Budget 2026 mit 500 000, gegenüber einem Median von 11 000 aus 3 Budgetzeilen von Acme Ltd.',
      'Budget 2026 mit 500 000, gegenüber einem Median von 11 000 aus 3 Budgetzeilen von Orange.',
    ]);
    expect(said.es).toEqual([
      'El centro de coste FR-DIS-100 pertenece a Fromage & Co SA. La línea la paga Fromage & Co Inc.',
      'El centro de coste CC-INC pertenece a Fromage & Co Inc. La línea la paga Globex.',
      'El centro de coste FR-DIS-100 pertenece a otra sociedad. La línea la paga Fromage & Co Inc.',
      'Budget 2026 de 500 000, frente a una mediana de 11 000 en 3 líneas de Acme Ltd.',
      'Budget 2026 de 500 000, frente a una mediana de 11 000 en 3 líneas de Orange.',
    ]);
  });
});
