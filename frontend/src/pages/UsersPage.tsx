import React, { useCallback, useMemo, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, type ListRequest } from '../components/ServerDataGrid';
import { ICellRendererParams } from 'ag-grid-community';
import { Button, Stack, Box, IconButton, Menu, MenuItem, useTheme } from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { wholeCellLinkSx } from '../components/grid/renderers';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { recordRefusal, recordsInUseCheck } from '../utils/deleteCheck';
import { deleteFailureReason } from '../utils/deleteRefusal';
import { getApiErrorMessage } from '../utils/apiErrorMessage';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import { useTranslation } from 'react-i18next';
import ForbiddenPage from './ForbiddenPage';
import { StatusDot, useKanapDialogs } from '../components/design';
import { getDotColor, USER_ACCOUNT_STATUS_COLORS } from '../utils/statusColors';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import { useDataAccessLimited } from '../auth/dataAccess';
import { userAccessColumnText } from '../components/dataAccess/dataAccess';
import UserDialog, { type UserDialogTab } from './users/UserDialog';
import { roleLabel } from '../utils/roleLabel';
import { ImportLabel } from '../components/csv/importFiles';

/**
 * Cells of the users grid. They stay at module level: a renderer declared in the page is a new
 * component on every render, the column list follows it, and AG Grid remounts the cell under the
 * pointer. A selection update between mouse down and mouse up then drops the click. Callbacks
 * arrive through `cellRendererParams` and read the latest page handlers from a ref.
 */
type UserOpenParams = ICellRendererParams<any, any> & {
  onOpen?: (row: any) => void;
};

function UserOpenCell(params: UserOpenParams) {
  return (
    <Box
      component="span"
      sx={{ cursor: 'pointer', ...wholeCellLinkSx }}
      onClick={() => params.onOpen?.(params.data)}
    >
      {params.valueFormatted ?? params.value}
    </Box>
  );
}

type UserStatusParams = ICellRendererParams<any, any> & {
  statusLabel?: (key: string) => string;
  mode?: 'light' | 'dark';
};

function UserStatusCell(params: UserStatusParams) {
  const row = params.data;
  if (!row) return null;
  const key = row.pending_access ? 'pending_access' : row.status;
  const color = getDotColor(USER_ACCOUNT_STATUS_COLORS[key] ?? 'default', params.mode ?? 'light');
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '100%' }}>
      <StatusDot color={color} />
      <Box component="span" sx={{ color, fontSize: 12.5, fontWeight: 500 }}>
        {params.statusLabel?.(`users.status.${key}`) ?? ''}
      </Box>
    </Box>
  );
}

type UserRowActionsParams = ICellRendererParams<any, any> & {
  menuLabel?: string;
  onOpenMenu?: (event: React.MouseEvent<HTMLButtonElement>, row: any) => void;
};

function UserRowActionsCell(params: UserRowActionsParams) {
  return (
    <IconButton
      size="small"
      aria-label={params.menuLabel}
      onClick={(event) => params.onOpenMenu?.(event, params.data)}
    >
      <MoreHorizIcon fontSize="small" />
    </IconButton>
  );
}

type UsersPageActions = {
  openUser: (row: any) => void;
  openMenu: (event: React.MouseEvent<HTMLButtonElement>, row: any) => void;
};

