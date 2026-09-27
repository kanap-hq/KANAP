import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../hooks/useDepartmentNav', () => ({
  useDepartmentNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../../hooks/useFreezeState', () => ({
  useFreezeState: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('../../components/fields/CompanySelect', () => ({
  default: (props: { onChange: (v: string | null) => void }) => (
    <button type="button" onClick={() => props.onChange('company-2')}>pick company</button>
  ),
}));

import api from '../../api';
import DepartmentWorkspacePage from './DepartmentWorkspacePage';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

const DEPARTMENT = {
  id: 'dep-1',
  name: 'Finance',
  company_id: 'company-1',
  description: 'Accounting',
  status: 'enabled',
  disabled_at: null,
};

const Y = new Date().getFullYear();
const headcounts: Record<number, number> = { [Y]: 5, [Y + 1]: 6 };

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <Link to="/master-data/departments/dep-2/overview">go to dep-2</Link>
          <Routes>
            <Route path="/master-data/departments/:id/:tab" element={<DepartmentWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('DepartmentWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockImplementation(async (url: string, config?: { params?: { year?: number } }) => {
      if (url === '/departments/dep-1') return { data: DEPARTMENT };
      if (url === '/departments/dep-2') return { data: { ...DEPARTMENT, id: 'dep-2', name: 'Legal', description: 'Contracts' } };
      if (url === '/department-metrics/dep-1') return { data: { headcount: headcounts[config?.params?.year ?? 0] ?? 0 } };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (url: string, body: Record<string, unknown>) => (
      url.startsWith('/departments/') ? { data: { ...DEPARTMENT, ...body } } : { data: body }
    ));
  });

  it('has no save or reset button', async () => {
    renderAt('/master-data/departments/dep-1/overview');
    await screen.findByText('Finance');
    expect(screen.queryByRole('button', { name: 'common:buttons.saveChanges' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.reset' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'shared.labels.overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'shared.labels.details' })).toBeInTheDocument();
  });

  it('saves a name change on blur', async () => {
    renderAt('/master-data/departments/dep-1/overview');
    fireEvent.click(await screen.findByText('Finance'));
    const input = screen.getByDisplayValue('Finance');
    fireEvent.change(input, { target: { value: 'Finance and control' } });
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/departments/dep-1', { name: 'Finance and control' }));
  });

  it('saves the description on blur', async () => {
    renderAt('/master-data/departments/dep-1/overview');
    const description = await screen.findByLabelText('departments.fields.description');
    fireEvent.change(description, { target: { value: 'Accounting and payroll' } });
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/departments/dep-1', { description: 'Accounting and payroll' }));
  });

  it('saves a company change on change', async () => {
    renderAt('/master-data/departments/dep-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'pick company' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/departments/dep-1', { company_id: 'company-2' }));
  });

  it('saves the headcount per year on blur', async () => {
    renderAt(`/master-data/departments/dep-1/details?year=${Y}`);
    const headcount = await screen.findByLabelText('departments.fields.headcount');
    await waitFor(() => expect(headcount).toHaveValue(5));
    fireEvent.change(headcount, { target: { value: '7' } });
    fireEvent.blur(headcount);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(
      '/department-metrics/dep-1', { headcount: 7 }, { params: { year: Y } },
    ));
    fireEvent.click(screen.getByRole('tab', { name: String(Y + 1) }));
    await waitFor(() => expect(screen.getByLabelText('departments.fields.headcount')).toHaveValue(6));
    const next = screen.getByLabelText('departments.fields.headcount');
    fireEvent.change(next, { target: { value: '9' } });
    fireEvent.blur(next);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(
      '/department-metrics/dep-1', { headcount: 9 }, { params: { year: Y + 1 } },
    ));
    expect(mocked.patch).toHaveBeenCalledTimes(2);
  });

  it('creates with an explicit button', async () => {
    mocked.post.mockResolvedValue({ data: { ...DEPARTMENT, id: 'dep-new' } });
    renderAt('/master-data/departments/new/overview?year=2026');
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.change(screen.getByLabelText('departments.fields.name'), { target: { value: 'Legal' } });
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/departments', { name: 'Legal', company_id: 'company-2', description: null }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/departments/dep-new/overview?year=2026'));
  });

  it('changes year on a click made while the headcount save is still running', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocked.patch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderAt(`/master-data/departments/dep-1/details?year=${Y}`);
    const headcount = await screen.findByLabelText('departments.fields.headcount');
    await waitFor(() => expect(headcount).toHaveValue(5));
    fireEvent.change(headcount, { target: { value: '7' } });
    fireEvent.blur(headcount);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    const nextYear = screen.getByRole('tab', { name: String(Y + 1) });
    expect(nextYear).not.toBeDisabled();
    fireEvent.click(nextYear);
    await waitFor(() => expect(screen.getByLabelText('departments.fields.headcount')).toHaveValue(6));
    expect(screen.getByLabelText('departments.fields.headcount')).not.toBeDisabled();
    finish({ data: { headcount: 7 } });
    expect(mocked.patch).toHaveBeenCalledWith('/department-metrics/dep-1', { headcount: 7 }, { params: { year: Y } });
  });

  it('says what a valid headcount is in plain words', async () => {
    renderAt(`/master-data/departments/dep-1/details?year=${Y}`);
    const headcount = await screen.findByLabelText('departments.fields.headcount');
    await waitFor(() => expect(headcount).toHaveValue(5));
    fireEvent.change(headcount, { target: { value: '' } });
    fireEvent.blur(headcount);
    expect(await screen.findByText('departments.messages.headcountInvalid')).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('keeps the headcount disabled after a failed load', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/departments/dep-1') return { data: DEPARTMENT };
      throw { response: { data: { message: 'Metrics unavailable.' } } };
    });
    renderAt(`/master-data/departments/dep-1/details?year=${Y}`);
    expect(await screen.findByText('Metrics unavailable.')).toBeInTheDocument();
    expect(screen.getByLabelText('departments.fields.headcount')).toBeDisabled();
  });

  it('drops a late refusal from the department the user has left', async () => {
    let fail: (reason: unknown) => void = () => undefined;
    mocked.patch.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    renderAt('/master-data/departments/dep-1/overview');
    const description = await screen.findByLabelText('departments.fields.description');
    fireEvent.change(description, { target: { value: 'Payroll' } });
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('link', { name: 'go to dep-2' }));
    await waitFor(() => expect(screen.getByLabelText('departments.fields.description')).toHaveValue('Contracts'));
    fail({ response: { data: { message: 'Description refused.' } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Description refused.')).toBeNull();
  });
});
