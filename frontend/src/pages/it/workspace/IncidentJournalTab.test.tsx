import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('../../../api/endpoints/incidents', () => ({ incidentsApi: { listEntries: vi.fn(), createEntry: vi.fn() } }));

import { incidentsApi } from '../../../api/endpoints/incidents';
import IncidentJournalTab from './IncidentJournalTab';

const listEntries = incidentsApi.listEntries as unknown as ReturnType<typeof vi.fn>;

function entry(id: string, kind: string, content: string) {
  return {
    id, kind, content, changed_fields: null, author_id: null, author_name: null,
    occurred_at: '2026-10-16T08:00:00.000Z', created_at: '2026-10-16T08:00:00.000Z',
  };
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ThemeProvider theme={createAppTheme('light')}>
          <IncidentJournalTab incidentId="inc-1" canAdd={false} onEntryAdded={() => undefined} />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// QA lot 14: the entry the server writes when an incident is created read "Incident logged" in a
// French interface. The fixed system sentences are stored in English and shown in the reader's
// language, existing entries included; a note is shown as written.
describe('IncidentJournalTab system entries', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the fixed system sentences in the reader language', async () => {
    await i18n.changeLanguage('fr');
    listEntries.mockResolvedValue([
      entry('e1', 'system', 'Incident logged'),
      entry('e2', 'system', 'Imported from CSV'),
      entry('e3', 'system', 'Incident review imported from CSV'),
      entry('e4', 'system', 'Incident review imported'),
      entry('e5', 'note', 'Incident logged'),
    ]);
    renderTab();
    expect(await screen.findByText('Incident enregistré')).toBeInTheDocument();
    expect(screen.getByText('Importé depuis un fichier CSV')).toBeInTheDocument();
    expect(screen.getByText('Revue d’incident importée depuis un fichier CSV')).toBeInTheDocument();
    expect(screen.getByText('Revue d’incident importée')).toBeInTheDocument();
    // A note someone typed stays as written.
    expect(screen.getAllByText('Incident logged')).toHaveLength(1);
  });
});
