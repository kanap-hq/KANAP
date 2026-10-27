import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => (
  options ? `${key}|${JSON.stringify(options)}` : key
));
const auth = vi.hoisted(() => ({ admin: true, limited: false, profileId: 'someone-else' }));
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => (
      resource === 'users' && level === 'admin' ? auth.admin : true
    ),
    profile: { id: auth.profileId },
    tenantAuth: null,
    dataAccess: { mode: auth.limited ? 'limited' : 'all', nodes: [] },
  }),
}));
vi.mock('../../api', () => ({ default: { get, post, put, patch, delete: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../components/fields/CompanySelect', () => ({
  default: (props: { onChange: (id: string | null, company?: { id: string; name: string } | null) => void }) => (
    <button type="button" onClick={() => props.onChange('co-2', { id: 'co-2', name: 'Beta Spain' })}>pick company</button>
  ),
}));
vi.mock('../../components/fields/CostCenterSelect', () => ({
  default: (props: { onChange: (id: string | null, node: unknown) => void }) => (
    <button
      type="button"
      onClick={() => props.onChange('cc-2', { id: 'cc-2', code: 'OPS', name: 'Operations', kind: 'cost_center' })}
    >
      pick cost center
    </button>
  ),
}));
vi.mock('../../hooks/useCostCenterTree', () => ({
  useCostCenterTree: () => ({
    ready: true,
    nodes: [],
    byId: new Map(),
    hasAny: true,
    isError: false,
    descendantIds: () => new Set(),
  }),
}));

import UserDialog from './UserDialog';

const ROLE_ID = '11111111-1111-4111-8111-111111111111';
const ROLE = { id: ROLE_ID, role_name: 'Budget member', role_description: '' };

const USER = {
  id: 'u-1',
  email: 'marta@example.test',
  first_name: 'Marta',
  last_name: 'Ruiz',
  job_title: 'CFO',
  business_phone: '555 0100',
  mobile_phone: '555 0101',
  role_ids: [ROLE_ID],
  roles: [ROLE],
  company_id: null,
  department_id: null,
  status: 'enabled',
  external_auth_provider: null,
};

const PERSON_ACCESS = {
  mode: 'limited',
  nodes: [
    { type: 'company', id: 'co-1', name: 'Alpha Spain', access: 'edit' },
    { type: 'cost_center', id: 'cc-1', name: 'Infrastructure', code: 'INF', kind: 'group', access: 'read' },
  ],
  updated_at: '2026-11-12T10:00:00.000Z',
  updated_by_name: 'Claire Dubois',
  is_administrator: false,
  available: true,
  budget_owner_centers: [{ id: 'cc-9', code: 'FIN', name: 'Finance' }],
};

const PREVIEW = { lines: 312, editable_lines: 280, contracts: 45 };

type DialogProps = React.ComponentProps<typeof UserDialog>;

function renderDialog(props: Partial<DialogProps> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter>
            <UserDialog
              open
              mode="edit"
              userId="u-1"
              personName="Marta Ruiz"
              onClose={onClose}
              {...props}
            />
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, onClose };
}

