import React from 'react';
import {
  Box,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { taskDetailTokens, taskDetailTypography } from '../../tasks/theme/taskDetailTokens';

export type PortfolioDetailWorkspaceTab = {
  key: string;
  label: string;
  badge?: number;
  disabled?: boolean;
};

type PortfolioDetailWorkspaceNav = {
  currentIndex: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  previousLabel: string;
  nextLabel: string;
};

type PortfolioDetailWorkspaceShellProps = {
  activeTab: string;
  actions?: React.ReactNode;
  backLabel: string;
  canEditTitle?: boolean;
  children: React.ReactNode;
  drawerStorageKey: string;
  forceDrawerOpen?: boolean;
  /** Overrides the stored drawer state on mount only (e.g. a deep link that targets a drawer field). */
  initialDrawerOpen?: boolean;
  /** Opens the drawer each time this number changes (the page must show one of its fields). */
  drawerOpenRequest?: number;
  isCreate?: boolean;
  itemReference?: string | null;
  metadata?: React.ReactNode;
  nav?: PortfolioDetailWorkspaceNav;
  onBack: () => void;
  onCopyReference?: () => void;
  onSaveShortcut?: () => void;
  onTabChange: (nextTab: string) => void;
  onTitleSave?: (nextTitle: string) => void;
  /** Omitted (e.g. on a create page), the shell draws no Properties tab and no drawer. */
  properties?: React.ReactNode;
  tabs: PortfolioDetailWorkspaceTab[];
  title: string;
  titleFallback: string;
};

function getStoredDrawerState(storageKey: string) {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored == null) return true;
    return JSON.parse(stored) !== false;
  } catch {
    return true;
  }
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function NavChip({ nav }: { nav: PortfolioDetailWorkspaceNav }) {
  if (nav.totalCount <= 0) return null;

  const navButtonSx = (theme: Theme) => ({
    p: 0,
    width: 24,
    height: 24,
    minWidth: 24,
    borderRadius: '4px',
    color: theme.palette.kanap.navChip.fg,
    '&:hover': {
      bgcolor: theme.palette.kanap.tab.bgHover,
    },
    '&.Mui-disabled': {
      opacity: 0.35,
    },
  });

  return (
    <Box
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        py: '2px',
        px: '4px',
        borderRadius: taskDetailTokens.borderRadius.pill,
        bgcolor: theme.palette.kanap.navChip.bg,
        border: `1px solid ${theme.palette.kanap.navChip.border}`,
      })}
    >
      <IconButton onClick={nav.onPrev} disabled={!nav.hasPrev} aria-label={nav.previousLabel} sx={navButtonSx} size="small">
        <ChevronLeftIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <Box
        component="span"
        sx={(theme) => ({
          fontFamily: MONO_FONT_FAMILY,
          fontSize: '11px',
          fontWeight: 500,
          color: theme.palette.kanap.navChip.fg,
          userSelect: 'none',
        })}
      >
        {nav.currentIndex} of {nav.totalCount}
      </Box>
      <IconButton onClick={nav.onNext} disabled={!nav.hasNext} aria-label={nav.nextLabel} sx={navButtonSx} size="small">
        <ChevronRightIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
}

function EditableTitle({
  canEdit,
  fallback,
  onSave,
  value,
}: {
  canEdit: boolean;
  fallback: string;
  onSave?: (nextTitle: string) => void;
  value: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const displayValue = value || fallback;
  const isFallback = !value;

  const commit = React.useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave?.(trimmed);
    }
    setEditing(false);
  }, [draft, onSave, value]);

  if (!canEdit) {
    return (
      <Typography
        component="span"
        sx={(theme) => ({
          ...taskDetailTypography.title,
          display: 'inline',
          color: isFallback ? theme.palette.kanap.text.tertiary : 'inherit',
        })}
      >
        {displayValue}
      </Typography>
    );
  }

  if (!editing) {
    return (
      <Typography
        component="span"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        sx={(theme) => ({
          ...taskDetailTypography.title,
          display: 'inline',
          color: isFallback ? theme.palette.kanap.text.tertiary : 'inherit',
          cursor: 'text',
          '&:hover': { opacity: 0.85 },
        })}
      >
        {displayValue}
      </Typography>
    );
  }

  return (
    <Box
      component="input"
      value={draft}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      autoFocus
      sx={(theme) => ({
        font: 'inherit',
        color: 'inherit',
        bgcolor: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
        outline: 'none',
        p: 0,
        m: 0,
        width: '100%',
      })}
    />
  );
}

