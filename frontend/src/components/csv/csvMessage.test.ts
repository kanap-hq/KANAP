import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import enCommon from '../../locales/en/common.json';
import enErrors from '../../locales/en/errors.json';
import frCommon from '../../locales/fr/common.json';
import frErrors from '../../locales/fr/errors.json';
import { csvMessageText } from './csvMessage';

const instance = i18next.createInstance();
void instance.init({
  lng: 'fr',
  resources: { en: { common: enCommon, errors: enErrors }, fr: { common: frCommon, errors: frErrors } },
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  initImmediate: false,
});

// A row refused because the department it moves is used (lot I7a of 26.12.1): the counts read in
// the interface language, as a refused delete words them.
const moved = {
  row: 2,
  column: 'company_name',
  code: 'DEPARTMENT_MOVE_IN_USE',
  message: 'The department "Finance" is used by 2 users and 1 OPEX line. It cannot change company.',
  params: { name: 'Finance' },
  usages: [{ type: 'users', total: 2 }, { type: 'opex_lines', total: 1 }],
};

describe('csvMessageText', () => {
  it('words the counts of a row in the interface language', () => {
    expect(csvMessageText(moved, instance.getFixedT('fr'))).toBe(
      'Le département « Finance » est utilisé par 2 utilisateurs et 1 ligne OPEX. Il ne peut pas changer de société.',
    );
    expect(csvMessageText(moved, instance.getFixedT('en'))).toBe(moved.message);
  });
});
