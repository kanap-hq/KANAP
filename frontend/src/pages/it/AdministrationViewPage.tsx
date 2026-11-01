import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Link as MLink, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { CellStyle, ICellRendererParams } from 'ag-grid-community';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import ChipToggleBar from '../../components/ChipToggleBar';
import PageHeader from '../../components/PageHeader';
import { useNotify } from '../../components/notify/NotifyProvider';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { reportFilterMenuProps } from '../../components/reports/ReportLayout';
import ServerDataGrid, { type EnhancedColDef, type ListRequest } from '../../components/ServerDataGrid';
import { KanapDialog, PropertyRow, StatusDot } from '../../components/design';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../components/workspace/RelationsTable';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { getWithListContext } from '../../lib/listContext';
import { getDotColor } from '../../utils/statusColors';
import WorkspaceTabs from '../portfolio/workspace/WorkspaceTabs';
import type { DomainTrustDirection } from '../../services/itOpsSettings';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import ExportFormatButton from '../../components/csv/ExportFormatButton';
import type { ExportFormat } from '../../components/csv/exportFormat';

const ENDPOINT = '/technologies/reports/administration';
const ASSETS_ENDPOINT = `${ENDPOINT}/assets`;
/** The tab of the address (`?tab=directories`); the assets without one. */
const DIRECTORIES_TAB = 'directories';

/** The five control points, in the order the server counts them. */
export const CONTROL_KEYS = [
  'assets_without_zone',
  'domain_controllers_outside',
  'directory_assets_outside',
  'trust_raised',
  'applications_on_most_sensitive',
] as const;
export type ControlKey = (typeof CONTROL_KEYS)[number];

/** Each control's locale key (`pages.administrationView.controlsList.<key>`). */
export const CONTROL_LOCALE: Record<ControlKey, string> = {
  assets_without_zone: 'assetsWithoutZone',
  domain_controllers_outside: 'domainControllers',
  directory_assets_outside: 'directoryAssets',
  trust_raised: 'trustRaised',
  applications_on_most_sensitive: 'applications',
};

/** A zone of the catalog, or a code the catalog no longer has (`unknown`). */
export type AdministrationZone = {
  code: string;
  label: string | null;
  description: string | null;
  admin_group: string | null;
  deprecated: boolean;
  unknown: boolean;
  asset_counts: Array<{ kind: string; count: number }>;
  hosted_application_count: number;
  directory_services: Array<{ id: string; reference: string | null; name: string }>;
};

/** `GET /technologies/reports/administration`. A control's `count` is null when it does not apply. */
export type AdministrationSummary = {
  most_sensitive: string | null;
  zones: AdministrationZone[];
  without_zone: { asset_count: number };
  controls: Array<{ key: ControlKey; count: number | null }>;
};

/** An asset whose trust a `trust_raised` row depends on: what it runs (`contains`) or its cluster. */
export type TrustPeer = { relation: 'contains' | 'cluster'; reference: string | null; name: string; zone: string | null };

/** A row of `GET /technologies/reports/administration/assets`: one asset that is not retired. */
export type AdministrationAssetRow = {
  id: string;
  reference: string | null;
  name: string;
  kind: string;
  zone: string | null;
  technologies: { total: number; items: Array<{ reference: string | null; name: string; version: string | null }> };
  applications: { total: number; items: Array<{ reference: string | null; name: string }> };
  findings: ControlKey[];
  trust_peers: { total: number; items: TrustPeer[] };
  application_references: { total: number; items: string[] };
};

export type AdministrationDomain = {
  code: string;
  label: string;
  dns_suffix: string;
  forest: string | null;
  trusts: Array<{ domain: string; label: string; direction: DomainTrustDirection }>;
  /** Trusts declared on other domains toward this one, read only, seen from this domain. */
  declared_by: Array<{ domain: string; label: string; direction: DomainTrustDirection }>;
  account_count: number | null;
  machine_count: number | null;
  domain_controllers: Array<{ id: string; name: string; reference: string | null }>;
  deprecated: boolean;
};

/** `GET /technologies/reports/administration/directories`. */
export type AdministrationDirectories = {
  services: Array<{ id: string; reference: string | null; name: string; zone: string | null; servers: number }>;
  forests: Array<{ forest: string | null; domains: AdministrationDomain[] }>;
};

/** The directory services and the domains: the tab draws them, the page counts them. */
function useDirectories() {
  return useQuery({
    queryKey: ['technologies', 'reports', 'administration', 'directories'],
    queryFn: async () => (await api.get<AdministrationDirectories>(`${ENDPOINT}/directories`)).data,
  });
}

/** The value of the "No zone" choice of the assignment (the server takes `null`). */
const NO_ZONE = '__none__';

/** A catalog value's name in the user's language (tenant translation, then the stored name). */
function useZoneName() {
  const { t } = useTranslation(['it', 'common']);
  const { byField } = useItOpsEnumOptions();
  return React.useCallback((code: string | null, zones: AdministrationZone[]) => {
    if (!code) return t('pages.administrationView.noZone');
    const zone = zones.find((item) => item.code === code);
    if (!zone || zone.unknown) return t('pages.administrationView.unknownZone', { code });
    const name = (byField.adminZone || []).find((option) => option.code === code)?.label || zone.label || code;
    return zone.deprecated ? `${name} (${t('common:enumEditor.retiredSuffix')})` : name;
  }, [byField, t]);
}

