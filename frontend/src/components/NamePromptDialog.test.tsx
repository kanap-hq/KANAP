import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { createAppTheme } from '../config/ThemeContext';
import NamePromptDialog from './NamePromptDialog';

const state = vi.hoisted(() => ({
  profile: { id: 'u1', email: 'ada@example.com', first_name: null, last_name: null } as Record<string, unknown> | null,
  isPlatformAdmin: false,
  isPlatformHost: false,
  refreshMe: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    profile: state.profile,
    claims: { isGlobalAdmin: false, isBillingAdmin: false, isPlatformAdmin: state.isPlatformAdmin, permissions: {} },
    refreshMe: state.refreshMe,
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: state.isPlatformHost }) }));
vi.mock('../api', () => ({ default: { patch: (...args: unknown[]) => state.patch(...args) } }));

const KEY = 'kanap.namePrompt.later.u1';

function stubStorage(store: Map<string, string>, throwing = false) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      if (throwing) throw new Error('blocked');
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (throwing) throw new Error('blocked');
      store.set(k, v);
    },
    removeItem: (k: string) => { store.delete(k); },
  });
}

function renderDialog() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={createAppTheme('light')}>
        <NamePromptDialog />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe('NamePromptDialog', () => {
  let store: Map<string, string>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    store = new Map();
    stubStorage(store);
    state.profile = { id: 'u1', email: 'ada@example.com', first_name: null, last_name: null };
    state.isPlatformAdmin = false;
    state.isPlatformHost = false;
    state.refreshMe.mockReset().mockResolvedValue(undefined);
    state.patch.mockReset().mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows when both names are missing', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toHaveTextContent('What is your name?');
  });

  it('shows when both names are blank spaces', () => {
    state.profile = { id: 'u1', email: 'a@b.c', first_name: '  ', last_name: '' };
    renderDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it.each([
    ['a first name', { first_name: 'Ada', last_name: null }],
    ['a last name', { first_name: null, last_name: 'Lovelace' }],
  ])('stays hidden with %s', (_label, names) => {
    state.profile = { id: 'u1', email: 'a@b.c', ...names };
    renderDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays hidden for a platform administrator and on the platform host', () => {
    state.isPlatformAdmin = true;
    const { unmount } = renderDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    state.isPlatformAdmin = false;
    state.isPlatformHost = true;
    renderDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides on Later, stores the choice for this user and stays hidden on remount', async () => {
    const { unmount } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store.get(KEY)).toBe('1');
    unmount();
    renderDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps Save disabled until a field is filled', () => {
    renderDialog();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: '  ' } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    expect(save).toBeEnabled();
  });

  it('saves the trimmed names then refreshes the profile', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '  Ada ' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: ' Lovelace  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.refreshMe).toHaveBeenCalledTimes(1));
    expect(state.patch).toHaveBeenCalledWith('/users/me', { first_name: 'Ada', last_name: 'Lovelace' });
  });

  it('sends null for the field left empty', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.patch).toHaveBeenCalledWith('/users/me', { first_name: 'Ada', last_name: null }));
  });

  it('shows the error and stays open when the save fails', async () => {
    state.patch.mockRejectedValue({ response: { status: 400, data: { message: 'Name too long' } } });
    renderDialog();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name too long');
    expect(state.refreshMe).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not crash when the storage throws', async () => {
    stubStorage(store, true);
    renderDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
