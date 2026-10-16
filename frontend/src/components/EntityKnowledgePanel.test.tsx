import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { createAppTheme } from '../config/ThemeContext';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../api';
import EntityKnowledgePanel from './EntityKnowledgePanel';

const mocked = api as unknown as Record<'get' | 'post', ReturnType<typeof vi.fn>>;

function renderPanel(onLinksChange?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ThemeProvider theme={createAppTheme('light')}>
          <EntityKnowledgePanel entityType="incidents" entityId="inc-1" canCreate onLinksChange={onLinksChange} />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// QA lot 14: a managed document cannot change its relations from Knowledge. The panel said only
// that the update failed; the coded refusal now says why, in the reader's language.
describe('EntityKnowledgePanel link refusals', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('fr');
    mocked.get.mockImplementation((url: string) => {
      if (url === '/incidents/inc-1/knowledge-context') {
        return Promise.resolve({ data: {
          access: 'granted',
          total: 1,
          groups: [{
            key: 'direct',
            label: 'Direct',
            linked_via_label: 'Incident',
            total: 1,
            items: [{
              id: 'doc-55', item_number: 55, title: 'Datadog overview', summary: null, status: 'published',
              updated_at: null, created_at: null, provenance: [],
            }],
          }],
        } });
      }
      if (url === '/knowledge/doc-55') return Promise.resolve({ data: { relations: { incidents: ['inc-1'] } } });
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('says why a managed document cannot be unlinked, in the reader language', async () => {
    mocked.post.mockRejectedValueOnce({
      response: { status: 400, data: {
        code: 'KNOWLEDGE_DOCUMENT_MANAGED_RELATIONS',
        message: 'Managed integrated document relations cannot be changed from Knowledge',
      } },
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('Datadog overview');
    await user.click(screen.getByRole('button', { name: i18n.t('common:knowledgePanel.unlinkDocument') }));
    expect(await screen.findByText(i18n.t('errors:KNOWLEDGE_DOCUMENT_MANAGED_RELATIONS'))).toBeInTheDocument();
    expect(screen.queryByText(/Managed integrated document/)).toBeNull();
  });

  it('keeps the general message for a refusal without a known code', async () => {
    mocked.post.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Some server sentence' } } });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('Datadog overview');
    await user.click(screen.getByRole('button', { name: i18n.t('common:knowledgePanel.unlinkDocument') }));
    expect(await screen.findByText(i18n.t('common:knowledgePanel.failedToUpdateLinks'))).toBeInTheDocument();
    expect(screen.queryByText('Some server sentence')).toBeNull();
  });

  // QA lot 14: the record's Documents badge kept its old count until a reload.
  it('tells the record its documents changed once an unlink is saved', async () => {
    mocked.post.mockResolvedValueOnce({ data: {} });
    const onLinksChange = vi.fn();
    const user = userEvent.setup();
    renderPanel(onLinksChange);
    await screen.findByText('Datadog overview');
    await user.click(screen.getByRole('button', { name: i18n.t('common:knowledgePanel.unlinkDocument') }));
    await vi.waitFor(() => expect(onLinksChange).toHaveBeenCalledTimes(1));
    expect(mocked.post).toHaveBeenCalledWith('/knowledge/doc-55/relations/incidents/bulk-replace', { incident_ids: [] });
  });

  it('leaves the record alone when the unlink is refused', async () => {
    mocked.post.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Some server sentence' } } });
    const onLinksChange = vi.fn();
    const user = userEvent.setup();
    renderPanel(onLinksChange);
    await screen.findByText('Datadog overview');
    await user.click(screen.getByRole('button', { name: i18n.t('common:knowledgePanel.unlinkDocument') }));
    await screen.findByText(i18n.t('common:knowledgePanel.failedToUpdateLinks'));
    expect(onLinksChange).not.toHaveBeenCalled();
  });
});
