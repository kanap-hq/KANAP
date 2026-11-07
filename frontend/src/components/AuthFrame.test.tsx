import { render, screen } from '@testing-library/react';
import { afterAll, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';

vi.mock('../config/ThemeContext', () => ({
  useThemeMode: () => ({ mode: 'system', resolvedMode: 'light', setMode: vi.fn() }),
}));
const tenant = vi.hoisted(() => ({
  value: { logoUrl: null as string | null, tenantName: 'Acme' as string | null, organisationName: 'Acme Industries', useLogoInDark: false },
}));
vi.mock('../tenant/TenantContext', () => ({
  useTenant: () => tenant.value,
}));

import AuthFrame from './AuthFrame';

describe('AuthFrame', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('names the workspace\'s organisation next to the product icon when the tenant has no logo', () => {
    render(<AuthFrame><div /></AuthFrame>);
    expect(screen.getByText('Acme Industries')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'KANAP' })).toHaveAttribute('src', '/icon-192.png');
  });

  it('shows the tenant\'s logo, named after the organisation, instead of the name', () => {
    tenant.value = { ...tenant.value, logoUrl: '/api/public/branding/logo?v=1' };
    try {
      render(<AuthFrame><div /></AuthFrame>);
      expect(screen.getByRole('img', { name: 'Acme Industries' })).toHaveAttribute('src', '/api/public/branding/logo?v=1');
      expect(screen.queryByText('Acme Industries')).not.toBeInTheDocument();
    } finally {
      tenant.value = { ...tenant.value, logoUrl: null };
    }
  });

  it('names the theme switch and its mode in the reader\'s language', async () => {
    await i18n.changeLanguage('fr');
    render(<AuthFrame><div /></AuthFrame>);
    expect(screen.getByRole('button', { name: 'Thème\u00a0: Système' })).toBeInTheDocument();
  });
});
