import React from 'react';
import { Box, Button, Paper, Popper, Typography } from '@mui/material';
import type { Instance as PopperInstance } from '@popperjs/core';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { STEP_PARAM, stepHintKey, stepScreen, stepTitleKey, type StepLocationState, type StepTarget } from './onboardingPaths';
import { useOnboarding, useOnboardingActions } from './useOnboarding';

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

function findTarget(target: StepTarget, exportLabel: string): HTMLElement | null {
  for (const candidate of TARGETS[target]) {
    const found = typeof candidate === 'string'
      ? document.querySelector<HTMLElement>(candidate)
      : candidate(exportLabel);
    if (found) return found;
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
 * the composer once accepted, a screen changes under the hint). The hint hides while there is none.
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
 * data, "Done" does. Closing it drops the step from the address.
 */
export default function StepHint() {
  const { t, i18n } = useTranslation('common');
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useOnboarding();
  const { markDone } = useOnboardingActions();

  const key = new URLSearchParams(location.search).get(STEP_PARAM);
  const step = key && state ? state.steps.find((candidate) => candidate.key === key) ?? null : null;
  const screen = step && state ? stepScreen(step.key, state.angle) : null;
  const { element, rect } = useTarget(screen?.target ?? null);
  const popperRef = React.useRef<PopperInstance | null>(null);
  // The bubble follows its element when the page moves it without a scroll or a resize.
  React.useEffect(() => { void popperRef.current?.update(); }, [rect]);
  const discover = state?.mode === 'example';

  const markedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!step || !discover || step.done_at || markedRef.current === step.key) return;
    markedRef.current = step.key;
    markDone.mutate(step.key);
  }, [discover, markDone, step]);

  const close = React.useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.delete(STEP_PARAM);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [location.pathname, location.search, navigate]);

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
      <Popper
        open={!!element}
        anchorEl={element}
        popperRef={popperRef}
        placement={screen.target === 'composer' ? 'top-start' : 'bottom-start'}
        modifiers={[{ name: 'offset', options: { offset: [0, 10] } }]}
        sx={(theme) => ({ zIndex: theme.zIndex.modal - 1 })}
      >
        <Paper
          role="dialog"
          aria-label={t(stepTitleKey(step.key, state.angle))}
          sx={(theme) => ({
            maxWidth: 360,
            p: 1.5,
            borderRadius: '8px',
            border: `1px solid ${theme.palette.kanap.border.default}`,
            // A raised surface: in dark mode the page background would swallow it.
            bgcolor: theme.palette.kanap.bg.composer,
            boxShadow: theme.palette.mode === 'dark' ? 'none' : '0 4px 16px rgba(15, 17, 23, 0.08)',
          })}
        >
          <Typography variant="body2">{hint}</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1.25 }}>
            {discover || step.done_at ? (
              <Button variant="action" onClick={close}>{t('onboarding.firstSteps.gotIt')}</Button>
            ) : (
              <>
                <Button variant="action" onClick={close}>{t('onboarding.firstSteps.later')}</Button>
                <Button
                  variant="action-primary"
                  disabled={markDone.isPending}
                  onClick={() => markDone.mutate(step.key, { onSuccess: close })}
                >
                  {t('onboarding.firstSteps.done')}
                </Button>
              </>
            )}
          </Box>
        </Paper>
      </Popper>
    </>
  );
}
