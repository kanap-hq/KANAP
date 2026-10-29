import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';

const auth = vi.hoisted(() => ({ contributor: true }));
const api = vi.hoisted(() => ({
  get: vi.fn(async () => ({ data: [] })),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../../../api', () => ({ default: api }));
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) =>
      resource === 'portfolio_projects' && level === 'contributor' && auth.contributor,
  }),
}));
vi.mock('./PortfolioGantt', () => ({ PortfolioGantt: () => null }));

import RoadmapGenerator from './RoadmapGenerator';

const generated = {
  schedule: [{
    projectId: 'prj-1',
    projectName: 'Cheese track',
    status: 'planned',
    schedulingMode: 'independent',
    categoryId: null,
    sourceId: null,
    streamId: null,
    executionProgress: 0,
    priorityScore: 1,
    plannedStart: '2026-03-02',
    historicalStart: null,
    plannedEnd: '2026-04-10',
    durationWeeks: 6,
    remainingEffortDays: 10,
    blockerProjectIds: [],
    contributorLoads: [],
    activeWeekStarts: [],
  }],
  reservations: [{
    projectId: 'prj-2',
    projectName: 'Capacity hold',
    status: 'planned',
    schedulingMode: 'collaborative',
    categoryId: null,
    sourceId: null,
    streamId: null,
    executionProgress: 0,
    plannedStart: '2026-03-02',
    plannedEnd: '2026-04-10',
    reason: 'not_recalculated',
    contributorLoads: [],
  }],
  unschedulable: [],
  explanations: [],
  scenarioWarnings: [],
  impactSummary: null,
  bottlenecks: [],
  occupation: [],
  teamOccupation: [],
  roadmapEndDate: '2026-04-10',
  diagnostics: {
    modeLabel: 'test',
    runDurationMs: 1,
    candidateProjects: 1,
    scheduledProjects: 1,
    reservationProjects: 1,
    reservationByReason: { not_recalculated: 1, external_blocker: 0 },
    hiddenCapacityProjects: 0,
    frozenProjects: 0,
    unschedulableProjects: 0,
    sensitivityReruns: 0,
    sensitivityTruncated: false,
  },
};

function renderGenerator() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RoadmapGenerator onApplied={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('RoadmapGenerator', () => {
  afterEach(async () => {
    auth.contributor = true;
    await i18n.changeLanguage('en');
  });

  it('shows the context switch grace label in full above its field, not cut inside it', async () => {
    await i18n.loadNamespaces(['portfolio', 'common']);
    await i18n.changeLanguage('fr');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <RoadmapGenerator onApplied={vi.fn()} />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const label = await screen.findByText('Tolérance de changement de contexte');
    expect(label.closest('.MuiInputLabel-root, .MuiTextField-root')).toBeNull();
    expect(screen.getByRole('spinbutton', { name: 'Tolérance de changement de contexte' })).toHaveValue(1);
  });

  it('offers apply and the scheduling mode to a contributor', async () => {
    auth.contributor = true;
    api.post.mockResolvedValue({ data: generated });
    await i18n.loadNamespaces(['portfolio', 'common']);
    await i18n.changeLanguage('en');
    renderGenerator();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByRole('button', { name: 'Apply dates' })).toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: 'Scheduling' })).toHaveLength(2);
  });

  it('does not offer apply or the scheduling mode to a reader', async () => {
    auth.contributor = false;
    api.post.mockResolvedValue({ data: generated });
    await i18n.loadNamespaces(['portfolio', 'common']);
    await i18n.changeLanguage('en');
    renderGenerator();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByText('Cheese track')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply dates' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Scheduling' })).toBeNull();
    expect(screen.getByText('Independent')).toBeInTheDocument();
    expect(screen.getByText('Collaborative')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalledWith('/portfolio/projects/planning/roadmap/apply', expect.anything());
    expect(api.patch).not.toHaveBeenCalled();
  });
});
