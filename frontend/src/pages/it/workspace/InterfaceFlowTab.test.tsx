import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import InterfaceFlowTab from './InterfaceFlowTab';

vi.mock('../../../api', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: { items: [] } })) } }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({ default: () => ({ byField: {}, labelFor: (_field: string, code?: string | null) => code || '' }) }));
vi.mock('../../../components/fields/ApplicationSelect', () => ({ default: () => null }));

const leg = (id: string, leg_type: string) => ({
  id, leg_type, from_role: 'source', to_role: 'target', trigger_type: '', integration_pattern: '', data_format: '', job_name: '', order_index: 0,
});

describe('InterfaceFlowTab steps', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('names each step in the reader\'s language, never as an upper-case code', async () => {
    await i18n.changeLanguage('fr');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider theme={createAppTheme('light')}>
          <InterfaceFlowTab
            canManage={false}
            data={{ id: 'i-1', legs: [leg('l-1', 'extract'), leg('l-2', 'load')] } as never}
            onPatch={async () => undefined}
            onReplaceLegs={async () => undefined}
          />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Extraction')).toBeInTheDocument();
    expect(screen.getByText('Chargement')).toBeInTheDocument();
    expect(screen.queryByText('EXTRACT')).toBeNull();
  });
});
