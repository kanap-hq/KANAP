import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../../../api';
import { useLookupPicker } from '../../../hooks/useLookupPicker';
import { useAuth } from '../../../auth/AuthContext';
import { PropertyRow } from '../../../components/design';
import DateEUField from '../../../components/fields/DateEUField';
import ContactSelect from '../../../components/fields/ContactSelect';
import { drawerAutocompleteListboxSx, drawerFieldValueSx, longFormSurfaceFieldSx } from '../../../theme/formSx';

import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

type VendorOption = { id: string; name: string };
type ContractOption = { id: string; name: string };

type SupportInfo = {
  vendor_id?: string | null;
  support_contract_id?: string | null;
  /** A limited person cannot read the support contract: no id, no name, the label alone (spec §5.4). */
  support_contract_hidden?: boolean;
  support_tier?: string | null;
  support_expiry?: string | null;
  notes?: string | null;
};

type SupportContactRow = {
  id?: string;
  contact_id: string | null;
  role: string;
  contact?: {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    mobile?: string | null;
  } | null;
};

type SupportDraft = { info: SupportInfo; contacts: SupportContactRow[] };

function normalizeInfo(data?: SupportInfo | null): SupportInfo {
  return {
    vendor_id: data?.vendor_id || null,
    support_contract_id: data?.support_contract_id || null,
    support_tier: data?.support_tier || null,
    support_expiry: data?.support_expiry || null,
    notes: data?.notes || null,
  };
}

function sameSupport(info: SupportInfo, contacts: SupportContactRow[], draft: SupportDraft) {
  return JSON.stringify(normalizeInfo(info)) === JSON.stringify(normalizeInfo(draft.info))
    && JSON.stringify(normalizeContacts(contacts)) === JSON.stringify(normalizeContacts(draft.contacts));
}

// A save that fails while the panel is leaving. The next visit shows it again.
const supportDrafts = new Map<string, SupportDraft>();

export function clearSupportInfoDrafts() {
  supportDrafts.clear();
}

type Props = {
  assetId: string;
  onDirtyChange?: (dirty: boolean) => void;
  /** The fiche's message bar. The panel is gone when a save on leaving fails. */
  onSaveError?: (message: string | null) => void;
};

function normalizeContacts(rows: SupportContactRow[]) {
  return rows.map((r) => ({ contact_id: r.contact_id, role: (r.role || '').trim() }));
}

