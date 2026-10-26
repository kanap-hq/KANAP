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
    expect(onLink).toHaveBeenCalledWith('projects', 'p-2', 'New project');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('opens the picker under the Add button, on its left edge', async () => {
    // The Add button sits just after the section title, to the right of the 220px side menu.
    // The panel's top-left meets the button (left 280px, bottom 112px) and grows into the content.
    const previousWidth = window.innerWidth;
    window.innerWidth = 1280;
    try {
      renderSections({});
      const region = screen.getByRole('region', { name: 'Projects' });
      const button = within(region).getByText('workspace.application.relations.add').closest('button') as HTMLButtonElement;
      button.getBoundingClientRect = () => ({
        top: 80, bottom: 112, left: 280, right: 440, width: 160, height: 32, x: 280, y: 80, toJSON: () => ({}),
      }) as DOMRect;
      fireEvent.click(button);
      expect(await screen.findByRole('option', { name: /New project/ })).toBeTruthy();
      const paper = document.querySelector('.MuiPopover-paper') as HTMLElement;
      expect(paper.style.left).toBe('280px');
      expect(paper.style.top).toBe('112px');
      expect(getComputedStyle(paper).width).toBe('380px');
    } finally {
      window.innerWidth = previousWidth;
    }
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

  it('counts the linked rows outside the data access under the visible ones', () => {
    renderSections({ sections: [{ ...section([{ id: 'p-1', name: 'Migration' }]), outside: { count: 3, text: 'and 3 lines outside your access' } }] });
    const region = screen.getByRole('region', { name: 'Projects' });
    expect(within(region).getByText('Migration')).toBeTruthy();
    expect(within(region).getByText('and 3 lines outside your access')).toBeTruthy();
    // The hidden rows are never listed: nothing to remove.
    expect(within(region).getAllByRole('button', { name: /relations\.remove/ })).toHaveLength(1);
  });

  it('says only the count when no linked row is visible', () => {
    renderSections({ sections: [{ ...section([]), outside: { count: 2, text: '2 lines outside your access' } }] });
    expect(screen.getByText('2 lines outside your access')).toBeTruthy();
    expect(screen.queryByText('No project.')).toBeNull();
  });

  it('gives a caller who cannot read the module the count alone, without names or Add', () => {
    renderSections({ sections: [{ ...section(null), outside: { count: 3, text: '3 budget lines' } }] });
    const region = screen.getByRole('region', { name: 'Projects' });
    expect(within(region).getByText('3 budget lines')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
  });

  it('counts in the section title what the section shows: listed rows plus counted ones', () => {
    renderSections({ sections: [{ ...section([{ id: 'p-1', name: 'Migration' }]), outside: { count: 3, text: 'and 3 lines outside your access' } }] });
    expect(within(screen.getByRole('region', { name: 'Projects' })).getByText('4')).toBeTruthy();
  });

  it('counts the linked rows in the title for a caller who cannot read the module', () => {
    renderSections({ sections: [{ ...section(null), outside: { count: 3, text: '3 budget lines' } }] });
    expect(within(screen.getByRole('region', { name: 'Projects' })).getByText('3')).toBeTruthy();
  });

  it('shows no mention when nothing is outside', () => {
    renderSections({ sections: [{ ...section(null), outside: { count: 0, text: '0 budget lines' } }] });
    expect(screen.queryByRole('region', { name: 'Projects' })).toBeNull();
  });
});
