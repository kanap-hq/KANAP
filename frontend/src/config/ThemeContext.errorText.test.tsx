import { fireEvent, render, screen } from '@testing-library/react';
import { FormHelperText, FormLabel, TextField } from '@mui/material';
import { ThemeProvider, getContrastRatio } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from './ThemeContext';

/**
 * Surfaces a field error is read on. `error.main` stays #DC2626 in both modes
 * and fails 4.5:1 on the dark ones. Error text follows `kanap.danger` instead.
 */
const DARK_SURFACES = ['page', 'primary', 'drawer', 'composer'] as const;
const LIGHT_ERROR = '#DC2626';
const DARK_ERROR = '#F87171';

function renderErrorFields(mode: 'light' | 'dark') {
  const theme = createAppTheme(mode);
  const view = render(
    <ThemeProvider theme={theme}>
      <TextField
        label="Light mode primary"
        error
        required
        helperText="Enter a colour like #1A6B7A"
      />
      <TextField label="Outlined" variant="outlined" error helperText="Outlined error" />
      <FormLabel error required>Bare label</FormLabel>
      <FormHelperText error>Bare helper</FormHelperText>
    </ThemeProvider>,
  );
  return { theme, ...view };
}

function expectContrast(color: string, theme: ReturnType<typeof createAppTheme>) {
  for (const surface of DARK_SURFACES) {
    expect(
      getContrastRatio(color, theme.palette.kanap.bg[surface]),
      `${color} on ${surface}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
}

describe('error field text contrast', () => {
  it('keeps the light error text on #DC2626 and the field label tertiary', () => {
    const { theme } = renderErrorFields('light');
    expect(screen.getByText('Enter a colour like #1A6B7A')).toHaveStyle({ color: LIGHT_ERROR });
    expect(screen.getByText('Outlined error')).toHaveStyle({ color: LIGHT_ERROR });
    expect(screen.getByText('Bare helper')).toHaveStyle({ color: LIGHT_ERROR });
    expect(screen.getByText('Bare label')).toHaveStyle({ color: LIGHT_ERROR });
    expect(document.querySelector('.MuiFormLabel-root:not(.MuiInputLabel-root) .MuiFormLabel-asterisk')).toHaveStyle({ color: LIGHT_ERROR });
    // The TextField label is forced to tertiary, including in error. Turning it
    // red would change the light theme.
    expect(screen.getByText('Light mode primary')).toHaveStyle({ color: theme.palette.kanap.text.tertiary });
    expect(document.querySelector('.MuiInputLabel-root .MuiFormLabel-asterisk')).toHaveStyle({ color: '#E8920F' });
    expect(theme.palette.error.main).toBe(LIGHT_ERROR);
    expect(theme.palette.kanap.danger).toBe(LIGHT_ERROR);
  });

  it('paints the dark error text with kanap.danger and reaches 4.5:1', () => {
    const { theme } = renderErrorFields('dark');
    const helper = screen.getByText('Enter a colour like #1A6B7A');
    const label = screen.getByText('Light mode primary');
    fireEvent.focus(screen.getByRole('textbox', { name: 'Light mode primary' }));

    expect(helper).toHaveStyle({ color: DARK_ERROR });
    expect(screen.getByText('Outlined error')).toHaveStyle({ color: DARK_ERROR });
    expect(screen.getByText('Bare helper')).toHaveStyle({ color: DARK_ERROR });
    expect(screen.getByText('Bare label')).toHaveStyle({ color: DARK_ERROR });
    expect(document.querySelector('.MuiFormLabel-root:not(.MuiInputLabel-root) .MuiFormLabel-asterisk')).toHaveStyle({ color: DARK_ERROR });
    expect(label).toHaveStyle({ color: DARK_ERROR });
    expect(document.querySelector('.MuiInputLabel-root .MuiFormLabel-asterisk')).toHaveStyle({ color: '#E8920F' });

    const resolved = getComputedStyle(helper).color;
    expectContrast(resolved, theme);
    expectContrast(getComputedStyle(label).color, theme);
    // The red MUI would have used still fails on the field surface. Buttons,
    // chips and icons keep it: only the error text moved.
    expect(getContrastRatio(theme.palette.error.main, theme.palette.kanap.bg.primary)).toBeLessThan(4.5);
    expect(theme.palette.error.main).toBe(LIGHT_ERROR);
    expect(theme.palette.kanap.danger).toBe(DARK_ERROR);
  });

  it('leaves a field that is not in error on its resting colours', () => {
    const theme = createAppTheme('dark');
    render(
      <ThemeProvider theme={theme}>
        <TextField label="Light mode primary" helperText="Hint" />
      </ThemeProvider>,
    );
    expect(screen.getByText('Hint')).toHaveStyle({ color: theme.palette.text.secondary });
    expect(screen.getByText('Light mode primary')).toHaveStyle({ color: theme.palette.kanap.text.tertiary });
  });
});
