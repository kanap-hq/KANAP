import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import ChatConversationList from '../components/ChatConversationList';
import { plainConversationTitle } from '../utils/conversationTitle';
import { createAppTheme } from '../../config/ThemeContext';

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' }, ready: true }),
}));

const now = new Date().toISOString();
vi.mock('../aiApi', () => ({
  aiConversationsApi: {
    list: vi.fn(async () => [
      {
        id: 'c1',
        title: '[Formaggio Supremo SRL](/master-data/companies/5835dd12-0c1d-4b8e-9f00-1a2b3c4d5e6f)',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'c2',
        title: 'Look at ![logo test](https://example.com/fi',
        created_at: now,
        updated_at: now,
      },
      { id: 'c3', title: 'Open incidents', created_at: now, updated_at: now },
    ]),
    rename: vi.fn(),
  },
}));

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <ChatConversationList activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onArchive={vi.fn()} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('plainConversationTitle', () => {
  it('keeps link labels and image alt texts, without addresses or marks', () => {
    expect(plainConversationTitle('Summarise [Formaggio Supremo SRL](/master-data/companies/5835dd12)')).toBe('Summarise Formaggio Supremo SRL');
    expect(plainConversationTitle('![logo test](https://example.com/logo.png) and [A](/a) [B](/b)')).toBe('logo test and A B');
    expect(plainConversationTitle('## **Open** `incidents`')).toBe('Open incidents');
    expect(plainConversationTitle('Budget lines for 2026_Q1')).toBe('Budget lines for 2026_Q1');
    expect(plainConversationTitle('[Formaggio Supremo SRL](/master-data/companies/5835dd12-')).toBe('Formaggio Supremo SRL');
  });
});

describe('ChatConversationList', () => {
  it('shows stored Markdown titles as plain text and finds them by their label', async () => {
    renderList();

    expect(await screen.findByText('Formaggio Supremo SRL')).toBeInTheDocument();
    expect(screen.getByText('Look at logo test')).toBeInTheDocument();
    expect(screen.queryByText(/master-data/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('conversationList.search'), { target: { value: 'Formaggio' } });
    expect(screen.getByText('Formaggio Supremo SRL')).toBeInTheDocument();
    expect(screen.queryByText('Open incidents')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('conversationList.search'), { target: { value: 'companies' } });
    expect(screen.queryByText('Formaggio Supremo SRL')).not.toBeInTheDocument();
  });
});
