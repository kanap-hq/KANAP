import React from 'react';
import { useAuth } from '../../auth/AuthContext';
import OnboardingChoiceDialog from './OnboardingChoiceDialog';
import { useOnboarding, useRunningTrial } from './useOnboarding';

const laterKey = (userId: string) => `kanap.onboarding.later.${userId}`;

function readLater(userId: string): boolean {
  try {
    return localStorage.getItem(laterKey(userId)) === '1';
  } catch {
    return false;
  }
}

function writeLater(userId: string) {
  try {
    localStorage.setItem(laterKey(userId), '1');
  } catch {
    // Storage unavailable: the dialog may come back on the next load.
  }
}

/**
 * Opens the onboarding question by itself during the trial, while the workspace has no mode yet
 * and this user may answer (`can_choose`). Closing it keeps it closed for this user in this
 * browser; the question stays in About.
 */
export default function FirstOpenDialog() {
  const { profile } = useAuth();
  const runningTrial = useRunningTrial();
  const { state, apply } = useOnboarding();
  const userId = profile?.id ?? null;
  const [closedFor, setClosedFor] = React.useState<string | null>(null);

  const eligible = !!userId && runningTrial && !!state && state.can_choose && state.mode === null;
  if (!eligible || !state || closedFor === userId || readLater(userId as string)) return null;

  const close = () => {
    writeLater(userId as string);
    setClosedFor(userId);
  };

  return (
    <OnboardingChoiceDialog
      open
      state={state}
      onClose={close}
      onChosen={(next) => { apply(next); setClosedFor(userId); }}
    />
  );
}
