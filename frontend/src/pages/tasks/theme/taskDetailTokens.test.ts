import { describe, expect, it } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { kanapPalette, resolveKanapPalette } from './taskDetailTokens';

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

  it.each(['primary', 'secondary', 'tertiary'] as const)(
    'light %s text reaches WCAG AA on every light surface',
    (token) => {
      for (const surface of surfaces) {
        const ratio = contrast(kanapPalette.text[token].light, kanapPalette.bg[surface].light);
        expect(ratio, `${token} on ${surface}`).toBeGreaterThanOrEqual(AA);
      }
    },
  );

  it.each(['light', 'dark'] as const)('keeps primary > secondary > tertiary in %s mode', (mode) => {
    const bg = kanapPalette.bg.primary[mode];
    const { primary, secondary, tertiary } = kanapPalette.text;
    expect(contrast(primary[mode], bg)).toBeGreaterThan(contrast(secondary[mode], bg));
    expect(contrast(secondary[mode], bg)).toBeGreaterThan(contrast(tertiary[mode], bg));
  });
});

const FIELD_DARK = 'rgba(255,255,255,0.20)';
const FIELD_HOVER_DARK = 'rgba(255,255,255,0.32)';

describe('kanap field border tokens', () => {
  it('gives dark fields their own border, above the divider', () => {
    expect(kanapPalette.border.default.dark).toBe('rgba(255,255,255,0.08)');
    expect(kanapPalette.border.field.dark).toBe(FIELD_DARK);
    expect(kanapPalette.border.fieldHover.dark).toBe(FIELD_HOVER_DARK);
    expect(resolveKanapPalette('dark').border.field).toBe(FIELD_DARK);
    expect(resolveKanapPalette('dark').border.fieldHover).toBe(FIELD_HOVER_DARK);
  });

  it('keeps the light field border equal to the current light divider and its hover', () => {
    expect(kanapPalette.border.field.light).toBe(kanapPalette.border.default.light);
    expect(kanapPalette.border.field.light).toBe('#E5E7EB');
    expect(kanapPalette.border.fieldHover.light).toBe(kanapPalette.border.strong.light);
    expect(kanapPalette.border.fieldHover.light).toBe('#D1D5DB');
  });
});

type StyleFn = (args: { theme: ReturnType<typeof createAppTheme>; ownerState: object }) => Record<string, unknown>;

function slotStyles(mode: 'light' | 'dark', component: 'MuiInput' | 'MuiOutlinedInput' | 'MuiAlert', slot: string) {
  const theme = createAppTheme(mode);
  const overrides = theme.components?.[component]?.styleOverrides as Record<string, unknown> | undefined;
  const style = overrides?.[slot];
  if (typeof style !== 'function') throw new Error(`${component}.${slot} is not a style function`);
  return (style as StyleFn)({ theme, ownerState: {} });
}

describe('field border on the shared theme', () => {
  it('paints MuiInput and MuiOutlinedInput with the dark field tokens', () => {
    const input = slotStyles('dark', 'MuiInput', 'root');
    expect(input.border).toBe(`1px solid ${FIELD_DARK}`);
    expect(input['&:hover:not(.Mui-disabled):not(.Mui-readOnly):not(.Mui-focused)']).toEqual({
      borderColor: FIELD_HOVER_DARK,
    });
    expect(input['&.Mui-focused, &:focus-within']).toEqual({ borderColor: kanapPalette.teal.dark });
    expect(input['&.Mui-error, &.Mui-error.Mui-focused']).toEqual({ borderColor: kanapPalette.danger.dark });
    const readOnly = input['&.Mui-readOnly'] as Record<string, unknown>;
    expect(readOnly.backgroundColor).toBe(kanapPalette.bg.drawer.dark);
    expect(readOnly['&.Mui-focused, &:focus-within']).toEqual({ borderColor: FIELD_DARK });

    const outlined = slotStyles('dark', 'MuiOutlinedInput', 'root');
    expect(outlined['& .MuiOutlinedInput-notchedOutline']).toEqual({ borderColor: FIELD_DARK });
    expect(outlined['&:hover:not(.Mui-disabled):not(.Mui-focused) .MuiOutlinedInput-notchedOutline']).toEqual({
      borderColor: FIELD_HOVER_DARK,
    });
    expect(outlined['&.Mui-focused .MuiOutlinedInput-notchedOutline']).toEqual({
      borderColor: kanapPalette.teal.dark,
      borderWidth: 1,
    });
    expect(outlined['&.Mui-error .MuiOutlinedInput-notchedOutline']).toEqual({
      borderColor: kanapPalette.danger.dark,
    });
  });

  it('keeps the light field box on the light divider colours', () => {
    const input = slotStyles('light', 'MuiInput', 'root');
    expect(input.border).toBe('1px solid #E5E7EB');
    expect(input['&:hover:not(.Mui-disabled):not(.Mui-readOnly):not(.Mui-focused)']).toEqual({
      borderColor: '#D1D5DB',
    });
    const outlined = slotStyles('light', 'MuiOutlinedInput', 'root');
    expect(outlined['& .MuiOutlinedInput-notchedOutline']).toEqual({ borderColor: '#E5E7EB' });
    expect(outlined['&:hover:not(.Mui-disabled):not(.Mui-focused) .MuiOutlinedInput-notchedOutline']).toEqual({
      borderColor: '#D1D5DB',
    });
  });

  it('leaves alerts on the divider border', () => {
    const alert = slotStyles('dark', 'MuiAlert', 'standardInfo');
    expect(alert.border).toBe('1px solid rgba(255,255,255,0.08)');
  });
});
