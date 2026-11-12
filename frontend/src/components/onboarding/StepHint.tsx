import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { readActiveStep, writeActiveStep, type ActiveStep } from './activeStep';
import { onboardingApi } from './onboardingApi';
import { STEP_PARAM, stepHintKey, stepScreen, stepTitleKey, type StepLocationState } from './onboardingPaths';
import { ONBOARDING_QUERY_KEY, useOnboarding, useOnboardingActions } from './useOnboarding';
import { useOpenStep } from './useOpenStep';

/** While the hint waits for the object of its step, the state is read again this often. */
export const STEP_OBJECT_POLL_MS = 5000;

/**
 * The hint of a step opened from the first steps: a bar at the foot of the main column, under the
 * page (`Layout`), so that it covers nothing at any width. One sentence says what to look at. On the
 * example, opening the step marks it done; with your own data, the object the step creates does,
 * or "Done" for a step that creates none. It stays on every screen until it is closed
 * (`activeStep.ts`); once the step is done, it opens the next step, or the home page at the end of
 * the path.
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
    // The last child of the main column, after the page scroller: the page stops above it and
    // scrolls as usual. A drawer or a dialog comes in front of it.
    <Box
      component="section"
      aria-label={t(stepTitleKey(step.key, state.angle))}
      sx={(theme) => ({
        flexShrink: 0,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 2,
        rowGap: 1,
        px: 2,
        py: 1,
        // A raised surface with a ring on top: it reads apart from the page in both modes.
        bgcolor: theme.palette.kanap.bg.composer,
        borderTop: `1px solid ${theme.palette.primary.main}`,
        displayPrint: 'none',
      })}
    >
      {/* On a narrow window the buttons go under the sentence, on the right. */}
      <Typography variant="body2" sx={{ flex: '1 1 320px', minWidth: 0 }}>{hint}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
        {step.done_at && !discover ? (
          <CheckCircleIcon aria-hidden sx={{ fontSize: 18, color: 'success.main' }} />
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
    </Box>
  );
}
