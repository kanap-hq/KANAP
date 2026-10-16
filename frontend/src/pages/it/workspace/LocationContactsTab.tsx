import React from 'react';
import {
  Alert,
  Box,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import MetadataUserPicker from '../../../components/workspace/MetadataUserPicker';
import ContactSelect from '../../../components/fields/ContactSelect';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

type InternalContact = {
  id: string;
  user_id: string;
  role: string | null;
  user?: { id: string; first_name?: string | null; last_name?: string | null; email: string } | null;
};

type ExternalContact = {
  id: string;
  contact_id: string;
  role: string | null;
  contact?: { id: string; first_name?: string | null; last_name?: string | null; email?: string | null } | null;
};

type LinkRow = {
  id: string;
  description: string | null;
  url: string;
};

type Props = {
  locationId: string;
  canManage: boolean;
};

const headerSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.tertiary',
  textTransform: 'none',
  letterSpacing: 0,
  pb: 1,
} as const;

const cellSx = {
  fontSize: 13,
  color: 'kanap.text.primary',
  py: '8px',
  verticalAlign: 'top',
} as const;

const inputSx = {
  '& input': { fontSize: 13, padding: '4px 0', color: 'kanap.text.primary' },
} as const;

function tableSx(theme: any) {
  return {
    width: '100%',
    borderCollapse: 'collapse' as const,
    '& th': {
      ...headerSx,
      textAlign: 'left' as const,
      borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
    },
    '& td': {
      ...cellSx,
      borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
    },
    '& tbody tr:hover': {
      backgroundColor: theme.palette.kanap.bg.hover,
    },
  };
}

function actionLinkSx(theme: any) {
  return {
    all: 'unset' as const,
    cursor: 'pointer' as const,
    fontSize: 12,
    color: theme.palette.kanap.teal,
    fontWeight: 400,
    '&:hover': { textDecoration: 'underline' as const },
  };
}

function userDisplayName(user: InternalContact['user']): string {
  if (!user) return '';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.email;
}

function contactDisplayName(contact: ExternalContact['contact']): string {
  if (!contact) return '';
  const full = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return full || contact.email || '';
}

