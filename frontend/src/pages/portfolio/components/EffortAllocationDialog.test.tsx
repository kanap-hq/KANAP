import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import EffortAllocationDialog, { type EligibleUser } from './EffortAllocationDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

vi.mock('../../../api', () => ({
  default: { post: vi.fn() },
}));

const theme = createAppTheme('light');

function renderDialog(users: EligibleUser[]) {
  return render(
    <ThemeProvider theme={theme}>
      <EffortAllocationDialog
        open
        onClose={() => {}}
        projectId="project-1"
        effortType="it"
        eligibleUsers={users}
        estimatedEffort={10}
        onSuccess={() => {}}
      />
    </ThemeProvider>,
  );
}

/** First line of each contributor cell: the label the dialog sorts on. */
function contributorNames(): string[] {
  return screen.getAllByRole('row').slice(1).map((row) => {
    return row.querySelector('td .MuiTypography-root')?.textContent ?? '';
  });
}

describe('EffortAllocationDialog', () => {
  it('sorts a person without a name by e-mail and keeps the lead first', () => {
    renderDialog([
      { user_id: 'u-zoe', email: 'zoe@example.com', first_name: 'Zoe', last_name: 'Bernard', is_lead: false },
      { user_id: 'u-none', email: 'ada.none@example.com', first_name: null, last_name: null, is_lead: false },
      { user_id: 'u-lead', email: 'zzz.lead@example.com', first_name: null, last_name: null, is_lead: true },
      { user_id: 'u-undef', email: 'bruno.undef@example.com', first_name: undefined, last_name: undefined, is_lead: false },
      { user_id: 'u-partial', email: 'partial@example.com', first_name: null, last_name: 'Dupont', is_lead: false },
      { user_id: 'u-blank', email: 'blank@example.com', first_name: '   ', last_name: '', is_lead: false },
      { user_id: 'u-marc', email: 'marc@example.com', first_name: 'Marc', last_name: 'Martin', is_lead: false },
    ]);

    expect(contributorNames()).toEqual([
      'zzz.lead@example.com',
      'ada.none@example.com',
      'blank@example.com',
      'bruno.undef@example.com',
      'Dupont',
      'Marc Martin',
      'Zoe Bernard',
    ]);
    expect(document.body.textContent ?? '').not.toMatch(/null null|undefined undefined/);
  });
});