/** A zone name read from a shared address: the same text, whatever its no-break spacing. */
function zoneNameKey(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A neutral link (a record of another page): underline and teal on hover only. */
function RecordLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Box
      component={RouterLink}
      to={to}
      onClick={(event: React.MouseEvent) => event.stopPropagation()}
      sx={{ color: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline', color: 'primary.main' } }}
    >
      {children}
    </Box>
  );
}

const quietSx = { color: 'kanap.text.tertiary' } as const;
const cellLinkSx = { color: 'kanap.text.primary', fontSize: 13, '&:hover': { color: 'primary.main' } } as const;

/** The list's search and filters, without paging or sort: what a change of every row of the filter sends. */
function listScope(request: ListRequest | null): { q?: unknown; filters?: unknown } {
  const params = (request?.params ?? {}) as Record<string, unknown>;
  return {
    ...(params.q !== undefined && params.q !== '' ? { q: params.q } : {}),
    ...(params.filters !== undefined ? { filters: params.filters } : {}),
  };
}

/** The list's parameters without paging: the export follows the rows on screen, in their order. */
function exportParams(request: ListRequest | null): Record<string, unknown> {
  const { page: _page, limit: _limit, ...rest } = (request?.params ?? {}) as Record<string, unknown>;
  return rest;
}

/** A set filter of one value, as the grid reads it; `undefined` when the column has none or several. */
function singleSetValue(model: Record<string, any> | null | undefined, column: string): string | null | undefined {
  const entry = model?.[column];
  if (!entry || entry.filterType !== 'set' || !Array.isArray(entry.values) || entry.values.length !== 1) return undefined;
  return entry.values[0] ?? null;
}

/**
 * The rows chosen for an assignment: the ticked rows (`all` false, `ids` the ticked ones), or every
 * row of the current filter, loaded or not (`all` true, `ids` the rows unticked since).
 */
type Selection = { all: boolean; ids: Set<string> };
const NO_SELECTION: Selection = { all: false, ids: new Set() };
type SelectionApi = { selection: Selection; count: number; toggleRow: (id: string) => void; toggleAll: () => void };
/** Read by the selection column's cells and header, which the grid renders inside the page. */
const SelectionContext = createContext<SelectionApi | null>(null);
/** The zones of the summary, for the zone cells and the trust tooltips. */
const ZoneNameContext = createContext<(code: string | null) => string>((code) => code ?? '');
const isSelected = (selection: Selection, id: string) => (selection.all ? !selection.ids.has(id) : selection.ids.has(id));
const checkboxSx = { p: 0.25 } as const;
const SELECTION_COLUMN = 'select';
/** The box alone, centred: the cell's padding would push it past 44 px and cut it. */
const SELECT_CELL_STYLE: CellStyle = { padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textOverflow: 'clip' };
/** Stable: a new function would have AG Grid draw its rows again. */
const rowId = (row: AdministrationAssetRow) => row.id;
/** Names shown in a cell before "+n". */
const NAMES_SHOWN = 2;

function SelectRowCell({ data }: ICellRendererParams<AdministrationAssetRow>) {
  const { t } = useTranslation('it');
  const selection = useContext(SelectionContext);
  if (!data || !selection) return null;
  return (
    <Checkbox
      size="small"
      sx={checkboxSx}
      checked={isSelected(selection.selection, data.id)}
      onChange={() => selection.toggleRow(data.id)}
      inputProps={{ 'aria-label': t('pages.administrationView.selection.row', { name: data.reference ? `${data.reference} ${data.name}` : data.name }) }}
    />
  );
}

function SelectAllHeader() {
  const { t } = useTranslation('it');
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  const whole = selection.selection.all && selection.selection.ids.size === 0;
  return (
    <Checkbox
      size="small"
      sx={checkboxSx}
      checked={whole}
      indeterminate={!whole && selection.count > 0}
      onChange={selection.toggleAll}
      inputProps={{ 'aria-label': t('pages.administrationView.selection.all') }}
    />
  );
}

/** The asset opens on its business reference. The id is only a fallback when the reference is missing. */
function assetHref(row: { id: string; reference?: string | null }): string {
  const reference = row.reference?.trim();
  return `/it/assets/${reference || row.id}`;
}

function ReferenceCell({ data }: ICellRendererParams<AdministrationAssetRow>) {
  if (!data) return null;
  return (
    <MLink component={RouterLink} to={assetHref(data)} underline="hover" onClick={(event: React.MouseEvent) => event.stopPropagation()} sx={cellLinkSx}>
      <RelationRef>{data.reference ?? data.name}</RelationRef>
    </MLink>
  );
}

function ZoneCell({ data }: ICellRendererParams<AdministrationAssetRow>) {
  const zoneName = useContext(ZoneNameContext);
  if (!data) return null;
  return data.zone ? <>{zoneName(data.zone)}</> : <Box component="span" sx={quietSx}>{zoneName(null)}</Box>;
}

/** The first names, "+n" for the rest; the tooltip lists every name the row carries. */
function NamesCell({ names, total, tooltip, render }: {
  names: string[];
  total: number;
  tooltip: string[];
  render?: (index: number) => React.ReactNode;
}) {
  const { t } = useTranslation('it');
  if (total === 0) return null;
  const shown = names.slice(0, NAMES_SHOWN);
  const rest = total - shown.length;
  const lines = total > tooltip.length ? [...tooltip, t('pages.administrationView.moreItems', { count: total - tooltip.length })] : tooltip;
  return (
    <Tooltip title={<>{lines.map((line, index) => <Box key={index}>{line}</Box>)}</>}>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {shown.map((name, index) => (
          <React.Fragment key={index}>
            {index > 0 && ', '}
            {render ? render(index) : name}
          </React.Fragment>
        ))}
        {rest > 0 && <Box component="span" sx={{ ...quietSx, ml: 0.5 }}>{t('pages.administrationView.more', { count: rest })}</Box>}
      </Box>
    </Tooltip>
  );
}

function TechnologiesCell({ data }: ICellRendererParams<AdministrationAssetRow>) {
  if (!data) return null;
  const { items, total } = data.technologies;
  return (
    <NamesCell
      names={items.map((item) => item.name)}
      total={total}
      tooltip={items.map((item) => [item.reference, item.name, item.version].filter(Boolean).join(' '))}
    />
  );
}

function ApplicationsCell({ data }: ICellRendererParams<AdministrationAssetRow>) {
  if (!data) return null;
  const { items, total } = data.applications;
  return (
    <NamesCell
      names={items.map((item) => item.name)}
      total={total}
      tooltip={items.map((item) => [item.reference, item.name].filter(Boolean).join(' '))}
      render={(index) => {
        const app = items[index];
        if (!app.reference) return app.name;
        return (
          <MLink component={RouterLink} to={`/it/applications/${app.reference}`} underline="hover" onClick={(event: React.MouseEvent) => event.stopPropagation()} sx={cellLinkSx}>
            {app.name}
          </MLink>
        );
      }}
    />
  );
}

/** What a control's tooltip says: the trust finding names the assets and their zones, the others their title. */
function controlTooltip(key: ControlKey, data: AdministrationAssetRow, t: (key: string, options?: Record<string, unknown>) => string, zoneName: (zone: string | null) => string) {
  const peers = key === 'trust_raised' ? data.trust_peers : null;
  if (peers && peers.items.length) {
    return (
      <>
        {peers.items.map((peer, index) => (
          <Box key={index}>
            {t(`pages.administrationView.trustPeer.${peer.relation}`, { asset: peer.reference ? `${peer.reference} ${peer.name}` : peer.name, zone: zoneName(peer.zone) })}
          </Box>
        ))}
        {peers.total > peers.items.length && <Box>{t('pages.administrationView.moreItems', { count: peers.total - peers.items.length })}</Box>}
      </>
    );
  }
  return t(`pages.administrationView.controlsList.${CONTROL_LOCALE[key]}.title`);
}

/**
 * The controls an asset raises. One control is a dot and its short name, on the compact row.
 * Several would overflow that row, so the cell counts them and the tooltip names each one.
 */
function ControlsCell({ data }: ICellRendererParams<AdministrationAssetRow>) {
  const { t } = useTranslation('it');
  const theme = useTheme();
  const zoneName = useContext(ZoneNameContext);
  if (!data || !data.findings.length) return null;
  const color = getDotColor('warning', theme.palette.mode);
  if (data.findings.length === 1) {
    const key = data.findings[0];
    return (
      <Tooltip title={controlTooltip(key, data, t, zoneName)}>
        <Box component="span" data-findings="controls" data-finding={key} sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '100%', minWidth: 0 }}>
          <StatusDot color={color} />
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t(`pages.administrationView.controlsList.${CONTROL_LOCALE[key]}.short`)}
          </Box>
        </Box>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={(
      <>
        {data.findings.map((key) => (
          <Box key={key}>
            <Box>{t(`pages.administrationView.controlsList.${CONTROL_LOCALE[key]}.short`)}</Box>
            {controlTooltip(key, data, t, zoneName)}
          </Box>
        ))}
      </>
    )}>
      <Box component="span" data-findings="controls" data-finding-count={data.findings.length} sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '100%' }}>
        <StatusDot color={color} />
        {t('pages.administrationView.controlsCount', { count: data.findings.length })}
      </Box>
    </Tooltip>
  );
}

