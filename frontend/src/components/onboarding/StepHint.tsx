import React from 'react';
import { Box, Button, Paper, Popper, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { STEP_PARAM, STEP_SCREENS, stepHintKey, type StepTarget } from './onboardingPaths';
import { useOnboarding, useOnboardingActions } from './useOnboarding';

/** `data-page-title`: the title of `PageHeader` and `ReportLayout`. */
const TITLE = ['main [data-page-title]', 'main .MuiTypography-h5', 'main h1, main h2, main h3, main h4, main h5'];

/** Candidates in order; while Plaid waits to be turned on, its acceptance box holds the composer's place. */
const TARGETS: Record<StepTarget, string[]> = {
  title: TITLE,
  composer: ['main textarea', 'main [data-plaid-composer]', ...TITLE],
};

function findTarget(target: StepTarget): HTMLElement | null {
  for (const selector of TARGETS[target]) {
    const found = document.querySelector<HTMLElement>(selector);
    if (found) return found;
  }
  return null;
}

/** The element of the screen, once the page has drawn it (lazy route, data). */
function useTargetElement(target: StepTarget | null): HTMLElement | null {
  const [element, setElement] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setElement(null);
    if (!target) return undefined;
    let tries = 0;
    const timer = window.setInterval(() => {
      const found = findTarget(target);
      tries += 1;
      if (found || tries > 40) {
        window.clearInterval(timer);
        setElement(found);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [target]);
  return element;
}

/** The target's box on screen, followed through scrolls and resizes. */
function useRect(element: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  React.useEffect(() => {
    if (!element) { setRect(null); return undefined; }
    const update = () => setRect(element.getBoundingClientRect());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [element]);
  return rect;
}

/**
 * The hint of a step opened from the first steps: the target of its screen is outlined and one
 * sentence says what to look at. On the example, opening the step marks it done; with your own
 * data, "Done" does. Closing it drops the step from the address.
 */
export default function StepHint() {
  const { t } = useTranslation('common');
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useOnboarding();
  const { markDone } = useOnboardingActions();

  const key = new URLSearchParams(location.search).get(STEP_PARAM);
  const step = key && state ? state.steps.find((candidate) => candidate.key === key) ?? null : null;
  const screen = step ? STEP_SCREENS[step.key] ?? null : null;
  const element = useTargetElement(screen?.target ?? null);
  const rect = useRect(element);
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

  return (
    <>
      {rect ? (
        <Box
          aria-hidden
          sx={(theme) => ({
            position: 'fixed',
            top: rect.top - 4,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 8,
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
        placement={screen.target === 'composer' ? 'top-start' : 'bottom-start'}
        modifiers={[{ name: 'offset', options: { offset: [0, 10] } }]}
        sx={(theme) => ({ zIndex: theme.zIndex.modal - 1 })}
      >
        <Paper
          role="dialog"
          aria-label={t(`onboarding.firstSteps.steps.${step.key}.title`)}
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
          <Typography variant="body2">{t(stepHintKey(step.key, state.angle))}</Typography>
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
