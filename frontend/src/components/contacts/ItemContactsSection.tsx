import React from 'react';
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import ContactSelect from '../fields/ContactSelect';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate } from 'react-router-dom';
import { drawerFieldValueSx, drawerSelectSx, drawerMenuItemSx, inlineControlSx } from '../../theme/formSx';
import RelationsSectionTitle from '../../pages/portfolio/components/RelationsSectionTitle';

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

export default function ItemContactsSection({ itemType, itemId, canManage, syncFromSupplier = false, onChanged }: Props) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const qc = useQueryClient();

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

  // Inline add flow: pick a contact → the role select appears → picking the role saves.
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

  if (isLoading) {
    return <Typography variant="body2" color="text.secondary">{t('contacts.loadingContacts')}</Typography>;
  }

  return (
    <Stack spacing={1.25}>
      <RelationsSectionTitle>{t('contacts.title')}</RelationsSectionTitle>

      {contacts.length === 0 ? (
        <Typography variant="body2" sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
          {t('contacts.noContactsLinked')}
        </Typography>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{
            '& th': { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', borderBottomColor: 'kanap.border.default' },
            '& td': { fontSize: 13, borderBottomColor: 'kanap.border.soft' },
            '& tbody tr': { cursor: 'pointer' },
            '& tbody tr:hover': { backgroundColor: 'kanap.bg.hover' },
            '& tbody tr:hover .contact-row-delete': { opacity: 1 },
          }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 130 }}>{t('labels.role')}</TableCell>
                <TableCell>{t('contacts.firstName')}</TableCell>
                <TableCell>{t('contacts.lastName')}</TableCell>
                <TableCell>{t('contacts.jobTitle')}</TableCell>
                <TableCell>{t('labels.email')}</TableCell>
                <TableCell>{t('contacts.mobile')}</TableCell>
                <TableCell align="right" sx={{ width: 56 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {contacts.map((link) => (
                <TableRow key={link.id} hover onClick={() => navigate(`/master-data/contacts/${link.contact.id}/overview`)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Typography
                      variant="body2"
                      sx={{ fontSize: 13, color: 'kanap.text.secondary' }}
                      title={link.origin === 'supplier' ? t('contacts.fromSupplier') : t('contacts.manuallyAdded')}
                    >
                      {t(`contacts.role${link.role.charAt(0).toUpperCase() + link.role.slice(1)}`)}
                    </Typography>
                  </TableCell>
                  <TableCell>{link.contact.first_name || ''}</TableCell>
                  <TableCell>{link.contact.last_name || ''}</TableCell>
                  <TableCell>{link.contact.job_title || ''}</TableCell>
                  <TableCell>{link.contact.email}</TableCell>
                  <TableCell>{link.contact.mobile || ''}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title={canManage ? t('contacts.removeContact') : t('contacts.insufficientPermission')}>
                      <span>
                        <IconButton
                          className="contact-row-delete"
                          size="small"
                          aria-label={t('contacts.removeContact')}
                          disabled={!canManage}
                          onClick={() => detach(link.id)}
                          sx={{ opacity: 0, transition: 'opacity 120ms', color: 'kanap.text.tertiary', '&:hover': { color: 'kanap.danger' } }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {canManage && syncFromSupplier && (
        <Button
          onClick={() => { void syncSupplier(); }}
          disabled={syncing}
          sx={{ p: 0, minWidth: 0, fontSize: 12, alignSelf: 'flex-start' }}
        >
          {t('contacts.syncFromSupplier')}
        </Button>
      )}

      {canManage && (
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ width: '100%', maxWidth: 420 }}>
            <ContactSelect
              hideLabel
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
                if (role) void attach({ contactId: selectedContact, role });
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
                  {t(`contacts.role${value.charAt(0).toUpperCase() + value.slice(1)}`)}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
      )}
    </Stack>
  );
}
