import React from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  IconButton,
  Link,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import LinkIcon from '@mui/icons-material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { KanapDialog, PropertyRow } from './design';
import KnowledgeLinkPickerDialog, { type KnowledgeLinkOption } from './knowledge/KnowledgeLinkPickerDialog';
import { drawerMenuItemSx, drawerSelectSx } from '../theme/formSx';
import { useLocale } from '../i18n/useLocale';
import { formatShortDate } from '../lib/dateFormat';

export type EntityKnowledgeType =
  | 'applications'
  | 'assets'
  | 'projects'
  | 'requests'
  | 'tasks'
  | 'locations'
  | 'connections'
  | 'interfaces'
  | 'incidents';

type EntityKnowledgePanelProps = {
  entityType: EntityKnowledgeType;
  entityId: string;
  canCreate?: boolean;
  controlsMaxWidth?: number | string;
  variant?: 'default' | 'sidebar';
};

type DocumentListItem = KnowledgeLinkOption;

type DocumentLibrary = {
  id: string;
  name: string;
  slug: string;
  is_system: boolean;
  display_order: number;
};

type TemplateListItem = {
  id: string;
  item_number: number;
  title: string;
  document_type_id: string | null;
  document_type_name: string | null;
};

type DocumentDetailsResponse = {
  id: string;
  item_number: number;
  item_ref?: string;
  relations?: Partial<Record<EntityKnowledgeType, Array<string | { id?: string | null }>>>;
};

type KnowledgeContextSource = {
  entity_type: EntityKnowledgeType;
  entity_id: string;
  item_number: number | null;
  item_ref?: string | null;
  name: string;
  status: string | null;
};

type KnowledgeContextItem = {
  id: string;
  item_number: number;
  title: string;
  summary: string | null;
  status: string;
  updated_at: string | null;
  created_at: string | null;
  provenance: KnowledgeContextSource[];
};

type KnowledgeContextGroup = {
  key:
    | 'direct'
    | 'resulting_projects'
    | 'source_requests'
    | 'dependencies'
    | 'linked_requests'
    | 'linked_projects'
    | 'linked_applications'
    | 'linked_assets';
  label: string;
  linked_via_label: string;
  total: number;
  items: KnowledgeContextItem[];
};

type DisplayKnowledgeContextItem = KnowledgeContextItem & {
  linked_via_label: string;
};

type DisplayKnowledgeContextGroup = {
  key: 'direct' | 'related_documents';
  label: string;
  total: number;
  items: DisplayKnowledgeContextItem[];
};

type KnowledgeContextResponse = {
  access: 'granted' | 'restricted';
  total: number;
  groups: KnowledgeContextGroup[];
};

const ENTITY_ENDPOINTS: Record<EntityKnowledgeType, string> = {
  applications: '/applications',
  assets: '/assets',
  projects: '/portfolio/projects',
  requests: '/portfolio/requests',
  tasks: '/tasks',
  locations: '/locations',
  connections: '/connections',
  interfaces: '/interfaces',
  incidents: '/incidents',
};

const ENTITY_REF_PREFIXES: Partial<Record<EntityKnowledgeType, string>> = {
  applications: 'APP',
  assets: 'AST',
  projects: 'PRJ',
  requests: 'REQ',
  tasks: 'T',
  locations: 'LOC',
  connections: 'CONN',
  interfaces: 'INT',
  incidents: 'INC',
};

const RELATION_KEYS: Record<EntityKnowledgeType, string> = {
  applications: 'applications',
  assets: 'assets',
  projects: 'projects',
  requests: 'requests',
  tasks: 'tasks',
  locations: 'locations',
  connections: 'connections',
  interfaces: 'interfaces',
  incidents: 'incidents',
};

const RELATION_BODY_KEYS: Record<EntityKnowledgeType, string> = {
  applications: 'application_ids',
  assets: 'asset_ids',
  projects: 'project_ids',
  requests: 'request_ids',
  tasks: 'task_ids',
  locations: 'location_ids',
  connections: 'connection_ids',
  interfaces: 'interface_ids',
  incidents: 'incident_ids',
};

const TEMPLATE_LIBRARY_SLUG = 'templates';

function uniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function mergeProvenance(
  current: KnowledgeContextSource[],
  next: KnowledgeContextSource[],
): KnowledgeContextSource[] {
  const byKey = new Map<string, KnowledgeContextSource>();
  for (const source of [...current, ...next]) {
    byKey.set(`${source.entity_type}:${source.entity_id}`, source);
  }
  return Array.from(byKey.values());
}