/**
 * Assigns a zone (one that is not deprecated, or none) to the ticked assets, or to every asset of
 * the current filter but the unticked ones; the count comes from a dry run before the change.
 */
function AssignZoneDialog({ open, onClose, selection, request, zones, onDone }: {
  open: boolean;
  onClose: () => void;
  selection: Selection;
  request: ListRequest | null;
  zones: Array<{ code: string; name: string }>;
  onDone: (changed: number) => void;
}) {
  const { t } = useTranslation('it');
  // Each opening starts without a zone: nothing is counted or assigned before an explicit choice.
  const [zone, setZone] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) return;
    setZone('');
    setError(null);
  }, [open]);
  const chosen = zone !== '';
  const ids = useMemo(() => Array.from(selection.ids), [selection.ids]);
  const scope = useMemo(() => ({
    zone: zone === NO_ZONE ? null : zone,
    ...(selection.all
      ? { all: true, filters: listScope(request), ...(ids.length > 0 ? { exclude_ids: ids } : {}) }
      : { ids }),
  }), [ids, request, selection.all, zone]);
  const count = useQuery({
    queryKey: ['technologies', 'reports', 'administration', 'assign-count', scope],
    queryFn: async () => (await api.post<{ rows: number; changes: number; as_of: string }>(`${ASSETS_ENDPOINT}/zone`, { ...scope, dry_run: true })).data,
    enabled: open && chosen,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const countError = count.error as any;
  const tooMany = count.isError && countError?.response?.data?.code === 'bulk_too_many';
  const refused = count.isError && !tooMany && countError?.response?.status === 400
    ? getApiErrorMessage(countError, t, t('pages.administrationView.bulk.countFailed'))
    : null;
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only the assets of the count: one created after it is left out, and more than counted is refused (409).
      const res = await api.post<{ rows: number; changed: number }>(`${ASSETS_ENDPOINT}/zone`, { ...scope, as_of: count.data?.as_of, expected_rows: count.data?.rows });
      onDone(Number(res.data?.changed ?? 0));
    } catch (failure: any) {
      if (failure?.response?.status === 409) {
        setError(t('pages.administrationView.bulk.changed'));
        void count.refetch();
      } else {
        setError(getApiErrorMessage(failure, t, t('pages.administrationView.bulk.failed')));
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <KanapDialog
      open={open}
      title={t('pages.administrationView.bulk.title')}
      onClose={onClose}
      onSave={save}
      saveLabel={t('pages.administrationView.bulk.save')}
      saveDisabled={!chosen || !count.data || count.isPlaceholderData || count.isError || count.data.rows === 0 || count.data.changes === 0}
      saveLoading={saving}
    >
      <Stack spacing={1.5}>
        <PropertyRow label={t('pages.administrationView.bulk.zone')}>
          <TextField
            select
            variant="standard"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            SelectProps={{
              displayEmpty: true,
              renderValue: (value) => (value === ''
                ? <Box component="span" sx={quietSx}>{t('pages.administrationView.bulk.choose')}</Box>
                : value === NO_ZONE ? t('pages.administrationView.noZone') : zones.find((option) => option.code === value)?.name ?? String(value)),
              MenuProps: reportFilterMenuProps,
              inputProps: { 'aria-label': t('pages.administrationView.bulk.zone') },
            }}
            sx={drawerSelectSx}
          >
            {zones.map((option) => <MenuItem key={option.code} value={option.code} sx={drawerMenuItemSx}>{option.name}</MenuItem>)}
            <MenuItem value={NO_ZONE} sx={drawerMenuItemSx}>{t('pages.administrationView.noZone')}</MenuItem>
          </TextField>
        </PropertyRow>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {selection.all
            ? ids.length > 0 ? t('pages.administrationView.bulk.scopeAllBut', { count: ids.length }) : t('pages.administrationView.bulk.scopeAll')
            : t('pages.administrationView.bulk.scopeSelected', { count: ids.length })}
        </Typography>
        <Typography role="status" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {!chosen
            ? t('pages.administrationView.bulk.chooseHint')
            : tooMany
              ? t('pages.administrationView.bulk.tooMany')
              : refused
                ? refused
                : count.isError
                  ? t('pages.administrationView.bulk.countFailed')
                  : count.data
                    ? t('pages.administrationView.bulk.count', { count: count.data.changes, rows: count.data.rows })
                    : t('pages.administrationView.bulk.counting')}
        </Typography>
        {error && <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{error}</Typography>}
      </Stack>
    </KanapDialog>
  );
}
const dot = <Box component="span" sx={{ ...quietSx, mx: 0.75 }}>·</Box>;

/**
 * One row of the band: the zone's name with its description under it, its administrator group, then
 * its counts on one line. A button: it narrows the asset list to the zone, again to clear.
 */
function ZoneRow({ name, description, adminGroup, counts, selected, onSelect }: {
  name: string;
  description: string | null;
  adminGroup: string | null;
  counts: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('it');
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={selected}
      title={t('pages.administrationView.filterZone', { name })}
      onClick={onSelect}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(180px, 2fr) minmax(140px, 1.2fr) 3fr' },
        columnGap: 2,
        rowGap: 0.25,
        alignItems: 'baseline',
        width: '100%',
        px: 1.5,
        py: 0.75,
        border: 0,
        borderBottom: '1px solid',
        borderColor: 'kanap.border.default',
        borderLeft: '2px solid',
        borderLeftColor: selected ? 'primary.main' : 'transparent',
        bgcolor: selected ? 'action.selected' : 'transparent',
        color: 'kanap.text.primary',
        font: 'inherit',
        fontSize: 13,
        textAlign: 'left',
        cursor: 'pointer',
        '&:last-of-type': { borderBottom: 0 },
        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ fontWeight: 500 }}>{name}</Box>
        {description && <Box data-testid="zone-description" sx={{ ...quietSx, fontSize: 12 }}>{description}</Box>}
      </Box>
      <Box sx={{ minWidth: 0, color: 'kanap.text.secondary' }}>
        {adminGroup && (
          <>
            <Box component="span" sx={{ ...quietSx, mr: 0.5 }}>{t('pages.administrationView.attributes.adminGroup')}</Box>
            {adminGroup}
          </>
        )}
      </Box>
      <Box sx={{ minWidth: 0, color: 'kanap.text.secondary' }}>{counts}</Box>
    </Box>
  );
}

