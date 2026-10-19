import { Box, useTheme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import type { IncidentRow } from '../../../api/endpoints/incidents';
import { StatusDot } from '../../../components/design';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import { formatShortDate } from '../../../lib/dateFormat';
import { buildItemPath, formatItemRef } from '../../../utils/item-ref';
import { getDotColor, INCIDENT_SEVERITY_COLORS } from '../../../utils/statusColors';

type Props = {
  assetId?: string;
  applicationId?: string;
};

/**
 * Read-only "Incidents" section for the Asset / Application relations tabs.
 * Linking is done from the incident side only; this section just surfaces them.
 * The route applies the incidents' confidentiality.
 */
export default function IncidentRelationsSection({ assetId, applicationId }: Props) {
  const { t, i18n } = useTranslation('it');
  const theme = useTheme();
  const params = assetId ? { asset_id: assetId } : { application_id: applicationId };

  const { data: items = [], isError, isSuccess } = useQuery({
    queryKey: ['incidents', 'linked', assetId || applicationId],
    queryFn: async () => {
      const res = await api.get<{ items: IncidentRow[] }>('/incidents', {
        params: { ...params, limit: 20, sort: 'detected_at:DESC' },
      });
      return res.data.items || [];
    },
    enabled: !!(assetId || applicationId),
  });

  const columns: Array<RelationsColumn<IncidentRow>> = [
    { key: 'ref', header: t('components.incidentRelations.columns.reference'), width: 72, render: (row) => <RelationRef>{formatItemRef('incident', row.item_number)}</RelationRef> },
    { key: 'title', header: t('components.incidentRelations.columns.title'), render: (row) => row.title },
    {
      key: 'severity', header: t('components.incidentRelations.columns.severity'), width: 100, hideOrder: 2,
      render: (row) => (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <StatusDot color={getDotColor(INCIDENT_SEVERITY_COLORS[row.severity] || 'default', theme.palette.mode)} />
          {t(`enums.incidentSeverity.${row.severity}`, { defaultValue: row.severity })}
        </Box>
      ),
    },
    { key: 'status', header: t('components.incidentRelations.columns.status'), width: 100, render: (row) => t(`enums.incidentStatus.${row.status}`, { defaultValue: row.status }) },
    { key: 'detected', header: t('components.incidentRelations.columns.detected'), width: 110, hideOrder: 1, render: (row) => formatShortDate(row.detected_at, i18n.language) },
  ];

  return (
    <RelationsSection title={t('components.incidentRelations.title')} count={isSuccess ? items.length : undefined}>
      {isError ? (
        <RelationsEmpty>{t('components.incidentRelations.loadFailed')}</RelationsEmpty>
      ) : items.length === 0 ? (
        <RelationsEmpty>{t('components.incidentRelations.empty')}</RelationsEmpty>
      ) : (
        <RelationsTable
          ariaLabel={t('components.incidentRelations.title')}
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          rowHref={(row) => `${buildItemPath('incident', formatItemRef('incident', row.item_number))}/overview`}
        />
      )}
    </RelationsSection>
  );
}
