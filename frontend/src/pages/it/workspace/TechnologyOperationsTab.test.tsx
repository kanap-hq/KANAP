import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import TechnologyOperationsTab, { type SupportContactRow } from './TechnologyOperationsTab';
import type { TechnologyDetail } from './TechnologyOverviewTab';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => translation,
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
// The contact picker is covered by its own tests: here it picks Bruno, a database administrator.
vi.mock('../../../components/fields/ContactSelect', () => ({
  default: (props: any) => (
    <button type="button" onClick={() => { props.onContactChange({ id: 'c-2', job_title: 'Database administrator' }); }}>pick contact</button>
  ),
}));

const mocked = vi.mocked(api);

const TECHNOLOGY = {
  id: 'tech-1', reference: 'TEC-1', name: 'SQL Server', editor: 'Microsoft', family: 'database', hosting_type: 'on_prem', lifecycle: 'active',
  description: null, notes: null, cpe_products: [], replaced_by_id: null, replaced_by: null, versions: [], owners: [],
  support_notes: 'Call the editor first.',
} as TechnologyDetail;

const ANNA: SupportContactRow = {
  id: 'sc-1', contact_id: 'c-1', role: 'Editor support',
  contact: { id: 'c-1', first_name: 'Anna', last_name: 'Martin', email: 'anna@editor.test', phone: '+33 1 00 00 00 01' },
};
const BRUNO: SupportContactRow = {
  id: 'sc-2', contact_id: 'c-2', role: 'Database administrator',
  contact: { id: 'c-2', first_name: 'Bruno', last_name: 'Petit', email: null, phone: null, mobile: '+33 6 00 00 00 02' },
};

function renderTab(canManage = true, contacts: SupportContactRow[] = [ANNA], read?: () => Promise<unknown>) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/technologies/tech-1/support-contacts') return (read ? read() : { data: contacts }) as never;
    throw new Error(`unexpected GET ${url}`);
  });
  const onPatch = vi.fn();
  const onError = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <TechnologyOperationsTab technology={TECHNOLOGY} canManage={canManage} onPatch={onPatch} onError={onError} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onPatch, onError };
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
});

describe('TechnologyOperationsTab', () => {
  it('lists the support contacts with their email, phone and role', async () => {
    renderTab(true, [ANNA, BRUNO]);
    await screen.findByText('Bruno Petit');
    const table = await screen.findByRole('table', { name: 'workspace.application.technical.support' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => Array.from(row.querySelectorAll('td')).slice(0, 4).map((cell) => cell.textContent))).toEqual([
      ['Anna Martin', 'anna@editor.test', '+33 1 00 00 00 01', 'Editor support'],
      ['Bruno Petit', '—', '+33 6 00 00 00 02', 'Database administrator'],
    ]);
  });

  it('adds a contact with the role taken from the contact, replacing the whole list', async () => {
    mocked.post.mockResolvedValue({ data: [ANNA, BRUNO] } as never);
    renderTab();
    await screen.findByText('Anna Martin');
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.technical.addContact' }));
    fireEvent.click(await screen.findByRole('button', { name: 'pick contact' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/technologies/tech-1/support-contacts/bulk-replace', {
      contacts: [{ contact_id: 'c-1', role: 'Editor support' }, { contact_id: 'c-2', role: 'Database administrator' }],
    }));
    expect(await screen.findByText('Bruno Petit')).toBeTruthy();
  });

  it('removes a contact at once and reports a refusal', async () => {
    mocked.post.mockRejectedValue({ response: { status: 400, data: { message: 'One or more contacts not found' } } });
    const { onError } = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.technical.removeContact(name=Anna Martin)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/technologies/tech-1/support-contacts/bulk-replace', { contacts: [] }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it('offers no change to the contacts when their list could not be read', async () => {
    renderTab(true, [], () => Promise.reject({ response: { status: 500 } }));
    expect(await screen.findByText('workspace.technology.operations.contactsLoadFailed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'workspace.application.technical.addContact' })).toBeNull();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('offers no change to the contacts while their list is being read', async () => {
    renderTab(true, [], () => new Promise(() => undefined));
    await waitFor(() => expect(mocked.get).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'workspace.application.technical.addContact' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'workspace.application.technical.supportNotes' })).not.toBeDisabled();
  });

  it('runs two quick removals one after the other, the second from the answer to the first', async () => {
    let answer: (value: unknown) => void = () => undefined;
    mocked.post
      .mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }) as never)
      .mockResolvedValueOnce({ data: [] } as never);
    renderTab(true, [ANNA, BRUNO]);
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.technical.removeContact(name=Anna Martin)' }));
    await waitFor(() => expect(screen.queryByText('Anna Martin')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.technical.removeContact(name=Bruno Petit)' }));
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenLastCalledWith('/technologies/tech-1/support-contacts/bulk-replace', { contacts: [{ contact_id: 'c-2', role: 'Database administrator' }] });
    answer({ data: [BRUNO] });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(2));
    expect(mocked.post).toHaveBeenLastCalledWith('/technologies/tech-1/support-contacts/bulk-replace', { contacts: [] });
    await waitFor(() => expect(screen.queryByText('Bruno Petit')).toBeNull());
  });

  it('says a contact already listed keeps its role, and does not save it twice', async () => {
    renderTab(true, [ANNA, BRUNO]);
    await screen.findByText('Bruno Petit');
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.technical.addContact' }));
    fireEvent.click(await screen.findByRole('button', { name: 'pick contact' }));
    expect(screen.getByRole('status').textContent).toBe('workspace.technology.operations.alreadyListed');
    expect(screen.getByRole('button', { name: 'common:buttons.save' })).toBeDisabled();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('saves the support notes when the field loses focus', async () => {
    const { onPatch } = renderTab();
    const notes = screen.getByRole('textbox', { name: 'workspace.application.technical.supportNotes' });
    expect(notes).toHaveValue('Call the editor first.');
    fireEvent.change(notes, { target: { value: 'Call the integrator.' } });
    fireEvent.blur(notes);
    expect(onPatch).toHaveBeenCalledWith({ support_notes: 'Call the integrator.' });
  });

  it('is read-only without the right to manage the technology', async () => {
    renderTab(false);
    await screen.findByText('Anna Martin');
    expect(screen.queryByRole('button', { name: 'workspace.application.technical.addContact' })).toBeNull();
    expect(screen.queryByRole('button', { name: /removeContact/ })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'workspace.application.technical.supportNotes' })).toBeDisabled();
  });
});
