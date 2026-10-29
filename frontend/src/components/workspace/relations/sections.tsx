import type { PaletteMode } from '@mui/material';
import { Box } from '@mui/material';
import type { TFunction } from 'i18next';
import api from '../../../api';
import type { IncidentRow } from '../../../api/endpoints/incidents';
import { StatusDot } from '../../design';
import ContractLineMismatchMark, { type ContractLineMismatch } from '../../finance/ContractLineMismatchMark';
import FxMissingNotice, { FxMissingLocalAmount } from '../../finance/FxMissingNotice';
import { fxMissingOfLines } from '../../finance/fxMissing';
import { formatAmount } from '../../../i18n/formatters';
import { formatShortDate } from '../../../lib/dateFormat';
import { isIncidentLocked } from '../../../pages/it/workspace/incidentWorkspace';
import { buildItemPath, formatItemRef } from '../../../utils/item-ref';
import { getDotColor, INCIDENT_SEVERITY_COLORS } from '../../../utils/statusColors';
import type { RelationOption } from '../RelationAddPicker';
import { RelationRef, type RelationsColumn } from '../RelationsTable';
import { DASH, PAGE, pathOf, refOf, relationDate } from './helpers';
import type {
  ApplicationRelationRow,
  AssetRelationRow,
  BudgetLineRow,
  BusinessProcessRow,
  ContractRow,
  ConversionRow,
  IncidentLinkRow,
  InterfaceRelationRow,
  ProjectRow,
  SectionSpec,
  TechnologyRelationRow,
} from './types';

type NamedHit = { id: string; item_number: number | null; name?: string | null; title?: string | null };

/** One page of projects, requests or tasks, as picker options with their business reference. */
export function searchRelationItems(
  endpoint: string,
  type: 'project' | 'request' | 'task',
  labelOf: (row: NamedHit) => string,
): (q: string, signal?: AbortSignal) => Promise<RelationOption[]> {
  return async (q, signal) => {
    const res = await api.get<{ items: NamedHit[] }>(endpoint, {
      params: { page: 1, limit: PAGE, sort: 'updated_at:DESC', ...(q ? { q } : {}) },
      signal,
    });
    // The page holds the most recently updated; it reads by reference, whatever the server's order.
    const items = [...(res.data?.items || [])].sort((a, b) => (a.item_number ?? Infinity) - (b.item_number ?? Infinity));
    return items.map((row) => ({
      id: row.id,
      label: labelOf(row),
      ref: refOf(type, row.item_number ?? null),
    }));
  };
}

/** The reference column of a linked row (`BL-12`, `PRJ-7`). */
export function relationRefColumn<T extends { item_number: number | null }>(
  type: 'budget' | 'project' | 'request' | 'task',
  header: string,
): RelationsColumn<T> {
  return {
    key: 'ref',
    header,
    width: 72,
    render: (row) => <RelationRef>{refOf(type, row.item_number) ?? DASH}</RelationRef>,
  };
}

const columnsT = (t: TFunction, name: string) => t(`workspace.application.relations.columns.${name}`);

/**
 * Budget lines linked to the owner. Every amount is in the reporting currency, so the total is one
 * sum. A line without a rate for the year is shown in its own currency and left out of it.
 */