export default function SupportInfoPanel({ assetId, onDirtyChange, onSaveError }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const readOnly = !hasLevel('infrastructure', 'member');

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [vendorId, setVendorId] = React.useState<string | null>(null);
  const [contractId, setContractId] = React.useState<string | null>(null);
  const [contractHidden, setContractHidden] = React.useState(false);
  const [supportTier, setSupportTier] = React.useState('');
  const [supportExpiry, setSupportExpiry] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const [baseline, setBaseline] = React.useState<SupportInfo>({});
  const failedSaveSignatureRef = React.useRef<string | null>(null);
  // Set from the start of a save to its end, before the re-render that shows it.
  const savingRef = React.useRef(false);
  // What the unmount sends when a change is still waiting for its autosave.
  const pendingFlushRef = React.useRef<(() => void) | null>(null);

  // Support contacts
  const [supportContacts, setSupportContacts] = React.useState<SupportContactRow[]>([]);
  const [contactsBaseline, setContactsBaseline] = React.useState<SupportContactRow[]>([]);

  // Vendors and contracts searched as the user types; the chosen ones keep their labels (read by id).
  const vendorPicker = useLookupPicker<VendorOption>({ endpoint: '/suppliers/lookup', value: vendorId ? [vendorId] : [] });
  const contractPicker = useLookupPicker<ContractOption>({
    endpoint: '/contracts/lookup',
    value: contractId ? [contractId] : [],
    scope: vendorId ? { supplier_id: vendorId } : undefined,
  });

  const infoDirty = React.useMemo(() => {
    return (
      (vendorId || null) !== (baseline.vendor_id || null) ||
      (contractId || null) !== (baseline.support_contract_id || null) ||
      (supportTier || '') !== (baseline.support_tier || '') ||
      (supportExpiry || '') !== (baseline.support_expiry || '') ||
      (notes || '') !== (baseline.notes || '')
    );
  }, [vendorId, contractId, supportTier, supportExpiry, notes, baseline]);

  const contactsDirty = React.useMemo(() => {
    return JSON.stringify(normalizeContacts(supportContacts)) !== JSON.stringify(normalizeContacts(contactsBaseline));
  }, [supportContacts, contactsBaseline]);

  const dirty = infoDirty || contactsDirty;

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Load support info
      let serverInfo = normalizeInfo(null);
      let serverHidden = false;
      try {
        const res = await api.get(`/assets/${assetId}/support-info`);
        serverInfo = normalizeInfo(res.data as SupportInfo | null);
        serverHidden = (res.data as SupportInfo | null)?.support_contract_hidden === true;
      } catch (e: any) {
        if (e?.response?.status !== 404) {
          throw e;
        }
      }

      // Load support contacts
      let serverContacts: SupportContactRow[] = [];
      try {
        const res = await api.get(`/assets/${assetId}/support-contacts`);
        const items = (res.data || []) as SupportContactRow[];
        serverContacts = items.map((row) => ({
          id: row.id,
          contact_id: row.contact_id || null,
          role: row.role || '',
          contact: row.contact || null,
        }));
      } catch {
        serverContacts = [];
      }
      const draft = supportDrafts.get(assetId);
      if (draft && sameSupport(serverInfo, serverContacts, draft)) supportDrafts.delete(assetId);
      const kept = supportDrafts.get(assetId);
      const shownInfo = kept?.info ?? serverInfo;
      const shownContacts = kept?.contacts ?? serverContacts;
      setVendorId(shownInfo.vendor_id || null);
      setContractId(shownInfo.support_contract_id || null);
      setContractHidden(serverHidden);
      setSupportTier(shownInfo.support_tier || '');
      setSupportExpiry(shownInfo.support_expiry || '');
      setNotes(shownInfo.notes || '');
      setBaseline(serverInfo);
      setSupportContacts(shownContacts);
      setContactsBaseline(serverContacts);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.loadSupportInfoFailed')));
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Contact row helpers
  const addContactRow = () => {
    setSupportContacts((rows) => [...rows, { contact_id: null, role: '', contact: null }]);
  };

  const removeContactRow = (idx: number) => {
    setSupportContacts((rows) => rows.filter((_, i) => i !== idx));
  };

  const setContactRowContact = async (idx: number, contactId: string | null) => {
    setSupportContacts((rows) =>
      rows.map((row, i) => (i === idx ? { ...row, contact_id: contactId, contact: contactId ? row.contact : null } : row))
    );
    if (contactId) {
      try {
        const res = await api.get(`/contacts/${contactId}`);
        const details = res.data;
        setSupportContacts((rows) => rows.map((row, i) => (i === idx ? { ...row, contact: details } : row)));
      } catch { /* ignore */ }
    }
  };

  const setContactRowRole = (idx: number, role: string) => {
    setSupportContacts((rows) => rows.map((row, i) => (i === idx ? { ...row, role } : row)));
  };

  const supportInfoPayload = React.useMemo<SupportInfo>(() => ({
    vendor_id: vendorId || null,
    // A closed contract is not ours to send: leaving the field out keeps the link.
    ...(contractHidden ? {} : { support_contract_id: contractId || null }),
    support_tier: supportTier || null,
    support_expiry: supportExpiry || null,
    notes: notes || null,
  }), [contractHidden, vendorId, contractId, supportTier, supportExpiry, notes]);

  const saveSignature = React.useMemo(() => JSON.stringify({
    info: supportInfoPayload,
    contacts: normalizeContacts(supportContacts),
  }), [supportInfoPayload, supportContacts]);

  const contactsPayload = React.useMemo(
    () => normalizeContacts(supportContacts).filter((r) => r.contact_id),
    [supportContacts],
  );

  const save = React.useCallback(async () => {
    if (readOnly) return;
    supportDrafts.set(assetId, { info: supportInfoPayload, contacts: supportContacts });
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      // The support record and its contacts are two routes. Both are sent, and either failure is reported.
      await api.post(`/assets/${assetId}/support-info`, supportInfoPayload);
      setBaseline(supportInfoPayload);

      await api.post(`/assets/${assetId}/support-contacts/bulk-replace`, { contacts: contactsPayload });
      failedSaveSignatureRef.current = null;
      setContactsBaseline(supportContacts);
      onSaveError?.(null);
    } catch (e: any) {
      failedSaveSignatureRef.current = saveSignature;
      // The panel is on screen, so the failure stays in its own alert. Drop a page banner this
      // panel left behind on an earlier leave, so the same sentence is not shown twice.
      setError(getApiErrorMessage(e, t, t('messages.saveSupportInfoFailed')));
      onSaveError?.(null);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [assetId, contactsPayload, onSaveError, readOnly, saveSignature, supportContacts, supportInfoPayload, t]);

  React.useEffect(() => {
    if (!dirty || loading || saving || readOnly) return undefined;
    if (failedSaveSignatureRef.current === saveSignature) return undefined;
    const timer = window.setTimeout(() => {
      void save();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, loading, readOnly, save, saveSignature, saving]);

  // Leaving the tab before the autosave fires still saves the change, once, without touching state.
  React.useEffect(() => {
    const pending = dirty && !loading && !saving && !readOnly && failedSaveSignatureRef.current !== saveSignature;
    pendingFlushRef.current = pending
      ? () => {
          const draft = { info: supportInfoPayload, contacts: supportContacts };
          supportDrafts.set(assetId, draft);
          void (async () => {
            await api.post(`/assets/${assetId}/support-info`, supportInfoPayload);
            await api.post(`/assets/${assetId}/support-contacts/bulk-replace`, { contacts: contactsPayload });
            onSaveError?.(null);
          })().catch((e) => {
            onSaveError?.(getApiErrorMessage(e, t, t('messages.saveSupportInfoFailed')));
          });
        }
      : null;
  });

  React.useEffect(() => () => {
    if (!savingRef.current) pendingFlushRef.current?.();
  }, []);

  const selectedVendor = vendorId ? vendorPicker.selected[0] ?? null : null;
  const selectedContract = contractId ? contractPicker.selected[0] ?? null : null;

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}

      <Stack spacing={2} maxWidth={520}>
        <PropertyRow label={t('workspace.asset.support.vendor')}>
          <Autocomplete
            {...vendorPicker.autocomplete}
            options={vendorPicker.options}
            value={selectedVendor}
            onChange={(_, v) => {
              vendorPicker.remember([v]);
              const next = v?.id || null;
              setVendorId(next);
              // A contract belongs to one vendor. Changing the vendor drops a contract of the previous one.
              if (next !== vendorId) setContractId(null);
            }}
            getOptionLabel={(o) => vendorPicker.label(o, (vendor) => vendor.name ?? '')}
            disabled={readOnly || saving}
            renderOption={(props, option) => {
              const { key, ...optionProps } = props;
              return <li key={key} {...optionProps}>{option.name}</li>;
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t('workspace.asset.support.searchVendors')}
                variant="standard"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {vendorPicker.loading ? <CircularProgress color="inherit" size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
                sx={drawerFieldValueSx}
              />
            )}
            ListboxProps={{ sx: drawerAutocompleteListboxSx }}
            fullWidth
          />
        </PropertyRow>

        <PropertyRow label={t('workspace.asset.support.supportContract')}>
          {contractHidden ? (
            <Typography sx={{ fontSize: 13 }}>{t('ops:contracts.outsideYourAccess')}</Typography>
          ) : (
            <Autocomplete
              {...contractPicker.autocomplete}
              options={contractPicker.options}
              value={selectedContract}
              onChange={(_, v) => {
                contractPicker.remember([v]);
                setContractId(v?.id || null);
              }}
              getOptionLabel={(o) => contractPicker.label(o, (contract) => contract.name ?? '')}
              disabled={readOnly || saving}
              renderOption={(props, option) => {
                const { key, ...optionProps } = props;
                return <li key={key} {...optionProps}>{option.name}</li>;
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder={t('workspace.asset.support.searchSupportContracts')}
                  variant="standard"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {contractPicker.loading ? <CircularProgress color="inherit" size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                  sx={drawerFieldValueSx}
                />
              )}
              ListboxProps={{ sx: drawerAutocompleteListboxSx }}
              fullWidth
            />
          )}
        </PropertyRow>

        <PropertyRow label={t('workspace.asset.support.supportTier')}>
          <TextField
            value={supportTier}
            onChange={(e) => setSupportTier(e.target.value)}
            disabled={saving || readOnly}
            placeholder={t('workspace.asset.support.supportTierPlaceholder')}
            size="small"
            variant="standard"
            sx={drawerFieldValueSx}
            fullWidth
          />
        </PropertyRow>

        <PropertyRow label={t('workspace.asset.support.supportExpiry')} valueSx={{ maxWidth: 180 }}>
          <DateEUField
            label=""
            hideLabel
            valueYmd={supportExpiry}
            onChangeYmd={setSupportExpiry}
            disabled={saving || readOnly}
            size="small"
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>

        <PropertyRow label={t('common.notes')} valueSx={{ width: '100%' }}>
          <TextField
            id="asset-support-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={saving || readOnly}
            multiline
            minRows={4}
            maxRows={12}
            placeholder={t('workspace.asset.support.notesPlaceholder')}
            variant="standard"
            sx={longFormSurfaceFieldSx}
            fullWidth
          />
        </PropertyRow>
      </Stack>

      {/* Support contacts table */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>{t('workspace.asset.support.contactsTitle')}</Typography>
          {!readOnly && (
            <Button startIcon={<AddIcon />} onClick={addContactRow} size="small">
              {t('workspace.asset.support.addContact')}
            </Button>
          )}
        </Box>
        <Table size="small" sx={{ width: '100%', tableLayout: 'fixed', '& th, & td': { whiteSpace: 'normal', overflowWrap: 'anywhere' } }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('common:selects.contact')}</TableCell>
              <TableCell>{t('common:labels.email')}</TableCell>
              <TableCell>{t('workspace.asset.support.phone')}</TableCell>
              <TableCell>{t('common:contacts.mobile')}</TableCell>
              <TableCell>{t('common.role')}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {supportContacts.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary">{t('workspace.asset.support.noContacts')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {supportContacts.map((row, idx) => (
              <TableRow key={row.id || idx}>
                <TableCell sx={{ width: '32%', minWidth: 0 }}>
                  <ContactSelect
                    value={row.contact_id}
                    onChange={(v) => void setContactRowContact(idx, v)}
                    hideLabel
                    label={t('common:selects.contact')}
                    textFieldSx={drawerFieldValueSx}
                    disabled={readOnly || saving}
                  />
                </TableCell>
                <TableCell>{row.contact?.email || '—'}</TableCell>
                <TableCell>{row.contact?.phone || '—'}</TableCell>
                <TableCell>{row.contact?.mobile || '—'}</TableCell>
                <TableCell sx={{ width: '22%', minWidth: 0 }}>
                  <TextField
                    value={row.role}
                    onChange={(e) => setContactRowRole(idx, e.target.value)}
                    size="small"
                    placeholder={t('workspace.asset.support.contactRolePlaceholder')}
                    variant="standard"
                    sx={drawerFieldValueSx}
                    fullWidth
                    disabled={readOnly || saving}
                  />
                </TableCell>
                <TableCell width={48}>
                  {!readOnly && (
                    <IconButton aria-label={t('common.remove')} size="small" onClick={() => removeContactRow(idx)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
}
