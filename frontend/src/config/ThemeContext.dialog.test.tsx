import { render, screen } from '@testing-library/react';
import { Dialog } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import KanapDialog from '../components/design/KanapDialog';
import { kanapPalette } from '../pages/tasks/theme/taskDetailTokens';
import { createAppTheme } from './ThemeContext';

type StyleFn = (args: { theme: ReturnType<typeof createAppTheme>; ownerState: object }) => Record<string, unknown>;

function dialogPaperStyles(mode: 'light' | 'dark') {
  const theme = createAppTheme(mode);
  const overrides = theme.components?.MuiDialog?.styleOverrides as Record<string, unknown> | undefined;
  const style = overrides?.paper;
  if (typeof style !== 'function') throw new Error('MuiDialog.paper is not a style function');
  return (style as StyleFn)({ theme, ownerState: {} });
}

function paperStyle(dialog: HTMLElement) {
  const style = getComputedStyle(dialog);
  return {
    backgroundImage: style.backgroundImage,
    backgroundColor: style.backgroundColor,
    borderTopWidth: style.borderTopWidth,
    borderTopStyle: style.borderTopStyle,
    borderTopColor: style.borderTopColor,
    borderRadius: style.borderRadius,
  };
}

describe('MuiDialog paper surface', () => {
  it('drops the dark elevation overlay and uses the app surface', () => {
    const paper = dialogPaperStyles('dark');
    expect(paper.backgroundImage).toBe('none');
    expect(paper.backgroundColor).toBe(kanapPalette.bg.primary.dark);
    expect(paper.border).toBe(`0.5px solid ${kanapPalette.border.default.dark}`);
    expect(paper.borderRadius).toBe(10);
  });

  it('uses the same surface and border in light mode', () => {
    const paper = dialogPaperStyles('light');
    expect(paper.backgroundImage).toBe('none');
    expect(paper.backgroundColor).toBe(kanapPalette.bg.primary.light);
    expect(paper.border).toBe(`0.5px solid ${kanapPalette.border.default.light}`);
  });

  it('paints a raw dialog with the app surface in dark mode', () => {
    render(
      <ThemeProvider theme={createAppTheme('dark')}>
        <Dialog open transitionDuration={0}>
          <div>Body</div>
        </Dialog>
      </ThemeProvider>,
    );
    expect(paperStyle(screen.getByRole('dialog'))).toEqual({
      backgroundImage: 'none',
      backgroundColor: 'rgb(24, 26, 32)',
      borderTopWidth: '0.5px',
      borderTopStyle: 'solid',
      borderTopColor: 'rgba(255, 255, 255, 0.08)',
      borderRadius: '10px',
    });
  });

  it('paints a raw dialog with the app surface in light mode', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <Dialog open transitionDuration={0}>
          <div>Body</div>
        </Dialog>
      </ThemeProvider>,
    );
    expect(paperStyle(screen.getByRole('dialog'))).toEqual({
      backgroundImage: 'none',
      backgroundColor: 'rgb(255, 255, 255)',
      borderTopWidth: '0.5px',
      borderTopStyle: 'solid',
      borderTopColor: 'rgb(229, 231, 235)',
      borderRadius: '10px',
    });
  });

  it('keeps a background passed through PaperProps.sx', () => {
    render(
      <ThemeProvider theme={createAppTheme('dark')}>
        <Dialog open transitionDuration={0} PaperProps={{ sx: { bgcolor: '#123456' } }}>
          <div>Custom</div>
        </Dialog>
      </ThemeProvider>,
    );
    const style = paperStyle(screen.getByRole('dialog'));
    expect(style.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(style.backgroundImage).toBe('none');
  });

  it('keeps the KanapDialog surface once the theme sets the same values', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={createAppTheme('dark')}>
          <KanapDialog open title="Compare" onClose={() => undefined} onSave={() => undefined}>
            <div>Body</div>
          </KanapDialog>
        </ThemeProvider>
      </I18nextProvider>,
    );
    const style = paperStyle(screen.getByRole('dialog'));
    expect(style.backgroundImage).toBe('none');
    expect(style.backgroundColor).toBe('rgb(24, 26, 32)');
    expect(style.borderTopWidth).toBe('0.5px');
    expect(style.borderTopStyle).toBe('solid');
    expect(style.borderTopColor).toBe('rgba(255, 255, 255, 0.08)');
    // KanapDialog keeps its own radius. The theme default stays 10px.
    expect(style.borderRadius).toBe('8px');
  });
});
