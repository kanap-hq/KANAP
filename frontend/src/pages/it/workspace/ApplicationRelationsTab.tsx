import React from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import useBudgetColumns from '../../../hooks/useBudgetColumns';
import { useApplicationFeedback } from '../applicationFeedback';
import {
  DASH,
  RelationSections,
  budgetLinesSection,
  contractsSection,
  incidentsSection,
  pathOf,
  projectsSection,
  refOf,
  relationDate,
  relationRefColumn,
  RelationSuggestions,
  searchRelationItems,
  todayYmd,
  useRelations,
  type BudgetLineRow,
  type ContractRow,
  type IncidentLinkRow,
  type ProjectRow,
  type SectionSpec,
} from '../../../components/workspace/relations';

export type RelationKind = 'budget_lines' | 'contracts' | 'projects' | 'requests' | 'tasks' | 'technologies' | 'processes' | 'incidents';

type RequestRow = { id: string; item_number: number | null; name: string; status: string | null; target_delivery_date: string | null };
type TaskRow = { id: string; item_number: number | null; title: string; status: string | null; assignee_name: string | null; due_date: string | null };
/** One technology, declared (removable) and/or hosted by a server of the application (lot T2a). */
export type TechnologyRow = {
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
  /** The application's own links of the technology, one per version declared. */
  declarations?: Array<{ link_id: string; technology_version_id: string | null; version_label: string | null }>;
};
/** A server the application is deployed on, in service, with the environments and roles it has there. */
export type DeploymentServer = { asset_id: string; name: string; asset_reference: string | null; environments: string[]; roles: string[] };
export type ProcessRow = { id: string; name: string; status: string | null; owner_name: string | null };
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
  /** The linked lines `budget_lines` leaves out, counted: outside the caller's data access, or all without the budget right. */
  budget_lines_hidden?: number;
  contracts: ContractRow[] | null;
  /** The linked contracts `contracts` leaves out: outside the caller's data access. */
  contracts_hidden?: number;
  projects: ProjectRow[] | null;
  requests: RequestRow[] | null;
  tasks: TaskRow[] | null;
  technologies: TechnologyRow[] | null;
  deployment_servers?: DeploymentServer[] | null;
  /** Shown in the properties panel of the application (lot R1b). */
  processes: ProcessRow[] | null;
  incidents: IncidentLinkRow[] | null;
  suggestions: Suggestion[];
  also: { assets: number; interfaces: number; documents: number };
};

const SUGGESTION_KIND: Record<Suggestion['type'], RelationKind> = { budget_line: 'budget_lines', contract: 'contracts', project: 'projects' };
const DONE_TASK = new Set(['done', 'cancelled']);

export const applicationRelationsKey = (id: string) => ['application-relations', id] as const;

/** The tab in one round trip; the properties panel reads its business processes from the same query. */
export async function fetchApplicationRelations(id: string): Promise<ApplicationRelationsData> {
  return (await api.get<ApplicationRelationsData>(`/applications/${id}/relations`)).data;
}

type Props = {
  id: string;
  /** Called after each link or unlink (the tab badge counts some of them). */
  onRelationsChange?: () => void;
  /** Opens the knowledge section of the Overview tab. */
  onOpenKnowledge?: () => void;
};

/**
 * The linked sections of an application's Relations tab (lot R1, incidents from lot R1b).
 * Technologies are on the Operations tab, business processes in the properties panel. One dense table per kind, read in one round trip
 * (`GET /applications/:id/relations`). A row opens its object; managers add by server search and
 * unlink on hover, each saved at once. Then the suggestions and the counts of what is related
 * elsewhere.
 */
