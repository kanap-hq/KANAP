import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The infinite row model draws a placeholder before the block arrives. That row has no data, and a
 * custom cell renderer would build its label from `undefined` (the status column shows
 * `statuses.request.undefined`). The grid keeps the default renderer until the row exists.
 */

const gridProps = vi.hoisted(() => ({ current: null as null | { columnDefs?: Array<Record<string, any>> } }));

vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('ag-grid-react', () => ({
  AgGridReact: (props: { columnDefs?: Array<Record<string, any>> }) => {
    gridProps.current = props;
    return null;
  },
}));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [], total: 0 } })) } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ profile: null }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

import ServerDataGrid from './ServerDataGrid';

/** The status renderer the lists used: the key is the value, including when the value is missing. */
function rawStatusRenderer(props: { value?: string }) {
  return <span>{`statuses.request.${props.value}`}</span>;
}

function statusColumn() {
  return gridProps.current?.columnDefs?.find((col) => col.field === 'status');
}

describe('ServerDataGrid loading rows', () => {
  beforeEach(() => {
    gridProps.current = null;
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });

  it('skips a custom renderer while the row has no data, and uses it once the row arrives', () => {
    render(
      <MemoryRouter>
        <ServerDataGrid<{ id: string; name?: string; status?: string }>
          columns={[
            { field: 'name', headerName: 'Name' },
            { field: 'status', headerName: 'Status', cellRenderer: rawStatusRenderer },
          ]}
          endpoint="/things"
          queryKey="things"
        />
      </MemoryRouter>,
    );

    const column = statusColumn();
    expect(column?.cellRenderer).toBeUndefined();
    const select = column?.cellRendererSelector as (params: { data?: unknown; node?: { rowPinned?: string; data?: unknown } }) => { component?: unknown } | undefined;

    // The renderer itself would print the raw key. The selector must not hand it a loading row.
    const raw = render(React.createElement(rawStatusRenderer, { value: undefined }));
    expect(raw.container.textContent).toBe('statuses.request.undefined');
    raw.unmount();

    expect(select({ data: undefined, node: {} })).toBeUndefined();
    expect(select({ data: null, node: { data: null } })).toBeUndefined();
    // A total row stays on the default renderer, loaded or not.
    expect(select({ data: { id: '1', status: 'candidate' }, node: { rowPinned: 'bottom', data: { id: '1' } } })).toBeUndefined();

    const loaded = select({ data: { id: '1', status: 'candidate' }, node: { data: { id: '1', status: 'candidate' } } });
    expect(loaded?.component).toBe(rawStatusRenderer);
    const cell = render(React.createElement(loaded!.component as React.FC<{ value?: string }>, { value: 'candidate' }));
    expect(cell.container.textContent).toBe('statuses.request.candidate');
    cell.unmount();
  });
});