export default function PortfolioDetailWorkspaceShell({
  activeTab,
  actions,
  backLabel,
  canEditTitle = false,
  children,
  drawerStorageKey,
  forceDrawerOpen = false,
  initialDrawerOpen,
  drawerOpenRequest = 0,
  isCreate = false,
  itemReference,
  metadata,
  nav,
  onBack,
  onCopyReference,
  onSaveShortcut,
  onTabChange,
  onTitleSave,
  properties,
  tabs,
  title,
  titleFallback,
}: PortfolioDetailWorkspaceShellProps) {
  const theme = useTheme();
  const { t } = useTranslation('portfolio');
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'));
  const [drawerOpen, setDrawerOpen] = React.useState(
    () => initialDrawerOpen ?? getStoredDrawerState(drawerStorageKey),
  );
  // The classeur toggle only renders on desktop: on mobile the properties
  // always stack under the content, otherwise a stored "closed" state would
  // hide them with no visible way back.
  const effectiveDrawerOpen = forceDrawerOpen || drawerOpen || isMobile;
  const hasProperties = properties != null;
  // The drawer and its tab rise beside the tab row. Without a tab row (a single tab) there is
  // nothing to sit beside: rising would cover the title row and its actions, so they start at
  // the content top.
  const hasTabRow = tabs.length > 1;
  const drawerLift = hasTabRow ? Math.abs(taskDetailTokens.drawer.panelTop) : 0;
  const tabLift = hasTabRow ? Math.abs(taskDetailTokens.drawer.tabTop) : 0;

  React.useEffect(() => {
    if (drawerOpenRequest > 0) setDrawerOpen(true);
  }, [drawerOpenRequest]);

  React.useEffect(() => {
    if (forceDrawerOpen) return;
    try {
      window.localStorage.setItem(drawerStorageKey, JSON.stringify(drawerOpen));
    } catch {
      // Local storage can be unavailable in private contexts.
    }
  }, [drawerOpen, drawerStorageKey, forceDrawerOpen]);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        if (onSaveShortcut) {
          event.preventDefault();
          onSaveShortcut();
        }
        return;
      }

      if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;

      // In create mode only Escape (close) is meaningful — no prev/next, no drawer toggle.
      if (isCreate && event.key !== 'Escape') return;

      switch (event.key) {
        case 'j':
        case 'ArrowLeft':
          if (nav?.hasPrev) {
            event.preventDefault();
            nav.onPrev();
          }
          break;
        case 'k':
        case 'ArrowRight':
          if (nav?.hasNext) {
            event.preventDefault();
            nav.onNext();
          }
          break;
        case 'Escape':
          event.preventDefault();
          onBack();
          break;
        case 'p':
        case '.':
          if (forceDrawerOpen) return;
          event.preventDefault();
          setDrawerOpen((open) => !open);
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [forceDrawerOpen, isCreate, nav, onBack, onSaveShortcut]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flexShrink: 0 }}>
        <Box
          component="header"
          sx={(theme) => ({
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            columnGap: '12px',
            py: taskDetailTokens.topbar.py,
            px: isCompact ? 2 : taskDetailTokens.topbar.px,
            borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
          })}
        >
          <Box component="nav" sx={{ display: 'flex', alignItems: 'center', gap: taskDetailTokens.breadcrumb.gap, fontSize: '12px', minWidth: 0, overflow: 'hidden' }}>
            <Box
              component="button"
              type="button"
              onClick={onBack}
              sx={(theme) => ({
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                minWidth: 0,
                overflow: 'hidden',
                color: theme.palette.kanap.text.secondary,
                bgcolor: 'transparent',
                border: 0,
                p: 0,
                font: 'inherit',
                fontSize: '12px',
                cursor: 'pointer',
                '&:hover': { color: theme.palette.kanap.text.primary },
              })}
            >
              <ArrowBackIcon sx={{ fontSize: 14, flexShrink: 0 }} />
              <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {backLabel}
              </Box>
            </Box>
          </Box>
          {nav && (
            <Box sx={{ justifySelf: 'center', display: 'flex', alignItems: 'center' }}>
              <NavChip nav={nav} />
            </Box>
          )}
        </Box>

        <Box sx={{ pt: taskDetailTokens.titleBlock.pt, px: isCompact ? 2 : taskDetailTokens.titleBlock.px, pb: taskDetailTokens.titleBlock.pb }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: taskDetailTokens.titleRow.gap,
              flexDirection: isCompact ? 'column' : 'row',
              mb: hasTabRow ? (metadata ? taskDetailTokens.titleStack.metadataToTabsGap : taskDetailTokens.titleRow.mb) : 0,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: taskDetailTokens.titleStack.gap }}>
              <Box
                component="h1"
                sx={{
                  ...taskDetailTypography.title,
                  m: 0,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'baseline',
                  flexWrap: isCompact ? 'wrap' : 'nowrap',
                  rowGap: '4px',
                }}
              >
                {itemReference && (
                  <Box
                    component="span"
                    onClick={onCopyReference}
                    title={t('workspace.project.actions.copyReference')}
                    sx={(theme) => ({
                      fontFamily: MONO_FONT_FAMILY,
                      ...taskDetailTypography.idPrefix,
                      color: theme.palette.kanap.text.secondary,
                      mr: '14px',
                      cursor: onCopyReference ? 'pointer' : 'default',
                      flexShrink: 0,
                      '&:hover': onCopyReference ? { color: theme.palette.kanap.text.primary } : undefined,
                    })}
                  >
                    {itemReference}
                  </Box>
                )}
                <Box sx={{ flex: 1, minWidth: isCompact ? '100%' : 0 }}>
                  <EditableTitle
                    value={title}
                    fallback={titleFallback}
                    canEdit={canEditTitle}
                    onSave={onTitleSave}
                  />
                </Box>
              </Box>

              {metadata && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: taskDetailTokens.metadataBar.gap, flexWrap: 'wrap', fontSize: '12px' }}>
                  {metadata}
                </Box>
              )}
            </Box>

            {actions && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: taskDetailTokens.actionPills.gap,
                  flexShrink: 0,
                  mt: isCompact ? 0 : '7px',
                  flexWrap: 'wrap',
                  justifyContent: isCompact ? 'flex-start' : 'flex-end',
                  width: isCompact ? '100%' : 'auto',
                }}
              >
                {actions}
              </Box>
            )}
          </Box>

          {hasTabRow && (
            <Tabs
              value={activeTab}
              onChange={(_, nextValue) => onTabChange(String(nextValue))}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{
                minHeight: 'auto',
                overflow: 'visible',
                '& .MuiTabs-indicator': { display: 'none' },
                '& .MuiTabs-scroller': { overflow: 'visible !important' },
                '& .MuiTabs-flexContainer': { overflow: 'visible', pt: '10px' },
              }}
            >
              {tabs.map((tab) => (
                <Tab
                  key={tab.key}
                  label={(
                    <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                      {tab.label}
                      {typeof tab.badge === 'number' && (
                        <Box
                          component="span"
                          sx={(theme) => ({
                            position: 'absolute',
                            top: '-9px',
                            right: '-16px',
                            minWidth: 15,
                            height: 15,
                            px: '4px',
                            borderRadius: '999px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: activeTab === tab.key ? theme.palette.kanap.teal : theme.palette.kanap.pill.bg,
                            border: `1px solid ${activeTab === tab.key ? theme.palette.kanap.teal : theme.palette.kanap.pill.border}`,
                            color: activeTab === tab.key ? theme.palette.kanap.tealForeground : theme.palette.kanap.text.tertiary,
                            fontSize: 10,
                            fontWeight: 500,
                            lineHeight: 1,
                            pointerEvents: 'none',
                          })}
                        >
                          {tab.badge}
                        </Box>
                      )}
                    </Box>
                  )}
                  value={tab.key}
                  disabled={tab.disabled}
                  sx={(theme) => ({
                    position: 'relative',
                    overflow: 'visible',
                    minHeight: 'auto',
                    pt: 0,
                    px: 0,
                    pb: '9px',
                    mr: tab.badge != null ? '30px' : '24px',
                    textTransform: 'none',
                    minWidth: 'auto',
                    fontSize: '14px',
                    lineHeight: 1.35,
                    fontWeight: activeTab === tab.key ? 500 : 400,
                    color: activeTab === tab.key ? theme.palette.kanap.teal : theme.palette.kanap.text.secondary,
                    '&:hover': {
                      color: activeTab === tab.key ? theme.palette.kanap.teal : theme.palette.kanap.text.primary,
                    },
                    '&.Mui-disabled': {
                      color: theme.palette.kanap.text.tertiary,
                      opacity: 0.65,
                    },
                  })}
                />
              ))}
            </Tabs>
          )}
        </Box>
      </Box>

      {/* Desktop: the body fills the bounded page and the content column scrolls under a fixed
          header. Below md the properties panel stacks under the content, so the body takes its
          natural height and the app scroller scrolls the whole page instead of squeezing the
          content between the header and the panel. */}
      <Box
        sx={{
          flex: isMobile ? '1 0 auto' : 1,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          overflow: 'visible',
          position: 'relative',
          minHeight: 380,
        }}
      >
        <Box
          data-primary-scroll={isMobile ? undefined : ''}
          tabIndex={isMobile ? undefined : -1}
          sx={{
            flex: isMobile ? 'none' : 1,
            minWidth: 0,
            overflow: isMobile ? 'visible' : 'auto',
            outline: 'none',
            pt: '8px',
            pl: isCompact ? 2 : 3,
            pr: isCompact ? 2 : (isMobile || !hasProperties ? 3 : '29px'),
            pb: 3,
          }}
        >
          {children}
        </Box>

        {hasProperties && !isMobile && (
          <Box sx={{ width: 0, position: 'relative', alignSelf: 'stretch' }}>
            <Box
              component="button"
              type="button"
              onClick={() => {
                if (!forceDrawerOpen) setDrawerOpen((open) => !open);
              }}
              aria-label={effectiveDrawerOpen ? t('workspace.closeProperties') : t('workspace.openProperties')}
              aria-expanded={effectiveDrawerOpen}
              aria-disabled={forceDrawerOpen}
              tabIndex={forceDrawerOpen ? -1 : 0}
              sx={(theme) => ({
                position: 'absolute',
                top: -tabLift,
                right: 0,
                width: 26,
                height: 120,
                bgcolor: effectiveDrawerOpen ? theme.palette.kanap.tab.bgActive : theme.palette.kanap.tab.bg,
                border: `1px solid ${effectiveDrawerOpen ? theme.palette.kanap.tab.borderActive : theme.palette.kanap.tab.border}`,
                borderRight: 'none',
                borderRadius: '8px 0 0 8px',
                cursor: forceDrawerOpen ? 'default' : 'pointer',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: 0,
                transition: 'background-color 0.15s, border-color 0.15s',
                '&:hover': {
                  bgcolor: effectiveDrawerOpen || forceDrawerOpen ? theme.palette.kanap.tab.bgActive : theme.palette.kanap.tab.bgHover,
                },
              })}
            >
              <Box
                component="span"
                sx={(theme) => ({
                  writingMode: 'vertical-rl',
                  transform: 'rotate(180deg)',
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: 0,
                  color: effectiveDrawerOpen ? theme.palette.kanap.tab.fgActive : theme.palette.kanap.tab.fg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  pointerEvents: 'none',
                })}
              >
                {!forceDrawerOpen && (
                  <Box component="span" sx={{ fontSize: '14px', lineHeight: 1 }}>
                    {effectiveDrawerOpen ? <ChevronRightIcon sx={{ fontSize: 14 }} /> : <ChevronLeftIcon sx={{ fontSize: 14 }} />}
                  </Box>
                )}
                <span>{t('workspace.sidebarTitle')}</span>
              </Box>
            </Box>
          </Box>
        )}

        {hasProperties && effectiveDrawerOpen && (
          <Box
            component="aside"
            sx={(theme) => ({
              width: isMobile ? '100%' : taskDetailTokens.drawer.panelWidth,
              mt: isMobile ? 0 : `${-drawerLift}px`,
              height: isMobile ? 'auto' : `calc(100% + ${drawerLift}px)`,
              maxHeight: isMobile ? '60vh' : undefined,
              flexShrink: 0,
              borderTop: isMobile ? `1px solid ${theme.palette.kanap.border.default}` : undefined,
              borderLeft: isMobile ? undefined : `1px solid ${theme.palette.kanap.border.default}`,
              bgcolor: theme.palette.kanap.bg.drawer,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            })}
          >
            <Box sx={{ flex: 1, overflowY: 'auto', pt: '10px', pb: '14px' }}>
              {properties}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
