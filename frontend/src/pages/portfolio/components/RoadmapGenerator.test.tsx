import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('links each project it names to its effort tab by its reference, by its uuid without one', async () => {
    api.post.mockResolvedValue({ data: { ...generated, projectItemNumbers: { 'prj-1': 5 } } });
    await i18n.loadNamespaces(['portfolio', 'common']);
    await i18n.changeLanguage('en');
    renderGenerator();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const scheduled = await screen.findAllByRole('link', { name: 'Cheese track' });
    expect(scheduled.map((link) => link.getAttribute('href'))).toEqual(scheduled.map(() => '/portfolio/projects/PRJ-5/effort'));
    const held = screen.getAllByRole('link', { name: 'Capacity hold' });
    expect(held.map((link) => link.getAttribute('href'))).toEqual(held.map(() => '/portfolio/projects/prj-2/effort'));
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

  // The schedule row the generator shows. Its id is a uuid so a case-only difference is meaningful.
  const shownProjectId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  function generatedFor(projectId: string) {
    return {
      ...generated,
      schedule: [{ ...generated.schedule[0], projectId }],
    };
  }

  function applyRefusal(details: Array<{ projectId?: string; error?: string }>) {
    const error = new Error('Request failed with status code 400') as Error & { response?: unknown };
    error.response = { status: 400, data: { details } };
    return error;
  }

  async function generateAndConfirmApply(
    projectId: string,
    onApply: () => Promise<unknown>,
  ) {
    api.post.mockImplementation(async (url: string) => {
      if (url === '/portfolio/projects/planning/roadmap/apply') return onApply();
      return { data: generatedFor(projectId) };
    });
    await i18n.loadNamespaces(['portfolio', 'common']);
    await i18n.changeLanguage('en');
    renderGenerator();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const openApply = await screen.findByRole('button', { name: 'Apply dates' });
    expect(openApply).toBeEnabled();
    fireEvent.click(openApply);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply dates' }));
  }

  async function alertText() {
    const alert = await screen.findByRole('alert', { hidden: true });
    return (alert.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  it('applies the selected dates and confirms how many projects changed', async () => {
    await generateAndConfirmApply(shownProjectId, async () => ({ data: { updated: 1 } }));
    expect(await screen.findByText('Applied roadmap dates to 1 project.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/portfolio/projects/planning/roadmap/apply', {
      projects: [{
        projectId: shownProjectId,
        plannedStart: '2026-03-02',
        plannedEnd: '2026-04-10',
      }],
    });
  });

  it('names a refused project by the name the generator shows', async () => {
    await generateAndConfirmApply(shownProjectId, async () => {
      throw applyRefusal([{ projectId: shownProjectId.toUpperCase(), error: 'Dates overlap a freeze' }]);
    });
    const text = await alertText();
    expect(text).toBe('Cheese track: Dates overlap a freeze');
    expect(text.toLowerCase()).not.toContain(shownProjectId);
  });

  it('shows the server error alone when the refusal is the whole request', async () => {
    await generateAndConfirmApply(shownProjectId, async () => {
      throw applyRefusal([{ projectId: 'request', error: 'Duplicate projectId' }]);
    });
    const text = await alertText();
    expect(text).toBe('Duplicate projectId');
    expect(text).not.toMatch(/request/i);
    expect(text).not.toMatch(/Project:/);
  });

  it('shows the server error alone when the refusal names an id the generator does not show', async () => {
    const unknownId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    await generateAndConfirmApply(shownProjectId, async () => {
      throw applyRefusal([{ projectId: unknownId, error: 'Outside the plan' }]);
    });
    const text = await alertText();
    expect(text).toBe('Outside the plan');
    expect(text).not.toContain(unknownId);
    expect(text).not.toMatch(/Project:/);
    expect(text).not.toContain('Cheese track');
  });

  it('shows the generic apply failure when a request refusal carries no error', async () => {
    await generateAndConfirmApply(shownProjectId, async () => {
      throw applyRefusal([{ projectId: 'request' }]);
    });
    const text = await alertText();
    expect(text).toBe('Failed to apply roadmap dates');
    expect(text).not.toMatch(/request/i);
    expect(text).not.toMatch(/Project:/);
  });
});
