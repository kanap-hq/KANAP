import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('../../../api', () => ({
  default: { get: vi.fn(async () => ({ data: [] })), post: vi.fn() },
}));
vi.mock('./PortfolioGantt', () => ({ PortfolioGantt: () => null }));

import RoadmapGenerator from './RoadmapGenerator';

describe('RoadmapGenerator', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the context switch grace label in full above its field, not cut inside it', async () => {
    await i18n.loadNamespaces(['portfolio', 'common']);
    await i18n.changeLanguage('fr');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <RoadmapGenerator onApplied={vi.fn()} />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const label = await screen.findByText('Tolérance de changement de contexte');
    expect(label.closest('.MuiInputLabel-root, .MuiTextField-root')).toBeNull();
    expect(screen.getByRole('spinbutton', { name: 'Tolérance de changement de contexte' })).toHaveValue(1);
  });
});
