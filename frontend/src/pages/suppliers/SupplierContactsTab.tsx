import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, IconButton, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../../api';
import { useNotify } from '../../components/notify/NotifyProvider';
import ContactSelect from '../../components/fields/ContactSelect';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { contactName, type ContactRole } from '../contacts/contactModel';
import { useContactRoleOptions } from '../contacts/ContactFields';
import { type SupplierContactLink, newContactHref } from './supplierModel';

export const supplierContactsKey = (supplierId: string) => ['supplier-contacts', supplierId] as const;

/** The contacts linked to a supplier, refetched on each visit: a contact page may have changed them. */
export function useSupplierContacts(supplierId: string) {
  return useQuery({
    queryKey: supplierContactsKey(supplierId),
    queryFn: async () => (await api.get<SupplierContactLink[]>(`/suppliers/${supplierId}/contacts`)).data,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

const actionLinkSx = (theme: Theme) => ({
  all: 'unset' as const,
  cursor: 'pointer' as const,
  fontSize: 12,
  color: theme.palette.kanap.teal,
  '&:hover': { textDecoration: 'underline' as const },
  '&:focus-visible': { outline: `2px solid ${theme.palette.kanap.teal}`, outlineOffset: 2, borderRadius: '2px' },
});

const nameLinkSx = (theme: Theme) => ({
  color: 'inherit',
  textDecoration: 'none',
  '&:hover': { color: theme.palette.kanap.teal, textDecoration: 'underline', textUnderlineOffset: '2px' },
});

/** The supplier's contacts by contact type: names that open the contact, add an existing one or create one. */
export default function SupplierContactsTab({ supplierId, canManage }: { supplierId: string; canManage: boolean }) {
  const { t } = useTranslation(['master-data', 'common']);
  const notify = useNotify();
  const queryClient = useQueryClient();
  const roleOptions = useContactRoleOptions();
  const { data: links, error: loadError } = useSupplierContacts(supplierId);
  const [adding, setAdding] = React.useState<ContactRole | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const addInputRef = React.useRef<HTMLInputElement>(null);

  // The search field opened by "Add existing" takes the focus.
  React.useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: supplierContactsKey(supplierId) });

  const attach = async (role: ContactRole, contactId: string | null) => {
    if (!contactId || !canManage) return;
    setAdding(null);
    setError(null);
    try {
      await api.post(`/suppliers/${supplierId}/contacts`, { contactId, role });
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('suppliers.contacts.saveFailed')));
    } finally {
      await refresh();
    }
  };

  const detach = async (removedLink: SupplierContactLink) => {
    if (!canManage) return;
    setError(null);
    queryClient.setQueryData<SupplierContactLink[]>(
      supplierContactsKey(supplierId),
      (prev) => prev?.filter((link) => link.id !== removedLink.id),
    );
    try {
      await api.delete(`/suppliers/${supplierId}/contacts/${removedLink.id}`);
      notify({
        message: t('suppliers.contacts.linkRemoved'),
        undo: () => undoDetach(removedLink),
      });
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('suppliers.contacts.saveFailed')));
    } finally {
      await refresh();
    }
  };

  /** Puts the removed link back, with its contact type and primary flag. */
  const undoDetach = async (link: SupplierContactLink) => {
    if (!canManage) return;
    setError(null);
    try {
      await api.post(`/suppliers/${supplierId}/contacts`, { contactId: link.contact_id, role: link.role, isPrimary: link.is_primary });
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('suppliers.contacts.saveFailed')));
    } finally {
      await refresh();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 640 }}>
      {(error || loadError) && (
        <Alert severity="error" onClose={error ? () => setError(null) : undefined}>
          {error ?? t('suppliers.contacts.loadFailed')}
        </Alert>
      )}
      {roleOptions.map((role) => {
        const items = (links ?? []).filter((link) => link.role === role.value);
        return (
          <Box key={role.value} component="section" aria-label={role.label}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 0.5 }}>
              <Typography component="h3" sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary', flex: 1 }}>
                {role.label}
              </Typography>
              {canManage && (
                <>
                  <Box component="button" type="button" onClick={() => setAdding(role.value)} sx={actionLinkSx}>
                    {t('suppliers.contacts.addExisting')}
                  </Box>
                  <Box component={RouterLink} to={newContactHref(supplierId, role.value)} sx={actionLinkSx}>
                    {t('suppliers.contacts.create')}
                  </Box>
                </>
              )}
            </Box>
            {items.length === 0 && adding !== role.value && (
              <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary', py: '6px' }}>
                {links ? t('suppliers.contacts.noContacts') : ' '}
              </Typography>
            )}
            {items.length > 0 && (
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {items.map((link) => (
                  <Box
                    component="li"
                    key={link.id}
                    sx={(theme) => ({
                      display: 'flex',
                      alignItems: 'center',
                      minHeight: 32,
                      fontSize: 13,
                      color: theme.palette.kanap.text.primary,
                      borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
                    })}
                  >
                    <Box
                      component={RouterLink}
                      to={`/master-data/contacts/${link.contact.id}/overview`}
                      sx={[nameLinkSx, { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }]}
                    >
                      {contactName(link.contact) ?? link.contact.email}
                    </Box>
                    {canManage && (
                      <IconButton
                        size="small"
                        aria-label={t('suppliers.contacts.removeLink')}
                        title={t('suppliers.contacts.removeLink')}
                        onClick={() => { void detach(link); }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                ))}
              </Box>
            )}
            {adding === role.value && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <ContactSelect
                    ref={addInputRef}
                    hideLabel
                    label={t('suppliers.contacts.selectContact', { role: role.label })}
                    placeholder={t('suppliers.contacts.searchPlaceholder')}
                    value={null}
                    onChange={(contactId) => { void attach(role.value, contactId); }}
                  />
                </Box>
                <Box component="button" type="button" onClick={() => setAdding(null)} sx={actionLinkSx}>
                  {t('common:buttons.cancel')}
                </Box>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
