import { describe, expect, it } from 'vitest';
import type { PaletteMode } from '@mui/material';
import { createAppTheme } from '../../config/ThemeContext';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour of the missing label and its icon (`FieldLabel`) on the properties panel and on the content area. */
describe('missing field colour', () => {
  for (const mode of ['light', 'dark'] as PaletteMode[]) {
    it(`reaches 4.5:1 on the panel and on the content area (${mode})`, () => {
      const { kanap } = createAppTheme(mode).palette;
      expect(contrast(kanap.danger, kanap.bg.drawer)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(kanap.danger, kanap.bg.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(kanap.danger, kanap.bg.page)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('shows why error.main is not used: it fails on the dark panel', () => {
    const { palette } = createAppTheme('dark');
    expect(contrast(palette.error.main, palette.kanap.bg.drawer)).toBeLessThan(4.5);
  });
});
