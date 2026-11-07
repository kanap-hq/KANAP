import React from 'react';
import '../../i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true }),
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
  render(
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
