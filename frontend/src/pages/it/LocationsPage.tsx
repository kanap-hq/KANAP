import React, { useCallback, useMemo, useRef } from 'react';
import { Button, Stack } from '@mui/material';
import { ICellRendererParams } from 'ag-grid-community';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { useAuth } from '../../auth/AuthContext';
import ForbiddenPage from '../ForbiddenPage';
import { COUNTRY_OPTIONS } from '../../constants/isoOptions';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';

import { useTranslation } from 'react-i18next';
import { setListFiltersParam } from '../../lib/listContext';
type LocationRow = {
  id: string;
  location_reference: string;
  name: string;
  hosting_type: string;
  provider: string | null;
  operating_company_name?: string | null;
  country_iso: string | null;
  city: string | null;
  servers_count?: number;
  sub_locations?: string[];
  created_at: string;
};

export default function LocationsPage() {
  const { t } = useTranslation(['it', 'common']);
  const navigate = useNavigate();
  const { hasLevel } = useAuth();
  const { labelFor, settings, byField } = useItOpsEnumOptions();

  if (!hasLevel('locations', 'reader')) {
    return <ForbiddenPage />;
  }
  const hostingTypeCategory = useCallback(
    (code?: string) => {
      if (!code) return 'cloud';
      const opt = settings?.hostingTypes?.find((item) => item.code === code);
      return opt?.category === 'on_prem' ? 'on_prem' : 'cloud';
    },
    [settings?.hostingTypes],
  );

  const countryNameMap = useMemo(() => {
    return new Map(COUNTRY_OPTIONS.map((c) => [c.code.toUpperCase(), c.name]));
  }, []);

  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const state = lastQueryRef.current;
    if (state?.sort) sp.set('sort', state.sort);
    if (state?.q) sp.set('q', state.q);
    setListFiltersParam(sp, '/locations', state?.filters);
    return sp;
  }, []);

  const getLocationHref = useCallback((row: LocationRow) => {
    const sp = buildWorkspaceSearch();
    const qs = sp.toString();
    return `/it/locations/${row.location_reference || row.id}/overview${qs ? `?${qs}` : ''}`;
  }, [buildWorkspaceSearch]);

  const ClickableCell = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<LocationRow, any>> = (params) => (
      <LinkCellRenderer
        {...params}
        linkType="internal"
        getHref={getLocationHref}
        onNavigate={(href) => navigate(href)}
      />
    );
    return Cell;
  }, [getLocationHref, navigate]);

  const columns: EnhancedColDef<LocationRow>[] = [
    {
      headerName: t('pages.locations.columns.code'),
      field: 'location_reference',
      minWidth: 110,
      filter: 'agTextColumnFilter',
      cellRenderer: ClickableCell,
      cellStyle: {
        fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
        fontSize: '12px',
        color: 'var(--kanap-text-secondary)',
        fontVariantNumeric: 'tabular-nums',
      },
    },
    { headerName: t('common.name'), field: 'name', minWidth: 220, filter: 'agTextColumnFilter', cellRenderer: ClickableCell },
    {
      headerName: t('pages.locations.columns.hostingType'),
      field: 'hosting_type',
      width: 160,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: byField.hostingType.map((opt) => ({ value: opt.code, label: labelFor('hostingType', opt.code) })),
        searchable: false,
      },
      valueFormatter: (p) => labelFor('hostingType', p.value) || p.value || '',
      cellRenderer: ClickableCell,
    },
    {
      headerName: t('pages.locations.columns.providerCompany'),
      field: 'provider',
      minWidth: 200,
      valueGetter: (params) => {
        const row = params.data as LocationRow | undefined;
        if (!row) return '';
        const category = hostingTypeCategory(row.hosting_type);
        if (category === 'on_prem') {
          return row.operating_company_name || '—';
        }
        if (row.provider) {
          return labelFor('serverProvider', row.provider) || row.provider;
        }
        return '—';
      },
      cellRenderer: ClickableCell,
    },
    {
      headerName: t('pages.locations.columns.country'),
      field: 'country_iso',
      width: 180,
      valueFormatter: (p) => {
        const raw = (p.value || '').toString().toUpperCase();
        if (!raw) return '';
        const name = countryNameMap.get(raw) || raw;
        return `${name} (${raw})`;
      },
      cellRenderer: ClickableCell,
    },
    { headerName: t('pages.locations.columns.city'), field: 'city', width: 160, filter: 'agTextColumnFilter', cellRenderer: ClickableCell },
    {
      headerName: 'Sub-locations',
      field: 'sub_locations',
      width: 130,
      filter: false,
      sortable: false,
      valueGetter: (params) => (params.data?.sub_locations || []).length,
      valueFormatter: (p) => (p.value == null ? '0' : String(p.value)),
      cellRenderer: ClickableCell,
      cellStyle: {
        color: 'var(--kanap-text-secondary)',
        fontVariantNumeric: 'tabular-nums',
      },
    },
    {
      headerName: t('pages.locations.columns.assets'),
      field: 'servers_count',
      width: 110,
      filter: false,
      valueFormatter: (p) => (p.value == null ? '0' : String(p.value)),
      cellRenderer: ClickableCell,
      cellStyle: {
        color: 'var(--kanap-text-secondary)',
        fontVariantNumeric: 'tabular-nums',
      },
    },
    { headerName: t('pages.assets.columns.created'), field: 'created_at', width: 160, cellRenderer: ClickableCell },
  ];

  const actions = (
    <Stack direction="row" spacing={1}>
      {hasLevel('locations', 'member') && (
        <Button variant="contained" onClick={() => navigate('/it/locations/new/overview')}>
          Add Location
        </Button>
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('pages.locations.title')} actions={actions} />
      <ServerDataGrid<LocationRow>
        columns={columns}
        endpoint="/locations"
        showRowCount
        queryKey="locations"
        defaultSort={{ field: 'created_at', direction: 'DESC' }}
        enableSearch
        enableColumnChooser
        columnPreferencesKey="it-locations"
        onQueryStateChange={(state) => {
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
        }}
      />
    </>
  );
}
