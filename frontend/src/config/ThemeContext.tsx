import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createTheme } from '@mui/material/styles';
import type { ThemeOptions } from '@mui/material/styles';
import { resolveKanapPalette } from '../pages/tasks/theme/taskDetailTokens';

const THEME_MODE_STORAGE_KEY = 'themeMode';

export type ThemeModePreference = 'light' | 'dark' | 'system';
type PaletteMode = 'light' | 'dark';
type BrandingPrimaryColors = {
  light?: string | null;
  dark?: string | null;
};

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function normalizeHexColor(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!HEX_COLOR_RE.test(text)) return null;
  return text.toUpperCase();
}

type ThemeModeContextValue = {
  mode: ThemeModePreference;
  resolvedMode: PaletteMode;
  setMode: (mode: ThemeModePreference) => void;
};

/* ------------------------------------------------------------------ */
/*  KANAP "Refined Density" design system                             */
/* ------------------------------------------------------------------ */

const FONT_FAMILY = "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const MONO_FONT_FAMILY = "'JetBrains Mono Variable', 'JetBrains Mono', 'Fira Code', monospace";

const KANAP_PRIMARY = {
  light: { main: '#1A6B7A', dark: '#134E5A', light: '#E6F4F7', contrastText: '#FFFFFF' },
  dark:  { main: '#4DB8C9', dark: '#2D9AAD', light: 'rgba(77,184,201,0.12)', contrastText: '#0F1117' },
};

