import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { DIMENSION_CODE_PATTERN, linesUsageText, proposeDimensionCode, usedLineCount } from './analyticsFields';

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
