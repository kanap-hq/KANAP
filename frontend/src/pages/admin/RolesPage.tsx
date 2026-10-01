import React from 'react';
import PageHeader from '../../components/PageHeader';
import { Box, Button, Card, CardContent, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, Grid, InputLabel, List, ListItemButton, ListItemText, MenuItem, Select, Snackbar, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';

type Role = { id: string; role_name: string; role_description: string; is_system?: boolean; is_built_in?: boolean; user_count?: number };
type PermissionLevel = 'reader'|'contributor'|'member'|'admin'|null;
type ConcretePermissionLevel = Exclude<PermissionLevel, null>;

// Permission groups for organized display
const PERMISSION_GROUPS = {
  'AI': ['ai_chat', 'ai_mcp', 'ai_agents', 'ai_settings'],
  'Budget & Finance': ['opex', 'capex', 'budget_ops', 'contracts', 'analytics', 'reporting'],
  'Portfolio Management': ['portfolio_requests', 'portfolio_projects', 'portfolio_planning', 'portfolio_reports', 'portfolio_settings'],
  'IT Landscape': ['applications', 'infrastructure', 'locations', 'incidents', 'settings'],
  'Master Data': ['companies', 'departments', 'cost_centers', 'working_day_profiles', 'suppliers', 'contacts', 'accounts', 'business_processes'],
  'Tasks': ['tasks'],
  'Knowledge': ['knowledge'],
  'Administration': ['users', 'billing'],
} as const;

// Flat list of all resources for API compatibility
const RESOURCES = Object.values(PERMISSION_GROUPS).flat();

// Friendly display names for resources
const RESOURCE_LABELS: Record<string, string> = {
  ai_chat: 'AI Chat',
  ai_mcp: 'AI MCP',
  ai_agents: 'AI Agents',
  ai_settings: 'AI Settings',
  opex: 'Operating Expenses',
  capex: 'Capital Expenses',
  budget_ops: 'Budget Administration',
  contracts: 'Contracts',
  analytics: 'Analytics Dimensions',
  billing: 'Billing',
  portfolio_requests: 'Requests',
  portfolio_projects: 'Projects',
  portfolio_planning: 'Planning',
  portfolio_reports: 'Reports',
  portfolio_settings: 'Settings',
  applications: 'Applications',
  infrastructure: 'Infrastructure',
  settings: 'Settings',
  companies: 'Companies',
  departments: 'Departments',
  cost_centers: 'Cost Centers',
  working_day_profiles: 'Working-day calendars',
  suppliers: 'Suppliers',
  contacts: 'Contacts',
  accounts: 'Accounts',
  business_processes: 'Business Processes',
  locations: 'Locations',
  incidents: 'Incidents',
  tasks: 'Tasks',
  knowledge: 'Knowledge',
  reporting: 'Reporting',
  users: 'Users',
};

const ALL_LEVEL_OPTIONS: Array<{ value: ConcretePermissionLevel; label: string }> = [
  { value: 'reader', label: 'roles.levels.reader' },
  { value: 'contributor', label: 'roles.levels.contributor' },
  { value: 'member', label: 'roles.levels.member' },
  { value: 'admin', label: 'roles.levels.admin' },
];

function getLevelOptions(resource: string): Array<{ value: ConcretePermissionLevel; label: string }> {
  if (resource === 'knowledge') {
    return ALL_LEVEL_OPTIONS.filter((option) => option.value !== 'contributor');
  }
  if (resource === 'ai_settings') {
    return ALL_LEVEL_OPTIONS.filter((option) => option.value === 'admin');
  }
  if (resource === 'ai_agents') {
    return ALL_LEVEL_OPTIONS.filter((option) => option.value !== 'member');
  }
  if (resource === 'ai_chat' || resource === 'ai_mcp') {
    return ALL_LEVEL_OPTIONS.filter((option) => option.value !== 'contributor');
  }
  return ALL_LEVEL_OPTIONS;
}

export default function RolesPage() {
  const { hasLevel } = useAuth();
  const { t } = useTranslation(['admin', 'common']);
  const canEdit = hasLevel('users','admin');
  const qc = useQueryClient();
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: async () => (await api.get<{ items: Role[] }>('/roles')).data.items });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = roles?.find((r: Role) => r.id === selectedId) ?? (roles && roles[0]) ?? null;

  React.useEffect(() => {
    if (!selectedId && roles && roles.length > 0) setSelectedId(roles[0].id);
  }, [roles, selectedId]);

  const { data: perms } = useQuery({
    queryKey: ['role-perms', selected?.id],
    queryFn: async ({ queryKey }: { queryKey: any[] }) => {
      const id = queryKey[1] as string;
      const res = await api.get(`/roles/${id}/permissions`);
      return res.data as Record<string, PermissionLevel>;
    },
    enabled: !!selected?.id,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = React.useState<Record<string, PermissionLevel>>({});
  // On role change, clear draft immediately to avoid showing previous role values
  React.useEffect(() => { setDraft({}); }, [selected?.id]);
  // When fetched, apply role permissions to draft
  React.useEffect(() => { setDraft((perms || {}) as any); }, [perms]);

  const [snackOpen, setSnackOpen] = React.useState(false);
  const [snackMessage, setSnackMessage] = React.useState(t('roles.messages.permissionsSaved'));
  const { mutateAsync: savePerms, isPending } = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      await api.put(`/roles/${selected.id}/permissions`, { permissions: draft });
    },
    onSuccess: async () => {
      if (selected?.id) {
        // Optimistically sync cache to current draft to ensure immediate correctness
        qc.setQueryData(['role-perms', selected.id], { ...(draft as any) });
        await qc.invalidateQueries({ queryKey: ['role-perms', selected.id] });
      }
      setSnackMessage(t('roles.messages.permissionsSaved'));
      setSnackOpen(true);
    },
  });

  // Create role modal
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newDesc, setNewDesc] = React.useState('');
  const { mutateAsync: createRole, isPending: creating } = useMutation({
    mutationFn: async () => {
      const res = await api.post('/roles', { role_name: newName.trim(), role_description: newDesc.trim() });
      return res.data as Role;
    },
    onSuccess: async (created: Role) => {
      await qc.invalidateQueries({ queryKey: ['roles'] });
      setSelectedId(created?.id || null);
      setCreateOpen(false);
      setNewName(''); setNewDesc('');
    },
  });

  // Duplicate role
  const { mutateAsync: duplicateRole, isPending: duplicating } = useMutation({
    mutationFn: async () => {
      if (!selected) return null;
      const res = await api.post(`/roles/${selected.id}/duplicate`);
      return res.data as Role;
    },
    onSuccess: async (created: Role | null) => {
      await qc.invalidateQueries({ queryKey: ['roles'] });
      if (created?.id) setSelectedId(created.id);
      setSnackMessage(t('roles.messages.duplicated'));
      setSnackOpen(true);
    },
  });

  // Update role meta (name/description)
  const [editName, setEditName] = React.useState('');
  const [editDesc, setEditDesc] = React.useState('');
  React.useEffect(() => {
    if (selected) { setEditName(selected.role_name); setEditDesc(selected.role_description); }
  }, [selected?.id]);
  const { mutateAsync: saveMeta, isPending: savingMeta } = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      await api.put(`/roles/${selected.id}`, { role_name: editName.trim(), role_description: editDesc.trim() });
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['roles'] }); },
  });

  // Delete role
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const { mutateAsync: doDelete, isPending: deleting } = useMutation({
    mutationFn: async () => { if (selected) await api.delete(`/roles/${selected.id}`); },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['roles'] });
      setConfirmDelete(false);
      setSelectedId(null);
    },
  });

  const roleKey = (selected?.role_name ?? '').toLowerCase();
  const isSystem = !!selected?.is_system && (roleKey === 'administrator' || roleKey === 'contact');
  const isBuiltIn = !!selected?.is_built_in;
  const locked = isSystem || isBuiltIn;
  const lockedMessage = isSystem
    ? (roleKey === 'contact'
      ? t('roles.messages.contactLocked')
      : t('roles.messages.administratorLocked'))
    : t('roles.messages.builtInLocked');

  const getRoleBadge = (role: Role) => {
    const key = (role.role_name ?? '').toLowerCase();
    if (role.is_system && (key === 'administrator' || key === 'contact')) {
      return <Typography variant="body2" color="text.secondary">{t('roles.badges.system')}</Typography>;
    }
    if (role.is_built_in) {
      return <Typography variant="body2" color="text.secondary">{t('roles.badges.builtIn')}</Typography>;
    }
    return null;
  };

  const getGroupLabel = (groupName: string) => t(`roles.groups.${groupName}`, { defaultValue: groupName });
  const getResourceLabel = (resource: string) => t(`roles.resources.${resource}`, { defaultValue: RESOURCE_LABELS[resource] || resource });
  const getLevelLabel = (key: ConcretePermissionLevel) => t(`roles.levels.${key}`);

  return (
    <>
      <PageHeader
        title={t('roles.title')}
        actions={canEdit ? (
          <Stack direction="row" spacing={1}>
            {selected && !isSystem && (
              <Button variant="outlined" onClick={() => duplicateRole()} disabled={duplicating}>
                {duplicating ? t('roles.actions.duplicating') : t('roles.actions.duplicate')}
              </Button>
            )}
            <Button variant="contained" onClick={() => setCreateOpen(true)}>{t('roles.actions.newRole')}</Button>
          </Stack>
        ) : undefined}
      />
      <Grid container spacing={2}>
        <Grid item xs={12} md={4} lg={3}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('roles.sections.roles')}</Typography>
              <List dense sx={{ maxHeight: 480, overflow: 'auto' }}>
                {(roles || []).map((r: Role) => (
                  <ListItemButton key={r.id} selected={r.id === selected?.id} onClick={() => setSelectedId(r.id)}>
                    <ListItemText
                      primary={<Stack direction="row" spacing={1} alignItems="center"><span>{r.role_name}</span>{getRoleBadge(r)}</Stack>}
                      secondary={r.role_description}
                      secondaryTypographyProps={{ sx: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={8} lg={9}>
          {selected ? (
            <Card key={selected.id} variant="outlined">
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{selected.role_name}</Typography>
                    {getRoleBadge(selected)}
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {typeof selected.user_count === 'number' && <Typography variant="body2" color="text.secondary">{t('roles.userCount', { count: selected.user_count })}</Typography>}
                    {canEdit && !locked && (
                      <Button size="small" color="error" onClick={() => setConfirmDelete(true)} disabled={!!selected.user_count && selected.user_count > 0}>{t('common:buttons.delete')}</Button>
                    )}
                  </Stack>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {locked ? lockedMessage : t('roles.messages.setAccessLevels')}
                </Typography>
                {!locked && (
                  <Stack spacing={2} sx={{ maxWidth: 520, mb: 2 }}>
                    <TextField size="small" label={t('roles.fields.roleName')} value={editName} onChange={(e) => setEditName(e.target.value)} disabled={!canEdit} InputLabelProps={{ shrink: true }} />
                    <TextField size="small" label={t('roles.fields.description')} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} disabled={!canEdit} InputLabelProps={{ shrink: true }} />
                    <Box>
                      <Button variant="outlined" onClick={() => saveMeta()} disabled={!canEdit || savingMeta || editName.trim().length === 0}
                        startIcon={savingMeta ? <CircularProgress size={16} color="inherit" /> : undefined}
                      >
                        {savingMeta ? t('common:status.saving') : t('roles.actions.saveDetails')}
                      </Button>
                    </Box>
                  </Stack>
                )}
                <Divider sx={{ mb: 2 }} />

                {/* Grouped permissions */}
                <Stack spacing={3}>
                  {Object.entries(PERMISSION_GROUPS).map(([groupName, resources]) => (
                    <Box key={groupName}>
                      <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary' }}>{getGroupLabel(groupName)}</Typography>
                      <Grid container spacing={2}>
                        {resources.map((r) => (
                          <Grid item xs={12} sm={6} md={4} key={r}>
                            <FormControl size="small" fullWidth disabled={!canEdit || locked}>
                              <InputLabel id={`perm-${r}`} shrink>{getResourceLabel(r)}</InputLabel>
                              <Select labelId={`perm-${r}`} value={(draft?.[r] ?? '') as any} displayEmpty label={getResourceLabel(r)}
                                onChange={(e) => setDraft((m) => ({ ...m, [r]: (e.target.value || null) as PermissionLevel }))}
                              >
                                <MenuItem value=""><em>{t('roles.levels.none')}</em></MenuItem>
                                {getLevelOptions(r).map((option) => (
                                  <MenuItem key={option.value} value={option.value}>
                                    {getLevelLabel(option.value)}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </Grid>
                        ))}
                      </Grid>
                    </Box>
                  ))}
                </Stack>

                <Box sx={{ mt: 3 }}>
                  <Button variant="contained" onClick={() => savePerms()} disabled={!canEdit || locked || isPending}
                    startIcon={isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
                  >
                    {isPending ? t('common:status.saving') : t('roles.actions.savePermissions')}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          ) : (
            <Typography variant="body2" color="text.secondary">{t('roles.empty')}</Typography>
          )}
        </Grid>
      </Grid>

      {/* Create Role Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('roles.dialogs.createTitle')}</DialogTitle>
        <DialogContent
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !creating && newName.trim().length > 0) {
              e.preventDefault();
              createRole();
            }
          }}
        >
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField autoFocus label={t('roles.fields.roleName')} value={newName} onChange={(e) => setNewName(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField label={t('roles.fields.description')} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>{t('common:buttons.cancel')}</Button>
          <Button variant="contained" onClick={() => createRole()} disabled={creating || newName.trim().length === 0}>{t('common:buttons.create')}</Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Delete */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>{t('roles.dialogs.deleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{t('roles.dialogs.deleteMessage')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>{t('common:buttons.cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => doDelete()} disabled={deleting}>{t('common:buttons.delete')}</Button>
        </DialogActions>
      </Dialog>

      {/* Saved Snackbar */}
      <Snackbar
        open={snackOpen}
        onClose={() => setSnackOpen(false)}
        autoHideDuration={1200}
        message={snackMessage}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      />
    </>
  );
}
