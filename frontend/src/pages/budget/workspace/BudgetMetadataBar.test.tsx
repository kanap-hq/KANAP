import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
// The pickers read their group from the API; here they only report the props this file checks.
vi.mock('../../../components/workspace/MetadataUserPicker', () => ({
  default: (p: {
    searchPlaceholder?: string;
    suggestedFirst?: { costCenterId: string | null; lineRef?: string | null } | null;
  }) => (
    <div
      data-testid={`metadata-user-picker-${p.searchPlaceholder ?? ''}`}
      data-suggested-center={p.suggestedFirst?.costCenterId ?? 'none'}
      data-line-ref={p.suggestedFirst?.lineRef ?? 'none'}
    />
  ),
}));
vi.mock('../../../components/workspace/BudgetHolderMetadataItem', () => ({ default: () => null }));

import BudgetMetadataBar from './BudgetMetadataBar';

function renderBar(overrides: Partial<React.ComponentProps<typeof BudgetMetadataBar>> = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <BudgetMetadataBar
        status="enabled"
        ownerItId={null}
        ownerBizId={null}
        onStatusChange={() => undefined}
        onOwnerItChange={() => undefined}
        onOwnerBizChange={() => undefined}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

describe('BudgetMetadataBar owner suggestions', () => {
  it('gives both owner pickers the line cost centre and the line', () => {
    renderBar({ costCenterId: 'cc-1', lineRef: 'line-1' });
    for (const testId of ['metadata-user-picker-opex.metadata.itOwner', 'metadata-user-picker-opex.metadata.businessOwner']) {
      expect(screen.getByTestId(testId)).toHaveAttribute('data-suggested-center', 'cc-1');
      expect(screen.getByTestId(testId)).toHaveAttribute('data-line-ref', 'line-1');
    }
  });

  it('gives them no cost centre and no line when the line has none', () => {
    renderBar({ costCenterId: null });
    for (const testId of ['metadata-user-picker-opex.metadata.itOwner', 'metadata-user-picker-opex.metadata.businessOwner']) {
      expect(screen.getByTestId(testId)).toHaveAttribute('data-suggested-center', 'none');
      expect(screen.getByTestId(testId)).toHaveAttribute('data-line-ref', 'none');
    }
  });
});
