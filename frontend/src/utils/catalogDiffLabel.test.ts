import '../i18n';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import { catalogDiffLabel } from './catalogDiffLabel';

describe('catalogDiffLabel', () => {
  it('translates shipped preview values and leaves a tenant label as stored', () => {
    const fr = i18n.getFixedT('fr');
    expect(catalogDiffLabel('status', 'Active', fr)).toBe('Actif');
    expect(catalogDiffLabel('status', 'Deprecated', fr)).toBe('Obsolète');
    expect(catalogDiffLabel('kind', 'Physical Server', fr)).toBe('Serveur physique');
    expect(catalogDiffLabel('kind', 'Switch', fr)).toBe('Switch');
    expect(catalogDiffLabel('domain', 'Workgroup', fr)).toBe('Groupe de travail');
    expect(catalogDiffLabel('kind', 'Baie maison', fr)).toBe('Baie maison');
    expect(catalogDiffLabel('serial_number', 'OLD1', fr)).toBe('OLD1');
    expect(catalogDiffLabel('status', null, fr)).toBe('');
  });

  it('uses the screen language for the same shipped label', () => {
    expect(catalogDiffLabel('status', 'Retired', i18n.getFixedT('de'))).toBe('Außer Betrieb');
    expect(catalogDiffLabel('kind', 'Virtual Machine', i18n.getFixedT('es'))).toBe('Máquina virtual');
    expect(catalogDiffLabel('status', 'Active', i18n.getFixedT('en'))).toBe('Active');
  });
});