/** The zones of the catalog in their order (the most sensitive first), then "No zone". */
function ZoneBand({ summary, selected, onSelect }: {
  summary: AdministrationSummary;
  selected: string | null | undefined;
  onSelect: (code: string | null) => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const { labelFor } = useItOpsEnumOptions();
  const zoneName = useZoneName();
  const zoneCounts = (zone: AdministrationZone) => {
    if (!zone.asset_counts.length && !zone.directory_services.length) {
      return <Box component="span" sx={quietSx}>{t('pages.administrationView.scopeEmpty')}</Box>;
    }
    const kinds = zone.asset_counts.map((item) => t('pages.administrationView.kindCount', { kind: labelFor('serverKind', item.kind), count: item.count })).join(', ');
    const services = zone.directory_services.map((service) => service.name).join(', ');
    return (
      <>
        {kinds}
        {kinds && dot}
        {t('pages.administrationView.hostedApplications', { count: zone.hosted_application_count })}
        {zone.directory_services.length > 0 && (
          <>
            {dot}
            <Tooltip title={services}>
              <span>{t('pages.administrationView.directoryServiceCount', { count: zone.directory_services.length })}</span>
            </Tooltip>
          </>
        )}
      </>
    );
  };
  return (
    <Box>
      <Typography sx={{ fontSize: 12, ...quietSx, mb: 0.75 }}>{t('pages.administrationView.filterZonesHint')}</Typography>
      <Box
        role="group"
        aria-label={t('pages.administrationView.zones')}
        sx={{ border: '1px solid', borderColor: 'kanap.border.default', borderRadius: 1, overflow: 'hidden' }}
      >
      {summary.zones.map((zone) => (
        <ZoneRow
          key={zone.code}
          name={zoneName(zone.code, summary.zones)}
          description={zone.description}
          adminGroup={zone.admin_group}
          counts={zoneCounts(zone)}
          selected={selected === zone.code}
          onSelect={() => onSelect(zone.code)}
        />
      ))}
      <ZoneRow
        name={t('pages.administrationView.noZone')}
        description={null}
        adminGroup={null}
        counts={summary.without_zone.asset_count
          ? t('pages.administrationView.assetCount', { count: summary.without_zone.asset_count })
          : <Box component="span" sx={quietSx}>{t('pages.administrationView.scopeEmpty')}</Box>}
        selected={selected === null}
        onSelect={() => onSelect(null)}
      />
      </Box>
    </Box>
  );
}

/**
 * One toggle per control that applies, with its short name and count; its tooltip explains it. A
 * toggle narrows the asset list to that control, one at a time, again to clear. Without a catalog
 * of zones, a line says so in place of the controls that need one.
 */
function ControlPills({ summary, selected, onSelect }: {
  summary: AdministrationSummary;
  selected: ControlKey | null;
  onSelect: (key: ControlKey) => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const zoneName = useZoneName();
  const most = summary.most_sensitive ? zoneName(summary.most_sensitive, summary.zones) : null;
  const items = summary.controls.filter((control) => control.count !== null).map((control) => {
    const base = `pages.administrationView.controlsList.${CONTROL_LOCALE[control.key]}`;
    const count = control.count ?? 0;
    const isSelected = selected === control.key;
    return {
      id: control.key,
      ariaLabel: `${t(`${base}.short`)} ${count}`,
      label: (
        <>
          {t(`${base}.short`)}
          <Box component="span" data-testid={`control-count-${control.key}`} sx={{ ml: 0.75, fontWeight: 400, ...(count === 0 && !isSelected ? quietSx : {}) }}>{count}</Box>
        </>
      ),
      tooltip: (
        <>
          <Box sx={{ fontWeight: 500 }}>{t(`${base}.title`)}</Box>
          <Box>{t(`${base}.hint`)}</Box>
          {most && control.key !== 'assets_without_zone' && <Box>{t('pages.administrationView.controlsHint', { zone: most })}</Box>}
        </>
      ),
    };
  });
  return (
    <Box>
      <ChipToggleBar
        items={items}
        selectedId={selected}
        onSelect={(id) => onSelect(id as ControlKey)}
        ariaLabel={t('pages.administrationView.controls')}
      />
      {!summary.most_sensitive && (
        <Typography sx={{ fontSize: 13, ...quietSx, mt: 0.75 }}>{t('pages.administrationView.controlsNoCatalog')}</Typography>
      )}
    </Box>
  );
}
/**
 * The directory services (technologies of the directory family) with their zone and servers, then
 * the domains of the catalog grouped by forest. Nothing links a directory service to a forest.
 */
function DirectoriesSection({ zoneName }: { zoneName: (code: string | null) => string }) {
  const { t } = useTranslation(['it', 'common']);
  const { byField } = useItOpsEnumOptions();
  const directories = useDirectories();
  const domainName = (code: string, fallback: string) => (byField.domain || []).find((option) => option.code === code)?.label || fallback;
  // An absent value: a grey dash, "Not set" on hover (the convention of an unknown version in the Relations tab).
  const notSet = <Box component="span" title={t('pages.administrationView.notSet')} sx={quietSx}>{'\u2014'}</Box>;
  const count = (value: number | null) => (value == null ? notSet : value.toLocaleString());
  const direction = (value: DomainTrustDirection) => t(`pages.settings.trusts.directions.${value}`);
  type Service = AdministrationDirectories['services'][number];
  const serviceColumns: Array<RelationsColumn<Service>> = [
    {
      key: 'reference',
      header: t('pages.administrationView.columns.reference'),
      width: 96,
      render: (row) => (
        <RecordLink to={`/it/technologies/${row.id}`}>{row.reference ? <RelationRef>{row.reference}</RelationRef> : row.name}</RecordLink>
      ),
    },
    { key: 'name', header: t('common.name'), width: 240, render: (row) => row.name },
    { key: 'zone', header: t('pages.administrationView.columns.zone'), width: 180, render: (row) => (row.zone ? zoneName(row.zone) : <Box component="span" sx={quietSx}>{zoneName(null)}</Box>) },
    { key: 'servers', header: t('pages.administrationView.columns.servers'), width: 80, align: 'right', render: (row) => row.servers.toLocaleString() },
  ];
  const domainColumns: Array<RelationsColumn<AdministrationDomain>> = [
    { key: 'name', header: t('pages.administrationView.columns.domain'), width: 200, render: (row) => `${domainName(row.code, row.label)}${row.deprecated ? ` (${t('common:enumEditor.retiredSuffix')})` : ''}` },
    { key: 'dns', header: t('pages.administrationView.columns.dnsSuffix'), width: 180, hideOrder: 4, render: (row) => row.dns_suffix },
    {
      key: 'trusts',
      header: t('pages.administrationView.columns.trusts'),
      width: 220,
      hideOrder: 1,
      render: (row) => (row.trusts.length || row.declared_by.length
        ? (
          <>
            {row.trusts.map((trust) => `${domainName(trust.domain, trust.label)} (${direction(trust.direction)})`).join(', ')}
            {row.declared_by.length > 0 && (
              <Box component="span" sx={quietSx}>
                {row.trusts.length > 0 && ', '}
                {row.declared_by.map((trust) => t('pages.administrationView.declaredTrust', { name: domainName(trust.domain, trust.label), direction: direction(trust.direction) })).join(', ')}
              </Box>
            )}
          </>
        )
        : <Box component="span" sx={quietSx}>{t('pages.administrationView.none')}</Box>),
    },
    { key: 'accounts', header: t('pages.administrationView.columns.accounts'), width: 90, hideOrder: 3, align: 'right', render: (row) => count(row.account_count) },
    { key: 'computers', header: t('pages.administrationView.columns.computers'), width: 90, hideOrder: 2, align: 'right', render: (row) => count(row.machine_count) },
    {
      key: 'controllers',
      header: t('pages.administrationView.columns.domainControllers'),
      width: 240,
      render: (row) => (row.domain_controllers.length
        ? (
          <>
            <Box component="span" sx={{ mr: 0.75 }}>{row.domain_controllers.length}</Box>
            {row.domain_controllers.map((server, index) => (
              <React.Fragment key={server.id}>
                {index > 0 && ', '}
                <RecordLink to={`/it/assets/${server.reference || server.id}`}>{server.name}</RecordLink>
              </React.Fragment>
            ))}
          </>
        )
        : <Box component="span" sx={quietSx}>{t('pages.administrationView.noController')}</Box>),
    },
  ];
  if (!directories.data) {
    return <ReportDataStatus loading={directories.isLoading} error={directories.isError} onRetry={() => void directories.refetch()} />;
  }
  const { services, forests } = directories.data;
  const domainCount = forests.reduce((sum, group) => sum + group.domains.length, 0);
  return (
    <Stack spacing={2.5}>
      <RelationsSection title={t('pages.administrationView.attributes.directoryServices')} count={services.length}>
        {services.length
          ? <RelationsTable columns={serviceColumns} rows={services} rowKey={(row) => row.id} rowHref={(row) => `/it/technologies/${row.id}`} ariaLabel={t('pages.administrationView.attributes.directoryServices')} />
          : <RelationsEmpty>{t('pages.administrationView.noDirectories')}</RelationsEmpty>}
      </RelationsSection>
      <RelationsSection title={t('pages.administrationView.domains')} count={domainCount}>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>{t('pages.administrationView.domainsHint')}</Typography>
        {domainCount === 0 && <RelationsEmpty>{t('pages.administrationView.noDomains')}</RelationsEmpty>}
        <Stack spacing={1.5}>
          {forests.filter((group) => group.domains.length > 0).map((group) => (
            <Box key={group.forest ?? ''}>
              <Typography component="h3" sx={{ m: 0, mb: 0.75, fontSize: 13, fontWeight: 500, ...(group.forest ? {} : quietSx) }}>
                {group.forest ?? t('pages.administrationView.noForest')}
              </Typography>
              <RelationsTable
                columns={domainColumns}
                rows={group.domains}
                rowKey={(row) => row.code}
                ariaLabel={group.forest ?? t('pages.administrationView.noForest')}
              />
            </Box>
          ))}
        </Stack>
      </RelationsSection>
    </Stack>
  );
}

/**
 * Administration zones (the administration view of the tiered administration model), in two tabs.
 * Assets: the zones in a compact band and the control points, both of which narrow the asset list
 * below them; the assets with their zone, technologies, applications and findings, on the list grid
 * (filters, sort, export); a member assigns a zone to the ticked assets or to every asset of the
 * filter. Directories and domains: the directory services, then the domains grouped by forest.
 */
export default function AdministrationViewPage() {
  const { t, i18n } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === DIRECTORIES_TAB ? DIRECTORIES_TAB : 'assets';
  /** Another tab keeps the rest of the address: the grid's filters, sort and search. */
  const changeTab = (next: string) => setSearchParams((current) => {
    const params = new URLSearchParams(current);
    if (next === DIRECTORIES_TAB) params.set('tab', DIRECTORIES_TAB);
    else params.delete('tab');
    return params;
  }, { replace: true });
  const queryClient = useQueryClient();
  const notify = useNotify();
  const { byField, labelFor } = useItOpsEnumOptions();
  const zoneNameOf = useZoneName();
  const canEdit = hasLevel('infrastructure', 'member');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [refreshKey, setRefreshKey] = useState(0);
  const [assignOpen, setAssignOpen] = useState(false);
  const [request, setRequest] = useState<ListRequest | null>(null);
  const requestRef = useRef<ListRequest | null>(null);
  // The filters (and search) of the rows on screen: a change clears the selection.
  const scopeKeyRef = useRef<string | null>(null);
  // The grid's filters: the band and the toggles read and set its zone and control filters.
  const gridApiRef = useRef<any>(null);
  const [gridFilters, setGridFilters] = useState<Record<string, any>>({});
  const summary = useQuery({
    queryKey: ['technologies', 'reports', 'administration', 'summary'],
    queryFn: async () => (await api.get<AdministrationSummary>(ENDPOINT)).data,
  });
  // An answer without zones (a server of another version) reads as no answer.
  const data = Array.isArray(summary.data?.zones) ? summary.data : undefined;
  const zones = useMemo(() => data?.zones ?? [], [data]);
  const zoneName = useCallback((code: string | null) => zoneNameOf(code, zones), [zoneNameOf, zones]);
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const zoneNameRef = useRef(zoneName);
  zoneNameRef.current = zoneName;
  // The grid filters by the catalog code. The address shows the name, so a link never carries a code such as tiens_1.
  // A shared address may still name the zone, in the spelling of any past release: compare the
  // names without their spacing, and read the stored name too when the translation changed.
  const zoneFilterAsCodes = useCallback((model: Record<string, any> | null | undefined) => {
    const zone = model?.zone;
    const values = zone?.values;
    if (!model || !zone || !Array.isArray(values) || zonesRef.current.length === 0) return null;
    let changed = false;
    const next = values.map((value: unknown) => {
      if (typeof value !== 'string' || zonesRef.current.some((zone) => zone.code === value)) return value;
      const key = zoneNameKey(value);
      const match = zonesRef.current.find((zone) => (
        zoneNameKey(zoneNameRef.current(zone.code)) === key || zoneNameKey(zone.label ?? '') === key
      ));
      if (!match) return value;
      changed = true;
      return match.code;
    });
    return changed ? { ...model, zone: { ...model.zone, values: next } } : null;
  }, []);
  // A zone filter in the address names the zone, and the grid must start on its code. While the
  // zones are unknown the grid waits, so its first request never sends a zone name to the API.
  const addressZoneFilter = useMemo(() => {
    const raw = searchParams.get('filters');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.zone && Array.isArray(parsed.zone.values) ? parsed as Record<string, any> : null;
    } catch {
      return null;
    }
  }, [searchParams]);
  const gridCanStart = !addressZoneFilter || !!data || summary.isError;
  const gridInitialState = useMemo(
    () => (addressZoneFilter && zones.length > 0
      ? { filter: { filterModel: zoneFilterAsCodes(addressZoneFilter) ?? addressZoneFilter } }
      : undefined),
    [addressZoneFilter, zoneFilterAsCodes, zones],
  );
  useEffect(() => {
    const grid = gridApiRef.current;
    if (!grid?.getFilterModel) return;
    const fixed = zoneFilterAsCodes(grid.getFilterModel());
    if (fixed) grid.setFilterModel(fixed);
  }, [zoneFilterAsCodes, zones]);
  useEffect(() => {
    if (zones.length === 0) return;
    const raw = searchParams.get('filters');
    if (!raw) return;
    let parsed: Record<string, any>;
    try { parsed = JSON.parse(raw); } catch { return; }
    const model = parsed?.zone;
    if (!model || !Array.isArray(model.values)) return;
    let changed = false;
    const values = model.values.map((value: unknown) => {
      if (typeof value !== 'string') return value;
      const known = zones.find((zone) => zone.code === value);
      if (!known) return value;
      const label = zoneName(value);
      if (!label || label === value) return value;
      changed = true;
      return label;
    });
    if (!changed) return;
    const next = new URLSearchParams(searchParams);
    next.set('filters', JSON.stringify({ ...parsed, zone: { ...model, values } }));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, zoneName, zones]);
  const directories = useDirectories();
  // Every asset that is not retired: the zones' counts and those without one.
  const assetCount = data
    ? data.zones.reduce((sum, zone) => sum + zone.asset_counts.reduce((total, item) => total + item.count, 0), data.without_zone.asset_count)
    : undefined;
  const directoryCount = directories.data
    ? directories.data.services.length + directories.data.forests.reduce((sum, group) => sum + group.domains.length, 0)
    : undefined;

  const zoneFilter = singleSetValue(gridFilters, 'zone');
  const controlValue = singleSetValue(gridFilters, 'control');
  const controlFilter = controlValue && (CONTROL_KEYS as readonly string[]).includes(controlValue) ? controlValue as ControlKey : null;
  /** One value on a column of the grid, or none when it is that value already. */
  const toggleFilter = (column: 'zone' | 'control', value: string | null, current: string | null | undefined) => {
    const grid = gridApiRef.current;
    if (!grid) return;
    const model = { ...(grid.getFilterModel?.() ?? {}) };
    if (current === value) delete model[column];
    else model[column] = { filterType: 'set', values: [value] };
    grid.setFilterModel(model);
  };
  const selectZone = (code: string | null) => toggleFilter('zone', code, zoneFilter);
  const selectControl = (key: ControlKey) => toggleFilter('control', key, controlFilter);

  const selectedCount = selection.all ? Math.max((request?.total ?? 0) - selection.ids.size, 0) : selection.ids.size;
  const toggleRow = useCallback((id: string) => setSelection((current) => {
    const ids = new Set(current.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { all: current.all, ids };
  }), []);
  const toggleAll = useCallback(() => setSelection((current) => (
    current.all && current.ids.size === 0 ? NO_SELECTION : { all: true, ids: new Set<string>() }
  )), []);
  const selectionApi = useMemo<SelectionApi>(
    () => ({ selection, count: selectedCount, toggleRow, toggleAll }),
    [selection, selectedCount, toggleRow, toggleAll],
  );

  const kindValues = useCallback(async () => (byField.serverKind || [])
    .map((option) => ({ value: option.code, label: labelFor('serverKind', option.code) }))
    .sort((a, b) => a.label.localeCompare(b.label)), [byField, labelFor]);
  const zoneValues = useCallback(async () => [
    ...zonesRef.current.map((zone) => ({ value: zone.code as string | null, label: zoneNameOf(zone.code, zonesRef.current) })),
    { value: null, label: t('pages.administrationView.noZone') },
  ], [t, zoneNameOf]);
  const controlValues = useCallback(async () => CONTROL_KEYS.map((key) => ({ value: key, label: t(`pages.administrationView.controlsList.${CONTROL_LOCALE[key]}.short`) })), [t]);

  const columns: EnhancedColDef<AdministrationAssetRow>[] = useMemo(() => [
    ...(canEdit ? [{
      colId: SELECTION_COLUMN,
      headerName: '',
      width: 44,
      minWidth: 44,
      maxWidth: 44,
      lockPosition: 'left' as const,
      suppressColumnsToolPanel: true,
      suppressMovable: true,
      resizable: false,
      sortable: false,
      filter: false,
      suppressHeaderMenuButton: true,
      cellStyle: SELECT_CELL_STYLE,
      headerComponent: SelectAllHeader,
      cellRenderer: SelectRowCell,
      // Space on the focused cell or header ticks, as the box would (AG Grid keeps the focus on the cell).
      suppressKeyboardEvent: (params: any) => {
        if (params.editing || params.event.key !== ' ') return false;
        if (params.event.type === 'keydown' && params.data?.id) {
          params.event.preventDefault();
          toggleRow(params.data.id);
        }
        return true;
      },
      suppressHeaderKeyboardEvent: (params: any) => {
        if (params.event.key !== ' ') return false;
        if (params.event.type === 'keydown') {
          params.event.preventDefault();
          toggleAll();
        }
        return true;
      },
    }] : []),
    { headerName: t('pages.administrationView.columns.reference'), field: 'reference', width: 90, cellRenderer: ReferenceCell, cellStyle: { fontFamily: MONO_FONT_FAMILY, fontSize: '12px' } },
    { headerName: t('common.name'), field: 'name', flex: 1, minWidth: 160, tooltipField: 'name' },
    {
      headerName: t('pages.administrationView.columns.type'),
      field: 'kind',
      width: 120,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: kindValues, searchable: false },
      valueFormatter: (p: any) => labelFor('serverKind', p.value as string),
    },
    {
      headerName: t('pages.administrationView.columns.zone'),
      field: 'zone',
      width: 130,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: zoneValues, searchable: false, emptyLabel: t('pages.administrationView.noZone') },
      cellRenderer: ZoneCell,
    },
    { headerName: t('pages.administrationView.columns.technologies'), field: 'technologies', minWidth: 140, flex: 1, sortable: false, filter: false, cellRenderer: TechnologiesCell },
    { headerName: t('pages.administrationView.columns.applications'), field: 'applications', minWidth: 140, flex: 1, sortable: false, filter: false, cellRenderer: ApplicationsCell },
    {
      headerName: t('pages.administrationView.columns.controls'),
      colId: 'control',
      field: 'findings',
      width: 240,
      minWidth: 180,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { getValues: controlValues, searchable: false },
      cellRenderer: ControlsCell,
    },
  ], [canEdit, controlValues, kindValues, labelFor, t, toggleAll, toggleRow, zoneValues]);

  /** The assets with the grid's filters and sort, or the domains; long filters go as a saved list context. */
  const exportList = async (list: 'assets' | 'domains', format: ExportFormat) => {
    setExporting(true);
    setExportError(null);
    try {
      const language = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);
      const params = list === 'assets' ? { ...exportParams(requestRef.current), list, language, format } : { list, language, format };
      const res = await getWithListContext<Blob>(`${ENDPOINT}/export`, params, { responseType: 'blob' });
      const headers = (res.headers ?? {}) as Record<string, unknown>;
      const disposition = (headers['content-disposition'] ?? headers['Content-Disposition']) as string | undefined;
      downloadBlob(res.data instanceof Blob ? res.data : new Blob([res.data]), extractFilenameFromDisposition(disposition) || `administration_view_${list}.${format}`);
    } catch (err) {
      setExportError(getApiErrorMessage(err, t, t('pages.administrationView.exportFailed')));
    } finally {
      setExporting(false);
    }
  };

  const catalogEmpty = !!data && data.zones.every((zone) => zone.unknown);
  // The zones an assignment may choose: in the catalog and offered.
  const assignable = zones.filter((zone) => !zone.deprecated && !zone.unknown).map((zone) => ({ code: zone.code, name: zoneName(zone.code) }));

  // The actions wrap on their own lines and leave the title its room (the title row lets them overflow it otherwise).
  const actions = (
    <Stack
      direction="row"
      useFlexGap
      alignItems="center"
      justifyContent="flex-end"
      sx={{ flexWrap: 'wrap', gap: 1, ml: 'auto', maxWidth: { xs: '100%', sm: 'calc(100% - 300px)' } }}
    >
      {tab === 'assets' && canEdit && selectedCount > 0 && (
        <>
          <Typography data-testid="administration-selection" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {selection.all
              ? t('pages.administrationView.selection.whole', { count: selectedCount })
              : t('pages.administrationView.selection.some', { count: selectedCount })}
          </Typography>
          <Button variant="action" onClick={() => setSelection(NO_SELECTION)}>{t('pages.administrationView.selection.clear')}</Button>
        </>
      )}
      {tab === 'assets' && canEdit && (
        <Button variant="action" onClick={() => setAssignOpen(true)} disabled={selectedCount === 0 || !data}>
          {selectedCount > 0
            ? t('pages.administrationView.actions.assignSelected', { count: selectedCount })
            : t('pages.administrationView.actions.assign')}
        </Button>
      )}
      <ExportFormatButton label={t('pages.administrationView.exportAssets')} disabled={exporting} onExport={(format) => exportList('assets', format)} />
      <ExportFormatButton label={t('pages.administrationView.exportDomains')} disabled={exporting} onExport={(format) => exportList('domains', format)} />
    </Stack>
  );

  return (
    <SelectionContext.Provider value={selectionApi}>
      <ZoneNameContext.Provider value={zoneName}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <PageHeader title={t('pages.administrationView.zones')} actions={actions} />
            <Box sx={{ borderBottom: '1px solid', borderColor: 'kanap.border.default' }}>
              <WorkspaceTabs
                tabs={[
                  { key: 'assets', label: t('pages.administrationView.tabs.assets'), badge: assetCount },
                  { key: DIRECTORIES_TAB, label: t('pages.administrationView.tabs.directories'), badge: directoryCount },
                ]}
                activeTab={tab}
                onTabChange={changeTab}
              />
            </Box>
          </Box>
          {exportError && <Alert severity="error">{exportError}</Alert>}
          {tab === DIRECTORIES_TAB && <DirectoriesSection zoneName={zoneName} />}
          {tab === 'assets' && !data && <ReportDataStatus loading={summary.isLoading} error={summary.isError} onRetry={() => void summary.refetch()} />}
          {tab === 'assets' && data && (
            <Box>
              {catalogEmpty && (
                <Typography sx={{ fontSize: 13, ...quietSx, mb: 1 }}>
                  {t('pages.administrationView.noZones')}
                  {hasLevel('settings', 'reader') && <>{' '}<RecordLink to="/it/settings">{t('pages.administrationView.openSettings')}</RecordLink></>}
                </Typography>
              )}
              <ZoneBand summary={data} selected={zoneFilter} onSelect={selectZone} />
              <Box sx={{ mt: 1.5 }}><ControlPills summary={data} selected={controlFilter} onSelect={selectControl} /></Box>
            </Box>
          )}
          {/* The header of the box column: the box alone, centred, without the cell's padding. */}
          {tab === 'assets' && gridCanStart && (
            <Box sx={{
              '& .ag-header-cell[col-id="select"]': { px: 0 },
              '& .ag-header-cell[col-id="select"] .ag-header-cell-comp-wrapper': { justifyContent: 'center' },
            }}
            >
              <ServerDataGrid<AdministrationAssetRow>
                columns={columns}
                endpoint={ASSETS_ENDPOINT}
                queryKey="administration-assets"
                getRowId={rowId}
                showRowCount
                defaultSort={{ field: 'name', direction: 'ASC' }}
                requiredColumns={['name']}
                enableColumnChooser
                columnPreferencesKey="it-administration-assets"
                refreshKey={refreshKey}
                enableSearch
                initialState={gridInitialState}
                onGridApiReady={(gridApi) => { gridApiRef.current = gridApi; }}
                onQueryStateChange={(state) => {
                  const model = state.filterModel ?? {};
                  const fixed = zoneFilterAsCodes(model);
                  if (fixed) {
                    gridApiRef.current?.setFilterModel(fixed);
                    return;
                  }
                  setGridFilters(model);
                }}
                onCellClicked={(event: any) => {
                  if (!event?.data?.id) return;
                  const target = event.event?.target as HTMLElement | undefined;
                  // A link in a cell (the reference, an application) opens its own page.
                  if (target?.closest?.('a')) return;
                  if (event.column?.getColId?.() !== SELECTION_COLUMN) {
                    navigate(assetHref(event.data));
                    return;
                  }
                  // A click in the selection cell beside the box ticks it too; the box ticks itself.
                  if (!target?.closest?.('input')) toggleRow(event.data.id);
                }}
                onListRequestChange={(next) => {
                  requestRef.current = next;
                  setRequest(next);
                  const key = JSON.stringify(listScope(next));
                  if (scopeKeyRef.current !== null && scopeKeyRef.current !== key) setSelection(NO_SELECTION);
                  scopeKeyRef.current = key;
                }}
                emptyState={<Typography sx={{ fontSize: 13, ...quietSx }} data-testid="administration-empty">{t('pages.administrationView.emptyAssets')}</Typography>}
              />
            </Box>
          )}
          {canEdit && (
            <AssignZoneDialog
              open={assignOpen}
              onClose={() => setAssignOpen(false)}
              selection={selection}
              request={request}
              zones={assignable}
              onDone={(changed) => {
                setAssignOpen(false);
                notify({ message: t('pages.administrationView.bulk.done', { count: changed }) });
                setSelection(NO_SELECTION);
                setRefreshKey((k) => k + 1);
                // The band and the toggles count again.
                void queryClient.invalidateQueries({ queryKey: ['technologies', 'reports', 'administration'] });
              }}
            />
          )}
        </Box>
      </ZoneNameContext.Provider>
    </SelectionContext.Provider>
  );
}
