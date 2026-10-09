import React, { useCallback, useMemo, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../components/ServerDataGrid';
import { ICellRendererParams } from 'ag-grid-community';
import { Button, Stack, Box, IconButton, Menu, MenuItem, useTheme } from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import FormModal from '../components/forms/FormModal';
import UserForm, { UserInput, UserFormValues } from './forms/UserForm';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import { useTranslation } from 'react-i18next';
import ForbiddenPage from './ForbiddenPage';
import { StatusDot, useKanapDialogs } from '../components/design';
import { getDotColor, USER_ACCOUNT_STATUS_COLORS } from '../utils/statusColors';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';

export default function UsersPage() {
  const { t } = useTranslation(['admin', 'common']);
  const dialogs = useKanapDialogs();
  const locale = useLocale();
  const { hasLevel, tenantAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'create'|'edit'>('create');
  const [currentId, setCurrentId] = useState<string|number|undefined>();
  const [defaultValues, setDefaultValues] = useState<Partial<UserInput> | Partial<UserFormValues> | undefined>();
  const [serverError, setServerError] = useState<unknown>();
  const [canSave, setCanSave] = useState<{ isDirty: boolean; isValid: boolean; isSubmitting: boolean }>({ isDirty: false, isValid: false, isSubmitting: false });
  const [submitIntent, setSubmitIntent] = useState<'save' | 'save-invite'>('save');
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const [inviting, setInviting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  // Position-anchored (not element-anchored): the AG Grid cell re-renders on
  // state change, which would detach an element anchor and snap the menu to
  // the viewport corner.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [menuRow, setMenuRow] = useState<any>(null);
  const theme = useTheme();

  const queryClient = useQueryClient();
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const gridApiRef = useRef<any>(null);
  const canManageUsers = hasLevel('users', 'admin');
  const { mutateAsync: createItem, isPending: creating } = useMutation({
    mutationFn: async (payload: UserInput) => {
      const res = await api.post('/users', payload);
      return res.data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['users'] }); setRefreshKey((k)=>k+1); },
  });
  const { mutateAsync: updateItem, isPending: updating } = useMutation({
    mutationFn: async ({ id, payload }: { id: string|number; payload: Partial<UserInput> }) => {
      const res = await api.patch(`/users/${id}`, payload);
      return res.data;
    },
    onSuccess: (_d: any, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users', vars.id] });
      setRefreshKey((k)=>k+1);
    },
  });

  // Seat-controlled status actions
  const enableUser = async (id: string) => { await api.post(`/users/${id}/enable`); setRefreshKey((k)=>k+1); };
  const disableUser = async (id: string) => { await api.post(`/users/${id}/disable`); setRefreshKey((k)=>k+1); };
  const inviteUser = async (id: string) => { await api.post(`/users/${id}/invite`); setRefreshKey((k)=>k+1); };

  const userDisplayName = (row: any) =>
    `${row?.first_name ?? ''} ${row?.last_name ?? ''}`.trim() || row?.email || '';

  const closeRowMenu = () => setMenuPos(null);

  const handleRowDisable = async (row: any) => {
    closeRowMenu();
    const okToGo = await dialogs.confirm({
      message: t('users.messages.disableConfirm', { name: userDisplayName(row) }),
      confirmLabel: t('users.actions.disable'),
      intent: 'danger',
    });
    if (!okToGo) return;
    try { await disableUser(row.id); } catch (e: any) { await dialogs.alert(e?.response?.data?.message || String(e)); }
  };
  const handleRowEnable = async (row: any) => {
    closeRowMenu();
    try { await enableUser(row.id); } catch (e: any) { await dialogs.alert(e?.response?.data?.message || String(e)); }
  };
  const handleRowInvite = async (row: any) => {
    closeRowMenu();
    try {
      await inviteUser(row.id);
      await dialogs.alert(t('users.messages.inviteSentOne', { email: row.email }));
    } catch (e: any) { await dialogs.alert(e?.response?.data?.message || String(e)); }
  };
  const handleRowReset = async (row: any) => {
    closeRowMenu();
    try {
      await api.post('/auth/password-reset/request', { email: row.email });
      await dialogs.alert(t('users.messages.resetSent', { email: row.email }));
    } catch (e: any) { await dialogs.alert(e?.response?.data?.message || String(e)); }
  };
  const handleRowDelete = async (row: any) => {
    closeRowMenu();
    const okToGo = await dialogs.confirm({
      message: t('users.messages.deleteConfirm', { name: userDisplayName(row) }),
      confirmLabel: t('users.actions.delete'),
      intent: 'danger',
    });
    if (!okToGo) return;
    try {
      await api.delete(`/users/${row.id}`);
      setRefreshKey((k) => k + 1);
    } catch (e: any) { await dialogs.alert(e?.response?.data?.message || String(e)); }
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
      if (failed > 0) await dialogs.alert(t('users.messages.disableSelectedResult', { success, failed }));
      setRefreshKey((k) => k + 1);
    } finally {
      setDeactivating(false);
    }
  };

  // Per-user permissions removed: managed by role assignments

  const handleNew = () => {
    setMode('create');
    setDefaultValues({
      email: '',
      first_name: '',
      last_name: '',
      job_title: '',
      business_phone: '',
      mobile_phone: '',
      role_ids: [],
      company_id: null,
      department_id: null,
      status: true,
    });
    setServerError(undefined);
    setSubmitIntent('save');
    setOpen(true);
  };
  const handleEdit = async (row: any) => {
    if (!canManageUsers) return;
    setMode('edit');
    setServerError(undefined);
    setCurrentId(row.id);
    setSubmitIntent('save');
    try {
      const [userRes, rolesRes] = await Promise.all([
        api.get(`/users/${row.id}`),
        api.get(`/users/${row.id}/roles`),
      ]);
      const roles = rolesRes.data?.items ?? [];
      setDefaultValues({
        ...userRes.data,
        roles, // Pass roles array for form to parse
      });
    } catch (e) {
      // Fallback to legacy single role
      setDefaultValues({
        ...row,
        role_ids: row?.role?.id ? [row.role.id] : [],
      });
    }
    setOpen(true);
  };
  const onSubmit = async (values: UserInput) => {
    try {
      setServerError(undefined);
      const { role_ids, ...userPayload } = values;
      if (mode === 'create') {
        // Create user with first role as role_id for backwards compat
        const createPayload = { ...userPayload, role_id: role_ids[0] ?? null };
        const created = await createItem(createPayload as any);
        // Set roles via dedicated endpoint
        if (created?.id) {
          try {
            await api.put(`/users/${created.id}/roles`, { role_ids });
          } catch (roleErr: any) {
            setServerError(new Error(roleErr?.response?.data?.message || t('users.messages.rolesSaveFailed')));
            return;
          }
        }
        if (submitIntent === 'save-invite' && created?.id) {
          try {
            await inviteUser(created.id);
          } catch (inviteErr) {
            setServerError(inviteErr);
            return;
          }
        }
      } else if (mode === 'edit' && currentId != null) {
        // Update user basic info
        await updateItem({ id: currentId, payload: userPayload as any });
        // Update roles via dedicated endpoint (an empty list is allowed: no access)
        try {
          await api.put(`/users/${currentId}/roles`, { role_ids });
        } catch (roleErr: any) {
          setServerError(new Error(roleErr?.response?.data?.message || t('users.messages.rolesSaveFailed')));
          return;
        }
      }
      setOpen(false);
      setSubmitIntent('save');
    } catch (e: any) {
      if (e?.response?.status === 409) setServerError(new Error(t('users.messages.emailUnique')));
      else setServerError(e);
    }
  };
  const onClose = useCallback(() => {
    setOpen(false);
    setSubmitIntent('save');
  }, []);

  const ClickableCell: React.FC<ICellRendererParams<any, any>> = (params) => (
    <Box
      component="span"
      sx={{ cursor: 'pointer' }}
      onClick={() => handleEdit(params.data)}
    >
      {params.value}
    </Box>
  );
  const ClickableCellGeneric: React.FC<ICellRendererParams<any, any>> = (params) => (
    <Box
      component="span"
      sx={{ cursor: 'pointer' }}
      onClick={() => handleEdit(params.data)}
    >
      {params.valueFormatted ?? params.value}
    </Box>
  );
  const UserStatusCell: React.FC<ICellRendererParams<any, any>> = (params) => {
    const row = params.data;
    if (!row) return null;
    const key = row.pending_access ? 'pending_access' : row.status;
    const color = getDotColor(USER_ACCOUNT_STATUS_COLORS[key] ?? 'default', theme.palette.mode);
    return (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '100%' }}>
        <StatusDot color={color} />
        <Box component="span" sx={{ color, fontSize: 12.5, fontWeight: 500 }}>
          {t(`users.status.${key}`)}
        </Box>
      </Box>
    );
  };
  const RowActionsCell: React.FC<ICellRendererParams<any, any>> = (params) => (
    <IconButton
      size="small"
      aria-label={t('users.actions.rowMenu')}
      onClick={(e) => { setMenuPos({ top: e.clientY, left: e.clientX }); setMenuRow(params.data); }}
    >
      <MoreHorizIcon fontSize="small" />
    </IconButton>
  );

  const dateFilterParams = useMemo(() => ({
    suppressAndOrCondition: true,
    maxNumConditions: 1,
    buttons: ['clear'],
    filterOptions: ['equals', 'notEqual', 'lessThan', 'greaterThan', 'inRange', 'blank', 'notBlank'],
  }), []);

  const getRoleFilterValues = useCallback(async () => {
    try {
      const res = await api.get('/roles');
      return (res.data?.items ?? []).map((role: { id: string; role_name?: string }) => ({
        value: role.id,
        label: role.role_name || role.id,
      }));
    } catch {
      return [];
    }
  }, []);

  const columns: EnhancedColDef<any>[] = useMemo(() => [
    { field: 'last_name', headerName: t('users.columns.lastName'), width: 150, cellRenderer: canManageUsers ? ClickableCellGeneric : undefined },
    { field: 'first_name', headerName: t('users.columns.firstName'), width: 150, cellRenderer: canManageUsers ? ClickableCellGeneric : undefined },
    { field: 'email', headerName: t('users.columns.email'), flex: 1, minWidth: 220, required: true, cellRenderer: canManageUsers ? ClickableCell : undefined },
    { field: 'job_title', headerName: t('users.columns.jobTitle'), width: 200, cellRenderer: canManageUsers ? ClickableCellGeneric : undefined },
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
    },
    {
      field: 'last_login_at',
      headerName: t('users.columns.lastLogin'),
      width: 160,
      filter: 'agDateColumnFilter',
      filterParams: dateFilterParams,
      valueFormatter: (p: any) => (p.value ? formatShortDateTime(p.value as string, locale) : t('users.lastLogin.never')),
      cellRenderer: canManageUsers ? ClickableCellGeneric : undefined,
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
          ? params.data.roles.map((r: any) => r.name)
          : [params.data?.role?.role_name];
        return names.filter(Boolean).join(', ');
      },
      cellRenderer: canManageUsers ? ClickableCellGeneric : undefined,
    },
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
      cellRenderer: canManageUsers ? ClickableCellGeneric : undefined,
    },
    { field: 'company', headerName: t('users.columns.company'), width: 200, valueGetter: (params) => params.data?.company?.name || '', cellRenderer: canManageUsers ? ClickableCellGeneric : undefined },
    { field: 'department', headerName: t('users.columns.department'), width: 200, valueGetter: (params) => params.data?.department?.name || '', cellRenderer: canManageUsers ? ClickableCellGeneric : undefined },
    { field: 'business_phone', headerName: t('users.columns.businessPhone'), width: 180, defaultHidden: true, cellRenderer: canManageUsers ? ClickableCellGeneric : undefined },
    { field: 'mobile_phone', headerName: t('users.columns.mobilePhone'), width: 160, defaultHidden: true, cellRenderer: canManageUsers ? ClickableCellGeneric : undefined },
    { field: 'mfa_enabled', headerName: t('users.columns.mfaEnabled'), width: 120, defaultHidden: true, valueGetter: (params) => params.data?.mfa_enabled ? t('users.mfaValues.yes') : t('users.mfaValues.no'), cellRenderer: canManageUsers ? ClickableCellGeneric : undefined },
    {
      field: 'created_at',
      headerName: t('users.columns.created'),
      width: 200,
      filter: 'agDateColumnFilter',
      filterParams: dateFilterParams,
      valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
      defaultHidden: true,
      cellRenderer: canManageUsers ? ClickableCellGeneric : undefined,
    },
    ...(canManageUsers
      ? [{ colId: 'row_actions', headerName: '', width: 56, sortable: false, filter: false, resizable: false, pinned: 'right', cellRenderer: RowActionsCell } as EnhancedColDef<any>]
      : []),
  ], [ClickableCell, ClickableCellGeneric, UserStatusCell, RowActionsCell, canManageUsers, dateFilterParams, getRoleFilterValues, locale, t]);

  if (!hasLevel('users', 'reader')) {
    return <ForbiddenPage />;
  }

  const handleInviteSelected = async () => {
    if (!selectedRows.length) return;
    setInviting(true);
    try {
      const results = await Promise.allSettled(
        selectedRows.map((row) => api.post(`/users/${row.id}/invite`))
      );
      const success = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - success;
      if (failed === 0) {
        await dialogs.alert(t('users.messages.inviteSuccess', { success }));
      } else {
        await dialogs.alert(t('users.messages.invitePartialFail', { success, failed }));
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
      {canManageUsers && <Button variant="action" onClick={() => setImportOpen(true)}>{t('users.actions.importCsv')}</Button>}
      {canManageUsers && <Button variant="action" onClick={() => setExportOpen(true)}>{t('users.actions.exportCsv')}</Button>}
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
          getItemId={(row) => row.id}
          getItemName={(row) => row.email || `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'User'}
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
        <MenuItem sx={{ fontSize: 13 }} onClick={() => { closeRowMenu(); if (menuRow) void handleEdit(menuRow); }}>{t('users.actions.edit')}</MenuItem>
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
      <FormModal
        title={mode === 'create' ? t('users.dialogs.newUser') : t('users.dialogs.editUser')}
        open={open}
        onClose={onClose}
        formId="user-form"
        actions={(
          <Stack direction="row" spacing={1.5}>
            <Button onClick={onClose} color="inherit">{t('common:buttons.cancel')}</Button>
            {mode === 'create' && (
            <Button
              variant="contained"
              color="secondary"
              disabled={!(canSave.isDirty && canSave.isValid) || canSave.isSubmitting || creating}
              onClick={() => {
                setSubmitIntent('save-invite');
                window.setTimeout(() => {
                  const form = document.getElementById('user-form') as HTMLFormElement | null;
                  form?.requestSubmit();
                  }, 0);
                }}
              >
                {creating && submitIntent === 'save-invite' ? t('users.dialogs.saving') : t('users.dialogs.saveAndInvite')}
              </Button>
            )}
            <Button
              variant="contained"
              color={canSave.isDirty ? 'primary' : 'inherit'}
              disabled={!(canSave.isDirty && canSave.isValid) || canSave.isSubmitting || (mode === 'create' ? creating : updating)}
              onClick={() => {
                setSubmitIntent('save');
                window.setTimeout(() => {
                  const form = document.getElementById('user-form') as HTMLFormElement | null;
                  form?.requestSubmit();
                }, 0);
              }}
            >
              {(mode === 'create' ? creating : updating) && submitIntent === 'save' ? t('users.dialogs.saving') : t('common:buttons.save')}
            </Button>
          </Stack>
        )}
      >
        <UserForm
          formId="user-form"
          defaultValues={defaultValues}
          onSubmit={onSubmit}
          serverError={serverError}
          onStateChange={setCanSave}
          managedByEntra={tenantAuth?.sso_provider === 'entra' && tenantAuth?.sso_enabled && (defaultValues as any)?.external_auth_provider === 'entra'}
        />
      </FormModal>
      <CsvExportDialog open={exportOpen} onClose={() => setExportOpen(false)} endpoint="/users" title={t('users.exportTitle')} flexibleFormat />
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
