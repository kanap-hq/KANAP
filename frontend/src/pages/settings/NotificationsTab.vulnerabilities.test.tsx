import '../../i18n';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import NotificationsTab from './NotificationsTab';

vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { features: { vulnerabilityFeed: true } } }),
}));

/** The sentence K2a wrote. A revert of the locale fails this test. The screen itself is unchanged. */
const PHRASE = 'Vulnerabilities found on technologies I own for IT: critical or high, or known to be exploited';

const PREFS = {
  emails_enabled: true,
  weekly_review_enabled: false,
  weekly_review_day: 1,
  weekly_review_hour: 8,
  timezone: 'Europe/Paris',
  workspace_settings: {
    portfolio: { enabled: true, status_changes: true, team_additions: true, team_changes_as_lead: true, comments: true },
    tasks: { enabled: true, as_assignee: true, as_requestor: true, as_viewer: true, status_changes: true, comments: true },
    budget: { enabled: true, expiration_warnings: true, status_changes: true, comments: true },
    technologies: { enabled: true, vulnerabilities: true },
  },
};

describe('NotificationsTab vulnerability email', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/users/me/notification-preferences') return { data: PREFS } as any;
      throw new Error(`unexpected ${url}`);
    });
  });

  it('shows the preference for a critical, high or exploited vulnerability', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={client}>
          <NotificationsTab />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByText(PHRASE)).toBeTruthy();
  });
});
