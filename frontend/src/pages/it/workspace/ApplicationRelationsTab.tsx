import React from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import useBudgetColumns from '../../../hooks/useBudgetColumns';
import useLocalizedItOpsSettings from '../../../hooks/useLocalizedItOpsSettings';
import { formatAmount } from '../../../i18n/formatters';
import { formatShortDate } from '../../../lib/dateFormat';
import { buildItemPath, formatItemRef } from '../../../utils/item-ref';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import RelationAddPicker, { type RelationOption } from '../../../components/workspace/RelationAddPicker';
import IncidentRelationsSection from '../editors/IncidentRelationsSection';

export type RelationKind = 'budget_lines' | 'contracts' | 'projects' | 'requests' | 'tasks' | 'technologies' | 'processes';

type BudgetLineRow = { id: string; item_number: number | null; nature: 'opex' | 'capex'; product_name: string; supplier_name: string | null; amount: number | null; currency: string; status: string };
type ContractRow = { id: string; name: string; supplier_name: string | null; end_date: string | null; yearly_amount: number | null; currency: string | null; auto_renewal: boolean; in_renewal_window: boolean; status: string };
type ProjectRow = { id: string; item_number: number | null; name: string; status: string | null; planned_end: string | null };
type RequestRow = { id: string; item_number: number | null; name: string; status: string | null; target_delivery_date: string | null };
type TaskRow = { id: string; item_number: number | null; title: string; status: string | null; assignee_name: string | null; due_date: string | null };
/** One technology, declared (removable) and/or hosted by a server of the application (lot T2a). */
type TechnologyRow = {
  id: string;
  reference: string | null;
  name: string | null;
  family: string | null;
  declared: boolean;
  hosted: boolean;
  versions: string[];
  version_unknown: boolean;
  standard_support_end: string | null;
  via: Array<{ asset_id: string; asset_name: string | null; host_name: string | null }>;
};
type ProcessRow = { id: string; name: string; status: string | null; owner_name: string | null };
type Suggestion = {
  type: 'budget_line' | 'contract' | 'project';
  id: string;
  item_number: number | null;
  name: string;
  via: { kind: 'same_supplier' | 'contract' | 'project' | 'task'; label: string | null };
};

export type ApplicationRelationsData = {
  year: number;
  budget_column: { key: string; label: string };
  budget_lines: BudgetLineRow[] | null;
  contracts: ContractRow[] | null;
  projects: ProjectRow[] | null;
  requests: RequestRow[] | null;
  tasks: TaskRow[] | null;
  technologies: TechnologyRow[] | null;
  processes: ProcessRow[] | null;
  suggestions: Suggestion[];
  also: { assets: number; interfaces: number; documents: number };
};

type AnyRow = { id: string };

/**
 * A section of the tab, as data: what it shows, where its rows lead, how its picker searches.
 * Written per kind so that another object (R2) can describe its own sections the same way.
 */
type SectionSpec<T extends AnyRow> = {
  kind: RelationKind;
  title: string;
  empty: string;
  searchPlaceholder: string;
  rows: T[] | null;
  columns: Array<RelationsColumn<T>>;
  href: (row: T) => string;
  label: (row: T) => string;
  muted?: (row: T) => boolean;
  /** Linking needs a right on the other module too (technologies, processes); true by default. */
  editable?: boolean;
  /** Rows that can be unlinked (all by default): a hosted technology cannot. */
  removable?: (row: T) => boolean;
  /** The rows the picker never offers (all by default). */
  linkedIds?: (rows: T[]) => Set<string>;
  search: (q: string, signal?: AbortSignal) => Promise<RelationOption[]>;
  /** Total lines under the table, shown from two rows on. */
  totals?: (rows: T[]) => Array<{ key: string; label: React.ReactNode; cells: Record<string, React.ReactNode> }>;
};

/** Totals appear from this many rows on (fried, 2026-10-16). */
const TOTALS_FROM = 2;

