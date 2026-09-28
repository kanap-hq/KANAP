import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// Real English for the budget tab strings, every other key comes back as itself.
vi.mock('react-i18next', async () => {
  const i18next = (await import('i18next')).default;
  const enOps = (await import('../../locales/en/ops.json')).default;
  const real = i18next.createInstance();
  await real.init({ lng: 'en', resources: { en: { ops: enOps } }, defaultNS: 'ops', interpolation: { escapeValue: false } });
  const t = (rawKey: string, options?: unknown) => {
    const key = rawKey.replace(/^ops:/, '');
    return key.startsWith('budgetTab.') ? real.t(key, options as Record<string, unknown>) : rawKey;
  };
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));

vi.mock('../../hooks/useWorkingDayProfiles', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../hooks/useWorkingDayProfiles')>();
  const list = [{ id: 'cal-1', code: 'FR218', name: 'France 218', description: null, days_by_year: {}, status: 'enabled', disabled_at: null }];
  return { ...mod, useWorkingDayProfiles: () => mod.buildWorkingDayProfiles(list as never) };
});

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));

import ComputePanel, { ComputePanelProps } from './ComputePanel';
import type { ComputePreview, RoundInput } from './roundPeriod';

const theme = createAppTheme('light');

const PREVIEW: ComputePreview = {
  active_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  day_counts: null,
  total_days: null,
  month_amounts: Array.from({ length: 12 }, () => '2000.00'),
  total: '24000.00',
  fte: null,
  calendar: null,
  stored: { month_amounts: Array.from({ length: 12 }, () => '0.00'), method: null, last_calculation: null },
  changed_months: [],
  calendar_changed_months: [],
  warnings: [],
};

const recipeRecord: RoundInput = {
  measure: 'committed',
  period_start: '2026-03-01',
  period_end: '2026-11-30',
  method: 'computed',
  spread_profile_name: null,
  last_calculation: null,
  updated_at: '2026-09-26T10:00:00Z',
  updated_by: null,
  pricing_basis: 'per_period',
  quantity: '1.5',
  unit_price: '9000',
  price_index_pct: '2.5',
  working_day_profile_id: null,
  working_day_profile_code: null,
  working_day_profile_name: null,
  counts_as_fte: false,
};

const COLUMNS: ComputePanelProps['columns'] = [
  { measure: 'planned', label: 'Budget', frozen: false },
  { measure: 'committed', label: 'Revision', frozen: false },
];
const PERIODS: Record<string, { start: string; end: string }> = {
  planned: { start: '2026-01-01', end: '2026-12-31' },
  committed: { start: '2026-03-01', end: '2026-11-30' },
};

/** The panel as the budget tab mounts it: the parent owns the column. */
function Harness({ requestPreview }: { requestPreview: ComputePanelProps['requestPreview'] }) {
  const [measure, setMeasure] = React.useState<'planned' | 'committed'>('planned');
  return (
    <ComputePanel
      year={2026}
      measure={measure}
      columns={COLUMNS}
      onMeasureChange={(m) => setMeasure(m as 'planned' | 'committed')}
      record={measure === 'committed' ? recipeRecord : undefined}
      period={PERIODS[measure]}
      frozen={false}
      frozenHint="frozen"
      busy={false}
      requestPreview={requestPreview}
      onCompute={() => undefined}
    />
  );
}

function renderPanel(requestPreview = vi.fn(async () => PREVIEW)) {
  render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <Harness requestPreview={requestPreview} />
      </ThemeProvider>
    </MemoryRouter>,
  );
  return requestPreview;
}

async function pickColumn(name: string) {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  fireEvent.click(await screen.findByRole('option', { name }));
}

describe('ComputePanel', () => {
  it('asks the server once the typing stops, not on every keystroke', async () => {
    const requestPreview = renderPanel();
    const quantity = screen.getByLabelText('Quantity');
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '200' } });
    fireEvent.change(quantity, { target: { value: '1' } });
    fireEvent.change(quantity, { target: { value: '10' } });

    await waitFor(() => expect(screen.getByTestId('compute-line')).toHaveTextContent(/^12 months · 24 000$/));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(requestPreview).toHaveBeenCalledTimes(1);
    expect(requestPreview).toHaveBeenCalledWith({
      kind: 'computed', year: 2026, measure: 'planned', period_start: '2026-01-01', period_end: '2026-12-31',
      pricing_basis: 'per_month', quantity: '10', unit_price: '200', price_index_pct: '0',
      working_day_profile_id: null, counts_as_fte: false,
    });
    expect(screen.getByRole('button', { name: 'Compute' })).not.toBeDisabled();
  });

  it('a column with a recipe opens with it; a column without one keeps what was typed, on its own period', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });

    await pickColumn('Revision');
    expect(screen.getByLabelText('Quantity')).toHaveValue('1.5');
    expect(screen.getByLabelText('Unit price')).toHaveValue('9 000');
    expect(screen.getByLabelText('Price index (%)')).toHaveValue('2.5');
    expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('For the whole period');
    expect(screen.getAllByPlaceholderText('labels.datePlaceholder')[0]).toHaveValue('1 Mar 2026');
    expect(screen.getByRole('button', { name: 'Recompute' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '4' } });
    await pickColumn('Budget');
    expect(screen.getByLabelText('Quantity')).toHaveValue('4');
    expect(screen.getAllByPlaceholderText('labels.datePlaceholder')[0]).toHaveValue('1 Jan 2026');
    expect(screen.getByRole('button', { name: 'Compute' })).toBeInTheDocument();
  });
});
