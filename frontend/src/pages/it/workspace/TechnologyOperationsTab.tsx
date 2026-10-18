import React from 'react';
import { Alert, Box, Button, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog, PropertyRow } from '../../../components/design';
import ContactSelect from '../../../components/fields/ContactSelect';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { drawerFieldValueSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { AutosaveText, type TechnologyDetail, type TechnologyPatch } from './TechnologyOverviewTab';

export type SupportContactRow = {
  id?: string;
  contact_id: string | null;
  role?: string | null;
  contact?: {
    id?: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    mobile?: string | null;
  } | null;
};

export const technologySupportContactsKey = (id: string) => ['technology-support-contacts', id] as const;

function contactName(row: SupportContactRow, unnamedLabel: string) {
  const contact = row.contact || {};
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return name || contact.email || unnamedLabel;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="h2" sx={(theme) => ({ m: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: theme.palette.kanap.text.primary })}>
      {children}
    </Typography>
  );
}

/**
 * The Operations tab of a technology, as the application's support section: its support contacts
 * (editor, integrator, internal team), each change saved at once by replacing the list, and its
 * support notes, saved after a pause in typing.
 */
export default function TechnologyOperationsTab({ technology, canManage, onPatch, onError }: {
  technology: TechnologyDetail;
  canManage: boolean;
  onPatch: (patch: TechnologyPatch) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const queryClient = useQueryClient();
  const unnamedContact = t('workspace.application.technical.unnamedContact');
  const key = technologySupportContactsKey(technology.id);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<{ contact_id: string | null; role: string }>({ contact_id: null, role: '' });
  const [saving, setSaving] = React.useState(false);

  const contactsQuery = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<SupportContactRow[]>(`/technologies/${technology.id}/support-contacts`)).data || [],
  });
  const contacts = contactsQuery.data || [];
  // The list is replaced as a whole: it can change only once it has been read.
  const canEdit = canManage && contactsQuery.isSuccess;
  const alreadyListed = !!draft.contact_id && contacts.some((item) => item.contact_id === draft.contact_id);

  // Replacements run one after the other, each from the last list known (the server's answer to
  // the previous one), so two quick changes never undo each other.
  const queue = React.useRef<Promise<unknown>>(Promise.resolve());
  const replaceContacts = React.useCallback((change: (current: SupportContactRow[]) => SupportContactRow[], optimistic = false) => {
    const queryKey = technologySupportContactsKey(technology.id);
    const run = queue.current.then(async () => {
      const next = change(queryClient.getQueryData<SupportContactRow[]>(queryKey) ?? []);
      if (optimistic) queryClient.setQueryData(queryKey, next);
      try {
        const res = await api.post<SupportContactRow[]>(`/technologies/${technology.id}/support-contacts/bulk-replace`, {
          contacts: next.filter((item) => item.contact_id).map((item) => ({ contact_id: item.contact_id, role: item.role || null })),
        });
        queryClient.setQueryData(queryKey, res.data || []);
        return true;
      } catch (err) {
        onError(getApiErrorMessage(err, t, t('workspace.technology.messages.saveFailed')));
        await queryClient.invalidateQueries({ queryKey });
        return false;
      }
    });
    queue.current = run;
    return run;
  }, [onError, queryClient, t, technology.id]);

  const addContact = async () => {
    const contactId = draft.contact_id;
    if (!contactId || alreadyListed) return;
    setSaving(true);
    const ok = await replaceContacts((current) => [...current, { contact_id: contactId, role: draft.role || null }]);
    setSaving(false);
    if (!ok) return;
    setDialogOpen(false);
    setDraft({ contact_id: null, role: '' });
  };

  return (
    <Stack spacing={3.75}>
      {contactsQuery.isError && <Alert severity="error">{t('workspace.technology.operations.contactsLoadFailed')}</Alert>}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <SectionLabel>{t('workspace.application.technical.support')}</SectionLabel>
          <Box sx={{ flex: 1 }} />
          {canEdit && (
            <Button variant="action" size="small" onClick={() => setDialogOpen(true)}>
              {t('workspace.application.technical.addContact')}
            </Button>
          )}
        </Box>
        <Table size="small" aria-label={t('workspace.application.technical.support')} sx={(theme) => ({
          '& th': { fontSize: 11, fontWeight: 500, color: theme.palette.kanap.text.tertiary, borderBottom: `1px solid ${theme.palette.kanap.border.default}` },
          '& td': { fontSize: 13, color: theme.palette.kanap.text.primary, borderBottom: `1px solid ${theme.palette.kanap.border.soft}` },
          '& tbody tr:hover': { bgcolor: theme.palette.kanap.bg.hover },
          '& .hover-actions': { opacity: 0, transition: 'opacity 120ms' },
          '& tbody tr:hover .hover-actions, & .hover-actions:focus-within': { opacity: 1 },
        })}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 140 }}>{t('workspace.application.technical.contact')}</TableCell>
              <TableCell sx={{ width: 180 }}>{t('workspace.application.technical.email')}</TableCell>
              <TableCell sx={{ width: 130 }}>{t('workspace.application.technical.phone')}</TableCell>
              <TableCell>{t('workspace.application.technical.role')}</TableCell>
              {canEdit && <TableCell align="right" sx={{ width: 52 }} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {contactsQuery.isSuccess && contacts.length === 0 && (
              <TableRow>
                <TableCell colSpan={canEdit ? 5 : 4} sx={(theme) => ({ color: `${theme.palette.kanap.text.tertiary} !important` })}>
                  {t('workspace.application.technical.noSupportContacts')}
                </TableCell>
              </TableRow>
            )}
            {contacts.map((row, index) => (
              <TableRow key={row.id || `${row.contact_id}:${index}`}>
                <TableCell>{contactName(row, unnamedContact)}</TableCell>
                <TableCell>{row.contact?.email || '—'}</TableCell>
                <TableCell sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: '12px !important' }}>{row.contact?.phone || row.contact?.mobile || '—'}</TableCell>
                <TableCell sx={!row.role ? (theme) => ({ color: `${theme.palette.kanap.text.tertiary} !important` }) : undefined}>{row.role || '—'}</TableCell>
                {canEdit && (
                  <TableCell align="right">
                    <Box className="hover-actions">
                      <IconButton
                        aria-label={t('workspace.application.technical.removeContact', { name: contactName(row, unnamedContact) })}
                        size="small"
                        onClick={() => { void replaceContacts((current) => current.filter((item) => item.contact_id !== row.contact_id), true); }}
                      >
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Box sx={{ mt: 2.25 }}>
          <Box sx={{ mb: 1 }}><SectionLabel>{t('workspace.application.technical.supportNotes')}</SectionLabel></Box>
          <AutosaveText
            value={technology.support_notes ?? null}
            onSave={(value) => onPatch({ support_notes: value })}
            disabled={!canManage}
            multiline
            composer
            placeholder={t('workspace.application.technical.supportNotesPlaceholder')}
            ariaLabel={t('workspace.application.technical.supportNotes')}
          />
        </Box>
      </Box>

      <KanapDialog
        open={dialogOpen}
        title={t('workspace.application.technical.newSupportContact')}
        onClose={() => setDialogOpen(false)}
        onSave={addContact}
        saveLabel={t('common:buttons.save')}
        saveDisabled={!draft.contact_id || alreadyListed}
        saveLoading={saving}
      >
        <Stack spacing={1.25}>
          <PropertyRow label={t('workspace.application.technical.contact')} required>
            <ContactSelect
              value={draft.contact_id}
              onChange={(value) => setDraft((prev) => ({ ...prev, contact_id: value }))}
              onContactChange={(contact) => setDraft({ contact_id: contact?.id || null, role: contact?.job_title || '' })}
              groupByCompany={false}
              hideLabel
              label={t('workspace.application.technical.contact')}
              textFieldSx={drawerFieldValueSx}
            />
            {alreadyListed && (
              <Typography role="status" sx={{ mt: 0.5, fontSize: 12, color: 'kanap.text.secondary' }}>
                {t('workspace.technology.operations.alreadyListed')}
              </Typography>
            )}
          </PropertyRow>
          <PropertyRow label={t('workspace.application.technical.role')}>
            <TextField
              value={draft.role}
              onChange={(event) => setDraft((prev) => ({ ...prev, role: event.target.value }))}
              variant="standard"
              fullWidth
              inputProps={{ maxLength: 200 }}
              sx={drawerFieldValueSx}
            />
          </PropertyRow>
        </Stack>
      </KanapDialog>
    </Stack>
  );
}