export default function ApplicationRelationsTab({ id, onRelationsChange, onOpenKnowledge }: Props) {
  const { t, i18n } = useTranslation(['it', 'common', 'portfolio', 'ops']);
  const theme = useTheme();
  const { hasLevel } = useAuth();
  const canEdit = hasLevel('applications', 'manager');
  const budgetColumns = useBudgetColumns();
  const key = applicationRelationsKey(id);
  const lang = i18n.language;
  const feedback = useApplicationFeedback();
  const { data, error, setError, link, unlink, loadError, reload } = useRelations<ApplicationRelationsData>({
    path: `/applications/${id}/relations`,
    queryKey: key,
    onChange: onRelationsChange,
    dropLinkedSuggestion: true,
  });

  const year = data?.year ?? new Date().getFullYear();
  const today = todayYmd();
  const columnLabel = data ? budgetColumns.label(data.budget_column.key) : '';
  const lineCurrency = data?.budget_lines?.find((line) => line.currency)?.currency ?? null;
  const statusText = (group: 'request' | 'task', status: string | null) => (status ? t(`portfolio:statuses.${group}.${status}`, { defaultValue: status }) : DASH);

  const sections: Array<SectionSpec<any>> = [
    budgetLinesSection({ t, rows: data ? data.budget_lines : [], year, columnLabel, currency: lineCurrency, hidden: data?.budget_lines_hidden }),
    contractsSection({ t, rows: data ? data.contracts : [], lang, hidden: data?.contracts_hidden }),
    projectsSection({ t, rows: data ? data.projects : [], lang }),
    {
      kind: 'requests',
      title: t('workspace.application.relations.sections.requests'),
      empty: t('workspace.application.relations.empty.requests'),
      searchPlaceholder: t('workspace.application.relations.search.requests'),
      rows: data ? data.requests : [],
      href: (row: RequestRow) => pathOf('request', row),
      label: (row: RequestRow) => row.name,
      columns: [
        relationRefColumn<RequestRow>('request', t('workspace.application.relations.columns.ref')),
        { key: 'name', header: t('workspace.application.relations.columns.name'), render: (row: RequestRow) => row.name },
        { key: 'status', header: t('workspace.application.relations.columns.status'), width: 120, render: (row: RequestRow) => statusText('request', row.status) },
        { key: 'delivery', header: t('workspace.application.relations.columns.targetDelivery'), width: 140, hideOrder: 1, render: (row: RequestRow) => relationDate(row.target_delivery_date, lang) },
      ],
      search: searchRelationItems('/portfolio/requests', 'request', (row) => row.name ?? ''),
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
        relationRefColumn<TaskRow>('task', t('workspace.application.relations.columns.ref')),
        { key: 'title', header: t('workspace.application.relations.columns.title'), render: (row: TaskRow) => row.title },
        { key: 'status', header: t('workspace.application.relations.columns.status'), width: 100, render: (row: TaskRow) => statusText('task', row.status) },
        { key: 'assignee', header: t('workspace.application.relations.columns.assignee'), width: 140, hideOrder: 1, render: (row: TaskRow) => row.assignee_name ?? DASH },
        {
          key: 'due', header: t('workspace.application.relations.columns.due'), width: 110, hideOrder: 2,
          render: (row: TaskRow) => {
            const late = !!row.due_date && row.due_date < today && !DONE_TASK.has(row.status ?? '');
            return <Box component="span" sx={late ? { color: 'kanap.orange' } : undefined}>{relationDate(row.due_date, lang)}</Box>;
          },
        },
      ],
      search: searchRelationItems('/tasks', 'task', (row) => row.title ?? ''),
    },
    incidentsSection({
      t,
      rows: data ? data.incidents : [],
      lang,
      canEdit: hasLevel('incidents', 'contributor'),
      mode: theme.palette.mode,
    }),
  ];

  const suggestions = data?.suggestions ?? [];
  const also = data?.also;

  const nameOf = (kind: string, targetId: string) => {
    const section = sections.find((item) => item.kind === kind);
    const row = (section?.rows as Array<{ id: string }> | null | undefined)?.find((item) => item.id === targetId);
    return section && row ? section.label(row) : '';
  };
  const handleLink = async (kind: string, targetId: string) => {
    await link(kind, targetId);
  };
  // Unlinking stays immediate; the message offers to put the link back.
  const handleUnlink = async (kind: string, targetId: string) => {
    const name = nameOf(kind, targetId);
    if (await unlink(kind, targetId)) {
      feedback.undo(t('workspace.application.relations.feedback.unlinked', { name }), async () => { await link(kind, targetId); });
    }
  };

  const alsoParts: React.ReactNode[] = [];
  if (also?.assets) {
    alsoParts.push(<Box key="assets" component={RouterLink} to="../deployments" relative="path">{t('workspace.application.relations.also.assets', { count: also.assets })}</Box>);
  }
  if (also?.interfaces) {
    alsoParts.push(<Box key="interfaces" component={RouterLink} to="../interfaces" relative="path">{t('workspace.application.relations.also.interfaces', { count: also.interfaces })}</Box>);
  }
  if (also?.documents) {
    alsoParts.push(onOpenKnowledge
      ? <Box key="documents" component="button" type="button" onClick={onOpenKnowledge} sx={{ all: 'unset', cursor: 'pointer' }}>{t('workspace.application.relations.also.documents', { count: also.documents })}</Box>
      : <Box key="documents" component="span">{t('workspace.application.relations.also.documents', { count: also.documents })}</Box>);
  }

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {loadError && (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={reload}>{t('common:buttons.retry')}</Button>}
        >
          {t('workspace.application.relations.loadFailed')}
        </Alert>
      )}
      {!loadError && !data && (
        <Box sx={{ display: 'flex', py: 2 }}>
          <CircularProgress size={20} aria-label={t('common:selects.loadingEllipsis')} />
        </Box>
      )}

      {data && (
      <RelationSections
        sections={sections}
        loaded
        canEdit={canEdit}
        searchKeyPrefix="application"
        onLink={(kind, targetId) => { void handleLink(kind, targetId); }}
        onUnlink={(kind, targetId) => { void handleUnlink(kind, targetId); }}
      />
      )}

      <RelationSuggestions
        suggestions={suggestions}
        canEdit={canEdit}
        referenceOf={(row) => (row.type === 'budget_line' ? refOf('budget', row.item_number) : row.type === 'project' ? refOf('project', row.item_number) : null)}
        href={(row) => (row.type === 'contract' ? `/ops/contracts/${row.id}/overview` : pathOf(row.type === 'budget_line' ? 'budget' : 'project', row))}
        onLink={(row) => { void handleLink(SUGGESTION_KIND[row.type], row.id); }}
      />

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
