import { describe, expect, it } from 'vitest';
import { buildItemPath, formatItemRef, itemAddress } from './item-ref';

describe('business references of the five families numbered in 26.11.9', () => {
  it.each([
    ['supplier', 'SUP-3'],
    ['company', 'COMP-1'],
    ['contact', 'CTCT-2'],
    ['department', 'DEPT-4'],
    ['contract', 'CTR-2'],
  ] as const)('writes a %s reference as %s', (type, ref) => {
    expect(formatItemRef(type, Number(ref.split('-')[1]))).toBe(ref);
  });

  it.each([
    ['supplier', '/master-data/suppliers'],
    ['company', '/master-data/companies'],
    ['contact', '/master-data/contacts'],
    ['department', '/master-data/departments'],
    ['contract', '/ops/contracts'],
  ] as const)('opens a %s on its workspace page', (type, path) => {
    const id = '0b7c1d2e-3f40-4a51-8b62-7c83d94e05f6';
    expect(buildItemPath(type, id)).toBe(`${path}/${id}`);
  });

  it('keeps MEM for contributors, CTR being a contract', () => {
    expect(formatItemRef('contributor', 5)).toBe('MEM-5');
    expect(formatItemRef('contract', 5)).toBe('CTR-5');
  });

  it('addresses a record by its reference, by its uuid while it has no number', () => {
    expect(itemAddress('company', { id: 'co-1', item_number: 5 })).toBe('COMP-5');
    expect(itemAddress('department', { id: 'd-1', item_number: 7 })).toBe('DEPT-7');
    expect(itemAddress('company', { id: 'co-1', item_number: null })).toBe('co-1');
    expect(itemAddress('department', { id: 'd-1' })).toBe('d-1');
  });
});
