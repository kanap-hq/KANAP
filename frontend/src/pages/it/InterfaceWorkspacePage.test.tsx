import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import InterfaceWorkspacePage from './InterfaceWorkspacePage';

const post = vi.fn();
const get = vi.fn();
const del = vi.fn();
const auth = vi.hoisted(() => ({ admin: true }));
vi.mock('../../api', () => ({
  default: {
    get: (...args: any[]) => get(...args),
    post: (...args: any[]) => post(...args),
    patch: vi.fn(),
    delete: (...args: any[]) => del(...args),
  },
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (_resource: string, level: string) => level !== 'admin' || auth.admin }),
}));
vi.mock('../../hooks/useModuleItemNav', () => ({
  useInterfaceItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('./components/InterfaceBindingsMatrix', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceFlowTab', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceMappingTab', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceOverviewTab', () => ({ default: () => null }));
vi.mock('./workspace/InterfacePropertyPanel', () => ({ default: () => null }));
vi.mock('./workspace/InterfaceRelationsTab', () => ({ default: () => null }));
// The shell is covered elsewhere; this stub shows what the page hands it.
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: any) => (
    <div>
      <nav>{props.tabs.map((tab: any) => <span key={tab.key}>{tab.label}</span>)}</nav>
      <h1>{props.title || props.titleFallback}</h1>
      <input aria-label="title" defaultValue={props.title} onChange={(event) => props.onTitleDraftChange?.(event.target.value)} />
      {props.titleError ? <div role="alert">{props.titleError}</div> : null}
      <div>{props.actions}</div>
      <main>{props.children}</main>
    </div>
  ),
}));

const CASES = [
  { lang: 'en', texts: ['Overview', 'Flow', 'Environments', 'Data mapping', 'Relations', 'New interface'], create: 'Create', nameRequired: 'Name is required.' },
  { lang: 'fr', texts: ["Vue d'ensemble", 'Flux', 'Environnements', 'Mappage des données', 'Relations', 'Nouvelle interface'], create: 'Créer', nameRequired: 'Le nom est requis.' },
  { lang: 'de', texts: ['Übersicht', 'Fluss', 'Umgebungen', 'Datenzuordnung', 'Beziehungen', 'Neue Schnittstelle'], create: 'Erstellen', nameRequired: 'Name ist erforderlich.' },
  { lang: 'es', texts: ['Vista general', 'Flujo', 'Entornos', 'Mapeo de datos', 'Relaciones', 'Nueva interfaz'], create: 'Crear', nameRequired: 'El nombre es obligatorio.' },
];

describe('InterfaceWorkspacePage (create)', () => {
  beforeEach(() => {
    auth.admin = true;
    post.mockReset();
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it.each(CASES)('shows the tabs and the name check in $lang', async (c) => {
    await i18n.changeLanguage(c.lang);
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/interfaces/new/overview']}>
          <Routes>
            <Route path="/it/interfaces/:id/:tab" element={<InterfaceWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    for (const text of c.texts) expect(screen.getByText(text)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: c.create }));
    expect(await screen.findByText(c.nameRequired)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('drops the name error while the header title is typed', async () => {
    await i18n.changeLanguage('en');
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/interfaces/new/overview']}>
          <Routes>
            <Route path="/it/interfaces/:id/:tab" element={<InterfaceWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.');

    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'Billing to ledger' } });
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.change(screen.getByLabelText('title'), { target: { value: ' ' } });
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.');
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});

const INTERFACE = {
  id: 'int-1',
  interface_reference: 'INT-1',
  interface_id: null,
  name: 'Orders sync',
  lifecycle: 'active',
  criticality: null,
  classification_incomplete: false,
  source_application_id: 'app-1',
  target_application_id: 'app-2',
  source_application_name: 'Ledger',
  target_application_name: 'Billing',
  integration_route_type: 'direct',
  data_class: null,
  contains_pii: false,
  middleware_application_ids: [],
  legs: [],
  dependencies: [],
  links: [],
  attachments: [],
};

const BINDINGS = {
  id: 'int-1',
  name: 'Orders sync',
  code: 'INTERFACE_HAS_BINDINGS',
  usages: [{ type: 'interface_bindings', total: 2 }],
};

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderRecord(path = '/it/interfaces/int-1/overview?q=orders') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Where />
            <Routes>
              <Route path="/it/interfaces" element={<div />} />
              <Route path="/it/interfaces/:id/:tab" element={<InterfaceWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('InterfaceWorkspacePage delete', () => {
  beforeEach(async () => {
    auth.admin = true;
    await i18n.changeLanguage('en');
    get.mockReset();
    post.mockReset();
    del.mockReset();
    del.mockResolvedValue({ data: { deleted: true } });
    get.mockImplementation(async (url: string) => (
      url === '/interfaces/int-1' ? { data: INTERFACE } : { data: { items: [] } }
    ));
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('shows the delete icon to an applications admin only', async () => {
    const view = renderRecord();
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeInTheDocument();
    view.unmount();

    auth.admin = false;
    renderRecord();
    expect(await screen.findByRole('heading', { name: 'Orders sync' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('explains the bindings, and deletes the interface once that option is checked', async () => {
    post.mockResolvedValue({ data: { refused: [BINDINGS] } });
    renderRecord();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(post).toHaveBeenCalledWith('/interfaces/delete-check', { ids: ['int-1'] });
    expect(within(dialog).getByRole('heading', { name: 'Delete Orders sync?' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('This interface has 2 interface bindings. Delete its bindings with it, or remove them first.');
    expect(dialog).toHaveTextContent('This cannot be undone.');
    expect(within(dialog).getByRole('checkbox', { name: 'Also delete related bindings' })).not.toBeChecked();
    expect(dialog).toHaveTextContent('Interfaces with bindings are then deleted with their bindings. Connections stay.');
    const remove = within(dialog).getByRole('button', { name: 'Delete' });
    expect(remove).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Also delete related bindings' }));
    expect(remove).toBeEnabled();
    fireEvent.click(remove);

    await waitFor(() => expect(del).toHaveBeenCalledWith('/interfaces/int-1', { data: { deleteRelatedBindings: true } }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/it/interfaces?q=orders'));
  });

  it('deletes an interface with no bindings and returns to the list', async () => {
    post.mockResolvedValue({ data: { refused: [] } });
    renderRecord();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(dialog).toHaveTextContent('This cannot be undone.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/interfaces/int-1'));
    expect(del).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/it/interfaces?q=orders'));
  });

  it('stays on the record when the delete fails, and says so', async () => {
    post.mockResolvedValue({ data: { refused: [] } });
    del.mockRejectedValue(new Error('offline'));
    renderRecord();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Failed to delete interface')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/it/interfaces/int-1/overview?q=orders');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('keeps a refusal the bindings option does not lift', async () => {
    post.mockResolvedValue({
      data: { refused: [{ id: 'int-1', name: 'Orders sync', code: 'RECORD_USED_BY', usages: [{ type: 'tasks', total: 1 }] }] },
    });
    renderRecord();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent).filter(Boolean)).toEqual(['Close']);
    expect(del).not.toHaveBeenCalled();
  });
});
