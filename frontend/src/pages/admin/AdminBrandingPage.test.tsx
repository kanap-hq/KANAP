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
    tenantName: 'Acme',
    refreshTenantInfo,
  }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

function settings(name: string) {
  return {
    name,
    has_logo: false,
    logo_version: 0,
    use_logo_in_dark: true,
    primary_color_light: null,
    primary_color_dark: null,
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
    const field = await screen.findByRole('textbox', { name: 'Organization name' });
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
    const field = await screen.findByRole('textbox', { name: 'Organization name' });
    fireEvent.change(field, { target: { value: '   ' } });
    expect(screen.getByText('Use 1 to 120 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(api.patch).not.toHaveBeenCalled();
  });
});