export default function LocationContactsTab({ locationId, canManage }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const [internal, setInternal] = React.useState<InternalContact[]>([]);
  const [external, setExternal] = React.useState<ExternalContact[]>([]);
  const [links, setLinks] = React.useState<LinkRow[]>([]);
  const [linkDrafts, setLinkDrafts] = React.useState<Array<{ draftId: string; description: string; url: string }>>([]);
  const [internalAdding, setInternalAdding] = React.useState(false);
  const [externalAdding, setExternalAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [intRes, extRes, linksRes] = await Promise.all([
        api.get(`/locations/${locationId}/internal-contacts`),
        api.get(`/locations/${locationId}/external-contacts`),
        api.get(`/locations/${locationId}/links`),
      ]);
      setInternal((intRes.data || []) as InternalContact[]);
      setExternal((extRes.data || []) as ExternalContact[]);
      setLinks((linksRes.data || []) as LinkRow[]);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.loadContactsFailed')));
    }
  }, [locationId, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleAddInternal = async (userId: string | null) => {
    if (!userId || !canManage) return;
    try {
      const res = await api.post(`/locations/${locationId}/internal-contacts`, { user_id: userId, role: null });
      const saved = res.data as InternalContact;
      const refreshed = await api.get(`/locations/${locationId}/internal-contacts`);
      const list = (refreshed.data || []) as InternalContact[];
      setInternal(list.length > 0 ? list : [saved]);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveContactsFailed')));
    }
  };

  const handleUpdateInternalRole = async (row: InternalContact, nextRole: string) => {
    if (!canManage) return;
    const role = nextRole.trim() || null;
    if (role === (row.role || null)) return;
    setInternal((prev) => prev.map((r) => (r.id === row.id ? { ...r, role } : r)));
    try {
      await api.patch(`/locations/${locationId}/internal-contacts/${row.id}`, {
        user_id: row.user_id,
        role,
      });
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveContactsFailed')));
      void load();
    }
  };

  const handleRemoveInternal = async (row: InternalContact) => {
    if (!canManage) return;
    const prev = internal;
    setInternal((current) => current.filter((r) => r.id !== row.id));
    try {
      await api.delete(`/locations/${locationId}/internal-contacts/${row.id}`);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveContactsFailed')));
      setInternal(prev);
    }
  };

  const handleAddExternal = async (contactId: string | null) => {
    if (!contactId || !canManage) return;
    try {
      const res = await api.post(`/locations/${locationId}/external-contacts`, { contact_id: contactId, role: null });
      const refreshed = await api.get(`/locations/${locationId}/external-contacts`);
      const list = (refreshed.data || []) as ExternalContact[];
      setExternal(list.length > 0 ? list : [res.data as ExternalContact]);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveContactsFailed')));
    }
  };

  const handleUpdateExternalRole = async (row: ExternalContact, nextRole: string) => {
    if (!canManage) return;
    const role = nextRole.trim() || null;
    if (role === (row.role || null)) return;
    setExternal((prev) => prev.map((r) => (r.id === row.id ? { ...r, role } : r)));
    try {
      await api.patch(`/locations/${locationId}/external-contacts/${row.id}`, {
        contact_id: row.contact_id,
        role,
      });
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveContactsFailed')));
      void load();
    }
  };

  const handleRemoveExternal = async (row: ExternalContact) => {
    if (!canManage) return;
    const prev = external;
    setExternal((current) => current.filter((r) => r.id !== row.id));
    try {
      await api.delete(`/locations/${locationId}/external-contacts/${row.id}`);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveContactsFailed')));
      setExternal(prev);
    }
  };

  const addLinkDraft = () => {
    setLinkDrafts((rows) => [
      ...rows,
      { draftId: `draft-${Date.now()}-${rows.length}`, description: '', url: '' },
    ]);
  };

  const updateLinkDraft = (
    draftId: string,
    patch: Partial<{ description: string; url: string }>,
  ) => {
    setLinkDrafts((rows) => rows.map((r) => (r.draftId === draftId ? { ...r, ...patch } : r)));
  };

  const removeLinkDraft = (draftId: string) => {
    setLinkDrafts((rows) => rows.filter((r) => r.draftId !== draftId));
  };

  const commitLinkDraft = async (draft: { draftId: string; description: string; url: string }) => {
    const url = draft.url.trim();
    if (!url) {
      removeLinkDraft(draft.draftId);
      return;
    }
    try {
      const res = await api.post(`/locations/${locationId}/links`, {
        url,
        description: draft.description.trim() || null,
      });
      setLinks((prev) => [...prev, res.data as LinkRow]);
      removeLinkDraft(draft.draftId);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveContactsFailed')));
    }
  };

  const handleUpdateLink = async (
    row: LinkRow,
    patch: Partial<{ description: string | null; url: string }>,
  ) => {
    if (!canManage) return;
    const nextUrl = patch.url ?? row.url;
    if (!nextUrl.trim()) return;
    setLinks((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    try {
      await api.patch(`/locations/${locationId}/links/${row.id}`, {
        url: nextUrl.trim(),
        description: patch.description ?? row.description,
      });
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveContactsFailed')));
      void load();
    }
  };

  const handleRemoveLink = async (row: LinkRow) => {
    if (!canManage) return;
    const prev = links;
    setLinks((current) => current.filter((r) => r.id !== row.id));
    try {
      await api.delete(`/locations/${locationId}/links/${row.id}`);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveContactsFailed')));
      setLinks(prev);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {error && <Alert severity="error">{error}</Alert>}

      <Section
        title={t('it:workspace.location.contacts.internalTitle')}
        addLabel={t('it:workspace.location.contacts.addInternal')}
        canManage={canManage}
        onAdd={addInternalSlot}
        empty={internal.length === 0 ? t('it:workspace.location.contacts.noInternal') : null}
      >
        {internal.length > 0 && (
          <Box component="table" sx={tableSx}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={{ width: '40%' }}>{t('it:common.user')}</Box>
                <Box component="th">{t('it:common.role')}</Box>
                {canManage && <Box component="th" sx={{ width: 40 }} />}
              </Box>
            </Box>
            <Box component="tbody">
              {internal.map((row) => (
                <InternalRow
                  key={row.id}
                  row={row}
                  canManage={canManage}
                  onRoleChange={(next) => handleUpdateInternalRole(row, next)}
                  onRemove={() => handleRemoveInternal(row)}
                />
              ))}
            </Box>
          </Box>
        )}
        {internalAdding && canManage && (
          <Box sx={{ mt: 1 }}>
            <MetadataUserPicker
              value={null}
              placeholder={t('it:workspace.location.contacts.pickUser')}
              onChange={(userId) => {
                setInternalAdding(false);
                void handleAddInternal(userId);
              }}
            />
          </Box>
        )}
      </Section>

      <Section
        title={t('it:workspace.location.contacts.externalTitle')}
        addLabel={t('it:workspace.location.contacts.addExternal')}
        canManage={canManage}
        onAdd={addExternalSlot}
        empty={external.length === 0 ? t('it:workspace.location.contacts.noExternal') : null}
      >
        {external.length > 0 && (
          <Box component="table" sx={tableSx}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={{ width: '40%' }}>{t('it:workspace.location.contacts.contact')}</Box>
                <Box component="th">{t('it:common.role')}</Box>
                {canManage && <Box component="th" sx={{ width: 40 }} />}
              </Box>
            </Box>
            <Box component="tbody">
              {external.map((row) => (
                <ExternalRow
                  key={row.id}
                  row={row}
                  canManage={canManage}
                  onRoleChange={(next) => handleUpdateExternalRole(row, next)}
                  onRemove={() => handleRemoveExternal(row)}
                />
              ))}
            </Box>
          </Box>
        )}
        {externalAdding && canManage && (
          <Box sx={{ mt: 1, maxWidth: 360 }}>
            <ContactSelect
              value={null}
              onChange={(id) => {
                setExternalAdding(false);
                void handleAddExternal(id);
              }}
            />
          </Box>
        )}
      </Section>

      <Section
        title={t('it:workspace.location.contacts.websitesTitle')}
        addLabel={t('it:workspace.location.contacts.addWebsite')}
        canManage={canManage}
        onAdd={addLinkDraft}
        empty={links.length === 0 && linkDrafts.length === 0 ? t('it:workspace.location.contacts.noWebsites') : null}
      >
        {(links.length > 0 || linkDrafts.length > 0) && (
          <Box component="table" sx={tableSx}>
            <Box component="thead">
              <Box component="tr">
                <Box component="th" sx={{ width: '35%' }}>{t('it:workspace.location.contacts.description')}</Box>
                <Box component="th">URL</Box>
                <Box component="th" sx={{ width: 72 }} />
              </Box>
            </Box>
            <Box component="tbody">
              {links.map((row) => (
                <LinkRowComponent
                  key={row.id}
                  row={row}
                  canManage={canManage}
                  onSave={(patch) => handleUpdateLink(row, patch)}
                  onRemove={() => handleRemoveLink(row)}
                />
              ))}
              {linkDrafts.map((draft) => (
                <Box component="tr" key={draft.draftId}>
                  <Box component="td">
                    <TextField
                      value={draft.description}
                      onChange={(e) => updateLinkDraft(draft.draftId, { description: e.target.value })}
                      placeholder={t('it:workspace.location.contacts.description')}
                      variant="standard"
                      fullWidth
                      sx={inputSx}
                    />
                  </Box>
                  <Box component="td">
                    <TextField
                      value={draft.url}
                      onChange={(e) => updateLinkDraft(draft.draftId, { url: e.target.value })}
                      onBlur={() => void commitLinkDraft(draft)}
                      placeholder="https://..."
                      variant="standard"
                      fullWidth
                      autoFocus
                      sx={inputSx}
                    />
                  </Box>
                  <Box component="td">
                    <IconButton size="small" onClick={() => removeLinkDraft(draft.draftId)} aria-label={t('common:buttons.discard')}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Section>
    </Box>
  );

  function addInternalSlot() {
    setInternalAdding(true);
  }

  function addExternalSlot() {
    setExternalAdding(true);
  }
}

// adding slot toggles (defined at component scope above)

function Section({
  title,
  addLabel,
  canManage,
  onAdd,
  empty,
  children,
}: {
  title: string;
  addLabel: string;
  canManage: boolean;
  onAdd: () => void;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'kanap.text.primary' }}>
          {title}
        </Typography>
        {canManage && (
          <Box component="button" type="button" onClick={onAdd} sx={actionLinkSx}>
            {addLabel}
          </Box>
        )}
      </Box>
      {empty && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
          {empty}
        </Typography>
      )}
      {children}
    </Box>
  );
}

export function InternalRow({
  row,
  canManage,
  onRoleChange,
  onRemove,
}: {
  row: InternalContact;
  canManage: boolean;
  onRoleChange: (next: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const [role, setRole] = React.useState(row.role || '');
  // The field follows the stored role during the render that receives it, as the sub-location
  // rows do: an effect would run after the commit and could overwrite what was typed meanwhile.
  const [shownRole, setShownRole] = React.useState(row.role);
  if (shownRole !== row.role) {
    setShownRole(row.role);
    setRole(row.role || '');
  }

  return (
    <Box component="tr">
      <Box component="td">{userDisplayName(row.user)}</Box>
      <Box component="td">
        <TextField
          value={role}
          onChange={(e) => setRole(e.target.value)}
          onBlur={() => onRoleChange(role)}
          placeholder={t('it:workspace.location.contacts.internalRolePlaceholder')}
          variant="standard"
          fullWidth
          disabled={!canManage}
          sx={inputSx}
        />
      </Box>
      {canManage && (
        <Box component="td">
          <IconButton size="small" onClick={onRemove} aria-label={t('common:contacts.removeContact')}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}

export function ExternalRow({
  row,
  canManage,
  onRoleChange,
  onRemove,
}: {
  row: ExternalContact;
  canManage: boolean;
  onRoleChange: (next: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const [role, setRole] = React.useState(row.role || '');
  // The field follows the stored role during the render that receives it, as the sub-location
  // rows do: an effect would run after the commit and could overwrite what was typed meanwhile.
  const [shownRole, setShownRole] = React.useState(row.role);
  if (shownRole !== row.role) {
    setShownRole(row.role);
    setRole(row.role || '');
  }

  return (
    <Box component="tr">
      <Box component="td">{contactDisplayName(row.contact)}</Box>
      <Box component="td">
        <TextField
          value={role}
          onChange={(e) => setRole(e.target.value)}
          onBlur={() => onRoleChange(role)}
          placeholder={t('it:workspace.location.contacts.externalRolePlaceholder')}
          variant="standard"
          fullWidth
          disabled={!canManage}
          sx={inputSx}
        />
      </Box>
      {canManage && (
        <Box component="td">
          <IconButton size="small" onClick={onRemove} aria-label={t('common:contacts.removeContact')}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}

export function LinkRowComponent({
  row,
  canManage,
  onSave,
  onRemove,
}: {
  row: LinkRow;
  canManage: boolean;
  onSave: (patch: Partial<{ description: string | null; url: string }>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const [description, setDescription] = React.useState(row.description || '');
  const [url, setUrl] = React.useState(row.url);
  // The fields follow the stored link during the render that receives it (see InternalRow).
  const [shown, setShown] = React.useState({ description: row.description, url: row.url });
  if (shown.description !== row.description || shown.url !== row.url) {
    setShown({ description: row.description, url: row.url });
    if (shown.description !== row.description) setDescription(row.description || '');
    if (shown.url !== row.url) setUrl(row.url);
  }

  return (
    <Box component="tr">
      <Box component="td">
        <TextField
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            const next = description || null;
            if (next !== (row.description || null)) onSave({ description: next });
          }}
          placeholder={t('it:workspace.location.contacts.description')}
          variant="standard"
          fullWidth
          disabled={!canManage}
          sx={inputSx}
        />
      </Box>
      <Box component="td">
        <TextField
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => {
            if (url.trim() && url !== row.url) onSave({ url });
          }}
          placeholder="https://..."
          variant="standard"
          fullWidth
          disabled={!canManage}
          sx={inputSx}
        />
      </Box>
      <Box component="td">
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton
            size="small"
            disabled={!row.url}
            onClick={() => row.url && window.open(row.url, '_blank', 'noopener,noreferrer')}
            aria-label={t('it:workspace.location.contacts.openLink')}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
          {canManage && (
            <IconButton size="small" onClick={onRemove} aria-label={t('common:markdownLink.removeLink')}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>
    </Box>
  );
}
