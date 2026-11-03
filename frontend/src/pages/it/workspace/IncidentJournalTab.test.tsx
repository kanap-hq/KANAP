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
import { formatShortDateTime } from '../../../lib/dateFormat';
import IncidentJournalTab from './IncidentJournalTab';

const listEntries = incidentsApi.listEntries as unknown as ReturnType<typeof vi.fn>;

function entry(
  id: string,
  kind: string,
  content: string,
  times: { occurred_at?: string; created_at?: string } = {},
  changedFields: Record<string, { from: unknown; to: unknown }> | null = null,
) {
  const occurredAt = times.occurred_at ?? '2026-10-16T08:00:00.000Z';
  return {
    id, kind, content, changed_fields: changedFields, author_id: null, author_name: null,
    occurred_at: occurredAt, created_at: times.created_at ?? occurredAt,
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

// Link changes are stored as an English sentence. The tab rebuilds them from changed_fields
// (added = to minus from, removed = from minus to). An old row with no snapshot keeps its sentence.
describe('IncidentJournalTab link changes', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows link changes in the reader language', async () => {
    await i18n.changeLanguage('fr');
    listEntries.mockResolvedValue([
      entry('e1', 'link_change', 'Technologies linked: TEC-18.', {}, {
        technologies: { from: [], to: ['TEC-18'] },
      }),
      entry('e2', 'link_change', 'Assets unlinked: AST-2, AST-9.', {}, {
        assets: { from: ['AST-1', 'AST-2', 'AST-9'], to: ['AST-1'] },
      }),
      entry('e3', 'link_change', 'Applications linked: APP-4. Applications unlinked: APP-1.', {}, {
        applications: { from: ['APP-1'], to: ['APP-4'] },
      }),
      entry('e4', 'link_change', 'Application APP-7 converted to technology TEC-3.', {}, {
        applications: { from: ['APP-7'], to: [] },
        technologies: { from: [], to: ['TEC-3'] },
      }),
      entry('e5', 'link_change', 'Technologies linked: TEC-1.'),
      entry('e6', 'link_change', 'Technologies linked: TEC-OLD.', {}, {
        technologies: { from: 'TEC-OLD', to: [] },
      }),
    ]);
    renderTab();

    // getByText collapses a no-break space before comparing, so the French colon would miss.
    const asWritten = { normalizer: (text: string) => text };
    expect(await screen.findByText('Technologies liées\u00a0: TEC-18.', asWritten)).toBeInTheDocument();
    expect(screen.queryByText('Technologies linked: TEC-18.')).not.toBeInTheDocument();
    expect(screen.getByText('Actifs déliés\u00a0: AST-2, AST-9.', asWritten)).toBeInTheDocument();

    const linked = screen.getByText('Applications liées\u00a0: APP-4.', asWritten);
    const unlinked = screen.getByText('Applications déliées\u00a0: APP-1.', asWritten);
    expect(linked.compareDocumentPosition(unlinked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // A conversion is the unlinked application and the linked technology, in that order.
    const convertedApp = screen.getByText('Applications déliées\u00a0: APP-7.', asWritten);
    const convertedTech = screen.getByText('Technologies liées\u00a0: TEC-3.', asWritten);
    expect(convertedApp.compareDocumentPosition(convertedTech) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Application APP-7 converted to technology TEC-3.')).not.toBeInTheDocument();

    // No snapshot, or a snapshot that is not two lists of references: the stored sentence stays.
    expect(screen.getByText('Technologies linked: TEC-1.')).toBeInTheDocument();
    expect(screen.getByText('Technologies linked: TEC-OLD.')).toBeInTheDocument();
  });

  it.each([
    ['de', 'Technologien verknüpft: TEC-18.'],
    ['es', 'Tecnologías vinculadas: TEC-18.'],
  ])('shows a technology link in %s', async (language, expected) => {
    await i18n.changeLanguage(language);
    listEntries.mockResolvedValue([
      entry('e1', 'link_change', 'Technologies linked: TEC-18.', {}, {
        technologies: { from: [], to: ['TEC-18'] },
      }),
    ]);
    renderTab();
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText('Technologies linked: TEC-18.')).not.toBeInTheDocument();
  });
});

// A note can be written after the facts it describes: the journal keeps the facts time as the main
// time and adds the server recording time only when the two differ.
describe('IncidentJournalTab recorded time', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the recording time only when it differs from the facts time', async () => {
    await i18n.changeLanguage('en');
    const recordedAt = '2026-10-27T10:12:00.000Z';
    listEntries.mockResolvedValue([
      entry('e1', 'note', 'Backdated note', {
        occurred_at: '2026-10-16T08:00:00.000Z',
        created_at: recordedAt,
      }),
      entry('e2', 'note', 'Normal note'),
    ]);

    renderTab();

    expect(await screen.findByText('Backdated note')).toBeInTheDocument();
    expect(screen.getByText(`recorded ${formatShortDateTime(recordedAt, 'en')}`)).toBeInTheDocument();
    expect(screen.getAllByText(/^recorded /)).toHaveLength(1);
  });
});

// Linked records follow their module's read (2026-10-26): the API leaves out the link changes of a
// module the reader does not read. A note keeps its free text, and no reference becomes a link.
describe('IncidentJournalTab linked records', () => {
  it('shows a note citing a record as plain text, with no link to it', async () => {
    listEntries.mockResolvedValue([entry('e1', 'note', 'Restarted AST-50 after the failover')]);
    renderTab();
    expect(await screen.findByText('Restarted AST-50 after the failover')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
