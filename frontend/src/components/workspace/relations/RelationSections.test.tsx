import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import RelationSections from './RelationSections';
import type { SectionSpec } from './types';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));

type Row = { id: string; name: string };

function section(rows: Row[] | null): SectionSpec<Row> {
  return {
    kind: 'projects',
    title: 'Projects',
    empty: 'No project.',
    searchPlaceholder: 'Search projects',
    rows,
    columns: [{ key: 'name', header: 'Name', render: (row) => row.name }],
    href: (row) => `/portfolio/projects/${row.id}`,
    label: (row) => row.name,
    search: async () => [
      { id: 'p-1', label: 'Migration' },
      { id: 'p-2', label: 'New project' },
    ],
  };
}

function renderSections(props: Partial<React.ComponentProps<typeof RelationSections>> & { rows?: Row[] | null }) {
  const onLink = vi.fn();
  const onUnlink = vi.fn();
  const { rows = [{ id: 'p-1', name: 'Migration' }], ...rest } = props;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <RelationSections
            sections={[section(rows)]}
            loaded
            canEdit
            searchKeyPrefix="object"
            onLink={onLink}
            onUnlink={onUnlink}
            {...rest}
          />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onLink, onUnlink };
}

describe('RelationSections', () => {
  it('renders a section and unlinks a row', () => {
    const { onUnlink } = renderSections({});
    const table = screen.getByRole('table', { name: 'Projects' });
    expect(within(table).getByText('Migration')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Projects' })).getByText('1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.remove(name=Migration)' }));
    expect(onUnlink).toHaveBeenCalledWith('projects', 'p-1');
  });

  it('adds a row from the picker, without the ones already linked', async () => {
    const { onLink } = renderSections({});
    const region = screen.getByRole('region', { name: 'Projects' });
    fireEvent.click(within(region).getByText('workspace.application.relations.add'));
    expect(await screen.findByRole('option', { name: /New project/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Migration/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /New project/ }));
    expect(onLink).toHaveBeenCalledWith('projects', 'p-2');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('shows the empty line when the section has no row', () => {
    renderSections({ rows: [] });
    expect(screen.getByText('No project.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('gives a reader the table without Add or remove', () => {
    renderSections({ canEdit: false });
    expect(screen.getByText('Migration')).toBeTruthy();
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
  });

  it('leaves out a section the caller cannot read', () => {
    renderSections({ rows: null });
    expect(screen.queryByRole('region', { name: 'Projects' })).toBeNull();
  });
});
