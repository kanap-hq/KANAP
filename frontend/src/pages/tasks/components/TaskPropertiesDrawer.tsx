import React from 'react';
import { Avatar, Box, MenuItem, Select, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { PropertyGroup, PropertyRow } from '../../../components/design';
import DateEUField from '../../../components/fields/DateEUField';
import UserSelect from '../../../components/fields/UserSelect';
import UserMultiSelect from '../../../components/fields/UserMultiSelect';
import MetadataUserPicker from '../../../components/workspace/MetadataUserPicker';
import ApplicationMultiSelect from '../../../components/fields/ApplicationMultiSelect';
import AssetMultiSelect from '../../../components/fields/AssetMultiSelect';
import RelatedObjectSelect, { RelatedObjectType } from '../../../components/fields/RelatedObjectSelect';
import CompanySelect from '../../../components/fields/CompanySelect';
import { drawerMenuItemSx, drawerSelectSx, selectPlaceholderSx, tealLinkSx } from '../../../theme/formSx';
import DrawerKnowledgeSection from './DrawerKnowledgeSection';
import TaskLogTimeDialog from './TaskLogTimeDialog';
import { taskDetailTokens, taskDetailTypography } from '../theme/taskDetailTokens';
import { getInitials } from '../../../utils/userDisplay';
import { useLocalizedTaskTypes, useTaskTypeLabel } from '../../../hooks/useLocalizedTaskTypes';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface TaskData {
  id: string;
  status: string;
  task_type_id?: string | null;
  task_type_name?: string | null;
  task_type_code?: string | null;
  priority_level: string;
  start_date: string | null;
  due_date: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  creator_id: string | null;
  creator_name: string | null;
  owner_ids: string[];
  viewer_ids: string[];
  labels: string[];
  application_ids?: string[];
  asset_ids?: string[];
  applications?: Array<{ id: string; name?: string | null; sequential_id?: string | null }>;
  assets?: Array<{ id: string; name?: string | null; asset_reference?: string | null; hostname?: string | null }>;
  related_object_type: string | null;
  related_object_id: string | null;
  related_object_name: string | null;
  phase_id: string | null;
  phase_name: string | null;
  source_id?: string | null;
  source_name?: string | null;
  category_id: string | null;
  category_name: string | null;
  stream_id: string | null;
  stream_name: string | null;
  company_id?: string | null;
  company_name?: string | null;
}

interface RelationChangeParams { type: RelatedObjectType; id: string | null; name: string | null }

interface TaskPropertiesDrawerProps {
  task: TaskData;
  open: boolean;
  onToggle: () => void;
  onPatch: (patch: Record<string, any>) => void;
  readOnly?: boolean;
  totalTimeHours?: number;
  isCreate?: boolean;
  onRelationChange?: (params: RelationChangeParams) => void;
  projectWorkspaceLink?: string | null;
}

interface ClassificationSource { id: string; name: string; is_active: boolean }
interface ClassificationStream { id: string; name: string; category_id: string; is_active: boolean }
interface ClassificationCategory { id: string; name: string; is_active: boolean }

type SelectOption = { label: string; value: string };

function withCurrentOption(options: SelectOption[], currentId?: string | null, currentLabel?: string | null): SelectOption[] {
  if (!currentId) return options;
  if (options.some((o) => o.value === currentId)) return options;
  return [...options, { value: currentId, label: currentLabel || currentId }];
}

function selectPlaceholder(text: string) {
  return <Box component="span" sx={selectPlaceholderSx}>{text}</Box>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatHours(t: any, hours: number) {
  const days = Math.floor(hours / 8);
  const remaining = Math.round(hours % 8);
  if (days > 0 && remaining > 0) return t('workspace.task.workLog.duration.daysHours', { days, hours: remaining });
  if (days > 0) return t('workspace.task.workLog.duration.daysOnly', { days });
  return t('workspace.task.workLog.duration.hoursOnly', { hours });
}

function formatLinkedNames(items?: Array<{ id: string; name?: string | null; sequential_id?: string | null; asset_reference?: string | null; hostname?: string | null }>): string {
  const names = (items || []).map((item) => {
    const ref = item.sequential_id || item.asset_reference;
    const name = item.name || item.hostname || item.id;
    return ref ? `${ref} ${name}` : name;
  });
  return names.length > 0 ? names.join(', ') : '-';
}

/* ------------------------------------------------------------------ */
/*  TaskPropertiesDrawer                                              */
/* ------------------------------------------------------------------ */

export default function TaskPropertiesDrawer({
  task,
  open,
  onPatch,
  readOnly = false,
  totalTimeHours = 0,
  isCreate = false,
  onRelationChange,
  projectWorkspaceLink = null,
}: TaskPropertiesDrawerProps) {
  const { t } = useTranslation('portfolio');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { hasLevel } = useAuth();
  const queryClient = useQueryClient();
  const [logTimeOpen, setLogTimeOpen] = React.useState(false);
  const isProjectTask = task.related_object_type === 'project';
  const isStandalone = !task.related_object_type;
  const canEditClassification = isStandalone || isProjectTask;
  const canLogTime = isProjectTask ? hasLevel('portfolio_projects', 'contributor') : hasLevel('tasks', 'member');
  const canCreateKnowledge = hasLevel('knowledge', 'member');
  const showKnowledge = !isCreate && !!task.id;
  const timeExcluded = ['contract', 'spend_item', 'capex_item'];
  const supportsTimeLogging = isStandalone || !timeExcluded.includes(task.related_object_type || '');

  /* ---- Data queries ---- */
  const { data: taskTypesData } = useLocalizedTaskTypes();
  const typeLabel = useTaskTypeLabel();
  const currentTypeLabel = typeLabel(task.task_type_name, task.task_type_code);
  const taskTypeOptions = React.useMemo(() => {
    const active = (taskTypesData || []).filter((tt) => tt.is_active).map((tt) => ({ label: tt.name, value: tt.id }));
    return withCurrentOption(active, task.task_type_id, currentTypeLabel);
  }, [taskTypesData, task.task_type_id, currentTypeLabel]);

  const { data: classificationData } = useQuery({
    queryKey: ['portfolio-classification'],
    queryFn: async () => { const res = await api.get('/portfolio/classification/all'); return res.data as { sources: ClassificationSource[]; categories: ClassificationCategory[]; streams: ClassificationStream[] }; },
    enabled: canEditClassification && !readOnly,
  });
  const sources = classificationData?.sources?.filter((s) => s.is_active) || [];
  const categories = classificationData?.categories?.filter((c) => c.is_active) || [];
  const streams = classificationData?.streams?.filter((s) => s.is_active) || [];
  const filteredStreams = React.useMemo(() => !task.category_id ? streams : streams.filter((s) => s.category_id === task.category_id), [streams, task.category_id]);
  const sourceOptions = React.useMemo(() => withCurrentOption(sources.map((s) => ({ label: s.name, value: s.id })), task.source_id, task.source_name), [sources, task.source_id, task.source_name]);
  const categoryOptions = React.useMemo(() => withCurrentOption(categories.map((c) => ({ label: c.name, value: c.id })), task.category_id, task.category_name), [categories, task.category_id, task.category_name]);
  const streamOptions = React.useMemo(() => withCurrentOption(filteredStreams.map((s) => ({ label: s.name, value: s.id })), task.stream_id, task.stream_name), [filteredStreams, task.stream_id, task.stream_name]);

  const { data: phases = [] } = useQuery({
    queryKey: ['project-phases', task.related_object_id],
    queryFn: async () => {
      if (task.related_object_type !== 'project' || !task.related_object_id) return [];
      const res = await api.get<Array<{ id: string; name: string }>>(`/portfolio/projects/${task.related_object_id}/phases`);
      return res.data;
    },
    enabled: task.related_object_type === 'project' && !!task.related_object_id,
  });

  if (!open) return null;

  /* ================================================================ */
  /*  Drawer body — 4 groups, dividers, no section titles             */
  /* ================================================================ */

  const drawerBody = (
    <Box sx={{ flex: 1, overflowY: 'auto', pt: '10px', pb: '14px' }}>

      {/* ══ Group 1: Context ══ */}
      <PropertyGroup>
        {/* Related to */}
        <PropertyRow label={t('workspace.task.sidebar.fields.relatedTo')}>
          {onRelationChange && !readOnly ? (
            <RelatedObjectSelect
              relationType={task.related_object_type as RelatedObjectType}
              relationId={task.related_object_id || null}
              relationName={task.related_object_name || null}
              onChangeType={(type) => onRelationChange({ type, id: null, name: null })}
              onChangeId={(id, name) => onRelationChange({ type: task.related_object_type as RelatedObjectType, id, name })}
              size="small"
              hideLabel
            />
          ) : (
            <Typography sx={{ fontSize: 13 }}>
              {task.related_object_name || t('workspace.task.sidebar.values.standaloneTask')}
            </Typography>
          )}
        </PropertyRow>

        {/* Phase (only for project tasks) */}
        {isProjectTask && (
          <PropertyRow label={t('workspace.task.sidebar.fields.phase')}>
            {readOnly ? (
              <Typography sx={{ fontSize: 13 }}>{task.phase_name || t('workspace.task.sidebar.values.projectLevel')}</Typography>
            ) : (
              <Select
                value={task.phase_id || ''}
                onChange={(e) => onPatch({ phase_id: e.target.value || null })}
                variant="standard"
                displayEmpty
                renderValue={(v) => (v ? (phases.find((p) => p.id === v)?.name ?? task.phase_name ?? '') : selectPlaceholder(t('workspace.task.sidebar.values.projectLevel')))}
                sx={drawerSelectSx}
              >
                <MenuItem value="" sx={drawerMenuItemSx}>{t('workspace.task.sidebar.values.projectLevel')}</MenuItem>
                {phases.map((p) => <MenuItem key={p.id} value={p.id} sx={drawerMenuItemSx}>{p.name}</MenuItem>)}
              </Select>
            )}
          </PropertyRow>
        )}

        {/* Task type */}
        <PropertyRow label={t('workspace.task.sidebar.fields.taskType')}>
          {readOnly ? (
            <Typography sx={{ fontSize: 13 }}>{taskTypeOptions.find((o) => o.value === task.task_type_id)?.label || currentTypeLabel || '-'}</Typography>
          ) : (
            <Select
              value={task.task_type_id || ''}
              onChange={(e) => onPatch({ task_type_id: e.target.value || null })}
              variant="standard"
              displayEmpty
              renderValue={(v) => (v ? (taskTypeOptions.find((o) => o.value === v)?.label ?? currentTypeLabel ?? '') : selectPlaceholder(t('common:selects.notSet')))}
              sx={drawerSelectSx}
            >
              <MenuItem value="" sx={drawerMenuItemSx}><em>—</em></MenuItem>
              {taskTypeOptions.map((o) => <MenuItem key={o.value} value={o.value} sx={drawerMenuItemSx}>{o.label}</MenuItem>)}
            </Select>
          )}
        </PropertyRow>
      </PropertyGroup>

      {/* ══ Group 2: Classification ══ */}
      <PropertyGroup>
        {canEditClassification && !readOnly ? (
          <>
            <PropertyRow label={t('workspace.task.sidebar.fields.source')}>
              <Select value={task.source_id || ''} onChange={(e) => onPatch({ source_id: e.target.value || null })} variant="standard" displayEmpty renderValue={(v) => (v ? (sourceOptions.find((o) => o.value === v)?.label ?? task.source_name ?? '') : selectPlaceholder(t('common:selects.notSet')))} sx={drawerSelectSx}>
                <MenuItem value="" sx={drawerMenuItemSx}><em>—</em></MenuItem>
                {sourceOptions.map((o) => <MenuItem key={o.value} value={o.value} sx={drawerMenuItemSx}>{o.label}</MenuItem>)}
              </Select>
            </PropertyRow>
            <PropertyRow label={t('workspace.task.sidebar.fields.category')}>
              <Select
                value={task.category_id || ''}
                onChange={(e) => {
                  const nextCatId = e.target.value || null;
                  const patch: Record<string, any> = { category_id: nextCatId };
                  if (task.stream_id) {
                    const belongs = nextCatId ? streams.some((s) => s.id === task.stream_id && s.category_id === nextCatId) : false;
                    if (!belongs) patch.stream_id = null;
                  }
                  onPatch(patch);
                }}
                variant="standard"
                displayEmpty
                renderValue={(v) => (v ? (categoryOptions.find((o) => o.value === v)?.label ?? task.category_name ?? '') : selectPlaceholder(t('common:selects.notSet')))}
                sx={drawerSelectSx}
              >
                <MenuItem value="" sx={drawerMenuItemSx}><em>—</em></MenuItem>
                {categoryOptions.map((o) => <MenuItem key={o.value} value={o.value} sx={drawerMenuItemSx}>{o.label}</MenuItem>)}
              </Select>
            </PropertyRow>
            <PropertyRow label={t('workspace.task.sidebar.fields.stream')}>
              <Select value={task.stream_id || ''} onChange={(e) => onPatch({ stream_id: e.target.value || null })} variant="standard" displayEmpty renderValue={(v) => (v ? (streamOptions.find((o) => o.value === v)?.label ?? task.stream_name ?? '') : selectPlaceholder(t('common:selects.notSet')))} disabled={!task.category_id} sx={drawerSelectSx}>
                <MenuItem value="" sx={drawerMenuItemSx}><em>—</em></MenuItem>
                {streamOptions.map((o) => <MenuItem key={o.value} value={o.value} sx={drawerMenuItemSx}>{o.label}</MenuItem>)}
              </Select>
            </PropertyRow>
            <PropertyRow label={t('workspace.task.sidebar.fields.company')}>
              <CompanySelect label="" value={task.company_id || null} onChange={(v) => onPatch({ company_id: v })} size="small" />
            </PropertyRow>
          </>
        ) : (
          <>
            {task.source_name && <PropertyRow label={t('workspace.task.sidebar.fields.source')}><Typography sx={{ fontSize: 13 }}>{task.source_name}</Typography></PropertyRow>}
            {task.category_name && <PropertyRow label={t('workspace.task.sidebar.fields.category')}><Typography sx={{ fontSize: 13 }}>{task.category_name}</Typography></PropertyRow>}
            {task.stream_name && <PropertyRow label={t('workspace.task.sidebar.fields.stream')}><Typography sx={{ fontSize: 13 }}>{task.stream_name}</Typography></PropertyRow>}
            {task.company_name && <PropertyRow label={t('workspace.task.sidebar.fields.company')}><Typography sx={{ fontSize: 13 }}>{task.company_name}</Typography></PropertyRow>}
          </>
        )}
      </PropertyGroup>

      {/* ══ Group 3: People ══ */}
      <PropertyGroup>
        <PropertyRow label={t('workspace.task.sidebar.fields.requestor')}>
          {readOnly ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Avatar sx={{ width: 16, height: 16, fontSize: 8, fontWeight: 500, bgcolor: 'primary.main' }}>{getInitials(task.creator_name)}</Avatar>
              <Typography sx={{ fontSize: 13 }}>{task.creator_name || '-'}</Typography>
            </Box>
          ) : (
            <UserSelect label="" value={task.creator_id} onChange={(v) => onPatch({ creator_id: v })} size="small" />
          )}
        </PropertyRow>
        <PropertyRow label={t('workspace.task.sidebar.fields.assignee')}>
          <MetadataUserPicker
            value={task.assignee_user_id}
            displayName={task.assignee_name}
            placeholder={t('workspace.task.sidebar.values.assigneeMissing')}
            searchPlaceholder={t('workspace.task.sidebar.fields.assignee')}
            disabled={readOnly}
            showAvatar={false}
            onChange={(v) => onPatch({ assignee_user_id: v })}
            sx={{ maxWidth: '100%' }}
          />
        </PropertyRow>
        <PropertyRow label={t('workspace.task.sidebar.fields.viewers')}>
          <UserMultiSelect label="" value={task.viewer_ids || []} onChange={(v) => onPatch({ viewer_ids: v })} disabled={readOnly} size="small" />
        </PropertyRow>
      </PropertyGroup>

      {/* ══ Group 4: Tracking ══ */}
      <PropertyGroup>
        <PropertyRow label={t('workspace.task.sidebar.fields.startDate')}>
          <DateEUField label="" valueYmd={task.start_date || ''} onChangeYmd={(v) => onPatch({ start_date: v || null })} disabled={readOnly} size="small" />
        </PropertyRow>

        <PropertyRow label={t('workspace.task.sidebar.fields.dueDate')}>
          <DateEUField label="" valueYmd={task.due_date || ''} onChangeYmd={(v) => onPatch({ due_date: v || null })} disabled={readOnly} size="small" />
        </PropertyRow>

        {!isCreate && supportsTimeLogging && (
          <PropertyRow label={t('workspace.task.sidebar.fields.timeSpent')}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <Typography sx={{ fontSize: 13 }}>{formatHours(t, totalTimeHours)}</Typography>
              {!readOnly && canLogTime && (
                <Box
                  component="button"
                  onClick={() => setLogTimeOpen(true)}
                  sx={tealLinkSx}
                >
                  + {t('dialogs.logTime.actions.logTime')}
                </Box>
              )}
            </Box>
          </PropertyRow>
        )}

        <PropertyRow label={t('workspace.task.sidebar.fields.applications', { defaultValue: 'Applications' })}>
          {readOnly ? (
            <Typography sx={{ fontSize: 13 }}>{formatLinkedNames(task.applications)}</Typography>
          ) : (
            <ApplicationMultiSelect
              label=""
              value={task.application_ids || []}
              onChange={(ids) => onPatch({ application_ids: ids })}
              disabled={readOnly}
              size="small"
            />
          )}
        </PropertyRow>
        <PropertyRow label={t('workspace.task.sidebar.fields.assets', { defaultValue: 'Assets' })}>
          {readOnly ? (
            <Typography sx={{ fontSize: 13 }}>{formatLinkedNames(task.assets)}</Typography>
          ) : (
            <AssetMultiSelect
              label=""
              value={task.asset_ids || []}
              onChange={(ids) => onPatch({ asset_ids: ids })}
              disabled={readOnly}
              size="small"
            />
          )}
        </PropertyRow>

        {showKnowledge && (
          <PropertyRow label={t('workspace.task.sidebar.sections.knowledge')}>
            <DrawerKnowledgeSection taskId={task.id} canCreate={canCreateKnowledge} />
          </PropertyRow>
        )}
      </PropertyGroup>

      {/* Log time dialog */}
      {!isCreate && supportsTimeLogging && (
        <TaskLogTimeDialog
          open={logTimeOpen}
          onClose={() => setLogTimeOpen(false)}
          taskId={task.id}
          projectId={isProjectTask && task.related_object_id ? task.related_object_id : undefined}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['task-time-entries-sum', task.id] });
            queryClient.invalidateQueries({ queryKey: ['task-time-entries', task.id] });
            queryClient.invalidateQueries({ queryKey: ['tasks', task.id] });
            queryClient.invalidateQueries({ queryKey: ['task-activities', task.id] });
            if (isProjectTask && task.related_object_id) {
              queryClient.invalidateQueries({ queryKey: ['project', task.related_object_id] });
              queryClient.invalidateQueries({ queryKey: ['project-tasks-time-summary', task.related_object_id] });
            }
          }}
        />
      )}
    </Box>
  );

  /* ---- Mobile: full-width bottom panel ---- */
  if (isMobile) {
    return (
      <Box sx={{ width: '100%', borderTop: `1px solid ${theme.palette.kanap.border.default}`, bgcolor: theme.palette.kanap.bg.drawer, overflow: 'auto', maxHeight: '60vh' }}>
        {drawerBody}
      </Box>
    );
  }

  /* ---- Desktop: 280px side panel, no header (tab-anchor handles labeling) ---- */
  const panelTopOffset = taskDetailTokens.drawer.panelTop;

  return (
    <Box
      component="aside"
      sx={{
        width: taskDetailTokens.drawer.panelWidth,
        mt: `${panelTopOffset}px`,
        height: `calc(100% + ${Math.abs(panelTopOffset)}px)`,
        flexShrink: 0,
        borderLeft: `1px solid ${theme.palette.kanap.border.default}`,
        bgcolor: theme.palette.kanap.bg.drawer,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {drawerBody}
    </Box>
  );
}
