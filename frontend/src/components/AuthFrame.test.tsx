import { render, screen } from '@testing-library/react';
import { afterAll, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';

vi.mock('../config/ThemeContext', () => ({
  useThemeMode: () => ({ mode: 'system', resolvedMode: 'light', setMode: vi.fn() }),
}));
vi.mock('../tenant/TenantContext', () => ({
  useTenant: () => ({ logoUrl: null, tenantName: null, useLogoInDark: false }),
}));

import AuthFrame from './AuthFrame';

describe('AuthFrame', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('names the theme switch and its mode in the reader\'s language', async () => {
    await i18n.changeLanguage('fr');
    render(<AuthFrame><div /></AuthFrame>);
    expect(screen.getByRole('button', { name: 'Thème\u00a0: Système' })).toBeInTheDocument();
  });
});