function getComponentOverrides(mode: PaletteMode): ThemeOptions['components'] {
  const isDark = mode === 'dark';
  const kanap = resolveKanapPalette(mode);
  const actionPillBase = {
    padding: '4px 11px',
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 500,
    textTransform: 'none' as const,
    minWidth: 0,
    height: 'auto',
    boxShadow: 'none',
    // A pill is one line: it neither wraps nor shrinks below its label in a crowded bar.
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  };
  const actionPillDisabled = {
    backgroundColor: kanap.pill.bg,
    borderColor: kanap.pill.border,
    color: kanap.text.tertiary,
  };
  return {
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        // Prose links only: MUI Link components that are NOT inside a table,
        // navigation, or other component that manages its own color.
        // The MuiLink-underlineAlways/Hover classes identify standalone Link components.
        '.MuiLink-root': {
          color: theme.palette.primary.main,
          '&:visited': { color: theme.palette.primary.main },
        },
        // Breadcrumb links
        '.MuiBreadcrumbs-root a': {
          color: theme.palette.primary.main,
          '&:visited': { color: theme.palette.primary.main },
        },
        // Native date/time inputs paint their own picker icon and text from the
        // UA colour scheme. Without this the black-on-transparent calendar icon
        // is all but invisible on a dark field (reported on the report filter
        // bars). `color-scheme` is the only way to reach that shadow-DOM icon.
        'input[type="date"], input[type="datetime-local"], input[type="time"], input[type="month"], input[type="week"]': {
          colorScheme: isDark ? 'dark' : 'light',
        },
        // Subtle, theme-aware scrollbars on every scrollable region.
        // The previous defaults rendered as bright white tracks in dark mode,
        // visually clashing with the surface palette. Components are free to
        // opt out by re-setting their own ::-webkit-scrollbar rules.
        '*': {
          scrollbarWidth: 'thin',
          scrollbarColor: isDark
            ? 'rgba(255,255,255,0.18) transparent'
            : 'rgba(0,0,0,0.22) transparent',
        },
        '*::-webkit-scrollbar': {
          width: 10,
          height: 10,
        },
        '*::-webkit-scrollbar-track': {
          backgroundColor: 'transparent',
        },
        '*::-webkit-scrollbar-thumb': {
          // border + background-clip gives the thumb visual padding so it doesn't
          // fill the full track width, reading as a thin pill rather than a slab.
          backgroundColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.22)',
          borderRadius: 8,
          border: '2px solid transparent',
          backgroundClip: 'padding-box',
        },
        '*::-webkit-scrollbar-thumb:hover': {
          backgroundColor: isDark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.38)',
        },
        '*::-webkit-scrollbar-corner': {
          backgroundColor: 'transparent',
        },
        // The autofill keyframes every input watches, injected once here (see MuiInputBase).
        '@keyframes mui-auto-fill': { from: { display: 'block' } },
        '@keyframes mui-auto-fill-cancel': { from: { display: 'block' } },
      }),
    },
    MuiInputBase: {
      // Each input otherwise mounts its own global style for the two autofill keyframes and
      // looks it up in the document: dozens of times on a budget grid. The baseline holds them.
      defaultProps: { disableInjectingGlobalStyles: true },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'standard',
        InputLabelProps: { shrink: true },
      },
    },
    MuiAlert: {
      styleOverrides: {
        standardInfo: ({ theme }) => ({
          backgroundColor: theme.palette.kanap.bg.composer,
          color: theme.palette.kanap.text.primary,
          border: `1px solid ${theme.palette.kanap.border.default}`,
          borderRadius: 8,
          fontSize: 13,
          '& .MuiAlert-icon': { color: theme.palette.info.main },
        }),
        standardWarning: ({ theme }) => ({
          backgroundColor: theme.palette.kanap.bg.composer,
          color: theme.palette.kanap.text.primary,
          border: `1px solid ${theme.palette.kanap.border.default}`,
          borderRadius: 8,
          fontSize: 13,
          '& .MuiAlert-icon': { color: theme.palette.kanap.orange },
        }),
        standardError: ({ theme }) => ({
          backgroundColor: theme.palette.kanap.bg.composer,
          color: theme.palette.kanap.text.primary,
          border: `1px solid ${theme.palette.kanap.border.default}`,
          borderRadius: 8,
          fontSize: 13,
          '& .MuiAlert-icon': { color: theme.palette.kanap.danger },
        }),
        standardSuccess: ({ theme }) => ({
          backgroundColor: theme.palette.kanap.bg.composer,
          color: theme.palette.kanap.text.primary,
          border: `1px solid ${theme.palette.kanap.border.default}`,
          borderRadius: 8,
          fontSize: 13,
          '& .MuiAlert-icon': { color: theme.palette.success.main },
        }),
      },
    },
    MuiInputLabel: {
      defaultProps: { shrink: true },
      styleOverrides: {
        root: {
          'fontSize': '11px !important' as any,
          'fontWeight': '400 !important' as any,
          'lineHeight': '1.4 !important' as any,
          'letterSpacing': '0 !important' as any,
          'textTransform': 'none !important' as any,
          'color': `${isDark ? 'rgba(255,255,255,0.35)' : '#9CA3AF'} !important`,
          'position': 'relative !important' as any,
          'transform': 'none !important',
          'marginBottom': '2px !important' as any,
          '&.MuiInputLabel-shrink': {
            transform: 'none !important',
            fontSize: '11px !important' as any,
          },
          '&.Mui-focused': {
            color: `${isDark ? 'rgba(255,255,255,0.35)' : '#9CA3AF'} !important`,
            fontSize: '11px !important' as any,
          },
        },
        asterisk: {
          color: '#E8920F !important',
        },
      },
    },
    // Form fields are bordered boxes by default (charter, decision 2026-09-08):
    // 1px border, 6px radius, ~32px tall, teal border on focus. The theme owns
    // the box; call sites only opt out (`inlineControlSx`, `fieldResetSx`) or
    // compact it (`tableCellFieldSx`). `variant="standard"` is the app default,
    // so this override is what every TextField / Select / Autocomplete gets.
    MuiInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          marginTop: '0px !important',
          boxSizing: 'border-box',
          border: `1px solid ${theme.palette.kanap.border.default}`,
          borderRadius: 6,
          padding: '5px 8px',
          backgroundColor: theme.palette.kanap.bg.primary,
          color: theme.palette.kanap.text.primary,
          transition: 'border-color 120ms ease, background-color 120ms ease',
          '&::before, &::after': { display: 'none' },
          '&:hover:not(.Mui-disabled):not(.Mui-readOnly):not(.Mui-focused)': {
            borderColor: theme.palette.kanap.border.strong,
          },
          '&.Mui-focused, &:focus-within': { borderColor: theme.palette.kanap.teal },
          '&.Mui-error, &.Mui-error.Mui-focused': { borderColor: theme.palette.kanap.danger },
          '&.Mui-readOnly': {
            backgroundColor: theme.palette.kanap.bg.drawer,
            '&.Mui-focused, &:focus-within': { borderColor: theme.palette.kanap.border.default },
          },
          '&.Mui-disabled': {
            backgroundColor: theme.palette.kanap.bg.drawer,
            color: theme.palette.kanap.text.secondary,
          },
          // Select arrow sits inside the padding box, not on the border.
          '& .MuiSelect-icon': { right: 8 },
          // Adornment buttons (e.g. the DateEUField calendar) must not inflate the box.
          '& .MuiInputAdornment-root': { height: 20, maxHeight: 'none' },
          '& .MuiInputAdornment-root .MuiIconButton-root': { padding: 1, margin: '-2px 0' },
        }),
        input: ({ theme }) => ({
          'fontSize': '14px !important' as any,
          'fontWeight': '400 !important' as any,
          'paddingTop': '0 !important' as any,
          'paddingBottom': '0 !important' as any,
          'paddingLeft': '0 !important' as any,
          // paddingRight is left alone: MUI reserves room for the Select arrow
          // and the Autocomplete indicators there.
          '&::placeholder': { color: theme.palette.kanap.text.tertiary, opacity: 1 },
          '&.MuiSelect-select': { paddingRight: '24px !important', minHeight: '1.4375em' },
          // Chrome paints autofilled inputs with its own pale-blue fill and dark
          // text, which breaks the field box in both themes. Repaint with an
          // inset shadow in the field background and keep our text color.
          '&:-webkit-autofill, &:-webkit-autofill:hover, &:-webkit-autofill:focus': {
            WebkitBoxShadow: `0 0 0 1000px ${theme.palette.kanap.bg.primary} inset`,
            WebkitTextFillColor: theme.palette.kanap.text.primary,
            caretColor: theme.palette.kanap.text.primary,
            borderRadius: 0,
          },
        }),
      },
    },
    MuiSelect: {
      defaultProps: { variant: 'standard' },
      styleOverrides: {
        // MUI paints a grey focus background on the select display; wrong inside a box.
        select: { '&:focus': { backgroundColor: 'transparent' } },
        icon: ({ theme }) => ({
          color: theme.palette.kanap.text.secondary,
          fontSize: 18,
          right: 0,
          top: 'calc(50% - 9px)',
        }),
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        root: {
          // Autocomplete's own `.MuiAutocomplete-root .MuiInput-root { paddingBottom: 1 }`
          // beats the MuiInput root override on specificity, so restate the box padding here.
          '& .MuiInput-root': { paddingBottom: 5 },
          '&.MuiAutocomplete-hasPopupIcon .MuiInput-root, &.MuiAutocomplete-hasClearIcon .MuiInput-root': {
            paddingRight: 38,
          },
          '&.MuiAutocomplete-hasPopupIcon.MuiAutocomplete-hasClearIcon .MuiInput-root': {
            paddingRight: 64,
          },
        },
        endAdornment: { right: 8 },
        // Match the Select arrow: 18px, secondary text color.
        popupIndicator: ({ theme }) => ({
          color: theme.palette.kanap.text.secondary,
          padding: 2,
          '& .MuiSvgIcon-root': { fontSize: 18 },
        }),
        clearIndicator: ({ theme }) => ({
          color: theme.palette.kanap.text.secondary,
          padding: 2,
          '& .MuiSvgIcon-root': { fontSize: 16 },
        }),
        tag: { margin: 2 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 6,
          backgroundColor: theme.palette.kanap.bg.primary,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.kanap.border.default },
          '&:hover:not(.Mui-disabled):not(.Mui-focused) .MuiOutlinedInput-notchedOutline': {
            borderColor: theme.palette.kanap.border.strong,
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: theme.palette.kanap.teal,
            borderWidth: 1,
          },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.kanap.danger },
        }),
        notchedOutline: { '& legend': { maxWidth: '100%' } },
        input: ({ theme }) => ({
          padding: '5px 8px',
          fontSize: 14,
          '&:-webkit-autofill, &:-webkit-autofill:hover, &:-webkit-autofill:focus': {
            WebkitBoxShadow: `0 0 0 1000px ${theme.palette.kanap.bg.primary} inset`,
            WebkitTextFillColor: theme.palette.kanap.text.primary,
            caretColor: theme.palette.kanap.text.primary,
          },
        }),
      },
    },
    // Ripple is the Material press-ink that sticks when a Menu/Popover captures
    // mouseup. KANAP uses a 2px focus ring instead (keyboard only).
    MuiButtonBase: {
      defaultProps: { disableRipple: true },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 6,
          textTransform: 'none' as const,
          fontWeight: 500,
          // Native :focus-visible only. MUI's Mui-focusVisible is also set when
          // a Menu/Popover restores focus after Escape, which looks like a stuck press.
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
            backgroundColor: 'transparent',
          },
          '&.Mui-focusVisible': {
            backgroundColor: 'transparent',
          },
        }),
        sizeMedium: { height: 36 },
        sizeSmall: { height: 32, fontSize: '0.8125rem' },
        outlined: {
          borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#D1D5DB',
        },
      },
      // Compact pills for page-level action bars (list and admin page headers, chip bands,
      // workspace title rows): one `action-primary` at most, `action` for the rest,
      // `action-danger` for a destructive action on a non-empty selection. Disabled, all three
      // read as the same neutral pill.
      variants: [
        {
          props: { variant: 'action-primary' },
          style: ({ theme }) => ({
            ...actionPillBase,
            // Primary follows tenant branding; without it, it is `kanap.teal` / `tealForeground`.
            backgroundColor: theme.palette.primary.main,
            border: `1px solid ${theme.palette.primary.main}`,
            color: theme.palette.primary.contrastText,
            '&:hover': {
              backgroundColor: theme.palette.primary.dark,
              borderColor: theme.palette.primary.dark,
              boxShadow: 'none',
            },
            // The root override clears the fill on focus; a filled button keeps it.
            '&:focus-visible, &.Mui-focusVisible': {
              backgroundColor: theme.palette.primary.main,
            },
            '&.Mui-disabled': actionPillDisabled,
          }),
        },
        {
          props: { variant: 'action' },
          style: {
            ...actionPillBase,
            backgroundColor: kanap.pill.bg,
            border: `1px solid ${kanap.pill.border}`,
            color: kanap.text.secondary,
            '&:hover': {
              backgroundColor: kanap.pill.hoverBg,
              boxShadow: 'none',
            },
            '&.Mui-disabled': actionPillDisabled,
          },
        },
        {
          props: { variant: 'action-danger' },
          style: {
            ...actionPillBase,
            backgroundColor: kanap.pillDanger.bg,
            border: `1px solid ${kanap.pillDanger.border}`,
            color: kanap.danger,
            '&:hover': {
              backgroundColor: kanap.pillDanger.hoverBg,
              boxShadow: 'none',
            },
            '&.Mui-disabled': actionPillDisabled,
          },
        },
      ],
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: 10,
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#D1D5DB'}`,
          transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: isDark
              ? '0 4px 12px rgba(0,0,0,0.25)'
              : '0 4px 12px rgba(0,0,0,0.05)',
          },
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 16, '&:last-child': { paddingBottom: 16 } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500, fontSize: '0.75rem' },
        sizeSmall: { height: 22, borderRadius: 9999 },
        sizeMedium: { height: 26, borderRadius: 9999 },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: isDark ? '#181A20' : '#FFFFFF',
          color: isDark ? '#E5E7EB' : '#111827',
          borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB'}`,
        },
      },
    },
    MuiToolbar: {
      styleOverrides: {
        root: { minHeight: '48px !important', height: 48 },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: isDark ? '#0F1117' : '#FAFAFA',
          borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB'}`,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
            backgroundColor: 'transparent',
          },
          '&.Mui-focusVisible': {
            backgroundColor: 'transparent',
          },
        }),
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 6,
          minHeight: 38,
          marginLeft: 8,
          marginRight: 8,
          paddingTop: 7,
          paddingBottom: 7,
          color: 'inherit',
          textDecoration: 'none',
          '&.Mui-selected': {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F3F4F6',
            '&:hover': {
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB',
            },
          },
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
      },
    },
    MuiTab: {
      styleOverrides: {
        root: ({ theme }) => ({
          textTransform: 'none' as const,
          fontWeight: 500,
          fontSize: '0.875rem',
          minHeight: 48,
          color: 'inherit',
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
            backgroundColor: 'transparent',
          },
          '&.Mui-focusVisible': {
            backgroundColor: 'transparent',
          },
        }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 10 },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            fontWeight: 500,
            fontSize: '0.6875rem',
            textTransform: 'none' as const,
            letterSpacing: 0,
            color: isDark ? 'rgba(255,255,255,0.55)' : '#6B7280',
          },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { borderRadius: 6, fontSize: '0.75rem' },
      },
    },
    MuiMenu: {
      defaultProps: { disableRestoreFocus: true },
      styleOverrides: {
        paper: { borderRadius: 8 },
      },
    },
    MuiPopover: {
      defaultProps: { disableRestoreFocus: true },
      styleOverrides: {
        paper: { borderRadius: 8 },
      },
    },
  };
}

