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
  default: (p: { searchPlaceholder?: string; suggestedFirst?: { costCenterId: string | null } | null }) => (
    <div
      data-testid={`metadata-user-picker-${p.searchPlaceholder ?? ''}`}
      data-suggested-center={p.suggestedFirst?.costCenterId ?? 'none'}
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
  it('gives both owner pickers the line cost centre', () => {
    renderBar({ costCenterId: 'cc-1' });
    expect(screen.getByTestId('metadata-user-picker-opex.metadata.itOwner')).toHaveAttribute('data-suggested-center', 'cc-1');
    expect(screen.getByTestId('metadata-user-picker-opex.metadata.businessOwner')).toHaveAttribute('data-suggested-center', 'cc-1');
  });

  it('gives them no cost centre when the line has none', () => {
    renderBar({ costCenterId: null });
    expect(screen.getByTestId('metadata-user-picker-opex.metadata.itOwner')).toHaveAttribute('data-suggested-center', 'none');
    expect(screen.getByTestId('metadata-user-picker-opex.metadata.businessOwner')).toHaveAttribute('data-suggested-center', 'none');
  });
});
