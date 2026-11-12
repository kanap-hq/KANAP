import React from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { readActiveStep, withinStepScreen, writeActiveStep, type ActiveStep } from './activeStep';
import { onboardingApi } from './onboardingApi';
import { STEP_PARAM, stepHintKey, stepScreen, stepTitleKey, type StepLocationState, type StepTarget } from './onboardingPaths';
import { ONBOARDING_QUERY_KEY, useOnboarding, useOnboardingActions } from './useOnboarding';
import { useOpenStep } from './useOpenStep';

/** While the hint waits for the object of its step, the state is read again this often. */
export const STEP_OBJECT_POLL_MS = 5000;

/** The hint's distance from the right and bottom edges of the window, in pixels. */
const CORNER = 16;

/** Space between the hint and the element of its step when it rises above it, outline included. */
const GAP = 12;

const overlaps = (a: { top: number; left: number; right: number; bottom: number }, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * The hint's distance from the bottom of the window: in its corner, or just above the element of
 * its step when that element lies under the corner (Plaid's composer at the foot of a conversation).
 */
function bottomOffset(target: DOMRect | null, bubble: { width: number; height: number }): number {
  if (!target) return CORNER;
  const corner = {
    right: window.innerWidth - CORNER,
    left: window.innerWidth - CORNER - bubble.width,
    bottom: window.innerHeight - CORNER,
    top: window.innerHeight - CORNER - bubble.height,
  };
  return overlaps(corner, target) ? Math.max(CORNER, window.innerHeight - target.top + GAP) : CORNER;
}

/** `data-page-title`: the title of `PageHeader` and `ReportLayout`. */
const TITLE = ['main [data-page-title]', 'main .MuiTypography-h5', 'main h1, main h2, main h3, main h4, main h5'];

type Candidate = string | ((exportLabel: string) => HTMLElement | null);

/** The list's Export button, found by its label. */
const exportButton = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('main button'))
  .find((button) => button.textContent?.trim() === label) ?? null;

/**
 * Candidates in order, the page title last. While Plaid waits to be turned on, its acceptance box
 * holds the composer's place; Export is shown to the list's administrators only.
 */
const TARGETS: Record<StepTarget, Candidate[]> = {
  title: TITLE,
  composer: ['main textarea', 'main [data-plaid-composer]', ...TITLE],
  tabs: ['main [role="tablist"]', ...TITLE],
  export: [exportButton, ...TITLE],
};

/**
 * Drawn on the page: in the document and not in a hidden part of it, such as the screen a route
 * change keeps hidden while the next one loads (jsdom has no `checkVisibility`).
 */
const isShown = (element: HTMLElement) => element.isConnected
  && (typeof element.checkVisibility !== 'function' || element.checkVisibility());

function findTarget(target: StepTarget, exportLabel: string): HTMLElement | null {
  for (const candidate of TARGETS[target]) {
    const found = typeof candidate === 'string'
      ? Array.from(document.querySelectorAll<HTMLElement>(candidate)).find(isShown)
      : candidate(exportLabel);
    if (found && isShown(found)) return found;
  }
  return null;
}

type Target = { element: HTMLElement | null; rect: DOMRect | null };

const NO_TARGET: Target = { element: null, rect: null };

const sameBox = (a: DOMRect | null, b: DOMRect | null) => (a === null || b === null
  ? a === b
  : a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/**
 * The element of the screen and its box, looked up on every tick while the hint is open: the
 * page draws it late (lazy route, data) and may replace it (Plaid's acceptance box gives way to
 * the composer once accepted, a screen changes under the hint). Without one, the hint shows no outline.
 */
function useTarget(target: StepTarget | null): Target {
  const { t } = useTranslation('common');
  const exportLabel = t('export.button');
  const [found, setFound] = React.useState<Target>(NO_TARGET);
  React.useEffect(() => {
    setFound(NO_TARGET);
    if (!target) return undefined;
    const look = () => {
      const element = findTarget(target, exportLabel);
      const rect = element ? element.getBoundingClientRect() : null;
      setFound((previous) => (previous.element === element && sameBox(previous.rect, rect)
        ? previous
        : { element, rect }));
    };
    look();
    const timer = window.setInterval(look, 150);
    window.addEventListener('resize', look);
    window.addEventListener('scroll', look, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', look);
      window.removeEventListener('scroll', look, true);
    };
  }, [exportLabel, target]);
  return found;
}

/**
 * The hint of a step opened from the first steps: the target of its screen is outlined and one
 * sentence says what to look at. On the example, opening the step marks it done; with your own
 * data, the object the step creates does, or "Done" for a step that creates none. It stays on
 * the step's screen and its records until it is closed (`activeStep.ts`); once the step is done,
 * it opens the next step, or the home page at the end of the path.
 */
export default function StepHint() {
  const { t, i18n } = useTranslation('common');
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useOnboarding();
  const { markDone } = useOnboardingActions();
  const openStep = useOpenStep();

  const paramKey = new URLSearchParams(location.search).get(STEP_PARAM);
  const [active, setActive] = React.useState<ActiveStep | null>(readActiveStep);
  // A step opened from the first steps becomes the open one.
  React.useEffect(() => {
    if (!paramKey) return;
    setActive((current) => {
      if (current?.key === paramKey) return current;
      const next = { key: paramKey };
      writeActiveStep(next);
      return next;
    });
  }, [paramKey]);
  const key = paramKey ?? active?.key ?? null;
  const found = key && state ? state.steps.find((candidate) => candidate.key === key) ?? null : null;
  const foundScreen = found && state ? stepScreen(found.key, state.angle) : null;
  // Without its key in the address, the hint shows on its screen and the pages below it only.
  const shown = !!foundScreen && (!!paramKey || withinStepScreen(location.pathname, foundScreen.to));
  const step = shown ? found : null;
  const screen = shown ? foundScreen : null;
  // A record opened from the list of a title step (its address goes below the list's): the hint
  // points at its tab row.
  const onRecord = screen?.target === 'title' && location.pathname.startsWith(`${screen.to}/`);
  const target = useTarget(screen ? (onRecord ? 'tabs' : screen.target) : null);
  // Between a screen change and the next look-up, the element may have left the page already.
  const rect = target.element && isShown(target.element) ? target.rect : null;
  const discover = state?.mode === 'example';

  // Measured once drawn: the hint's size decides whether the element of its step lies under it.
  const bubbleRef = React.useRef<HTMLDivElement>(null);
  const [bottom, setBottom] = React.useState(CORNER);
  React.useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const { width, height } = bubble.getBoundingClientRect();
    const next = bottomOffset(rect, { width, height });
    setBottom((previous) => (previous === next ? previous : next));
  });

  // The object of the step may be created in a dialog, with no change of address.
  const waiting = !!step && step.automatic && !step.done_at;
  useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: onboardingApi.get,
    enabled: waiting,
    refetchInterval: waiting ? STEP_OBJECT_POLL_MS : false,
  });

  const markedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!step || !discover || step.done_at || markedRef.current === step.key) return;
    markedRef.current = step.key;
    markDone.mutate(step.key);
  }, [discover, markDone, step]);

  const close = React.useCallback(() => {
    writeActiveStep(null);
    setActive(null);
    if (!paramKey) return;
    const params = new URLSearchParams(location.search);
    params.delete(STEP_PARAM);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [location.pathname, location.search, navigate, paramKey]);

  const finish = React.useCallback(() => {
    writeActiveStep(null);
    setActive(null);
    navigate('/');
  }, [navigate]);

  if (!step || !screen || !state) return null;
  // A record opened by its step is named in the hint, when the step has a sentence for it.
  const record = (location.state as StepLocationState | null)?.onboardingRecord;
  const recordKey = `onboarding.firstSteps.steps.${step.key}.hintRecord`;
  const hint = record && i18n.exists(`common:${recordKey}`)
    ? t(recordKey, { record })
    : t(stepHintKey(step.key, state.angle));

  return (
    <>
      {rect ? (
        <Box
          aria-hidden
          data-testid="step-hint-outline"
          // The box moves with the page: inline, so that each position does not add a style rule.
          style={{ top: rect.top - 4, left: rect.left - 6, width: rect.width + 12, height: rect.height + 8 }}
          sx={(theme) => ({
            position: 'fixed',
            borderRadius: '6px',
            outline: `2px solid ${theme.palette.primary.main}`,
            pointerEvents: 'none',
            zIndex: theme.zIndex.modal - 2,
          })}
        />
      ) : null}
      {/* In the bottom-right corner of the window, apart from what the step asks to use: on the
          element, the hint would cover it (filters, tabs, fields). No floating control sits in
          that corner. */}
      <Paper
        ref={bubbleRef}
        role="dialog"
        aria-label={t(stepTitleKey(step.key, state.angle))}
        style={{ bottom }}
        sx={(theme) => ({
          position: 'fixed',
          right: CORNER,
          zIndex: theme.zIndex.modal - 1,
          boxSizing: 'border-box',
          // Inside the window on a narrow screen.
          maxWidth: `min(360px, calc(100vw - ${2 * CORNER}px))`,
          p: 1.5,
          borderRadius: '8px',
          // Apart from the element it describes, the hint wears the same ring as its outline, which
          // also sets it off a card of the same tint in dark mode.
          border: `1px solid ${theme.palette.primary.main}`,
          // A raised surface: in dark mode the page background would swallow it.
          bgcolor: theme.palette.kanap.bg.composer,
          boxShadow: theme.shadows[3],
        })}
      >
        <Typography variant="body2">{hint}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, mt: 1.25 }}>
          {step.done_at && !discover ? (
            <CheckCircleIcon aria-hidden sx={{ fontSize: 18, color: 'success.main', mr: 'auto' }} />
          ) : null}
          {step.done_at ? (
            <>
              <Button variant="action" onClick={close}>{t('onboarding.firstSteps.gotIt')}</Button>
              {state.next_step ? (
                <Button variant="action-primary" onClick={() => { void openStep(state.next_step!, state.angle); }}>
                  {t('onboarding.firstSteps.nextStep')}
                </Button>
              ) : (
                <Button variant="action-primary" onClick={finish}>{t('onboarding.firstSteps.finish')}</Button>
              )}
            </>
          ) : discover || step.automatic ? (
            <Button variant="action" onClick={close}>{t('onboarding.firstSteps.gotIt')}</Button>
          ) : (
            <>
              <Button variant="action" onClick={close}>{t('onboarding.firstSteps.later')}</Button>
              <Button
                variant="action-primary"
                disabled={markDone.isPending}
                onClick={() => markDone.mutate(step.key)}
              >
                {t('onboarding.firstSteps.done')}
              </Button>
            </>
          )}
        </Box>
      </Paper>
    </>
  );
}
