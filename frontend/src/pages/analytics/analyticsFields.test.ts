import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  DIMENSION_CODE_PATTERN,
  deleteConfirmation,
  linesUsageText,
  proposeDimensionCode,
  usedLineCount,
  valuesInUseMessage,
} from './analyticsFields';

describe('proposeDimensionCode', () => {
  it('lowercases, strips accents and turns spaces into dashes', () => {
    expect(proposeDimensionCode('Nature de coût')).toBe('nature-de-cout');
    expect(proposeDimensionCode('  Centre   analytique ')).toBe('centre-analytique');
  });

  it('spells out letters that carry no separate accent', () => {
    expect(proposeDimensionCode('Œuvres')).toBe('oeuvres');
    expect(proposeDimensionCode('Straße')).toBe('strasse');
    expect(proposeDimensionCode('Cæsar')).toBe('caesar');
    expect(proposeDimensionCode('Ørsted')).toBe('orsted');
  });

  it('drops other characters and never starts or ends with a separator', () => {
    expect(proposeDimensionCode('- R&D / projets -')).toBe('rd-projets');
    const long = proposeDimensionCode(`${'a'.repeat(39)} b`);
    expect(long).toBe('a'.repeat(39));
    expect(proposeDimensionCode(`${'a'.repeat(39)}_b`)).toBe('a'.repeat(39));
  });

  it('proposes codes the server accepts', () => {
    for (const name of ['Nature de coût', 'Œuvres', 'Straße', `${'x'.repeat(60)}`, 'Ordre interne 2027']) {
      expect(proposeDimensionCode(name)).toMatch(DIMENSION_CODE_PATTERN);
    }
  });
});

describe('lines usage', () => {
  const t = ((key: string, opts?: { count?: number }) => (opts?.count !== undefined ? `${key}:${opts.count}` : key)) as unknown as TFunction;

  it('adds the two natures: a line has one nature and one value per dimension', () => {
    expect(usedLineCount(3, 3)).toBe(6);
    expect(usedLineCount(0, 2)).toBe(2);
    expect(usedLineCount(undefined, null)).toBe(0);
  });

  it('says how many lines, or that none uses it yet', () => {
    expect(linesUsageText(t, 'dimension', 6)).toBe('analytics.usage.dimensionLines:6');
    expect(linesUsageText(t, 'value', 1)).toBe('analytics.usage.valueLines:1');
    expect(linesUsageText(t, 'dimension', 0)).toBe('analytics.usage.dimensionUnused');
    expect(linesUsageText(t, 'value', 0)).toBe('analytics.usage.valueUnused');
  });
});

describe('delete confirmations', () => {
  // Every interpolation shows after the key, nested phrases included.
  const t = ((key: string, opts?: Record<string, unknown>) => (
    opts ? `${key}(${Object.entries(opts).map(([name, value]) => `${name}=${value}`).join(', ')})` : key
  )) as unknown as TFunction;

  it('asks before deleting a dimension without values, or a value no line uses, with a plain Delete', () => {
    expect(deleteConfirmation(t, { kind: 'dimension', name: 'Menu', valueCount: 0, lineCount: 0 })).toEqual({
      title: 'analytics.forceDelete.title(name=Menu)',
      body: 'common:delete.cannotUndo',
      confirmLabel: 'common:buttons.delete',
      force: false,
    });
    expect(deleteConfirmation(t, { kind: 'value', name: 'Dessert', lineCount: 0 })).toEqual({
      title: 'analytics.forceDelete.title(name=Dessert)',
      body: 'common:delete.cannotUndo',
      confirmLabel: 'common:buttons.delete',
      force: false,
    });
  });

  it('says the values of a dimension no line uses go too, with a plain Delete', () => {
    expect(deleteConfirmation(t, { kind: 'dimension', name: 'Menu', valueCount: 3, lineCount: 0 })).toEqual({
      title: 'analytics.forceDelete.title(name=Menu)',
      body: 'analytics.forceDelete.dimensionValues(count=3)',
      confirmLabel: 'common:buttons.delete',
      force: true,
    });
  });

  it('gives the values and the distinct lines a used dimension loses, with Delete anyway', () => {
    expect(deleteConfirmation(t, { kind: 'dimension', name: 'Menu', valueCount: 3, lineCount: 6 })).toEqual({
      title: 'analytics.forceDelete.title(name=Menu)',
      body: 'analytics.forceDelete.dimensionUsed(values=analytics.forceDelete.dimensionUsedValues(count=3), '
        + 'lines=analytics.forceDelete.budgetLines(count=6))',
      confirmLabel: 'analytics.forceDelete.confirmAnyway',
      force: true,
    });
  });

  it('gives the lines a used value is removed from, with Delete anyway', () => {
    expect(deleteConfirmation(t, { kind: 'value', name: 'Dessert', lineCount: 4 })).toEqual({
      title: 'analytics.forceDelete.title(name=Dessert)',
      body: 'analytics.forceDelete.valueUsed(count=4)',
      confirmLabel: 'analytics.forceDelete.confirmAnyway',
      force: true,
    });
  });

  it('counts the used values of a grid selection and the lines they leave', () => {
    expect(valuesInUseMessage(t, [{ opex_count: 0, capex_count: 0 }, {}])).toBeNull();
    expect(valuesInUseMessage(t, [
      { opex_count: 2, capex_count: 1 },
      { opex_count: 0, capex_count: 0 },
      { opex_count: 0, capex_count: 3 },
    ])).toBe('analytics.forceDelete.valuesUsed(count=2, lines=analytics.forceDelete.budgetLines(count=6))');
  });
});
