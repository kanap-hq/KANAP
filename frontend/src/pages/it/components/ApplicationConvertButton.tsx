import React from 'react';
import { Box, Button, MenuItem, Select, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog, PropertyRow } from '../../../components/design';
import { useLocalizedItOpsSettings } from '../../../hooks/useLocalizedItOpsSettings';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

type Counts = Record<string, number>;

export type ConversionPreview = {
  application: { id: string; name: string; reference: string | null };
  mode: 'installed' | 'subscribed';
  refusals: Array<{ reason: string; count: number }>;
  moves: Counts;
  losses: Counts;
};

type Props = {
  applicationId: string;
  applicationName: string;
  onConverted: (technologyId: string) => void;
};

const MOVE_KEYS = ['owners', 'contracts', 'budget_lines', 'projects', 'links', 'attachments', 'incidents', 'servers'];
const LOSS_KEYS = [
  'instances', 'suites', 'predecessor', 'successors', 'data_residency', 'support_contacts', 'knowledge_links',
  'managed_documents', 'tasks', 'requests', 'business_processes', 'technologies',
];

/**
 * "Convert to technology" of the application workspace (lot C1): a dialog with the classification
 * test, the family, what moves to the technology and what is lost (from the preview), the refusal
 * when the application must stay one, and the confirmation. Once converted, the page goes to the
 * new technology.
 */
export default function ApplicationConvertButton({ applicationId, applicationName, onConverted }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [family, setFamily] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { data: settings } = useLocalizedItOpsSettings();
  const families = ((settings as { technologyFamilies?: Array<{ code: string; label: string; deprecated?: boolean }> } | undefined)?.technologyFamilies ?? [])
    .filter((option) => !option.deprecated);

  const previewQuery = useQuery({
    queryKey: ['application-conversion-preview', applicationId],
    queryFn: async () => (await api.get<ConversionPreview>(`/applications/${applicationId}/conversion-preview`)).data,
    enabled: open,
    staleTime: 0,
  });
  const preview = previewQuery.data;
  const refused = (preview?.refusals.length ?? 0) > 0;

  const close = () => {
    if (saving) return;
    setOpen(false);
    setError(null);
  };

  const convert = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<{ technology: { id: string } }>(`/applications/${applicationId}/convert-to-technology`, { family });
      await queryClient.invalidateQueries({
        predicate: (query) => ['applications', 'app-filter-values', 'technologies'].some((key) => String(query.queryKey[0]).startsWith(key)),
      });
      setOpen(false);
      onConverted(res.data.technology.id);
    } catch (err) {
      setError(getApiErrorMessage(err, t, t('workspace.application.convert.failed')));
      void previewQuery.refetch();
    } finally {
      setSaving(false);
    }
  };

  const countRows = (counts: Counts | undefined, keys: string[], group: 'moved' | 'lost') => {
    const rows = keys.filter((key) => (counts?.[key] ?? 0) > 0);
    if (rows.length === 0) {
      return <Typography variant="body2" color="text.secondary">{t('workspace.application.convert.nothing')}</Typography>;
    }
    return (
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {rows.map((key) => (
          <Box component="li" key={key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25 }}>
            <Typography variant="body2">{t(`workspace.application.convert.${group}.${key}`)}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{counts?.[key]}</Typography>
          </Box>
        ))}
      </Box>
    );
  };

  const sectionTitle = (text: string) => (
    <Typography variant="body2" sx={{ fontWeight: 500, mt: 2, mb: 0.5 }}>{text}</Typography>
  );

  return (
    <>
      <Button variant="action" size="small" onClick={() => { setFamily(''); setOpen(true); }}>
        {t('workspace.application.convert.action')}
      </Button>
      <KanapDialog
        open={open}
        title={t('workspace.application.convert.title', { name: applicationName })}
        onClose={close}
        onSave={convert}
        saveLabel={t('workspace.application.convert.confirm')}
        saveDisabled={!preview || refused || !family || saving}
        saveLoading={saving}
      >
        <Typography variant="body2" color="text.secondary">{t('workspace.application.convert.test')}</Typography>
        {previewQuery.isLoading && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>{t('workspace.application.convert.loading')}</Typography>
        )}
        {previewQuery.isError && (
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            {getApiErrorMessage(previewQuery.error, t, t('workspace.application.convert.failed'))}
          </Typography>
        )}
        {preview && refused && (
          <Box role="alert" sx={{ mt: 2 }}>
            <Typography variant="body2">{t('workspace.application.convert.refused')}</Typography>
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {preview.refusals.map((refusal) => (
                <Typography component="li" variant="body2" key={refusal.reason}>
                  {t(`workspace.application.convert.refusals.${refusal.reason}`, { count: refusal.count })}
                </Typography>
              ))}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t('workspace.application.convert.refusedHint')}</Typography>
          </Box>
        )}
        {preview && !refused && (
          <>
            <PropertyRow label={t('workspace.application.convert.family')} required sx={{ mt: 2 }}>
              <Select
                variant="standard"
                value={family}
                displayEmpty
                onChange={(event) => setFamily(String(event.target.value))}
                SelectDisplayProps={{ 'aria-label': t('workspace.application.convert.family') } as React.HTMLAttributes<HTMLDivElement>}
                fullWidth
              >
                <MenuItem value="" disabled>{t('workspace.application.convert.familyPlaceholder')}</MenuItem>
                {families.map((option) => (
                  <MenuItem key={option.code} value={option.code}>{option.label}</MenuItem>
                ))}
              </Select>
            </PropertyRow>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t(preview.mode === 'installed' ? 'workspace.application.convert.modeInstalled' : 'workspace.application.convert.modeSubscribed')}
            </Typography>
            {sectionTitle(t('workspace.application.convert.movesTitle'))}
            {countRows(preview.moves, MOVE_KEYS, 'moved')}
            {sectionTitle(t('workspace.application.convert.lossesTitle'))}
            {countRows(preview.losses, LOSS_KEYS, 'lost')}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('workspace.application.convert.lostAlways', { reference: preview.application.reference || applicationName })}
            </Typography>
          </>
        )}
        {error && <Typography variant="body2" color="error" sx={{ mt: 2 }}>{error}</Typography>}
      </KanapDialog>
    </>
  );
}
