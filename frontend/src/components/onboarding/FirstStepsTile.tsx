import React from 'react';
import { Box, IconButton, Link, Tooltip, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import DashboardTile from '../../pages/workspace/tiles/DashboardTile';
import { ONBOARDING_ANGLES, type OnboardingState } from './onboardingApi';
import { stepHref } from './onboardingPaths';
import { useOnboarding, useOnboardingActions } from './useOnboarding';

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  minHeight: 32,
} as const;

function StepRow({ stepKey, done, next, busy, onToggle }: {
  stepKey: string;
  done: boolean;
  next: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('common');
  const href = stepHref(stepKey);
  const label = t(`onboarding.firstSteps.steps.${stepKey}.title`);
  const toggleLabel = done ? t('onboarding.firstSteps.markUndone') : t('onboarding.firstSteps.markDone');
  return (
    <Box component="li" sx={rowSx}>
      <Tooltip title={toggleLabel}>
        <IconButton size="small" aria-label={`${toggleLabel}: ${label}`} onClick={onToggle} disabled={busy} sx={{ p: 0.5 }}>
          {done
            ? <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
            : <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />}
        </IconButton>
      </Tooltip>
      <Link
        component={RouterLink}
        to={href ?? '#'}
        underline="hover"
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          fontSize: 14,
          fontWeight: next ? 500 : 400,
          color: done ? 'text.secondary' : 'text.primary',
        }}
      >
        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>{label}</Box>
        {next ? <ChevronRightIcon aria-hidden sx={{ fontSize: 18, color: 'text.secondary' }} /> : null}
      </Link>
    </Box>
  );
}

function EndScreen({ state }: { state: OnboardingState }) {
  const { t } = useTranslation('common');
  const { choose } = useOnboardingActions();
  const others = ONBOARDING_ANGLES.filter((angle) => angle !== state.angle);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t('onboarding.firstSteps.end.title', { path: t(`onboarding.about.angles.${state.angle ?? 'none'}`) })}
      </Typography>
      <Typography variant="body2">
        {t('onboarding.firstSteps.end.others')}{' '}
        {others.map((angle, index) => (
          <React.Fragment key={angle}>
            {index > 0 ? ', ' : null}
            {state.can_choose ? (
              <Link component="button" variant="body2" onClick={() => choose.mutate({ angle })} disabled={choose.isPending} sx={{ verticalAlign: 'baseline' }}>
                {t(`onboarding.about.angles.${angle}`)}
              </Link>
            ) : t(`onboarding.about.angles.${angle}`)}
          </React.Fragment>
        ))}
      </Typography>
    </Box>
  );
}

/** The tile shows while the user follows a path and has not hidden it. */
export function firstStepsShown(state: OnboardingState | undefined): boolean {
  return !!state && !state.dismissed_at && state.steps.some((step) => stepHref(step.key) !== null);
}

/**
 * The first home tile while the user follows a path: its five steps with their progress, each
 * opening its screen with a hint; the next one stands out. A step's mark toggles it. When the five
 * are done, the tile offers the two other paths. Hidden by its close button (About shows it again).
 */
export default function FirstStepsTile() {
  const { t } = useTranslation('common');
  const { state } = useOnboarding();
  const { markDone, markUndone, dismiss } = useOnboardingActions();
  if (!state || !firstStepsShown(state)) return null;

  const steps = state.steps.filter((step) => stepHref(step.key) !== null);
  const doneCount = steps.filter((step) => step.done_at).length;
  const busy = markDone.isPending || markUndone.isPending;

  return (
    <DashboardTile
      title={t('onboarding.firstSteps.title')}
      icon="Assignment"
      action={(
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {t('onboarding.firstSteps.progress', { done: doneCount, total: steps.length })}
          </Typography>
          <Tooltip title={t('onboarding.firstSteps.hide')}>
            <IconButton size="small" aria-label={t('onboarding.firstSteps.hide')} onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    >
      {state.completed ? <EndScreen state={state} /> : (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {steps.map((step) => (
            <StepRow
              key={step.key}
              stepKey={step.key}
              done={!!step.done_at}
              next={step.key === state.next_step}
              busy={busy}
              onToggle={() => (step.done_at ? markUndone : markDone).mutate(step.key)}
            />
          ))}
        </Box>
      )}
    </DashboardTile>
  );
}
