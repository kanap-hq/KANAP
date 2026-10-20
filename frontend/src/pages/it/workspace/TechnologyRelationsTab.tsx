import React from 'react';
import { Alert, Box, IconButton, Link, Stack, TextField, useTheme } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import type { IncidentRow } from '../../../api/endpoints/incidents';
import { useAuth } from '../../../auth/AuthContext';
import { KanapDialog, PropertyRow, StatusDot, useKanapDialogs } from '../../../components/design';
import { normalizeWebsiteUrl } from '../../../components/design/RelevantWebsitesList';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import RelationAddPicker, { type RelationOption } from '../../../components/workspace/RelationAddPicker';
import useBudgetColumns from '../../../hooks/useBudgetColumns';
import { formatAmount } from '../../../i18n/formatters';
import FxMissingNotice, { FxMissingLocalAmount } from '../../../components/finance/FxMissingNotice';
import { fxMissingOfLines } from '../../../components/finance/fxMissing';
import { formatShortDate } from '../../../lib/dateFormat';
import { drawerFieldValueSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { buildItemPath, formatItemRef } from '../../../utils/item-ref';
import { getDotColor, INCIDENT_SEVERITY_COLORS } from '../../../utils/statusColors';
import { isIncidentLocked } from './incidentWorkspace';

export type TechnologyRelationKind = 'budget_lines' | 'contracts' | 'projects' | 'incidents';

type BudgetLineRow = {
  id: string;
  item_number: number | null;
  nature: 'opex' | 'capex';
  product_name: string;
  supplier_name: string | null;
  amount: number | null;
  currency: string;
  status: string;
  /** No rate for the year: `amount` is null, this is the amount in the line's own currency, left out of the total. */
  fx_missing?: { currency: string; amount: number };
};
type ContractRow = { id: string; name: string; supplier_name: string | null; end_date: string | null; yearly_amount: number | null; currency: string | null; auto_renewal: boolean; in_renewal_window: boolean; status: string };
type ProjectRow = { id: string; item_number: number | null; name: string; status: string | null; planned_end: string | null };
type IncidentLinkRow = { id: string; item_number: number; title: string | null; status: string; severity: string; detected_at: string | null };
type DocumentRow = { id: string; original_filename: string; mime_type: string | null; size: number; uploaded_at: string };
type WebLinkRow = { id: string; description: string | null; url: string; created_at: string };

export type TechnologyRelationsData = {
  year: number;
  budget_column: { key: string; label: string };
  budget_lines: BudgetLineRow[] | null;
  contracts: ContractRow[] | null;
  projects: ProjectRow[] | null;
  incidents: IncidentLinkRow[] | null;
  documents: DocumentRow[];
  links: WebLinkRow[];
};

type AnyRow = { id: string };

/** A linked section, as data: what it shows, where its rows lead, how its picker searches (as the application's tab). */
type SectionSpec<T extends AnyRow> = {
  kind: TechnologyRelationKind;
  title: string;
  empty: string;
  searchPlaceholder: string;
  rows: T[] | null;
  columns: Array<RelationsColumn<T>>;
  href: (row: T) => string;
  label: (row: T) => string;
  muted?: (row: T) => boolean;
  /** Linking needs a right on the other module too (incidents); true by default. */
  editable?: boolean;
  /** Rows that can be unlinked (all by default): a closed incident cannot. */
  removable?: (row: T) => boolean;
  search: (q: string, signal?: AbortSignal) => Promise<RelationOption[]>;
  /** Total lines under the table, shown from two rows on. */
  totals?: (rows: T[]) => Array<{ key: string; label: React.ReactNode; cells: Record<string, React.ReactNode> }>;
  /** A line under the table (what its totals leave out). */
  notice?: (rows: T[]) => React.ReactNode;
};

/** Totals appear from this many rows on, as on the application's tab. */
const TOTALS_FROM = 2;
const PAGE = 30;

export const technologyRelationsKey = (id: string) => ['technology-relations', id] as const;

export async function fetchTechnologyRelations(id: string): Promise<TechnologyRelationsData> {
  return (await api.get<TechnologyRelationsData>(`/technologies/${id}/relations`)).data;
}

/** The tab badge: the rows of every section the caller can see. */
export function technologyRelationsCount(data: TechnologyRelationsData | undefined): number | undefined {
  if (!data) return undefined;
  return [data.budget_lines, data.contracts, data.projects, data.incidents, data.documents, data.links]
    .reduce((sum, rows) => sum + (rows ? rows.length : 0), 0);
}

const refOf = (type: 'budget' | 'project' | 'incident', itemNumber: number | null) => (itemNumber != null ? formatItemRef(type, itemNumber) : null);

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** A file size in the user's language (`12 kB`, `1.4 MB`). */
function formatSize(bytes: number, lang: string): string {
  const [value, unit, digits] = bytes < 1024 ? [bytes, 'byte', 0] : bytes < 1024 * 1024 ? [bytes / 1024, 'kilobyte', 0] : [bytes / (1024 * 1024), 'megabyte', 1];
  return new Intl.NumberFormat(lang, { style: 'unit', unit: unit as string, unitDisplay: 'short', maximumFractionDigits: digits as number }).format(value as number);
}

/**
 * The Relations tab of a technology, on the model of the application's: budget lines, contracts,
 * projects and incidents read in one round trip (`GET /technologies/:id/relations`), each linked
 * or unlinked at once; a section whose module the caller cannot read is absent. Then the
 * documents and the web links of the technology. Each section is one entry of the stack below, so
 * a later section is one more line at its end.
 */
export default function TechnologyRelationsTab({ id }: { id: string }) {
  const { t, i18n } = useTranslation(['it', 'common', 'portfolio', 'ops']);
  const theme = useTheme();
  const { hasLevel } = useAuth();
  const dialogs = useKanapDialogs();
  const canEdit = hasLevel('infrastructure', 'member');
  const queryClient = useQueryClient();
  const budgetColumns = useBudgetColumns();
  const [adding, setAdding] = React.useState<{ kind: TechnologyRelationKind; anchor: HTMLElement } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [linkDraft, setLinkDraft] = React.useState({ description: '', url: '' });
  /** The link the dialog edits; null when it adds one. */
  const [editingLink, setEditingLink] = React.useState<WebLinkRow | null>(null);
  const [savingLink, setSavingLink] = React.useState(false);
  const [uploading, setUploading] = React.useState(0);
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const key = technologyRelationsKey(id);
  const lang = i18n.language;

  const { data } = useQuery({ queryKey: key, queryFn: () => fetchTechnologyRelations(id) });

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [t]);

  const link = React.useCallback(async (kind: TechnologyRelationKind, targetId: string) => {
    setError(null);
    try {
      await api.post(`/technologies/${id}/relations/${kind}`, { id: targetId });
    } catch (e) {
      failed(e);
    }
    await refresh();
  }, [failed, id, refresh]);

  const unlink = React.useCallback(async (kind: TechnologyRelationKind, targetId: string) => {
    setError(null);
    const previous = queryClient.getQueryData<TechnologyRelationsData>(key);
    queryClient.setQueryData<TechnologyRelationsData>(key, (prev) => {
      if (!prev) return prev;
      const rows = prev[kind] as AnyRow[] | null;
      return { ...prev, [kind]: rows ? rows.filter((row) => row.id !== targetId) : rows };
    });
    try {
      await api.delete(`/technologies/${id}/relations/${kind}/${targetId}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(key, previous);
      failed(e);
      return;
    }
    await refresh();
  }, [failed, id, key, queryClient, refresh]);

  const year = data?.year ?? new Date().getFullYear();
  const today = todayYmd();
  const columnLabel = data ? budgetColumns.label(data.budget_column.key) : '';
  const lineCurrency = data?.budget_lines?.find((line) => line.currency)?.currency ?? null;
  const dash = '—';
  const date = (value: string | null) => (value ? formatShortDate(value, lang) : dash);
  const columnsT = (name: string) => t(`workspace.application.relations.columns.${name}`);

  const sections: Array<SectionSpec<any>> = [
    {
      kind: 'budget_lines',
      title: t('workspace.application.relations.sections.budgetLines'),
      empty: t('workspace.application.relations.empty.budgetLines'),
      searchPlaceholder: t('common:selects.searchBudgetLines'),
      rows: data ? data.budget_lines : [],
      href: (row: BudgetLineRow) => buildItemPath('budget', refOf('budget', row.item_number) ?? row.id),
      label: (row: BudgetLineRow) => row.product_name,
      muted: (row: BudgetLineRow) => row.status === 'disabled',
      columns: [
        { key: 'ref', header: columnsT('ref'), width: 72, render: (row: BudgetLineRow) => <RelationRef>{refOf('budget', row.item_number) ?? dash}</RelationRef> },
        { key: 'name', header: columnsT('name'), render: (row: BudgetLineRow) => row.product_name },
        { key: 'nature', header: columnsT('nature'), width: 72, render: (row: BudgetLineRow) => t(`ops:budget.${row.nature}`) },
        { key: 'supplier', header: columnsT('supplier'), width: 140, hideOrder: 1, render: (row: BudgetLineRow) => row.supplier_name ?? dash },
        {
          key: 'amount', align: 'right', width: 130,
          header: lineCurrency ? `${columnLabel} ${year} (${lineCurrency})` : `${columnLabel} ${year}`,
          render: (row: BudgetLineRow) => (row.amount != null
            ? formatAmount(row.amount)
            : row.fx_missing ? <FxMissingLocalAmount amount={row.fx_missing.amount} currency={row.fx_missing.currency} year={year} /> : dash),
        },
      ],
      search: async (q, signal) => {
        const res = await api.get<{ items: Array<{ id: string; item_number: number | null; product_name: string; nature: 'opex' | 'capex' }> }>('/budget-lines/summary', {
          params: { page: 1, limit: PAGE, status: 'enabled', sort: 'product_name:ASC', q: q || undefined },
          signal,
        });
        return (res.data?.items || []).map((row) => ({ id: row.id, label: row.product_name, ref: refOf('budget', row.item_number ?? null), hint: t(`ops:budget.${row.nature}`) }));
      },
      // Every amount is in the reporting currency: one sum.
      totals: (rows: BudgetLineRow[]) => {
        const amounts = rows.map((row) => row.amount).filter((amount): amount is number => amount != null);
        if (amounts.length === 0) return [];
        return [{ key: 'total', label: t('workspace.application.relations.total'), cells: { amount: formatAmount(amounts.reduce((sum, value) => sum + value, 0)) } }];
      },
      // A line without a rate is shown in its own currency and left out of the total: the notice names it.
      notice: (rows: BudgetLineRow[]) => <FxMissingNotice items={fxMissingOfLines(rows, year)} sx={{ mt: 0.75 }} />,
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
        { key: 'name', header: columnsT('name'), render: (row: ContractRow) => row.name },
        { key: 'supplier', header: columnsT('supplier'), width: 140, hideOrder: 2, render: (row: ContractRow) => row.supplier_name ?? dash },
        {
          key: 'end', header: columnsT('end'), width: 110,
          render: (row: ContractRow) => (
            <Box component="span" sx={row.in_renewal_window && row.status !== 'disabled' ? { color: 'kanap.orange' } : undefined}>
              {row.end_date ? formatShortDate(row.end_date, lang, { year: 'always' }) : dash}
            </Box>
          ),
        },
        {
          key: 'amount', align: 'right', width: 130, header: columnsT('yearlyAmount'),
          render: (row: ContractRow) => (row.yearly_amount == null ? dash : `${formatAmount(row.yearly_amount)}${row.currency ? ` ${row.currency}` : ''}`),
        },
        {
          key: 'renewal', header: columnsT('renewal'), width: 110, hideOrder: 1,
          render: (row: ContractRow) => t(row.auto_renewal ? 'workspace.application.relations.renewal.tacit' : 'workspace.application.relations.renewal.manual'),
        },
      ],
      search: async (q, signal) => {
        const res = await api.get<{ items: Array<{ id: string; name: string }> }>('/contracts/lookup', { params: { limit: PAGE, ...(q ? { q } : {}) }, signal });
        return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name }));
      },
      // Active contracts only, one total per currency: amounts in two currencies are never added up.
      totals: (rows: ContractRow[]) => {
        const byCurrency = new Map<string, number>();
        rows.forEach((row) => {
          if (row.status === 'disabled' || row.yearly_amount == null) return;
          const currency = row.currency ?? '';
          byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + row.yearly_amount);
        });
        return [...byCurrency.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, sum]) => ({ key: currency || 'none', label: t('workspace.application.relations.total'), cells: { amount: `${formatAmount(sum)}${currency ? ` ${currency}` : ''}` } }));
      },
    },
    {
      kind: 'projects',
      title: t('workspace.application.relations.sections.projects'),
      empty: t('workspace.application.relations.empty.projects'),
      searchPlaceholder: t('workspace.application.relations.search.projects'),
      rows: data ? data.projects : [],
      href: (row: ProjectRow) => buildItemPath('project', refOf('project', row.item_number) ?? row.id),
      label: (row: ProjectRow) => row.name,
      columns: [
        { key: 'ref', header: columnsT('ref'), width: 72, render: (row: ProjectRow) => <RelationRef>{refOf('project', row.item_number) ?? dash}</RelationRef> },
        { key: 'name', header: columnsT('name'), render: (row: ProjectRow) => row.name },
        { key: 'status', header: columnsT('status'), width: 120, render: (row: ProjectRow) => (row.status ? t(`portfolio:statuses.project.${row.status}`, { defaultValue: row.status }) : dash) },
        { key: 'end', header: columnsT('plannedEnd'), width: 120, hideOrder: 1, render: (row: ProjectRow) => date(row.planned_end) },
      ],
      search: async (q, signal) => {
        const res = await api.get<{ items: Array<{ id: string; name: string; item_number: number | null }> }>('/portfolio/projects', { params: { page: 1, limit: PAGE, sort: 'updated_at:DESC', ...(q ? { q } : {}) }, signal });
        return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name, ref: refOf('project', row.item_number ?? null) }));
      },
    },
    {
      kind: 'incidents',
      title: t('components.incidentRelations.title'),
      empty: t('workspace.technology.relations.empty.incidents'),
      searchPlaceholder: t('workspace.technology.relations.search.incidents'),
      rows: data ? data.incidents : [],
      href: (row: IncidentLinkRow) => `${buildItemPath('incident', formatItemRef('incident', row.item_number))}/overview`,
      label: (row: IncidentLinkRow) => row.title ?? formatItemRef('incident', row.item_number),
      // Linking writes in the incident's journal: it takes the right to edit incidents; a closed incident is frozen.
      editable: hasLevel('incidents', 'contributor'),
      removable: (row: IncidentLinkRow) => !isIncidentLocked(row.status as IncidentRow['status']),
      columns: [
        { key: 'ref', header: t('components.incidentRelations.columns.reference'), width: 72, render: (row: IncidentLinkRow) => <RelationRef>{formatItemRef('incident', row.item_number)}</RelationRef> },
        { key: 'title', header: t('components.incidentRelations.columns.title'), render: (row: IncidentLinkRow) => row.title ?? dash },
        {
          key: 'severity', header: t('components.incidentRelations.columns.severity'), width: 100, hideOrder: 2,
          render: (row: IncidentLinkRow) => (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <StatusDot color={getDotColor(INCIDENT_SEVERITY_COLORS[row.severity] || 'default', theme.palette.mode)} />
              {t(`enums.incidentSeverity.${row.severity}`, { defaultValue: row.severity })}
            </Box>
          ),
        },
        { key: 'status', header: t('components.incidentRelations.columns.status'), width: 100, render: (row: IncidentLinkRow) => t(`enums.incidentStatus.${row.status}`, { defaultValue: row.status }) },
        { key: 'detected', header: t('components.incidentRelations.columns.detected'), width: 110, hideOrder: 1, render: (row: IncidentLinkRow) => date(row.detected_at) },
      ],
      search: async (q, signal) => {
        const res = await api.get<{ items: IncidentRow[] }>('/incidents', { params: { page: 1, limit: PAGE, sort: 'detected_at:DESC', ...(q ? { q } : {}) }, signal });
        // A closed or cancelled incident cannot take a new link.
        return (res.data?.items || [])
          .filter((row) => !isIncidentLocked(row.status))
          .map((row) => ({ id: row.id, label: row.title, ref: formatItemRef('incident', row.item_number) }));
      },
    },
  ];

  // ----- Documents and web links: the technology's own rows -----

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    setUploading(files.length);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        await api.post(`/technologies/${id}/attachments`, form);
      }
    } catch (e) {
      failed(e);
    } finally {
      setUploading(0);
      if (fileInput.current) fileInput.current.value = '';
    }
    await refresh();
  };

  const downloadDocument = async (row: DocumentRow) => {
    try {
      const res = await api.get(`/technologies/attachments/${row.id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = row.original_filename;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      failed(e);
    }
  };

  const deleteDocument = async (row: DocumentRow) => {
    const ok = await dialogs.confirm({
      message: t('workspace.application.relations.deleteAttachment', { name: row.original_filename }),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    });
    if (!ok) return;
    setError(null);
    try {
      await api.delete(`/technologies/attachments/${row.id}`);
    } catch (e) {
      failed(e);
    }
    await refresh();
  };

  const openLinkDialog = (row: WebLinkRow | null) => {
    setEditingLink(row);
    setLinkDraft({ description: row?.description ?? '', url: row?.url ?? '' });
    setLinkDialogOpen(true);
  };

  const saveLink = async () => {
    const url = linkDraft.url.trim();
    if (!url) return;
    setSavingLink(true);
    setError(null);
    const body = { url, description: linkDraft.description.trim() || null };
    try {
      if (editingLink) await api.patch(`/technologies/${id}/links/${editingLink.id}`, body);
      else await api.post(`/technologies/${id}/links`, body);
      setLinkDialogOpen(false);
      setEditingLink(null);
      setLinkDraft({ description: '', url: '' });
    } catch (e) {
      failed(e);
    } finally {
      setSavingLink(false);
    }
    await refresh();
  };

  const deleteLink = async (row: WebLinkRow) => {
    setError(null);
    try {
      await api.delete(`/technologies/${id}/links/${row.id}`);
    } catch (e) {
      failed(e);
    }
    await refresh();
  };

  const documents = data?.documents ?? [];
  const webLinks = data?.links ?? [];
  const documentColumns: Array<RelationsColumn<DocumentRow>> = [
    {
      key: 'name', header: columnsT('name'),
      render: (row) => (
        <Link component="button" type="button" underline="hover" color="inherit" onClick={() => { void downloadDocument(row); }} sx={{ fontSize: 13, textAlign: 'left' }}>
          {row.original_filename}
        </Link>
      ),
    },
    { key: 'size', header: t('workspace.technology.relations.columns.size'), width: 90, align: 'right', render: (row) => formatSize(row.size, lang) },
    { key: 'added', header: t('workspace.technology.relations.columns.added'), width: 110, hideOrder: 1, render: (row) => date(row.uploaded_at) },
  ];
  const linkColumns: Array<RelationsColumn<WebLinkRow>> = [
    {
      key: 'name', header: columnsT('name'), width: 220,
      render: (row) => (
        <Link href={normalizeWebsiteUrl(row.url)} target="_blank" rel="noopener noreferrer" underline="hover" color="inherit">
          {row.description || row.url}
        </Link>
      ),
    },
    { key: 'url', header: t('workspace.technology.relations.columns.url'), render: (row) => <Box component="span" title={row.url} sx={{ color: 'kanap.text.secondary' }}>{row.url}</Box> },
    // Shown on row hover, as the remove action of the table.
    ...(canEdit ? [{
      key: 'edit', header: '', width: 32,
      render: (row: WebLinkRow) => (
        <IconButton
          className="relations-remove"
          size="small"
          aria-label={t('workspace.technology.relations.editLink', { name: row.description || row.url })}
          onClick={() => openLinkDialog(row)}
          sx={{ p: '2px', color: 'kanap.text.tertiary' }}
        >
          <EditOutlinedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      ),
    }] : []),
  ];

  const linkedSections = sections.filter((section) => section.rows !== null).map((section) => {
    const rows = section.rows as AnyRow[];
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
            searchKey={`technology-${section.kind}`}
            search={section.search}
            excludeIds={new Set(rows.map((row) => row.id))}
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
        {rows.length > 0 && section.notice?.(rows)}
      </RelationsSection>
    );
  });

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {linkedSections}

      <RelationsSection
        title={t('workspace.technology.relations.sections.documents')}
        count={data ? (uploading ? t('workspace.application.relations.uploadingFiles', { count: uploading }) : documents.length) : undefined}
        onAdd={canEdit && data && !uploading ? () => fileInput.current?.click() : undefined}
        addLabel={t('workspace.application.relations.add')}
      >
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          aria-label={t('workspace.technology.relations.sections.documents')}
          onChange={(event) => { void uploadFiles(Array.from(event.target.files || [])); }}
        />
        {documents.length === 0 ? (
          <RelationsEmpty>{t('workspace.technology.relations.empty.documents')}</RelationsEmpty>
        ) : (
          <RelationsTable
            ariaLabel={t('workspace.technology.relations.sections.documents')}
            columns={documentColumns}
            rows={documents}
            rowKey={(row) => row.id}
            onRemove={canEdit ? (row) => { void deleteDocument(row); } : undefined}
            removeLabel={(row) => t('workspace.application.relations.remove', { name: row.original_filename })}
          />
        )}
      </RelationsSection>

      <RelationsSection
        title={t('workspace.technology.relations.sections.links')}
        count={data ? webLinks.length : undefined}
        onAdd={canEdit && data ? () => openLinkDialog(null) : undefined}
        addLabel={t('workspace.application.relations.add')}
      >
        {webLinks.length === 0 ? (
          <RelationsEmpty>{t('workspace.technology.relations.empty.links')}</RelationsEmpty>
        ) : (
          <RelationsTable
            ariaLabel={t('workspace.technology.relations.sections.links')}
            columns={linkColumns}
            rows={webLinks}
            rowKey={(row) => row.id}
            onRemove={canEdit ? (row) => { void deleteLink(row); } : undefined}
            removeLabel={(row) => t('workspace.application.relations.remove', { name: row.description || row.url })}
          />
        )}
      </RelationsSection>

      <KanapDialog
        open={linkDialogOpen}
        title={editingLink ? t('workspace.technology.relations.editLinkTitle') : t('workspace.technology.relations.newLink')}
        onClose={() => setLinkDialogOpen(false)}
        onSave={saveLink}
        saveLabel={editingLink ? t('common:buttons.save') : t('common:buttons.add')}
        saveDisabled={!linkDraft.url.trim()}
        saveLoading={savingLink}
      >
        <Stack spacing={1.25}>
          <PropertyRow label={columnsT('name')}>
            <TextField
              value={linkDraft.description}
              onChange={(event) => setLinkDraft((prev) => ({ ...prev, description: event.target.value }))}
              variant="standard"
              fullWidth
              placeholder={t('workspace.technology.relations.placeholders.linkName')}
              inputProps={{ 'aria-label': columnsT('name') }}
              sx={drawerFieldValueSx}
            />
          </PropertyRow>
          <PropertyRow label={t('workspace.technology.relations.columns.url')} required>
            <TextField
              value={linkDraft.url}
              onChange={(event) => setLinkDraft((prev) => ({ ...prev, url: event.target.value }))}
              variant="standard"
              fullWidth
              placeholder={t('workspace.technology.relations.placeholders.url')}
              inputProps={{ 'aria-label': t('workspace.technology.relations.columns.url') }}
              sx={drawerFieldValueSx}
            />
          </PropertyRow>
        </Stack>
      </KanapDialog>
    </Stack>
  );
}
