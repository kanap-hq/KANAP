import React from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { screenLanguage } from '../../../components/csv/readings';
import RelationAddPicker, { type RelationOption } from '../../../components/workspace/RelationAddPicker';
import { useLocale } from '../../../i18n/useLocale';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { formatSupportDate, supportStateColor, supportStateOf } from '../../../utils/supportState';
import { assetTechnologiesKey, type AssetTechnologyRow } from './AssetTechnologiesSection';
import { invalidateTechnologyLinks } from './technologyLinkQueries';
import TechnologyVersionPicker, { type VersionChoice, type VersionOption } from './TechnologyVersionPicker';

type ListedTechnology = {
  id: string;
  name: string;
  reference: string | null;
  editor: string | null;
  family: string | null;
  lifecycle?: string | null;
};

type CatalogEntry = { key: string; name: string; editor: string | null };

type Choice = { id: string; name: string; versionLabel: string | null; versionId: string | null };

/** A version as `GET /technologies/:id/versions` returns it, with its support dates. */
type DatedVersion = VersionOption & { standard_support_end?: string | null; extended_support_end?: string | null };

type Props = {
  /** Absent while the server is being created: the choice stays local and is reported as a label. */
  assetId?: string;
  disabled?: boolean;
  /** A cluster has no operating system of its own. */
  isCluster?: boolean;
  /** The label the asset API returns, shown until the marked link is known. */
  label?: string;
  /** Create mode: the label `POST /assets` sends. `null` clears it. */
  onLabelChange?: (label: string | null) => void;
  /** An existing server: the page reloads the asset after the marked link changes. */
  onSaved?: () => void;
};

const PAGE = 30;

/** `Ubuntu` and `22.04 LTS` become the label the asset API stores (`Ubuntu 22.04 LTS`). */
function composedLabel(name: string, choice: VersionChoice, versions: VersionOption[] | undefined): string {
  if ('version_label' in choice) return `${name} ${choice.version_label}`.trim();
  if (!choice.technology_version_id) return name;
  const version = versions?.find((item) => item.id === choice.technology_version_id);
  return version ? `${name} ${version.label}` : name;
}

/**
 * The operating system of a server: a technology (those of the operating-system family first, then
 * the tenant's other technologies, then operating systems from the catalog the tenant has not
 * adopted), then an optional version. An existing server is saved through
 * `PUT /assets/:id/operating-system`. Creating a server keeps the readable label for `POST /assets`.
 */
