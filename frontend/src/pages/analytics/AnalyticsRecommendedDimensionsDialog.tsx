import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Checkbox, MenuItem, Select, Typography } from '@mui/material';
import KanapDialog from '../../components/design/KanapDialog';
import { screenLanguage } from '../../components/csv/readings';
import { ANALYTICS_AXES_QUERY_KEY } from '../../hooks/useAnalyticsAxes';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import {
  addRecommendedDimensions,
  getRecommendedDimensions,
  type RecommendedDimensionCode,
  type RecommendedDimensionResult,
} from '../../services/analytics';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

/** Read fresh each time the dialog opens, under the dimensions' key (a dimension change refreshes it). */
const RECOMMENDED_KEY = [...ANALYTICS_AXES_QUERY_KEY, 'recommended'] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  /** After a successful call: what was created and what already existed. */
  onAdded: (result: { created: RecommendedDimensionResult[]; existing: RecommendedDimensionResult[] }) => void;
};

/**
 * Adds the recommended dimensions a tenant lacks (`POST /analytics-axes/recommended`): one box per
 * dimension, the starting four ticked and the optional pack not, the ones already there greyed;
 * the names in the language chosen, the screen's by default.
 */
export default function AnalyticsRecommendedDimensionsDialog({ open, onClose, onAdded }: Props) {
  const { t, i18n } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: RECOMMENDED_KEY,
    queryFn: getRecommendedDimensions,
    enabled: open,
    staleTime: 0,
  });
  const [selected, setSelected] = React.useState<RecommendedDimensionCode[]>([]);
  const [language, setLanguage] = React.useState<string>(() => screenLanguage(i18n.resolvedLanguage || i18n.language));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Each opening starts from the defaults: the starting dimensions the tenant lacks, the screen language.
  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setLanguage(screenLanguage(i18n.resolvedLanguage || i18n.language));
  }, [open, i18n.resolvedLanguage, i18n.language]);
  React.useEffect(() => {
    if (open && data) setSelected(data.filter((item) => item.starting && !item.present).map((item) => item.code));
  }, [open, data]);

  const items = data ?? [];
  const toggle = (code: RecommendedDimensionCode, on: boolean) => {
    setSelected((current) => (on ? [...current.filter((item) => item !== code), code] : current.filter((item) => item !== code)));
  };

  const onSave = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const codes = items.map((item) => item.code).filter((code) => selected.includes(code));
      const result = await addRecommendedDimensions(codes, language);
      void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['analytics-categories'] });
      onAdded(result);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, t, t('analytics.recommended.failed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KanapDialog
      open={open}
      onClose={onClose}
      title={t('analytics.recommended.title')}
      subtitle={t('analytics.recommended.subtitle')}
      onSave={onSave}
      saveLabel={t('analytics.recommended.submit')}
      saveDisabled={!data || selected.length === 0}
      saveLoading={saving}
      sx={{ maxWidth: 520 }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }} role="group" aria-label={t('analytics.recommended.dimensions')}>
          {items.map((item) => (
            <Box
              key={item.code}
              component="label"
              data-code={item.code}
              sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, cursor: item.present ? 'default' : 'pointer' }}
            >
              <Checkbox
                size="small"
                checked={item.present || selected.includes(item.code)}
                disabled={item.present}
                onChange={(event) => toggle(item.code, event.target.checked)}
                sx={{ p: 0.25 }}
                inputProps={{ 'aria-label': t(`analytics.recommended.names.${item.code}`) }}
              />
              <Box sx={{ minWidth: 0, pt: '3px' }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                  <Typography
                    component="span"
                    sx={{ fontSize: 13, lineHeight: 1.4, color: item.present ? 'kanap.text.tertiary' : 'kanap.text.primary' }}
                  >
                    {t(`analytics.recommended.names.${item.code}`)}
                  </Typography>
                  {item.present && (
                    <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                      {/* The dimension that stands for it, by its own name (an older tenant's Investment type for the purpose). */}
                      {item.name ? t('analytics.recommended.presentAs', { name: item.name }) : t('analytics.recommended.present')}
                    </Typography>
                  )}
                </Box>
                <Typography sx={{ fontSize: 12, lineHeight: 1.4, color: 'kanap.text.tertiary' }}>
                  {t(`analytics.recommended.hints.${item.code}`)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography id="recommended-language-label" sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>
            {t('analytics.recommended.language')}
          </Typography>
          <Select
            value={language}
            onChange={(event) => setLanguage(String(event.target.value))}
            sx={{ ...drawerSelectSx, width: 200 }}
            SelectDisplayProps={{ 'aria-labelledby': 'recommended-language-label' } as React.HTMLAttributes<HTMLDivElement>}
          >
            {SUPPORTED_LANGUAGES.map((option) => (
              <MenuItem key={option.code} value={option.code} sx={drawerMenuItemSx}>{option.nativeLabel}</MenuItem>
            ))}
          </Select>
        </Box>

        {isError && <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.danger' }}>{t('analytics.recommended.loadFailed')}</Typography>}
        {error && <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.danger' }}>{error}</Typography>}
      </Box>
    </KanapDialog>
  );
}
