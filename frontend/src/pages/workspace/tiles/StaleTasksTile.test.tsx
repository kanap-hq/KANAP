import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

const t = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../api', () => ({ default: { get: api.get } }));

import StaleTasksTile from './StaleTasksTile';

const item = (title: string, extra: Record<string, unknown>) => ({
  id: `${title}-id`, itemNumber: 3, title, status: 'open', updatedAt: '2026-10-01T10:00:00Z', staleDays: 57,
  assigneeName: null, relatedObjectType: 'project', relatedObjectId: null, relatedObjectName: null, ...extra,
});

describe('StaleTasksTile', () => {
  it('names nothing in place of a record the person does not read, and calls no other task standalone', async () => {
    api.get.mockResolvedValue({ data: [
      item('Hidden project task', { relatedObjectHidden: true }),
      item('Readable project task', { relatedObjectId: 'p-1', relatedObjectName: 'Main project' }),
      item('Standalone task', { relatedObjectType: null }),
    ] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter><StaleTasksTile config={{ scope: 'all' }} /></MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Hidden project task')).toBeInTheDocument();
    expect(screen.getByText(/Main project/)).toBeInTheDocument();
    // One task is standalone: the hidden one is not called so.
    expect(screen.getAllByText(/dashboard\.tiles\.standaloneTask/)).toHaveLength(1);
  });
});
