import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, FormHelperText, TextField, Typography } from '@mui/material';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import { drawerFieldValueSx, longFormSurfaceFieldSx } from '../../theme/formSx';
import { PropertyRow } from '../../components/design';
import { taskDetailTypography } from '../tasks/theme/taskDetailTokens';

export const sectionLabelSx = { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 } as const;

/**
 * The supplier's name as the page title, edited in place: saved when focus leaves it (Enter too),
 * Escape cancels. An empty name stays in the field with its error; a refusal of the server
 * (`error`, a name another supplier has) shows under the title.
 */
export function SupplierNameTitle({
  name,
  fallback,
  canEdit,
  error,
  onSave,
}: {
  name: string;
  fallback: string;
  canEdit: boolean;
  error?: string;
  onSave: (next: string) => void;
}) {
  const { t } = useTranslation(['master-data']);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(name);
  const [requiredError, setRequiredError] = React.useState(false);
  // Enter, Escape and the blur that follows may all end the edit: only the first one counts.
  const openRef = React.useRef(false);
  const shownError = requiredError ? t('suppliers.messages.nameRequired') : error;

  const helper = shownError ? <FormHelperText error sx={{ mt: 0.5 }}>{shownError}</FormHelperText> : null;

  if (!editing) {
    return (
      <>
        <Typography
          component="span"
          onClick={canEdit ? () => {
            setDraft(name);
            openRef.current = true;
            setEditing(true);
          } : undefined}
          sx={(theme) => ({
            ...taskDetailTypography.title,
            display: 'inline',
            color: name ? 'inherit' : theme.palette.kanap.text.tertiary,
            cursor: canEdit ? 'text' : 'default',
            '&:hover': canEdit ? { opacity: 0.85 } : undefined,
          })}
        >
          {name || fallback}
        </Typography>
        {helper}
      </>
    );
  }

  const commit = () => {
    if (!openRef.current) return;
    const next = draft.trim();
    if (!next) {
      setRequiredError(true);
      return;
    }
    openRef.current = false;
    setRequiredError(false);
    setEditing(false);
    if (next !== name) onSave(next);
  };
  const cancel = () => {
    openRef.current = false;
    setRequiredError(false);
    setEditing(false);
  };

  return (
    <>
      <Box
        component="input"
        autoFocus
        value={draft}
        placeholder={t('suppliers.placeholders.name')}
        aria-label={t('suppliers.fields.name')}
        aria-invalid={shownError ? true : undefined}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          setDraft(event.target.value);
          if (event.target.value.trim()) setRequiredError(false);
        }}
        onBlur={commit}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') cancel();
        }}
        sx={(theme) => ({
          font: 'inherit',
          color: 'inherit',
          bgcolor: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${shownError ? theme.palette.error.main : theme.palette.kanap.border.default}`,
          outline: 'none',
          p: 0,
          m: 0,
          width: '100%',
          '&::placeholder': { color: theme.palette.kanap.text.tertiary, opacity: 1 },
          '&:focus': { borderBottomColor: shownError ? theme.palette.error.main : theme.palette.kanap.teal },
        })}
      />
      {helper}
    </>
  );
}

/** A one-line property saved when focus leaves it (Enter too). */
export function SupplierTextRow({
  label,
  placeholder,
  value,
  disabled,
  error,
  onCommit,
}: {
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  error?: string;
  onCommit: (next: string | null) => void;
}) {
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <PropertyRow label={label}>
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          onCommit(draft.trim() || null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
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
export function SupplierNotes({
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
      <Typography sx={sectionLabelSx}>{t('suppliers.fields.notes')}</Typography>
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
        placeholder={t('suppliers.placeholders.notes')}
        disabled={disabled}
        error={!!error}
        helperText={error}
        sx={longFormSurfaceFieldSx}
        inputProps={{ 'aria-label': t('suppliers.fields.notes') }}
      />
    </Box>
  );
}
