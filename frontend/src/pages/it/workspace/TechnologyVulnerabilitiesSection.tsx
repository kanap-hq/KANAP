import { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useFeatures } from '../../../config/FeaturesContext';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import {
  SeverityCell,
  versionText,
  VulnerabilityStateCell,
  type VulnerabilityVersion,
} from '../vulnerabilities/vulnerabilityTypes';

/** One version and CVE of `GET /technologies/:id/vulnerabilities`: CVE fields and row fields. */
export type TechnologyVulnerabilityRow = VulnerabilityVersion & {
  cve_id: string;
  summary: string | null;
  cvss_score: number | null;
  severity: string | null;
};

type Props = {
  /** The technology's id (or `TEC-n`). */
  technologyId: string;
  /** `infrastructure:member`: may match the technology again. */
  canEdit: boolean;
};

/**
 * The vulnerabilities of a technology (lot T6b), for its Relations tab: one line per version and CVE,
 * most severe first, each opening the Vulnerabilities page on that CVE (filtered by the `TEC-n`
 * reference). The count is of distinct CVE. A member can match the technology again after a change
 * of its CPE identifiers, its versions or its links. Renders nothing while the vulnerability feed
 * is off (`features.vulnerabilityFeed`).
 */
export default function TechnologyVulnerabilitiesSection({ technologyId, canEdit }: Props) {
  const { t } = useTranslation('it');
  const { config } = useFeatures();
  const enabled = config.features.vulnerabilityFeed === true;
  const queryClient = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['vulnerabilities', 'technology', technologyId],
    queryFn: async () => (await api.get<{
      technology: { id: string; reference: string | null };
      products?: Array<{ product: string; status: 'collected' | 'pending' | 'failed' }>;
      items: TechnologyVulnerabilityRow[];
    }>(`/technologies/${technologyId}/vulnerabilities`)).data,
    enabled,
    // While the feed collects a new product of the technology, read again every 10 seconds.
    refetchInterval: (q) => ((q.state.data?.products ?? []).some((p) => p.status === 'pending') ? 10_000 : false),
  });
  const searching = (query.data?.products ?? []).some((p) => p.status === 'pending');
  const rows = query.data?.items ?? [];
  const cveCount = new Set(rows.map((row) => row.cve_id)).size;
  // The page's technology filter takes the reference: a raw id would show in it.
  const technologyRef = query.data?.technology?.reference ?? query.data?.technology?.id ?? technologyId;

  const rematch = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post<{ added: number; removed: number }>(`/technologies/${technologyId}/vulnerabilities/rematch`);
      setResult(t('pages.vulnerabilities.section.rematched', { added: res.data?.added ?? 0, removed: res.data?.removed ?? 0 }));
      await queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
    } catch {
      setResult(t('pages.vulnerabilities.section.rematchFailed'));
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<RelationsColumn<TechnologyVulnerabilityRow>> = [
    { key: 'cve', header: t('pages.vulnerabilities.columns.cve'), width: 150, render: (row) => <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12 }}>{row.cve_id}</Box> },
    { key: 'severity', header: t('pages.vulnerabilities.columns.severity'), width: 130, render: (row) => <SeverityCell severity={row.severity} score={row.cvss_score} /> },
    { key: 'version', header: t('pages.vulnerabilities.columns.version'), render: (row) => versionText(row, t) },
    { key: 'state', header: t('pages.vulnerabilities.columns.state'), width: 130, hideOrder: 1, render: (row) => <VulnerabilityStateCell state={row.state} /> },
  ];

  if (!enabled) return null;

  return (
    <RelationsSection title={t('pages.vulnerabilities.section.title')} count={query.data ? cveCount : undefined}>
      {canEdit && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, mb: 0.5 }}>
          {result && <Typography role="status" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{result}</Typography>}
          <Button variant="text" size="small" onClick={() => void rematch()} disabled={busy} sx={{ fontSize: 12, minWidth: 0, px: 1 }}>
            {t('pages.vulnerabilities.section.rematch')}
          </Button>
        </Box>
      )}
      {searching && <RelationsEmpty>{t('pages.vulnerabilities.section.searching')}</RelationsEmpty>}
      {query.data && rows.length === 0 && !searching && <RelationsEmpty>{t('pages.vulnerabilities.section.empty')}</RelationsEmpty>}
      {query.isError && <RelationsEmpty>{t('pages.vulnerabilities.section.loadFailed')}</RelationsEmpty>}
      {rows.length > 0 && (
        <RelationsTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          // The grid on this row: the technology, its version (`none`: not recorded) and the CVE.
          rowHref={(row) => `/it/vulnerabilities?technology=${encodeURIComponent(technologyRef)}&version=${encodeURIComponent(row.version_label ?? 'none')}&state=all&q=${encodeURIComponent(row.cve_id)}`}
          rowMuted={(row) => !row.matching}
          ariaLabel={t('pages.vulnerabilities.section.title')}
        />
      )}
    </RelationsSection>
  );
}