export const baseThemeComponents = getComponentOverrides('light');

export function createAppTheme(mode: PaletteMode, brandingPrimaryColors?: BrandingPrimaryColors) {
  const lightPrimary = normalizeHexColor(brandingPrimaryColors?.light);
  const darkPrimary = normalizeHexColor(brandingPrimaryColors?.dark);
  const hasBranding = !!(lightPrimary || darkPrimary);
  const primaryMain = mode === 'dark'
    ? (darkPrimary ?? lightPrimary)
    : (lightPrimary ?? darkPrimary);

  const kanapPrimary = KANAP_PRIMARY[mode];
  const primary = hasBranding && primaryMain
    ? { main: primaryMain }
    : kanapPrimary;

  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary,
      kanap: resolveKanapPalette(mode),
      warning: {
        main: '#E8920F',
        dark: '#C67A00',
        light: isDark ? 'rgba(240,168,48,0.12)' : '#FFF4E0',
        50: isDark ? 'rgba(240,168,48,0.12)' : '#FFF4E0',
      },
      error: {
        main: '#DC2626',
        dark: '#B91C1C',
        light: isDark ? 'rgba(239,68,68,0.12)' : '#FEF2F2',
        50: isDark ? 'rgba(239,68,68,0.12)' : '#FEF2F2',
      },
      success: {
        main: '#16A34A',
        dark: '#15803D',
        light: isDark ? 'rgba(34,197,94,0.12)' : '#F0FDF4',
      },
      info: {
        main: '#2563EB',
        dark: '#1D4ED8',
        light: isDark ? 'rgba(59,130,246,0.12)' : '#EFF6FF',
      },
      background: {
        default: isDark ? '#0F1117' : '#FAFAFA',
        paper: isDark ? '#181A20' : '#FFFFFF',
      },
      divider: isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB',
      text: {
        primary: isDark ? '#E5E7EB' : '#111827',
        secondary: isDark ? 'rgba(255,255,255,0.55)' : '#6B7280',
      },
      action: {
        hover: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      },
    },
    typography: {
      fontFamily: FONT_FAMILY,
      h4: { fontSize: '1.5rem', fontWeight: 500 },
      h5: { fontSize: '1.25rem', fontWeight: 500 },
      h6: { fontSize: '1rem', fontWeight: 500 },
      subtitle1: { fontSize: '0.875rem', fontWeight: 500 },
      subtitle2: { fontSize: '0.8125rem', fontWeight: 500 },
      body1: { fontSize: '0.875rem' },
      body2: { fontSize: '0.8125rem' },
      caption: { fontSize: '0.75rem', fontWeight: 500 },
      overline: { fontSize: '0.6875rem', fontWeight: 500, letterSpacing: 0 },
      button: { fontWeight: 500, textTransform: 'none' as const },
    },
    shape: { borderRadius: 8 },
    shadows: [
      'none',
      isDark ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.06)',
      isDark ? '0 4px 12px rgba(0,0,0,0.25)' : '0 4px 12px rgba(0,0,0,0.05)',
      ...Array(22).fill(isDark ? '0 8px 24px rgba(0,0,0,0.3)' : '0 8px 24px rgba(0,0,0,0.08)'),
    ] as unknown as ThemeOptions['shadows'],
    components: getComponentOverrides(mode),
  });
}

