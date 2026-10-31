import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useDataAccessLimited } from '../../auth/dataAccess';
import useAutosave, { useAutosaveRegistry } from '../../hooks/useAutosave';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PortfolioMetadataItem, PortfolioStatusMetadata } from '../portfolio/workspace/PortfolioMetadataBar';
import { PropertyGroup, PropertyRow } from '../../components/design';
import SupplierSelect from '../../components/fields/SupplierSelect';
import { guessCountryFromDialCode, splitPhone } from '../../lib/phoneUtils';
import { attentionDotSx, drawerFieldValueSx, longFormSurfaceFieldSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDotColor } from '../../utils/statusColors';
import { CountryField } from '../companies/CompanyFields';
import {
  type Contact,
  type ContactPatch,
  type ContactRole,
  DEFAULT_CONTACT_ROLE,
  NOTES_MAX_LENGTH,
  contactName,
  emailError,
  isContactRole,
  phoneError,
  safeReturnTo,
} from './contactModel';
import { ContactNameTitle, ContactPhoneField, ContactRoleSelect, MetadataMenu, useContactRoleOptions } from './ContactFields';
import RecordUsagesSection, { recordUsagesKey, scrollToUsages, useRecordUsages } from '../../components/usages/RecordUsagesSection';
import { SUPPLIERS_PATH } from '../suppliers/supplierModel';
import RecordDeleteButton from '../../components/workspace/RecordDeleteButton';

const LIST_PATH = '/master-data/contacts';
const DRAWER_KEY = 'kanap.contacts.drawerOpen';
const LIST_CONTEXT_KEYS = ['sort', 'q', 'filters'];

type FieldKey = 'name' | 'email' | 'job_title' | 'phone' | 'mobile' | 'country' | 'supplier_id' | 'supplier_role' | 'notes' | 'active';
type FieldErrors = Partial<Record<FieldKey, string>>;

const sectionLabelSx = { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 } as const;

/** The list's sort, search and filters, kept in every address of the page. */
function useListContext() {
  const [searchParams] = useSearchParams();
  const context = React.useMemo(() => {
    const sp = new URLSearchParams();
    for (const key of LIST_CONTEXT_KEYS) {
      const value = searchParams.get(key);
      if (value) sp.set(key, value);
    }
    return sp.toString();
  }, [searchParams]);
  return React.useCallback((path: string) => `${path}${context ? `?${context}` : ''}`, [context]);
}

/** The phone a dial code may also give the country of a contact that has none. */
function withGuessedCountry(patch: ContactPatch, phone: string | null, country: string | null): ContactPatch {
  if (country || !phone) return patch;
  const guess = guessCountryFromDialCode(splitPhone(phone).code);
  return guess ? { ...patch, country: guess } : patch;
}

export default function ContactWorkspacePage() {
  const params = useParams();
  const location = useLocation();
  const id = String(params.id || '');
  // One tab: any other address of the former page (or the former Used by tab) opens it.
  if (params.tab && params.tab !== 'overview') {
    return <Navigate replace to={`${LIST_PATH}/${id}/overview${location.search}`} />;
  }
  if (id === 'new') return <ContactCreate />;
  // Keyed by contact: drafts and pending saves belong to the contact they were typed on.
  return <ContactEditor key={id} id={id} />;
}

