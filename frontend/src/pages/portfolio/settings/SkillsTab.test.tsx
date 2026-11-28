import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import SkillsTab from './SkillsTab';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));

vi.mock('../../../api', () => ({ default: api }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});

describe('portfolio settings SkillsTab empty', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.get.mockImplementation(async (url: string) => ({ data: url === '/portfolio/skills' ? { items: [], grouped: {} } : undefined }));
  });

  it('shows one tertiary line and no info alert', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <SkillsTab canEdit />
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('settings.skills.empty')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
