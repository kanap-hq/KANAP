import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

const navigateMock = vi.hoisted(() => vi.fn());
const editor = vi.hoisted(() => ({
  save: vi.fn(async () => undefined),
  reset: vi.fn(),
}));
const navState = vi.hoisted(() => ({
  total: 1,
  index: 0,
  hasPrev: false,
  hasNext: false,
  prevId: null as string | null,
  nextId: null as string | null,
}));
const t = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../hooks/useTemplateAccountNav', () => ({
  useTemplateAccountNav: () => navState,
}));
vi.mock('../accounts/editors/AccountOverviewEditor', () => ({
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
vi.mock('../accounts/editors/AccountCreateEditor', () => ({
  default: React.forwardRef(() => null),
}));

import AdminStandardAccountWorkspacePage from './AdminStandardAccountWorkspacePage';

function renderAt(path: string) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <KanapDialogProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/admin/standard-accounts/:templateId/:id/:tab" element={<AdminStandardAccountWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </KanapDialogProvider>
    </ThemeProvider>,
  );
}

describe('AdminStandardAccountWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navState.total = 1;
    navState.index = 0;
    navState.hasPrev = false;
    navState.hasNext = false;
    navState.prevId = null;
    navState.nextId = null;
  });

  it('closes a clean account without asking', async () => {
    renderAt('/admin/standard-accounts/tpl-1/acc-1/overview?q=cash');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/admin/standard-accounts?q=cash'));
  });

  async function closeDirtyAccount() {
    renderAt('/admin/standard-accounts/tpl-1/acc-1/overview?q=cash');
    fireEvent.click(screen.getByRole('button', { name: 'mark-dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    return screen.findByRole('dialog');
  }

  it('asks before closing a dirty account, and Stay keeps the edit', async () => {
    const dialog = await closeDirtyAccount();
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

  it('drops the edit and closes when leaving without saving', async () => {
    const dialog = await closeDirtyAccount();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:unsaved.saveAndLeave.cancel' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/admin/standard-accounts?q=cash'));
    expect(editor.reset).toHaveBeenCalled();
    expect(editor.save).not.toHaveBeenCalled();
  });

  it('saves and then closes', async () => {
    const dialog = await closeDirtyAccount();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:unsaved.saveAndLeave.confirm' }));
    await waitFor(() => expect(editor.save).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith('/admin/standard-accounts?q=cash');
    expect(editor.reset).not.toHaveBeenCalled();
  });
});
