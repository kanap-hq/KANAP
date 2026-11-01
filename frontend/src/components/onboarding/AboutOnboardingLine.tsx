import React from 'react';
import { Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import OnboardingChoiceDialog from './OnboardingChoiceDialog';
import { useOnboarding, useRunningTrial } from './useOnboarding';

/**
 * The workspace's path in About: angle and mode, and "Change" for whoever may change them
 * (anyone while one is missing, an administrator afterwards). Shown during the trial, and later
 * once a path was chosen.
 */
export default function AboutOnboardingLine() {
  const { t } = useTranslation('common');
  const runningTrial = useRunningTrial();
  const { state, apply } = useOnboarding();
  const [open, setOpen] = React.useState(false);
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
      <OnboardingChoiceDialog
        open={open}
        state={state}
        onClose={() => setOpen(false)}
        onChosen={(next) => { apply(next); setOpen(false); }}
      />
    </Typography>
  );
}
