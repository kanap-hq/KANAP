import useApplicationClassificationCatalog from '../../hooks/useApplicationClassificationCatalog';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Checkbox,
  Typography,
  CircularProgress,
  Link,
  useTheme,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ICellRendererParams } from 'ag-grid-community';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PageHeader from '../../components/PageHeader';
import { useNotify } from '../../components/notify/NotifyProvider';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import CheckboxSetFilter, { type CheckboxSetFilterOption } from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import { LinkCellRenderer, wholeCellLinkSx } from '../../components/grid/renderers';
import { getEnvDotColor } from '../../components/grid/renderers/StatusCellRenderer';
import { StatusDot } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
import ForbiddenPage from '../ForbiddenPage';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import { recordsInUseCheck } from '../../utils/deleteCheck';
import api from '../../api';

import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { classificationText } from '../../utils/applicationClassification';
import { environmentLabel } from '../../utils/applicationEnvironments';
import { setListFiltersParam } from '../../lib/listContext';
import { countValueFormatter } from '../../components/grid/countValueFormatter';
type InterfaceRow = {
  id: string;
  interface_reference: string;
  interface_id?: string | null;
  name: string;
  business_process_id?: string | null;
  business_process_name?: string | null;
  source_application_name: string;
  target_application_name: string;
  lifecycle: string;
  criticality: string;
  classification_incomplete?: boolean;
  data_category: string;
  contains_pii: boolean;
  bindings_count?: number;
  environment_coverage?: number;
  binding_environments?: string[];
  created_at: string;
};

