import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../../config/ThemeContext';
import ProjectPropertyPanel from './ProjectPropertyPanel';

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('../../../../components/fields/UserSelect', () => ({ default: () => null }));
vi.mock('../../../../components/fields/CompanySelect', () => ({ default: () => null }));
vi.mock('../../../../components/fields/DepartmentSelect', () => ({ default: () => null }));
vi.mock('../../../../components/fields/DateEUField', () => ({ default: () => null }));
vi.mock('../../../../components/fields/TeamMemberMultiSelect', () => ({ default: () => null }));

// A project saved before a stream had to belong to its category (lot I7a of 26.12.1): category
// Business, stream "Ops" of IT. The picker shows it, its category in parentheses, without MUI's
// out-of-range warning; another category goes to the page, which clears the stream with it.
const IT = 'cat-it';
const BUSINESS = 'cat-business';
const OPS_IT = 'stream-ops-it';
const RUN_BUSINESS = 'stream-run-business';
const CATALOG = {
  categories: [{ id: IT, name: 'Infrastructure', is_active: true }, { id: BUSINESS, name: 'Business applications', is_active: true }],
  streams: [
    { id: OPS_IT, name: 'Ops', category_id: IT, is_active: true },
    { id: RUN_BUSINESS, name: 'Run', category_id: BUSINESS, is_active: true },
  ],
};

function renderPanel(form: Record<string, unknown>, handlers: { onCategoryChange?: (v: string) => void; onStreamChange?: (v: string) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <ProjectPropertyPanel
            canManage
            categories={CATALOG.categories}
            classification={CATALOG}
            form={{ id: 'proj-1', status: 'in_progress', origin: 'fast_track', ...form }}
            onCategoryChange={handlers.onCategoryChange ?? (() => {})}
            onCompanyChange={() => {}}
            onLocalUpdate={() => {}}
            onPlannedEndChange={() => {}}
            onPlannedStartChange={() => {}}
            onRefetch={async () => undefined}
            onSourceChange={() => {}}
            onStatusChange={() => {}}
            onStreamChange={handlers.onStreamChange ?? (() => {})}
            onUpdate={() => {}}
            originLabels={{}}
            sources={[]}
            statusOptions={[{ value: 'in_progress', label: 'In progress' }]}
            streams={CATALOG.streams}
          />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The property row whose label is `label` (the label box is the direct parent of the text). */
function fieldRow(label: string): HTMLElement {
  const row = screen.getByText(label).parentElement;
  if (!row) throw new Error(`missing row for ${label}`);
  return row;
}

describe('ProjectPropertyPanel, a stream of another category kept from before the rule', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  it('shows the stream with its own category, and no warning', () => {
    renderPanel({ category_id: BUSINESS, stream_id: OPS_IT });
    expect(within(fieldRow('workspace.project.fields.stream')).getByText('Ops (Infrastructure)')).toBeTruthy();
    const warnings = [...warn.mock.calls, ...error.mock.calls].map((call) => String(call[0]));
    expect(warnings.filter((text) => /out-of-range|MUI/.test(text))).toEqual([]);
  });

  it('offers the streams of the category, and the one it carries', () => {
    renderPanel({ category_id: BUSINESS, stream_id: OPS_IT });
    fireEvent.mouseDown(within(fieldRow('workspace.project.fields.stream')).getByRole('combobox'));
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['common:labels.none', 'Run', 'Ops (Infrastructure)']);
  });

  it('names a stream of its own category without parentheses', () => {
    renderPanel({ category_id: BUSINESS, stream_id: RUN_BUSINESS });
    expect(within(fieldRow('workspace.project.fields.stream')).getByText('Run')).toBeTruthy();
  });

  it('hands another category to the page', () => {
    const onCategoryChange = vi.fn();
    renderPanel({ category_id: BUSINESS, stream_id: OPS_IT }, { onCategoryChange });
    fireEvent.mouseDown(within(fieldRow('workspace.project.fields.category')).getByRole('combobox'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Infrastructure'));
    expect(onCategoryChange).toHaveBeenCalledWith(IT);
  });
});
