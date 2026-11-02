import React from 'react';
import { Alert, Autocomplete, Box, CircularProgress, MenuItem, Select, Stack, TextField, Tooltip, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { screenLanguage } from '../../../components/csv/readings';
import { KanapDialog, PropertyRow } from '../../../components/design';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { OPTION_HINT_DELAY_MS } from '../../../components/fields/OptionWithHint';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { drawerAutocompleteListboxSx, drawerMenuItemSx } from '../../../theme/formSx';
import { getApiErrorMessage, isDuplicateError } from '../../../utils/apiErrorMessage';

type CatalogEntry = {
  key: string;
  name: string;
  editor: string | null;
  family: string | null;
  /** The hosting type the adoption writes, a code of the tenant's hosting types. */
  hosting_type: string | null;
  versions: number;
  latest_version: string | null;
  /** What the product is and what it is for, in the screen language. */
  description?: string | null;
  /** Reference (`TEC-n`) of the technology typed by hand under this name, or null. */
  completes: string | null;
};

/** A catalog entry the tenant already adopted. The reference is that technology. */
type AdoptedCatalogEntry = {
  key: string;
  name: string;
  editor: string | null;
  family: string | null;
  family_label: string;
  reference: string;
  id: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called with the reference (`TEC-n`) of the technology adopted or created. */
  onCreated: (reference: string) => void;
};

const SEARCH_DEBOUNCE_MS = 250;

/** One line of a picker option: the shared ellipsis, so a long name or family never wraps or spills. */
const optionLineSx = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

/**
 * Two text lines, the same height on every product: the name, the family on the right of that line,
 * the editor under it. The classes take their type from `drawerAutocompleteListboxSx`.
 */
const catalogRowSx = (busy: boolean) => (theme: Theme) => ({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'stretch',
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box' as const,
  overflow: 'hidden',
  border: 0,
  borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
  bgcolor: 'transparent',
  color: theme.palette.kanap.text.primary,
  font: 'inherit',
  textAlign: 'left' as const,
  px: 0.5,
  py: '6px',
  cursor: busy ? 'default' : 'pointer',
  '&:hover': { bgcolor: theme.palette.kanap.bg.hover },
  '&:focus-visible': {
    outline: `2px solid ${theme.palette.kanap.teal}`,
    outlineOffset: -2,
    bgcolor: theme.palette.kanap.bg.hover,
  },
});

/**
 * One catalog product. The hosting type is chosen at adoption and stays off this line.
 * The description is the delayed tooltip (and the accessible description), never a third line.
 * A reference this entry would complete shares the editor's line.
 * An entry the tenant already adopted shows that technology's reference there instead, and opens it.
 */
function CatalogRow({ entry, familyLabel, busy, onAdopt, adoptedReference, onOpen }: {
  entry: CatalogEntry;
  familyLabel: string;
  busy: boolean;
  onAdopt?: (entry: CatalogEntry) => void;
  /** Set when the tenant already has this entry: shown in place of adopting it. */
  adoptedReference?: string;
  onOpen?: (reference: string) => void;
}) {
  const { t } = useTranslation('it');
  const hintId = React.useId();
  const description = entry.description?.trim() || '';
  const completesLabel = !adoptedReference && entry.completes
    ? t('pages.technologies.create.completes', { reference: entry.completes })
    : '';
  const row = (
    <Box
      role="listitem"
      component="button"
      type="button"
      disabled={busy}
      onClick={() => {
        if (adoptedReference) onOpen?.(adoptedReference);
        else onAdopt?.(entry);
      }}
      // Tooltip with `describeChild` sets a native title while closed: keep only the delayed tooltip.
      title={undefined}
      aria-describedby={description ? hintId : undefined}
      sx={catalogRowSx(busy)}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, width: '100%', minWidth: 0 }}>
        <Box component="span" className="kanap-autocomplete-option-primary" sx={{ ...optionLineSx, flex: '1 1 auto' }}>
          {entry.name}
        </Box>
        {familyLabel ? (
          <Box component="span" className="kanap-autocomplete-option-secondary kanap-catalog-family">
            {familyLabel}
          </Box>
        ) : null}
      </Box>
      {/* Always present, so a product without an editor stays the same height as the others.
          The completion mention, or the reference of an entry already adopted, stays on this line. */}
      {adoptedReference ? (
        <Box
          component="span"
          className="kanap-autocomplete-option-secondary"
          sx={{ display: 'flex', alignItems: 'baseline', gap: 1, width: '100%', minWidth: 0 }}
        >
          <Box component="span" sx={{ ...optionLineSx, flex: '1 1 auto' }}>
            {entry.editor || '\u00a0'}
          </Box>
          <Box
            component="span"
            sx={{
              flex: '0 0 auto',
              whiteSpace: 'nowrap',
              fontFamily: MONO_FONT_FAMILY,
              fontVariantNumeric: 'tabular-nums',
              color: 'kanap.text.tertiary',
            }}
          >
            {adoptedReference}
          </Box>
        </Box>
      ) : completesLabel ? (
        <Box
          component="span"
          className="kanap-autocomplete-option-secondary"
          sx={{ display: 'flex', alignItems: 'baseline', gap: 1, width: '100%', minWidth: 0 }}
        >
          <Box component="span" sx={{ ...optionLineSx, flex: '1 1 auto' }}>
            {entry.editor || completesLabel}
          </Box>
          {entry.editor ? (
            <Box component="span" sx={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}>
              {completesLabel}
            </Box>
          ) : null}
        </Box>
      ) : (
        <Box component="span" className="kanap-autocomplete-option-secondary" sx={{ ...optionLineSx, display: 'block' }}>
          {entry.editor || '\u00a0'}
        </Box>
      )}
      {description ? <span id={hintId} hidden>{description}</span> : null}
    </Box>
  );
  if (!description) return row;
  return (
    <Tooltip
      title={description}
      placement="bottom-start"
      enterDelay={OPTION_HINT_DELAY_MS}
      enterNextDelay={OPTION_HINT_DELAY_MS}
      describeChild
      disableInteractive
    >
      {row}
    </Tooltip>
  );
}

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
 * it with its versions, or completes the technology already typed under that name). A search that
 * matches an entry already adopted lists it underneath, and a click opens that technology. Then a
 * free entry for a product the catalog does not know.
 */
