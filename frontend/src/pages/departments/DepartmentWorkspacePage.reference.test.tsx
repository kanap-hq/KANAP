import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

// The department page opens by its reference (`DEPT-5`, lot R2 of 26.11.9): a legacy address moves
// to it without a second read, a save shows on the page at that address, the neighbours open by theirs.

const stableT = vi.hoisted(() => (key: string) => key);
const navArgs = vi.hoisted(() => ({ ids: [] as Array<string | undefined> }));
const addToRecent = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' }, dataAccess: null }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useDepartmentNav', () => ({
  useDepartmentNav: ({ id }: { id?: string }) => {
    navArgs.ids.push(id);
    return { ids: ['d-4', 'd-5', 'd-6'], index: 1, total: 3, hasPrev: true, hasNext: true, prevId: 'DEPT-4', nextId: 'DEPT-6' };
  },
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => ({ items: [], addToRecent, clearRecent: vi.fn() }),
}));
vi.mock('./DepartmentHeadcountTab', () => ({ default: () => <div>headcount tab</div> }));
// The company picker searches the API: the stored company and a button stand in.
vi.mock('../../components/fields/CompanySelect', () => ({
  default: (props: { value: string | null; onChange: (v: string | null) => void }) => (
    <button type="button" onClick={() => props.onChange('company-2')}>{`company:${props.value}`}</button>
  ),
}));

import api from '../../api';
import DepartmentWorkspacePage from './DepartmentWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

const DEPARTMENT = {
  id: 'd-5', item_number: 5, name: 'Finance', company_id: 'company-1', description: null, status: 'enabled', disabled_at: null,
};

/** The server reads the department by its uuid or its reference, in any case; anything else is a 404. */
let server: typeof DEPARTMENT;
const departmentReads = () => mocked.get.mock.calls.filter(([url]) => String(url).startsWith('/departments/'));

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string) {
  // As the app's client: a read stays fresh for 30 seconds.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Where />
            <Routes>
              <Route path="/master-data/departments/:id/:tab" element={<DepartmentWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;

describe('DepartmentWorkspacePage by reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navArgs.ids = [];
    server = { ...DEPARTMENT };
    mocked.get.mockImplementation(async (url: string) => {
      if (['/departments/d-5', '/departments/DEPT-5', '/departments/dept-5'].includes(url)) return { data: server };
      if (url.startsWith('/departments/')) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  it('moves a uuid address to the reference, tab and list context kept, with one read', async () => {
    renderAt('/master-data/departments/d-5/details?sort=name%3AASC&year=2026');
    await waitFor(() => expect(where()).toBe('/master-data/departments/DEPT-5/details?sort=name%3AASC&year=2026'));
    await screen.findByText('headcount tab');
    expect(departmentReads().map(([url]) => url)).toEqual(['/departments/d-5']);
    expect(screen.getByText('DEPT-5')).toBeInTheDocument();
    await waitFor(() => expect(addToRecent).toHaveBeenCalledWith('department', 'd-5', 'Finance', 'DEPT-5'));
  });

  it('writes a lower-case reference as the department has it', async () => {
    renderAt('/master-data/departments/dept-5/overview');
    await waitFor(() => expect(where()).toBe('/master-data/departments/DEPT-5/overview'));
    expect(departmentReads().map(([url]) => url)).toEqual(['/departments/dept-5']);
  });

  it('shows a save on the page at the reference address, without reading the department again', async () => {
    renderAt('/master-data/departments/d-5/overview');
    await waitFor(() => expect(where()).toBe('/master-data/departments/DEPT-5/overview'));
    fireEvent.click(await screen.findByRole('button', { name: 'company:company-1' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/departments/d-5', { company_id: 'company-2' }));
    expect(await screen.findByRole('button', { name: 'company:company-2' })).toBeInTheDocument();
    expect(departmentReads()).toHaveLength(1);
  });

  it('finds its place in the list by its uuid and opens a neighbour by its reference', async () => {
    renderAt('/master-data/departments/DEPT-5/overview?sort=name%3AASC');
    await screen.findByText('DEPT-5');
    expect(navArgs.ids).toContain('d-5');
    expect(navArgs.ids).not.toContain('DEPT-5');
    fireEvent.click(screen.getByRole('button', { name: 'departments.previous' }));
    await waitFor(() => expect(where()).toBe('/master-data/departments/DEPT-4/overview?sort=name%3AASC'));
  });

  it('shows an unknown reference as an unknown uuid', async () => {
    renderAt('/master-data/departments/DEPT-999/overview');
    expect(await screen.findByText('departments.loadError')).toBeInTheDocument();
    expect(where()).toBe('/master-data/departments/DEPT-999/overview');
  });

  it('does not read the department again once deleted from its reference address', async () => {
    mocked.post.mockResolvedValue({ data: { refused: [] } });
    mocked.delete.mockResolvedValue({ data: {} });
    renderAt('/master-data/departments/DEPT-5/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    const readsBefore = departmentReads().length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/departments/d-5'));
    await waitFor(() => expect(where()).toBe('/master-data/departments'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(departmentReads()).toHaveLength(readsBefore);
  });
});
