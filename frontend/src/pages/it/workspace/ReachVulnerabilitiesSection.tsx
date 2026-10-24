import { Box, Link, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import { versionText } from '../vulnerabilities/vulnerabilityTypes';
import { numberSx, openSeverityColumns, type VulnerabilityOpenCounts } from './vulnerabilityOpenColumns';

/** One technology and version of `GET /assets/:id/vulnerabilities` or `GET /applications/:id/vulnerabilities`. */
export type ReachVulnerabilityRow = {
  technology: { id: string; name: string; reference: string | null };
  version_id: string | null;
  /** The version's label; null without a version. */
  label: string | null;
  /** CVE to review that raise an alert, by severity. */
  open: VulnerabilityOpenCounts;
  /** Distinct CVE that count (to review, in the alerts). */
  total: number;
  /** Of which critical or high. */
  severe: number;
  /** Severe CVE known as exploited. */
  exploited_severe: number;
  /** Application: its servers in service that carry this technology and version directly. */
  servers?: Array<{ id: string; name: string }>;
  /** Application: it declares this technology and version. */
  declared?: boolean;
  /** Asset, indirect lines only: the asset that carries the technology (the first of `via_assets`). */
  via?: { id: string; name: string; reference: string | null };
  /** Asset, indirect lines only: every asset that carries the technology and version (a host, a cluster's members), by name. */
  via_assets?: Array<{ id: string; name: string; reference: string | null }>;
};

/** The answer of the vulnerabilities route of an asset or an application. */
export type ReachVulnerabilities = {
  /** Direct links, one line per technology and version with CVE that count. */
  rows: ReachVulnerabilityRow[];
  /** Asset only: carried by another asset (a host, a cluster). Not counted. */
  indirect?: ReachVulnerabilityRow[];
  /** Distinct CVE over the direct lines; null when the asset or application is out of service. */
  totals: { open: number; severe: number; exploited_severe: number } | null;
  /** A cluster only: distinct CVE over the direct links of its members in service; null when retired. */
  member_totals?: { open: number; severe: number; exploited_severe: number } | null;
};

/** The anchor of the section. */
export const REACH_VULNERABILITIES_ANCHOR = 'vulnerabilities';

/** A neutral table link: underline and teal on hover only. */
const seeLinkSx = { color: 'kanap.text.primary', fontSize: 13, '&:hover': { color: 'primary.main' } } as const;

type Props = {
  data: ReachVulnerabilities;
  kind: 'asset' | 'application';
  /** The asset (`AST-n`) or application (`APP-n`) reference, for the links to the Vulnerabilities page. */
  subjectReference: string;
  /** The page's own section title, in place of the default one. */
  heading?: React.ReactNode;
  /**
   * Application: records a declared technology on a server (the flow of the Technologies section).
   * Without it, a declared line shows "Declared" alone.
   */
  onRecordOnServer?: (row: ReachVulnerabilityRow, anchor: HTMLElement) => void;
};

/** Wraps on the spaces only: a word is never cut in two. */
const wordWrapSx = { overflowWrap: 'normal', wordBreak: 'normal' } as const;

const rowKey = (row: ReachVulnerabilityRow) => `${row.technology.id}:${row.version_id ?? 'none'}:${row.via?.id ?? ''}`;

/**
 * The vulnerabilities of an asset or an application: one line per technology and version in a
 * direct link, with the CVE to review in one column per severity (None counted with Low), the total,
 * and "See", which opens the Vulnerabilities page on the subject and the technology. An application
 * names the servers that carry each line, or says it is only declared. An asset may list apart the
 * technologies another asset carries (a host, a cluster): they are not counted.
 * Pure: the caller fetches the data, and hides the section while the vulnerability feed is off.
 */
export default function ReachVulnerabilitiesSection({ data, kind, subjectReference, heading, onRecordOnServer }: Props) {
  const { t } = useTranslation('it');
  const mode = useTheme().palette.mode;
  const subjectParam = `${kind}=${encodeURIComponent(subjectReference)}`;
  const technologyParam = (row: ReachVulnerabilityRow) => `technology=${encodeURIComponent(row.technology.reference ?? row.technology.id)}`;
  const pageOf = (row: ReachVulnerabilityRow) => `/it/vulnerabilities?${subjectParam}&${technologyParam(row)}`;
  // An indirect line counts on the asset that carries it: the page opens there.
  const indirectPageOf = (row: ReachVulnerabilityRow) => (row.via
    ? `/it/vulnerabilities?asset=${encodeURIComponent(row.via.reference ?? row.via.id)}&${technologyParam(row)}`
    : `/it/vulnerabilities?${technologyParam(row)}`);

  const leading: Array<RelationsColumn<ReachVulnerabilityRow>> = [
    { key: 'technology', header: t('pages.vulnerabilities.columns.technology'), wrap: true, render: (row) => row.technology.name },
    {
      key: 'version',
      header: t('pages.vulnerabilities.columns.version'),
      // Holds the longest word of "Version not recorded (potentially concerned)" in every language
      // ("(möglicherweise": 102px in 13px) with the cell padding.
      width: 120,
      minWidth: 111,
      wrap: true,
      render: (row) => <Box component="span" sx={wordWrapSx}>{versionText({ version_label: row.label }, t)}</Box>,
    },
  ];

  const serversColumn: RelationsColumn<ReachVulnerabilityRow> = {
    key: 'servers',
    header: t('pages.vulnerabilities.columns.servers'),
    width: 150,
    // Gives up its room before the version: the table still fits a record with its panel open.
    // The least width holds the header in every language (Servidores: 62px).
    minWidth: 72,
    wrap: true,
    render: (row) => {
      const servers = row.servers ?? [];
      if (servers.length > 0) return servers.map((server) => server.name).join(', ');
      if (!row.declared) return null;
      return (
        // "Record on a server" goes on its own line, under "Declared".
        <Box component="span" data-declared="" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
          <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{t('workspace.application.relations.technologyLink.declared')}</Box>
          {onRecordOnServer && (
            <Link
              component="button"
              type="button"
              underline="hover"
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); onRecordOnServer(row, event.currentTarget); }}
              sx={{ fontSize: 12, textAlign: 'left' }}
            >
              {t('workspace.application.relations.technologyServers.action')}
            </Link>
          )}
        </Box>
      );
    },
  };

  const viaColumn: RelationsColumn<ReachVulnerabilityRow> = {
    key: 'via',
    header: t('pages.vulnerabilities.reach.via'),
    width: 150,
    minWidth: 80,
    wrap: true,
    render: (row) => (row.via ? t('pages.vulnerabilities.detail.via', { name: row.via.name }) : null),
  };

  const counts = (see: (row: ReachVulnerabilityRow) => string): Array<RelationsColumn<ReachVulnerabilityRow>> => [
    ...openSeverityColumns<ReachVulnerabilityRow>(
      (row) => row.open,
      t,
      mode,
      (severity) => t('pages.vulnerabilities.reach.openHint', { severity }),
      // The table shares the width of the record with its properties panel: abbreviated headers.
      { compact: true },
    ),
    {
      key: 'total',
      header: t('pages.vulnerabilities.section.columns.total'),
      // Gesamt (44px) with the cell padding.
      width: 54,
      align: 'right',
      render: (row) => <Box component="span" sx={{ ...numberSx, fontWeight: 500 }}>{row.total}</Box>,
    },
    {
      key: 'see',
      header: '',
      // Ansehen (54px) with the cell padding.
      width: 62,
      align: 'right',
      render: (row) => (
        <Link component={RouterLink} to={see(row)} underline="hover" onClick={(event) => event.stopPropagation()} sx={seeLinkSx}>
          {t('pages.vulnerabilities.section.see')}
        </Link>
      ),
    },
  ];

  const directColumns = [...leading, ...(kind === 'application' ? [serversColumn] : []), ...counts(pageOf)];
  const indirectColumns = [...leading, viaColumn, ...counts(indirectPageOf)];
  const indirect = kind === 'asset' ? data.indirect ?? [] : [];
  const title = t('pages.vulnerabilities.section.title');
  const open = data.totals && data.totals.open > 0 ? data.totals.open : null;
  // The count after the title opens the Vulnerabilities page filtered on the record.
  const count = open == null ? undefined : (
    <Link
      component={RouterLink}
      to={`/it/vulnerabilities?${subjectParam}`}
      underline="hover"
      aria-label={t('pages.vulnerabilities.reach.countLink', { count: open })}
      data-testid="reach-vulnerabilities-count"
      sx={{ color: 'inherit', fontVariantNumeric: 'tabular-nums', '&:hover': { color: 'primary.main' } }}
    >
      {open}
    </Link>
  );

  return (
    <Box id={REACH_VULNERABILITIES_ANCHOR} sx={{ scrollMarginTop: 16 }}>
      <RelationsSection title={title} heading={heading} count={count}>
        {data.rows.length === 0 ? (
          <RelationsEmpty>{t(`pages.vulnerabilities.reach.empty.${kind}`)}</RelationsEmpty>
        ) : (
          <RelationsTable columns={directColumns} rows={data.rows} rowKey={rowKey} ariaLabel={title} />
        )}
        {indirect.length > 0 && (
          <Box data-testid="reach-indirect" sx={{ mt: 2 }}>
            <Typography component="h3" sx={{ m: 0, fontSize: 13, fontWeight: 500, color: 'kanap.text.secondary' }}>
              {t('pages.vulnerabilities.reach.indirect.title')}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mb: 0.5 }}>
              {t('pages.vulnerabilities.reach.indirect.hint')}
            </Typography>
            <RelationsTable
              columns={indirectColumns}
              rows={indirect}
              rowKey={rowKey}
              ariaLabel={t('pages.vulnerabilities.reach.indirect.title')}
            />
          </Box>
        )}
      </RelationsSection>
    </Box>
  );
}