export default function OperatingSystemField({ assetId, disabled, isCluster, label, onLabelChange, onSaved }: Props) {
  const { t, i18n } = useTranslation(['it', 'common']);
  const theme = useTheme();
  const locale = useLocale();
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const queryClient = useQueryClient();
  const versionBox = React.useRef<HTMLDivElement | null>(null);
  const [techAnchor, setTechAnchor] = React.useState<HTMLElement | null>(null);
  const [versionAnchor, setVersionAnchor] = React.useState<HTMLElement | null>(null);
  const [pending, setPending] = React.useState<Choice | null>(null);
  const [replacing, setReplacing] = React.useState(false);
  const [draft, setDraft] = React.useState<Choice | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const { data } = useQuery({
    queryKey: assetTechnologiesKey(assetId ?? ''),
    queryFn: async () => (await api.get<{ items: AssetTechnologyRow[] }>(`/assets/${assetId}/technologies`)).data,
    enabled: !!assetId,
  });
  const marked = data?.items.find((row) => row.is_operating_system);
  const saved: Choice | null = marked
    ? {
      id: marked.technology_id,
      name: marked.technology_name ?? '',
      versionLabel: marked.version_label,
      versionId: marked.technology_version_id,
    }
    : null;
  const shown = pending ?? (assetId ? (data ? saved : (label ? { id: '', name: label, versionLabel: null, versionId: null } : null)) : draft);
  const technologyId = shown?.id || null;

  const { data: versions } = useQuery({
    queryKey: ['technology-versions', technologyId],
    queryFn: async () => (await api.get<{ items: DatedVersion[] }>(`/technologies/${technologyId}/versions`)).data.items,
    enabled: !!technologyId,
  });

  const failed = (e: unknown) => setError(getApiErrorMessage(e, t, t('workspace.asset.technologies.saveFailed')));

  const search = React.useCallback(async (q: string, signal?: AbortSignal): Promise<RelationOption[]> => {
    const params = { limit: PAGE, ...(q ? { q } : {}) };
    const [familyList, lookup, catalog] = await Promise.all([
      api.get<{ items: ListedTechnology[] }>('/technologies', { params: { ...params, family: 'operating_system', sort: 'name' }, signal }),
      api.get<{ items: ListedTechnology[] }>('/technologies/lookup', { params, signal }),
      api.get<{ items: CatalogEntry[] }>('/technologies/catalog', { params: { family: 'operating_system', language, ...(q ? { q } : {}) }, signal }),
    ]);
    const options: RelationOption[] = [];
    const seen = new Set<string>();
    const push = (option: RelationOption) => {
      if (seen.has(option.id)) return;
      seen.add(option.id);
      options.push(option);
    };
    for (const row of familyList.data?.items ?? []) {
      if (row.lifecycle === 'retired') continue;
      push({ id: row.id, label: row.name, ref: row.reference, hint: row.editor });
    }
    for (const row of lookup.data?.items ?? []) {
      push({ id: row.id, label: row.name, ref: row.reference, hint: row.editor });
    }
    const names = new Set(options.map((option) => option.label.toLowerCase()));
    for (const entry of catalog.data?.items ?? []) {
      if (names.has(entry.name.toLowerCase())) continue;
      push({ id: `catalog:${entry.key}`, label: entry.name, hint: t('workspace.asset.technologies.catalog') });
    }
    return options;
  }, [language, t]);

  const openVersion = (anchor: HTMLElement) => {
    if (!shown?.id || disabled || busy) return;
    setReplacing(false);
    setVersionAnchor(anchor);
  };

  const pickTechnology = async (option: RelationOption) => {
    setTechAnchor(null);
    setError(null);
    let choice: Choice = { id: option.id, name: option.label, versionLabel: null, versionId: null };
    if (option.id.startsWith('catalog:')) {
      setBusy(true);
      try {
        const res = await api.post<{ technology: { id: string; name: string } }>('/technologies/adopt', {
          catalog_key: option.id.slice('catalog:'.length),
          language,
        });
        choice = { id: res.data.technology.id, name: res.data.technology.name, versionLabel: null, versionId: null };
      } catch (e) {
        failed(e);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setPending(choice);
    setReplacing(true);
    if (versionBox.current) setVersionAnchor(versionBox.current);
  };

  const pickVersion = async (choice: VersionChoice) => {
    const technology = pending ?? shown;
    setVersionAnchor(null);
    setReplacing(false);
    if (!technology?.id) return;
    const versionLabel = 'version_label' in choice
      ? choice.version_label
      : (choice.technology_version_id ? versions?.find((item) => item.id === choice.technology_version_id)?.label ?? null : null);
    const versionId = 'technology_version_id' in choice ? choice.technology_version_id : null;
    const next: Choice = { id: technology.id, name: technology.name, versionLabel, versionId };
    if (!assetId) {
      setPending(null);
      setDraft(next);
      onLabelChange?.(composedLabel(technology.name, choice, versions));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put(`/assets/${assetId}/operating-system`, { technology_id: technology.id, ...choice });
      await invalidateTechnologyLinks(queryClient);
      setPending(null);
      onSaved?.();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setError(null);
    if (!assetId) {
      setDraft(null);
      setPending(null);
      onLabelChange?.(null);
      return;
    }
    setBusy(true);
    try {
      await api.delete(`/assets/${assetId}/operating-system`);
      await invalidateTechnologyLinks(queryClient);
      onSaved?.();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };

  // The support dates of the version chosen, as the former operating-system field showed them.
  const shownVersion = shown?.versionId
    ? versions?.find((item) => item.id === shown.versionId)
    : (shown?.versionLabel ? versions?.find((item) => item.label.toLowerCase() === shown.versionLabel!.toLowerCase()) : undefined);
  const standardEnd = shownVersion?.standard_support_end ?? null;
  const extendedEnd = shownVersion?.extended_support_end ?? null;
  const supportLine = [
    standardEnd ? t('workspace.asset.technical.standardSupportEnds', { date: formatSupportDate(standardEnd, locale) }) : '',
    extendedEnd ? t('workspace.asset.technical.extendedSupportEnds', { date: formatSupportDate(extendedEnd, locale) }) : '',
  ].filter(Boolean).join(' / ');
  const supportColor = supportStateColor(supportStateOf(standardEnd, extendedEnd), theme);

  const locked = !!disabled || busy;
  const versionMissing = !!shown?.id && !shown.versionLabel;
  const fieldSx = {
    '& .MuiInputBase-root': { fontSize: 13, cursor: locked ? 'default' : 'pointer' },
    '& input': { cursor: locked ? 'default' : 'pointer' },
  };

  return (
    <Stack spacing={1} sx={{ maxWidth: 520 }}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          value={shown?.name ?? ''}
          placeholder={t('workspace.asset.technical.osTechnologyPlaceholder')}
          onClick={(event) => { if (!locked) setTechAnchor(event.currentTarget); }}
          InputProps={{ readOnly: true }}
          inputProps={{ 'aria-label': t('workspace.asset.technical.osTechnology') }}
          disabled={locked}
          size="small"
          variant="standard"
          sx={{ flex: 1.4, ...fieldSx }}
        />
        <Box ref={versionBox} sx={{ flex: 1 }}>
          <TextField
            fullWidth
            value={shown?.versionLabel ?? (versionMissing ? t('workspace.technology.versionPicker.unknown') : '')}
            placeholder={t('workspace.asset.technical.osVersionPlaceholder')}
            onClick={(event) => openVersion(event.currentTarget)}
            InputProps={{ readOnly: true }}
            inputProps={{ 'aria-label': t('workspace.asset.technical.osVersion') }}
            disabled={locked || !shown?.id}
            size="small"
            variant="standard"
            sx={{
              ...fieldSx,
              ...(versionMissing ? { '& input': { color: 'kanap.text.tertiary', cursor: locked ? 'default' : 'pointer' } } : {}),
            }}
          />
        </Box>
      </Stack>
      {techAnchor && (
        <RelationAddPicker
          anchorEl={techAnchor}
          searchKey={`asset-os-${assetId ?? 'new'}`}
          search={search}
          excludeIds={new Set()}
          placeholder={t('workspace.asset.technologies.search')}
          ariaLabel={t('workspace.asset.technologies.search')}
          onPick={(option) => { void pickTechnology(option); }}
          onClose={() => setTechAnchor(null)}
        />
      )}
      {versionAnchor && (
        <TechnologyVersionPicker
          anchorEl={versionAnchor}
          versions={versions}
          current={replacing ? undefined : shown?.versionId}
          onPick={(choice) => { void pickVersion(choice); }}
          onClose={() => {
            setVersionAnchor(null);
            if (replacing) setPending(null);
          }}
        />
      )}
      {!!shown && !locked && (
        <Button
          variant="text"
          size="small"
          onClick={() => { void clear(); }}
          sx={{ alignSelf: 'flex-start', px: 0, minWidth: 0, fontSize: 13, fontWeight: 400, color: 'kanap.text.secondary', textTransform: 'none' }}
        >
          {t('workspace.asset.technical.osClear')}
        </Button>
      )}
      {!isCluster && supportLine ? (
        <Typography variant="caption" sx={{ color: supportColor }} data-testid="os-support-dates">
          {supportLine}
        </Typography>
      ) : (isCluster || !shown) ? (
        <Typography variant="caption" sx={{ color: 'kanap.text.tertiary' }}>
          {isCluster ? t('workspace.asset.technical.osClusterHint') : t('workspace.asset.technical.osChooseHint')}
        </Typography>
      ) : null}
    </Stack>
  );
}
