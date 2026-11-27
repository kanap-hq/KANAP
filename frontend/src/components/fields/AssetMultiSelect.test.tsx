import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import AssetMultiSelect from './AssetMultiSelect';

vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })) } }));

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('AssetMultiSelect', () => {
  it('names the field with the asset family label', async () => {
    await i18n.changeLanguage('fr');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <AssetMultiSelect value={[]} onChange={() => undefined} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Actifs')).toBeTruthy();
    expect(screen.queryByText('Assets')).toBeNull();
  });
});
