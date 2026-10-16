import React from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import useBudgetColumns from '../../../hooks/useBudgetColumns';
import { formatAmount } from '../../../i18n/formatters';
import { formatShortDate } from '../../../lib/dateFormat';
import { buildItemPath, formatItemRef } from '../../../utils/item-ref';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import RelationAddPicker, { type RelationOption } from '../../../components/workspace/RelationAddPicker';
import IncidentRelationsSection from '../editors/IncidentRelationsSection';

export type RelationKind = 'budget_lines' | 'contracts' | 'projects' | 'requests' | 'tasks';

type BudgetLineRow = { id: string; item_number: number | null; nature: 'opex' | 'capex'; product_name: string; supplier_name: string | null; amount: number | null; currency: string; status: string };
type ContractRow = { id: string; name: string; supplier_name: string | null; end_date: string | null; yearly_amount: number | null; currency: string | null; auto_renewal: boolean; in_renewal_window: boolean; status: string };
type ProjectRow = { id: string; item_number: number | null; name: string; status: string | null; planned_end: string | null };
type RequestRow = { id: string; item_number: number | null; name: string; status: string | null; target_delivery_date: string | null };
type TaskRow = { id: string; item_number: number | null; title: string; status: string | null; assignee_name: string | null; due_date: string | null };
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
  search: (q: string, signal?: AbortSignal) => Promise<RelationOption[]>;
};

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
 * The linked sections of an application's Relations tab (lot R1): one dense table per kind, read
 * in one round trip (`GET /applications/:id/relations`). A row opens its object; managers add by
 * server search and unlink on hover, each saved at once. Then the suggestions and the counts of
 * what is related elsewhere.
 */
export default function ApplicationRelationsTab({ id, onRelationsChange, onOpenKnowledge }: Props) {
  const { t, i18n } = useTranslation(['it', 'common', 'portfolio', 'ops']);
  const { hasLevel } = useAuth();
  const canEdit = hasLevel('applications', 'manager');
  const queryClient = useQueryClient();
  const budgetColumns = useBudgetColumns();
  const [adding, setAdding] = React.useState<RelationKind | null>(null);
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
            <Box component="span" sx={row.in_renewal_window && row.status !== 'disabled' ? { color: 'kanap.orange' } : undefined}>{date(row.end_date)}</Box>
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
        const linkedIds = new Set(rows.map((row) => row.id));
        return (
          <RelationsSection
            key={section.kind}
            title={section.title}
            count={data ? rows.length : undefined}
            onAdd={canEdit && data ? () => setAdding((current) => (current === section.kind ? null : section.kind)) : undefined}
            addLabel={t('workspace.application.relations.add')}
          >
            {adding === section.kind && (
              <RelationAddPicker
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
                onRemove={canEdit ? (row) => { void unlink(section.kind, row.id); } : undefined}
                removeLabel={(row) => t('workspace.application.relations.remove', { name: section.label(row) })}
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
