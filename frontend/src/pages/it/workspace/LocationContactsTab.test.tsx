import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../components/workspace/MetadataUserPicker', () => ({
  default: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange('u1')}>pick user</button>
  ),
}));
vi.mock('../../../components/fields/ContactSelect', () => ({
  default: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange('c1')}>pick contact</button>
  ),
}));

import api from '../../../api';
import LocationContactsTab, { ExternalRow, InternalRow, LinkRowComponent } from './LocationContactsTab';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

// A row's fields follow the stored row in the render that receives it (as the sub-location rows
// do, #624). An effect would apply it only after the commit, leaving a window where what is typed
// is overwritten. The probe reads the inputs at layout time, before any passive effect has run.
function Probe({ children, onCommit }: { children: React.ReactNode; onCommit: (values: string[]) => void }) {
  const ref = React.useRef<HTMLTableSectionElement | null>(null);
  React.useLayoutEffect(() => {
    onCommit(Array.from(ref.current?.querySelectorAll('input') ?? []).map((input) => input.value));
  });
  return (
    <table>
      <tbody ref={ref}>{children}</tbody>
    </table>
  );
}

function renderRow(make: (row: any) => React.ReactNode, first: any, next: any) {
  const seen: string[][] = [];
  const ui = (row: any) => (
    <ThemeProvider theme={createAppTheme('light')}>
      <Probe onCommit={(values) => seen.push(values)}>{make(row)}</Probe>
    </ThemeProvider>
  );
  const view = render(ui(first));
  view.rerender(ui(next));
  return seen[seen.length - 1];
}

describe('LocationContactsTab rows', () => {
  const noop = () => undefined;

  it('an internal contact row shows the stored role in the render that receives it', () => {
    const row = { id: 'i1', user_id: 'u1', role: 'Owner', user: { id: 'u1', first_name: 'Ann', email: 'a@x' } };
    const values = renderRow(
      (r) => <InternalRow row={r} canManage onRoleChange={noop} onRemove={noop} />,
      row,
      { ...row, role: 'Backup' },
    );
    expect(values).toEqual(['Backup']);
  });

  it('an external contact row shows the stored role in the render that receives it', () => {
    const row = { id: 'e1', contact_id: 'c1', role: 'Vendor', contact: { id: 'c1', first_name: 'Bob' } };
    const values = renderRow(
      (r) => <ExternalRow row={r} canManage onRoleChange={noop} onRemove={noop} />,
      row,
      { ...row, role: 'Support' },
    );
    expect(values).toEqual(['Support']);
  });

  it('a link row shows the stored description and address in the render that receives them', () => {
    const row = { id: 'l1', description: 'Plan', url: 'https://a.example' };
    const values = renderRow(
      (r) => <LinkRowComponent row={r} canManage onCreate={async () => null} onSave={noop} onRemove={noop} />,
      row,
      { ...row, description: 'Floor plan', url: 'https://b.example' },
    );
    expect(values).toEqual(['Floor plan', 'https://b.example']);
  });
});

function renderTab() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <LocationContactsTab locationId="loc-1" canManage />
    </ThemeProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// QA lot 14, point 13: the first description typed on a link just created from its address was
// lost. Leaving the address saves the link, and the new row replaced the one being typed in.
describe('LocationContactsTab new rows', () => {
  const tr = (key: string) => i18n.t(key);
  const stored = { id: 'l1', url: 'https://plan.example', description: null };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockResolvedValue({ data: [] });
    mocked.patch.mockResolvedValue({ data: {} });
  });

  it('saves the first description typed on a link once its address has created it', async () => {
    mocked.post.mockResolvedValueOnce({ data: stored });
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByText(tr('it:workspace.location.contacts.addWebsite')));
    await user.type(screen.getByPlaceholderText('https://...'), 'https://plan.example');
    await user.click(screen.getByPlaceholderText(tr('it:workspace.location.contacts.description')));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/locations/loc-1/links', {
      url: 'https://plan.example',
      description: null,
    }));
    await user.keyboard('Plan de salle');
    await user.tab();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1/links/l1', {
      url: 'https://plan.example',
      description: 'Plan de salle',
    }));
    expect(screen.getByDisplayValue('Plan de salle')).toBeInTheDocument();
  });

  it('saves a description typed and left while the link is still being created', async () => {
    const creation = deferred<{ data: typeof stored }>();
    mocked.post.mockReturnValueOnce(creation.promise);
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByText(tr('it:workspace.location.contacts.addWebsite')));
    await user.type(screen.getByPlaceholderText('https://...'), 'https://plan.example');
    await user.click(screen.getByPlaceholderText(tr('it:workspace.location.contacts.description')));
    await user.keyboard('Plan de salle');
    await user.tab();
    creation.resolve({ data: stored });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1/links/l1', {
      url: 'https://plan.example',
      description: 'Plan de salle',
    }));
    expect(screen.getByDisplayValue('Plan de salle')).toBeInTheDocument();
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('saves the first role typed on an internal contact just added', async () => {
    const added = { id: 'i1', user_id: 'u1', role: null, user: { id: 'u1', first_name: 'Ann', email: 'a@x' } };
    mocked.post.mockResolvedValueOnce({ data: added });
    mocked.get.mockImplementation((url: string) => Promise.resolve({
      data: url.endsWith('/internal-contacts') && mocked.post.mock.calls.length > 0 ? [added] : [],
    }));
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByText(tr('it:workspace.location.contacts.addInternal')));
    await user.click(screen.getByText('pick user'));
    await user.click(await screen.findByPlaceholderText(tr('it:workspace.location.contacts.internalRolePlaceholder')));
    await user.keyboard('Site manager');
    await user.tab();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1/internal-contacts/i1', {
      user_id: 'u1',
      role: 'Site manager',
    }));
    expect(screen.getByDisplayValue('Site manager')).toBeInTheDocument();
  });

  it('saves the first role typed on an external contact just added', async () => {
    const added = { id: 'e1', contact_id: 'c1', role: null, contact: { id: 'c1', first_name: 'Bob' } };
    mocked.post.mockResolvedValueOnce({ data: added });
    mocked.get.mockImplementation((url: string) => Promise.resolve({
      data: url.endsWith('/external-contacts') && mocked.post.mock.calls.length > 0 ? [added] : [],
    }));
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByText(tr('it:workspace.location.contacts.addExternal')));
    await user.click(screen.getByText('pick contact'));
    await user.click(await screen.findByPlaceholderText(tr('it:workspace.location.contacts.externalRolePlaceholder')));
    await user.keyboard('Facilities');
    await user.tab();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1/external-contacts/e1', {
      contact_id: 'c1',
      role: 'Facilities',
    }));
    expect(screen.getByDisplayValue('Facilities')).toBeInTheDocument();
  });
});
