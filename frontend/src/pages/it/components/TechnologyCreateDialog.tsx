import React from 'react';
import { Alert, Autocomplete, Box, CircularProgress, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog, PropertyRow } from '../../../components/design';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { drawerAutocompleteListboxSx, drawerMenuItemSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

type CatalogEntry = {
  key: string;
  name: string;
  editor: string | null;
  family: string | null;
  mode: string | null;
  versions: number;
  latest_version: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called with the reference (`TEC-n`) of the technology adopted or created. */
  onCreated: (reference: string) => void;
};

const SEARCH_DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Editors offered while typing: the tenant's and the catalog's. */
export function EditorField({ value, onChange, disabled, placeholder, onBlur }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onBlur?: () => void;
}) {
  const debounced = useDebounced(value, SEARCH_DEBOUNCE_MS);
  const editorsQuery = useQuery({
    queryKey: ['technology-editors', debounced],
    queryFn: async () => (await api.get<{ items: string[] }>('/technologies/editors', { params: { q: debounced || undefined } })).data.items || [],
    enabled: !disabled,
    staleTime: 30_000,
  });
  return (
    <Autocomplete
      freeSolo
      options={editorsQuery.data || []}
      inputValue={value}
      onInputChange={(_, next) => onChange(next)}
      disabled={disabled}
      ListboxProps={{ sx: drawerAutocompleteListboxSx }}
      renderInput={(params) => <TextField {...params} variant="standard" placeholder={placeholder} onBlur={onBlur} />}
    />
  );
}

/**
 * Creation of a technology: the catalog first (entries the tenant has not adopted; one click adopts
 * it with its versions), then a free entry for a product the catalog does not know.
 */
