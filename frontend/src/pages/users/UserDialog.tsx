import React from 'react';
import { Alert, Box, Button, CircularProgress, Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useDataAccessAdmin } from '../../auth/dataAccess';
import { KanapDialog } from '../../components/design';
import DataAccessPanel, {
  type DataAccessPanelHandle,
  type DataAccessPanelState,
} from '../../components/dataAccess/DataAccessPanel';
import { textTabSx, textTabsSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import UserForm, {
  type UserFormHandle,
  type UserFormIntent,
  type UserInput,
} from '../forms/UserForm';
import { postInvite, useInviteConfirm, type InviteChoice } from './inviteConfirm';

export type UserDialogTab = 'identity' | 'access';

type Props = {
  open: boolean;
  mode: 'create' | 'edit';
  userId?: string | number | null;
  personName?: string;
  initialTab?: UserDialogTab;
  onClose: () => void;
  onSaved?: () => void;
};

type IdentityState = { isDirty: boolean; isValid: boolean; isSubmitting: boolean };

/**
 * The user dialog (spec §7.4): the identity on one tab and, for a viewer who administers data
 * access, the person's data access on another. One footer saves what changed, identity first and
 * then access, and opens the tab of the save that failed. A create keeps "Save and invite".
 */
export default function UserDialog({
  open,
  mode,
  userId,
  personName,
  initialTab = 'identity',
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation(['admin', 'common']);
  const { profile, tenantAuth } = useAuth();
  const confirmInvite = useInviteConfirm();
  const canAdminDataAccess = useDataAccessAdmin();
  const queryClient = useQueryClient();

  const editing = mode === 'edit' && userId != null;
  const ownAccount = editing && String(userId) === String(profile?.id);

  const userQuery = useQuery({
    queryKey: ['user-dialog', userId],
    queryFn: async () => {
      const [userRes, rolesRes] = await Promise.allSettled([
        api.get(`/users/${userId}`),
        api.get(`/users/${userId}/roles`),
      ]);
      if (userRes.status === 'rejected') throw userRes.reason;
      // Roles that could not be read are neither shown as "no role" nor saved.
      if (rolesRes.status === 'rejected') return { ...userRes.value.data, roles: undefined, rolesUnread: true };
      return { ...userRes.value.data, roles: rolesRes.value.data?.items ?? [] };
    },
    enabled: open && editing,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // A person with more rights than the reader (the server says so): shown, never changed.
  const readOnly = editing && userQuery.data?.above_own_rights === true;
  const rolesUnread = editing && userQuery.data?.rolesUnread === true;
  const showAccessTab = editing && canAdminDataAccess && !ownAccount && !readOnly;

  const [activeTab, setActiveTab] = React.useState<UserDialogTab>(initialTab);
  const [accessMounted, setAccessMounted] = React.useState(initialTab === 'access');
  const resolvedTab: UserDialogTab = showAccessTab ? activeTab : 'identity';

  React.useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab === 'access' && showAccessTab ? 'access' : 'identity');
  }, [initialTab, open, showAccessTab]);

  React.useEffect(() => {
    if (resolvedTab === 'access') setAccessMounted(true);
  }, [resolvedTab]);

  const [identityState, setIdentityState] = React.useState<IdentityState>({
    isDirty: false,
    isValid: false,
    isSubmitting: false,
  });
  const [accessState, setAccessState] = React.useState<DataAccessPanelState>({ dirty: false, canSave: false });
  const [identityError, setIdentityError] = React.useState<unknown>();
  const [saving, setSaving] = React.useState(false);
  const identityRef = React.useRef<UserFormHandle>(null);
  const accessRef = React.useRef<DataAccessPanelHandle>(null);

  const saveIdentity = React.useCallback(async (values: UserInput, intent: UserFormIntent): Promise<boolean> => {
    // Asked before the account is created: cancelling leaves the form as it is and sends nothing.
    let invite: InviteChoice = null;
    if (intent === 'save-invite') {
      invite = await confirmInvite([values.email]);
      if (!invite) return false;
    }
    setIdentityError(undefined);
    const { role_ids, ...userPayload } = values;
    try {
      if (mode === 'create') {
        // The person and their roles in one request: a refused role creates nothing, so no
        // invitation leaves either.
        const created = await api.post<{ id: string }>('/users', { ...userPayload, role_ids });
        const createdId = created.data?.id;
        if (createdId) {
          if (invite) {
            try {
              await postInvite(createdId, invite);
            } catch (e) {
              setIdentityError(e);
              return false;
            }
          }
        }
        void queryClient.invalidateQueries({ queryKey: ['users'] });
        return true;
      }
      if (userId == null) return false;
      // The profile and the roles in one request: a refusal of either writes neither.
      await api.patch(`/users/${userId}`, rolesUnread ? userPayload : { ...userPayload, role_ids });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      return true;
    } catch (e: any) {
      // A taken e-mail on a change answers 409 `duplicate`; the coded refusals (a taken e-mail on a
      // creation, roles, last administrator) are worded by the form's alert.
      const code = e?.response?.data?.code;
      setIdentityError(
        e?.response?.status === 409 && (!code || code === 'duplicate') ? new Error(t('users.messages.emailUnique')) : e,
      );
      return false;
    }
  }, [confirmInvite, mode, queryClient, rolesUnread, t, userId]);

  const handleSave = React.useCallback(async (intent: UserFormIntent) => {
    if (saving) return;
    setIdentityError(undefined);
    setSaving(true);
    try {
      if (mode === 'create') {
        const ok = (await identityRef.current?.submit(intent)) ?? false;
        if (!ok) {
          setActiveTab('identity');
          return;
        }
        onSaved?.();
        onClose();
        return;
      }
      if (identityState.isDirty) {
        const ok = (await identityRef.current?.submit('save')) ?? false;
        if (!ok) {
          setActiveTab('identity');
          return;
        }
      }
      if (showAccessTab && accessState.dirty) {
        const ok = (await accessRef.current?.save()) ?? false;
        if (!ok) {
          setActiveTab('access');
          return;
        }
      }
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  }, [accessState.dirty, identityState.isDirty, mode, onClose, onSaved, saving, showAccessTab]);

  const hasChanges = identityState.isDirty || (showAccessTab && accessState.dirty);
  const identityMustBeValid = mode === 'create' || identityState.isDirty;
  const saveDisabled = saving
    || !hasChanges
    || (identityMustBeValid && !identityState.isValid)
    || (showAccessTab && accessState.dirty && !accessState.canSave);

  const managedByEntra = tenantAuth?.sso_provider === 'entra'
    && tenantAuth?.sso_enabled
    && userQuery.data?.external_auth_provider === 'entra';

  const fetchedName = userQuery.data
    ? `${userQuery.data.first_name ?? ''} ${userQuery.data.last_name ?? ''}`.trim()
      || userQuery.data.email
      || ''
    : '';
  const accessName = personName || fetchedName;

  const identityPanel = userQuery.isLoading ? (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
      <CircularProgress size={20} />
    </Box>
  ) : userQuery.isError ? (
    <Alert severity="error">
      {getApiErrorMessage(userQuery.error, t, t('users.messages.loadFailed'))}
    </Alert>
  ) : (
    <UserForm
      ref={identityRef}
      defaultValues={editing ? userQuery.data : undefined}
      onSubmit={saveIdentity}
      serverError={identityError}
      onStateChange={setIdentityState}
      managedByEntra={managedByEntra}
      readOnly={readOnly}
      rolesLocked={rolesUnread}
    />
  );

  const saveAndInvite = mode === 'create' ? (
    <Button
      variant="action"
      onClick={() => { void handleSave('save-invite'); }}
      disabled={saveDisabled}
    >
      {t('users.dialogs.saveAndInvite')}
    </Button>
  ) : undefined;

  return (
    <KanapDialog
      open={open}
      title={mode === 'create' ? t('users.dialogs.newUser') : readOnly ? t('users.dialogs.viewUser') : t('users.dialogs.editUser')}
      onClose={onClose}
      onSave={() => { void handleSave('save'); }}
      showSave={!readOnly}
      cancelLabel={readOnly ? t('common:buttons.close') : undefined}
      saveDisabled={saveDisabled || readOnly}
      saveLoading={saving}
      secondaryActions={saveAndInvite}
      sx={{ maxWidth: 640 }}
    >
      {showAccessTab && (
        <Tabs
          value={resolvedTab}
          onChange={(_event, value) => setActiveTab(value === 'access' ? 'access' : 'identity')}
          sx={[textTabsSx, { mb: 2 }]}
        >
          <Tab
            id="user-tab-identity"
            aria-controls="user-tabpanel-identity"
            value="identity"
            disableRipple
            label={t('users.dialogs.identity')}
            sx={textTabSx(resolvedTab === 'identity')}
          />
          <Tab
            id="user-tab-access"
            aria-controls="user-tabpanel-access"
            value="access"
            disableRipple
            label={t('users.actions.dataAccess')}
            sx={textTabSx(resolvedTab === 'access')}
          />
        </Tabs>
      )}
      {/* The body scrolls, the title and the footer stay in view; with tabs, one height for both so
          the dialog does not jump when the tab changes. */}
      <Box
        sx={{
          height: showAccessTab ? 'min(600px, calc(100vh - 260px))' : undefined,
          maxHeight: 'calc(100vh - 220px)',
          overflowY: 'auto',
        }}
      >
        <Box
          role={showAccessTab ? 'tabpanel' : undefined}
          id={showAccessTab ? 'user-tabpanel-identity' : undefined}
          aria-labelledby={showAccessTab ? 'user-tab-identity' : undefined}
          hidden={showAccessTab && resolvedTab !== 'identity'}
        >
          {identityPanel}
        </Box>
        {showAccessTab && accessMounted && (
          <Box
            role="tabpanel"
            id="user-tabpanel-access"
            aria-labelledby="user-tab-access"
            hidden={resolvedTab !== 'access'}
          >
            <DataAccessPanel
              ref={accessRef}
              open={open}
              userId={String(userId)}
              personName={accessName}
              onStateChange={setAccessState}
            />
          </Box>
        )}
      </Box>
    </KanapDialog>
  );
}