function ContactEditor({ id }: { id: string }) {
  const { t } = useTranslation(['master-data', 'common']);
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  // Changing or deleting a shared contact is reserved to people with access to all data (spec §2.7).
  const dataAccessLimited = useDataAccessLimited();
  const canEdit = hasLevel('contacts', 'manager') && !dataAccessLimited;
  const canDelete = hasLevel('contacts', 'admin') && !dataAccessLimited;
  const withContext = useListContext();
  const roleOptions = useContactRoleOptions();

  const detailKey = React.useMemo(() => ['contacts', id] as const, [id]);
  // Set once the contact is deleted: the page leaves without loading it again.
  const [deletedId, setDeletedId] = React.useState<string | null>(null);
  const { data, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: async () => (await api.get<Contact>(`/contacts/${id}`)).data,
    enabled: deletedId !== id,
  });
  const { data: usages } = useRecordUsages('contacts', id);

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [pageError, setPageError] = React.useState<string | null>(null);
  // Writes queue one after the other: a response never overwrites a newer one.
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const registry = useAutosaveRegistry();
  // The notes save after a pause in typing; their error shows under them (see `save`).
  const autosave = useAutosave({ registry, onError: () => undefined });

  /**
   * Saves fields of the contact. The API needs the email in every update: the stored one goes
   * with the patch. A select, a toggle or a supplier shows its new value at once (`optimistic`);
   * a refusal shows under the field and the stored values come back.
   */
  const save = React.useCallback((patch: ContactPatch, field: FieldKey, optimistic?: Partial<Contact>): Promise<void> => {
    if (!canEdit || !queryClient.getQueryData(detailKey)) return Promise.resolve();
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (field === 'name') setPageError(null);
    if (optimistic) queryClient.setQueryData<Contact>(detailKey, (prev) => (prev ? { ...prev, ...optimistic } : prev));
    const run = async () => {
      const stored = queryClient.getQueryData<Contact>(detailKey);
      try {
        const res = await api.patch<Contact>(`/contacts/${id}`, { email: stored?.email, ...patch });
        queryClient.setQueryData<Contact>(detailKey, (prev) => ({
          ...(prev as Contact),
          ...res.data,
          // The update's answer has no supplier name: the chosen one stays until the reload.
          supplier_name: res.data.supplier_id === prev?.supplier_id ? prev?.supplier_name ?? null : null,
        }));
        void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
        // Supplier pages list their contacts with names, roles and phones.
        void queryClient.invalidateQueries({ queryKey: ['supplier-contacts'] });
        // The "Used by" section shows the supplier with the contact type.
        if (field === 'supplier_id' || field === 'supplier_role') {
          void queryClient.invalidateQueries({ queryKey: recordUsagesKey('contacts', id), exact: true });
        }
      } catch (e) {
        const status = (e as { response?: { status?: number } } | null)?.response?.status;
        const message = field === 'email' && status === 400
          ? t('contacts.messages.emailTaken')
          : getApiErrorMessage(e, t, t('contacts.messages.saveFailed'));
        if (field === 'name') setPageError(message);
        else setErrors((prev) => ({ ...prev, [field]: message }));
        if (optimistic) void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
        throw e;
      }
    };
    const result = chainRef.current.then(run, run);
    chainRef.current = result.catch(() => undefined);
    return result;
  }, [canEdit, detailKey, id, queryClient, t]);

  const saveNow = (patch: ContactPatch, field: FieldKey, optimistic?: Partial<Contact>) => {
    void save(patch, field, optimistic).catch(() => undefined);
  };

  const commitText = (field: 'email' | 'job_title', raw: string) => {
    if (!data) return;
    const next = raw.trim();
    if (field === 'email') {
      const invalid = emailError(next, t);
      if (invalid) {
        setErrors((prev) => ({ ...prev, email: invalid }));
        return;
      }
      if (next.toLowerCase() === data.email) {
        setErrors((prev) => ({ ...prev, email: undefined }));
        return;
      }
      saveNow({ email: next }, 'email');
      return;
    }
    const value = next || null;
    if (value === (data[field] ?? null)) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      return;
    }
    saveNow({ [field]: value }, field);
  };

  const commitPhone = (field: 'phone' | 'mobile', next: string | null) => {
    if (!data) return;
    const invalid = phoneError(next, t);
    if (invalid) {
      setErrors((prev) => ({ ...prev, [field]: invalid }));
      return;
    }
    if (next === (data[field] ?? null)) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      return;
    }
    const patch = withGuessedCountry({ [field]: next }, next, data.country);
    saveNow(patch, field, patch);
  };

  /** A supplier never stays without a type: choosing one gives the default type to a contact that has none. */
  const changeSupplier = (supplierId: string | null, supplierName: string | null) => {
    if (!data || supplierId === data.supplier_id) return;
    if (!supplierId) {
      saveNow({ supplier_id: null, supplier_role: null }, 'supplier_id', { supplier_id: null, supplier_role: null, supplier_name: null });
      return;
    }
    const role = data.supplier_role ?? DEFAULT_CONTACT_ROLE;
    saveNow({ supplier_id: supplierId, supplier_role: role }, 'supplier_id', { supplier_id: supplierId, supplier_role: role, supplier_name: supplierName });
  };

  const changeRole = (role: ContactRole) => {
    if (!data?.supplier_id || role === data.supplier_role) return;
    saveNow({ supplier_id: data.supplier_id, supplier_role: role }, 'supplier_role', { supplier_role: role });
  };

  const close = async () => {
    await registry.flushAll();
    navigate(withContext(LIST_PATH));
  };

  const [drawerOpenRequest, setDrawerOpenRequest] = React.useState(0);
  const openDrawer = () => setDrawerOpenRequest((n) => n + 1);

  const disabled = !canEdit || !data;
  const name = data ? contactName(data) : null;
  // A supplier without a type (an import, an older record): the page says so until one is chosen.
  const roleMissing = !!data?.supplier_id && !data.supplier_role;
  const roleError = errors.supplier_role ?? (roleMissing ? t('contacts.messages.typeRequired') : undefined);
  const activeColor = getDotColor('success', theme.palette.mode);
  const inactiveColor = getDotColor('default', theme.palette.mode);
  const savingHint = autosave.status === 'saving' || autosave.status === 'pending'
    ? t('common:status.saving')
    : autosave.status === 'saved' ? t('common:status.saved') : null;
  const tertiary = (text: string) => <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{text}</Box>;

  const metadata = data ? (
    <>
      {data.supplier_id ? (
        <PortfolioMetadataItem label={t('contacts.fields.supplier')}>
          <Box
            component={RouterLink}
            to={`/master-data/suppliers/${data.supplier_id}/overview`}
            title={t('contacts.metadata.openSupplier')}
            sx={(th) => ({
              color: 'inherit',
              textDecoration: 'none',
              '&:hover': { color: th.palette.kanap.teal, textDecoration: 'underline', textUnderlineOffset: '2px' },
            })}
          >
            {/* The name of a supplier just chosen comes with the reload that follows the save. */}
            {data.supplier_name ?? '…'}
          </Box>
        </PortfolioMetadataItem>
      ) : (
        <PortfolioMetadataItem
          label={t('contacts.fields.supplier')}
          onClick={canEdit ? openDrawer : undefined}
          title={canEdit ? t('contacts.metadata.chooseInProperties') : undefined}
        >
          {tertiary(t('contacts.metadata.supplierMissing'))}
        </PortfolioMetadataItem>
      )}
      {data.supplier_id && (
        <PortfolioMetadataItem label={t('contacts.fields.contactType')}>
          <MetadataMenu<ContactRole>
            value={data.supplier_role}
            options={roleOptions}
            onChange={changeRole}
            disabled={disabled}
            ariaLabel={t('contacts.fields.contactType')}
            display={data.supplier_role
              ? roleOptions.find((option) => option.value === data.supplier_role)?.label
              : (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Box component="span" sx={attentionDotSx} />
                  {t('contacts.metadata.typeMissing')}
                </Box>
              )}
          />
        </PortfolioMetadataItem>
      )}
      <PortfolioMetadataItem label={t('contacts.fields.status')}>
        <PortfolioStatusMetadata
          value={data.active ? 'active' : 'inactive'}
          label={data.active ? t('contacts.status.active') : t('contacts.status.inactive')}
          color={data.active ? activeColor : inactiveColor}
          options={[
            { value: 'active', label: t('contacts.status.active'), color: activeColor },
            { value: 'inactive', label: t('contacts.status.inactive'), color: inactiveColor },
          ]}
          onChange={(value) => {
            const active = value === 'active';
            if (active !== data.active) saveNow({ active }, 'active', { active });
          }}
          disabled={disabled}
        />
      </PortfolioMetadataItem>
      <PortfolioMetadataItem
        label={t('shared.usages.title')}
        onClick={scrollToUsages}
        title={t('shared.usages.open')}
      >
        {usages ? usages.total : '…'}
      </PortfolioMetadataItem>
    </>
  ) : undefined;

  const properties = data ? (
    <>
      <PropertyGroup>
        <PropertyRow label={t('contacts.fields.supplier')}>
          <SupplierSelect
            label={t('contacts.fields.supplier')}
            hideLabel
            value={data.supplier_id}
            selectedOption={data.supplier_id && data.supplier_name
              ? { id: data.supplier_id, name: data.supplier_name, erp_supplier_id: null, status: 'enabled' }
              : null}
            onChange={(supplierId) => changeSupplier(supplierId, null)}
            disabled={disabled}
            error={!!errors.supplier_id}
            helperText={errors.supplier_id}
            placeholder={t('contacts.placeholders.supplier')}
          />
        </PropertyRow>
        <PropertyRow label={t('contacts.fields.contactType')} required={!!data.supplier_id}>
          <ContactRoleSelect
            value={data.supplier_role}
            hasSupplier={!!data.supplier_id}
            onChange={changeRole}
            disabled={disabled}
            error={roleError}
          />
        </PropertyRow>
      </PropertyGroup>
      <PropertyGroup>
        <ContactTextRow
          label={t('contacts.fields.email')}
          placeholder={t('contacts.placeholders.email')}
          required
          value={data.email}
          disabled={disabled}
          error={errors.email}
          inputType="email"
          onCommit={(next) => commitText('email', next)}
        />
        <ContactTextRow
          label={t('contacts.fields.jobTitle')}
          placeholder={t('contacts.placeholders.jobTitle')}
          value={data.job_title ?? ''}
          disabled={disabled}
          error={errors.job_title}
          onCommit={(next) => commitText('job_title', next)}
        />
      </PropertyGroup>
      <PropertyGroup>
        <PropertyRow label={t('contacts.fields.phone')}>
          <ContactPhoneField
            value={data.phone}
            label={t('contacts.fields.phone')}
            placeholder={t('contacts.placeholders.phone')}
            onCommit={(next) => commitPhone('phone', next)}
            disabled={disabled}
            error={errors.phone}
          />
        </PropertyRow>
        <PropertyRow label={t('contacts.fields.mobile')}>
          <ContactPhoneField
            value={data.mobile}
            label={t('contacts.fields.mobile')}
            placeholder={t('contacts.placeholders.mobile')}
            onCommit={(next) => commitPhone('mobile', next)}
            disabled={disabled}
            error={errors.mobile}
          />
        </PropertyRow>
        <PropertyRow label={t('contacts.fields.country')}>
          <CountryField
            value={data.country ?? ''}
            onChange={(country) => {
              const next = country || null;
              if (next !== (data.country ?? null)) saveNow({ country: next }, 'country', { country: next });
            }}
            clearable
            disabled={disabled}
            error={errors.country}
          />
        </PropertyRow>
      </PropertyGroup>
    </>
  ) : <Box />;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={(pageError || loadError) ? (
          <Alert severity="error" onClose={pageError ? () => setPageError(null) : undefined}>
            {pageError ?? t('contacts.messages.loadFailed')}
          </Alert>
        ) : undefined}
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey={DRAWER_KEY}
        drawerOpenRequest={drawerOpenRequest}
        backLabel={t('contacts.title')}
        onBack={() => { void close(); }}
        title={name ?? ''}
        titleFallback={t('contacts.contactFallback')}
        titleEditor={data ? (
          <ContactNameTitle
            firstName={data.first_name}
            lastName={data.last_name}
            fallback={data.email || t('contacts.contactFallback')}
            fallbackIsPlaceholder={!data.email}
            canEdit={!disabled}
            onSave={(next) => saveNow(next, 'name', next)}
          />
        ) : undefined}
        onSaveShortcut={() => { void autosave.flush(); }}
        metadata={metadata}
        // One tab: the shell shows the History button in the header, never a tab, and mounts the
        // shared history in its right panel on demand.
        history={data ? { table: 'contacts', recordId: data.id } : undefined}
        actions={(
          <>
            {savingHint && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', alignSelf: 'center', mr: 0.5 }}>{savingHint}</Typography>
            )}
            {data && canDelete && (
              <RecordDeleteButton
                base="/contacts"
                id={data.id}
                name={name ?? t('contacts.contactFallback')}
                deleteFailed="contacts.messages.deleteFailed"
                // Nothing refuses a contact's delete: the confirmation says which links go with it.
                confirmMessage={t('contacts.delete.warning', { count: 1 })}
                checkUsages={false}
                onDeleted={() => { setDeletedId(data.id); navigate(withContext(LIST_PATH)); }}
              />
            )}
            <IconButton aria-label={t('common:buttons.close')} title={t('common:buttons.close')} size="small" onClick={() => { void close(); }}>
              <CloseIcon />
            </IconButton>
          </>
        )}
        properties={properties}
      >
        {data && (
          <Stack spacing={3} sx={{ maxWidth: 900 }}>
            <ContactNotes
              value={data.notes ?? ''}
              disabled={disabled}
              error={errors.notes}
              onTyped={(notes) => {
                autosave.schedule(() => save({ notes: notes.trim() ? notes : null }, 'notes'));
              }}
              onCommit={() => { void autosave.flush(); }}
            />
            <RecordUsagesSection owner="contacts" id={id} />
          </Stack>
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}

function ContactTextRow({
  label,
  placeholder,
  required,
  value,
  disabled,
  error,
  inputType,
  onCommit,
}: {
  label: string;
  placeholder: string;
  required?: boolean;
  value: string;
  disabled: boolean;
  error?: string;
  inputType?: string;
  onCommit: (next: string) => void;
}) {
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <PropertyRow label={label} required={required}>
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        type={inputType}
        variant="standard"
        sx={drawerFieldValueSx}
        placeholder={placeholder}
        disabled={disabled}
        error={!!error}
        helperText={error}
        inputProps={{ 'aria-label': label }}
      />
    </PropertyRow>
  );
}

