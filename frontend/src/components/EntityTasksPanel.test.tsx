import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import i18n from '../i18n';
import { formatShortDate } from '../lib/dateFormat';
import EntityTasksPanel from './EntityTasksPanel';
import EntityTasksSection from './EntityTasksSection';

const auth = vi.hoisted(() => ({ tasksMember: false, tasksAdmin: false }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => resource === 'tasks' && (
      (level === 'member' && auth.tasksMember) || (level === 'admin' && auth.tasksAdmin)
    ),
  }),
}));

const get = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

vi.mock('./design', () => ({
  StatusDot: () => null,
  useKanapDialogs: () => ({ confirm: vi.fn(async () => true), alert: vi.fn() }),
}));

const TASK = {
  id: 'task-1',
  item_number: 4,
  title: 'Relire le contrat',
  description: null,
  status: 'open',
  due_date: null,
  start_date: null,
  priority_level: 'normal',
  assignee_user_id: null,
  phase_id: null,
};

function renderPanel(overrides: { due_date?: string | null } = {}) {
  get.mockResolvedValue({ data: [{ ...TASK, ...overrides }] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <EntityTasksPanel entityType="contract" entityId="contract-1" />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('EntityTasksPanel task creation', () => {
  beforeEach(async () => {
    get.mockReset();
    auth.tasksMember = false;
    auth.tasksAdmin = false;
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('fr');
  });

  it('lists the tasks without offering to create one without the tasks member right', async () => {
    auth.tasksMember = false;
    renderPanel();

    expect(await screen.findByText('Relire le contrat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
  });

  it('offers to create a task with the tasks member right', async () => {
    auth.tasksMember = true;
    renderPanel();

    expect(await screen.findByText('Relire le contrat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add task' })).toBeInTheDocument();
  });

  it('hides task deletion without the tasks admin right', async () => {
    auth.tasksMember = true;
    auth.tasksAdmin = false;
    renderPanel();

    expect(await screen.findByText('Relire le contrat')).toBeInTheDocument();
    expect(screen.queryByTitle('Delete task')).toBeNull();
  });

  it('offers task deletion with the tasks admin right', async () => {
    auth.tasksMember = true;
    auth.tasksAdmin = true;
    renderPanel();

    expect(await screen.findByText('Relire le contrat')).toBeInTheDocument();
    expect(screen.getByTitle('Delete task')).toBeInTheDocument();
  });

  it('renders a due date in the short French format', async () => {
    await i18n.changeLanguage('fr');
    const dueDate = '2026-04-30';
    renderPanel({ due_date: dueDate });

    const frenchDate = formatShortDate(dueDate, 'fr', { empty: '-' });
    expect(frenchDate).toMatch(/avr/i);
    expect(await screen.findByText(frenchDate)).toBeInTheDocument();
    expect(screen.queryByText('4/30/2026')).toBeNull();
  });

  it('opens a task by its reference', async () => {
    get.mockResolvedValue({ data: [TASK] });
    function Location() {
      const location = useLocation();
      return <div data-testid="location">{location.pathname}</div>;
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={['/ops/contracts/contract-1/overview']}>
            <Location />
            <Routes>
              <Route path="/ops/contracts/:id/:tab" element={<EntityTasksPanel entityType="contract" entityId="contract-1" />} />
              <Route path="/portfolio/tasks/:id" element={null} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText('Relire le contrat'));
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/tasks/T-4');
  });
});

describe('the address of a task opened from its record', () => {
  function LocationWithSearch() {
    const location = useLocation();
    return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
  }

  function renderAt(path: string, route: string, element: React.ReactElement) {
    get.mockResolvedValue({ data: [TASK] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[path]}>
            <LocationWithSearch />
            <Routes>
              <Route path={route} element={element} />
              <Route path="/portfolio/tasks/:id/:tab" element={null} />
              <Route path="/portfolio/tasks/:id" element={null} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  }

  beforeEach(async () => {
    get.mockReset();
    auth.tasksMember = true;
    auth.tasksAdmin = false;
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('fr');
  });

  it.each([
    ['project', 'project-uuid', 'PRJ-3', '/portfolio/projects/PRJ-3/tasks', '/portfolio/projects/:id/:tab', '/portfolio/projects/project-uuid/tasks', 'projectId=PRJ-3&projectTab=tasks'],
    ['incident', 'incident-uuid', 'INC-3', '/it/incidents/INC-3/relations', '/it/incidents/:id/:tab', '/incidents/incident-uuid/tasks', 'incidentId=INC-3&originTab=relations'],
    ['spend_item', 'line-uuid', 'BL-8', '/ops/budget/BL-8/overview', '/ops/budget/:ref/:tab', '/spend-items/line-uuid/tasks', 'spendItemId=BL-8&originTab=overview'],
    ['capex_item', 'line-uuid', 'BL-8', '/ops/budget/BL-8/overview', '/ops/budget/:ref/:tab', '/capex-items/line-uuid/tasks', 'capexItemId=BL-8&originTab=overview'],
  ] as const)('names the %s by its reference, and reads its tasks by its uuid', async (type, id, reference, path, route, endpoint, query) => {
    renderAt(path, route, <EntityTasksPanel entityType={type} entityId={id} entityAddress={reference} />);
    fireEvent.click(await screen.findByText('Relire le contrat'));
    expect(screen.getByTestId('location')).toHaveTextContent(`/portfolio/tasks/T-4?${query}`);
    expect(get).toHaveBeenCalledWith(endpoint);
  });

  it('names the contract by its reference from its overview, opening a task or creating one', async () => {
    renderAt('/ops/contracts/CTR-2/overview', '/ops/contracts/:id/:tab', <EntityTasksSection entityType="contract" entityId="contract-uuid" entityAddress="CTR-2" />);
    fireEvent.click(await screen.findByText('Relire le contrat'));
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/tasks/T-4?contractId=CTR-2&originTab=overview');
    expect(get).toHaveBeenCalledWith('/contracts/contract-uuid/tasks');
  });

  it('creates a task with the record named by its reference', async () => {
    renderAt('/ops/contracts/CTR-2/overview', '/ops/contracts/:id/:tab', <EntityTasksSection entityType="contract" entityId="contract-uuid" entityAddress="CTR-2" />);
    await screen.findByText('Relire le contrat');
    fireEvent.click(screen.getAllByRole('button', { name: /new task|add task/i })[0]);
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/tasks/new/overview?contractId=CTR-2&originTab=overview');
  });

  it('keeps the uuid of a record without a reference', async () => {
    renderAt('/ops/contracts/contract-uuid/overview', '/ops/contracts/:id/:tab', <EntityTasksPanel entityType="contract" entityId="contract-uuid" />);
    fireEvent.click(await screen.findByText('Relire le contrat'));
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/tasks/T-4?contractId=contract-uuid&originTab=overview');
  });
});