export default function InterfacesPage() {
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const businessLabel = (code?: string | null) => classificationCatalog?.businessCriticalityLevels.find((item) => item.code === code)?.label || code || classificationText('Not set');
  const { t } = useTranslation(['it', 'common']);
  const locale = useLocale();
  const theme = useTheme();
  const navigate = useNavigate();
  const { hasLevel } = useAuth();
  const { labelFor, byField } = useItOpsEnumOptions();
  const gridApiRef = useRef<any>(null);
  const [selectedRows, setSelectedRows] = useState<InterfaceRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [copyBindings, setCopyBindings] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const notify = useNotify();
  const canCreate = hasLevel('applications', 'manager');
  const canAdmin = hasLevel('applications', 'admin');

  const isPlainLeftClick = useCallback((event: React.MouseEvent) => {
    return (
      event.button === 0
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.altKey
    );
  }, []);

  // The grid's sort, search and filters, so prev/next in the workspace walks the filtered set.
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const getInterfaceHref = useCallback((row: InterfaceRow | null | undefined) => {
    if (!row?.id) return undefined;
    const sp = new URLSearchParams();
    const state = lastQueryRef.current;
    if (state?.sort) sp.set('sort', state.sort);
    if (state?.q) sp.set('q', state.q);
    setListFiltersParam(sp, '/interfaces', state?.filters);
    const qs = sp.toString();
    return `/it/interfaces/${row.interface_reference || row.id}/overview${qs ? `?${qs}` : ''}`;
  }, []);

  const handleInternalNavigate = useCallback((event: React.MouseEvent, href: string | undefined) => {
    if (!href) return;
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    navigate(href);
  }, [isPlainLeftClick, navigate]);

  const handleOpenDuplicateDialog = () => {
    if (selectedRows.length !== 1) return;
    setCopyBindings(false);
    setDuplicateError(null);
    setDuplicateDialogOpen(true);
  };

  const handleCloseDuplicateDialog = () => {
    if (duplicating) return;
    setDuplicateDialogOpen(false);
  };

  const handleConfirmDuplicate = async () => {
    if (selectedRows.length !== 1) return;
    const row = selectedRows[0];
    setDuplicating(true);
    setDuplicateError(null);
    try {
      const response = await api.post<InterfaceRow>(`/interfaces/${row.id}/duplicate`, {
        copyBindings,
      });
      const newInterface = response.data;
      notify({ message: t('it:pages.interfaces.duplicated', { name: newInterface.name }) });
      setRefreshKey((k) => k + 1);
      gridApiRef.current?.deselectAll?.();
      setDuplicateDialogOpen(false);
    } catch (error: any) {
      console.error('Duplicate error:', error);
      setDuplicateError(getApiErrorMessage(error, t, t('messages.duplicateInterfaceFailed')));
    } finally {
      setDuplicating(false);
    }
  };

  const ClickToWorkspace = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<InterfaceRow, any>> = (params) => (
      <LinkCellRenderer
        {...params}
        linkType="internal"
        getHref={getInterfaceHref}
        onNavigate={(href) => navigate(href)}
      />
    );
    return Cell;
  }, [getInterfaceHref, navigate]);

  const EnvPills = useMemo(() => {
    const mode = theme.palette.mode;
    const Cell: React.FC<ICellRendererParams<InterfaceRow, any>> = (params) => {
      const envs = (params.data?.binding_environments || []) as string[];
      if (!envs || envs.length === 0) return null;
      return (
        <Link
          href={getInterfaceHref(params.data as InterfaceRow)}
          onClick={(event) => handleInternalNavigate(event, getInterfaceHref(params.data as InterfaceRow))}
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            cursor: 'pointer',
            alignItems: 'center',
            height: '100%',
            color: 'inherit',
            textDecoration: 'none',
            ...wholeCellLinkSx,
          }}
        >
          {envs.map((env) => (
            <Box
              key={env}
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '0.75rem',
                fontWeight: 500,
                color: 'text.primary',
                lineHeight: 1,
              }}
            >
              <StatusDot color={getEnvDotColor(env, mode)} />
              {environmentLabel(t, env)}
            </Box>
          ))}
        </Link>
      );
    };
    return Cell;
  }, [getInterfaceHref, handleInternalNavigate, t, theme.palette.mode]);

  // Business processes the interfaces use, read through the interfaces permission.
  const getBusinessProcessValues = useCallback(async (): Promise<CheckboxSetFilterOption[]> => {
    const res = await api.get<Array<{ value: string | null; label: string | null }>>('/interfaces/filter-values/business-processes');
    return (res.data || []).map((option) => ({ value: option.value, label: option.label ?? undefined }));
  }, []);

  if (!hasLevel('applications', 'reader')) {
    return <ForbiddenPage resource="applications" level="reader" />;
  }

  // Set filters send codes; the options show the same labels as the cells.
  const setFilter = (values: CheckboxSetFilterOption[]) => ({
    filter: CheckboxSetFilter,
    floatingFilterComponent: CheckboxSetFloatingFilter,
    filterParams: { values, searchable: false },
  });
  const yesNoValues: CheckboxSetFilterOption[] = [
    { value: 'true', label: t('enums.yesNo.yes') },
    { value: 'false', label: t('enums.yesNo.no') },
  ];

  const columns: EnhancedColDef<InterfaceRow>[] = [
    {
      headerName: t('pages.interfaces.columns.reference'),
      field: 'interface_reference',
      width: 150,
      cellRenderer: ClickToWorkspace,
      cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
    },
    {
      headerName: t('pages.interfaces.columns.interfaceCode'),
      field: 'interface_id',
      width: 170,
      cellRenderer: ClickToWorkspace,
      cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
      defaultHidden: true,
    },
    {
      headerName: t('common.name'),
      field: 'name',
      minWidth: 220,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.interfaces.columns.environments'),
      field: 'binding_environments',
      width: 200,
      sortable: false,
      cellRenderer: EnvPills,
    },
    { headerName: t('pages.interfaces.columns.sourceApp'), field: 'source_application_name', width: 200, cellRenderer: ClickToWorkspace },
    {
      headerName: t('pages.interfaces.columns.targetApp'),
      field: 'target_application_name',
      width: 200,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('common.lifecycle'),
      field: 'lifecycle',
      width: 140,
      valueFormatter: (p) => labelFor('lifecycleStatus', p.value) || p.value || '',
      ...setFilter(byField.lifecycleStatus.map((opt) => ({ value: opt.code, label: labelFor('lifecycleStatus', opt.code) }))),
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.connections.columns.criticality'),
      field: 'criticality',
      valueFormatter: (p) => `${businessLabel(p.value)}${p.data?.classification_incomplete ? ` (${classificationText('Incomplete inheritance')})` : ''}`,
      width: 140,
      ...setFilter([
        ...(classificationCatalog?.businessCriticalityLevels ?? []).map((level) => ({ value: level.code, label: level.label })),
        { value: null },
      ]),
      cellRenderer: ClickToWorkspace,
    },
    { headerName: t('pages.assets.columns.created'), field: 'created_at', width: 180, filter: 'agDateColumnFilter', valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale), cellRenderer: ClickToWorkspace },
    {
      headerName: t('pages.interfaces.columns.businessProcess'),
      field: 'business_process_id',
      width: 200,
      valueFormatter: (p) => p.data?.business_process_name || '',
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: getBusinessProcessValues },
      cellRenderer: ClickToWorkspace,
      defaultHidden: true,
    },
    {
      headerName: t('pages.interfaces.columns.dataCategory'),
      field: 'data_category',
      width: 120,
      ...setFilter(byField.interfaceDataCategory.map((opt) => ({ value: opt.code, label: labelFor('interfaceDataCategory', opt.code) }))),
      valueFormatter: (p) => labelFor('interfaceDataCategory', p.value) || p.value || '',
      cellRenderer: ClickToWorkspace,
      defaultHidden: true,
    },
    {
      headerName: t('pages.interfaces.columns.containsPii'),
      field: 'contains_pii',
      width: 130,
      ...setFilter(yesNoValues),
      valueFormatter: (p) => (p.value ? t('enums.yesNo.yes') : t('enums.yesNo.no')),
      cellRenderer: ClickToWorkspace,
      defaultHidden: true,
    },
    {
      headerName: t('pages.interfaces.columns.envCoverage'),
      field: 'environment_coverage',
      width: 140,
      sortable: false,
      filter: false,
      valueFormatter: (p) => countValueFormatter({ value: p.value ?? 0 }),
      cellRenderer: ClickToWorkspace,
      defaultHidden: true,
    },
    {
      headerName: t('pages.interfaces.columns.bindings'),
      field: 'bindings_count',
      width: 120,
      sortable: false,
      filter: false,
      valueFormatter: (p) => countValueFormatter({ value: p.value ?? 0 }),
      cellRenderer: ClickToWorkspace,
      defaultHidden: true,
    },
  ];

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button variant="action-primary" onClick={() => navigate('/it/interfaces/new/overview')}>
          {t('pages.interfaces.addInterface')}
        </Button>
      )}
      {canCreate && (
        <Button
          variant="action"
          startIcon={<ContentCopyIcon sx={{ fontSize: '14px !important' }} />}
          onClick={handleOpenDuplicateDialog}
          disabled={selectedRows.length !== 1 || duplicating}
        >
          {t('pages.interfaces.duplicateInterface')}
        </Button>
      )}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/interfaces/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => {
            setRefreshKey((k) => k + 1);
          }}
          // Asked on click: interfaces with bindings are kept, unless the option deletes their bindings too.
          checkDelete={async (ids) => ({ ...(await recordsInUseCheck('/interfaces', ids)), cascadeLifts: ['INTERFACE_HAS_BINDINGS'] })}
          itemLabels={{
            toDelete: (count) => t('pages.interfaces.delete.toDelete', { count }),
            kept: (count) => t('pages.interfaces.delete.kept', { count }),
            deleted: (count) => t('pages.interfaces.delete.deleted', { count }),
          }}
          cascadeOption={{
            label: t('pages.interfaces.alsoDeleteBindings'),
            description: t('pages.interfaces.deleteBindingsDescription'),
            apiKey: 'deleteRelatedBindings',
          }}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('pages.interfaces.title')} actions={actions} />
      <ServerDataGrid<InterfaceRow>
        columns={columns}
        endpoint="/interfaces"
        showRowCount
        queryKey="interfaces"
        enableColumnChooser
        enableSearch
        defaultSort={{ field: 'interface_reference', direction: 'ASC' }}
        columnPreferencesKey="it-interfaces"
        refreshKey={refreshKey}
        enableRowSelection={canAdmin}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => {
          gridApiRef.current = api;
        }}
        onQueryStateChange={(state) => {
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
        }}
      />

      {/* Duplicate Interface Dialog */}
      <Dialog open={duplicateDialogOpen} onClose={handleCloseDuplicateDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{t('it:pages.interfaces.duplicateDialogTitle')}</DialogTitle>
        <DialogContent>
          {duplicateError && <Alert severity="error" sx={{ mb: 2 }}>{duplicateError}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('it:pages.interfaces.duplicateDescription', { name: selectedRows[0]?.name || t('it:pages.interfaces.thisInterface') })}
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={copyBindings}
                onChange={(e) => setCopyBindings(e.target.checked)}
                disabled={duplicating}
              />
            }
            label={t('it:pages.interfaces.copyEnvBindings')}
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
            {t('it:pages.interfaces.copyEnvBindingsDescription')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="action" onClick={handleCloseDuplicateDialog} disabled={duplicating}>
            {t('common:buttons.cancel')}
          </Button>
          <Button
            onClick={handleConfirmDuplicate}
            variant="action-primary"
            disabled={duplicating}
            startIcon={duplicating ? <CircularProgress size={16} /> : undefined}
          >
            {duplicating ? t('it:pages.interfaces.duplicating') : t('it:pages.interfaces.duplicate')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
