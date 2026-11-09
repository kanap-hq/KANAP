import { render, screen } from '@testing-library/react';
import { afterAll, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { PRODUCT_NAME } from '../config/product';

const theme = vi.hoisted(() => ({ resolvedMode: 'light' as 'light' | 'dark' }));
vi.mock('../config/ThemeContext', () => ({
  useThemeMode: () => ({ mode: 'system', resolvedMode: theme.resolvedMode, setMode: vi.fn() }),
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
    expect(screen.getByRole('img', { name: PRODUCT_NAME })).toHaveAttribute('src', '/brand/kadratis-symbole-couleur.svg');
  });

  it('shows the inverted product symbol on the dark bar', () => {
    theme.resolvedMode = 'dark';
    try {
      render(<AuthFrame><div /></AuthFrame>);
      expect(screen.getByRole('img', { name: PRODUCT_NAME })).toHaveAttribute('src', '/brand/kadratis-symbole-inverse.svg');
    } finally {
      theme.resolvedMode = 'light';
    }
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
