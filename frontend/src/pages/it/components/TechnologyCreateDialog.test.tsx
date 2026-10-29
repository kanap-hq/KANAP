import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import TechnologyCreateDialog from './TechnologyCreateDialog';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());

const stableT = (key: string, options?: { reference?: string }) => (
  options?.reference ? `${key}:${options.reference}` : key
);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get, post } }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    settings: null,
    byField: {
      technologyFamily: [{ code: 'database', label: 'Database' }],
      hostingType: [
        { code: 'on_prem', label: 'On-prem', category: 'on_prem' },
        { code: 'legacy_dc', label: 'Old datacenter', category: 'on_prem', deprecated: true },
        { code: 'saas', label: 'SaaS', category: 'cloud' },
      ],
    },
    labelFor: (_field: string, code: string) => ({ database: 'Database', on_prem: 'On-prem', saas: 'SaaS' } as Record<string, string>)[code] ?? code ?? '',
  }),
}));

function renderDialog(onCreated = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <TechnologyCreateDialog open onClose={() => undefined} onCreated={onCreated} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onCreated;
}

describe('TechnologyCreateDialog', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/technologies/catalog') {
        return { data: { items: [{ key: 'mssqlserver', name: 'Microsoft SQL Server', editor: 'Microsoft', family: 'database', hosting_type: 'on_prem', versions: 9, latest_version: '2022', description: 'Microsoft relational database.' }] } };
      }
      if (url === '/technologies/editors') return { data: { items: ['Microsoft'] } };
      return { data: { items: [] } };
    });
  });

  it('puts the focus in the search field once the dialog is shown', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByLabelText('pages.technologies.create.searchLabel')).toHaveFocus());
  });

  it('adopts a catalog entry and opens the new technology', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, created: true, technology: { id: 'u1', name: 'Microsoft SQL Server', reference: 'TEC-4' } } });
    const onCreated = renderDialog();
    fireEvent.change(screen.getByLabelText('pages.technologies.create.searchLabel'), { target: { value: 'sql' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/technologies/catalog', { params: { q: 'sql', language: 'en' } }));
    const row = await screen.findByRole('listitem');
    // Name, then the family on that line; the editor under it. No description, no hosting type.
    const name = within(row).getByText('Microsoft SQL Server');
    const family = within(row).getByText('Database');
    const editor = within(row).getByText('Microsoft', { exact: true });
    expect(name.parentElement).toBe(family.parentElement);
    expect(editor.parentElement).toBe(row);
    expect(name.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(row).queryByText('On-prem')).toBeNull();
    expect(screen.getByText('Microsoft relational database.')).not.toBeVisible();
    expect(row).toHaveAccessibleDescription('Microsoft relational database.');
    expect(getComputedStyle(family).whiteSpace).toBe('nowrap');
    expect(getComputedStyle(name).whiteSpace).toBe('nowrap');
    fireEvent.mouseOver(row);
    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent('Microsoft relational database.');
    fireEvent.click(name);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('TEC-4'));
    expect(post).toHaveBeenCalledWith('/technologies/adopt', { catalog_key: 'mssqlserver', language: 'en' });
  });

  it('keeps a product without a description on the same two lines, with no tooltip', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/technologies/catalog') {
        return { data: { items: [{ key: 'nginx', name: 'Nginx', editor: null, family: 'database', hosting_type: 'saas', versions: 1, latest_version: '1.24', description: '  ' }] } };
      }
      return { data: { items: [] } };
    });
    renderDialog();
    const row = await screen.findByRole('listitem');
    expect(within(row).getByText('Nginx')).toBeTruthy();
    expect(within(row).getByText('Database')).toBeTruthy();
    expect(within(row).queryByText('SaaS')).toBeNull();
    expect(row).not.toHaveAttribute('aria-describedby');
    // The editor line stays, empty, so the row does not collapse to one line.
    expect(row.querySelectorAll('.kanap-autocomplete-option-secondary').length).toBe(2);
    fireEvent.mouseOver(row);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('says when the entry completes a technology typed by hand, on the editor line', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/technologies/catalog') {
        return {
          data: {
            items: [
              { key: 'postgresql', name: 'PostgreSQL', editor: 'PostgreSQL Global Development Group', family: 'database', hosting_type: 'on_prem', versions: 5, latest_version: '17', description: null, completes: 'TEC-50' },
              { key: 'redis', name: 'Redis', editor: null, family: 'database', hosting_type: 'on_prem', versions: 1, latest_version: '7.2', description: null, completes: 'TEC-10' },
              { key: 'nginx', name: 'Nginx', editor: 'F5', family: 'database', hosting_type: 'on_prem', versions: 1, latest_version: '1.24', description: null, completes: null },
            ],
          },
        };
      }
      return { data: { items: [] } };
    });
    renderDialog();
    const rows = await screen.findAllByRole('listitem');
    const pg = rows.find((row) => within(row).queryByText('PostgreSQL'))!;
    const mention = within(pg).getByText('pages.technologies.create.completes:TEC-50');
    const editor = within(pg).getByText('PostgreSQL Global Development Group');
    // The mention sits with the editor, in the secondary line. The row stays two lines.
    expect(mention.parentElement).toBe(editor.parentElement);
    expect(mention.parentElement).toHaveClass('kanap-autocomplete-option-secondary');
    expect(getComputedStyle(mention).whiteSpace).toBe('nowrap');
    expect(pg.childElementCount).toBe(2);
    expect(pg.children[1]).toBe(mention.parentElement);
    const redis = rows.find((row) => within(row).queryByText('Redis'))!;
    expect(within(redis).getByText('pages.technologies.create.completes:TEC-10')).toBeTruthy();
    expect(redis.childElementCount).toBe(2);
    expect(redis.querySelectorAll('.kanap-autocomplete-option-secondary').length).toBe(2);
    const nginx = rows.find((row) => within(row).queryByText('Nginx'))!;
    expect(within(nginx).queryByText(/completes/)).toBeNull();
  });

  it('creates a technology missing from the catalog', async () => {
    post.mockResolvedValueOnce({ data: { id: 'u2', reference: 'TEC-5', name: 'In-house broker' } });
    const onCreated = renderDialog();
    fireEvent.click(screen.getByText('pages.technologies.create.manualLink'));
    fireEvent.change(screen.getByLabelText('workspace.technology.fields.name'), { target: { value: 'In-house broker' } });
    // On premises by default; the retired type is not offered.
    expect(screen.getByLabelText('workspace.technology.fields.hostingType').textContent).toBe('On-prem');
    fireEvent.mouseDown(screen.getByLabelText('workspace.technology.fields.hostingType'));
    expect(screen.queryByRole('option', { name: 'Old datacenter' })).toBeNull();
    fireEvent.click(await screen.findByRole('option', { name: 'SaaS' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('TEC-5'));
    expect(post).toHaveBeenCalledWith('/technologies', { name: 'In-house broker', family: undefined, editor: undefined, hosting_type: 'saas' });
  });

  it('lists an already adopted entry with its reference, and opens it instead of adopting it', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/technologies/catalog') {
        return {
          data: {
            items: [{
              key: 'amazon-aurora-postgresql',
              name: 'Amazon Aurora PostgreSQL',
              editor: 'AWS',
              family: 'database',
              hosting_type: 'public_cloud',
              versions: 1,
              latest_version: '16',
              description: null,
              completes: null,
            }],
            adopted: [{
              key: 'postgresql',
              name: 'PostgreSQL',
              editor: 'PostgreSQL Global Development Group',
              family: 'database',
              family_label: 'Database',
              reference: 'TEC-3',
              id: 'pg-id',
            }],
          },
        };
      }
      return { data: { items: [] } };
    });
    const onCreated = renderDialog();
    const offer = await screen.findByRole('listitem');
    expect(within(offer).getByText('Amazon Aurora PostgreSQL')).toBeTruthy();
    expect(screen.queryByText('pages.technologies.create.alreadyHeading')).toBeNull();
    expect(screen.queryByText('TEC-3')).toBeNull();

    fireEvent.change(screen.getByLabelText('pages.technologies.create.searchLabel'), { target: { value: 'postgres' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/technologies/catalog', { params: { q: 'postgres', language: 'en' } }));
    const heading = await screen.findByText('pages.technologies.create.alreadyHeading');
    const rows = screen.getAllByRole('listitem');
    const aurora = rows.find((row) => within(row).queryByText('Amazon Aurora PostgreSQL'))!;
    const pg = rows.find((row) => within(row).queryByText('PostgreSQL', { exact: true }))!;
    expect(aurora.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(pg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const reference = within(pg).getByText('TEC-3');
    expect(reference.parentElement).toHaveClass('kanap-autocomplete-option-secondary');
    expect(getComputedStyle(reference).whiteSpace).toBe('nowrap');
    expect(within(pg).getByText('Database')).toBeTruthy();
    expect(within(pg).getByText('PostgreSQL Global Development Group')).toBeTruthy();
    expect(pg.childElementCount).toBe(2);
    fireEvent.click(pg);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('TEC-3'));
    expect(post).not.toHaveBeenCalled();
  });

  it('replaces the empty catalog message with the adopted section, and keeps the manual link', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/technologies/catalog') {
        return {
          data: {
            items: [],
            adopted: [{
              key: 'postgresql',
              name: 'PostgreSQL',
              editor: 'PostgreSQL Global Development Group',
              family: 'database',
              family_label: 'Database',
              reference: 'TEC-3',
              id: 'pg-id',
            }],
          },
        };
      }
      return { data: { items: [] } };
    });
    renderDialog();
    expect(await screen.findByText('pages.technologies.create.noMatch')).toBeTruthy();
    expect(screen.queryByText('pages.technologies.create.alreadyHeading')).toBeNull();
    expect(screen.getByText('pages.technologies.create.manualLink')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('pages.technologies.create.searchLabel'), { target: { value: 'postgres' } });
    expect(await screen.findByText('pages.technologies.create.alreadyHeading')).toBeTruthy();
    expect(screen.queryByText('pages.technologies.create.noMatch')).toBeNull();
    expect(screen.getByText('TEC-3')).toBeTruthy();
    expect(screen.getByText('pages.technologies.create.manualLink')).toBeTruthy();
  });

  it('says under the name that the tenant already has it, and goes back to the catalog', async () => {
    post.mockRejectedValueOnce({ response: { status: 409, data: { code: 'duplicate', message: 'A technology with this name already exists.' } } });
    const onCreated = renderDialog();
    fireEvent.click(screen.getByText('pages.technologies.create.manualLink'));
    fireEvent.change(screen.getByLabelText('workspace.technology.fields.name'), { target: { value: 'Microsoft SQL Server' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('workspace.technology.messages.duplicateName')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('pages.technologies.create.backToCatalog'));
    expect(screen.getByLabelText('pages.technologies.create.searchLabel')).toBeTruthy();
  });
});
