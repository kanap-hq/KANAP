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
import { onboardingApi, ONBOARDING_ANGLES, type OnboardingAngle, type OnboardingState } from './onboardingApi';
import api from '../../api';
import BookDiscoveryCallButton from '../BookDiscoveryCallButton';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { buildItemPath, formatItemRef } from '../../utils/item-ref';
import { STEP_PARAM, stepHref, stepScreen, stepTitleKey, type StepLocationState, type StepScreen } from './onboardingPaths';
import { useOnboarding, useOnboardingActions } from './useOnboarding';

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  minHeight: 32,
} as const;

type TopLine = { id: string; item_number: number | null; product_name: string | null };
type Application = { id: string; name: string | null };
type PortfolioItem = { id: string; item_number: number | null; name: string | null };

const portfolioRef = (type: 'request' | 'project', item: PortfolioItem) =>
  (item.item_number != null ? formatItemRef(type, item.item_number) : item.id);

/** The first of a portfolio list by priority score, with optional list filters. */
async function topScored(path: string, filters?: Record<string, unknown>): Promise<PortfolioItem | null> {
  const res = await api.get<{ items: PortfolioItem[] }>(path, {
    params: { limit: 1, sort: 'priority_score:DESC', ...(filters ? { filters: JSON.stringify(filters) } : {}) },
  });
  return res.data.items?.[0] ?? null;
}
type Opened = { path: string; record: string | null };

/**
 * Opens the record of a step (the largest budget line of the year, the application the server
 * chooses to show: most critical, then the richest record), named in the hint. Without a record,
 * or when the list cannot be read, the step opens the list.
 */
function useOpenRecord(stepKey: string, screen: StepScreen) {
  const navigate = useNavigate();
  const { defaultSort } = useBudgetColumns();
  const kind = screen.opensRecord;
  const projectTab = screen.tab ?? 'summary';
  return React.useCallback(async () => {
    const fallback = `${screen.to}?${STEP_PARAM}=${encodeURIComponent(stepKey)}`;
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
      if (kind === 'topScoredRequest') {
        const request = await topScored('/portfolio/requests');
        return request ? { path: `${buildItemPath('request', portfolioRef('request', request))}/scoring`, record: request.name } : null;
      }
      if (kind === 'projectFromRequest') {
        // The project of the best-scored converted request, else the best-scored project.
        const request = await topScored('/portfolio/requests', { status: { filterType: 'set', values: ['converted'] } });
        if (request) {
          const relations = await api.get<{ resulting_projects?: PortfolioItem[] }>(`/portfolio/requests/${request.id}/relations`);
          const project = relations.data.resulting_projects?.[0];
          if (project) return { path: `${buildItemPath('project', portfolioRef('project', project))}/${projectTab}`, record: project.name };
        }
        const project = await topScored('/portfolio/projects');
        return project ? { path: `${buildItemPath('project', portfolioRef('project', project))}/${projectTab}`, record: project.name } : null;
      }
      const res = await api.get<{ item: Application | null }>('/onboarding/showcase-application');
      const application = res.data.item;
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
  }, [defaultSort, kind, navigate, projectTab, screen.to, stepKey]);
}

function RecordStepLink({ stepKey, screen, children, sx }: { stepKey: string; screen: StepScreen; children: React.ReactNode; sx: object }) {
  const openRecord = useOpenRecord(stepKey, screen);
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
        <RecordStepLink stepKey={stepKey} screen={screen} sx={linkSx}>{content}</RecordStepLink>
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
  // The steps of a path are the user's own: undoing the five starts the path again (with your own
  // data, a step whose object exists stays done).
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
 * opening its screen with a hint; the next one stands out. A step's mark toggles it. When the five
 * are done, the tile offers the two other paths. Hidden by its close button (About shows it again).
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