export default function TechnologyCreateDialog({ open, onClose, onCreated }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const queryClient = useQueryClient();
  const { byField, labelFor } = useItOpsEnumOptions();
  const [manual, setManual] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [draft, setDraft] = React.useState({ name: '', family: '', editor: '', mode: 'installed' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);

  React.useEffect(() => {
    if (!open) return;
    setManual(false);
    setSearch('');
    setDraft({ name: '', family: '', editor: '', mode: 'installed' });
    setError(null);
  }, [open]);

  const catalogQuery = useQuery({
    queryKey: ['technology-catalog', debouncedSearch],
    queryFn: async () => (await api.get<{ items: CatalogEntry[] }>('/technologies/catalog', { params: { q: debouncedSearch || undefined } })).data.items || [],
    enabled: open && !manual,
    placeholderData: (previous) => previous,
  });

  const finish = async (reference: string) => {
    await queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('technolog') });
    onCreated(reference);
  };

  const adopt = async (entry: CatalogEntry) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ technology: { reference: string } }>('/technologies/adopt', { catalog_key: entry.key });
      await finish(res.data.technology.reference);
    } catch (err) {
      setError(getApiErrorMessage(err, t, t('workspace.technology.messages.createFailed')));
    } finally {
      setBusy(false);
    }
  };

  const createManual = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ reference: string }>('/technologies', {
        name: draft.name.trim(),
        family: draft.family || undefined,
        editor: draft.editor.trim() || undefined,
        mode: draft.mode,
      });
      await finish(res.data.reference);
    } catch (err) {
      setError(getApiErrorMessage(err, t, t('workspace.technology.messages.createFailed')));
    } finally {
      setBusy(false);
    }
  };

  const entries = catalogQuery.data || [];

  return (
    <KanapDialog
      open={open}
      title={t('pages.technologies.create.title')}
      onClose={onClose}
      onSave={manual ? createManual : onClose}
      saveLabel={manual ? t('common:buttons.create') : t('common:buttons.close')}
      saveDisabled={manual && (!draft.name.trim() || busy)}
      saveLoading={manual && busy}
      showCancel={manual}
    >
      <Stack spacing={1.5}>
        {error && <Alert severity="error">{error}</Alert>}
        {!manual && (
          <>
            <TextField
              variant="standard"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('pages.technologies.create.searchPlaceholder')}
              inputProps={{ 'aria-label': t('pages.technologies.create.searchLabel') }}
            />
            <Box
              role="list"
              aria-label={t('pages.technologies.create.catalog')}
              sx={(theme) => ({ maxHeight: 320, overflowY: 'auto', borderTop: `1px solid ${theme.palette.kanap.border.soft}` })}
            >
              {catalogQuery.isFetching && entries.length === 0 && (
                <Box sx={{ py: 1.5, display: 'flex', justifyContent: 'center' }}><CircularProgress size={16} /></Box>
              )}
              {!catalogQuery.isFetching && entries.length === 0 && (
                <Typography sx={(theme) => ({ py: 1, fontSize: 13, color: theme.palette.kanap.text.tertiary })}>
                  {t('pages.technologies.create.noMatch')}
                </Typography>
              )}
              {entries.map((entry) => (
                <Box
                  key={entry.key}
                  role="listitem"
                  component="button"
                  type="button"
                  disabled={busy}
                  onClick={() => { void adopt(entry); }}
                  sx={(theme) => ({
                    display: 'flex',
                    width: '100%',
                    alignItems: 'baseline',
                    gap: 1,
                    border: 0,
                    borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
                    bgcolor: 'transparent',
                    color: theme.palette.kanap.text.primary,
                    font: 'inherit',
                    fontSize: 13,
                    textAlign: 'left',
                    px: 0.5,
                    py: 0.75,
                    cursor: busy ? 'default' : 'pointer',
                    '&:hover': { bgcolor: theme.palette.kanap.bg.hover },
                  })}
                >
                  <Box component="span" sx={{ flex: 1, minWidth: 0 }}>{entry.name}</Box>
                  <Box component="span" sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary })}>
                    {[entry.editor, labelFor('technologyFamily', entry.family)].filter(Boolean).join(' · ')}
                  </Box>
                </Box>
              ))}
            </Box>
            <Box
              component="button"
              type="button"
              onClick={() => { setManual(true); setDraft((prev) => ({ ...prev, name: search.trim() })); }}
              sx={(theme) => ({
                alignSelf: 'flex-start',
                border: 0,
                p: 0,
                bgcolor: 'transparent',
                color: theme.palette.kanap.teal,
                font: 'inherit',
                fontSize: 13,
                cursor: 'pointer',
              })}
            >
              {t('pages.technologies.create.manualLink')}
            </Box>
          </>
        )}
        {manual && (
          <>
            <PropertyRow label={t('workspace.technology.fields.name')} required>
              <TextField
                variant="standard"
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder={t('workspace.technology.placeholders.name')}
                inputProps={{ 'aria-label': t('workspace.technology.fields.name') }}
                fullWidth
              />
            </PropertyRow>
            <PropertyRow label={t('workspace.technology.fields.family')}>
              <Select
                variant="standard"
                value={draft.family}
                displayEmpty
                onChange={(event) => setDraft((prev) => ({ ...prev, family: String(event.target.value) }))}
                SelectDisplayProps={{ 'aria-label': t('workspace.technology.fields.family') } as React.HTMLAttributes<HTMLDivElement>}
                fullWidth
              >
                <MenuItem value="" sx={drawerMenuItemSx}>{t('common:selects.notSet')}</MenuItem>
                {(byField.technologyFamily || []).map((option) => (
                  <MenuItem key={option.code} value={option.code} sx={drawerMenuItemSx}>{option.label}</MenuItem>
                ))}
              </Select>
            </PropertyRow>
            <PropertyRow label={t('workspace.technology.fields.editor')}>
              <EditorField
                value={draft.editor}
                onChange={(value) => setDraft((prev) => ({ ...prev, editor: value }))}
                placeholder={t('workspace.technology.placeholders.editor')}
              />
            </PropertyRow>
            <PropertyRow label={t('workspace.technology.fields.mode')}>
              <Select
                variant="standard"
                value={draft.mode}
                onChange={(event) => setDraft((prev) => ({ ...prev, mode: String(event.target.value) }))}
                SelectDisplayProps={{ 'aria-label': t('workspace.technology.fields.mode') } as React.HTMLAttributes<HTMLDivElement>}
                fullWidth
              >
                <MenuItem value="installed" sx={drawerMenuItemSx}>{t('workspace.technology.modes.installed')}</MenuItem>
                <MenuItem value="subscribed" sx={drawerMenuItemSx}>{t('workspace.technology.modes.subscribed')}</MenuItem>
              </Select>
            </PropertyRow>
          </>
        )}
      </Stack>
    </KanapDialog>
  );
}
