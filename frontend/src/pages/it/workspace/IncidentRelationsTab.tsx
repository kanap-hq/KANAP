import React from 'react';
import { Alert, Autocomplete, Chip, CircularProgress, Stack, TextField } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { incidentsApi, type IncidentLinkedObject } from '../../../api/endpoints/incidents';
import { PropertyRow } from '../../../components/design';
import EntityTasksPanel from '../../../components/EntityTasksPanel';
import { drawerAutocompleteListboxSx, drawerFieldValueSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { incidentEntriesQueryKey } from './IncidentJournalTab';

type LinkKind = 'assets' | 'applications' | 'technologies';

type SearchRow = {
  id: string;
  name: string;
  asset_reference?: string | null;
  sequential_id?: string | null;
  reference?: string | null;
};

/** Where each field searches (list or lookup routes, whose access rules apply), and how it reads and replaces its links. */
const KINDS: Record<LinkKind, {
  endpoint: string;
  sort?: string;
  list: (incidentId: string) => Promise<IncidentLinkedObject[]>;
  replace: (incidentId: string, ids: string[]) => Promise<IncidentLinkedObject[]>;
}> = {
  assets: { endpoint: '/assets', sort: 'name:ASC', list: (id) => incidentsApi.listAssets(id), replace: (id, ids) => incidentsApi.replaceAssets(id, ids) },
  applications: { endpoint: '/applications', sort: 'name:ASC', list: (id) => incidentsApi.listApplications(id), replace: (id, ids) => incidentsApi.replaceApplications(id, ids) },
  technologies: { endpoint: '/technologies/lookup', list: (id) => incidentsApi.listTechnologies(id), replace: (id, ids) => incidentsApi.replaceTechnologies(id, ids) },
};

const relationTagSx = {
  height: 22,
  borderRadius: '4px',
  fontSize: 12,
  '& .MuiChip-label': { px: '7px' },
} as const;

function linkedObjectLabel(option: IncidentLinkedObject): string {
  return option.reference ? `${option.reference} · ${option.name}` : option.name;
}

export function incidentLinksQueryKey(incidentId: string, kind: LinkKind) {
  return ['incident-links', kind, incidentId] as const;
}

function LinkedObjectsField({
  incidentId,
  kind,
  readOnly,
  onSaved,
  onError,
}: {
  incidentId: string;
  kind: LinkKind;
  readOnly: boolean;
  onSaved: (kind: LinkKind, count: number) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation('it');
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const queryKey = incidentLinksQueryKey(incidentId, kind);
  const { data: linked = [] } = useQuery({
    queryKey,
    queryFn: () => KINDS[kind].list(incidentId),
  });

  const { data: searchResults = [], isFetching } = useQuery({
    queryKey: ['incident-link-options', kind, debouncedSearch],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: 50 };
      if (KINDS[kind].sort) params.sort = KINDS[kind].sort as string;
      if (debouncedSearch) params.q = debouncedSearch;
      const res = await api.get<{ items: SearchRow[] }>(KINDS[kind].endpoint, { params });
      return (res.data?.items || []).map<IncidentLinkedObject>((row) => ({
        id: row.id,
        name: row.name,
        reference: row.asset_reference ?? row.sequential_id ?? row.reference ?? null,
      }));
    },
    enabled: !readOnly,
    staleTime: 30_000,
  });

  const options = React.useMemo(() => {
    const byId = new Map(searchResults.map((option) => [option.id, option]));
    for (const item of linked) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }, [linked, searchResults]);

  const replace = async (next: IncidentLinkedObject[]) => {
    const previous = linked;
    queryClient.setQueryData(queryKey, next);
    setSaving(true);
    try {
      const ids = next.map((item) => item.id);
      const saved = await KINDS[kind].replace(incidentId, ids);
      queryClient.setQueryData(queryKey, saved);
      void queryClient.invalidateQueries({ queryKey: incidentEntriesQueryKey(incidentId) });
      onSaved(kind, saved.length);
    } catch (e) {
      queryClient.setQueryData(queryKey, previous);
      onError(getApiErrorMessage(e, t, t('workspace.incident.messages.relationsFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PropertyRow label={t(`workspace.incident.relations.${kind}`)} valueSx={{ maxWidth: 640 }}>
      <Autocomplete
        multiple
        options={options}
        value={linked}
        getOptionLabel={linkedObjectLabel}
        onChange={(_, value) => { void replace(value); }}
        inputValue={search}
        onInputChange={(_, value) => setSearch(value)}
        loading={isFetching}
        renderOption={(props, option) => {
          const { key, ...optionProps } = props;
          return <li key={key} {...optionProps}>{linkedObjectLabel(option)}</li>;
        }}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option.id}
              label={linkedObjectLabel(option)}
              sx={relationTagSx}
              deleteIcon={<DeleteIcon fontSize="small" />}
            />
          ))
        }
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={t(`workspace.incident.relations.${kind}Placeholder`)}
            variant="standard"
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {isFetching ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
            sx={drawerFieldValueSx}
          />
        )}
        ListboxProps={{ sx: drawerAutocompleteListboxSx }}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        filterSelectedOptions
        disabled={readOnly || saving}
        sx={[drawerFieldValueSx, { width: '100%' }]}
      />
    </PropertyRow>
  );
}

type Props = {
  incidentId: string;
  readOnly: boolean;
  onLinksChange: (kind: LinkKind, count: number) => void;
  onTasksChange: () => void;
};

export default function IncidentRelationsTab({ incidentId, readOnly, onLinksChange, onTasksChange }: Props) {
  const { hasLevel } = useAuth();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <LinkedObjectsField incidentId={incidentId} kind="assets" readOnly={readOnly} onSaved={onLinksChange} onError={setError} />
      <LinkedObjectsField incidentId={incidentId} kind="applications" readOnly={readOnly} onSaved={onLinksChange} onError={setError} />
      {hasLevel('infrastructure', 'reader') && (
        <LinkedObjectsField incidentId={incidentId} kind="technologies" readOnly={readOnly} onSaved={onLinksChange} onError={setError} />
      )}
      <EntityTasksPanel entityType="incident" entityId={incidentId} disabled={readOnly} onTasksChange={onTasksChange} />
    </Stack>
  );
}
