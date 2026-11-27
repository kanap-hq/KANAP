import React from 'react';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import frAi from '../../locales/fr/ai.json';
import frCommon from '../../locales/fr/common.json';
import frErrors from '../../locales/fr/errors.json';
import frOps from '../../locales/fr/ops.json';
import type { AiImportRun } from '../aiTypes';

// A departments file Kad built, one row refused because the department it moves is used (lot I7a of
// 26.12.1): the card words the counts as the import screen does, never `{{usages}}`.
const instance = i18next.createInstance();
void instance.init({
  lng: 'fr',
  resources: { fr: { ai: frAi, common: frCommon, errors: frErrors, ops: frOps } },
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  initImmediate: false,
});
const t = (key: string, options?: Record<string, unknown>) => instance.t(key, options);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'fr', resolvedLanguage: 'fr' } }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));

import ImportRunReport from './ImportRunReport';

const run: AiImportRun = {
  ok: false,
  dry_run: true,
  total: 1,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  error_count: 1,
  warning_count: 0,
  issues: [],
  report: {
    kind: 'rows',
    errors: [{
      row: 2,
      column: 'company_name',
      code: 'DEPARTMENT_MOVE_IN_USE',
      message: 'The department "Finance" is used by 1 project. It cannot change company.',
      params: { name: 'Finance' },
      usages: [{ type: 'projects', total: 1 }],
    }],
    warnings: [],
  },
} as unknown as AiImportRun;

describe('ImportRunReport', () => {
  it('words the counts of a refused row', () => {
    render(<ImportRunReport run={run} titles={new Map()} />);
    expect(screen.getByText(/Le département « Finance » est utilisé par 1 projet\. Il ne peut pas changer de société\./)).toBeTruthy();
    expect(screen.queryByText(/\{\{usages\}\}/)).toBeNull();
  });
});
