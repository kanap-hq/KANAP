import { describe, expect, it } from 'vitest';
import { isHeldUnknown, offeredCatalogOptions } from './catalogOffered';

const catalog = [
  { code: 'web', label: 'Web' },
  { code: 'vdi', label: 'VDI', deprecated: true },
  { code: 'mobile', label: 'Mobile' },
];

describe('offeredCatalogOptions', () => {
  it('offers the active entries to a record that holds nothing', () => {
    expect(offeredCatalogOptions(catalog).map((option) => option.code)).toEqual(['web', 'mobile']);
    expect(offeredCatalogOptions(catalog, null).map((option) => option.code)).toEqual(['web', 'mobile']);
    expect(offeredCatalogOptions(undefined, 'web')).toEqual([{ code: 'web', label: 'web', deprecated: true, unknown: true }]);
  });

  it('keeps a retired entry for the record that holds it, in its place', () => {
    expect(offeredCatalogOptions(catalog, 'vdi').map((option) => option.code)).toEqual(['web', 'vdi', 'mobile']);
    expect(offeredCatalogOptions(catalog, ['mobile', 'vdi']).map((option) => option.code)).toEqual(['web', 'vdi', 'mobile']);
  });

  it('shows first a held code the catalog does not list, under the label given', () => {
    const offered = offeredCatalogOptions(catalog, ['citrix', ' ', 'citrix', 'web'], (code) => `${code} (legacy)`);
    expect(offered.map((option) => option.label)).toEqual(['citrix (legacy)', 'Web', 'Mobile']);
    expect(offered.map(isHeldUnknown)).toEqual([true, false, false]);
  });
});
