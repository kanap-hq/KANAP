import { describe, expect, it } from 'vitest';
import { headerLogoUrl } from './headerLogo';

describe('headerLogoUrl', () => {
  const both = { logoUrl: '/light', darkLogoUrl: '/dark', useLogoInDark: false };

  it('shows the light logo in light mode, never the dark one', () => {
    expect(headerLogoUrl(both, 'light')).toBe('/light');
    expect(headerLogoUrl({ logoUrl: null, darkLogoUrl: '/dark', useLogoInDark: true }, 'light')).toBeNull();
  });

  it('shows the dark logo in dark mode whatever the switch says', () => {
    expect(headerLogoUrl(both, 'dark')).toBe('/dark');
  });

  it('falls back to the light logo in dark mode only when allowed', () => {
    expect(headerLogoUrl({ logoUrl: '/light', darkLogoUrl: null, useLogoInDark: true }, 'dark')).toBe('/light');
    expect(headerLogoUrl({ logoUrl: '/light', darkLogoUrl: null, useLogoInDark: false }, 'dark')).toBeNull();
    expect(headerLogoUrl({ logoUrl: '/light', useLogoInDark: true }, 'dark')).toBe('/light');
  });
});