export function budgetLinesSection({
  t,
  rows,
  year,
  columnLabel,
  currency,
  hidden = 0,
}: {
  t: TFunction;
  rows: BudgetLineRow[] | null;
  year: number;
  columnLabel: string;
  currency: string | null;
  /**
   * The linked lines `rows` leaves out (`budget_lines_hidden`): outside the caller's data access,
   * or all of them when the caller cannot read the budget (`rows` null). Counted, never named.
   */
  hidden?: number;
}): SectionSpec<BudgetLineRow> {
  const outsideKey = rows === null ? 'count' : rows.length === 0 ? 'only' : 'and';
  return {
    outside: { count: hidden, text: t(`workspace.application.relations.outside.${outsideKey}`, { count: hidden }) },
    kind: 'budget_lines',
    title: t('workspace.application.relations.sections.budgetLines'),
    empty: t('workspace.application.relations.empty.budgetLines'),
    searchPlaceholder: t('common:selects.searchBudgetLines'),
    rows,
    href: (row) => pathOf('budget', row),
    label: (row) => row.product_name,
    muted: (row) => row.status === 'disabled',
    columns: [
      relationRefColumn<BudgetLineRow>('budget', columnsT(t, 'ref')),
      { key: 'name', header: columnsT(t, 'name'), render: (row) => row.product_name },
      { key: 'nature', header: columnsT(t, 'nature'), width: 72, render: (row) => t(`ops:budget.${row.nature}`) },
      { key: 'supplier', header: columnsT(t, 'supplier'), width: 140, hideOrder: 1, render: (row) => row.supplier_name ?? DASH },
      {
        key: 'amount',
        align: 'right',
        width: 130,
        header: currency ? `${columnLabel} ${year} (${currency})` : `${columnLabel} ${year}`,
        render: (row) => (row.amount != null
          ? formatAmount(row.amount)
          : row.fx_missing ? <FxMissingLocalAmount amount={row.fx_missing.amount} currency={row.fx_missing.currency} year={year} /> : DASH),
      },
    ],
    search: async (q, signal) => {
      const res = await api.get<{ items: Array<{ id: string; item_number: number | null; product_name: string; nature: 'opex' | 'capex' }> }>('/budget-lines/summary', {
        params: { page: 1, limit: PAGE, status: 'enabled', sort: 'product_name:ASC', q: q || undefined },
        signal,
      });
      return (res.data?.items || []).map((row) => ({
        id: row.id,
        label: row.product_name,
        ref: refOf('budget', row.item_number ?? null),
        hint: t(`ops:budget.${row.nature}`),
      }));
    },
    // A disabled line stays listed, muted, and is left out of the total, which says so below it.
    // No total when no line has an amount, counted or left out: a "0" would add nothing.
    totals: (lines) => {
      if (!lines.some((row) => row.amount != null)) return [];
      const disabled = lines.filter((row) => row.status === 'disabled').length;
      const amounts = lines
        .filter((row) => row.status !== 'disabled')
        .map((row) => row.amount)
        .filter((amount): amount is number => amount != null);
      const total = {
        key: 'total',
        label: t('workspace.application.relations.total'),
        cells: { amount: formatAmount(amounts.reduce((sum, value) => sum + value, 0)) },
      };
      if (disabled === 0) return [total];
      return [total, {
        key: 'disabled',
        label: (
          <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
            {t('workspace.application.relations.disabledNotCounted', { count: disabled })}
          </Box>
        ),
        cells: {},
      }];
    },
    notice: (lines) => <FxMissingNotice items={fxMissingOfLines(lines, year)} sx={{ mt: 0.75 }} />,
  };
}

/**
 * Contracts linked to the owner. Active contracts only (a disabled one has ended), one total per
 * currency: amounts in two currencies are never added up. `hidden` counts the linked contracts the
 * caller does not see listed (`contracts_hidden`): outside their data access, never named.
 */
