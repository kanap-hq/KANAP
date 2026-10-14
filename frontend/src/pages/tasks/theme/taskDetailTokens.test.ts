import { describe, expect, it } from 'vitest';
import { kanapPalette } from './taskDetailTokens';

// WCAG 2.x relative luminance and contrast ratio for opaque #RRGGBB colours.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const surfaces = ['primary', 'page', 'drawer', 'composer'] as const;
const AA = 4.5;

describe('kanap text tokens contrast', () => {
  it.each(['primary', 'secondary', 'tertiary'] as const)(
    'dark %s text reaches WCAG AA on every dark surface',
    (token) => {
      for (const surface of surfaces) {
        const ratio = contrast(kanapPalette.text[token].dark, kanapPalette.bg[surface].dark);
        expect(ratio, `${token} on ${surface}`).toBeGreaterThanOrEqual(AA);
      }
    },
  );

  it.each(['primary', 'secondary'] as const)(
    'light %s text reaches WCAG AA on every light surface',
    (token) => {
      for (const surface of surfaces) {
        const ratio = contrast(kanapPalette.text[token].light, kanapPalette.bg[surface].light);
        expect(ratio, `${token} on ${surface}`).toBeGreaterThanOrEqual(AA);
      }
    },
  );

  it('keeps primary > secondary > tertiary in dark mode', () => {
    const bg = kanapPalette.bg.primary.dark;
    const { primary, secondary, tertiary } = kanapPalette.text;
    expect(contrast(primary.dark, bg)).toBeGreaterThan(contrast(secondary.dark, bg));
    expect(contrast(secondary.dark, bg)).toBeGreaterThan(contrast(tertiary.dark, bg));
  });
});