export const lightIslandTheme = createAppTheme('light');

const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined);

function parseStoredThemeMode(value: string | null): ThemeModePreference {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return 'system';
}

function getInitialSystemPrefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function usePrintLightMode() {
  const swappedRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const swapToLight = () => {
      const swapped: HTMLElement[] = [];
      const darkGridNodes = document.querySelectorAll<HTMLElement>('.ag-theme-quartz-dark');

      darkGridNodes.forEach((node) => {
        if (node.dataset.printForcedLight === '1') {
          return;
        }

        node.classList.remove('ag-theme-quartz-dark');
        node.classList.add('ag-theme-quartz');
        node.dataset.printForcedLight = '1';
        swapped.push(node);
      });

      swappedRef.current = [...swappedRef.current, ...swapped];
    };

    const restoreThemeClasses = () => {
      swappedRef.current.forEach((node) => {
        if (!node.isConnected || node.dataset.printForcedLight !== '1') {
          return;
        }

        node.classList.remove('ag-theme-quartz');
        node.classList.add('ag-theme-quartz-dark');
        delete node.dataset.printForcedLight;
      });

      swappedRef.current = [];
    };

    const handleBeforePrint = () => {
      swapToLight();
    };

    const handleAfterPrint = () => {
      restoreThemeClasses();
    };

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    const printMedia = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
    const legacyPrintMedia = printMedia as (MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    }) | null;
    const handlePrintMediaChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        swapToLight();
      } else {
        restoreThemeClasses();
      }
    };

    if (printMedia) {
      if (printMedia.matches) {
        swapToLight();
      }

      if (typeof printMedia.addEventListener === 'function') {
        printMedia.addEventListener('change', handlePrintMediaChange);
      } else if (legacyPrintMedia && typeof legacyPrintMedia.addListener === 'function') {
        legacyPrintMedia.addListener(handlePrintMediaChange);
      }
    }

    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);

      if (printMedia) {
        if (typeof printMedia.removeEventListener === 'function') {
          printMedia.removeEventListener('change', handlePrintMediaChange);
        } else if (legacyPrintMedia && typeof legacyPrintMedia.removeListener === 'function') {
          legacyPrintMedia.removeListener(handlePrintMediaChange);
        }
      }

      restoreThemeClasses();
    };
  }, []);
}