export function contractsSection({
  t,
  rows,
  lang,
  hidden = 0,
  lineId,
}: {
  t: TFunction;
  rows: ContractRow[] | null;
  lang: string;
  hidden?: number;
  /** The budget line this section belongs to: candidates are marked before they are linked. */
  lineId?: string;
}): SectionSpec<ContractRow> {
  const outsideKey = rows === null ? 'count' : rows.length === 0 ? 'only' : 'and';
  return {
    outside: { count: hidden, text: t(`workspace.application.relations.outside_contracts.${outsideKey}`, { count: hidden }) },
    kind: 'contracts',
    title: t('workspace.application.relations.sections.contracts'),
    empty: t('workspace.application.relations.empty.contracts'),
    searchPlaceholder: t('workspace.application.relations.search.contracts'),
    rows,
    href: (row) => `/ops/contracts/${row.id}/overview`,
    label: (row) => row.name,
    muted: (row) => row.status === 'disabled',
    columns: [
      {
        key: 'name',
        header: columnsT(t, 'name'),
        render: (row) => (
          <>
            {row.name}
            {row.mismatches && row.mismatches.length > 0 ? <ContractLineMismatchMark mismatches={row.mismatches} /> : null}
          </>
        ),
      },
      { key: 'supplier', header: columnsT(t, 'supplier'), width: 140, hideOrder: 2, render: (row) => row.supplier_name ?? DASH },
      {
        key: 'end',
        header: columnsT(t, 'end'),
        width: 110,
        render: (row) => (
          <Box component="span" sx={row.in_renewal_window && row.status !== 'disabled' ? { color: 'kanap.orange' } : undefined}>
            {row.end_date ? formatShortDate(row.end_date, lang, { year: 'always' }) : DASH}
          </Box>
        ),
      },
      {
        key: 'amount',
        align: 'right',
        width: 130,
        header: columnsT(t, 'yearlyAmount'),
        render: (row) => (row.yearly_amount == null ? DASH : `${formatAmount(row.yearly_amount)}${row.currency ? ` ${row.currency}` : ''}`),
      },
      {
        key: 'renewal',
        header: columnsT(t, 'renewal'),
        width: 110,
        hideOrder: 1,
        render: (row) => t(row.auto_renewal ? 'workspace.application.relations.renewal.tacit' : 'workspace.application.relations.renewal.manual'),
      },
    ],
    search: async (q, signal) => {
      const res = await api.get<{ items: Array<{ id: string; name: string }> }>('/contracts/lookup', {
        params: { limit: PAGE, ...(q ? { q } : {}) },
        signal,
      });
      const options: RelationOption[] = (res.data?.items || []).map((row) => ({ id: row.id, label: row.name }));
      if (!lineId || options.length === 0) return options;
      const consistency = await api.get<{ items: Array<{ id: string; mismatches: ContractLineMismatch[] }> }>(
        `/budget-lines/${encodeURIComponent(lineId)}/contract-consistency`,
        { params: { ids: options.map((option) => option.id).join(',') }, signal },
      );
      const byId = new Map((consistency.data?.items ?? []).map((item) => [item.id, item.mismatches]));
      return options.map((option) => {
        const mismatches = byId.get(option.id);
        return mismatches && mismatches.length > 0 ? { ...option, mismatches } : option;
      });
    },
    totals: (contracts) => {
      const byCurrency = new Map<string, number>();
      contracts.forEach((row) => {
        if (row.status === 'disabled' || row.yearly_amount == null) return;
        const rowCurrency = row.currency ?? '';
        byCurrency.set(rowCurrency, (byCurrency.get(rowCurrency) ?? 0) + row.yearly_amount);
      });
      return [...byCurrency.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rowCurrency, sum]) => ({
          key: rowCurrency || 'none',
          label: t('workspace.application.relations.total'),
          cells: { amount: `${formatAmount(sum)}${rowCurrency ? ` ${rowCurrency}` : ''}` },
        }));
    },
  };
}

/** Projects linked to the owner: reference, status and planned end. */
export function projectsSection({
  t,
  rows,
  lang,
}: {
  t: TFunction;
  rows: ProjectRow[] | null;
  lang: string;
}): SectionSpec<ProjectRow> {
  return {
    kind: 'projects',
    title: t('workspace.application.relations.sections.projects'),
    empty: t('workspace.application.relations.empty.projects'),
    searchPlaceholder: t('workspace.application.relations.search.projects'),
    rows,
    href: (row) => pathOf('project', row),
    label: (row) => row.name,
    columns: [
      relationRefColumn<ProjectRow>('project', columnsT(t, 'ref')),
      { key: 'name', header: columnsT(t, 'name'), render: (row) => row.name },
      {
        key: 'status',
        header: columnsT(t, 'status'),
        width: 120,
        render: (row) => (row.status ? t(`portfolio:statuses.project.${row.status}`, { defaultValue: row.status }) : DASH),
      },
      { key: 'end', header: columnsT(t, 'plannedEnd'), width: 120, hideOrder: 1, render: (row) => relationDate(row.planned_end, lang) },
    ],
    search: searchRelationItems('/portfolio/projects', 'project', (row) => row.name ?? ''),
  };
}

/**
 * Incidents linked to the owner. Linking writes in the incident's journal, so it takes the right
 * to edit incidents. A closed or cancelled incident is frozen: it stays listed and cannot be unlinked,
 * and the picker never offers one.
 */
