import useApplicationClassificationCatalog from '../../hooks/useApplicationClassificationCatalog';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Button, Stack } from '@mui/material';
import { ICellRendererParams } from 'ag-grid-community';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { StatusDot } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
import ForbiddenPage from '../ForbiddenPage';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import { useTranslation } from 'react-i18next';
import { classificationText } from '../../utils/applicationClassification';

type ConnectionRow = {
  id: string;
  connection_reference: string;
  name: string;
  topology: 'server_to_server' | 'multi_server';
  lifecycle: string;
  criticality: string;
  data_class: string;
  contains_pii: boolean;
  risk_mode: 'manual' | 'derived';
  effective_criticality?: string;
  effective_data_class?: string;
  effective_contains_pii?: boolean;
  classification_incomplete?: boolean;
  derived_interface_count?: number;
  linked_interface_count?: number;
  source_label?: string | null;
  destination_label?: string | null;
  protocol_labels?: string[];
  multi_server_count?: number;
  created_at: string;
};

const MONO_STYLE = {
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontSize: '12px',
  color: 'var(--kanap-text-secondary)',
  fontVariantNumeric: 'tabular-nums' as const,
};

const TABULAR_STYLE = {
  fontVariantNumeric: 'tabular-nums' as const,
  color: 'var(--kanap-text-secondary)',
};

const DOT_COLORS: Record<string, string> = {
  active: '#10B981',
  planned: '#9CA3AF',
  deprecated: '#E8920F',
  retired: '#9CA3AF',
};

const CRIT_DOT_COLORS: Record<string, string> = {
  business_critical: '#E8920F',
  high: '#F0A830',
  medium: '#9CA3AF',
  low: '#6B7280',
};

function topologyLabel(v: string): string {
  if (v === 'server_to_server') return 'Server to server';
  if (v === 'multi_server') return 'Multi-server';
  return v || '';
}

