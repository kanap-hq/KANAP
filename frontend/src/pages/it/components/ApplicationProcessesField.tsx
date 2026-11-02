import React from 'react';
import { Autocomplete, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { PropertyRow } from '../../../components/design';
import PickedNameRow from '../../../components/fields/PickedNameRow';
import { useLookupPicker } from '../../../hooks/useLookupPicker';
import { drawerAutocompleteListboxSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useApplicationFeedback } from '../applicationFeedback';
import { applicationRelationsKey, fetchApplicationRelations, type ApplicationRelationsData } from '../workspace/ApplicationRelationsTab';

type ProcessOption = { id: string; name: string; status?: string | null };

type Props = {
  applicationId: string;
  /** The caller manages applications. */
  canManage: boolean;
  textFieldSx?: SxProps<Theme>;
  /** Called after each link or unlink. */
  onChange?: () => void;
};

/**
 * The business processes of an application, in its properties panel (lot R1b), on the model of
 * the owners: one line per process, which opens its page, and a server search to add one. Each
 * link and unlink is saved at once (`POST` / `DELETE /applications/:id/relations/processes`). The
 * processes are read from the Relations tab's query, which the tab then finds ready. Editing
 * takes the right to manage applications and business processes; without the read of business
 * processes the row is absent.
 */
export default function ApplicationProcessesField({ applicationId, canManage, textFieldSx, onChange }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const queryClient = useQueryClient();
  const feedback = useApplicationFeedback();
  const canRead = hasLevel('business_processes', 'reader');
  const editable = canManage && hasLevel('business_processes', 'manager');
  const key = applicationRelationsKey(applicationId);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { data } = useQuery({ queryKey: key, queryFn: () => fetchApplicationRelations(applicationId), enabled: canRead && !!applicationId });
  const processes = data?.processes ?? [];
  const linkedIds = React.useMemo(() => new Set(processes.map((row) => row.id)), [processes]);
  const picker = useLookupPicker<ProcessOption>({ endpoint: '/business-processes/lookup', value: [], enabled: editable });
  const options = React.useMemo(() => picker.options.filter((option) => !linkedIds.has(option.id)), [picker.options, linkedIds]);

  const failed = (e: unknown) => setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));

  // One link at a time. The field stays enabled meanwhile: an Autocomplete disabled while it has
  // the focus closes its list during its own render, which updates this component mid-render.
  const savingRef = React.useRef(false);
  const add = async (option: ProcessOption | null) => {
    if (!option || savingRef.current) return;
    savingRef.current = true;
    setError(null);
    setSaving(true);
    try {
      await api.post(`/applications/${applicationId}/relations/processes`, { id: option.id });
    } catch (e) {
      failed(e);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    await queryClient.invalidateQueries({ queryKey: key });
    onChange?.();
  };

  const remove = async (processId: string) => {
    setError(null);
    const previous = queryClient.getQueryData<ApplicationRelationsData>(key);
    queryClient.setQueryData<ApplicationRelationsData>(key, (prev) => (
      prev ? { ...prev, processes: prev.processes ? prev.processes.filter((row) => row.id !== processId) : prev.processes } : prev
    ));
    try {
      await api.delete(`/applications/${applicationId}/relations/processes/${processId}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(key, previous);
      failed(e);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: key });
    onChange?.();
    feedback.undo(t('workspace.application.undo.processRemoved'), async () => {
      try {
        await api.post(`/applications/${applicationId}/relations/processes`, { id: processId });
      } catch (e) {
        feedback.error(getApiErrorMessage(e, t, t('messages.restoreFailed')));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: key });
      onChange?.();
    });
  };

  // No read of business processes (or the server says so): no row at all.
  if (!canRead || data?.processes === null) return null;

  const label = t('workspace.application.ownership.businessProcesses');
  return (
    <PropertyRow label={label}>
      <Stack spacing={0.75}>
        {processes.length > 0 && (
          <Stack spacing={0.5}>
            {processes.map((row) => (
              <PickedNameRow
                key={row.id}
                href={`/master-data/business-processes/${row.id}/overview`}
                muted={row.status === 'disabled'}
                onRemove={editable ? () => { void remove(row.id); } : undefined}
                removeLabel={t('workspace.application.relations.remove', { name: row.name })}
              >
                {row.name}
              </PickedNameRow>
            ))}
          </Stack>
        )}
        {editable && (
          <Autocomplete
            {...picker.autocomplete}
            options={options}
            getOptionLabel={(option) => option.name}
            value={null}
            onChange={(_, option) => { void add(option); }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t('workspace.application.ownership.addBusinessProcess')}
                size="small"
                variant="standard"
                sx={textFieldSx}
                inputProps={{ ...params.inputProps, 'aria-label': label }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {picker.loading || saving ? <CircularProgress color="inherit" size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            ListboxProps={{ sx: drawerAutocompleteListboxSx }}
            size="small"
          />
        )}
        {!editable && processes.length === 0 && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('common:selects.notSet')}</Typography>
        )}
        {error && <Typography role="alert" sx={{ fontSize: 12, color: 'error.main' }}>{error}</Typography>}
      </Stack>
    </PropertyRow>
  );
}
