import React from 'react';
import { Box, IconButton, Link, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { Link as RouterLink } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import DashboardTile from '../../pages/workspace/tiles/DashboardTile';
import { onboardingApi, ONBOARDING_ANGLES, type OnboardingAngle, type OnboardingState } from './onboardingApi';
import BookDiscoveryCallButton from '../BookDiscoveryCallButton';
import OnboardingChoiceDialog from './OnboardingChoiceDialog';
import { stepHref, stepScreen, stepTitleKey } from './onboardingPaths';
import { useOnboarding, useOnboardingActions } from './useOnboarding';
import { useOpenStep } from './useOpenStep';

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  minHeight: 32,
} as const;

function RecordStepLink({ stepKey, angle, children, sx }: { stepKey: string; angle: OnboardingAngle | null; children: React.ReactNode; sx: object }) {
  const openStep = useOpenStep();
  return (
    <Link
      component="button"
      type="button"
      underline="hover"
      onClick={() => { void openStep(stepKey, angle); }}
      sx={{ ...sx, textAlign: 'left', font: 'inherit' }}
    >
      {children}
    </Link>
  );
}

function StepRow({ stepKey, angle, done, next, busy, onToggle }: {
  stepKey: string;
  angle: OnboardingAngle | null;
  done: boolean;
  next: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('common');
  const screen = stepScreen(stepKey, angle);
  const href = stepHref(stepKey, angle);
  const label = t(stepTitleKey(stepKey, angle));
  const toggleLabel = done ? t('onboarding.firstSteps.markUndone') : t('onboarding.firstSteps.markDone');
  const linkSx = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    fontSize: 14,
    fontWeight: next ? 500 : 400,
    color: done ? 'text.secondary' : 'text.primary',
  };
  const content = (
    <>
      <Box component="span" sx={{ flex: 1, minWidth: 0 }}>{label}</Box>
      {next ? <ChevronRightIcon aria-hidden sx={{ fontSize: 18, color: 'text.secondary' }} /> : null}
    </>
  );
  return (
    <Box component="li" sx={rowSx}>
      <Tooltip title={toggleLabel}>
        <IconButton size="small" aria-label={`${toggleLabel}: ${label}`} onClick={onToggle} disabled={busy} sx={{ p: 0.5 }}>
          {done
            ? <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
            : <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />}
        </IconButton>
      </Tooltip>
      {screen?.opensRecord ? (
        <RecordStepLink stepKey={stepKey} angle={angle} sx={linkSx}>{content}</RecordStepLink>
      ) : (
        <Link component={RouterLink} to={href ?? '#'} underline="hover" sx={linkSx}>{content}</Link>
      )}
    </Box>
  );
}

/**
 * The steps of a path are the user's own: undoing the done ones starts the path again (with your
 * own data, a step whose object exists stays done).
 */
function useRestartPath(state: OnboardingState) {
  const { apply } = useOnboarding();
  return useMutation({
    mutationFn: async () => {
      let next: OnboardingState = state;
      for (const step of state.steps.filter((candidate) => candidate.done_at)) {
        next = await onboardingApi.markUndone(step.key);
      }
      return next;
    },
    onSuccess: apply,
  });
}

/**
 * The tile's menu: start the path again while a step done by hand can be undone, and change the
 * path for whoever may (`can_choose`: an administrator once the path is chosen). Absent when it
 * would be empty.
 */
function PathMenu({ state }: { state: OnboardingState }) {
  const { t } = useTranslation('common');
  const { apply } = useOnboarding();
  const restart = useRestartPath(state);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [choosing, setChoosing] = React.useState(false);
  const canRestart = state.steps.some((step) => step.done_at && !step.automatic);
  if (!canRestart && !state.can_choose) return null;
  const label = t('onboarding.firstSteps.pathMenu');
  return (
    <>
      <Tooltip title={label}>
        <IconButton size="small" aria-label={label} aria-haspopup="menu" onClick={(event) => setAnchor(event.currentTarget)}>
          <MoreVertIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {canRestart ? (
          <MenuItem onClick={() => { setAnchor(null); restart.mutate(); }} disabled={restart.isPending}>
            {t('onboarding.firstSteps.end.restart')}
          </MenuItem>
        ) : null}
        {state.can_choose ? (
          <MenuItem onClick={() => { setAnchor(null); setChoosing(true); }}>
            {t('onboarding.firstSteps.changePath')}
          </MenuItem>
        ) : null}
      </Menu>
      <OnboardingChoiceDialog
        open={choosing}
        state={state}
        onClose={() => setChoosing(false)}
        onChosen={(next) => { apply(next); setChoosing(false); }}
      />
    </>
  );
}

function EndScreen({ state }: { state: OnboardingState }) {
  const { t } = useTranslation('common');
  const { choose } = useOnboardingActions();
  const restart = useRestartPath(state);
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
      <Box>
        <Link component="button" variant="body2" onClick={() => restart.mutate()} disabled={restart.isPending}>
          {t('onboarding.firstSteps.end.restart')}
        </Link>
      </Box>
      <BookDiscoveryCallButton placement="last_step" sx={{ alignSelf: 'flex-start' }} />
    </Box>
  );
}

/** The tile shows while the user follows a path and has not hidden it. */
export function firstStepsShown(state: OnboardingState | undefined): boolean {
  return !!state && !state.dismissed_at && state.steps.some((step) => stepHref(step.key) !== null);
}

/**
 * The first home tile while the user follows a path: its five steps with their progress, each
 * opening its screen with a hint; the next one stands out. A step's mark toggles it. Its menu
 * starts the path again or changes it. When the five are done, the tile offers the two other
 * paths. Hidden by its close button (About shows it again).
 * Read again each time it shows: a step done by its object was done on another screen.
 */
export default function FirstStepsTile() {
  const { t } = useTranslation('common');
  const { state } = useOnboarding({ refetchOnMount: 'always' });
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
          <PathMenu state={state} />
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
              angle={state.angle}
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
