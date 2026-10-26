import { useState } from 'react';
import { Box, Button, Link, Tooltip, Typography, useTheme } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import api from '../../../api';
import { useFeatures } from '../../../config/FeaturesContext';
import { RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import { SEVERITIES, SeverityCell, versionText } from '../vulnerabilities/vulnerabilityTypes';
import { TECHNOLOGY_VERSIONS_ANCHOR } from './TechnologyOverviewTab';
import { numberSx, openSeverityColumns, type VulnerabilityOpenCounts } from './vulnerabilityOpenColumns';

export type { VulnerabilityOpenCounts };

/** The order of the open counts: the severities, then the CVE not rated yet ("Not rated", as on the Vulnerabilities page). */
const OPEN_KEYS = [...SEVERITIES, 'unknown'] as const;

/** One version of `GET /technologies/:id/vulnerabilities/summary`. */
export type TechnologyVulnerabilityVersion = {
  version_id: string | null;
  label: string | null;
  /** Effective setting: the version's own, or the technology's when it has none. */
  alerts: boolean;
  /** In use: on a server in service, or declared by an application in service. */
  installed: boolean;
  /** Servers in service that carry this version. 0 when the version is not installed. */
  servers: number;
  open: VulnerabilityOpenCounts;
  /** Distinct CVE of this version, every state. */
  total: number;
};

type VulnerabilitySectionData = {
  technology: { id: string; name?: string; reference: string | null };
  technology_alerts?: boolean;
  versions_excluded?: number;
  versions_included?: number;
  /** True while a CPE product of the technology has never been collected. */
  collecting?: boolean;
  products?: Array<{ product: string; status: 'collected' | 'pending' | 'failed' }>;
  /** Distinct CVE of the technology, across versions. */
  cves?: number;
  versions: TechnologyVulnerabilityVersion[];
};

/** The one quiet line when the technology or some of its versions stay out of the alerts. */
function alertsBanner(data: VulnerabilitySectionData | undefined, t: TFunction): string | null {
  if (!data) return null;
  const includedVersions = data.versions_included ?? 0;
  const excludedVersions = data.versions_excluded ?? 0;
  if (data.technology_alerts === false && includedVersions === 0) return t('pages.vulnerabilities.section.alerts.excluded');
  if (data.technology_alerts === false && includedVersions > 0) return t('pages.vulnerabilities.section.alerts.excludedExcept', { count: includedVersions });
  if (data.technology_alerts !== false && excludedVersions > 0) return t('pages.vulnerabilities.section.alerts.versionsExcluded', { count: excludedVersions });
  return null;
}

/** A neutral table link: underline and teal on hover only. */
const seeLinkSx = { color: 'kanap.text.primary', fontSize: 13, '&:hover': { color: 'primary.main' } } as const;

type Props = {
  /** The technology's id (or `TEC-n`). */
  technologyId: string;
  /** `infrastructure:member`: may match the technology again. */
  canEdit: boolean;
};

/**
 * The vulnerabilities of a technology, for its Compliance tab: one line per version in use, with
 * its servers, the CVE still to review in one column per severity, and the total. The versions not
 * in use are named in one line under the table. "See" opens the Vulnerabilities page on an installed version that has a
 * CVE: on its CVE to review when it has some, on every state otherwise. The count next to the title
 * is of distinct CVE, every state; "See everything" opens every state too. A member can match the
 * technology again.
 * Renders nothing while the vulnerability feed is off (`features.vulnerabilityFeed`).
 */
export default function TechnologyVulnerabilitiesSection({ technologyId, canEdit }: Props) {
  const { t } = useTranslation('it');
  const mode = useTheme().palette.mode;
  const location = useLocation();
  const { config } = useFeatures();
  const enabled = config.features.vulnerabilityFeed === true;
  const queryClient = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['vulnerabilities', 'technology', technologyId, 'summary'],
    queryFn: async () => (await api.get<VulnerabilitySectionData>(`/technologies/${technologyId}/vulnerabilities/summary`)).data,
    enabled,
    // While the feed collects a new product of the technology, read again every 10 seconds.
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      return data.collecting || (data.products ?? []).some((product) => product.status === 'pending') ? 10_000 : false;
    },
  });
  const data = query.data;
  const searching = Boolean(data?.collecting) || (data?.products ?? []).some((product) => product.status === 'pending');
  const versions = data?.versions ?? [];
  // A product whose last collection failed, and no version to show: the empty line would say nothing is known.
  const searchFailed = !searching && versions.length === 0 && (data?.products ?? []).some((product) => product.status === 'failed');
  // Only the versions in use get a line; the others are named once, under the table.
  const installed = versions.filter((row) => row.installed);
  const notInstalled = versions.filter((row) => !row.installed);
  // The page's technology filter takes the reference: a raw id would show in it.
  const technologyRef = data?.technology?.reference ?? data?.technology?.id ?? technologyId;
  const banner = alertsBanner(data, t);
  // The address keeps the list context of the workspace (its search), as its other links do.
  const settingsHref = `/it/technologies/${encodeURIComponent(technologyRef)}/overview${location.search}#${TECHNOLOGY_VERSIONS_ANCHOR}`;
  const pageBase = `/it/vulnerabilities?technology=${encodeURIComponent(technologyRef)}`;
  // The page opens on "To review" by default; `state=all` shows every state, as the title count and Total do.
  // A version with CVE still to review opens on them, one whose CVE are all reviewed on every state.
  const pageOf = (row: TechnologyVulnerabilityVersion) => {
    const toReview = OPEN_KEYS.some((key) => (row.open[key] ?? 0) > 0);
    return `${pageBase}&version=${encodeURIComponent(row.label ?? 'none')}&alerts=all${toReview ? '' : '&state=all'}`;
  };

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

  const columns: Array<RelationsColumn<TechnologyVulnerabilityVersion>> = [
    {
      key: 'version',
      header: t('pages.vulnerabilities.columns.version'),
      // The first column without a width is the one the table fades when the version is excluded.
      render: (row) => (
        <>
          {versionText({ version_label: row.label }, t)}
          {row.alerts === false && (
            <Box component="span" data-muted-reason="" sx={{ ml: 1, fontSize: 11, color: 'kanap.text.tertiary' }}>
              {t('pages.vulnerabilities.section.alerts.excluded')}
            </Box>
          )}
        </>
      ),
    },
    {
      key: 'servers',
      header: t('pages.vulnerabilities.columns.servers'),
      width: 64,
      align: 'right',
      render: (row) => <Box component="span" sx={numberSx}>{row.servers}</Box>,
    },
    // The CVE still to review, by severity: the header's hint says so, apart from Total.
    ...openSeverityColumns<TechnologyVulnerabilityVersion>(
      (row) => row.open,
      t,
      mode,
      (severity) => t('pages.vulnerabilities.section.columns.openHint', { severity }),
    ),
    {
      key: 'total',
      header: t('pages.vulnerabilities.section.columns.total'),
      width: 56,
      align: 'right',
      render: (row) => <Box component="span" sx={{ ...numberSx, fontWeight: 500 }}>{row.total}</Box>,
    },
    {
      key: 'see',
      header: '',
      width: 48,
      align: 'right',
      render: (row) => row.total > 0 ? (
        <Link
          component={RouterLink}
          to={pageOf(row)}
          underline="hover"
          onClick={(event) => event.stopPropagation()}
          sx={seeLinkSx}
        >
          {t('pages.vulnerabilities.section.see')}
        </Link>
      ) : null,
    },
  ];

  if (!enabled) return null;

  return (
    <RelationsSection
      title={t('pages.vulnerabilities.section.title')}
      count={data ? data.cves ?? 0 : undefined}
      actions={canEdit ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          {result && <Typography role="status" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{result}</Typography>}
          <Button variant="text" size="small" onClick={() => void rematch()} disabled={busy} sx={{ fontSize: 12, minWidth: 0, px: 1 }}>
            {t('pages.vulnerabilities.section.rematch')}
          </Button>
        </Box>
      ) : undefined}
    >
      {banner && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary', py: 0.5 }}>
          <Box component="span">{banner}</Box>
          {canEdit && (
            <>
              {' '}
              <Link component={RouterLink} to={settingsHref} underline="hover">
                {t('pages.vulnerabilities.section.alerts.set')}
              </Link>
            </>
          )}
        </Typography>
      )}
      {searching && <RelationsEmpty><span role="status">{t('pages.vulnerabilities.section.searching')}</span></RelationsEmpty>}
      {data && versions.length === 0 && !searching && (
        <RelationsEmpty>
          {searchFailed
            ? <span role="status" data-testid="technology-vulnerabilities-failed">{t('pages.vulnerabilities.section.searchFailed')}</span>
            : t('pages.vulnerabilities.section.empty')}
        </RelationsEmpty>
      )}
      {query.isError && <RelationsEmpty>{t('pages.vulnerabilities.section.loadFailed')}</RelationsEmpty>}
      {versions.length > 0 && (
        <>
          {installed.length > 0 && (
            <RelationsTable
              columns={columns}
              rows={installed}
              rowKey={(row) => row.version_id ?? 'none'}
              rowMuted={(row) => row.alerts === false}
              ariaLabel={t('pages.vulnerabilities.section.title')}
            />
          )}
          {notInstalled.length > 0 && (
            <Tooltip title={t('pages.vulnerabilities.section.notInstalledHint')} placement="bottom-start">
              <Typography data-testid="vulnerabilities-not-installed" sx={{ fontSize: 13, color: 'kanap.text.secondary', mt: 1, width: 'fit-content', maxWidth: '100%' }}>
                {t('pages.vulnerabilities.section.notInstalledList', {
                  count: notInstalled.length,
                  versions: notInstalled.map((row) => versionText({ version_label: row.label }, t)).join(', '),
                })}
              </Typography>
            </Tooltip>
          )}
          <Box sx={{ mt: 1 }}>
            <Link component={RouterLink} to={`${pageBase}&alerts=all&state=all`} underline="hover" sx={{ fontSize: 13 }}>
              {t('pages.vulnerabilities.section.seeAll')}
            </Link>
          </Box>
        </>
      )}
    </RelationsSection>
  );
}