function dedupeKnowledgeItems(
  items: DisplayKnowledgeContextItem[],
): DisplayKnowledgeContextItem[] {
  const byId = new Map<string, DisplayKnowledgeContextItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }

    const linkedViaLabels = uniqueIds([
      existing.linked_via_label,
      item.linked_via_label,
    ]);
    byId.set(item.id, {
      ...existing,
      linked_via_label: linkedViaLabels.join(' · '),
      provenance: mergeProvenance(existing.provenance, item.provenance),
    });
  }
  return Array.from(byId.values());
}

function formatSourceLabel(source: KnowledgeContextSource): string {
  const prefix = ENTITY_REF_PREFIXES[source.entity_type];
  const ref = source.item_ref || (prefix && source.item_number != null ? `${prefix}-${source.item_number}` : null);
  const name = String(source.name || '').trim();
  if (ref && name) return `${ref} ${name}`;
  return ref || name || source.entity_id;
}

function sourceHref(source: KnowledgeContextSource): string {
  const routeId = source.item_ref || source.entity_id;
  if (source.entity_type === 'applications') return `/it/applications/${routeId}/overview`;
  if (source.entity_type === 'assets') return `/it/assets/${routeId}/overview`;
  if (source.entity_type === 'projects') return `/portfolio/projects/${routeId}/summary`;
  if (source.entity_type === 'requests') return `/portfolio/requests/${routeId}/summary`;
  if (source.entity_type === 'locations') return `/it/locations/${routeId}/overview`;
  if (source.entity_type === 'connections') return `/it/connections/${routeId}/overview`;
  if (source.entity_type === 'interfaces') return `/it/interfaces/${routeId}/overview`;
  if (source.entity_type === 'incidents') return `/it/incidents/${routeId}/overview`;
  return `/portfolio/tasks/${routeId}/overview`;
}

