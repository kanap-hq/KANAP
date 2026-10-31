import React from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import ContactSelect from '../fields/ContactSelect';
import { drawerFieldValueSx, drawerSelectSx, drawerMenuItemSx, inlineControlSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../workspace/RelationsTable';

type SupplierContactRole = 'commercial' | 'technical' | 'support' | 'other';
type ContactOrigin = 'supplier' | 'manual';

type ItemContactLink = {
  id: string;
  contact_id: string;
  role: SupplierContactRole;
  origin: ContactOrigin;
  contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    email: string;
    mobile: string | null;
  };
};

type Props = {
  itemType: 'spend-items' | 'capex-items' | 'contracts';
  itemId: string;
  canManage: boolean;
  /** Offers to add the supplier's contacts to the item (`POST …/contacts/sync-from-supplier`). */
  syncFromSupplier?: boolean;
  /** Called after the item's contacts changed. */
  onChanged?: () => void;
};

const ROLES = ['commercial', 'technical', 'support', 'other'] as const;

function roleLabelKey(role: SupplierContactRole): string {
  return `contacts.role${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

const textButtonSx = { fontSize: 12, minWidth: 0, px: 1 } as const;

/**
 * Contacts of a contract or a budget line, as a Relations section: it shares the width of the
 * sibling sections. Add opens the contact picker, then the role; choosing the role saves.
 */
export default function ItemContactsSection({ itemType, itemId, canManage, syncFromSupplier = false, onChanged }: Props) {
  const { t } = useTranslation('common');
  const qc = useQueryClient();
  // A refused add or removal (a line read only in the person's access) says why; nothing changed.
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(async (write: () => Promise<unknown>) => {
    setError(null);
    try {
      await write();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('contacts.saveFailed')));
    }
  }, [t]);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['item-contacts', itemType, itemId],
    queryFn: async () => (await api.get<ItemContactLink[]>(`/${itemType}/${itemId}/contacts`)).data,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const { mutateAsync: syncSupplier, isPending: syncing } = useMutation({
    mutationFn: async () => {
      await api.post(`/${itemType}/${itemId}/contacts/sync-from-supplier`, {});
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['item-contacts', itemType, itemId] });
      onChanged?.();
    },
  });

  // Add opens the picker. A contact, then its role: choosing the role saves and the picker stays for the next one.
  const [adding, setAdding] = React.useState(false);
  const [selectedContact, setSelectedContact] = React.useState<string | null>(null);

  const { mutateAsync: attach, isPending: attaching } = useMutation({
    mutationFn: async ({ contactId, role }: { contactId: string; role: SupplierContactRole }) => {
      await api.post(`/${itemType}/${itemId}/contacts`, { contactId, role });
    },
    onSuccess: async () => {
      setSelectedContact(null);
      await qc.invalidateQueries({ queryKey: ['item-contacts', itemType, itemId] });
      onChanged?.();
    },
  });

  const { mutateAsync: detach } = useMutation({
    mutationFn: async (linkId: string) => {
      await api.delete(`/${itemType}/${itemId}/contacts/${linkId}`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['item-contacts', itemType, itemId] });
      onChanged?.();
    },
  });

  // First name is the name column (no width): the row link sits on it, and a wider sibling
  // section stretches this table up to the shared width.
  const columns = React.useMemo<Array<RelationsColumn<ItemContactLink>>>(() => [
    {
      key: 'role',
      header: t('labels.role'),
      width: 120,
      render: (link) => (
        <Box
          component="span"
          sx={{ color: 'kanap.text.secondary' }}
          title={link.origin === 'supplier' ? t('contacts.fromSupplier') : t('contacts.manuallyAdded')}
        >
          {t(roleLabelKey(link.role))}
        </Box>
      ),
    },
    {
      key: 'firstName',
      header: t('contacts.firstName'),
      render: (link) => link.contact.first_name || '',
    },
    {
      key: 'lastName',
      header: t('contacts.lastName'),
      width: 140,
      render: (link) => link.contact.last_name || '',
    },
    {
      key: 'jobTitle',
      header: t('contacts.jobTitle'),
      width: 150,
      hideOrder: 2,
      render: (link) => link.contact.job_title || '',
    },
    {
      key: 'email',
      header: t('labels.email'),
      width: 200,
      render: (link) => link.contact.email,
    },
    {
      key: 'mobile',
      header: t('contacts.mobile'),
      width: 130,
      hideOrder: 1,
      render: (link) => link.contact.mobile || '',
    },
  ], [t]);

  const toggleAdd = () => {
    setAdding((open) => !open);
    setSelectedContact(null);
  };

  return (
    <RelationsSection
      title={t('contacts.title')}
      count={isLoading ? undefined : contacts.length}
      onAdd={canManage ? toggleAdd : undefined}
      adding={adding}
      addLabel={t('buttons.add')}
      actions={canManage && syncFromSupplier ? (
        <Button
          variant="text"
          size="small"
          onClick={() => { void run(() => syncSupplier()); }}
          disabled={syncing}
          sx={textButtonSx}
        >
          {t('contacts.syncFromSupplier')}
        </Button>
      ) : undefined}
    >
      {!!error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>{error}</Alert>}
      {isLoading ? (
        <RelationsEmpty>{t('contacts.loadingContacts')}</RelationsEmpty>
      ) : contacts.length === 0 ? (
        <RelationsEmpty>{t('contacts.noContactsLinked')}</RelationsEmpty>
      ) : (
        <RelationsTable
          ariaLabel={t('contacts.title')}
          columns={columns}
          rows={contacts}
          rowKey={(link) => link.id}
          rowHref={(link) => `/master-data/contacts/${link.contact.id}/overview`}
          linkRows
          onRemove={canManage ? (link) => { void run(() => detach(link.id)); } : undefined}
          removeLabel={() => t('contacts.removeContact')}
        />
      )}
      {canManage && adding && (
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
          <Box sx={{ width: '100%', maxWidth: 420 }}>
            <ContactSelect
              hideLabel
              label={t('contacts.selectContact')}
              placeholder={t('contacts.selectContact')}
              value={selectedContact}
              onChange={setSelectedContact}
              disabled={attaching}
              textFieldSx={drawerFieldValueSx}
            />
          </Box>
          {selectedContact && (
            <TextField
              select
              variant="standard"
              value=""
              onChange={(e) => {
                const role = e.target.value as SupplierContactRole;
                if (role) void run(() => attach({ contactId: selectedContact, role }));
              }}
              disabled={attaching}
              SelectProps={{
                displayEmpty: true,
                renderValue: () => (
                  <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('labels.role')}…</Box>
                ),
              }}
              sx={[drawerSelectSx, inlineControlSx, { width: 'auto', minWidth: 140 }]}
            >
              {ROLES.map((value) => (
                <MenuItem key={value} value={value} sx={drawerMenuItemSx}>
                  {t(roleLabelKey(value))}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
      )}
    </RelationsSection>
  );
}
