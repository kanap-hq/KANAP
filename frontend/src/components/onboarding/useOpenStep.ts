import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { BUDGET_COLUMNS_QUERY_KEY, resolveBudgetColumns } from '../../hooks/useBudgetColumns';
import { DEFAULT_BUDGET_COLUMNS, getBudgetColumns } from '../../services/budgetColumns';
import { buildItemPath, formatItemRef } from '../../utils/item-ref';
import type { OnboardingAngle } from './onboardingApi';
import { STEP_PARAM, stepScreen, type StepLocationState } from './onboardingPaths';

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
 * Opens the screen of a step with its hint. A step that opens a record opens it (the largest
 * budget line of the year, the application the server chooses to show: most critical, then the
 * richest record), named in the hint; without a record, or when the list cannot be read, it opens
 * the list.
 */
export function useOpenStep() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation(['ops']);
  return React.useCallback(async (stepKey: string, angle: OnboardingAngle | null) => {
    const screen = stepScreen(stepKey, angle);
    if (!screen) return;
    const fallback = `${screen.to}?${STEP_PARAM}=${encodeURIComponent(stepKey)}`;
    const kind = screen.opensRecord;
    if (!kind) { navigate(fallback); return; }
    const projectTab = screen.tab ?? 'summary';
    const find = async (): Promise<Opened | null> => {
      if (kind === 'topBudgetLine') {
        // The budget columns are read here only: the hint that opens steps shows on every page.
        const settings = await queryClient
          .fetchQuery({ queryKey: BUDGET_COLUMNS_QUERY_KEY, queryFn: getBudgetColumns, staleTime: 5 * 60 * 1000 })
          .catch(() => DEFAULT_BUDGET_COLUMNS);
        const { defaultSort } = resolveBudgetColumns(settings, t, true, null);
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
  }, [navigate, queryClient, t]);
}