function KnowledgeGroupTable({
  canCreate,
  group,
  onUnlink,
  unlinkPending,
}: {
  canCreate: boolean;
  group: DisplayKnowledgeContextGroup;
  onUnlink: (documentId: string) => void;
  unlinkPending: boolean;
}) {
  const { t } = useTranslation('common');
  const locale = useLocale();
  const showUnlink = canCreate && group.key === 'direct';

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          spacing={1}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
            {group.label}
          </Typography>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('knowledgePanel.ref')}</TableCell>
              <TableCell>{t('knowledgePanel.titleColumn')}</TableCell>
              <TableCell>{t('knowledgePanel.sourceObject')}</TableCell>
              <TableCell>{t('knowledgePanel.updatedColumn')}</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {group.items.map((item) => (
              <TableRow
                key={`${group.key}:${item.id}:${item.linked_via_label}`}
                hover
                sx={{
                  '& .knowledge-row-delete': { opacity: 0, transition: 'opacity 120ms ease' },
                  '&:hover .knowledge-row-delete': { opacity: 1 },
                }}
              >
                <TableCell>
                  <Link
                    href={`/knowledge/DOC-${item.item_number}`}
                    underline="none"
                    sx={{
                      color: 'kanap.text.secondary',
                      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
                      fontSize: 12,
                      fontVariantNumeric: 'tabular-nums',
                      '&:hover': { color: 'kanap.teal', textDecoration: 'underline' },
                    }}
                  >
                    {`DOC-${item.item_number}`}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/knowledge/DOC-${item.item_number}`} underline="none" sx={{ color: 'kanap.text.primary', '&:hover': { color: 'kanap.teal', textDecoration: 'underline' } }}>
                    {item.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <Stack spacing={0.5}>
                    {item.provenance.map((source) => (
                      <Box key={`${item.id}:${source.entity_type}:${source.entity_id}`}>
                        <Link href={sourceHref(source)} underline="none" sx={{ color: 'kanap.text.primary', '&:hover': { color: 'kanap.teal', textDecoration: 'underline' } }}>
                          {formatSourceLabel(source)}
                        </Link>
                      </Box>
                    ))}
                  </Stack>
                </TableCell>
                <TableCell>{formatShortDate(item.updated_at || item.created_at, locale)}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    {showUnlink && (
                      <IconButton
                        className="knowledge-row-delete"
                        size="small"
                        color="error"
                        aria-label={t('knowledgePanel.unlinkDocument')}
                        onClick={() => onUnlink(item.id)}
                        disabled={unlinkPending}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Stack>
    </Paper>
  );
}

function formatProvenanceSummary(provenance: KnowledgeContextSource[]): string {
  if (!Array.isArray(provenance) || provenance.length === 0) return '';
  const first = formatSourceLabel(provenance[0]);
  if (provenance.length === 1) return first;
  return `${first} +${provenance.length - 1} more`;
}

function SidebarKnowledgeGroupList({
  canCreate,
  group,
  onUnlink,
  unlinkPending,
}: {
  canCreate: boolean;
  group: DisplayKnowledgeContextGroup;
  onUnlink: (documentId: string) => void;
  unlinkPending: boolean;
}) {
  const { t } = useTranslation('common');
  const locale = useLocale();
  const showUnlink = canCreate && group.key === 'direct';

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
        {group.label}
      </Typography>
      {group.items.map((item) => (
        <Paper key={`${group.key}:${item.id}:${item.linked_via_label}`} variant="outlined" sx={{ p: 1.25 }}>
          <Stack spacing={0.75}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', fontFamily: 'monospace', lineHeight: 1.2 }}
                >
                  {`DOC-${item.item_number}`}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap title={item.title}>
                  {item.title}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                <IconButton
                  size="small"
                  component="a"
                  href={`/knowledge/DOC-${item.item_number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('knowledgePanel.openKnowledge')}
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
                {showUnlink && (
                  <IconButton
                    size="small"
                    color="error"
                    aria-label={t('knowledgePanel.unlinkDocument')}
                    title={t('knowledgePanel.unlinkDocument')}
                    onClick={() => onUnlink(item.id)}
                    disabled={unlinkPending}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="caption" color="text.secondary" noWrap>
                {item.status}
              </Typography>
              {group.key !== 'direct' && (
                <Typography variant="caption" color="text.secondary" noWrap title={item.linked_via_label}>
                  {item.linked_via_label}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" noWrap title={formatShortDate(item.updated_at || item.created_at, locale)}>
                {formatShortDate(item.updated_at || item.created_at, locale)}
              </Typography>
            </Stack>

            {item.provenance.length > 0 && (
              <Typography variant="caption" color="text.secondary" noWrap title={item.provenance.map(formatSourceLabel).join(', ')}>
                {formatProvenanceSummary(item.provenance)}
              </Typography>
            )}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

export default function EntityKnowledgePanel({
  entityType,
  entityId,
  canCreate = false,
  controlsMaxWidth,
  variant = 'default',
}: EntityKnowledgePanelProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const qc = useQueryClient();
  const [linkOptionsOpen, setLinkOptionsOpen] = React.useState(false);
  const [newDocAnchorEl, setNewDocAnchorEl] = React.useState<null | HTMLElement>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = React.useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState('');

  const endpoint = ENTITY_ENDPOINTS[entityType];

  const invalidateKnowledgeQueries = React.useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['entity-knowledge-context', entityType, entityId] }),
      qc.invalidateQueries({ queryKey: ['entity-knowledge', entityType, entityId] }),
      entityType === 'projects'
        ? qc.invalidateQueries({ queryKey: ['project-summary-knowledge-context', entityId] })
        : Promise.resolve(),
      entityType === 'requests'
        ? qc.invalidateQueries({ queryKey: ['request-summary-knowledge-context', entityId] })
        : Promise.resolve(),
    ]);
  }, [entityId, entityType, qc]);

  const { data: contextData, isLoading, error } = useQuery({
    queryKey: ['entity-knowledge-context', entityType, entityId],
    queryFn: async () => {
      const res = await api.get<KnowledgeContextResponse>(`${endpoint}/${entityId}/knowledge-context`);
      return res.data;
    },
    enabled: !!entityId,
  });

  const { data: libraries = [] } = useQuery({
    queryKey: ['knowledge-libraries'],
    queryFn: async () => (await api.get('/knowledge-libraries')).data as DocumentLibrary[],
    enabled: canCreate,
    staleTime: 5 * 60_000,
  });

  const templatesLibrary = React.useMemo(
    () => libraries.find((row) => row.slug === TEMPLATE_LIBRARY_SLUG) || null,
    [libraries],
  );

  const { data: templatesData } = useQuery({
    queryKey: ['knowledge', 'templates-library', templatesLibrary?.id],
    queryFn: async () => {
      const res = await api.get('/knowledge', {
        params: {
          library_id: templatesLibrary?.id,
          status: 'published',
          limit: 200,
          sort: 'updated_at:DESC',
        },
      });
      return res.data as { items: TemplateListItem[] };
    },
    enabled: canCreate && templatePickerOpen && !!templatesLibrary?.id,
  });

  const groupedTemplates = React.useMemo(() => {
    const groups: Array<{ typeName: string; items: TemplateListItem[] }> = [];
    const byType = new Map<string, TemplateListItem[]>();
    for (const item of templatesData?.items || []) {
      const typeName = String(item.document_type_name || 'Document').trim() || 'Document';
      if (!byType.has(typeName)) byType.set(typeName, []);
      byType.get(typeName)!.push(item);
    }
    Array.from(byType.keys())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .forEach((typeName) => {
        groups.push({
          typeName,
          items: (byType.get(typeName) || []).sort((a, b) => {
            if (a.title === b.title) return Number(b.item_number || 0) - Number(a.item_number || 0);
            return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
          }),
        });
      });
    return groups;
  }, [templatesData?.items]);

  const groups = contextData?.groups || [];
  const directGroup = React.useMemo(
    () => groups.find((group) => group.key === 'direct') || null,
    [groups],
  );
  const displayGroups = React.useMemo<DisplayKnowledgeContextGroup[]>(() => {
    const directItems = directGroup
      ? dedupeKnowledgeItems(directGroup.items.map((item) => ({
          ...item,
          linked_via_label: directGroup.linked_via_label,
        })))
      : [];
    const directDocumentIds = new Set(directItems.map((item) => item.id));
    const directDisplayGroup = directGroup
      ? {
          key: 'direct' as const,
          label: 'Linked documents',
          total: directItems.length,
          items: directItems,
        }
      : null;
    const relatedItems = dedupeKnowledgeItems(
      groups
        .filter((group) => group.key !== 'direct')
        .flatMap((group) => group.items.map((item) => ({
          ...item,
          linked_via_label: group.linked_via_label,
        }))),
    )
      .filter((item) => !directDocumentIds.has(item.id));
    const relatedDisplayGroup = relatedItems.length > 0
      ? {
          key: 'related_documents' as const,
          label: 'Related documents',
          total: relatedItems.length,
          items: relatedItems,
        }
      : null;

    return [directDisplayGroup, relatedDisplayGroup].filter((group): group is DisplayKnowledgeContextGroup => !!group);
  }, [directGroup, groups]);
  const linkedDocIds = React.useMemo(
    () => new Set((directGroup?.items || []).map((item) => item.id)),
    [directGroup],
  );

  const isRestricted = contextData?.access === 'restricted';
  const restrictedCount = Number(contextData?.total || 0);
  const isSidebar = variant === 'sidebar';
  const openCreatedDocument = React.useCallback((created: any) => {
    const ref = created?.item_ref || `DOC-${created?.item_number}`;
    const opened = window.open(`/knowledge/${ref}`, '_blank', 'noopener,noreferrer');
    if (!opened) {
      navigate(`/knowledge/${ref}`);
    }
  }, [navigate]);

  const openTemplatePicker = React.useCallback(() => {
    setTemplatePickerOpen(true);
    setSelectedTemplateId('');
  }, []);

  const updateEntityRelationOnDocument = React.useCallback(
    async (documentId: string, mode: 'link' | 'unlink') => {
      const details = await api.get<DocumentDetailsResponse>(`/knowledge/${documentId}`);
      const relationKey = RELATION_KEYS[entityType] as EntityKnowledgeType;
      const relationBodyKey = RELATION_BODY_KEYS[entityType];
      const current = Array.isArray(details.data?.relations?.[relationKey])
        ? (details.data.relations?.[relationKey] || [])
            .map((entry) => typeof entry === 'string' ? entry : String(entry?.id || '').trim())
            .filter(Boolean)
        : [];
      const next = mode === 'link'
        ? uniqueIds([...current, entityId])
        : current.filter((id) => id !== entityId);

      await api.post(`/knowledge/${documentId}/relations/${entityType}/bulk-replace`, {
        [relationBodyKey]: next,
      });
    },
    [entityId, entityType],
  );

  const createLinkedMutation = useMutation({
    mutationFn: async (params?: { templateDocumentId?: string | null; templateTitle?: string | null }) => {
      const templateTitle = String(params?.templateTitle || '').trim();
      const body = {
        title: templateTitle || t('knowledgePanel.newLinkedTitle'),
        content_markdown: '',
        status: 'draft',
        relations: {
          [RELATION_KEYS[entityType]]: [entityId],
        },
        ...(params?.templateDocumentId ? { template_document_id: params.templateDocumentId } : {}),
      };
      const res = await api.post('/knowledge', body);
      return res.data;
    },
    onSuccess: async (created) => {
      await invalidateKnowledgeQueries();
      openCreatedDocument(created);
    },
  });

  const linkExistingMutation = useMutation({
    mutationFn: async (document: DocumentListItem) => {
      await updateEntityRelationOnDocument(document.id, 'link');
      return document;
    },
    onSuccess: async () => {
      setLinkOptionsOpen(false);
      await invalidateKnowledgeQueries();
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (documentId: string) => {
      await updateEntityRelationOnDocument(documentId, 'unlink');
      return documentId;
    },
    onSuccess: async () => {
      await invalidateKnowledgeQueries();
    },
  });

  const handleCreateBlank = React.useCallback(() => {
    setNewDocAnchorEl(null);
    createLinkedMutation.mutate({});
  }, [createLinkedMutation]);

  const handleCreateFromTemplate = React.useCallback(() => {
    const template = (templatesData?.items || []).find((item) => item.id === selectedTemplateId) || null;
    if (!template) return;
    const sp = new URLSearchParams();
    sp.set(`${entityType.slice(0, -1)}_id`, entityId);
    sp.set('template_document_id', template.id);
    navigate(`/knowledge/new?${sp.toString()}`);
    setTemplatePickerOpen(false);
    setSelectedTemplateId('');
  }, [entityId, entityType, navigate, selectedTemplateId, templatesData?.items]);

  const handleExistingKnowledgeSelected = React.useCallback((document: DocumentListItem | null) => {
    if (!document) return;
    linkExistingMutation.mutate(document);
  }, [linkExistingMutation]);

  const headerActions = canCreate ? (
    isSidebar ? (
      <Stack spacing={1}>
        <ButtonGroup variant="contained" size="small" fullWidth>
          <Button
            startIcon={<AddIcon />}
            onClick={handleCreateBlank}
            disabled={createLinkedMutation.isPending}
          >
            {t('knowledgePanel.newDocumentLower')}
          </Button>
          <Button
            onClick={(event) => setNewDocAnchorEl(event.currentTarget)}
            disabled={createLinkedMutation.isPending}
            sx={{ px: 0.5, minWidth: 'auto' }}
          >
            <ArrowDropDownIcon />
          </Button>
        </ButtonGroup>
        <Button
          variant="outlined"
          size="small"
          fullWidth
          onClick={() => setLinkOptionsOpen(true)}
          disabled={linkExistingMutation.isPending}
        >
          {t('knowledgePanel.linkExisting')}
        </Button>
      </Stack>
    ) : (
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1.5}>
        <Typography
          component="h2"
          sx={(theme) => ({
            m: 0,
            fontSize: 14,
            fontWeight: 500,
            lineHeight: 1.4,
            color: theme.palette.kanap.text.primary,
            whiteSpace: 'nowrap',
          })}
        >
          {t('knowledgePanel.title')}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <Button
            variant="action"
            startIcon={<LinkIcon fontSize="small" />}
            onClick={() => setLinkOptionsOpen(true)}
            disabled={linkExistingMutation.isPending}
          >
            {t('knowledgePanel.linkExisting')}
          </Button>
          <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
            <Button
              variant="action"
              startIcon={<AddIcon />}
              onClick={handleCreateBlank}
              disabled={createLinkedMutation.isPending}
              sx={{
                borderTopRightRadius: 0,
                borderBottomRightRadius: 0,
                pr: 1,
              }}
            >
              {t('knowledgePanel.newDocument')}
            </Button>
            <Button
              variant="action"
              aria-label={t('knowledgePanel.newDocumentOptions', 'New document options')}
              onClick={(event) => setNewDocAnchorEl(event.currentTarget)}
              disabled={createLinkedMutation.isPending}
              sx={{
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                ml: '-1px',
                px: 0.25,
                minWidth: 24,
              }}
            >
              <ArrowDropDownIcon sx={{ fontSize: 18 }} />
            </Button>
          </Box>
        </Stack>
      </Stack>
    )
  ) : (!isSidebar ? (
    <Stack spacing={0.75}>
      <Typography
        component="h2"
        sx={(theme) => ({
          m: 0,
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 1.4,
          color: theme.palette.kanap.text.primary,
        })}
      >
        {t('knowledgePanel.title')}
      </Typography>
    </Stack>
  ) : null);

  return (
    <Stack spacing={isSidebar ? 1.5 : 2}>
      {headerActions && (
        isSidebar ? (
          <Stack spacing={1.25}>
            {headerActions}
            {(linkExistingMutation.isError || unlinkMutation.isError || createLinkedMutation.isError) && (
              <Alert severity="error">
                {t('knowledgePanel.failedToUpdateLinks')}
              </Alert>
            )}
          </Stack>
        ) : (
          <Stack spacing={1.25} sx={{ width: '100%', maxWidth: controlsMaxWidth }}>
            {headerActions}
            {(linkExistingMutation.isError || unlinkMutation.isError || createLinkedMutation.isError) && (
              <Alert severity="error">
                {t('knowledgePanel.failedToUpdateLinks')}
              </Alert>
            )}
          </Stack>
        )
      )}

      <Menu
        anchorEl={newDocAnchorEl}
        open={Boolean(newDocAnchorEl)}
        onClose={() => setNewDocAnchorEl(null)}
      >
        <MenuItem onClick={handleCreateBlank}>
          {t('knowledgePanel.blankDocument')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setNewDocAnchorEl(null);
            openTemplatePicker();
          }}
          disabled={!templatesLibrary}
        >
          {t('knowledgePanel.fromTemplate')}
        </MenuItem>
      </Menu>

      <KnowledgeLinkPickerDialog
        open={linkOptionsOpen}
        onClose={() => setLinkOptionsOpen(false)}
        linkedDocumentIds={linkedDocIds}
        linkPending={linkExistingMutation.isPending}
        onLink={handleExistingKnowledgeSelected}
      />

      <KanapDialog
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        title={t('knowledgePanel.selectTemplate')}
        onSave={handleCreateFromTemplate}
        saveLabel={t('knowledgePanel.useTemplate')}
        saveDisabled={!selectedTemplateId || createLinkedMutation.isPending}
        saveLoading={createLinkedMutation.isPending}
      >
        <PropertyRow label={t('labels.template')}>
          <Select
            fullWidth
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            variant="standard"
            sx={drawerSelectSx}
          >
            {groupedTemplates.map((group) => ([
              <ListSubheader key={`${group.typeName}-header`} disableSticky>
                {group.typeName}
              </ListSubheader>,
              ...group.items.map((row) => (
                <MenuItem key={row.id} value={row.id} sx={drawerMenuItemSx}>
                  <Box
                    component="span"
                    sx={{
                      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
                      fontSize: 11,
                      color: 'kanap.text.tertiary',
                      mr: 1,
                    }}
                  >
                    {`DOC-${row.item_number}`}
                  </Box>
                  {row.title}
                </MenuItem>
              )),
            ]))}
          </Select>
        </PropertyRow>
        {!templatesData?.items?.length && (
          <Typography sx={(theme) => ({ mt: 1, fontSize: 13, color: theme.palette.kanap.text.secondary })}>
            {t('knowledgePanel.noTemplatesAvailable')}
          </Typography>
        )}
      </KanapDialog>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: isSidebar ? 3 : 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {!!error && !isLoading && (
        <Alert severity="error">{t('knowledgePanel.failedToLoadContext')}</Alert>
      )}

      {!isLoading && !error && isRestricted && restrictedCount > 0 && (
        <Alert severity="info">
          {t('knowledgePanel.restrictedDocuments', { count: restrictedCount })}
        </Alert>
      )}

      {!isLoading && !error && isRestricted && restrictedCount === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t('knowledgePanel.noStandaloneDocuments')}
        </Typography>
      )}

      {!isLoading && !error && !isRestricted && displayGroups.map((group) => (
        isSidebar ? (
          <SidebarKnowledgeGroupList
            key={group.key}
            canCreate={canCreate}
            group={group}
            onUnlink={(documentId) => unlinkMutation.mutate(documentId)}
            unlinkPending={unlinkMutation.isPending}
          />
        ) : (
          <KnowledgeGroupTable
            key={group.key}
            canCreate={canCreate}
            group={group}
            onUnlink={(documentId) => unlinkMutation.mutate(documentId)}
            unlinkPending={unlinkMutation.isPending}
          />
        )
      ))}

      {!isLoading && !error && !isRestricted && displayGroups.length === 0 && (
        isSidebar ? (
          <Typography variant="body2" color="text.secondary">
            {t('knowledgePanel.noStandaloneDocuments')}
          </Typography>
        ) : (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('knowledgePanel.noStandaloneDocuments')}
            </Typography>
          </Paper>
        )
      )}
    </Stack>
  );
}
