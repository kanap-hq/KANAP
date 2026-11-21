import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Box, TextField } from '@mui/material';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { KanapDialog, PropertyRow } from '../design';
import { DEFAULT_CONTACT_ROLE, emailError, type Contact, type ContactRole } from '../../pages/contacts/contactModel';
import { ContactRoleSelect } from '../../pages/contacts/ContactFields';

/** The supplier a contact created here belongs to, with the contact type when the caller knows it. */
export type CreateContactSupplier = { id: string; role?: ContactRole | null };

export type CreateContactRequest = { key: number; typed: string };

/**
 * The text typed in the picker as a first and a last name: cut at the first space, the last name
 * alone for a single word. The dialog's fields stay editable.
 */
export function splitTypedName(typed: string): { first: string; last: string } {
  const text = typed.trim();
  const space = text.search(/\s/);
  if (space < 0) return { first: '', last: text };
  return { first: text.slice(0, space), last: text.slice(space).trim() };
}

/**
 * The few fields a contact needs to exist (its email, the names the picker's text gives, and the
 * type for a supplier contact), written as the contact's page writes them (`POST /contacts`).
 * Nothing here saves the record the person was filling in: resolving hands the new contact back to
 * the field, or null when the person cancels.
 */
export default function CreateContactDialog({
  request,
  supplier,
  onResolve,
}: {
  request: CreateContactRequest | null;
  supplier?: CreateContactSupplier | null;
  onResolve: (contact: Contact | null) => void;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const firstNameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<ContactRole>(DEFAULT_CONTACT_ROLE);
  const [emailMessage, setEmailMessage] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!request) return;
    const name = splitTypedName(request.typed);
    setFirstName(name.first);
    setLastName(name.last);
    setEmail('');
    setRole(supplier?.role ?? DEFAULT_CONTACT_ROLE);
    setEmailMessage(null);
    setServerError(null);
    setSubmitting(false);
    // A new request is the only thing that resets the entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Escape and Cancel drop the entry, as everywhere.
  const close = () => {
    if (submitting) return;
    onResolve(null);
  };

  const handleCreate = async () => {
    if (submitting) return;
    const address = email.trim();
    const invalid = !address ? t('master-data:contacts.messages.emailRequired') : emailError(address, t);
    if (invalid) {
      setEmailMessage(invalid);
      emailRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setEmailMessage(null);
    setServerError(null);
    try {
      const res = await api.post<Contact>('/contacts', {
        email: address,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        supplier_id: supplier?.id ?? null,
        supplier_role: supplier ? (supplier.role ?? role) : null,
      });
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['supplier-contacts'] });
      onResolve(res.data);
    } catch (error) {
      const status = (error as { response?: { status?: number } } | null)?.response?.status;
      const message = getApiErrorMessage(error, t, t('master-data:contacts.messages.createFailed'));
      // The email is the one field the dialog cannot check by itself: another contact may have it.
      if (status === 400 && /email/i.test(message)) {
        setEmailMessage(t('master-data:contacts.messages.emailTaken'));
        emailRef.current?.focus();
      } else {
        setServerError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KanapDialog
      open={request !== null}
      title={t('master-data:contacts.newContact')}
      onClose={close}
      onSave={() => { void handleCreate(); }}
      saveLabel={t('common:buttons.create')}
      saveLoading={submitting}
      initialFocusRef={request?.typed.trim() ? emailRef : firstNameRef}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 2 }}>
        <PropertyRow label={t('master-data:contacts.fields.firstName')}>
          <TextField
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            variant="standard"
            fullWidth
            inputRef={firstNameRef}
            inputProps={{ 'aria-label': t('master-data:contacts.fields.firstName'), autoComplete: 'off' }}
          />
        </PropertyRow>
        <PropertyRow label={t('master-data:contacts.fields.lastName')}>
          <TextField
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            variant="standard"
            fullWidth
            inputProps={{ 'aria-label': t('master-data:contacts.fields.lastName'), autoComplete: 'off' }}
          />
        </PropertyRow>
      </Box>
      <PropertyRow label={t('master-data:contacts.fields.email')} required>
        <TextField
          value={email}
          onChange={(event) => { setEmail(event.target.value); setEmailMessage(null); }}
          variant="standard"
          fullWidth
          placeholder={t('master-data:contacts.placeholders.email')}
          error={!!emailMessage}
          helperText={emailMessage}
          inputRef={emailRef}
          inputProps={{ 'aria-label': t('master-data:contacts.fields.email'), autoComplete: 'off' }}
        />
      </PropertyRow>
      {supplier && !supplier.role ? (
        <PropertyRow label={t('master-data:contacts.fields.contactType')} required>
          <ContactRoleSelect value={role} hasSupplier onChange={setRole} />
        </PropertyRow>
      ) : null}
      {serverError ? <Alert severity="error" sx={{ mt: 1 }}>{serverError}</Alert> : null}
    </KanapDialog>
  );
}
