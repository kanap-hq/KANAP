import React from 'react';
import {
  Box,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useTranslation } from 'react-i18next';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import EditableTitle from '../../../components/workspace/EditableTitle';
import RecordHistoryButton from '../../../components/history/RecordHistoryButton';
import { taskDetailTokens, taskDetailTypography } from '../../tasks/theme/taskDetailTokens';
import WorkspaceTabs, { type WorkspaceTab } from './WorkspaceTabs';

export type PortfolioDetailWorkspaceTab = WorkspaceTab;

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
  /** The record's history: a History button beside the title opens it in a right panel. */
  history?: { table: string; recordId: string };
  itemReference?: string | null;
  metadata?: React.ReactNode;
  /** Banners under the title row (a failed create, a load or save error), so the header stays where it is. */
  notices?: React.ReactNode;
  nav?: PortfolioDetailWorkspaceNav;
  onBack: () => void;
  /** The person may read the record but not change it: a discreet "Read only" mention next to the title. */
  readOnly?: boolean;
  onCopyReference?: () => void;
  onSaveShortcut?: () => void;
  onTabChange: (nextTab: string) => void;
  onTitleSave?: (nextTitle: string) => void;
  /** Fired on each keystroke in the title, so the page can drop a refusal the draft has answered. */
  onTitleDraftChange?: (draft: string) => void;
  /** The longest title the record accepts (the input stops there). */
  titleMaxLength?: number;
  /** Omitted (e.g. on a create page), the shell draws no Properties tab and no drawer. */
  properties?: React.ReactNode;
  tabs: PortfolioDetailWorkspaceTab[];
  title: string;
  /** Shown under the title field when it is validated empty; the field then stays in edit. Absent: an empty title just reverts. */
  titleRequiredMessage?: string;
  /** A refusal of the last title save (a name another record has), shown under the click-to-edit title. */
  titleError?: string | null;
  /** Replaces the click-to-edit title, for a title made of several fields (a contact's first and last name). */
  titleEditor?: React.ReactNode;
  titleFallback: string;
};

/** The width the title keeps beside the actions; below it, the actions wrap under the title. */
const TITLE_MIN_WIDTH = 280;

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

/** What handles its own Escape or keeps the keyboard: fields, lists, menus, dialogs. */
const WIDGET_SELECTOR = [
  'input', 'textarea', 'select', '[contenteditable="true"]',
  '[role="dialog"]', '[role="listbox"]', '[role="combobox"]', '[role="menu"]', '[role="option"]', '[role="menuitem"]',
  '.MuiPopover-root', '.MuiPopper-root', '.MuiModal-root',
].join(',');
/** After a use of such a widget, a body focus is the widget closing, not a person pressing Escape on the page. */
const WIDGET_SETTLE_MS = 1000;

/** An open menu, list, popover or dialog (tooltips and kept-mounted hidden modals aside). */
const OPEN_OVERLAY_SELECTOR = [
  '.MuiPopover-root:not(.MuiModal-hidden)', '.MuiModal-root:not(.MuiModal-hidden)',
  '.MuiPopper-root:not(.MuiTooltip-popper)', '[role="dialog"]', '[role="listbox"]', '[role="menu"]',
].join(',');

