import '../../../i18n';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickLogTimeModal from './QuickLogTimeModal';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const levels: Record<string, string> = {};
const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
const auth = {
  profile: { id: 'user-1' },
  hasLevel: (resource: string, level: string) => (RANK[levels[resource]] ?? 0) >= RANK[level],
};
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth }));

const TASKS = [
  { id: 't-own', title: 'Write the test plan', related_object_type: 'project', related_object_id: 'p-own', related_object_name: 'ERP rollout' },
  { id: 't-other', title: 'Review the budget', related_object_type: 'project', related_object_id: 'p-other', related_object_name: 'Data centre move' },
  { id: 't-free', title: 'Clean the shared drive', related_object_type: null, related_object_id: null, related_object_name: null },
  { id: 't-opex', title: 'Renew the licence', related_object_type: 'spend_item', related_object_id: 's-1', related_object_name: 'Office licences' },
];

function mockApi() {
  (api.get as any).mockImplementation(async (url: string) => {
    if (url === '/portfolio/projects') return { data: { items: [{ id: 'p-own', name: 'ERP rollout' }] } };
    if (url === '/portfolio/projects/ids') return { data: { ids: ['p-own'], refs: ['PRJ-1'], total: 1 } };
    if (url === '/tasks') return { data: { items: TASKS } };
    throw new Error(`unexpected ${url}`);
  });
}

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <QuickLogTimeModal open onClose={() => {}} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function openSelect() {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  return screen.findByRole('listbox');
}

describe('QuickLogTimeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(levels)) delete levels[key];
    mockApi();
  });

  it('lists only the projects a contributor may log time on', async () => {
    levels.portfolio_projects = 'contributor';
    renderModal();

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/portfolio/projects', expect.anything()));
    expect((api.get as any).mock.calls[0][1].params.access).toBe('contributor');
    // No task choice without access to tasks
    expect(screen.queryByRole('button', { name: /task/i })).toBeNull();
    const listbox = await openSelect();
    expect(listbox.textContent).toContain('ERP rollout');
  });

  it('keeps the project tasks of writable projects and leaves out standalone tasks without tasks:member', async () => {
    levels.portfolio_projects = 'contributor';
    levels.tasks = 'reader';
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /task/i }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/portfolio/projects/ids', expect.anything()));
    const listbox = await openSelect();
    await waitFor(() => expect(listbox.textContent).toContain('Write the test plan'));
    expect(listbox.textContent).not.toContain('Review the budget');
    expect(listbox.textContent).not.toContain('Clean the shared drive');
    expect(listbox.textContent).not.toContain('Renew the licence');
  });

  it('offers only standalone tasks to a task member without project rights', async () => {
    levels.tasks = 'member';
    renderModal();

    expect(screen.queryByRole('button', { name: /project/i })).toBeNull();
    const listbox = await openSelect();
    await waitFor(() => expect(listbox.textContent).toContain('Clean the shared drive'));
    expect(listbox.textContent).not.toContain('Write the test plan');
    expect(api.get).not.toHaveBeenCalledWith('/portfolio/projects', expect.anything());
  });

  it('refuses part hours, as the server does', async () => {
    levels.portfolio_projects = 'contributor';
    renderModal();

    const listbox = await openSelect();
    fireEvent.click(await within(listbox).findByText('ERP rollout'));
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1.5' } });
    const logButtons = screen.getAllByRole('button', { name: /log time/i });
    fireEvent.click(logButtons[logButtons.length - 1]);

    expect(await screen.findByText(/valid hours/i)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});