export function incidentsSection({
  t,
  rows,
  lang,
  canEdit,
  mode,
}: {
  t: TFunction;
  rows: IncidentLinkRow[] | null;
  lang: string;
  canEdit: boolean;
  mode: PaletteMode;
}): SectionSpec<IncidentLinkRow> {
  const locked = (status: string) => isIncidentLocked(status as IncidentRow['status']);
  return {
    kind: 'incidents',
    title: t('components.incidentRelations.title'),
    empty: t('workspace.technology.relations.empty.incidents'),
    searchPlaceholder: t('workspace.technology.relations.search.incidents'),
    rows,
    href: (row) => `${buildItemPath('incident', formatItemRef('incident', row.item_number))}/overview`,
    label: (row) => row.title ?? formatItemRef('incident', row.item_number),
    editable: canEdit,
    removable: (row) => !locked(row.status),
    columns: [
      {
        key: 'ref',
        header: t('components.incidentRelations.columns.reference'),
        width: 72,
        render: (row) => <RelationRef>{formatItemRef('incident', row.item_number)}</RelationRef>,
      },
      { key: 'title', header: t('components.incidentRelations.columns.title'), render: (row) => row.title ?? DASH },
      {
        key: 'severity',
        header: t('components.incidentRelations.columns.severity'),
        width: 100,
        hideOrder: 2,
        render: (row) => (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <StatusDot color={getDotColor(INCIDENT_SEVERITY_COLORS[row.severity] || 'default', mode)} />
            {t(`enums.incidentSeverity.${row.severity}`, { defaultValue: row.severity })}
          </Box>
        ),
      },
      {
        key: 'status',
        header: t('components.incidentRelations.columns.status'),
        width: 100,
        render: (row) => t(`enums.incidentStatus.${row.status}`, { defaultValue: row.status }),
      },
      {
        key: 'detected',
        header: t('components.incidentRelations.columns.detected'),
        width: 110,
        hideOrder: 1,
        render: (row) => relationDate(row.detected_at, lang),
      },
    ],
    search: async (q, signal) => {
      const res = await api.get<{ items: IncidentRow[] }>('/incidents', {
        params: { page: 1, limit: PAGE, sort: 'detected_at:DESC', ...(q ? { q } : {}) },
        signal,
      });
      return (res.data?.items || [])
        .filter((row) => !locked(row.status))
        .map((row) => ({ id: row.id, label: row.title, ref: formatItemRef('incident', row.item_number) }));
    },
  };
}

type CodeLabel = (code: string | null) => string;

/** The reference the server already formatted (`APP-4`, `AST-2`, `TEC-9`). */
function storedRefColumn<T extends { reference: string | null }>(header: string): RelationsColumn<T> {
  return {
    key: 'ref',
    header,
    width: 72,
    render: (row) => <RelationRef>{row.reference || DASH}</RelationRef>,
  };
}

const recordHref = (type: 'application' | 'asset' | 'technology', row: { id: string; reference: string | null }) => (
  `${buildItemPath(type, row.reference || row.id)}/overview`
);

async function searchNamed(
  endpoint: string,
  q: string,
  signal: AbortSignal | undefined,
  sorted: boolean,
): Promise<Array<{ id: string; name: string; sequential_id?: string | null; asset_reference?: string | null; is_cluster?: boolean; cluster?: string | null }>> {
  const res = await api.get<{ items: Array<{ id: string; name: string; sequential_id?: string | null; asset_reference?: string | null; is_cluster?: boolean; cluster?: string | null }> }>(endpoint, {
    params: { page: 1, limit: PAGE, ...(sorted ? { sort: 'name:ASC' } : {}), ...(q ? { q } : {}) },
    signal,
  });
  return res.data?.items || [];
}

/**
 * Applications linked to the owner. A disabled or retired application stays listed, its name muted.
 * The picker searches the applications list (there is no lookup route).
 */
export function applicationsSection({
  t,
  rows,
  lifecycleLabel,
  criticalityLabel,
}: {
  t: TFunction;
  rows: ApplicationRelationRow[] | null;
  lifecycleLabel: CodeLabel;
  criticalityLabel: CodeLabel;
}): SectionSpec<ApplicationRelationRow> {
  return {
    kind: 'applications',
    title: t('workspace.application.relations.sections.applications'),
    empty: t('workspace.application.relations.empty.applications'),
    searchPlaceholder: t('workspace.application.relations.search.applications'),
    rows,
    href: (row) => recordHref('application', row),
    label: (row) => row.name,
    muted: (row) => row.status === 'disabled' || row.lifecycle === 'retired',
    columns: [
      storedRefColumn<ApplicationRelationRow>(columnsT(t, 'ref')),
      { key: 'name', header: columnsT(t, 'name'), render: (row) => row.name },
      { key: 'lifecycle', header: t('common.lifecycle'), width: 120, render: (row) => lifecycleLabel(row.lifecycle) },
      {
        key: 'criticality',
        header: t('classification.business_criticality'),
        width: 140,
        hideOrder: 1,
        render: (row) => criticalityLabel(row.business_criticality),
      },
    ],
    search: async (q, signal) => {
      const items = await searchNamed('/applications', q, signal, true);
      return items.map((row) => ({ id: row.id, label: row.name, ref: row.sequential_id ?? null }));
    },
  };
}