/** Notes on a long-form surface: saved after a pause in typing, and when focus leaves them. */
function ContactNotes({
  value,
  disabled,
  error,
  onTyped,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  error?: string;
  onTyped: (next: string) => void;
  onCommit: () => void;
}) {
  const { t } = useTranslation(['master-data']);
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <Box>
      <Typography sx={sectionLabelSx}>{t('contacts.fields.notes')}</Typography>
      <TextField
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onTyped(event.target.value);
        }}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          onCommit();
        }}
        multiline
        minRows={4}
        variant="standard"
        placeholder={t('contacts.placeholders.notes')}
        disabled={disabled}
        error={!!error}
        helperText={error}
        sx={longFormSurfaceFieldSx}
        inputProps={{ 'aria-label': t('contacts.fields.notes'), maxLength: NOTES_MAX_LENGTH }}
      />
    </Box>
  );
}

type CreateValues = {
  email: string;
  first_name: string;
  last_name: string;
  job_title: string;
  phone: string | null;
  mobile: string | null;
  country: string;
  supplier_id: string | null;
  supplier_role: ContactRole | null;
  notes: string;
};

function ContactCreate() {
  const { t } = useTranslation(['master-data', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const canCreate = hasLevel('contacts', 'manager');
  const [searchParams] = useSearchParams();
  const withContext = useListContext();

  // Opened from a supplier's contacts: the supplier and the type come with the address.
  const prefillSupplierId = searchParams.get('supplier_id') || null;
  const rawRole = searchParams.get('supplier_role');
  const prefillRole = prefillSupplierId && isContactRole(rawRole) ? rawRole : null;
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  // Opened from a supplier, the way back names the suppliers.
  const backLabel = returnTo?.startsWith(`${SUPPLIERS_PATH}/`) ? t('suppliers.title') : t('contacts.title');

  const [values, setValues] = React.useState<CreateValues>({
    email: '',
    first_name: '',
    last_name: '',
    job_title: '',
    phone: null,
    mobile: null,
    country: '',
    supplier_id: prefillSupplierId,
    supplier_role: prefillSupplierId ? prefillRole ?? DEFAULT_CONTACT_ROLE : null,
    notes: '',
  });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // A field the user changes loses its error until the next Create.
  const clearError = (field: FieldKey) => setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  const set = <K extends keyof CreateValues>(field: K, value: CreateValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    clearError(field as FieldKey);
  };

  const close = () => navigate(returnTo ?? withContext(LIST_PATH));

  const setPhone = (field: 'phone' | 'mobile', next: string | null) => {
    clearError(field);
    setValues((prev) => {
      const patch = withGuessedCountry({ [field]: next }, next, prev.country || null);
      return { ...prev, [field]: next, country: patch.country ?? prev.country };
    });
  };

  const handleCreate = async () => {
    if (!canCreate || submitting) return;
    const email = values.email.trim();
    const nextErrors: FieldErrors = {};
    const invalidEmail = emailError(email, t);
    if (invalidEmail) nextErrors.email = invalidEmail;
    const invalidPhone = phoneError(values.phone, t);
    if (invalidPhone) nextErrors.phone = invalidPhone;
    const invalidMobile = phoneError(values.mobile, t);
    if (invalidMobile) nextErrors.mobile = invalidMobile;
    if (values.supplier_id && !values.supplier_role) nextErrors.supplier_role = t('contacts.messages.typeRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    setServerError(null);
    const optional = (value: string) => value.trim() || null;
    try {
      await api.post<Contact>('/contacts', {
        email,
        first_name: optional(values.first_name),
        last_name: optional(values.last_name),
        job_title: optional(values.job_title),
        phone: values.phone,
        mobile: values.mobile,
        country: values.country || null,
        supplier_id: values.supplier_id,
        supplier_role: values.supplier_id ? values.supplier_role : null,
        notes: optional(values.notes),
        active: true,
      });
      void queryClient.invalidateQueries({ queryKey: ['supplier-contacts'] });
      close();
    } catch (e) {
      const status = (e as { response?: { status?: number } } | null)?.response?.status;
      const message = getApiErrorMessage(e, t, t('contacts.messages.createFailed'));
      // The email is the one field the form cannot check by itself: another contact may have it.
      if (status === 400 && /email/i.test(message)) setErrors({ email: t('contacts.messages.emailTaken') });
      else setServerError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const textRow = (field: 'email' | 'first_name' | 'last_name' | 'job_title', label: string, placeholder: string, required = false) => (
    <PropertyRow label={label} required={required}>
      <TextField
        value={values[field]}
        onChange={(event) => set(field, event.target.value)}
        type={field === 'email' ? 'email' : undefined}
        variant="standard"
        sx={drawerFieldValueSx}
        placeholder={placeholder}
        error={!!errors[field as FieldKey]}
        helperText={errors[field as FieldKey]}
        inputProps={{ 'aria-label': label, autoComplete: 'off' }}
      />
    </PropertyRow>
  );
  const twoColumnsSx = {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
    columnGap: 3,
  } as const;
  const title = contactName({ first_name: values.first_name, last_name: values.last_name });

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey={DRAWER_KEY}
        backLabel={backLabel}
        onBack={close}
        title={title ?? ''}
        titleFallback={t('contacts.newContact')}
        isCreate
        actions={(
          <>
            <Button variant="contained" size="small" onClick={() => void handleCreate()} disabled={!canCreate || submitting}>
              {t('common:buttons.create')}
            </Button>
            <IconButton aria-label={t('common:buttons.close')} title={t('common:buttons.close')} size="small" onClick={close}>
              <CloseIcon />
            </IconButton>
          </>
        )}
      >
        <Stack spacing={3} sx={{ maxWidth: 640 }}>
          <Box sx={twoColumnsSx}>
            {textRow('first_name', t('contacts.fields.firstName'), t('contacts.placeholders.firstName'))}
            {textRow('last_name', t('contacts.fields.lastName'), t('contacts.placeholders.lastName'))}
            {textRow('email', t('contacts.fields.email'), t('contacts.placeholders.email'), true)}
            {textRow('job_title', t('contacts.fields.jobTitle'), t('contacts.placeholders.jobTitle'))}
            <PropertyRow label={t('contacts.fields.supplier')}>
              <SupplierSelect
                label={t('contacts.fields.supplier')}
                hideLabel
                value={values.supplier_id}
                onChange={(supplierId) => { clearError('supplier_role'); setValues((prev) => ({
                  ...prev,
                  supplier_id: supplierId,
                  // A supplier never stays without a type: the default one comes with the choice.
                  supplier_role: supplierId ? prev.supplier_role ?? DEFAULT_CONTACT_ROLE : null,
                })); }}
                disabled={!!prefillSupplierId}
                placeholder={t('contacts.placeholders.supplier')}
              />
            </PropertyRow>
            <PropertyRow label={t('contacts.fields.contactType')} required={!!values.supplier_id}>
              <ContactRoleSelect
                value={values.supplier_role}
                hasSupplier={!!values.supplier_id}
                onChange={(role) => set('supplier_role', role)}
                disabled={!!prefillRole}
                error={errors.supplier_role}
              />
            </PropertyRow>
            <PropertyRow label={t('contacts.fields.phone')}>
              <ContactPhoneField
                value={values.phone}
                label={t('contacts.fields.phone')}
                placeholder={t('contacts.placeholders.phone')}
                onChange={(next) => setPhone('phone', next)}
                error={errors.phone}
              />
            </PropertyRow>
            <PropertyRow label={t('contacts.fields.mobile')}>
              <ContactPhoneField
                value={values.mobile}
                label={t('contacts.fields.mobile')}
                placeholder={t('contacts.placeholders.mobile')}
                onChange={(next) => setPhone('mobile', next)}
                error={errors.mobile}
              />
            </PropertyRow>
            <PropertyRow label={t('contacts.fields.country')}>
              <CountryField value={values.country} onChange={(country) => set('country', country)} clearable />
            </PropertyRow>
          </Box>
          <PropertyRow label={t('contacts.fields.notes')} valueSx={{ maxWidth: 640 }}>
            <TextField
              value={values.notes}
              onChange={(event) => set('notes', event.target.value)}
              multiline
              minRows={3}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('contacts.placeholders.notes')}
              inputProps={{ 'aria-label': t('contacts.fields.notes'), maxLength: NOTES_MAX_LENGTH }}
            />
          </PropertyRow>
          {serverError && <Alert severity="error">{serverError}</Alert>}
        </Stack>
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