const saveButton = () => screen.getByRole('button', { name: 'buttons.save' }) as HTMLButtonElement;
const accessBody = {
  mode: 'limited',
  nodes: [
    { type: 'company', id: 'co-1', access: 'read' },
    { type: 'cost_center', id: 'cc-1', access: 'read' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.admin = true;
  auth.limited = false;
  auth.profileId = 'someone-else';
  get.mockImplementation(async (url: string) => {
    if (url === '/users/u-1') return { data: USER };
    if (url === '/users/u-1/roles') return { data: { items: [ROLE] } };
    if (url === '/users/u-1/data-access') return { data: PERSON_ACCESS };
    if (url === '/roles') return { data: { items: [ROLE] } };
    return { data: { items: [] } };
  });
  post.mockResolvedValue({ data: PREVIEW });
  put.mockResolvedValue({ data: PERSON_ACCESS });
  patch.mockResolvedValue({ data: USER });
});

describe('UserDialog tabs', () => {
  it('shows both tabs to a users administrator and opens on Identity', async () => {
    renderDialog();
    expect(await screen.findByRole('tab', { name: 'users.dialogs.identity' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'users.actions.dataAccess' })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'userForm.fields.email' })).toBeInTheDocument();
  });

  it('has no tab bar in create mode and keeps Save and invite', async () => {
    renderDialog({ mode: 'create', userId: undefined, personName: undefined });
    expect(screen.getByText('users.dialogs.newUser')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('button', { name: 'users.dialogs.saveAndInvite' })).toBeInTheDocument();
  });

  it('has no tab bar on the viewer’s own account', async () => {
    auth.profileId = 'u-1';
    renderDialog();
    expect(await screen.findByRole('textbox', { name: 'userForm.fields.email' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('has no tab bar for a limited viewer', async () => {
    auth.limited = true;
    renderDialog();
    expect(await screen.findByRole('textbox', { name: 'userForm.fields.email' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('has no tab bar without the users administration', async () => {
    auth.admin = false;
    renderDialog();
    expect(await screen.findByRole('textbox', { name: 'userForm.fields.email' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('opens on the Access tab when asked, as the row menu and the administration page do', async () => {
    renderDialog({ initialTab: 'access' });
    expect(await screen.findByRole('tab', { name: 'users.actions.dataAccess' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Alpha Spain')).toBeInTheDocument();
  });
});

describe('UserDialog validation', () => {
  it('shows no error on a new user until the email is typed, and keeps Save disabled while it is invalid', async () => {
    renderDialog({ mode: 'create', userId: undefined, personName: undefined });
    const email = await screen.findByRole('textbox', { name: 'userForm.fields.email' });
    // Validation on mount used to arrive after the first paint: let that pass before asserting.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(email).toHaveValue('');
    expect(email).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('validation:required')).not.toBeInTheDocument();
    expect(screen.queryByText('validation:invalidEmail')).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'users.dialogs.saveAndInvite' })).toBeDisabled();

    fireEvent.change(email, { target: { value: 'not-an-email' } });
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('validation:invalidEmail')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'users.dialogs.saveAndInvite' })).toBeDisabled();

    fireEvent.change(email, { target: { value: 'ada@example.test' } });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.getByRole('button', { name: 'users.dialogs.saveAndInvite' })).toBeEnabled();
    expect(email).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('shows no error when editing and enables Save after a change', async () => {
    renderDialog();
    const email = await screen.findByRole('textbox', { name: 'userForm.fields.email' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(email).toHaveValue('marta@example.test');
    expect(email).not.toHaveAttribute('aria-invalid', 'true');
    expect(saveButton()).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'userForm.fields.firstName' }), { target: { value: 'Marta2' } });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(email).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('UserDialog save', () => {
  it('saves only the identity when only it changed', async () => {
    renderDialog();
    const firstName = await screen.findByRole('textbox', { name: 'userForm.fields.firstName' });
    fireEvent.change(firstName, { target: { value: 'Marta2' } });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());
    await waitFor(() => expect(patch).toHaveBeenCalledWith(
      '/users/u-1',
      expect.objectContaining({ first_name: 'Marta2' }),
    ));
    expect(put).toHaveBeenCalledWith('/users/u-1/roles', { role_ids: [ROLE_ID] });
    expect(put).not.toHaveBeenCalledWith('/users/u-1/data-access', expect.anything());
  });

  it('saves only the access when only it changed', async () => {
    renderDialog({ initialTab: 'access' });
    await screen.findByText('Alpha Spain');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'admin:dataAccess.accessLabel|{"name":"Alpha Spain"}' }));
    fireEvent.click(screen.getByRole('option', { name: 'admin:dataAccess.access.read' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());
    await waitFor(() => expect(put).toHaveBeenCalledWith('/users/u-1/data-access', accessBody));
    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalledWith('/users/u-1/roles', expect.anything());
  });

  it('saves both when both changed', async () => {
    const calls: string[] = [];
    patch.mockImplementation(async (url: string) => {
      calls.push(`patch ${url}`);
      return { data: USER };
    });
    put.mockImplementation(async (url: string) => {
      calls.push(`put ${url}`);
      return { data: url.endsWith('/data-access') ? PERSON_ACCESS : { items: [ROLE] } };
    });

    renderDialog();
    const firstName = await screen.findByRole('textbox', { name: 'userForm.fields.firstName' });
    fireEvent.change(firstName, { target: { value: 'Marta2' } });
    fireEvent.click(screen.getByRole('tab', { name: 'users.actions.dataAccess' }));
    await screen.findByText('Alpha Spain');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'admin:dataAccess.accessLabel|{"name":"Alpha Spain"}' }));
    fireEvent.click(screen.getByRole('option', { name: 'admin:dataAccess.access.read' }));
    fireEvent.click(screen.getByRole('tab', { name: 'users.dialogs.identity' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());

    await waitFor(() => expect(calls).toEqual([
      'patch /users/u-1',
      'put /users/u-1/roles',
      'put /users/u-1/data-access',
    ]));
  });

  it('keeps the unsaved values of both tabs when switching', async () => {
    renderDialog();
    const firstName = await screen.findByRole('textbox', { name: 'userForm.fields.firstName' });
    fireEvent.change(firstName, { target: { value: 'Marta2' } });
    fireEvent.click(screen.getByRole('tab', { name: 'users.actions.dataAccess' }));
    await screen.findByText('Alpha Spain');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'admin:dataAccess.accessLabel|{"name":"Alpha Spain"}' }));
    fireEvent.click(screen.getByRole('option', { name: 'admin:dataAccess.access.read' }));

    fireEvent.click(screen.getByRole('tab', { name: 'users.dialogs.identity' }));
    expect(screen.getByRole('textbox', { name: 'userForm.fields.firstName' })).toHaveValue('Marta2');
    fireEvent.click(screen.getByRole('tab', { name: 'users.actions.dataAccess' }));
    expect(screen.getByRole('combobox', { name: 'admin:dataAccess.accessLabel|{"name":"Alpha Spain"}' }))
      .toHaveTextContent('admin:dataAccess.access.read');
  });

  it('switches to the Access tab on an access error and keeps the dialog open', async () => {
    put.mockImplementation(async (url: string) => {
      if (url === '/users/u-1/data-access') {
        throw {
          response: {
            status: 409,
            data: { code: 'DATA_ACCESS_UNAVAILABLE', message: 'Data-scoped access is unavailable.' },
          },
        };
      }
      return { data: { items: [ROLE] } };
    });

    const { onClose } = renderDialog();
    const firstName = await screen.findByRole('textbox', { name: 'userForm.fields.firstName' });
    fireEvent.change(firstName, { target: { value: 'Marta2' } });
    fireEvent.click(screen.getByRole('tab', { name: 'users.actions.dataAccess' }));
    await screen.findByText('Alpha Spain');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'admin:dataAccess.accessLabel|{"name":"Alpha Spain"}' }));
    fireEvent.click(screen.getByRole('option', { name: 'admin:dataAccess.access.read' }));
    fireEvent.click(screen.getByRole('tab', { name: 'users.dialogs.identity' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());

    expect(await screen.findByText(/errors:DATA_ACCESS_UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'users.actions.dataAccess' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('users.dialogs.editUser')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets Cancel discard both sides', async () => {
    const { onClose } = renderDialog();
    const firstName = await screen.findByRole('textbox', { name: 'userForm.fields.firstName' });
    fireEvent.change(firstName, { target: { value: 'Marta2' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

describe('UserDialog save and invite', () => {
  const email = 'julie.martin@example.com';
  const confirmText = `users.messages.inviteConfirm|{"count":1,"email":"${email}"}`;

  async function askToInvite() {
    renderDialog({ mode: 'create', userId: undefined, personName: undefined });
    fireEvent.change(screen.getByRole('textbox', { name: 'userForm.fields.email' }), {
      target: { value: email },
    });
    const invite = screen.getByRole('button', { name: 'users.dialogs.saveAndInvite' });
    await waitFor(() => expect(invite).toBeEnabled());
    fireEvent.click(invite);
    const message = await screen.findByText(confirmText);
    const dialog = message.closest('[role="dialog"]');
    if (!dialog) throw new Error('confirmation dialog missing');
    return dialog as HTMLElement;
  }

  it('asks before saving and sends nothing when cancelled', async () => {
    const dialog = await askToInvite();
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByText(confirmText)).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByText('users.dialogs.newUser')).toBeInTheDocument();
  });

  it('creates the user and sends the invitation after confirmation', async () => {
    post.mockImplementation(async (url: string) => (
      url === '/users' ? { data: { id: 'new-1' } } : { data: {} }
    ));
    const dialog = await askToInvite();
    fireEvent.click(within(dialog).getByRole('button', { name: 'users.actions.sendInvite' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/users/new-1/invite'));
    expect(post).toHaveBeenCalledWith('/users', expect.objectContaining({ email }));
    const urls = post.mock.calls.map((call: unknown[]) => call[0]);
    expect(urls.indexOf('/users')).toBeGreaterThanOrEqual(0);
    expect(urls.indexOf('/users')).toBeLessThan(urls.indexOf('/users/new-1/invite'));
  });
});