const SUGGESTION_KIND: Record<Suggestion['type'], RelationKind> = { budget_line: 'budget_lines', contract: 'contracts', project: 'projects' };
const DONE_TASK = new Set(['done', 'cancelled']);
const PAGE = 30;

export const applicationRelationsKey = (id: string) => ['application-relations', id] as const;

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const refOf = (type: 'budget' | 'project' | 'request' | 'task', itemNumber: number | null) => (itemNumber != null ? formatItemRef(type, itemNumber) : null);
const pathOf = (type: 'budget' | 'project' | 'request' | 'task', row: { id: string; item_number: number | null }) => buildItemPath(type, refOf(type, row.item_number) ?? row.id);

type Props = {
  id: string;
  /** Called after each link or unlink (the tab badge counts some of them). */
  onRelationsChange?: () => void;
  /** Opens the knowledge section of the Overview tab. */
  onOpenKnowledge?: () => void;
};

/**
 * The linked sections of an application's Relations tab (lot R1, technologies and business
 * processes from lot T2a): one dense table per kind, read
 * in one round trip (`GET /applications/:id/relations`). A row opens its object; managers add by
 * server search and unlink on hover, each saved at once. Then the suggestions and the counts of
 * what is related elsewhere.
 */
export default function ApplicationRelationsTab({ id, onRelationsChange, onOpenKnowledge }: Props) {
  const { t, i18n } = useTranslation(['it', 'common', 'portfolio', 'ops']);
  const { hasLevel } = useAuth();
  const canEdit = hasLevel('applications', 'manager');
  // Families in the user's language once the catalog localizes them; the raw code otherwise.
  const { data: itOpsSettings } = useLocalizedItOpsSettings();
  const technologyFamilies = (itOpsSettings as { technologyFamilies?: Array<{ code: string; label: string }> } | undefined)?.technologyFamilies;
  const queryClient = useQueryClient();
  const budgetColumns = useBudgetColumns();
  const [adding, setAdding] = React.useState<{ kind: RelationKind; anchor: HTMLElement } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const key = applicationRelationsKey(id);
  const lang = i18n.language;

  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<ApplicationRelationsData>(`/applications/${id}/relations`)).data,
  });

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    onRelationsChange?.();
  }, [queryClient, key, onRelationsChange]);

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [t]);

  const link = React.useCallback(async (kind: RelationKind, targetId: string) => {
    setError(null);
    // A suggestion leaves its list at once; the row appears in its section with the refetch.
    queryClient.setQueryData<ApplicationRelationsData>(key, (prev) => (prev ? { ...prev, suggestions: prev.suggestions.filter((s) => s.id !== targetId) } : prev));
    try {
      await api.post(`/applications/${id}/relations/${kind}`, { id: targetId });
    } catch (e) {
      failed(e);
    }
    await refresh();
  }, [failed, id, key, queryClient, refresh]);

  const unlink = React.useCallback(async (kind: RelationKind, targetId: string) => {
    setError(null);
    const previous = queryClient.getQueryData<ApplicationRelationsData>(key);
    queryClient.setQueryData<ApplicationRelationsData>(key, (prev) => {
      if (!prev) return prev;
      const rows = prev[kind] as AnyRow[] | null;
      if (kind === 'technologies' && rows) {
        // A technology also hosted by a server stays, as hosted only.
        const next = (rows as TechnologyRow[])
          .map((row) => (row.id === targetId ? { ...row, declared: false } : row))
          .filter((row) => row.declared || row.hosted);
        return { ...prev, technologies: next };
      }
      return { ...prev, [kind]: rows ? rows.filter((row) => row.id !== targetId) : rows };
    });
    try {
      await api.delete(`/applications/${id}/relations/${kind}/${targetId}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(key, previous);
      failed(e);
      return;
    }
    await refresh();
  }, [failed, id, key, queryClient, refresh]);

  const searchList = React.useCallback(
    (endpoint: string, type: 'project' | 'request' | 'task', labelOf: (row: any) => string) =>
      async (q: string, signal?: AbortSignal): Promise<RelationOption[]> => {
        const res = await api.get<{ items: any[] }>(endpoint, { params: { page: 1, limit: PAGE, sort: 'updated_at:DESC', ...(q ? { q } : {}) }, signal });
        return (res.data?.items || []).map((row) => ({ id: row.id, label: labelOf(row), ref: refOf(type, row.item_number ?? null) }));
      },
    [],
  );

  const year = data?.year ?? new Date().getFullYear();
  const today = todayYmd();
  const columnLabel = data ? budgetColumns.label(data.budget_column.key) : '';
  const lineCurrency = data?.budget_lines?.find((line) => line.currency)?.currency ?? null;
  const dash = '—';
  const statusText = (group: 'project' | 'request' | 'task', status: string | null) => (status ? t(`portfolio:statuses.${group}.${status}`, { defaultValue: status }) : dash);
  const date = (value: string | null) => (value ? formatShortDate(value, lang) : dash);
  const refColumn = <T extends { item_number: number | null }>(type: 'budget' | 'project' | 'request' | 'task'): RelationsColumn<T> => ({
    key: 'ref', header: t('workspace.application.relations.columns.ref'), width: 72,
    render: (row) => <RelationRef>{refOf(type, row.item_number) ?? dash}</RelationRef>,
  });

  const sections: Array<SectionSpec<any>> = [
    {
      kind: 'budget_lines',
      title: t('workspace.application.relations.sections.budgetLines'),
      empty: t('workspace.application.relations.empty.budgetLines'),
      searchPlaceholder: t('common:selects.searchBudgetLines'),
      rows: data ? data.budget_lines : [],
      href: (row: BudgetLineRow) => pathOf('budget', row),
      label: (row: BudgetLineRow) => row.product_name,
      muted: (row: BudgetLineRow) => row.status === 'disabled',
      columns: [
        refColumn<BudgetLineRow>('budget'),
        { key: 'name', header: t('workspace.application.relations.columns.name'), render: (row: BudgetLineRow) => row.product_name },
        { key: 'nature', header: t('workspace.application.relations.columns.nature'), width: 72, render: (row: BudgetLineRow) => t(`ops:budget.${row.nature}`) },
        { key: 'supplier', header: t('workspace.application.relations.columns.supplier'), width: 140, render: (row: BudgetLineRow) => row.supplier_name ?? dash },
        {
          key: 'amount', align: 'right', width: 130,
          header: lineCurrency ? `${columnLabel} ${year} (${lineCurrency})` : `${columnLabel} ${year}`,
          render: (row: BudgetLineRow) => (row.amount == null ? dash : formatAmount(row.amount)),
        },
      ],
      search: async (q, signal) => {
        const res = await api.get<{ items: Array<{ id: string; item_number: number | null; product_name: string; nature: 'opex' | 'capex' }> }>('/budget-lines/summary', {
          params: { page: 1, limit: PAGE, status: 'enabled', sort: 'product_name:ASC', q: q || undefined },
          signal,
        });
        return (res.data?.items || []).map((row) => ({ id: row.id, label: row.product_name, ref: refOf('budget', row.item_number ?? null), hint: t(`ops:budget.${row.nature}`) }));
      },
      // Every amount is in the reporting currency: one sum. A line without a budget for the year adds nothing.
      totals: (rows: BudgetLineRow[]) => {
        const amounts = rows.map((row) => row.amount).filter((amount): amount is number => amount != null);
        if (amounts.length === 0) return [];
        return [{ key: 'total', label: t('workspace.application.relations.total'), cells: { amount: formatAmount(amounts.reduce((sum, value) => sum + value, 0)) } }];
      },
    },
    {
      kind: 'contracts',
      title: t('workspace.application.relations.sections.contracts'),
      empty: t('workspace.application.relations.empty.contracts'),
      searchPlaceholder: t('workspace.application.relations.search.contracts'),
      rows: data ? data.contracts : [],
      href: (row: ContractRow) => `/ops/contracts/${row.id}/overview`,
      label: (row: ContractRow) => row.name,
      muted: (row: ContractRow) => row.status === 'disabled',
      columns: [
        { key: 'name', header: t('workspace.application.relations.columns.name'), render: (row: ContractRow) => row.name },
        { key: 'supplier', header: t('workspace.application.relations.columns.supplier'), width: 140, render: (row: ContractRow) => row.supplier_name ?? dash },
        {
          key: 'end', header: t('workspace.application.relations.columns.end'), width: 110,
          render: (row: ContractRow) => (
            <Box component="span" sx={row.in_renewal_window && row.status !== 'disabled' ? { color: 'kanap.orange' } : undefined}>
              {row.end_date ? formatShortDate(row.end_date, lang, { year: 'always' }) : dash}
            </Box>
          ),
        },
        {
          key: 'amount', align: 'right', width: 130, header: t('workspace.application.relations.columns.yearlyAmount'),
          render: (row: ContractRow) => (row.yearly_amount == null ? dash : `${formatAmount(row.yearly_amount)}${row.currency ? ` ${row.currency}` : ''}`),
        },
        {
          key: 'renewal', header: t('workspace.application.relations.columns.renewal'), width: 110,
          render: (row: ContractRow) => t(row.auto_renewal ? 'workspace.application.relations.renewal.tacit' : 'workspace.application.relations.renewal.manual'),
        },
      ],
      search: async (q, signal) => {
        const res = await api.get<{ items: Array<{ id: string; name: string }> }>('/contracts/lookup', { params: { limit: PAGE, ...(q ? { q } : {}) }, signal });
        return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name }));
      },
      // Active contracts only (a disabled one has ended), one total per currency: amounts in two
      // currencies are never added up.
      totals: (rows: ContractRow[]) => {
        const byCurrency = new Map<string, number>();
        rows.forEach((row) => {
          if (row.status === 'disabled' || row.yearly_amount == null) return;
          const currency = row.currency ?? '';
          byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + row.yearly_amount);
        });
        return [...byCurrency.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, sum]) => ({
            key: currency || 'none',
            label: t('workspace.application.relations.total'),
            cells: { amount: `${formatAmount(sum)}${currency ? ` ${currency}` : ''}` },
          }));
      },
    },
    {
      kind: 'projects',
      title: t('workspace.application.relations.sections.projects'),
      empty: t('workspace.application.relations.empty.projects'),
      searchPlaceholder: t('workspace.application.relations.search.projects'),
      rows: data ? data.projects : [],
      href: (row: ProjectRow) => pathOf('project', row),
      label: (row: ProjectRow) => row.name,
      columns: [
        refColumn<ProjectRow>('project'),
        { key: 'name', header: t('workspace.application.relations.columns.name'), render: (row: ProjectRow) => row.name },
        { key: 'status', header: t('workspace.application.relations.columns.status'), width: 120, render: (row: ProjectRow) => statusText('project', row.status) },
        { key: 'end', header: t('workspace.application.relations.columns.plannedEnd'), width: 120, render: (row: ProjectRow) => date(row.planned_end) },
      ],
      search: searchList('/portfolio/projects', 'project', (row) => row.name),
    },
    {
      kind: 'requests',
      title: t('workspace.application.relations.sections.requests'),
      empty: t('workspace.application.relations.empty.requests'),
      searchPlaceholder: t('workspace.application.relations.search.requests'),
      rows: data ? data.requests : [],
      href: (row: RequestRow) => pathOf('request', row),
      label: (row: RequestRow) => row.name,
      columns: [
        refColumn<RequestRow>('request'),
        { key: 'name', header: t('workspace.application.relations.columns.name'), render: (row: RequestRow) => row.name },
        { key: 'status', header: t('workspace.application.relations.columns.status'), width: 120, render: (row: RequestRow) => statusText('request', row.status) },
        { key: 'delivery', header: t('workspace.application.relations.columns.targetDelivery'), width: 140, render: (row: RequestRow) => date(row.target_delivery_date) },
      ],
      search: searchList('/portfolio/requests', 'request', (row) => row.name),
    },
    {
      kind: 'tasks',
      title: t('workspace.application.relations.sections.tasks'),
      empty: t('workspace.application.relations.empty.tasks'),
      searchPlaceholder: t('workspace.application.relations.searchTasks'),
      rows: data ? data.tasks : [],
      href: (row: TaskRow) => pathOf('task', row),
      label: (row: TaskRow) => row.title,
      columns: [
        refColumn<TaskRow>('task'),
        { key: 'title', header: t('workspace.application.relations.columns.title'), render: (row: TaskRow) => row.title },
        { key: 'status', header: t('workspace.application.relations.columns.status'), width: 100, render: (row: TaskRow) => statusText('task', row.status) },
        { key: 'assignee', header: t('workspace.application.relations.columns.assignee'), width: 140, render: (row: TaskRow) => row.assignee_name ?? dash },
        {
          key: 'due', header: t('workspace.application.relations.columns.due'), width: 110,
          render: (row: TaskRow) => {
            const late = !!row.due_date && row.due_date < today && !DONE_TASK.has(row.status ?? '');
            return <Box component="span" sx={late ? { color: 'kanap.orange' } : undefined}>{date(row.due_date)}</Box>;
          },
        },
      ],
      search: searchList('/tasks', 'task', (row) => row.title ?? ''),
    },
  ];

  const familyLabel = (code: string | null) => (code ? technologyFamilies?.find((family) => family.code === code)?.label ?? code : dash);
  const serverLabel = (via: TechnologyRow['via'][number]) => (via.host_name
    ? t('workspace.application.relations.viaHost', { server: via.asset_name ?? dash, host: via.host_name })
    : via.asset_name ?? dash);
  const technologyLink = (row: TechnologyRow) => (row.declared && row.hosted ? 'both' : row.declared ? 'declared' : 'hosted');

  sections.push(
    {
      kind: 'technologies',
      title: t('workspace.application.relations.sections.technologies'),
      empty: t('workspace.application.relations.empty.technologies'),
      searchPlaceholder: t('workspace.application.relations.search.technologies'),
      rows: data ? data.technologies : [],
      href: (row: TechnologyRow) => `/it/technologies/${row.reference ?? row.id}`,
      label: (row: TechnologyRow) => row.name ?? row.reference ?? '',
      editable: hasLevel('infrastructure', 'manager'),
      removable: (row: TechnologyRow) => row.declared,
      // A technology only hosted can still be declared.
      linkedIds: (rows: TechnologyRow[]) => new Set(rows.filter((row) => row.declared).map((row) => row.id)),
      columns: [
        { key: 'ref', header: t('workspace.application.relations.columns.ref'), width: 72, render: (row: TechnologyRow) => <RelationRef>{row.reference ?? dash}</RelationRef> },
        // The name takes the free width; the short columns stay narrow, a cut value shows in full on hover.
        { key: 'name', header: t('workspace.application.relations.columns.name'), render: (row: TechnologyRow) => <span title={row.name ?? undefined}>{row.name ?? dash}</span> },
        { key: 'family', header: t('workspace.application.relations.columns.family'), width: 110, render: (row: TechnologyRow) => familyLabel(row.family) },
        {
          key: 'version', header: t('workspace.application.relations.columns.version'), width: 72,
          render: (row: TechnologyRow) => (row.versions.length > 0
            ? <span title={row.versions.join(', ')}>{row.versions.join(', ')}</span>
            : <Box component="span" title={t('workspace.application.relations.versionUnknown')} sx={{ color: 'kanap.text.tertiary' }}>{dash}</Box>),
        },
        {
          key: 'link', header: t('workspace.application.relations.columns.link'), width: 120,
          render: (row: TechnologyRow) => {
            const label = t(`workspace.application.relations.technologyLink.${technologyLink(row)}`);
            return <span title={label}>{label}</span>;
          },
        },
        {
          key: 'via', header: t('workspace.application.relations.columns.via'), width: 140,
          render: (row: TechnologyRow) => {
            const servers = row.via.map(serverLabel).join(', ');
            return <span title={servers || undefined}>{servers}</span>;
          },
        },
        {
          key: 'supportEnd', header: t('workspace.application.relations.columns.supportEnd'), width: 100,
          render: (row: TechnologyRow) => {
            const ended = !!row.standard_support_end && row.standard_support_end < today;
            return (
              <Box component="span" sx={ended ? { color: 'kanap.orange' } : undefined}>
                {row.standard_support_end ? formatShortDate(row.standard_support_end, lang, { year: 'always' }) : dash}
              </Box>
            );
          },
        },
      ],
      search: async (q, signal) => {
        const res = await api.get<{ items: Array<{ id: string; name: string; reference: string | null; editor: string | null }> }>('/technologies/lookup', {
          params: { limit: PAGE, ...(q ? { q } : {}) },
          signal,
        });
        return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name, ref: row.reference, hint: row.editor }));
      },
    },
    {
      kind: 'processes',
      title: t('workspace.application.relations.sections.processes'),
      empty: t('workspace.application.relations.empty.processes'),
      searchPlaceholder: t('workspace.application.relations.search.processes'),
      rows: data ? data.processes : [],
      href: (row: ProcessRow) => `/master-data/business-processes/${row.id}/overview`,
      label: (row: ProcessRow) => row.name,
      muted: (row: ProcessRow) => row.status === 'disabled',
      editable: hasLevel('business_processes', 'manager'),
      columns: [
        { key: 'name', header: t('workspace.application.relations.columns.name'), render: (row: ProcessRow) => row.name },
        { key: 'owner', header: t('workspace.application.relations.columns.businessOwner'), width: 180, render: (row: ProcessRow) => row.owner_name ?? dash },
      ],
      search: async (q, signal) => {
        const res = await api.get<{ items: Array<{ id: string; name: string }> }>('/business-processes/lookup', { params: { limit: PAGE, ...(q ? { q } : {}) }, signal });
        return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name }));
      },
    },
  );

  const suggestionColumns: Array<RelationsColumn<Suggestion>> = [
    { key: 'type', header: t('workspace.application.relations.columns.type'), width: 130, render: (row) => t(`workspace.application.relations.types.${row.type}`) },
    {
      key: 'object', header: t('workspace.application.relations.columns.object'),
      render: (row) => {
        const ref = row.type === 'budget_line' ? refOf('budget', row.item_number) : row.type === 'project' ? refOf('project', row.item_number) : null;
        return <>{ref && <><RelationRef>{ref}</RelationRef>{'  '}</>}{row.name}</>;
      },
    },
    {
      key: 'via', header: t('workspace.application.relations.columns.via'), width: 200,
      render: (row) => (
        <Box component="span" sx={{ color: 'kanap.text.secondary' }}>
          {t(`workspace.application.relations.via.${row.via.kind}`, { label: row.via.label ?? '' })}
        </Box>
      ),
    },
  ];
  const suggestionHref = (row: Suggestion) => (
    row.type === 'contract' ? `/ops/contracts/${row.id}/overview` : pathOf(row.type === 'budget_line' ? 'budget' : 'project', row)
  );
  const suggestions = data?.suggestions ?? [];
  const also = data?.also;

  const alsoParts: React.ReactNode[] = [];
  if (also?.assets) {
    alsoParts.push(<Box key="assets" component={RouterLink} to={`/it/applications/${id}/deployments`}>{t('workspace.application.relations.also.assets', { count: also.assets })}</Box>);
  }
  if (also?.interfaces) {
    alsoParts.push(<Box key="interfaces" component={RouterLink} to={`/it/applications/${id}/interfaces`}>{t('workspace.application.relations.also.interfaces', { count: also.interfaces })}</Box>);
  }
  if (also?.documents) {
    alsoParts.push(onOpenKnowledge
      ? <Box key="documents" component="button" type="button" onClick={onOpenKnowledge} sx={{ all: 'unset', cursor: 'pointer' }}>{t('workspace.application.relations.also.documents', { count: also.documents })}</Box>
      : <Box key="documents" component="span">{t('workspace.application.relations.also.documents', { count: also.documents })}</Box>);
  }

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {sections.filter((section) => section.rows !== null).map((section) => {
        const rows = section.rows as AnyRow[];
        const linkedIds = section.linkedIds ? section.linkedIds(rows) : new Set(rows.map((row) => row.id));
        const editable = canEdit && (section.editable ?? true);
        return (
          <RelationsSection
            key={section.kind}
            title={section.title}
            count={data ? rows.length : undefined}
            onAdd={editable && data ? (anchor) => setAdding({ kind: section.kind, anchor }) : undefined}
            adding={adding?.kind === section.kind}
            addLabel={t('workspace.application.relations.add')}
          >
            {adding?.kind === section.kind && (
              <RelationAddPicker
                anchorEl={adding.anchor}
                searchKey={`application-${section.kind}`}
                search={section.search}
                excludeIds={linkedIds}
                placeholder={section.searchPlaceholder}
                ariaLabel={section.searchPlaceholder}
                onPick={(option) => { setAdding(null); void link(section.kind, option.id); }}
                onClose={() => setAdding(null)}
              />
            )}
            {rows.length === 0 ? (
              <RelationsEmpty>{section.empty}</RelationsEmpty>
            ) : (
              <RelationsTable
                ariaLabel={section.title}
                columns={section.columns}
                rows={rows}
                rowKey={(row) => row.id}
                rowHref={section.href}
                rowMuted={section.muted}
                onRemove={editable ? (row) => { void unlink(section.kind, row.id); } : undefined}
                removeLabel={(row) => t('workspace.application.relations.remove', { name: section.label(row) })}
                canRemove={section.removable}
                totals={rows.length >= TOTALS_FROM ? section.totals?.(rows) : undefined}
              />
            )}
          </RelationsSection>
        );
      })}

      <IncidentRelationsSection applicationId={id} />

      {suggestions.length > 0 && (
        <RelationsSection title={t('workspace.application.relations.sections.related')} count={t('workspace.application.relations.suggestions', { count: suggestions.length })}>
          <RelationsTable
            ariaLabel={t('workspace.application.relations.sections.related')}
            columns={suggestionColumns}
            rows={suggestions}
            rowKey={(row) => `${row.type}:${row.id}`}
            rowHref={suggestionHref}
            action={canEdit ? {
              width: 56,
              render: (row) => (
                <Button
                  variant="text"
                  size="small"
                  onClick={() => { void link(SUGGESTION_KIND[row.type], row.id); }}
                  aria-label={t('workspace.application.relations.linkNamed', { name: row.name })}
                  sx={{ fontSize: 12, minWidth: 0, p: '0 4px' }}
                >
                  {t('workspace.application.relations.link')}
                </Button>
              ),
            } : undefined}
          />
        </RelationsSection>
      )}

      {alsoParts.length > 0 && (
        <Typography
          sx={{
            fontSize: 12,
            color: 'kanap.text.secondary',
            mt: suggestions.length > 0 ? -1.5 : 0,
            '& a, & button': { color: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline', color: 'primary.main' } },
          }}
        >
          {t('workspace.application.relations.also.prefix')}{' '}
          {alsoParts.map((part, index) => (
            <React.Fragment key={index}>{index > 0 && ' · '}{part}</React.Fragment>
          ))}
        </Typography>
      )}
    </Stack>
  );
}