function isInsideWidget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest(WIDGET_SELECTOR);
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function NavChip({ nav }: { nav: PortfolioDetailWorkspaceNav }) {
  const { t } = useTranslation('common');
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
        {t('labels.positionOf', { index: nav.currentIndex, total: nav.totalCount })}
      </Box>
      <IconButton onClick={nav.onNext} disabled={!nav.hasNext} aria-label={nav.nextLabel} sx={navButtonSx} size="small">
        <ChevronRightIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
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
  history,
  itemReference,
  metadata,
  notices,
  nav,
  onBack,
  readOnly = false,
  onCopyReference,
  onSaveShortcut,
  onTabChange,
  onTitleSave,
  onTitleDraftChange,
  titleMaxLength,
  titleRequiredMessage,
  properties,
  tabs,
  title,
  titleEditor,
  titleError,
  titleFallback,
}: PortfolioDetailWorkspaceShellProps) {
  const theme = useTheme();
  const { t } = useTranslation(['portfolio', 'admin']);
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

  // The last time a field, list, menu or dialog was used (pointer, key or focus leaving it).
  const lastWidgetUse = React.useRef(0);
  // Whether a menu, list or dialog was open when Escape was pressed. Read in the capture phase,
  // before the widget closes itself on that same press.
  const overlayOpenAtEscape = React.useRef(false);
  React.useEffect(() => {
    const mark = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        overlayOpenAtEscape.current = !!document.querySelector(OPEN_OVERLAY_SELECTOR);
      }
      if (isInsideWidget(event.target)) lastWidgetUse.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'focusout'] as const;
    events.forEach((name) => window.addEventListener(name, mark, true));
    return () => events.forEach((name) => window.removeEventListener(name, mark, true));
  }, []);

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

      // Escape belongs to the field, list, menu or dialog it comes from, to one still open, and to
      // the one that has just closed (the focus is then on the page body): it leaves the page only
      // on a plain press.
      if (event.key === 'Escape') {
        if (event.defaultPrevented || isInsideWidget(event.target) || overlayOpenAtEscape.current) return;
        const active = document.activeElement;
        if ((!active || active === document.body) && Date.now() - lastWidgetUse.current < WIDGET_SETTLE_MS) return;
      }

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
    <Box sx={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flexShrink: 0, minWidth: 0 }}>
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
              aria-label={backLabel}
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
          {/* The actions sit beside the title while the title keeps TITLE_MIN_WIDTH, and wrap under
              it otherwise. The row's own width decides, not the window's: the side navigation
              and the page padding take their share before it. */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              columnGap: taskDetailTokens.titleRow.gap,
              rowGap: taskDetailTokens.titleStack.gap,
              mb: hasTabRow ? (metadata ? taskDetailTokens.titleStack.metadataToTabsGap : taskDetailTokens.titleRow.mb) : 0,
            }}
          >
            <Box sx={{ flex: `1 1 ${TITLE_MIN_WIDTH}px`, minWidth: 0, display: 'flex', flexDirection: 'column', gap: taskDetailTokens.titleStack.gap }}>
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
                <Box sx={{ flex: 1, minWidth: isCompact ? '100%' : 0, overflowWrap: 'anywhere' }}>
                  {titleEditor ?? (
                    <>
                      <EditableTitle
                        value={title}
                        fallback={titleFallback}
                        canEdit={canEditTitle}
                        maxLength={titleMaxLength}
                        onSave={onTitleSave}
                        onDraftChange={onTitleDraftChange}
                        requiredMessage={titleRequiredMessage}
                        error={titleError}
                      />
                    </>
                  )}
                </Box>
                {readOnly && (
                  <Box
                    component="span"
                    sx={(theme) => ({ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0, fontSize: 12, color: theme.palette.kanap.text.tertiary })}
                  >
                    <LockOutlinedIcon sx={{ fontSize: 13 }} />
                    {t('common:labels.readOnly')}
                  </Box>
                )}
              </Box>

              {metadata && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: taskDetailTokens.metadataBar.gap, flexWrap: 'wrap', fontSize: '12px' }}>
                  {metadata}
                </Box>
              )}
            </Box>

            {(actions || history) && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: taskDetailTokens.actionPills.gap,
                  flexShrink: 0,
                  maxWidth: '100%',
                  mt: isCompact ? 0 : '7px',
                  flexWrap: 'wrap',
                }}
              >
                {/* The history sits left of the page's own actions (the delete pill comes last). */}
                {history && <RecordHistoryButton table={history.table} recordId={history.recordId} />}
                {actions}
              </Box>
            )}
          </Box>

          {notices ? (
            <Box
              data-testid="workspace-notices"
              sx={{
                display: 'flex',
                flexDirection: 'column',
                // The conflict banner keeps a hidden live region mounted. It is out of flow, so the
                // slot stays flat until a visible notice arrives. The title row's own margin already
                // separates it from the tabs; without a tab row the first notice opens that gap.
                '& > :not([aria-live])': {
                  mt: hasTabRow ? 0 : '12px',
                  mb: '12px',
                },
                '& > :not([aria-live]) + :not([aria-live])': {
                  mt: '12px',
                },
              }}
            >
              {notices}
            </Box>
          ) : null}

          {hasTabRow && (
            <WorkspaceTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
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
          minWidth: 0,
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
