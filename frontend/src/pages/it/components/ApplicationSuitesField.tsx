import React from 'react';
import { Autocomplete, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { PropertyRow } from '../../../components/design';
import PickedNameRow from '../../../components/fields/PickedNameRow';
import { drawerAutocompleteListboxSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useApplicationFeedback } from '../applicationFeedback';

type SuiteOption = { id: string; name: string; reference?: string | null };

type Props = {
  applicationId: string;
  canManage: boolean;
  textFieldSx?: SxProps<Theme>;
};

/**
 * "Included in" of an application, in its properties panel: the suites it belongs to (applications
 * marked "Can contain child applications", never itself). One line per suite, which opens its
 * page; each link and unlink is saved at once (`POST /applications/:id/suites/bulk-replace`).
 */
export default function ApplicationSuitesField({ applicationId, canManage, textFieldSx }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const queryClient = useQueryClient();
  const feedback = useApplicationFeedback();
  const [saving, setSaving] = React.useState(false);
  const key = React.useMemo(() => ['application-suites', applicationId], [applicationId]);

  const { data: current = [] } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ items: SuiteOption[] }>(`/applications/${applicationId}/suites`)).data.items || [],
    // No id yet: the empty draft of a new application (its creation preview) has no suite to read.
    enabled: !!applicationId,
  });
  const { data: suites = [] } = useQuery({
    queryKey: ['application-suite-candidates'],
    enabled: canManage,
    queryFn: async () => (await api.get<{ items: SuiteOption[] }>('/applications', {
      params: { limit: 500, sort: 'name:ASC', filters: JSON.stringify({ is_suite: { type: 'equals', filter: true } }) },
    })).data.items || [],
  });
  const linked = React.useMemo(() => new Set(current.map((suite) => suite.id)), [current]);
  const options = React.useMemo(
    () => suites.filter((suite) => suite.id !== applicationId && !linked.has(suite.id)),
    [suites, applicationId, linked],
  );

  const replace = React.useCallback(async (ids: string[]) => {
    setSaving(true);
    try {
      await api.post(`/applications/${applicationId}/suites/bulk-replace`, { suite_ids: ids });
      return true;
    } catch (err) {
      feedback.error(getApiErrorMessage(err, t, t('messages.saveSuitesFailed')));
      return false;
    } finally {
      setSaving(false);
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ['applications'] });
    }
  }, [applicationId, feedback, key, queryClient, t]);

  const remove = async (suite: SuiteOption) => {
    const before = current.map((item) => item.id);
    const done = await replace(before.filter((id) => id !== suite.id));
    if (done) {
      feedback.undo(t('workspace.application.undo.suiteRemoved'), async () => {
        if (!(await replace(before))) throw new Error('restore');
      });
    }
  };

  const label = t('workspace.application.overview.includedIn');
  if (!canManage && current.length === 0) return null;
  return (
    <PropertyRow label={label}>
      <Stack spacing={0.75}>
        {current.length > 0 && (
          <Stack spacing={0.5}>
            {current.map((suite) => (
              <PickedNameRow
                key={suite.id}
                href={`/it/applications/${suite.reference || suite.id}/overview`}
                onRemove={canManage ? () => { void remove(suite); } : undefined}
                removeLabel={t('workspace.application.relations.remove', { name: suite.name })}
                removeDisabled={saving}
              >
                {suite.name}
              </PickedNameRow>
            ))}
          </Stack>
        )}
        {canManage && (
          <Autocomplete
            options={options}
            getOptionLabel={(option) => option.name}
            value={null}
            onChange={(_, option) => { if (option) void replace([...current.map((item) => item.id), option.id]); }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t('workspace.application.overview.includedInPlaceholder')}
                size="small"
                variant="standard"
                sx={textFieldSx}
                inputProps={{ ...params.inputProps, 'aria-label': label }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {saving ? <CircularProgress color="inherit" size={16} /> : null}
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
        {!canManage && current.length === 0 && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('common:selects.notSet')}</Typography>
        )}
      </Stack>
    </PropertyRow>
  );
}
