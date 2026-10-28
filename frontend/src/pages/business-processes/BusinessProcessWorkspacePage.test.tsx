import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

const navigateMock = vi.hoisted(() => vi.fn());
const editor = vi.hoisted(() => ({
  save: vi.fn(async () => undefined),
  reset: vi.fn(),
}));
const auth = vi.hoisted(() => ({ canAdmin: true }));
const navState = vi.hoisted(() => ({
  total: 0,
  index: 0,
  hasPrev: false,
  hasNext: false,
  prevId: null as string | null,
  nextId: null as string | null,
}));
// A stable `t`: a new one on each render would loop the effects.
const t = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (_resource: string, level: string) => level !== 'admin' || auth.canAdmin, profile: { id: 'user-1' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useBusinessProcessNav', () => ({
  useBusinessProcessNav: () => navState,
}));
// The editors and the applications section load their own data: the tests are about the header.
vi.mock('./editors/BusinessProcessOverviewEditor', () => ({
  default: React.forwardRef((
    { onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void },
    ref: React.ForwardedRef<{ save: () => Promise<void>; reset: () => void }>,
  ) => {
    React.useImperativeHandle(ref, () => ({
      save: editor.save,
      reset: () => {
        editor.reset();
        onDirtyChange?.(false);
      },
    }));
    return <button type="button" onClick={() => onDirtyChange?.(true)}>mark-dirty</button>;
  }),
}));
vi.mock('./editors/BusinessProcessCreateEditor', () => ({ default: React.forwardRef(() => null) }));
vi.mock('./BusinessProcessApplicationsSection', () => ({ default: () => null }));
vi.mock('./BusinessProcessCategoryManagerDialog', () => ({ default: () => null }));
vi.mock('../../components/history/RecordHistory', () => ({
  default: ({ table, recordId }: { table: string; recordId: string }) => <div>{`${table}:${recordId}`}</div>,
}));

import api from '../../api';
import BusinessProcessWorkspacePage from './BusinessProcessWorkspacePage';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/master-data/business-processes/:id/:tab" element={<BusinessProcessWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('BusinessProcessWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.canAdmin = true;
    navState.total = 0;
    navState.index = 0;
    navState.hasPrev = false;
    navState.hasNext = false;
    navState.prevId = null;
    navState.nextId = null;
    mocked.delete.mockResolvedValue({ data: {} });
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/business-processes/bp-1') return { data: { id: 'bp-1', name: 'Order to cash' } };
      return { data: {} };
    });
  });

  it('opens the process history from the header, and never in creation', async () => {
    const history = renderAt('/master-data/business-processes/bp-1/overview');
    await screen.findByText('Order to cash');
    fireEvent.click(screen.getByRole('button', { name: 'admin:auditLogs.history.title' }));
    expect(await screen.findByText('business_processes:bp-1')).toBeInTheDocument();
    history.unmount();

    renderAt('/master-data/business-processes/new/overview');
    expect(screen.queryByRole('button', { name: 'admin:auditLogs.history.title' })).toBeNull();
  });

  it('hides delete from someone who is not a business processes admin, and on a new process', async () => {
    auth.canAdmin = false;
    const { unmount } = renderAt('/master-data/business-processes/bp-1/overview');
    await screen.findByText('Order to cash');
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    unmount();
    auth.canAdmin = true;
    renderAt('/master-data/business-processes/new/overview');
    await screen.findByText('businessProcesses.newBusinessProcess');
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
  });

  it('refuses to delete a process that applications or interfaces use, and offers no confirmation', async () => {
    mocked.post.mockResolvedValue({
      data: { refused: [{ id: 'bp-1', name: 'Order to cash', code: 'BUSINESS_PROCESS_IN_USE', usages: [{ type: 'applications', total: 2 }] }] },
    });
    renderAt('/master-data/business-processes/bp-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(mocked.post).toHaveBeenCalledWith('/business-processes/delete-check', { ids: ['bp-1'] });
    expect(within(dialog).getByText('errors:BUSINESS_PROCESS_IN_USE')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('deletes a process nothing uses, then returns to the list', async () => {
    mocked.post.mockResolvedValue({ data: { refused: [] } });
    renderAt('/master-data/business-processes/bp-1/overview?sort=name%3Aasc');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('businessProcesses.deleteWarning')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/business-processes/bp-1'));
    expect(navigateMock).toHaveBeenCalledWith('/master-data/business-processes?sort=name%3Aasc');
    expect(mocked.get.mock.calls.filter(([url]) => url === '/business-processes/bp-1')).toHaveLength(1);
  });

  it('names save and discard when leaving a dirty process, and discarding still leaves', async () => {
    navState.total = 2;
    navState.hasNext = true;
    navState.nextId = 'bp-2';
    renderAt('/master-data/business-processes/bp-1/overview');
    await screen.findByText('Order to cash');
    fireEvent.click(screen.getByRole('button', { name: 'mark-dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'shared.labels.next' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('common:unsaved.saveAndLeave.message')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'common:unsaved.saveAndLeave.confirm' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'common:unsaved.saveAndLeave.cancel' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'common:buttons.continue' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'common:buttons.cancel' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'common:unsaved.leaveWithoutSaving.cancel' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:unsaved.saveAndLeave.cancel' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/business-processes/bp-2/overview?'));
  });

  it('closes a clean process without asking', async () => {
    renderAt('/master-data/business-processes/bp-1/overview?sort=name%3Aasc');
    await screen.findByText('Order to cash');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/business-processes?sort=name%3Aasc'));
  });

  async function closeDirtyProcess() {
    renderAt('/master-data/business-processes/bp-1/overview?sort=name%3Aasc');
    await screen.findByText('Order to cash');
    fireEvent.click(screen.getByRole('button', { name: 'mark-dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    return screen.findByRole('dialog');
  }

  it('asks before closing a dirty process, and Stay keeps the edit', async () => {
    const dialog = await closeDirtyProcess();
    expect(within(dialog).getByText('common:unsaved.saveAndLeave.message')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'common:unsaved.saveAndLeave.confirm' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'common:unsaved.saveAndLeave.cancel' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:unsaved.leaveWithoutSaving.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(editor.save).not.toHaveBeenCalled();
    expect(editor.reset).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'common:buttons.save' })).toBeEnabled();
  });

  it('stays when the close question is dismissed', async () => {
    const dialog = await closeDirtyProcess();
    fireEvent.click(within(dialog).getByRole('button', { name: 'labels.closeDialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'common:buttons.save' })).toBeEnabled();
  });

  it('drops the edit and closes when leaving without saving', async () => {
    const dialog = await closeDirtyProcess();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:unsaved.saveAndLeave.cancel' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/business-processes?sort=name%3Aasc'));
    expect(editor.reset).toHaveBeenCalled();
    expect(editor.save).not.toHaveBeenCalled();
  });

  it('saves and then closes', async () => {
    const dialog = await closeDirtyProcess();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:unsaved.saveAndLeave.confirm' }));
    await waitFor(() => expect(editor.save).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith('/master-data/business-processes?sort=name%3Aasc');
    expect(editor.reset).not.toHaveBeenCalled();
  });
});