/**
 * Assets linked to the owner. A disabled or retired asset stays listed, its name muted.
 * The picker searches the assets list.
 */
export function assetsSection({
  t,
  rows,
  kindLabel,
  environmentLabel,
  statusLabel,
}: {
  t: TFunction;
  rows: AssetRelationRow[] | null;
  kindLabel: CodeLabel;
  environmentLabel: CodeLabel;
  statusLabel: CodeLabel;
}): SectionSpec<AssetRelationRow> {
  return {
    kind: 'assets',
    title: t('workspace.application.relations.sections.assets'),
    empty: t('workspace.application.relations.empty.assets'),
    searchPlaceholder: t('workspace.application.relations.search.assets'),
    rows,
    href: (row) => recordHref('asset', row),
    label: (row) => row.name,
    muted: (row) => row.status === 'retired' || row.status === 'disabled',
    columns: [
      storedRefColumn<AssetRelationRow>(columnsT(t, 'ref')),
      { key: 'name', header: columnsT(t, 'name'), render: (row) => row.name },
      { key: 'type', header: columnsT(t, 'type'), width: 140, render: (row) => kindLabel(row.kind) },
      { key: 'environment', header: t('pages.assets.columns.environment'), width: 120, hideOrder: 1, render: (row) => environmentLabel(row.environment) },
      { key: 'status', header: columnsT(t, 'status'), width: 110, render: (row) => statusLabel(row.status) },
    ],
    search: async (q, signal) => {
      const items = await searchNamed('/assets', q, signal, true);
      // A cluster is named as the server pickers name it.
      return items.map((row) => ({
        id: row.id,
        label: row.is_cluster ? `${t('common:selects.cluster')} ${row.name}` : row.name,
        ref: row.asset_reference ?? null,
        // Quick search matches a member by its cluster's name, so the option names that cluster.
        ...(!row.is_cluster && row.cluster
          ? { hint: t('workspace.application.relations.memberOfCluster', { cluster: row.cluster }) }
          : {}),
      }));
    },
  };
}

/**
 * Technologies linked to the owner. The payload has no lifecycle, so a row is never muted.
 * `rows` null (the caller cannot read the infrastructure) leaves the section out.
 * The picker searches `/technologies/lookup`.
 */
export function technologiesSection({
  t,
  rows,
  familyLabel,
}: {
  t: TFunction;
  rows: TechnologyRelationRow[] | null;
  familyLabel: CodeLabel;
}): SectionSpec<TechnologyRelationRow> {
  return {
    kind: 'technologies',
    title: t('workspace.application.relations.sections.technologies'),
    empty: t('workspace.application.relations.empty.technologies'),
    searchPlaceholder: t('workspace.application.relations.search.technologies'),
    rows,
    href: (row) => recordHref('technology', row),
    label: (row) => row.name,
    columns: [
      storedRefColumn<TechnologyRelationRow>(columnsT(t, 'ref')),
      { key: 'name', header: columnsT(t, 'name'), render: (row) => row.name },
      { key: 'family', header: columnsT(t, 'family'), width: 140, render: (row) => familyLabel(row.family) },
      { key: 'vendor', header: t('pages.technologies.columns.editor'), width: 140, hideOrder: 1, render: (row) => row.vendor || DASH },
    ],
    search: async (q, signal) => {
      const res = await api.get<{ items: Array<{ id: string; name: string; reference: string | null; editor: string | null }> }>('/technologies/lookup', {
        params: { limit: PAGE, ...(q ? { q } : {}) },
        signal,
      });
      return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name, ref: row.reference, hint: row.editor }));
    },
  };
}

/**
 * Business processes linked to the owner: the name, and the process owner.
 * A disabled process stays listed, its name muted. `rows` null leaves the section out.
 * The picker searches `/business-processes/lookup`. `editable` is the right to manage processes.
 */
