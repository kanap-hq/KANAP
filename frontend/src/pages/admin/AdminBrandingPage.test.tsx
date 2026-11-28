import React from 'react';
import '../../i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminBrandingPage from './AdminBrandingPage';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';
import { KanapDialogProvider } from '../../components/design';

const { refreshTenantInfo } = vi.hoisted(() => ({
  refreshTenantInfo: vi.fn(),
}));

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

// The reader's rights: every level by default (an Administrator), or the levels listed.
const auth = vi.hoisted(() => ({ rights: null as null | Record<string, string> }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => {
      if (!auth.rights) return true;
      const rank: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
      return (rank[auth.rights[resource]] ?? 0) >= (rank[level] ?? 0);
    },
  }),
}));

vi.mock('../../tenant/TenantContext', () => ({
  useTenant: () => ({
    isPlatformHost: false,
    logoUrl: null,
    darkLogoUrl: null,
    tenantName: 'Acme',
    refreshTenantInfo,
  }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

function settings(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    has_logo: false,
    has_dark_logo: false,
    logo_version: 0,
    use_logo_in_dark: true,
    primary_color_light: null,
    primary_color_dark: null,
    ...extra,
  };
}

function renderPage() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <KanapDialogProvider>
          <AdminBrandingPage />
        </KanapDialogProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('AdminBrandingPage organisation name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshTenantInfo.mockResolvedValue(undefined);
    let name = 'Acme';
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/admin/branding/settings') return Promise.resolve({ data: settings(name) });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    (api.patch as any).mockImplementation((_url: string, body: { name?: string }) => {
      if (typeof body.name === 'string') name = body.name;
      return Promise.resolve({ data: { ok: true, ...settings(name) } });
    });
  });

  it('saves the organisation name and refreshes the header', async () => {
    renderPage();
    const field = await screen.findByRole('textbox', { name: 'Workspace name' });
    expect(field).toHaveValue('Acme');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    fireEvent.change(field, { target: { value: '  Northwind Traders  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/admin/branding/settings', { name: 'Northwind Traders' });
    });
    expect(refreshTenantInfo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(field).toHaveValue('Northwind Traders'));
  });

  it('refuses an empty name before saving', async () => {
    renderPage();
    const field = await screen.findByRole('textbox', { name: 'Workspace name' });
    fireEvent.change(field, { target: { value: '   ' } });
    expect(screen.getByText('Use 1 to 120 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe('AdminBrandingPage dark mode logo', () => {
  let stored: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    refreshTenantInfo.mockResolvedValue(undefined);
    stored = { has_logo: true };
    let objectUrls = 0;
    // jsdom has no object URLs.
    URL.createObjectURL = vi.fn(() => `blob:preview-${++objectUrls}`);
    URL.revokeObjectURL = vi.fn();
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/admin/branding/settings') return Promise.resolve({ data: settings('Acme', stored) });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    (api.post as any).mockImplementation((_url: string, _body: unknown, config?: { params?: { variant?: string } }) => {
      stored = { ...stored, [config?.params?.variant === 'dark' ? 'has_dark_logo' : 'has_logo']: true };
      return Promise.resolve({ data: { ok: true } });
    });
    (api.delete as any).mockImplementation((_url: string, config?: { params?: { variant?: string } }) => {
      stored = { ...stored, [config?.params?.variant === 'dark' ? 'has_dark_logo' : 'has_logo']: false };
      return Promise.resolve({ data: { ok: true } });
    });
  });

  it('uploads a dark mode logo on its own, and drops the switch once there is one', async () => {
    renderPage();
    await screen.findByRole('textbox', { name: 'Workspace name' });
    expect(screen.getByRole('checkbox', { name: 'Use the light mode logo' })).toBeChecked();

    const file = new File(['logo'], 'dark.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Dark mode logo'), { target: { files: [file] } });
    expect(screen.queryByRole('checkbox', { name: 'Use the light mode logo' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Dark mode logo preview' })).toHaveAttribute('src', 'blob:preview-1');

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body, config] = (api.post as any).mock.calls[0];
    expect(url).toBe('/admin/branding/logo');
    expect((body as FormData).get('file')).toBe(file);
    expect(config.params).toEqual({ variant: 'dark' });
    expect(refreshTenantInfo).toHaveBeenCalledTimes(1);
  });

  it('removes only the dark mode logo', async () => {
    stored = { has_logo: true, has_dark_logo: true };
    renderPage();
    await screen.findByRole('textbox', { name: 'Workspace name' });
    const removeButtons = screen.getAllByRole('button', { name: 'Remove logo' });
    expect(removeButtons).toHaveLength(2);

    fireEvent.click(removeButtons[1]);
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/admin/branding/logo', { params: { variant: 'dark' } });
    });
    expect(stored).toEqual({ has_logo: true, has_dark_logo: false });
    await screen.findByRole('checkbox', { name: 'Use the light mode logo' });
  });
});

describe('AdminBrandingPage for an organisation reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.rights = { organization: 'reader' };
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/admin/branding/settings') {
        return Promise.resolve({ data: settings('Acme', { has_logo: true, primary_color_light: '#1A6B7A' }) });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  afterEach(() => {
    auth.rights = null;
  });

  it('shows the same fields read-only, and no action', async () => {
    renderPage();
    const name = await screen.findByRole('textbox', { name: 'Workspace name' });
    expect(name).toHaveValue('Acme');
    expect(name).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Light mode primary' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Dark mode primary' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Use the light mode logo' })).toBeDisabled();
    // No save, discard, reset, logo upload or removal, colour picker, preset or clear.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByLabelText('Light mode logo')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('disables the two hidden colour pickers for a reader, and not for an organisation administrator', async () => {
    const { unmount } = renderPage();
    await screen.findByRole('textbox', { name: 'Workspace name' });
    const readerPickers = document.querySelectorAll('input[type="color"]');
    expect(readerPickers).toHaveLength(2);
    readerPickers.forEach((input) => expect(input).toBeDisabled());
    unmount();

    auth.rights = { organization: 'admin' };
    renderPage();
    await screen.findByRole('textbox', { name: 'Workspace name' });
    const adminPickers = document.querySelectorAll('input[type="color"]');
    expect(adminPickers).toHaveLength(2);
    adminPickers.forEach((input) => expect(input).not.toBeDisabled());
  });

  it('refuses the page to users:admin alone, and does not read the settings', async () => {
    auth.rights = { users: 'admin' };
    renderPage();
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Workspace name' })).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });
});
