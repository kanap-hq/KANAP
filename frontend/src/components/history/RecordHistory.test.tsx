import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';
import RecordHistory from './RecordHistory';
import type { RecordHistoryItem, RecordHistoryPage } from './recordHistoryText';

vi.mock('../../api', () => ({ default: { get: vi.fn() } }));

const mocked = vi.mocked(api);
const ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '22222222-3333-4444-8555-666666666666';

function item(overrides: Partial<RecordHistoryItem> = {}): RecordHistoryItem {
  return {
    id: OTHER_ID,
    at: '2026-10-15T12:34:00.000Z',
    action: 'update',
    actor: { kind: 'user', name: 'Ava Reader' },
    subject: { kind: 'record' },
    changes: [],
    ...overrides,
  };
}

function page(items: RecordHistoryItem[], nextCursor: string | null = null): RecordHistoryPage {
  return { items, nextCursor };
}

function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <RecordHistory table="spend_items" recordId={ID} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function bodyText(): string {
  return document.body.textContent ?? '';
}

/** jsdom here has no localStorage: the language and session modules read it through a guard. */
function stubStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

describe('RecordHistory', () => {
  beforeEach(async () => {
    stubStorage();
    mocked.get.mockReset();
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('reads the entries of the line: amounts, dimensions, links, attachments, contacts and authors', async () => {
    mocked.get.mockResolvedValue({
      data: page([
        item({
          id: 'amount',
          action: 'update',
          actor: { kind: 'assistant', name: 'Ava Reader' },
          subject: { kind: 'amounts', label: 'Y2026' },
          changes: [{ field: 'planned', before: '10000.00', after: '12000.00', year: 2026, column: 'planned' }],
        }),
        item({
          id: 'record',
          action: 'update',
          subject: { kind: 'record' },
          changes: [
            { field: 'dimension', dimension: 'Budget reference', before: 'REF-12', after: 'REF-13' },
            { field: 'contract_id', before: null, after: { hidden: true, kind: 'contract' } },
            { field: 'product_name', before: 'Former name', after: 'New name' },
          ],
        }),
        item({
          id: 'link', action: 'create', subject: { kind: 'link', label: 'Spec link' },
          changes: [{ field: 'link', event: 'added', after: { kind: 'link', id: OTHER_ID, label: 'Spec link' } }],
        }),
        item({
          id: 'attachment', action: 'update', subject: { kind: 'attachment', label: 'note.txt' },
          changes: [{ field: 'attachment', event: 'removed', before: { kind: 'attachment', id: OTHER_ID, label: 'note.txt' } }],
        }),
        item({
          id: 'contact', action: 'create', subject: { kind: 'contact', label: 'Cora Contact' },
          changes: [{ field: 'contact', event: 'added', after: { kind: 'contact', id: OTHER_ID, label: 'Cora Contact' } }],
        }),
        item({
          id: 'system', action: 'update', actor: { kind: 'system', name: null },
          subject: { kind: 'version', label: 'Y2026' },
          changes: [{ field: 'budget_year', before: 2026, after: 2027 }],
        }),
        item({
          id: 'version-create', action: 'create',
          subject: { kind: 'version', label: 'Y2027' },
          changes: [],
        }),
        item({
          id: 'import', action: 'update', actor: { kind: 'import', name: 'Ava Reader' },
          subject: { kind: 'record' },
          changes: [{ field: 'currency', before: 'EUR', after: 'USD' }],
        }),
      ]),
    } as never);

    const { container } = renderHistory();
    await screen.findByText('Plaid for Ava Reader');

    expect(mocked.get).toHaveBeenCalledWith(
      `/records/spend_items/${ID}/history`,
      { params: { limit: 50 } },
    );
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-15T12:34:00.000Z');
    expect(screen.getByText('Amount 2026, Budget')).toBeInTheDocument();
    expect(screen.getByText('Dimension Budget reference')).toBeInTheDocument();
    expect(screen.getByText('Product name')).toBeInTheDocument();
    expect(screen.getByText('Link added: Spec link')).toBeInTheDocument();
    expect(screen.getByText('Attachment removed: note.txt')).toBeInTheDocument();
    expect(screen.getByText('Contact added: Cora Contact')).toBeInTheDocument();
    expect(screen.getByText('Version Y2026')).toBeInTheDocument();
    expect(screen.getByText('Version Y2027 added')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
    expect(bodyText()).toContain('Amount 2026, Budget: 10 000 → 12 000');
    expect(bodyText()).toContain('Dimension Budget reference: REF-12 → REF-13');
    expect(bodyText()).toContain('Contract: — → a contract');
    expect(bodyText()).toContain('Product name: Former name → New name');
    expect(bodyText()).toContain('Budget year: 2026 → 2027');
    expect(bodyText()).toContain('Currency: EUR → USD');
    // The references are named, never their identifiers.
    expect(bodyText()).not.toContain(ID);
    expect(bodyText()).not.toContain(OTHER_ID);
  });

  it('names the record event and never shows a child technical action', async () => {
    mocked.get.mockResolvedValue({
      data: page([
        item({
          id: 'record-created', action: 'create', subject: { kind: 'record' },
          changes: [{ field: 'notes', after: 'First note' }],
        }),
        item({
          id: 'record-updated', action: 'update', subject: { kind: 'record' },
          changes: [{ field: 'notes', before: 'First note', after: 'Second note' }],
        }),
        item({
          id: 'child-link', action: 'update', subject: { kind: 'link', label: 'Spec link' },
          changes: [{ field: 'link', event: 'added', after: { kind: 'link', id: OTHER_ID, label: 'Spec link' } }],
        }),
      ]),
    } as never);

    renderHistory();
    await screen.findByText('Created');
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('Link added: Spec link')).toBeInTheDocument();
    expect(screen.queryByText('Update')).toBeNull();
    expect(screen.queryByText('Create')).toBeNull();
  });

  it('loads the next page with the cursor the server returned', async () => {
    mocked.get
      .mockResolvedValueOnce({
        data: page([item({ id: 'first', changes: [{ field: 'currency', before: 'EUR', after: 'USD' }] })], 'cursor-2'),
      } as never)
      .mockResolvedValueOnce({
        data: page([item({ id: 'second', changes: [{ field: 'notes', before: 'Old', after: 'New' }] })]),
      } as never);

    const user = userEvent.setup();
    renderHistory();
    await screen.findByText('Currency');
    expect(screen.queryByText('Notes')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Notes');
    expect(mocked.get).toHaveBeenLastCalledWith(
      `/records/spend_items/${ID}/history`,
      { params: { limit: 50, cursor: 'cursor-2' } },
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });


  it('keeps loading the next page while the pages hold no entry', async () => {
    mocked.get
      .mockResolvedValueOnce({ data: page([], 'cursor-2') } as never)
      .mockResolvedValueOnce({ data: page([], 'cursor-3') } as never)
      .mockResolvedValueOnce({
        data: page([item({ id: 'after-empty', changes: [{ field: 'currency', before: 'EUR', after: 'USD' }] })]),
      } as never);

    renderHistory();
    await screen.findByText('Currency');

    expect(mocked.get).toHaveBeenCalledTimes(3);
    expect(mocked.get).toHaveBeenNthCalledWith(2,
      `/records/spend_items/${ID}/history`,
      { params: { limit: 50, cursor: 'cursor-2' } });
    expect(mocked.get).toHaveBeenNthCalledWith(3,
      `/records/spend_items/${ID}/history`,
      { params: { limit: 50, cursor: 'cursor-3' } });
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('says there is no history when every page holds no entry', async () => {
    mocked.get
      .mockResolvedValueOnce({ data: page([], 'cursor-2') } as never)
      .mockResolvedValueOnce({ data: page([], null) } as never);

    renderHistory();
    expect(await screen.findByText('No history yet')).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('reads the history again when the tab is shown again after a change', async () => {
    mocked.get.mockResolvedValue({ data: page([item({ changes: [{ field: 'currency', before: 'EUR', after: 'USD' }] })]) } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <RecordHistory table="spend_items" recordId={ID} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('Currency');
    expect(mocked.get).toHaveBeenCalledTimes(1);

    view.unmount();
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <RecordHistory table="spend_items" recordId={ID} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('Currency');
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(2));
  });

  it('names an application\'s catalog codes with the tenant\'s labels of the IT settings', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/it-ops/settings') {
        return { data: { applicationCategories: [{ code: 'custom_cat', label: 'Shop floor' }], accessMethods: [], serverRoles: [] } } as never;
      }
      return { data: page([item({ changes: [
        { field: 'category', before: 'custom_cat', after: 'line_of_business' },
        { field: 'users_mode', before: 'it_users', after: 'manual' },
      ] })]) } as never;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <RecordHistory table="applications" recordId={ID} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Shop floor')).toBeInTheDocument();
    expect(screen.getByText('Line of business')).toBeInTheDocument();
    expect(screen.getByText('Derived')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(bodyText()).not.toContain('custom_cat');
    expect(bodyText()).not.toContain('it_users');
  });

  it('does not read the IT settings for a record without catalog codes', async () => {
    mocked.get.mockResolvedValue({ data: page([item({ changes: [{ field: 'currency', before: 'EUR', after: 'USD' }] })]) } as never);
    renderHistory();
    await screen.findByText('Currency');
    expect(mocked.get.mock.calls.some(([url]) => url === '/it-ops/settings')).toBe(false);
  });

  it('says in one line that there is no write yet', async () => {
    mocked.get.mockResolvedValue({ data: page([]) } as never);
    renderHistory();
    expect(await screen.findByText('No history yet')).toBeInTheDocument();
    expect(document.querySelector('ol')).toBeNull();
  });

  it('says "Verlauf" in German on an incident, as on every record (its Journal tab is the "Journal")', async () => {
    mocked.get.mockResolvedValue({ data: page([]) } as never);
    await i18n.changeLanguage('de');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <RecordHistory table="incidents" recordId={ID} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Noch kein Verlauf')).toBeInTheDocument();
    expect(bodyText()).not.toContain('Historie');
  });

  it('offers a retry when the history could not be read', async () => {
    mocked.get
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: page([item({ changes: [{ field: 'notes', before: 'Old', after: 'New' }] })]) } as never);

    const user = userEvent.setup();
    renderHistory();
    expect(await screen.findByText('The history could not be loaded')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Notes')).toBeInTheDocument();
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(2));
  });
});
