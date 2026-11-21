import React from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  MenuList,
  Popover,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import CreateContactDialog, { type CreateContactRequest } from '../fields/CreateContactDialog';
import { contactName, isContactReference } from '../fields/contactNames';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { foldText } from '../../utils/foldText';
import { formatItemRef, itemAddress } from '../../utils/item-ref';
import RelationAddPicker, { pickerItemSx, type RelationOption } from '../workspace/RelationAddPicker';
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
    /** CTCT-n: the contact's page opens by it. */
    item_number?: number | null;
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

/** A contact as the contacts search returns it (`GET /contacts`). */
type ContactSearchRow = {
  id: string;
  item_number?: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  supplier_name?: string | null;
};

/** The picker's cache key: the contacts search does not depend on the item. */
const CONTACT_SEARCH_KEY = 'item-contacts';

/** The contacts that match the text (a name, or a CTCT-n), as picker rows: reference, name, supplier. */
async function searchContacts(q: string, signal?: AbortSignal): Promise<RelationOption[]> {
  const res = await api.get<{ items: ContactSearchRow[] }>('/contacts', { params: { limit: 20, q }, signal });
  return (res.data?.items ?? []).map((contact) => ({
    id: contact.id,
    label: contactName(contact),
    ref: contact.item_number ? formatItemRef('contact', contact.item_number) : null,
    hint: contact.supplier_name ?? null,
  }));
}

/** The contact whose role is asked: its reference and name head the list of roles. */
type PickedContact = { id: string; name: string; ref: string | null };

function roleLabelKey(role: SupplierContactRole): string {
  return `contacts.role${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

const textButtonSx = { fontSize: 12, minWidth: 0, px: 1 } as const;

/**
 * Contacts of a contract or a budget line, as a Relations section: it shares the width of the
 * sibling sections. Add opens the list of contacts anchored to the button, as the other Relations
 * sections do; the list ends with "create a contact" for a person who may. The contact chosen (or
 * created), the same place lists the roles: choosing one links the contact with it.
 */
export default function ItemContactsSection({ itemType, itemId, canManage, syncFromSupplier = false, onChanged }: Props) {
  const { t } = useTranslation(['common', 'master-data']);
  const qc = useQueryClient();
  const { hasLevel } = useAuth();
  // The same check as the contact picker and the page that creates a contact.
  const mayCreateContact = hasLevel('contacts', 'member');
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

  // Add opens the list of contacts under the button; a contact chosen or created, its roles take the
  // same place. The anchor stays while the create dialog is open, so the roles open where the list was.
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [step, setStep] = React.useState<'contact' | PickedContact | null>(null);
  const [request, setRequest] = React.useState<CreateContactRequest | null>(null);
  const requestKey = React.useRef(0);
  const closeAdd = () => { setStep(null); setAnchor(null); };

  const { mutateAsync: attach } = useMutation({
    mutationFn: async ({ contactId, role }: { contactId: string; role: SupplierContactRole }) => {
      await api.post(`/${itemType}/${itemId}/contacts`, { contactId, role });
    },
    onSuccess: async () => {
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

  // The server links a contact once per role and takes any role a contact does not have yet on the
  // item, so no contact is left out of the list.
  const noneExcluded = React.useMemo(() => new Set<string>(), []);

  // The list ends with "create": "new contact" while nothing is typed, the typed name when no contact
  // shown has exactly that name, never for a typed reference (CTCT-n).
  const createAction = React.useMemo(() => (mayCreateContact ? {
    label: (text: string, options: RelationOption[]) => {
      if (!text) return t('master-data:contacts.newContactOption');
      if (isContactReference(text)) return null;
      const needle = foldText(text);
      if (options.some((option) => foldText(option.label) === needle)) return null;
      return t('master-data:contacts.createOption', { name: text });
    },
    onChoose: (text: string) => {
      setStep(null);
      requestKey.current += 1;
      setRequest({ key: requestKey.current, typed: text });
    },
  } : undefined), [mayCreateContact, t]);

  const finishCreate = (contact: { id?: string; item_number?: number | null; first_name?: string | null; last_name?: string | null; email: string } | null) => {
    setRequest(null);
    if (!contact?.id) { setAnchor(null); return; }
    void qc.invalidateQueries({ queryKey: ['relation-add', CONTACT_SEARCH_KEY] });
    setStep({ id: contact.id, name: contactName(contact), ref: contact.item_number ? formatItemRef('contact', contact.item_number) : null });
  };

  const pickRole = (contact: PickedContact, role: SupplierContactRole) => {
    closeAdd();
    void run(() => attach({ contactId: contact.id, role }));
  };

  const picked = step !== null && step !== 'contact' ? step : null;

  return (
    <RelationsSection
      title={t('contacts.title')}
      count={isLoading ? undefined : contacts.length}
      onAdd={canManage ? (button) => { setAnchor(button); setStep('contact'); } : undefined}
      adding={step !== null || request !== null}
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
          rowHref={(link) => `/master-data/contacts/${itemAddress('contact', link.contact)}/overview`}
          linkRows
          onRemove={canManage ? (link) => { void run(() => detach(link.id)); } : undefined}
          removeLabel={() => t('contacts.removeContact')}
        />
      )}
      {canManage && anchor && step === 'contact' && (
        <RelationAddPicker
          anchorEl={anchor}
          searchKey={CONTACT_SEARCH_KEY}
          search={searchContacts}
          excludeIds={noneExcluded}
          placeholder={t('contacts.selectContact')}
          ariaLabel={t('contacts.selectContact')}
          onPick={(option) => setStep({ id: option.id, name: option.label, ref: option.ref ?? null })}
          onClose={closeAdd}
          action={createAction}
        />
      )}
      {canManage && anchor && picked && (
        <Popover
          open
          anchorEl={anchor}
          onClose={closeAdd}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{ paper: { sx: { p: 1, width: 380, mt: 0.5 } } }}
        >
          <Typography
            component="div"
            title={picked.name}
            sx={{ display: 'flex', alignItems: 'baseline', gap: 1, px: 1, pt: 0.25, pb: 0.75, fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}
          >
            {picked.ref && <Box component="span" sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.tertiary', flexShrink: 0 }}>{picked.ref}</Box>}
            <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{picked.name}</Box>
          </Typography>
          <MenuList autoFocus aria-label={t('labels.role')} dense disablePadding sx={{ py: 0.25 }}>
            {ROLES.map((role) => (
              <MenuItem key={role} onClick={() => pickRole(picked, role)} sx={pickerItemSx}>
                {t(roleLabelKey(role))}
              </MenuItem>
            ))}
          </MenuList>
        </Popover>
      )}
      <CreateContactDialog request={request} onResolve={finishCreate} />
    </RelationsSection>
  );
}
