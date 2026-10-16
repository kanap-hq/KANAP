import { describe, expect, it } from 'vitest';
import '../i18n';
import { connectionTypeCategoryLabel } from './itOpsCatalogDefaults';

describe('connection type categories', () => {
  it('shows a shipped category in the user language and any other category as typed', () => {
    expect(connectionTypeCategoryLabel('Remote Access', 'fr')).toBe('Accès distant');
    expect(connectionTypeCategoryLabel('VPN / Tunnel', 'es')).toBe('VPN / túnel');
    expect(connectionTypeCategoryLabel('Network Services', 'de')).toBe('Netzwerkdienste');
    expect(connectionTypeCategoryLabel('Network Services', 'en')).toBe('Network services');
    expect(connectionTypeCategoryLabel('remote access', 'fr')).toBe('remote access');
    expect(connectionTypeCategoryLabel('Lab', 'fr')).toBe('Lab');
    expect(connectionTypeCategoryLabel('', 'fr')).toBe('');
  });
});
