import React from 'react';
import { Autocomplete, Box, Button, Chip, CircularProgress, Link, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import api from '../../../api';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import { drawerAutocompleteListboxSx, tealLinkSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

/** A publisher and product as CVE.org writes them. `version` limits the name to technology versions whose label starts with it. */
export type TechnologyCveName = {
  vendor: string;
  product: string;
  version: string | null;
};

type DirectoryItem = {
  vendor: string;
  product: string;
  cve_count: number;
  last_published: string | null;
};

type NameSuggestion = DirectoryItem & {
  share: number;
  total_cve_count: number;
};

const CVE_ORG_URL = 'https://www.cve.org';
/** Wait for a pause in typing before asking the directory, and drop that search when typing resumes. */
const SEARCH_PAUSE_MS = 300;
const SUGGESTION_PREVIEW = 3;

/**
 * Comparison form of a publisher or product. The same rule as the server's `cveNameKey`:
 * NFKC, lower case, every run of characters that are neither letters nor digits collapsed to one space.
 */
export function cveNameKey(text: string): string {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Publisher and product by `cveNameKey`, version by its trimmed text. One key is one name. */
export function cveNameIdentity(name: { vendor: string; product: string; version?: string | null }): string {
  return `${cveNameKey(name.vendor)}\0${cveNameKey(name.product)}\0${(name.version ?? '').trim()}`;
}

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { name?: string; code?: string };
  return record.name === 'CanceledError' || record.name === 'AbortError' || record.code === 'ERR_CANCELED';
}

function readDirectory(items: unknown): DirectoryItem[] {
  if (!Array.isArray(items)) return [];
  const result: DirectoryItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const vendor = typeof record.vendor === 'string' ? record.vendor.trim() : '';
    const product = typeof record.product === 'string' ? record.product.trim() : '';
    if (!vendor || !product) continue;
    const published = typeof record.last_published === 'string' ? record.last_published.trim() : '';
    result.push({
      vendor,
      product,
      cve_count: Number(record.cve_count) || 0,
      last_published: published || null,
    });
  }
  return result;
}

function readSuggestions(items: unknown): NameSuggestion[] {
  if (!Array.isArray(items)) return [];
  const result: NameSuggestion[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const [directory] = readDirectory([record]);
    if (!directory) continue;
    const share = Number(record.share);
    result.push({
      ...directory,
      share: Number.isFinite(share) ? share : 0,
      total_cve_count: Number(record.total_cve_count) || 0,
    });
  }
  return result;
}

function optionMeta(item: DirectoryItem, t: TFunction, locale: string): string {
  const date = formatShortDate(item.last_published, locale, { year: 'always' });
  if (date) return t('workspace.technology.cveNames.optionMeta', { count: item.cve_count, date });
  return t('workspace.technology.cveNames.optionCount', { count: item.cve_count });
}

function suggestionMeta(item: NameSuggestion, t: TFunction, locale: string): string {
  const share = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(item.share);
  return t('workspace.technology.cveNames.suggestionMeta', { count: item.cve_count, share });
}

function nameText(name: TechnologyCveName): string {
  const version = name.version?.trim();
  return version ? `${name.vendor} · ${name.product} · ${version}` : `${name.vendor} · ${name.product}`;
}

function SectionLabel({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <Typography id={id} component="h2" sx={(theme) => ({ m: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: theme.palette.kanap.text.primary })}>
        {children}
      </Typography>
    </Box>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="span" sx={{ display: 'block', mb: 0.5, fontSize: 12, lineHeight: 1.4, color: 'kanap.text.tertiary' }}>
      {children}
    </Typography>
  );
}

function NameLabel({ name }: { name: TechnologyCveName }) {
  const version = name.version?.trim();
  return (
    <Box component="span">
      {name.vendor} · {name.product}
      {version ? <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{` · ${version}`}</Box> : null}
    </Box>
  );
}

export default function TechnologyCveNames({ technologyId, names, cpeProducts, canManage, onChange }: {
  technologyId: string;
  names: TechnologyCveName[];
  cpeProducts: string[];
  canManage: boolean;
  onChange: (names: TechnologyCveName[]) => void | Promise<void>;
}) {
  const { t } = useTranslation(['it', 'common']);
  const locale = useLocale();
  const titleId = React.useId();
  const [input, setInput] = React.useState('');
  const [selected, setSelected] = React.useState<DirectoryItem | null>(null);
  const [version, setVersion] = React.useState('');
  const [options, setOptions] = React.useState<DirectoryItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const savingRef = React.useRef(false);
  const listed = names ?? [];

  React.useEffect(() => {
    if (!canManage) return undefined;
    const q = input.trim();
    const held = selected != null && input === selected.product;
    if (held || q.length < 2) {
      // A fresh array would render again and run this effect forever.
      if (!held) setOptions((current) => (current.length === 0 ? current : []));
      setLoading((current) => (current ? false : current));
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api.get<{ items?: unknown }>('/vulnerabilities/cve-names', { params: { q }, signal: controller.signal })
        .then((res) => {
          if (!cancelled) setOptions(readDirectory(res.data?.items));
        })
        .catch((err: unknown) => {
          if (cancelled || isAbort(err)) return;
          setOptions([]);
          setError(getApiErrorMessage(err, t, t('workspace.technology.cveNames.searchFailed')));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_PAUSE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canManage, input, selected, t]);

  const hasCpe = cpeProducts.some((product) => product.trim().length > 0);
  const suggestionsQuery = useQuery({
    queryKey: ['technology-cve-names-suggestions', technologyId, cpeProducts.join('\n'), listed.map(cveNameIdentity).join('\n')],
    queryFn: async ({ signal }) => {
      const res = await api.get<{ items?: unknown }>(`/technologies/${technologyId}/cve-names/suggestions`, { signal });
      return readSuggestions(res.data?.items);
    },
    enabled: canManage && technologyId.length > 0 && hasCpe,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const suggestions = suggestionsQuery.data ?? [];
  const suggestionSignature = suggestions.map((item) => cveNameIdentity(item)).join('\n');
  const [expandedSignature, setExpandedSignature] = React.useState<string | null>(null);
  const expanded = expandedSignature === suggestionSignature && suggestionSignature !== '';
  const hidden = Math.max(0, suggestions.length - SUGGESTION_PREVIEW);
  const visibleSuggestions = expanded ? suggestions : suggestions.slice(0, SUGGESTION_PREVIEW);

  const commit = async (next: TechnologyCveName[], clearForm: boolean) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await Promise.resolve(onChange(next));
      if (clearForm) {
        setSelected(null);
        setInput('');
        setVersion('');
        setOptions([]);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, t, t('workspace.technology.cveNames.saveFailed')));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const addSelected = () => {
    if (!selected) return;
    const next: TechnologyCveName = {
      vendor: selected.vendor.trim(),
      product: selected.product.trim(),
      version: version.trim() ? version.trim() : null,
    };
    if (listed.some((item) => cveNameIdentity(item) === cveNameIdentity(next))) {
      setError(t('workspace.technology.cveNames.duplicate'));
      return;
    }
    void commit([...listed, next], true);
  };

  const addSuggestion = (item: NameSuggestion) => {
    const next: TechnologyCveName = { vendor: item.vendor, product: item.product, version: null };
    if (listed.some((name) => cveNameIdentity(name) === cveNameIdentity(next))) {
      setError(t('workspace.technology.cveNames.duplicate'));
      return;
    }
    void commit([...listed, next], false);
  };

  const title = t('workspace.technology.cveNames.title');
  const trimmed = input.trim();

  return (
    <Box component="section" aria-labelledby={titleId}>
      <SectionLabel id={titleId}>{title}</SectionLabel>
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {listed.length === 0 && (
            <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary })}>
              {t('workspace.technology.cveNames.empty')}
            </Typography>
          )}
          {listed.map((name) => {
            const label = nameText(name);
            return (
              <Chip
                key={cveNameIdentity(name)}
                size="small"
                variant="outlined"
                label={<NameLabel name={name} />}
                sx={{ height: 'auto', maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal', fontSize: 13, lineHeight: 1.4, py: '3px' } }}
                onDelete={canManage ? () => { void commit(listed.filter((item) => cveNameIdentity(item) !== cveNameIdentity(name)), false); } : undefined}
                deleteIcon={canManage ? <DeleteIcon aria-label={t('workspace.technology.cveNames.remove', { value: label })} /> : undefined}
              />
            );
          })}
        </Box>
        {canManage && (
          <Stack spacing={0.75}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'flex-end' }}>
              <Box sx={{ flex: '1 1 280px', maxWidth: 440, minWidth: 200 }}>
                <FieldLabel>{t('workspace.technology.cveNames.search')}</FieldLabel>
                <Autocomplete
                  options={options}
                  value={selected}
                  inputValue={input}
                  loading={loading}
                  filterOptions={(items) => items}
                  getOptionLabel={(option) => option.product}
                  isOptionEqualToValue={(option, value) => cveNameKey(option.vendor) === cveNameKey(value.vendor) && cveNameKey(option.product) === cveNameKey(value.product)}
                  noOptionsText={trimmed.length < 2 ? t('workspace.technology.cveNames.searchTooShort') : t('workspace.technology.cveNames.noMatch')}
                  loadingText={t('common:status.loading')}
                  ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                  onInputChange={(_event, value, reason) => {
                    setInput(value);
                    if (reason === 'input' || reason === 'clear') {
                      setSelected(null);
                      setError(null);
                    }
                  }}
                  onChange={(_event, option) => {
                    setSelected(option);
                    setError(null);
                  }}
                  renderOption={(props, option) => (
                    <li {...props} key={`${cveNameKey(option.vendor)}\0${cveNameKey(option.product)}`}>
                      <Box sx={{ minWidth: 0 }}>
                        <Box className="kanap-autocomplete-option-primary">{option.product}</Box>
                        <Box className="kanap-autocomplete-option-secondary">{option.vendor}</Box>
                        <Box className="kanap-autocomplete-option-secondary">{optionMeta(option, t, locale)}</Box>
                      </Box>
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      variant="standard"
                      placeholder={t('workspace.technology.cveNames.searchPlaceholder')}
                      error={Boolean(error)}
                      inputProps={{ ...params.inputProps, 'aria-label': t('workspace.technology.cveNames.search'), autoComplete: 'off' }}
                      InputProps={{
                        ...params.InputProps,
                        endAdornment: (
                          <>
                            {loading ? <CircularProgress color="inherit" size={16} /> : null}
                            {params.InputProps.endAdornment}
                          </>
                        ),
                      }}
                    />
                  )}
                  sx={{ width: '100%' }}
                />
              </Box>
              <Box sx={{ flex: '0 1 150px', width: 150 }}>
                <FieldLabel>{t('workspace.technology.cveNames.version')}</FieldLabel>
                <TextField
                  variant="standard"
                  value={version}
                  fullWidth
                  placeholder={t('workspace.technology.cveNames.versionPlaceholder')}
                  inputProps={{ 'aria-label': t('workspace.technology.cveNames.version'), maxLength: 50 }}
                  onChange={(event) => { setVersion(event.target.value); setError(null); }}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSelected(); } }}
                />
              </Box>
              <Button variant="action" size="small" disabled={!selected || saving} onClick={addSelected} sx={{ flex: '0 0 auto' }}>
                {t('common:buttons.add')}
              </Button>
            </Box>
            {error ? (
              <Typography role="alert" sx={(theme) => ({ fontSize: 12, color: theme.palette.error.main })}>
                {error}
              </Typography>
            ) : null}
          </Stack>
        )}
        {canManage && suggestions.length > 0 && (
          <Stack spacing={0.5}>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t('workspace.technology.cveNames.suggestions')}
            </Typography>
            {visibleSuggestions.map((item) => (
              <Box key={cveNameIdentity(item)} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1.5, rowGap: 0.25 }}>
                <Typography component="span" sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
                  {item.vendor} · {item.product}
                </Typography>
                <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                  {suggestionMeta(item, t, locale)}
                </Typography>
                <Box
                  component="button"
                  type="button"
                  disabled={saving}
                  onClick={() => addSuggestion(item)}
                  aria-label={t('workspace.technology.cveNames.addSuggestion', { vendor: item.vendor, product: item.product })}
                  sx={tealLinkSx}
                >
                  {t('common:buttons.add')}
                </Box>
              </Box>
            ))}
            {!expanded && hidden > 0 && (
              <Box component="button" type="button" onClick={() => setExpandedSignature(suggestionSignature)} sx={{ ...tealLinkSx, alignSelf: 'flex-start' }}>
                {t('workspace.technology.cveNames.seeMore', { count: hidden })}
              </Box>
            )}
          </Stack>
        )}
        {canManage && suggestionsQuery.isError && suggestions.length === 0 && (
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
            {t('workspace.technology.cveNames.suggestionsFailed')}
          </Typography>
        )}
        <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary })}>
          {t('workspace.technology.cveNames.hint')}{' '}
          <Link href={CVE_ORG_URL} target="_blank" rel="noreferrer">{t('workspace.technology.cveNames.site')}</Link>
          {'. '}
          {t('workspace.technology.cveNames.versionHint')}
        </Typography>
      </Stack>
    </Box>
  );
}
