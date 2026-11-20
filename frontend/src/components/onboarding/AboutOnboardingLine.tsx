import React from 'react';
import { Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import OnboardingChoiceDialog from './OnboardingChoiceDialog';
import { useOnboarding, useOnboardingActions, useRunningTrial } from './useOnboarding';

/**
 * The workspace's path in About: angle and mode, and "Change" for whoever may change them
 * (anyone while one is missing, an administrator afterwards). Shown during the trial, and later
 * once a path was chosen.
 *
 * The About window closes (`onNavigate`) as soon as a path is picked, even when a confirmation
 * follows: the path question lives in this line, so `onPathQuestion` tells the window to keep
 * its content mounted, out of sight, until the question is closed.
 */
export default function AboutOnboardingLine({ onNavigate, onPathQuestion }: {
  onNavigate?: () => void;
  onPathQuestion?: (open: boolean) => void;
}) {
  const { t } = useTranslation('common');
  const runningTrial = useRunningTrial();
  const { state, apply } = useOnboarding();
  const { undismiss } = useOnboardingActions();
  const [open, setOpenState] = React.useState(false);
  const setOpen = (next: boolean) => { setOpenState(next); onPathQuestion?.(next); };
  if (!state) return null;
  const answered = state.angle !== null || state.mode !== null;
  if (!answered && !runningTrial) return null;
  if (!answered && !state.can_choose) return null;

  const parts = answered
    ? [
      t(`onboarding.about.angles.${state.angle ?? 'none'}`),
      ...(state.mode ? [t(`onboarding.about.modes.${state.mode}`)] : []),
    ]
    : [t('onboarding.about.notChosen')];

  return (
    <Typography variant="body2">
      {t('onboarding.about.path', { path: parts.join(' · ') })}
      {state.can_choose ? (
        <>
          {' · '}
          <Link component="button" variant="body2" onClick={() => setOpen(true)} sx={{ verticalAlign: 'baseline' }}>
            {answered ? t('onboarding.about.change') : t('onboarding.about.choose')}
          </Link>
        </>
      ) : null}
      {state.dismissed_at && state.steps.length > 0 ? (
        <>
          {' · '}
          <Link component="button" variant="body2" onClick={() => undismiss.mutate()} disabled={undismiss.isPending} sx={{ verticalAlign: 'baseline' }}>
            {t('onboarding.firstSteps.showAgain')}
          </Link>
        </>
      ) : null}
      <OnboardingChoiceDialog
        open={open}
        state={state}
        onClose={() => setOpen(false)}
        onPicked={onNavigate}
        onChosen={(next) => { apply(next); setOpen(false); }}
      />
    </Typography>
  );
}
