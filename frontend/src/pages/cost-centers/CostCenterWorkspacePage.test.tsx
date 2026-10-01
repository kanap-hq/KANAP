import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import type { CostCenterDetail } from '../../services/costCenters';

const navigateMock = vi.hoisted(() => vi.fn());
const treeState = vi.hoisted(() => ({ nodes: [] as unknown[] }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts && 'count' in opts ? `${key}:${opts.count}` : key),
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })) } }));
vi.mock('../../services/costCenters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/costCenters')>()),
  getCostCenter: vi.fn(),
  createCostCenter: vi.fn(),
  updateCostCenter: vi.fn(),
  deleteCostCenter: vi.fn(),
}));
vi.mock('../../hooks/useCostCenterTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useCostCenterTree')>();
  return { ...actual, useCostCenterTree: () => actual.buildCostCenterTree(treeState.nodes as any) };
});
vi.mock('../../hooks/useCostCenterNav', () => ({
  useCostCenterNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../../components/fields/CompanySelect', () => ({
  default: (props: { onChange: (v: string | null) => void; helperText?: React.ReactNode }) => (
    <div>
      <button type="button" onClick={() => props.onChange('company-2')}>pick company</button>
      {props.helperText ? <span>{props.helperText}</span> : null}
    </div>
  ),
}));
vi.mock('../../components/workspace/MetadataUserPicker', () => ({
  default: (props: { onChange: (v: string | null) => void }) => (
    <button type="button" onClick={() => props.onChange('user-2')}>pick owner</button>
  ),
}));

import * as service from '../../services/costCenters';
import CostCenterWorkspacePage from './CostCenterWorkspacePage';

const mocked = service as unknown as {
  getCostCenter: ReturnType<typeof vi.fn>;
  createCostCenter: ReturnType<typeof vi.fn>;
  updateCostCenter: ReturnType<typeof vi.fn>;
  deleteCostCenter: ReturnType<typeof vi.fn>;
};