export default function ConnectionsPage() {
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const { t } = useTranslation(['it', 'common']);
  const navigate = useNavigate();
  const { hasLevel } = useAuth();
  const { labelFor, byField } = useItOpsEnumOptions();
  const gridApiRef = useRef<any>(null);
  const [selectedRows, setSelectedRows] = useState<ConnectionRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const state = lastQueryRef.current;
    if (state?.sort) sp.set('sort', state.sort);
    if (state?.q) sp.set('q', state.q);
    if (state?.filters && Object.keys(state.filters || {}).length > 0) {
      sp.set('filters', JSON.stringify(state.filters));
    }
    return sp;
  }, []);

  const getConnectionHref = useCallback((row: ConnectionRow) => {
    const sp = buildWorkspaceSearch();
    const qs = sp.toString();
    return `/it/connections/${row.connection_reference || row.id}/overview${qs ? `?${qs}` : ''}`;
  }, [buildWorkspaceSearch]);

  const ClickToWorkspace = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<ConnectionRow, any>> = (params) => (
      <LinkCellRenderer
        {...params}
        linkType="internal"
        getHref={getConnectionHref}
        onNavigate={(href) => navigate(href)}
      />
    );
    return Cell;
  }, [getConnectionHref, navigate]);

  const DotCellRenderer = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<ConnectionRow, any> & { colorMap: Record<string, string>; labelFn: (v: string) => string }> = (
      params: any,
    ) => {
      const value = String(params.value || '');
      const color = params.colorMap[value] || '#9CA3AF';
      return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, height: '100%' }}>
          <StatusDot color={color} />
          <Box component="span" sx={{ fontSize: 13 }}>{params.labelFn(value)}</Box>
        </Box>
      );
    };
    return Cell;
  }, []);

  if (!hasLevel('infrastructure', 'reader')) {
    return <ForbiddenPage />;
  }

  const columns: EnhancedColDef<ConnectionRow>[] = [
    {
      headerName: 'Reference',
      field: 'connection_reference',
      width: 110,
      cellRenderer: ClickToWorkspace,
      cellStyle: MONO_STYLE,
    },
    {
      headerName: 'Name',
      field: 'name',
      minWidth: 220,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: 'Topology',
      field: 'topology',
      width: 140,
      valueFormatter: (p) => topologyLabel(String(p.value || '')),
      cellRenderer: ClickToWorkspace,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: ['server_to_server', 'multi_server'].map((value) => ({ value, label: topologyLabel(value) })),
        searchable: false,
      },
    },
    {
      headerName: 'Endpoints',
      field: 'source_label',
      minWidth: 240,
      sortable: false,
      filter: false,
      cellRenderer: (params: ICellRendererParams<ConnectionRow>) => {
        const row = params.data;
        if (!row) return null;
        if (row.topology === 'server_to_server') {
          const src = row.source_label || '?';
          const dst = row.destination_label || '?';
          return (
            <LinkCellRenderer
              {...(params as any)}
              value={`${src} → ${dst}`}
              linkType="internal"
              getHref={getConnectionHref}
              onNavigate={(href: string) => navigate(href)}
            />
          );
        }
        const count = row.multi_server_count || 0;
        return (
          <LinkCellRenderer
            {...(params as any)}
            value={`${count} servers`}
            linkType="internal"
            getHref={getConnectionHref}
            onNavigate={(href: string) => navigate(href)}
          />
        );
      },
    },
    {
      headerName: 'Protocols',
      field: 'protocol_labels',
      minWidth: 200,
      sortable: false,
      filter: false,
      valueFormatter: (p) => {
        const list = (p.value || []) as string[];
        if (list.length === 0) return '';
        if (list.length <= 3) return list.join(', ');
        return `${list.slice(0, 2).join(', ')} +${list.length - 2}`;
      },
      cellRenderer: ClickToWorkspace,
      cellStyle: { color: 'var(--kanap-text-secondary)' },
    },
    {
      headerName: 'Criticality',
      field: 'criticality',
      width: 150,
      cellRenderer: (params: ICellRendererParams<ConnectionRow>) => {
        const row = params.data;
        const value = String((row?.risk_mode === 'derived' ? row.effective_criticality : row?.criticality) ?? '');
        const isDerived = row?.risk_mode === 'derived';
        const color = CRIT_DOT_COLORS[value] || '#9CA3AF';
        return (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, height: '100%' }}>
            <StatusDot color={color} />
            <Box component="span" sx={{ fontSize: 13 }}>
              {classificationCatalog?.businessCriticalityLevels.find((item) => item.code === value)?.label || value || 'Not set'}
              {isDerived && (
                <Box component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', ml: 0.5 }}>
                  (derived)
                </Box>
              )}
              {row?.classification_incomplete && (
                <Box component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', ml: 0.5 }}>
                  ({classificationText('Incomplete inheritance')})
                </Box>
              )}
            </Box>
          </Box>
        );
      },
      // The list filters, sorts and pages on the effective value the cell shows.
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: [
          ...(classificationCatalog?.businessCriticalityLevels ?? []).map((level) => ({ value: level.code, label: level.label })),
          { value: null },
        ],
        searchable: false,
      },
    },
    {
      headerName: 'Data class',
      field: 'data_class',
      width: 130,
      valueFormatter: (p) => {
        const row = p.data as ConnectionRow | undefined;
        // A derived connection shows its effective value, unknown (not set) when no interface is linked.
        const value = row?.risk_mode === 'derived' ? row.effective_data_class : p.value;
        return classificationCatalog?.dataClasses.find((item) => item.code === value)?.label || (value || 'Not set');
      },
      cellRenderer: ClickToWorkspace,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: [
          ...(classificationCatalog?.dataClasses ?? []).map((level) => ({ value: level.code, label: level.label })),
          { value: null },
        ],
        searchable: false,
      },
    },
    {
      headerName: 'PII',
      field: 'contains_pii',
      width: 80,
      valueFormatter: (p) => {
        const row = p.data as ConnectionRow | undefined;
        const value = typeof row?.effective_contains_pii === 'boolean' ? row.effective_contains_pii : p.value;
        return value ? t('enums.yesNo.yes') : t('enums.yesNo.no');
      },
      cellRenderer: ClickToWorkspace,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: [
          { value: 'true', label: t('enums.yesNo.yes') },
          { value: 'false', label: t('enums.yesNo.no') },
        ],
        searchable: false,
      },
    },
    {
      headerName: 'Lifecycle',
      field: 'lifecycle',
      width: 130,
      cellRenderer: (params: ICellRendererParams<ConnectionRow>) => {
        const value = String(params.value || '');
        const color = DOT_COLORS[value] || '#9CA3AF';
        const label = labelFor('lifecycleStatus', value) || value;
        return (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, height: '100%' }}>
            <StatusDot color={color} />
            <Box component="span" sx={{ fontSize: 13 }}>{label}</Box>
          </Box>
        );
      },
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: byField.lifecycleStatus.map((opt) => ({ value: opt.code, label: labelFor('lifecycleStatus', opt.code) })),
        searchable: false,
      },
    },
    {
      headerName: 'Linked interfaces',
      field: 'linked_interface_count',
      width: 130,
      sortable: false,
      filter: false,
      cellStyle: { ...TABULAR_STYLE, textAlign: 'right' as const },
      valueFormatter: (p) => String(p.value ?? 0),
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: 'Created',
      field: 'created_at',
      width: 130,
      cellRenderer: ClickToWorkspace,
    },
  ];

  const actions = (
    <Stack direction="row" spacing={1}>
      {hasLevel('infrastructure', 'member') && (
        <Button variant="contained" onClick={() => navigate('/it/connections/new/overview')}>
          Add connection
        </Button>
      )}
      {hasLevel('infrastructure', 'admin') && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/connections/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => setRefreshKey((k) => k + 1)}
          label={t('pages.connections.deleteConnection')}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('pages.connections.title')} actions={actions} />
      <ServerDataGrid<ConnectionRow>
        columns={columns}
        endpoint="/connections"
        showRowCount
        queryKey="connections"
        enableSearch
        enableColumnChooser
        defaultSort={{ field: 'connection_reference', direction: 'ASC' }}
        columnPreferencesKey="it-connections"
        refreshKey={refreshKey}
        enableRowSelection={hasLevel('infrastructure', 'admin')}
        onSelectionChanged={setSelectedRows}
        onQueryStateChange={(state) => {
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
        }}
        onGridApiReady={(api) => {
          gridApiRef.current = api;
        }}
      />
    </>
  );
}