function useBlurPointerOpenedTriggerOnEscape() {
  useEffect(() => {
    let openedByPointer = false;
    const onPointerDown = () => {
      openedByPointer = true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        openedByPointer = false;
        return;
      }
      if (event.key !== 'Escape' || !openedByPointer) return;
      window.setTimeout(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement)) return;
        if (el.closest('.MuiModal-root, .MuiPopover-root, .MuiMenu-root')) return;
        if (el.matches('.MuiButtonBase-root')) el.blur();
      }, 0);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
}

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeModePreference>(() => {
    if (typeof window === 'undefined') {
      return 'system';
    }

    try {
      return parseStoredThemeMode(window.localStorage.getItem(THEME_MODE_STORAGE_KEY));
    } catch {
      return 'system';
    }
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(getInitialSystemPrefersDark);

  usePrintLightMode();
  useBlurPointerOpenedTriggerOnEscape();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    if (typeof legacyMediaQuery.addListener === 'function') {
      legacyMediaQuery.addListener(handleChange);
      return () => legacyMediaQuery.removeListener?.(handleChange);
    }

    return undefined;
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore private mode / storage quota write failures.
    }
  }, [mode]);

  const resolvedMode: PaletteMode = mode === 'system'
    ? (systemPrefersDark ? 'dark' : 'light')
    : mode;

  const value = useMemo<ThemeModeContextValue>(() => ({
    mode,
    resolvedMode,
    setMode,
  }), [mode, resolvedMode]);

  return (
    <ThemeModeContext.Provider value={value}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error('useThemeMode must be used within ThemeModeProvider');
  }
  return context;
}
