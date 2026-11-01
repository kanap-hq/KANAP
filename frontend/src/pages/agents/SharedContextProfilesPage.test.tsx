import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SharedContextProfilesPage from './SharedContextProfilesPage';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { AiSharedContextProfile } from '../../ai/aiApi';

const harness = vi.hoisted(() => {
  const items: AiSharedContextProfile[] = [
    {
      id: 'active-1',
      profile_key: 'house-rules',
      name: 'House rules',
      description: 'Company-wide IT context',
      content_json: { lines: ['Never ask for passwords.'] },
      status: 'active',
      config_version: 1,
      updated_by_user_id: null,
      metadata_json: null,
      created_at: '2026-10-01T10:00:00.000Z',
      updated_at: '2026-10-02T10:00:00.000Z',
    },
    {
      id: 'archived-1',
      profile_key: 'old-rules',
      name: 'Old rules',
      description: null,
      content_json: { lines: ['Retired guidance.'] },
      status: 'archived',
      config_version: 2,
      updated_by_user_id: null,
      metadata_json: null,
      created_at: '2026-09-01T10:00:00.000Z',
      updated_at: '2026-09-02T10:00:00.000Z',
    },
  ];
  return {
    canAdmin: true,
    items,
    list: vi.fn(async () => ({ items: items.map((item) => ({ ...item })) })),
    restore: vi.fn(async (id: string) => {
      const item = items.find((profile) => profile.id === id);
      if (item) item.status = 'active';
      return { profile: { ...item! } };
    }),
  };
});

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string) => harness.canAdmin && (resource === 'ai_agents' || resource === 'ai_settings'),
  }),
}));

vi.mock('../../ai/aiApi', async () => {
  const actual = await vi.importActual<typeof import('../../ai/aiApi')>('../../ai/aiApi');
  return {
    ...actual,
    aiAgentControlApi: {
      ...actual.aiAgentControlApi,
      listSharedContextProfiles: harness.list,
      restoreSharedContextProfile: harness.restore,
    },
  };
});

function rowOf(label: string): HTMLElement {
  let node: HTMLElement | null = screen.getByText(label);
  while (node && node.querySelector('button') == null) node = node.parentElement;
  if (!node) throw new Error(`no actions for ${label}`);
  return node;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SharedContextProfilesPage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('SharedContextProfilesPage restore', () => {
  beforeEach(async () => {
    harness.canAdmin = true;
    harness.items[0].status = 'active';
    harness.items[1].status = 'archived';
    harness.restore.mockClear();
    await i18n.changeLanguage('en');
  });

  it('shows Restore on an archived row only', async () => {
    renderPage();
    await screen.findByText('Old rules');

    const archived = rowOf('Old rules');
    expect(within(archived).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(within(archived).queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(within(archived).queryByRole('button', { name: 'Edit' })).toBeNull();

    const active = rowOf('House rules');
    expect(within(active).getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(within(active).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(active).queryByRole('button', { name: 'Restore' })).toBeNull();

    fireEvent.click(within(archived).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(harness.restore).toHaveBeenCalledWith('archived-1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull());
    expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(2);
  });

  it('hides Restore from a reader', async () => {
    harness.canAdmin = false;
    renderPage();
    await screen.findByText('Old rules');
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New profile' })).toBeNull();
  });
});
