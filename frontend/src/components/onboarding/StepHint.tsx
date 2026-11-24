import React from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { readActiveStep, writeActiveStep, type ActiveStep } from './activeStep';
import { onboardingApi } from './onboardingApi';
import { STEP_ANGLE_PARAM, STEP_PARAM, stepHintKey, stepScreen, stepTitleKey, type StepLocationState } from './onboardingPaths';
import { ONBOARDING_QUERY_KEY, useOnboarding, useOnboardingActions } from './useOnboarding';
import { useOpenStep } from './useOpenStep';

/** While the hint waits for the object of its step, the state is read again this often. */
export const STEP_OBJECT_POLL_MS = 5000;

/** The hint's distance from the left and bottom edges of the window, in pixels. */
const CORNER = 16;

/**
 * Pixels the side menu keeps clear at its bottom while the hint is shown, so the last entry can
 * scroll fully above the hint. The hint's height changes with the step, so the room follows the
 * measured box plus the corner it sits off the window edge.
 */
export function stepHintScrollReserve(hintHeightPx: number): number {
  return Math.ceil(hintHeightPx) + CORNER;
}

/**
 * The hint of a step opened from the first steps: one sentence says what to look at. On the
 * example, opening the step marks it done; with your own data, the object the step creates does,
 * or "Done" for a step that creates none. It stays on every screen until it is closed
 * (`activeStep.ts`); once the step is done, it opens the next step, or the home page at the end of
 * the path.
 */
export default function StepHint({ onReserveChange }: {
  /** Room the side menu keeps at its bottom, in pixels. Zero when the hint is closed. */
  onReserveChange?: (reservePx: number) => void;
} = {}) {
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
  const screen = found && state ? stepScreen(found.key, state.angle) : null;
  // The hint stays on every screen until it is closed: a step leads out of its own address (from
  // the end of support to a technology and to the vulnerabilities, from a request to the project it
  // was converted into).
  const step = screen ? found : null;
  const discover = state?.mode === 'example';

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
    params.delete(STEP_ANGLE_PARAM);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [location.pathname, location.search, navigate, paramKey]);

  const finish = React.useCallback(() => {
    writeActiveStep(null);
    setActive(null);
    navigate('/');
  }, [navigate]);

  // A record opened by its step is named in the hint, when the step has a sentence for it.
  const record = step ? (location.state as StepLocationState | null)?.onboardingRecord : undefined;
  const recordKey = step ? `onboarding.firstSteps.steps.${step.key}.hintRecord` : '';
  const hint = step && state
    ? (record && i18n.exists(`common:${recordKey}`)
      ? t(recordKey, { record })
      : t(stepHintKey(step.key, state.angle)))
    : '';

  // The menu's spare room follows this box. Measured after layout, and again when the sentence
  // wraps or the buttons change. Nothing is reserved once the hint closes.
  const hintRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const node = hintRef.current;
    if (!node) {
      onReserveChange?.(0);
      return undefined;
    }
    const publish = () => {
      const current = hintRef.current;
      if (!current) return;
      onReserveChange?.(stepHintScrollReserve(current.getBoundingClientRect().height));
    };
    publish();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onReserveChange, hint, step?.key]);

  if (!step || !screen || !state) return null;

  return (
    // In the bottom-left corner of the window, where it stays: it never moves. An open drawer
    // and a modal dialog stand above it. The permanent side menu is one step lower.
    <Paper
      ref={hintRef}
      role="dialog"
      aria-label={t(stepTitleKey(step.key, state.angle))}
      sx={(theme) => ({
        position: 'fixed',
        left: CORNER,
        bottom: CORNER,
        // Under a temporary drawer (`theme.zIndex.drawer`) and a dialog (`modal`). Layout keeps
        // the permanent menu one step under this, so the hint stays in front of the menu.
        zIndex: theme.zIndex.drawer - 1,
        boxSizing: 'border-box',
        // Inside the window on a narrow screen.
        maxWidth: `min(360px, calc(100vw - ${2 * CORNER}px))`,
        p: 1.5,
        borderRadius: '8px',
        // The ring sets the hint off a card of the same tint in dark mode.
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
  );
}
