import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../components/reports/ReportLayout', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../components/reports/ChartCard', () => ({ default: React.forwardRef(() => null) }));
vi.mock('../../components/reports/ReportGrid', () => ({ default: () => null }));
const summaryHook = vi.fn();
vi.mock('./useOpexSummary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useOpexSummary')>()),
  useOpexSummaryAll: (years?: number[]) => summaryHook(years),
}));

import ComparisonReport from './ComparisonReport';

describe('ComparisonReport', () => {
  it('requests every year it offers, Y-2 to Y+2', () => {
    summaryHook.mockReturnValue({ data: [], isLoading: false });
    render(<ComparisonReport />);
    const Y = new Date().getFullYear();
    expect(summaryHook).toHaveBeenCalledWith([Y - 2, Y - 1, Y, Y + 1, Y + 2]);
  });
});