export default function UsersPage() {
  const { t } = useTranslation(['admin', 'common']);
  const dialogs = useKanapDialogs();
  const locale = useLocale();
  const { hasLevel, profile } = useAuth();
  const [userDialog, setUserDialog] = useState<{
    mode: 'create' | 'edit';
    id?: string | number;
    name?: string;
    tab?: UserDialogTab;
  } | null>(null);
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const [inviting, setInviting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  // Position-anchored (not element-anchored): the AG Grid cell re-renders on
  // state change, which would detach an element anchor and snap the menu to
  // the viewport corner.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [menuRow, setMenuRow] = useState<any>(null);
  const theme = useTheme();

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  // The list on screen: the CSV export follows it.
  const [listRequest, setListRequest] = useState<ListRequest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const gridApiRef = useRef<any>(null);
  const pageRef = useRef<UsersPageActions>({ openUser: () => {}, openMenu: () => {} });
  const canManageUsers = hasLevel('users', 'admin');
  const dataAccessLimited = useDataAccessLimited();
  const canAdminDataAccess = canManageUsers && !dataAccessLimited;
  const [dataAccessAnyLimited, setDataAccessAnyLimited] = useState(false);

  // Seat-controlled status actions
  const enableUser = async (id: string) => { await api.post(`/users/${id}/enable`); setRefreshKey((k)=>k+1); };
  const disableUser = async (id: string) => { await api.post(`/users/${id}/disable`); setRefreshKey((k)=>k+1); };
  const inviteUser = async (id: string) => { await api.post(`/users/${id}/invite`); setRefreshKey((k)=>k+1); };

  const userDisplayName = (row: any) =>
    `${row?.first_name ?? ''} ${row?.last_name ?? ''}`.trim() || row?.email || '';

  const closeRowMenu = () => setMenuPos(null);

  // One recipient is named; several are a count. Nothing is sent until this is confirmed.
  const confirmSendInvite = (rows: Array<{ email?: string }>) => dialogs.confirm({
    message: t('users.messages.inviteConfirm', {
      count: rows.length,
      ...(rows.length === 1 ? { email: rows[0]?.email ?? '' } : {}),
    }),
    confirmLabel: t('users.actions.sendInvite'),
  });

  const handleRowDisable = async (row: any) => {
    closeRowMenu();
    const okToGo = await dialogs.confirm({
      message: t('users.messages.disableConfirm', { name: userDisplayName(row) }),
      confirmLabel: t('users.actions.disable'),
      intent: 'danger',
    });
    if (!okToGo) return;
    try { await disableUser(row.id); } catch (e: any) { await dialogs.alert(getApiErrorMessage(e, t, String(e))); }
  };
  const handleRowEnable = async (row: any) => {
    closeRowMenu();
    try { await enableUser(row.id); } catch (e: any) { await dialogs.alert(getApiErrorMessage(e, t, String(e))); }
  };
  const handleRowInvite = async (row: any) => {
    closeRowMenu();
    if (!(await confirmSendInvite([row]))) return;
    try {
      await inviteUser(row.id);
      await dialogs.alert(t('users.messages.inviteSentOne', { email: row.email }));
    } catch (e: any) { await dialogs.alert(getApiErrorMessage(e, t, String(e))); }
  };
  const handleRowReset = async (row: any) => {
    closeRowMenu();
    try {
      await api.post('/auth/password-reset/request', { email: row.email });
      await dialogs.alert(t('users.messages.resetSent', { email: row.email }));
    } catch (e: any) { await dialogs.alert(getApiErrorMessage(e, t, String(e))); }
  };
  const handleRowDelete = async (row: any) => {
    closeRowMenu();
    // Asked first: one's own account gets the refusal and why, with Close only.
    const refusal = await recordRefusal('/users', row.id);
    if (refusal) {
      await dialogs.alert({
        title: t('common:delete.recordTitle', { name: userDisplayName(row) }),
        message: deleteFailureReason(refusal, t, locale),
      });
      return;
    }
    const okToGo = await dialogs.confirm({
      message: t('users.messages.deleteConfirm', { name: userDisplayName(row) }),
      confirmLabel: t('users.actions.delete'),
      intent: 'danger',
    });
    if (!okToGo) return;
    try {
      await api.delete(`/users/${row.id}`);
      setRefreshKey((k) => k + 1);
    } catch (e: any) { await dialogs.alert(getApiErrorMessage(e, t, t('common:delete.failedGeneric'))); }
  };
  const handleDeactivateSelected = async () => {
    if (!selectedRows.length) return;
    const okToGo = await dialogs.confirm({
      message: t('users.messages.disableSelectedConfirm', { count: selectedRows.length }),
      confirmLabel: t('users.actions.disable'),
      intent: 'danger',
    });
    if (!okToGo) return;
    setDeactivating(true);
    try {
      const results = await Promise.allSettled(selectedRows.map((row) => api.post(`/users/${row.id}/disable`)));
      const success = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - success;
      if (failed > 0) await dialogs.alert(t('users.messages.disableSelectedResult', { count: success, failed }));
      setRefreshKey((k) => k + 1);
    } finally {
      setDeactivating(false);
    }
  };

  // Per-user permissions removed: managed by role assignments

  const handleNew = () => {
    setUserDialog({ mode: 'create', tab: 'identity' });
  };
  const handleEdit = (row: any) => {
    if (!canManageUsers) return;
    setUserDialog({ mode: 'edit', id: row.id, name: userDisplayName(row), tab: 'identity' });
  };
  pageRef.current = {
    openUser: handleEdit,
    openMenu: (event, row) => {
      setMenuPos({ top: event.clientY, left: event.clientX });
      setMenuRow(row);
    },
  };

  const dateFilterParams = useMemo(() => ({
    suppressAndOrCondition: true,
    maxNumConditions: 1,
    buttons: ['clear'],
    filterOptions: ['equals', 'notEqual', 'lessThan', 'greaterThan', 'inRange', 'blank', 'notBlank'],
  }), []);

  const getRoleFilterValues = useCallback(async () => {
    try {
      const res = await api.get('/roles');
      return (res.data?.items ?? []).map((role: { id: string; role_name?: string; role_description?: string | null; is_system?: boolean; is_built_in?: boolean }) => ({
        value: role.id,
        label: roleLabel(role, t) || role.id,
      }));
    } catch {
      return [];
    }
  }, [t]);

  const columns: EnhancedColDef<any>[] = useMemo(() => {
    const onOpen = (row: any) => pageRef.current.openUser(row);
    const onOpenMenu = (event: React.MouseEvent<HTMLButtonElement>, row: any) => pageRef.current.openMenu(event, row);
    // One object for every column that opens the user, so the hit area is the whole cell.
    const openCell = canManageUsers
      ? { cellRenderer: UserOpenCell, cellRendererParams: { onOpen } }
      : {};
    return [
    { field: 'last_name', headerName: t('users.columns.lastName'), width: 150, ...openCell },
    { field: 'first_name', headerName: t('users.columns.firstName'), width: 150, ...openCell },
    { field: 'email', headerName: t('users.columns.email'), flex: 1, minWidth: 220, required: true, ...openCell },
    { field: 'job_title', headerName: t('users.columns.jobTitle'), width: 200, ...openCell },
    {
      field: 'status',
      headerName: t('users.columns.status'),
      width: 150,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: [
          { value: 'enabled', label: t('users.status.enabled') },
          { value: 'pending_access', label: t('users.status.pending_access') },
          { value: 'invited', label: t('users.status.invited') },
          { value: 'disabled', label: t('users.status.disabled') },
        ],
        searchable: false,
      },
      cellRenderer: UserStatusCell,
      cellRendererParams: { statusLabel: (key: string) => t(key), mode: theme.palette.mode },
    },
    {
      field: 'last_login_at',
      headerName: t('users.columns.lastLogin'),
      width: 160,
      filter: 'agDateColumnFilter',
      filterParams: dateFilterParams,
      valueFormatter: (p: any) => (p.value ? formatShortDateTime(p.value as string, locale) : t('users.lastLogin.never')),
      ...openCell,
    },
    {
      colId: 'roles',
      headerName: t('users.columns.roles'),
      width: 200,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getRoleFilterValues,
        searchable: true,
      },
      valueGetter: (params) => {
        const names = Array.isArray(params.data?.roles) && params.data.roles.length > 0
          ? params.data.roles.map((r: { name?: string | null }) => roleLabel({ name: r.name }, t))
          : [roleLabel({ role_name: params.data?.role?.role_name }, t)];
        return names.filter(Boolean).join(', ');
      },
      ...openCell,
    },
    ...(canAdminDataAccess && dataAccessAnyLimited
      ? [{
          colId: 'data_access',
          headerName: t('users.columns.dataAccess'),
          width: 220,
          sortable: false,
          filter: false,
          valueGetter: (params: any) => userAccessColumnText(params.data?.data_access, t),
          ...openCell,
        } as EnhancedColDef<any>]
      : []),
    {
      colId: 'account_type',
      headerName: t('users.columns.accountType'),
      width: 150,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: [
          { value: 'local', label: t('users.accountType.local') },
          { value: 'entra', label: t('users.accountType.entra') },
        ],
        searchable: false,
      },
      valueGetter: (params) => (params.data?.external_auth_provider === 'entra' ? t('users.accountType.entra') : t('users.accountType.local')),
      ...openCell,
    },
    { field: 'company', headerName: t('users.columns.company'), width: 200, valueGetter: (params) => params.data?.company?.name || '', ...openCell },
    { field: 'department', headerName: t('users.columns.department'), width: 200, valueGetter: (params) => params.data?.department?.name || '', ...openCell },
    { field: 'business_phone', headerName: t('users.columns.businessPhone'), width: 180, defaultHidden: true, ...openCell },
    { field: 'mobile_phone', headerName: t('users.columns.mobilePhone'), width: 160, defaultHidden: true, ...openCell },
    {
      field: 'mfa_enabled',
      headerName: t('users.columns.mfaEnabled'),
      width: 120,
      defaultHidden: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: [
          { value: 'true', label: t('users.mfaValues.yes') },
          { value: 'false', label: t('users.mfaValues.no') },
        ],
        searchable: false,
      },
      valueGetter: (params) => params.data?.mfa_enabled ? t('users.mfaValues.yes') : t('users.mfaValues.no'),
      ...openCell,
    },
    {
      field: 'created_at',
      headerName: t('users.columns.created'),
      width: 200,
      filter: 'agDateColumnFilter',
      filterParams: dateFilterParams,
      valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
      defaultHidden: true,
      ...openCell,
    },
    ...(canManageUsers
      ? [{
          colId: 'row_actions',
          headerName: '',
          width: 56,
          sortable: false,
          filter: false,
          resizable: false,
          pinned: 'right',
          suppressColumnsToolPanel: true,
          cellRenderer: UserRowActionsCell,
          cellRendererParams: { menuLabel: t('users.actions.rowMenu'), onOpenMenu },
        } as EnhancedColDef<any>]
      : []),
    ];
  }, [canAdminDataAccess, canManageUsers, dataAccessAnyLimited, dateFilterParams, getRoleFilterValues, locale, t, theme.palette.mode]);

  if (!hasLevel('users', 'reader')) {
    return <ForbiddenPage resource="users" level="reader" />;
  }

  const handleInviteSelected = async () => {
    if (!selectedRows.length) return;
    if (!(await confirmSendInvite(selectedRows))) return;
    setInviting(true);
    try {
      const results = await Promise.allSettled(
        selectedRows.map((row) => api.post(`/users/${row.id}/invite`))
      );
      const success = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - success;
      if (failed === 0) {
        await dialogs.alert(t('users.messages.inviteSuccess', { count: success }));
      } else {
        await dialogs.alert(t('users.messages.invitePartialFail', { count: success, failed }));
      }
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error(err);
      await dialogs.alert(t('users.messages.inviteFailed'));
    } finally {
      setInviting(false);
    }
  };

  const actions = (
    <Stack direction="row" spacing={1} alignItems="center">
      {canManageUsers && <Button variant="action-primary" onClick={handleNew}>{t('users.actions.new')}</Button>}
      {canManageUsers && <Button variant="action" onClick={() => setImportOpen(true)}><ImportLabel csv={t('users.actions.importCsv')} /></Button>}
      {canManageUsers && <Button variant="action" onClick={() => setExportOpen(true)}>{t('common:export.button')}</Button>}
      {canManageUsers && (
        <Button
          variant="action"
          onClick={handleInviteSelected}
          disabled={inviting || selectedRows.length === 0}
        >
          {inviting ? t('users.actions.inviting') : t('users.actions.invite', { count: selectedRows.length })}
        </Button>
      )}
      {canManageUsers && (
        <Button
          variant="action"
          onClick={handleDeactivateSelected}
          disabled={deactivating || selectedRows.length === 0}
        >
          {t('users.actions.disableSelected', { count: selectedRows.length })}
        </Button>
      )}
      {canManageUsers && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/users/bulk"
          // Asked on click: those that cannot go are kept, with why.
          checkDelete={(ids) => recordsInUseCheck('/users', ids)}
          itemLabels={{
            toDelete: (count) => t('users.delete.toDelete', { count }),
            kept: (count) => t('users.delete.kept', { count }),
            deleted: (count) => t('users.delete.deleted', { count }),
          }}
          getItemId={(row) => row.id}
          getItemName={userDisplayName}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('users.title')} actions={actions} />
      <ServerDataGrid<any>
        onListRequestChange={setListRequest}
        onListAnswer={(answer) => setDataAccessAnyLimited(answer?.data_access_any_limited === true)}
        columns={columns}
        endpoint="/users"
        queryKey="users"
        getRowId={(r) => r.id}
        enableSearch
        refreshKey={refreshKey}
        columnPreferencesKey="users-v3"
        enableColumnChooser={true}
        requiredColumns={['email']}
        defaultHiddenColumns={['mfa_enabled', 'created_at']}
        defaultSort={{ field: 'last_name', direction: 'ASC' }}
        initialState={{
          sort: {
            sortModel: [{ colId: 'last_name', sort: 'asc' }]
          }
        }}
        enableRowSelection={canManageUsers}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        statusScopeConfig={{ defaultScope: 'enabled', scopes: ['all', 'enabled', 'invited', 'disabled'] }}
      />
      <Menu anchorReference="anchorPosition" anchorPosition={menuPos ?? undefined} open={!!menuPos} onClose={closeRowMenu}>
        <MenuItem sx={{ fontSize: 13 }} onClick={() => { closeRowMenu(); if (menuRow) handleEdit(menuRow); }}>{t('users.actions.edit')}</MenuItem>
        {canAdminDataAccess && menuRow && String(menuRow.id) !== String(profile?.id) && (
          <MenuItem sx={{ fontSize: 13 }} onClick={() => {
            const row = menuRow;
            closeRowMenu();
            if (row) setUserDialog({ mode: 'edit', id: row.id, name: userDisplayName(row), tab: 'access' });
          }}>{t('users.actions.dataAccess')}</MenuItem>
        )}
        {menuRow?.status === 'enabled' ? (
          <MenuItem sx={{ fontSize: 13 }} onClick={() => menuRow && handleRowDisable(menuRow)}>{t('users.actions.disable')}</MenuItem>
        ) : (
          <MenuItem sx={{ fontSize: 13 }} onClick={() => menuRow && handleRowEnable(menuRow)}>{t('users.actions.enable')}</MenuItem>
        )}
        {!menuRow?.external_auth_provider && (
          <MenuItem sx={{ fontSize: 13 }} onClick={() => menuRow && handleRowInvite(menuRow)}>{t('users.actions.sendInvite')}</MenuItem>
        )}
        {!menuRow?.external_auth_provider && menuRow?.status === 'enabled' && (
          <MenuItem sx={{ fontSize: 13 }} onClick={() => menuRow && handleRowReset(menuRow)}>{t('users.actions.sendReset')}</MenuItem>
        )}
        <MenuItem sx={{ fontSize: 13, color: 'error.main' }} onClick={() => menuRow && handleRowDelete(menuRow)}>{t('users.actions.delete')}</MenuItem>
      </Menu>
      {userDialog && (
        <UserDialog
          key={`${userDialog.mode}-${userDialog.id ?? 'new'}-${userDialog.tab ?? 'identity'}`}
          open
          mode={userDialog.mode}
          userId={userDialog.id}
          personName={userDialog.name}
          initialTab={userDialog.tab}
          onClose={() => setUserDialog(null)}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
      <CsvExportDialog listRequest={listRequest} entity="users" open={exportOpen} onClose={() => setExportOpen(false)} endpoint="/users" title={t('users.exportTitle')} flexibleFormat />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/users"
        title={t('users.importTitle')}
        onImported={() => setRefreshKey((k) => k + 1)}
        flexibleFormat
      />

      {/* Per-user permissions modal removed */}
    </>
  );
}
