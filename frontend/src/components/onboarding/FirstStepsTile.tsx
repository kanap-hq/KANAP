import React from 'react';
import { Box, IconButton, Link, Tooltip, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import DashboardTile from '../../pages/workspace/tiles/DashboardTile';
import { onboardingApi, ONBOARDING_ANGLES, type OnboardingState } from './onboardingApi';
import api from '../../api';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { buildItemPath, formatItemRef } from '../../utils/item-ref';
import { STEP_PARAM, STEP_SCREENS, stepHref, type OpenedRecord, type StepLocationState } from './onboardingPaths';
import { useOnboarding, useOnboardingActions } from './useOnboarding';

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  minHeight: 32,
} as const;

type TopLine = { id: string; item_number: number | null; product_name: string | null };
type Application = { id: string; name: string | null };
type Opened = { path: string; record: string | null };

/**
 * Opens the record of a step (the largest budget line of the year, the first of the most critical
 * applications), named in the hint. Without a record, or when the list cannot be read, the step
 * opens the list.
 */
function useOpenRecord(stepKey: string, kind: OpenedRecord) {
  const navigate = useNavigate();
  const { defaultSort } = useBudgetColumns();
  return React.useCallback(async () => {
    const fallback = stepHref(stepKey) ?? '/';
    const find = async (): Promise<Opened | null> => {
      if (kind === 'topBudgetLine') {
        const year = new Date().getFullYear();
        const res = await api.get<{ items: TopLine[] }>('/budget-lines/summary', {
          params: { limit: 1, sort: defaultSort, years: [year - 1, year].join(',') },
        });
        const line = res.data.items?.[0];
        if (!line) return null;
        const ref = line.item_number != null ? formatItemRef('budget', line.item_number) : line.id;
        return {
          path: buildItemPath('budget', ref),
          record: [line.item_number != null ? ref : null, line.product_name].filter(Boolean).join(' '),
        };
      }
      const res = await api.get<{ items: Application[] }>('/applications', { params: { limit: 1, sort: 'criticality:DESC' } });
      const application = res.data.items?.[0];
      return application ? { path: buildItemPath('application', application.id), record: application.name } : null;
    };
    try {
      const opened = await find();
      if (!opened) { navigate(fallback); return; }
      const state: StepLocationState = { onboardingRecord: opened.record ?? undefined };
      navigate(`${opened.path}?${STEP_PARAM}=${encodeURIComponent(stepKey)}`, { state });
    } catch {
      navigate(fallback);
    }
  }, [defaultSort, kind, navigate, stepKey]);
}

function RecordStepLink({ stepKey, kind, children, sx }: { stepKey: string; kind: OpenedRecord; children: React.ReactNode; sx: object }) {
  const openRecord = useOpenRecord(stepKey, kind);
  return (
    <Link
      component="button"
      type="button"
      underline="hover"
      onClick={() => { void openRecord(); }}
      sx={{ ...sx, textAlign: 'left', font: 'inherit' }}
    >
      {children}
    </Link>
  );
}

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
      {STEP_SCREENS[stepKey]?.opensRecord ? (
        <RecordStepLink stepKey={stepKey} kind={STEP_SCREENS[stepKey].opensRecord!} sx={linkSx}>{content}</RecordStepLink>
      ) : (
        <Link component={RouterLink} to={href ?? '#'} underline="hover" sx={linkSx}>{content}</Link>
      )}
    </Box>
  );
}

function EndScreen({ state }: { state: OnboardingState }) {
  const { t } = useTranslation('common');
  const { choose } = useOnboardingActions();
  const { apply } = useOnboarding();
  // The steps of a path are the user's own: undoing the five starts the path again.
  const restart = useMutation({
    mutationFn: async () => {
      let next: OnboardingState = state;
      for (const step of state.steps.filter((candidate) => candidate.done_at)) {
        next = await onboardingApi.markUndone(step.key);
      }
      return next;
    },
    onSuccess: apply,
  });
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