export default function TechnologyCreateDialog({ open, onClose, onCreated }: Props) {
  const { t, i18n } = useTranslation(['it', 'common']);
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const queryClient = useQueryClient();
  const { byField, labelFor } = useItOpsEnumOptions();
  const [manual, setManual] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [draft, setDraft] = React.useState({ name: '', family: '', editor: '', hosting_type: '' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nameTaken, setNameTaken] = React.useState(false);
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const adoptedHeadingId = React.useId();
  // Types in use; on premises by default, as the server does (`backend/src/technologies/hosting-type.ts`).
  const hostingTypes = (byField.hostingType || []).filter((option) => !option.deprecated);
  const defaultHostingType = (hostingTypes.find((option) => option.code === 'on_prem')
    ?? hostingTypes.find((option) => option.category === 'on_prem')
    ?? hostingTypes[0])?.code ?? '';
  const hostingType = draft.hosting_type || defaultHostingType;

  React.useEffect(() => {
    if (!open) return;
    setManual(false);
    setSearch('');
    setDraft({ name: '', family: '', editor: '', hosting_type: '' });
    setError(null);
    setNameTaken(false);
  }, [open]);

  const catalogQuery = useQuery({
    queryKey: ['technology-catalog', debouncedSearch, language],
    queryFn: async () => {
      const data = (await api.get<{ items?: CatalogEntry[]; adopted?: AdoptedCatalogEntry[] }>('/technologies/catalog', {
        params: { q: debouncedSearch || undefined, language },
      })).data;
      return { items: data.items || [], adopted: data.adopted || [] };
    },
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
      const res = await api.post<{ technology: { reference: string } }>('/technologies/adopt', { catalog_key: entry.key, language });
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
        hosting_type: hostingType || undefined,
      });
      await finish(res.data.reference);
    } catch (err) {
      // A name the tenant already has is said under the name field, in the user's language.
      if (isDuplicateError(err)) setNameTaken(true);
      else setError(getApiErrorMessage(err, t, t('workspace.technology.messages.createFailed')));
    } finally {
      setBusy(false);
    }
  };

  const linkSx = (theme: any) => ({
    alignSelf: 'flex-start',
    border: 0,
    p: 0,
    bgcolor: 'transparent',
    color: theme.palette.kanap.teal,
    font: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  });

  const entries = catalogQuery.data?.items || [];
  // Hidden while the box is empty, including before the debounced request returns that fact.
  const adopted = search.trim() ? (catalogQuery.data?.adopted || []) : [];
  const showNoMatch = !catalogQuery.isFetching && entries.length === 0 && adopted.length === 0;

  return (
    <KanapDialog
      open={open}
      initialFocusRef={searchRef}
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
              inputRef={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('pages.technologies.create.searchPlaceholder')}
              inputProps={{ 'aria-label': t('pages.technologies.create.searchLabel') }}
            />
            <Box
              sx={[
                drawerAutocompleteListboxSx,
                {
                  // The shared secondary class is a line under the name. On the family, it sits on the name's line.
                  '& .kanap-autocomplete-option-secondary.kanap-catalog-family': {
                    mt: 0,
                    flex: '0 1 auto',
                    maxWidth: '50%',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textAlign: 'right',
                  },
                },
                (theme) => ({
                  // The listbox padding belongs to autocomplete menus. This list stays flush, at the same height.
                  py: 0,
                  maxHeight: 320,
                  minWidth: 0,
                  overflowY: 'auto',
                  borderTop: `1px solid ${theme.palette.kanap.border.soft}`,
                }),
              ]}
            >
              {(entries.length > 0 || showNoMatch || (catalogQuery.isFetching && entries.length === 0)) && (
                <Box role="list" aria-label={t('pages.technologies.create.catalog')}>
                  {catalogQuery.isFetching && entries.length === 0 && (
                    <Box sx={{ py: 1.5, display: 'flex', justifyContent: 'center' }}><CircularProgress size={16} /></Box>
                  )}
                  {showNoMatch && (
                    <Typography sx={(theme) => ({ py: 1, fontSize: 13, color: theme.palette.kanap.text.tertiary })}>
                      {t('pages.technologies.create.noMatch')}
                    </Typography>
                  )}
                  {entries.map((entry) => (
                    <CatalogRow
                      key={entry.key}
                      entry={entry}
                      familyLabel={labelFor('technologyFamily', entry.family)}
                      busy={busy}
                      onAdopt={(item) => { void adopt(item); }}
                    />
                  ))}
                </Box>
              )}
              {adopted.length > 0 && (
                <>
                  <Box
                    component="div"
                    id={adoptedHeadingId}
                    sx={(theme) => ({
                      px: 0.5,
                      pt: entries.length > 0 ? 1.25 : 0.75,
                      pb: 0.25,
                      fontSize: 11,
                      fontWeight: 500,
                      lineHeight: 1.5,
                      color: theme.palette.kanap.text.tertiary,
                    })}
                  >
                    {t('pages.technologies.create.alreadyHeading')}
                  </Box>
                  <Box role="list" aria-labelledby={adoptedHeadingId}>
                    {adopted.map((entry) => (
                      <CatalogRow
                        key={entry.key}
                        entry={{
                          key: entry.key,
                          name: entry.name,
                          editor: entry.editor,
                          family: entry.family,
                          hosting_type: null,
                          versions: 0,
                          latest_version: null,
                          completes: null,
                        }}
                        familyLabel={labelFor('technologyFamily', entry.family) || entry.family_label}
                        busy={busy}
                        adoptedReference={entry.reference}
                        onOpen={(reference) => { void finish(reference); }}
                      />
                    ))}
                  </Box>
                </>
              )}
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
                onChange={(event) => { setNameTaken(false); setDraft((prev) => ({ ...prev, name: event.target.value })); }}
                placeholder={t('workspace.technology.placeholders.name')}
                error={nameTaken}
                helperText={nameTaken ? t('workspace.technology.messages.duplicateName') : undefined}
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
            <PropertyRow label={t('workspace.technology.fields.hostingType')}>
              <Select
                variant="standard"
                value={hostingType}
                displayEmpty
                onChange={(event) => setDraft((prev) => ({ ...prev, hosting_type: String(event.target.value) }))}
                SelectDisplayProps={{ 'aria-label': t('workspace.technology.fields.hostingType') } as React.HTMLAttributes<HTMLDivElement>}
                fullWidth
              >
                {hostingTypes.map((option) => (
                  <MenuItem key={option.code} value={option.code} sx={drawerMenuItemSx}>{option.label}</MenuItem>
                ))}
              </Select>
            </PropertyRow>
            <Box component="button" type="button" onClick={() => { setManual(false); setError(null); setNameTaken(false); }} sx={linkSx}>
              {t('pages.technologies.create.backToCatalog')}
            </Box>
          </>
        )}
      </Stack>
    </KanapDialog>
  );
}
