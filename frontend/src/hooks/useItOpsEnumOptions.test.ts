import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({
  data: {
    entities: [
      // Shipped entities as every tenant stores them.
      { code: 'internal_users', label: 'Internal Users', graph_tier: 'top' },
      { code: 'partner_networks', label: 'Partner Networks', graph_tier: 'top' },
      // A shipped entity the tenant renamed, and one the tenant added.
      { code: 'internet', label: 'Web', graph_tier: 'top' },
      { code: 'suppliers_vpn', label: 'Suppliers VPN', graph_tier: 'top' },
    ],
  },
}));
const language = vi.hoisted(() => ({ value: 'fr' }));
vi.mock('./useItOpsSettings', () => ({ useItOpsSettings: () => ({ data: settings.data }) }));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: language.value, resolvedLanguage: language.value } }),
  };
});

import { useItOpsEnumOptions } from './useItOpsEnumOptions';

describe('entity names on the maps', () => {
  it('names a shipped entity in the reader\'s language and keeps the tenant\'s own names', () => {
    const { result } = renderHook(() => useItOpsEnumOptions());
    const { entityName } = result.current;
    expect(entityName('internal_users', 'Internal Users')).toBe('Utilisateurs internes');
    expect(entityName('PARTNER_NETWORKS', 'Partner Networks')).toBe('Réseaux partenaires');
    expect(entityName('internet', 'Web')).toBe('Web');
    expect(entityName('suppliers_vpn', 'Suppliers VPN')).toBe('Suppliers VPN');
  });

  it('keeps the stored name of an entity the catalog no longer has', () => {
    const { result } = renderHook(() => useItOpsEnumOptions());
    expect(result.current.entityName('old_dmz', 'Old DMZ')).toBe('Old DMZ');
    expect(result.current.entityName('old_dmz', null)).toBe('old_dmz');
  });

  it('writes shipped entities in sentence case in English', () => {
    language.value = 'en';
    const { result } = renderHook(() => useItOpsEnumOptions());
    expect(result.current.entityName('internal_users', 'Internal Users')).toBe('Internal users');
  });
});