const NODE: CostCenterDetail = {
  id: 'cc-1',
  code: 'IT-300',
  name: 'Service desk',
  kind: 'cost_center',
  parent_id: null,
  parent_code: null,
  parent_name: null,
  company_id: 'company-1',
  company_name: 'Company one',
  owner_user_id: null,
  owner_name: null,
  status: 'enabled',
  disabled_at: null,
  sort_order: 0,
  depth: 0,
  path: 'Service desk',
  path_ids: ['cc-1'],
  description: null,
  opex_count: 3,
  capex_count: 1,
};

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <Link to="/master-data/cost-centers/cc-2/overview">go to cc-2</Link>
          <Routes>
            <Route path="/master-data/cost-centers/:id/:tab" element={<CostCenterWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('CostCenterWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    treeState.nodes = [];
    mocked.getCostCenter.mockImplementation(async (id: string) => (
      id === 'cc-2' ? { ...NODE, id: 'cc-2', code: 'IT-400', name: 'Workplace' } : NODE
    ));
    mocked.updateCostCenter.mockImplementation(async (_id: string, patch: Partial<CostCenterDetail>) => ({ ...NODE, ...patch }));
  });

  it('creates with an explicit button and opens the new node', async () => {
    mocked.createCostCenter.mockResolvedValue({ ...NODE, id: 'cc-new' });
    renderAt('/master-data/cost-centers/new/overview?sort=path%3AASC');
    fireEvent.change(screen.getByLabelText('costCenters.fields.code'), { target: { value: ' IT-400 ' } });
    fireEvent.change(screen.getByLabelText('costCenters.fields.name'), { target: { value: 'Workplace' } });
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.createCostCenter).toHaveBeenCalledTimes(1));
    expect(mocked.createCostCenter).toHaveBeenCalledWith({
      code: 'IT-400',
      name: 'Workplace',
      kind: 'cost_center',
      parent_id: null,
      company_id: 'company-2',
      owner_user_id: null,
      description: null,
    });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/cost-centers/cc-new/overview?sort=path%3AASC'));
  });

  it('refuses to create a cost center without a company', async () => {
    renderAt('/master-data/cost-centers/new/overview');
    // No Properties drawer on the create page.
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.change(screen.getByLabelText('costCenters.fields.code'), { target: { value: 'IT-400' } });
    fireEvent.change(screen.getByLabelText('costCenters.fields.name'), { target: { value: 'Workplace' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('costCenters.messages.companyRequired')).toBeInTheDocument();
    expect(mocked.createCostCenter).not.toHaveBeenCalled();
  });

  it('saves the code on blur, with no save button', async () => {
    renderAt('/master-data/cost-centers/cc-1/overview');
    const code = await screen.findByLabelText('costCenters.fields.code');
    expect(screen.getByRole('complementary')).toContainElement(code);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    fireEvent.change(code, { target: { value: 'IT-310' } });
    expect(mocked.updateCostCenter).not.toHaveBeenCalled();
    fireEvent.blur(code);
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenCalledWith('cc-1', { code: 'IT-310' }));
  });

  it('shows a refused code under the code field', async () => {
    mocked.updateCostCenter.mockRejectedValueOnce({ response: { data: { message: 'A cost center with code IT-100 already exists.' } } });
    renderAt('/master-data/cost-centers/cc-1/overview');
    const code = await screen.findByLabelText('costCenters.fields.code');
    fireEvent.change(code, { target: { value: 'IT-100' } });
    fireEvent.blur(code);
    const message = await screen.findByText('A cost center with code IT-100 already exists.');
    expect(code.closest('.MuiFormControl-root')).toContainElement(message);
    expect(code).toHaveValue('IT-100');
  });

  it('explains the budget holder under its field, on the create page and in the drawer', async () => {
    const { unmount } = renderAt('/master-data/cost-centers/new/overview');
    expect(screen.getByText('costCenters.hints.owner')).toBeInTheDocument();
    unmount();
    renderAt('/master-data/cost-centers/cc-1/overview');
    await screen.findByLabelText('costCenters.fields.code');
    expect(screen.getByRole('complementary')).toContainElement(screen.getByText('costCenters.hints.owner'));
  });

  it('saves the company and the owner on change', async () => {
    renderAt('/master-data/cost-centers/cc-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'pick company' }));
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenCalledWith('cc-1', { company_id: 'company-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick owner' }));
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenCalledWith('cc-1', { owner_user_id: 'user-2' }));
  });

  it('turns a cost center into a group in one write that clears its company', async () => {
    renderAt('/master-data/cost-centers/cc-1/overview');
    const type = await screen.findByLabelText('costCenters.fields.type');
    fireEvent.mouseDown(within(type.parentElement as HTMLElement).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'costCenters.kinds.group' }));
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenCalledWith('cc-1', { kind: 'group', company_id: null }));
  });

  it('waits for the company before turning a group into a cost center', async () => {
    mocked.getCostCenter.mockResolvedValue({ ...NODE, kind: 'group', company_id: null, company_name: null, opex_count: 0, capex_count: 0 });
    renderAt('/master-data/cost-centers/cc-1/overview');
    const type = await screen.findByLabelText('costCenters.fields.type');
    fireEvent.mouseDown(within(type.parentElement as HTMLElement).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'costCenters.kinds.cost_center' }));
    expect(await screen.findByText('costCenters.messages.chooseCompany')).toBeInTheDocument();
    expect(mocked.updateCostCenter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenCalledWith('cc-1', { kind: 'cost_center', company_id: 'company-2' }));
  });

  it('shows a refused delete readably', async () => {
    mocked.getCostCenter.mockResolvedValue({ ...NODE, opex_count: 0, capex_count: 0 });
    mocked.deleteCostCenter.mockRejectedValueOnce({
      response: { status: 409, data: { message: 'IT-300 is used by 3 OPEX lines and 1 CAPEX line. Disable it instead.' } },
    });
    renderAt('/master-data/cost-centers/cc-1/overview');
    await screen.findByLabelText('costCenters.fields.code');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    expect(await screen.findByText('IT-300 is used by 3 OPEX lines and 1 CAPEX line. Disable it instead.')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('keeps the fields usable while a save runs, and queues the next save', async () => {
    let finishFirst: (value: CostCenterDetail) => void = () => undefined;
    mocked.updateCostCenter
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(async () => ({ ...NODE, code: 'IT-310', owner_user_id: 'user-2' }));
    renderAt('/master-data/cost-centers/cc-1/overview');
    const code = await screen.findByLabelText('costCenters.fields.code');
    const type = within(screen.getByLabelText('costCenters.fields.type').parentElement as HTMLElement).getByRole('combobox');
    code.focus();
    fireEvent.change(code, { target: { value: 'IT-310' } });
    // Moving focus to Type blurs Code, which saves it.
    type.focus();
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenCalledTimes(1));
    // Tab from Code to Type while the save runs: nothing is disabled and focus stays.
    expect(type).not.toHaveAttribute('aria-disabled');
    expect(code).not.toBeDisabled();
    expect(document.activeElement).toBe(type);
    fireEvent.click(screen.getByRole('button', { name: 'pick owner' }));
    // The second write waits for the first, so an older response cannot land last.
    expect(mocked.updateCostCenter).toHaveBeenCalledTimes(1);
    finishFirst({ ...NODE, code: 'IT-310' });
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenCalledTimes(2));
    expect(mocked.updateCostCenter).toHaveBeenNthCalledWith(2, 'cc-1', { owner_user_id: 'user-2' });
    expect(document.activeElement).toBe(type);
  });

  it('disables Delete with the reason when lines use the node', async () => {
    renderAt('/master-data/cost-centers/cc-1/overview');
    expect(await screen.findByTestId('cost-center-usage')).toHaveTextContent('costCenters.deleteBlocked.used');
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeDisabled();
  });

  it('disables Delete with the reason when the group contains nodes, and does not offer Cost center as its type', async () => {
    mocked.getCostCenter.mockResolvedValue({ ...NODE, kind: 'group', company_id: null, company_name: null, opex_count: 0, capex_count: 0 });
    const child = (id: string) => ({ ...NODE, id, code: id, parent_id: 'cc-1', depth: 1, path_ids: ['cc-1', id] });
    treeState.nodes = [{ ...NODE, kind: 'group', company_id: null }, child('a'), child('b')];
    renderAt('/master-data/cost-centers/cc-1/overview');
    expect(await screen.findByTestId('cost-center-usage')).toHaveTextContent('costCenters.deleteBlocked.children:2');
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeDisabled();
    const type = await screen.findByLabelText('costCenters.fields.type');
    fireEvent.mouseDown(within(type.parentElement as HTMLElement).getByRole('combobox'));
    expect(await screen.findByRole('option', { name: 'costCenters.kinds.cost_center' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps Delete available for a free node', async () => {
    mocked.getCostCenter.mockResolvedValue({ ...NODE, opex_count: 0, capex_count: 0 });
    renderAt('/master-data/cost-centers/cc-1/overview');
    await screen.findByLabelText('costCenters.fields.code');
    expect(screen.queryByTestId('cost-center-usage')).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeEnabled();
  });

  it('places a refusal under the field the server names', async () => {
    mocked.updateCostCenter.mockRejectedValueOnce({
      response: { data: { message: 'A group that contains nodes cannot become a cost center.', field: 'kind' } },
    });
    renderAt('/master-data/cost-centers/cc-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'pick company' }));
    const message = await screen.findByText('A group that contains nodes cannot become a cost center.');
    const type = screen.getByLabelText('costCenters.fields.type');
    expect(type.closest('.MuiFormControl-root')).toContainElement(message);
  });

  it('places a create refusal under its field, and one without a field in the alert', async () => {
    mocked.createCostCenter
      .mockRejectedValueOnce({ response: { data: { message: 'A cost center with code IT-400 already exists.', field: 'code' } } })
      .mockRejectedValueOnce({ response: { data: { message: 'Something went wrong.' } } });
    renderAt('/master-data/cost-centers/new/overview');
    const code = screen.getByLabelText('costCenters.fields.code');
    fireEvent.change(code, { target: { value: 'IT-400' } });
    fireEvent.change(screen.getByLabelText('costCenters.fields.name'), { target: { value: 'Workplace' } });
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    const message = await screen.findByText('A cost center with code IT-400 already exists.');
    expect(code.closest('.MuiFormControl-root')).toContainElement(message);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('drops a late refusal from the record the user has left', async () => {
    let failFirst: (reason: unknown) => void = () => undefined;
    mocked.updateCostCenter.mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = reject; }));
    renderAt('/master-data/cost-centers/cc-1/overview');
    const code = await screen.findByLabelText('costCenters.fields.code');
    fireEvent.change(code, { target: { value: 'IT-100' } });
    fireEvent.blur(code);
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('link', { name: 'go to cc-2' }));
    await waitFor(() => expect(screen.getByLabelText('costCenters.fields.code')).toHaveValue('IT-400'));
    failFirst({ response: { data: { message: 'A cost center with code IT-100 already exists.', field: 'code' } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('A cost center with code IT-100 already exists.')).toBeNull();
  });

  it('keeps what the user types while an earlier save of the same field lands', async () => {
    let finishCode: (value: CostCenterDetail) => void = () => undefined;
    let finishDescription: (value: CostCenterDetail) => void = () => undefined;
    mocked.updateCostCenter.mockImplementationOnce(() => new Promise((resolve) => { finishCode = resolve; }));
    renderAt('/master-data/cost-centers/cc-1/overview');
    const code = await screen.findByLabelText('costCenters.fields.code');
    fireEvent.focus(code);
    fireEvent.change(code, { target: { value: 'IT-31' } });
    fireEvent.blur(code);
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenCalledWith('cc-1', { code: 'IT-31' }));
    fireEvent.focus(code);
    fireEvent.change(code, { target: { value: 'IT-310' } });
    finishCode({ ...NODE, code: 'IT-31' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(code).toHaveValue('IT-310');
    fireEvent.blur(code);
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenLastCalledWith('cc-1', { code: 'IT-310' }));

    mocked.updateCostCenter.mockImplementationOnce(() => new Promise((resolve) => { finishDescription = resolve; }));
    const description = screen.getByLabelText('costCenters.fields.description');
    fireEvent.focus(description);
    fireEvent.change(description, { target: { value: 'Front line' } });
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenLastCalledWith('cc-1', { description: 'Front line' }));
    fireEvent.focus(description);
    fireEvent.change(description, { target: { value: 'Front line support' } });
    finishDescription({ ...NODE, code: 'IT-310', description: 'Front line' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(description).toHaveValue('Front line support');
    // Leaving the field saves what it holds.
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.updateCostCenter).toHaveBeenLastCalledWith('cc-1', { description: 'Front line support' }));
  });
});