export function processesSection({
  t,
  rows,
  editable = true,
}: {
  t: TFunction;
  rows: BusinessProcessRow[] | null;
  editable?: boolean;
}): SectionSpec<BusinessProcessRow> {
  return {
    kind: 'processes',
    title: t('workspace.application.relations.sections.processes'),
    empty: t('workspace.application.relations.empty.processes'),
    searchPlaceholder: t('workspace.application.relations.search.processes'),
    rows,
    editable,
    href: (row) => `/master-data/business-processes/${row.id}/overview`,
    label: (row) => row.name,
    muted: (row) => row.status === 'disabled',
    columns: [
      { key: 'name', header: columnsT(t, 'name'), render: (row) => row.name },
      { key: 'owner', header: columnsT(t, 'owner'), width: 180, hideOrder: 1, render: (row) => row.owner_name || DASH },
    ],
    search: async (q, signal) => {
      const res = await api.get<{ items: Array<{ id: string; name: string }> }>('/business-processes/lookup', {
        params: { limit: PAGE, ...(q ? { q } : {}) },
        signal,
      });
      return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name }));
    },
  };
}

/**
 * A conversion list (a project's source requests, a request's resulting projects).
 * Conversion writes these links: the section is read only, with no search.
 */
export function conversionSection({
  t,
  kind,
  type,
  title,
  empty,
  rows,
}: {
  t: TFunction;
  kind: string;
  type: 'request' | 'project';
  title: string;
  empty: string;
  rows: ConversionRow[] | null;
}): SectionSpec<ConversionRow> {
  return {
    kind,
    title,
    empty,
    searchPlaceholder: '',
    rows,
    editable: false,
    href: (row) => pathOf(type, row),
    label: (row) => row.name,
    columns: [
      relationRefColumn<ConversionRow>(type, columnsT(t, 'ref')),
      { key: 'name', header: columnsT(t, 'name'), render: (row) => row.name },
      {
        key: 'status',
        header: columnsT(t, 'status'),
        width: 140,
        render: (row) => (row.status ? t(`portfolio:statuses.${type}.${row.status}`, { defaultValue: row.status }) : DASH),
      },
    ],
    search: async () => [],
  };
}

/**
 * Interfaces linked to the owner, upstream or downstream (`kind`). A retired interface stays listed,
 * its name muted. The picker searches the interfaces list and never offers the owner itself.
 */
export function interfacesSection({
  t,
  kind,
  title,
  empty,
  rows,
  ownerId,
  lifecycleLabel,
}: {
  t: TFunction;
  kind: string;
  title: string;
  empty: string;
  rows: InterfaceRelationRow[] | null;
  ownerId: string;
  lifecycleLabel: CodeLabel;
}): SectionSpec<InterfaceRelationRow> {
  return {
    kind,
    title,
    empty,
    searchPlaceholder: t('workspace.interface.relations.search'),
    rows,
    href: (row) => `${buildItemPath('interface', row.reference || row.id)}/overview`,
    label: (row) => row.name,
    muted: (row) => row.lifecycle === 'retired',
    linkedIds: (linked) => new Set([ownerId, ...linked.map((row) => row.id)]),
    columns: [
      storedRefColumn<InterfaceRelationRow>(columnsT(t, 'ref')),
      { key: 'name', header: columnsT(t, 'name'), render: (row) => row.name },
      { key: 'source', header: t('pages.interfaces.columns.sourceApp'), width: 150, hideOrder: 2, render: (row) => row.source_application_name || DASH },
      { key: 'target', header: t('pages.interfaces.columns.targetApp'), width: 150, hideOrder: 1, render: (row) => row.target_application_name || DASH },
      { key: 'lifecycle', header: t('common.lifecycle'), width: 120, render: (row) => lifecycleLabel(row.lifecycle) },
    ],
    search: async (q, signal) => {
      const res = await api.get<{ items: Array<{ id: string; name: string; interface_reference: string | null; source_application_name?: string | null; target_application_name?: string | null }> }>('/interfaces', {
        params: { page: 1, limit: PAGE, sort: 'name:ASC', ...(q ? { q } : {}) },
        signal,
      });
      return (res.data?.items || []).map((row) => ({
        id: row.id,
        label: row.name,
        ref: row.interface_reference ?? null,
        hint: row.source_application_name && row.target_application_name
          ? `${row.source_application_name} → ${row.target_application_name}`
          : null,
      }));
    },
  };
}
