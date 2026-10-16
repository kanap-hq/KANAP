import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import InterfaceMetadataBar from './InterfaceMetadataBar';

vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: { dataClasses: [], businessCriticalityLevels: [] } }) }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({ default: () => ({ byField: {}, labelFor: (_field: string, code?: string | null) => code || '' }) }));

function renderBar(containsPii: boolean) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <InterfaceMetadataBar
        lifecycle="active"
        criticality=""
        routeType="direct"
        dataClass=""
        containsPii={containsPii}
        onLifecycleChange={() => {}}
        onCriticalityChange={() => {}}
        onDataClassChange={() => {}}
      />
    </ThemeProvider>,
  );
}

describe('InterfaceMetadataBar personal data', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('says whether the interface carries personal data in the reader\'s language', async () => {
    await i18n.changeLanguage('fr');
    renderBar(false);
    expect(screen.getByText('Pas de PII')).toBeInTheDocument();
    expect(screen.getByText('Données')).toBeInTheDocument();
    cleanup();
    renderBar(true);
    expect(screen.getByText('PII')).toBeInTheDocument();
  });
});
