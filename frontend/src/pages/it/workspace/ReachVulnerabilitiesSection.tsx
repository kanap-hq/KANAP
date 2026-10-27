import { Box, Link, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import ViaAssetNames from '../../../components/workspace/ViaAssetNames';
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
  /** Asset, indirect lines only: carried through the host that contains it only (its hypervisor), folded. */
  through_host?: boolean;
};

/** The answer of the vulnerabilities route of an asset or an application. */
export type ReachVulnerabilities = {
  /** Direct links, one line per technology and version with CVE that count. */
  rows: ReachVulnerabilityRow[];
  /** Asset only: carried by another asset (a host, a cluster). Not counted. */
  indirect?: ReachVulnerabilityRow[];
  /** Distinct CVE over the direct lines; null when the asset or application is out of service. */
  totals: { open: number; severe: number; exploited_severe: number } | null;
  /**
   * A cluster only: distinct CVE over its own direct links and those of its members in service,
   * `critical` among them; null when retired.
   */
  member_totals?: { open: number; severe: number; exploited_severe: number; critical?: number } | null;
  /**
   * True while a match is queued or running for a technology of this record that has CPE
   * identifiers, or while a linked product's first collection from the NVD has not finished.
   * The section then says the search is in progress instead of that nothing is to review.
   */
  pending?: boolean;
  /**
   * True when that collection failed and nothing is still running. The section then says the
   * search could not be completed. Absent means false.
   */
  search_failed?: boolean;
};

/** How often a record reads its vulnerabilities again while `pending` is true. */
export const REACH_VULNERABILITIES_POLL_MS = 1_000;

/** Refetch while the search is still pending, and stop once the answer is no longer pending. */
export function reachVulnerabilitiesRefetchMs(data: ReachVulnerabilities | undefined): number | false {
  return data?.pending ? REACH_VULNERABILITIES_POLL_MS : false;
}

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

/** The assets that carry an indirect line: `via_assets`, else the single `via`. */
const viaOf = (row: ReachVulnerabilityRow) => (row.via_assets && row.via_assets.length > 0 ? row.via_assets : row.via ? [row.via] : []);

const rowKey = (row: ReachVulnerabilityRow) => `${row.technology.id}:${row.version_id ?? 'none'}:${viaOf(row).map((asset) => asset.id).join('+')}`;

/**
 * The vulnerabilities of an asset or an application: one line per technology and version in a
 * direct link, with the CVE to review in one column per severity (None counted with Low), the total,
 * and "See", which opens the Vulnerabilities page on the subject and the technology. An application
 * names the servers that carry each line, or says it is only declared. An asset may list apart the
 * technologies its cluster's members carry: they are not counted. What only the host it runs on
 * carries (the platform underneath) waits under one folded line, not counted either.
 * Pure: the caller fetches the data, and hides the section while the vulnerability feed is off.
 * While `pending` is set and no line is ready, the empty line says the search is in progress.
 * The caller refetches on `reachVulnerabilitiesRefetchMs` until `pending` is no longer set.
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
    // Gives up its room before the version, like Servers: the indirect table fits 680px.
    // The least width holds the header in every language (Activo).
    minWidth: 72,
    wrap: true,
    render: (row) => <ViaAssetNames assets={viaOf(row)} />,
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
  // Beside the "Through" column the table is tight: a long name is cut by the ellipsis, whole on hover,
  // and the counts keep their fixed room.
  const indirectLeading = leading.map((column) => (column.key === 'technology'
    ? { ...column, wrap: false, render: (row: ReachVulnerabilityRow) => <span title={row.technology.name}>{row.technology.name}</span> }
    : column));
  const indirectColumns = [...indirectLeading, viaColumn, ...counts(indirectPageOf)];
  const carried = kind === 'asset' ? data.indirect ?? [] : [];
  const indirect = carried.filter((row) => !row.through_host);
  const platform = carried.filter((row) => row.through_host);
  // A search still running, and nothing to show yet: say so, instead of the empty line.
  // A failed collection says the search could not be completed, and only while that line would be empty.
  const showPending = data.pending === true && data.rows.length === 0 && indirect.length === 0;
  const showFailed = !showPending && data.search_failed === true && data.rows.length === 0 && indirect.length === 0;
  const platformFold = platform.length > 0
    ? { label: t('pages.vulnerabilities.reach.platform', { count: platform.length }), rows: platform }
    : undefined;
  const title = t('pages.vulnerabilities.section.title');
  // A cluster counts its members' vulnerabilities too (`member_totals`), as its column in the list does.
  const shownTotals = data.member_totals ?? data.totals;
  const open = shownTotals && shownTotals.open > 0 ? shownTotals.open : null;
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
    <RelationsSection id={REACH_VULNERABILITIES_ANCHOR} scrollMarginTop={16} title={title} heading={heading} count={count}>
      {data.rows.length === 0 ? (indirect.length === 0 && (
        <RelationsEmpty>
          {showPending
            ? <span role="status" data-testid="reach-vulnerabilities-pending">{t('pages.vulnerabilities.section.searching')}</span>
            : showFailed
              ? <span role="status" data-testid="reach-vulnerabilities-failed">{t('pages.vulnerabilities.section.searchFailed')}</span>
              : t(`pages.vulnerabilities.reach.empty.${kind}`)}
        </RelationsEmpty>
      )) : (
        <RelationsTable columns={directColumns} rows={data.rows} rowKey={rowKey} ariaLabel={title} />
      )}
      {/* What a cluster's members carry: counted with the cluster (`member_totals`). What a host carries folds as the platform. */}
      {indirect.length > 0 && (
        <Box data-testid="reach-indirect" sx={{ mt: 2 }}>
          <Typography component="h3" sx={{ m: 0, mb: 0.5, fontSize: 13, fontWeight: 500, color: 'kanap.text.secondary' }}>
            {t('pages.vulnerabilities.reach.indirect.title')}
          </Typography>
          <RelationsTable
            columns={indirectColumns}
            rows={indirect}
            rowKey={rowKey}
            folded={platformFold}
            ariaLabel={t('pages.vulnerabilities.reach.indirect.title')}
          />
        </Box>
      )}
      {indirect.length === 0 && platformFold && (
        <Box data-testid="reach-platform" sx={{ mt: 1 }}>
          <RelationsTable columns={indirectColumns} rows={[]} rowKey={rowKey} folded={platformFold} ariaLabel={platformFold.label} />
        </Box>
      )}
    </RelationsSection>
  );
}
