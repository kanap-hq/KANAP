import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const axesState = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: apiGet, post: apiPost } }));
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  return {
    ...actual,
    useAnalyticsAxes: () => actual.buildAnalyticsAxes(axesState.list as any, ((key: string) => key) as any),
  };
});

import AnalyticsCategorySelect from './AnalyticsCategorySelect';

const NATURE_VALUES = [
  { id: 'v-lic', axis_id: 'ax-nature', name: 'Licenses', description: null, status: 'enabled', disabled_at: null },
  { id: 'v-hw', axis_id: 'ax-nature', name: 'Hardware', description: 'Servers and laptops', status: 'enabled', disabled_at: null },
];

function renderSelect(props: Partial<React.ComponentProps<typeof AnalyticsCategorySelect>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <AnalyticsCategorySelect axisId="ax-nature" value={null} onChange={onChange} {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onChange, queryClient };
}

describe('AnalyticsCategorySelect', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    axesState.list = [
      { id: 'ax-default', code: 'default', name: null, description: null, sort_order: 0, is_default: true, status: 'enabled', disabled_at: null },
      { id: 'ax-nature', code: 'nature', name: 'Nature', description: null, sort_order: 1, is_default: false, status: 'enabled', disabled_at: null },
    ];
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url !== '/analytics-categories/lookup') throw new Error(`unexpected ${url}`);
      if (config?.params?.ids === 'v-old') {
        return { data: { items: [{ id: 'v-old', axis_id: 'ax-nature', name: 'Old licenses', description: null, status: 'disabled' }], has_more: false } };
      }
      // The server sorts by name.
      return { data: { items: [NATURE_VALUES[1], NATURE_VALUES[0]], has_more: false } };
    });
  });

  it("searches its dimension's values on the server, once the list opens", async () => {
    renderSelect();
    const input = await screen.findByRole('combobox');
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(apiGet).not.toHaveBeenCalled();
    act(() => { input.focus(); });
    fireEvent.mouseDown(input);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/analytics-categories/lookup', expect.objectContaining({
      params: { axis_id: 'ax-nature', limit: 30 },
    })));
    fireEvent.change(input, { target: { value: 'lic' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/analytics-categories/lookup', expect.objectContaining({
      params: { axis_id: 'ax-nature', q: 'lic', limit: 30 },
    })));
  });

  it('offers the values by name and returns the picked id', async () => {
    const { onChange } = renderSelect();
    const input = await screen.findByRole('combobox');
    act(() => { input.focus(); });
    fireEvent.mouseDown(input);
    const options = await screen.findAllByRole('option');
    // The visible line of each option: the name only.
    expect(options.map((o) => o.firstChild?.textContent)).toEqual(['Hardware', 'Licenses']);
    fireEvent.click(screen.getByText('Licenses'));
    expect(onChange).toHaveBeenCalledWith('v-lic');
  });

  it("lists one line per value, the description in a delayed tooltip and in the option's accessible description", async () => {
    renderSelect();
    const input = await screen.findByRole('combobox');
    act(() => { input.focus(); });
    fireEvent.mouseDown(input);
    const hardware = await screen.findByRole('option', { name: 'Hardware' });
    expect(screen.getByText('Servers and laptops')).not.toBeVisible();
    expect(hardware).toHaveAccessibleDescription('Servers and laptops');
    expect(hardware).not.toHaveAttribute('title');
    expect(screen.getByRole('option', { name: 'Licenses' })).not.toHaveAttribute('aria-describedby');

    fireEvent.mouseOver(hardware);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent('Servers and laptops');
  });

  it('marks a disabled value on the same line as its name', async () => {
    apiGet.mockImplementation(async () => ({
      data: { items: [{ id: 'v-old', axis_id: 'ax-nature', name: 'Old licenses', description: null, status: 'disabled' }], has_more: false },
    }));
    renderSelect();
    const input = await screen.findByRole('combobox');
    act(() => { input.focus(); });
    fireEvent.mouseDown(input);
    const option = await screen.findByRole('option');
    expect(option).toHaveTextContent('Old licensescommon:statuses.disabled');
    expect(option.querySelectorAll('div')).toHaveLength(0);
  });

  it('keeps a disabled current value shown, read by id', async () => {
    renderSelect({ value: 'v-old' });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/analytics-categories/lookup', expect.objectContaining({ params: { ids: 'v-old' } })));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('Old licenses'));
  });

  it('offers only the values of its line type, asking the server with applies_to', async () => {
    renderSelect({ lineType: 'capex' });
    const input = await screen.findByRole('combobox');
    act(() => { input.focus(); });
    fireEvent.mouseDown(input);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/analytics-categories/lookup', expect.objectContaining({
      params: { axis_id: 'ax-nature', applies_to: 'capex', limit: 30 },
    })));
  });

  it('still shows a held value of the other line type, read by id without applies_to', async () => {
    renderSelect({ lineType: 'capex', value: 'v-old' });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/analytics-categories/lookup', expect.objectContaining({ params: { ids: 'v-old' } })));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('Old licenses'));
  });

  it("shows the line's value from the label it is given, without any request", async () => {
    renderSelect({ value: 'v-lic', selectedOption: { id: 'v-lic', name: 'Licenses' } });
    expect(screen.getByRole('combobox')).toHaveValue('Licenses');
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('is labelled with the dimension name, the translated default label for the unnamed default', async () => {
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <AnalyticsCategorySelect axisId="ax-nature" value={null} onChange={() => undefined} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText('Nature')).toBeInTheDocument();
    unmount();
    renderSelect({ axisId: 'ax-default' });
    expect(await screen.findByLabelText('master-data:analytics.analyticsCategoryFallback')).toBeInTheDocument();
  });

  it('can be made not clearable: no clear button, and neither Escape nor an emptied text removes the value', async () => {
    const held = { value: 'v-lic', selectedOption: { id: 'v-lic', name: 'Licenses' } };
    const first = renderSelect({ ...held });
    let input = screen.getByRole('combobox');
    expect(screen.getByTitle('Clear')).toBeInTheDocument();
    act(() => { input.focus(); });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(first.onChange).toHaveBeenCalledWith(null);
    cleanup();

    const second = renderSelect({ ...held, disableClearable: true });
    input = screen.getByRole('combobox');
    expect(screen.queryByTitle('Clear')).toBeNull();
    act(() => { input.focus(); });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.change(input, { target: { value: '' } });
    expect(second.onChange).not.toHaveBeenCalled();
  });

  it('uses the label it is given, also as the name of a field whose label is hidden', async () => {
    renderSelect({ label: 'Cost nature', hideLabel: true });
    expect(await screen.findByLabelText('Cost nature')).toBeInTheDocument();
    expect(screen.queryByText('Nature')).toBeNull();
  });

  describe('adding a value from the line', () => {
    const openNature = (openValues: boolean) => {
      axesState.list = [
        { id: 'ax-default', code: 'default', name: null, description: null, sort_order: 0, is_default: true, status: 'enabled', disabled_at: null },
        { id: 'ax-nature', code: 'nature', name: 'Nature', description: null, sort_order: 1, is_default: false, status: 'enabled', disabled_at: null, open_values: openValues },
      ];
    };
    const typeInto = async (text: string) => {
      const input = await screen.findByRole('combobox');
      act(() => { input.focus(); });
      fireEvent.mouseDown(input);
      await screen.findAllByRole('option');
      fireEvent.change(input, { target: { value: text } });
      await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/analytics-categories/lookup', expect.objectContaining({
        params: expect.objectContaining({ q: text }),
      })));
      return input;
    };

    it('offers Add on an open dimension, creates the value for the line and picks it', async () => {
      openNature(true);
      apiPost.mockResolvedValueOnce({ data: { id: 'v-new', axis_id: 'ax-nature', name: 'Gifts', description: null, status: 'enabled', created: true } });
      const { onChange } = renderSelect({ newValueFor: { lineId: 'line-1' } });
      await typeInto('Gifts');
      fireEvent.click(await screen.findByRole('option', { name: 'analytics.addValue' }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/analytics-categories/from-line', { axis_id: 'ax-nature', name: 'Gifts', line_id: 'line-1' }));
      await waitFor(() => expect(onChange).toHaveBeenCalledWith('v-new'));
    });

    it('sends the place of a line being created', async () => {
      openNature(true);
      apiPost.mockResolvedValueOnce({ data: { id: 'v-new', axis_id: 'ax-nature', name: 'Gifts', description: null, status: 'enabled', created: true } });
      renderSelect({ newValueFor: { payingCompanyId: 'co-1', costCenterId: null } });
      await typeInto('Gifts');
      fireEvent.click(await screen.findByRole('option', { name: 'analytics.addValue' }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/analytics-categories/from-line', { axis_id: 'ax-nature', name: 'Gifts', paying_company_id: 'co-1' }));
    });

    it('offers no Add for a name a value already has, whatever its case', async () => {
      openNature(true);
      renderSelect({ newValueFor: { lineId: 'line-1' } });
      await typeInto('licenses');
      await screen.findByRole('option', { name: 'Licenses' });
      expect(screen.queryByRole('option', { name: 'analytics.addValue' })).toBeNull();
    });

    it('offers no Add on a closed dimension, nor where the picker is not on an editable line', async () => {
      openNature(false);
      const first = renderSelect({ newValueFor: { lineId: 'line-1' } });
      await typeInto('Gifts');
      await screen.findByRole('option', { name: 'Licenses' });
      expect(screen.queryByRole('option', { name: 'analytics.addValue' })).toBeNull();
      cleanup();
      openNature(true);
      renderSelect();
      await typeInto('Gifts');
      await screen.findByRole('option', { name: 'Licenses' });
      expect(screen.queryByRole('option', { name: 'analytics.addValue' })).toBeNull();
      expect(apiPost).not.toHaveBeenCalled();
      expect(first.onChange).not.toHaveBeenCalled();
    });

    it('shows a refusal for the access under the field and keeps the line as it was', async () => {
      openNature(true);
      apiPost.mockRejectedValueOnce({ response: { status: 403, data: { code: 'DATA_ACCESS_LIMITED', message: 'This line is read only in your access.' } } });
      const { onChange } = renderSelect({ newValueFor: { lineId: 'line-1' } });
      await typeInto('Gifts');
      fireEvent.click(await screen.findByRole('option', { name: 'analytics.addValue' }));
      expect(await screen.findByText('errors:dataAccess.readOnlyLine')).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
