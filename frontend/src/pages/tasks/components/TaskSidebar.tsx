import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import EnumAutocomplete from '../../../components/fields/EnumAutocomplete';
import DateEUField from '../../../components/fields/DateEUField';
import UserSelect from '../../../components/fields/UserSelect';
import UserMultiSelect from '../../../components/fields/UserMultiSelect';
import RelatedObjectSelect, { RelatedObjectType } from '../../../components/fields/RelatedObjectSelect';
import CompanySelect from '../../../components/fields/CompanySelect';
import TaskLogTimeDialog from './TaskLogTimeDialog';
import { useAuth } from '../../../auth/AuthContext';
import { getPriorityLabel, getTaskStatusOptions } from '../../../utils/portfolioI18n';
import { useLocalizedTaskTypes, useTaskTypeLabel } from '../../../hooks/useLocalizedTaskTypes';
import EntityKnowledgePanel from '../../../components/EntityKnowledgePanel';
import { PropertyRow } from '../../../components/design';

const compactFieldSx = {
  '& .MuiFormLabel-root': {
    fontSize: '0.9rem',
  },
  '& .MuiInputBase-root': {
    fontSize: '0.9rem',
  },
  '& .MuiInputBase-input': {
    fontSize: '0.9rem',
  },
};

const accordionSx = {
  '&:before': { display: 'none' },
  bgcolor: 'transparent',
};

const accordionSummarySx = {
  minHeight: 40,
  px: 0,
  '& .MuiAccordionSummary-content': {
    my: 0.75,
  },
};

// Classification types
interface ClassificationSource {
  id: string;
  name: string;
  is_active: boolean;
}

interface ClassificationStream {
  id: string;
  name: string;
  category_id: string;
  is_active: boolean;
}

interface ClassificationCategory {
  id: string;
  name: string;
  is_active: boolean;
  streams?: ClassificationStream[];
}

type SelectOption = { label: string; value: string };

function withCurrentOption(
  options: SelectOption[],
  currentId?: string | null,
  currentLabel?: string | null,
): SelectOption[] {
  if (!currentId) return options;
  if (options.some((o) => o.value === currentId)) return options;
  return [...options, { value: currentId, label: currentLabel || currentId }];
}

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
  related_object_type: string | null;
  related_object_id: string | null;
  related_object_name: string | null;
  phase_id: string | null;
  phase_name: string | null;
  // Classification fields
  source_id?: string | null;
  source_name?: string | null;
  category_id: string | null;
  category_name: string | null;
  stream_id: string | null;
  stream_name: string | null;
  company_id?: string | null;
  company_name?: string | null;
}

interface RelationChangeParams {
  type: RelatedObjectType;
  id: string | null;
  name: string | null;
}

interface TaskSidebarProps {
  task: TaskData;
  onPatch: (patch: Record<string, any>) => void;
  readOnly?: boolean;
  totalTimeHours?: number;
  isCreate?: boolean;
  onRelationChange?: (params: RelationChangeParams) => void;
  projectWorkspaceLink?: string | null;
}

export default function TaskSidebar({
  task,
  onPatch,
  readOnly = false,
  totalTimeHours = 0,
  isCreate = false,
  onRelationChange,
  projectWorkspaceLink = null,
}: TaskSidebarProps) {
  const { t } = useTranslation('portfolio');
  const { hasLevel } = useAuth();
  const queryClient = useQueryClient();
  const [logTimeOpen, setLogTimeOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string[]>(() => (
    isCreate
      ? ['context', 'details', 'classification', 'people', 'dates']
      : ['context', 'details', 'time', 'people', 'dates']
  ));

  const isProjectTask = task.related_object_type === 'project';
  const isStandalone = !task.related_object_type;
  const canEditClassification = isStandalone || isProjectTask;
  const canManageStandaloneEntries = hasLevel('tasks', 'member');
  const canManageProjectEntries = hasLevel('portfolio_projects', 'contributor');
  const canLogTime = isProjectTask ? canManageProjectEntries : canManageStandaloneEntries;
  const canCreateKnowledge = hasLevel('knowledge', 'member');
  const showKnowledge = !isCreate && !!task.id;
  const relatedTypeLabels = React.useMemo(() => ({
    project: t('workspace.task.sidebar.values.relatedTypes.project'),
    spend_item: t('workspace.task.sidebar.values.relatedTypes.budget'),
    contract: t('workspace.task.sidebar.values.relatedTypes.contract'),
    capex_item: t('workspace.task.sidebar.values.relatedTypes.capex'),
    incident: t('workspace.task.sidebar.values.relatedTypes.incident'),
    unknown: t('workspace.task.sidebar.values.relatedTypes.related'),
  }), [t]);
  const priorityOptions = React.useMemo(() => ([
    { label: t('workspace.task.sidebar.priorityOptions.blocker'), value: 'blocker' },
    { label: t('workspace.task.sidebar.priorityOptions.high'), value: 'high' },
    { label: t('workspace.task.sidebar.priorityOptions.normal'), value: 'normal' },
    { label: t('workspace.task.sidebar.priorityOptions.low'), value: 'low' },
    { label: t('workspace.task.sidebar.priorityOptions.optional'), value: 'optional' },
  ]), [t]);
  const statusOptions = React.useMemo(() => getTaskStatusOptions(t), [t]);

  // Task types, shown in the user's language while the tenant keeps the shipped ones
  const { data: taskTypesData } = useLocalizedTaskTypes();
  const typeLabel = useTaskTypeLabel();
  const currentTypeLabel = typeLabel(task.task_type_name, task.task_type_code);
  const taskTypeOptions = React.useMemo(() => {
    const activeOptions = (taskTypesData || [])
      .filter((t) => t.is_active)
      .map((t) => ({ label: t.name, value: t.id }));
    return withCurrentOption(activeOptions, task.task_type_id, currentTypeLabel);
  }, [taskTypesData, task.task_type_id, currentTypeLabel]);

  // Fetch classification data (sources, categories, streams) for standalone tasks
  const { data: classificationData } = useQuery({
    queryKey: ['portfolio-classification'],
    queryFn: async () => {
      const res = await api.get('/portfolio/classification/all');
      return res.data as {
        sources: ClassificationSource[];
        categories: ClassificationCategory[];
        streams: ClassificationStream[];
      };
    },
    enabled: canEditClassification && !readOnly,
  });

  const sources = classificationData?.sources?.filter((s) => s.is_active) || [];
  const categories = classificationData?.categories?.filter((c) => c.is_active) || [];
  const streams = classificationData?.streams?.filter((s) => s.is_active) || [];

  // Filter streams by selected category
  const filteredStreams = React.useMemo(() => {
    if (!task.category_id) return streams;
    return streams.filter((s) => s.category_id === task.category_id);
  }, [streams, task.category_id]);

  const sourceOptions = React.useMemo(() => {
    const options = sources.map((s) => ({ label: s.name, value: s.id }));
    return withCurrentOption(options, task.source_id, task.source_name);
  }, [sources, task.source_id, task.source_name]);

  const categoryOptions = React.useMemo(() => {
    const options = categories.map((c) => ({ label: c.name, value: c.id }));
    return withCurrentOption(options, task.category_id, task.category_name);
  }, [categories, task.category_id, task.category_name]);

  const streamOptions = React.useMemo(() => {
    const options = filteredStreams.map((s) => ({ label: s.name, value: s.id }));
    return withCurrentOption(options, task.stream_id, task.stream_name);
  }, [filteredStreams, task.stream_id, task.stream_name]);

  // Fetch phases for the project (if task is project-related and has a valid project ID)
  const { data: phases = [] } = useQuery({
    queryKey: ['project-phases', task.related_object_id],
    queryFn: async () => {
      if (task.related_object_type !== 'project' || !task.related_object_id) return [];
      const res = await api.get<Array<{ id: string; name: string }>>(`/portfolio/projects/${task.related_object_id}/phases`);
      return res.data;
    },
    enabled: task.related_object_type === 'project' && !!task.related_object_id,
  });

  const handleAccordionChange = (panel: string) => (_: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(prev =>
      isExpanded ? [...prev, panel] : prev.filter(p => p !== panel)
    );
  };

  const formatHours = (hours: number) => {
    const days = Math.floor(hours / 8);
    const remaining = Math.round(hours % 8);
    if (days > 0 && remaining > 0) {
      return t('workspace.task.workLog.duration.daysHours', { days, hours: remaining });
    } else if (days > 0) {
      return t('workspace.task.workLog.duration.daysOnly', { days });
    }
    return t('workspace.task.workLog.duration.hoursOnly', { hours });
  };

  // Task types that don't support time logging
  const timeLoggingExcludedTypes = ['contract', 'spend_item', 'capex_item'];
  const supportsTimeLogging = isStandalone || !timeLoggingExcludedTypes.includes(task.related_object_type || '');
  const hasClassificationValues = Boolean(task.source_name || task.category_name || task.stream_name || task.company_name);
  const showClassificationSection = canEditClassification || hasClassificationValues;

  return (
    <Box sx={{ width: '100%' }}>
      {/* CONTEXT - First */}
      <Accordion
        expanded={expanded.includes('context')}
        onChange={handleAccordionChange('context')}
        disableGutters
        elevation={0}
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={accordionSummarySx}>
          <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
            {t('workspace.task.sidebar.sections.context')}
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Stack spacing={1.25} sx={compactFieldSx}>
            {onRelationChange && !readOnly ? (
              <RelatedObjectSelect
                relationType={task.related_object_type as RelatedObjectType}
                relationId={task.related_object_id || null}
                relationName={task.related_object_name || null}
                onChangeType={(type) => onRelationChange({ type, id: null, name: null })}
                onChangeId={(id, name) =>
                  onRelationChange({ type: task.related_object_type as RelatedObjectType, id, name })
                }
                size="small"
              />
            ) : isStandalone ? (
              <PropertyRow
                label={t('workspace.task.sidebar.fields.relatedTo')}
                sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.25 }}
                valueSx={{ fontWeight: 500 }}
              >
                {t('workspace.task.sidebar.values.standaloneTask')}
              </PropertyRow>
            ) : (
              <PropertyRow
                label={t('workspace.task.sidebar.fields.relatedTo')}
                sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.25 }}
              >
                <Box>
                  <Typography component="span" fontWeight={500}>
                    {isProjectTask
                      ? relatedTypeLabels.project
                      : task.related_object_type === 'spend_item'
                      ? relatedTypeLabels.spend_item
                      : task.related_object_type === 'contract'
                      ? relatedTypeLabels.contract
                      : task.related_object_type === 'capex_item'
                      ? relatedTypeLabels.capex_item
                      : task.related_object_type === 'incident'
                      ? relatedTypeLabels.incident
                      : relatedTypeLabels.unknown}
                  </Typography>
                  <Typography component="span"> : </Typography>
                  <Typography
                    component={Link}
                    to={isProjectTask ? (projectWorkspaceLink || `/portfolio/projects/${task.related_object_id}`) :
                        task.related_object_type === 'spend_item' ? `/ops/budget/${task.related_object_id}` :
                        task.related_object_type === 'contract' ? `/ops/contracts/${task.related_object_id}` :
                        task.related_object_type === 'capex_item' ? `/ops/budget/${task.related_object_id}` :
                        task.related_object_type === 'incident' ? `/it/incidents/${task.related_object_id}/overview` :
                        '#'}
                    sx={{ color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                  >
                    {task.related_object_name || t('workspace.task.sidebar.values.unknown')}
                  </Typography>
                </Box>
              </PropertyRow>
            )}

            {isProjectTask && (
              readOnly ? (
                <PropertyRow label={t('workspace.task.sidebar.fields.phase')}>
                  {task.phase_name || t('workspace.task.sidebar.values.projectLevel')}
                </PropertyRow>
              ) : (
                <EnumAutocomplete
                  label={t('workspace.task.sidebar.fields.phase')}
                  value={task.phase_id || ''}
                  onChange={(v) => onPatch({ phase_id: v || null })}
                  options={[
                    { label: t('workspace.task.sidebar.values.projectLevel'), value: '' },
                    ...phases.map((p) => ({ label: p.name, value: p.id })),
                  ]}
                  size="small"
                />
              )
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Divider />

      {/* TASK DETAILS - Second */}
      <Accordion
        expanded={expanded.includes('details')}
        onChange={handleAccordionChange('details')}
        disableGutters
        elevation={0}
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={accordionSummarySx}>
          <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
            {t('workspace.task.sidebar.sections.details')}
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Stack spacing={1.25} sx={compactFieldSx}>
            {readOnly ? (
              <PropertyRow label={t('workspace.task.sidebar.fields.taskType')}>
                {taskTypeOptions.find((o) => o.value === task.task_type_id)?.label || currentTypeLabel || '-'}
              </PropertyRow>
            ) : (
              <EnumAutocomplete
                label={t('workspace.task.sidebar.fields.taskType')}
                value={task.task_type_id || ''}
                onChange={(v) => onPatch({ task_type_id: v || null })}
                options={taskTypeOptions}
                size="small"
              />
            )}

            {readOnly ? (
              <PropertyRow label={t('workspace.task.sidebar.fields.priority')}>
                {getPriorityLabel(t, task.priority_level)}
              </PropertyRow>
            ) : (
              <EnumAutocomplete
                label={t('workspace.task.sidebar.fields.priority')}
                value={task.priority_level}
                onChange={(v) => onPatch({ priority_level: v })}
                options={priorityOptions}
                size="small"
              />
            )}

            {readOnly ? (
              <PropertyRow label={t('workspace.task.sidebar.fields.status')}>
                {statusOptions.find((o) => o.value === task.status)?.label || task.status}
              </PropertyRow>
            ) : (
              <EnumAutocomplete
                label={t('workspace.task.sidebar.fields.status')}
                value={task.status}
                onChange={(v) => onPatch({ status: v })}
                options={statusOptions}
                size="small"
              />
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>

      {showClassificationSection && (
        <>
          <Divider />

          {/* CLASSIFICATION - Third */}
          <Accordion
            expanded={expanded.includes('classification')}
            onChange={handleAccordionChange('classification')}
            disableGutters
            elevation={0}
            sx={accordionSx}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={accordionSummarySx}>
              <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                {t('workspace.task.sidebar.sections.classification')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Stack spacing={1.25} sx={compactFieldSx}>
                {canEditClassification && !readOnly ? (
                  <>
                    <EnumAutocomplete
                      label={t('workspace.task.sidebar.fields.source')}
                      value={task.source_id || ''}
                      onChange={(v) => onPatch({ source_id: v || null })}
                      options={sourceOptions}
                      size="small"
                    />
                    <EnumAutocomplete
                      label={t('workspace.task.sidebar.fields.category')}
                      value={task.category_id || ''}
                      onChange={(v) => {
                        const nextCategoryId = v || null;
                        const nextPatch: Record<string, any> = { category_id: nextCategoryId };
                        if (task.stream_id) {
                          const streamBelongsToCategory = nextCategoryId
                            ? streams.some((s) => s.id === task.stream_id && s.category_id === nextCategoryId)
                            : false;
                          if (!streamBelongsToCategory) {
                            nextPatch.stream_id = null;
                          }
                        }
                        onPatch(nextPatch);
                      }}
                      options={categoryOptions}
                      size="small"
                    />
                    <EnumAutocomplete
                      label={t('workspace.task.sidebar.fields.stream')}
                      value={task.stream_id || ''}
                      onChange={(v) => onPatch({ stream_id: v || null })}
                      options={streamOptions}
                      size="small"
                      disabled={!task.category_id}
                    />
                    <CompanySelect
                      label={t('workspace.task.sidebar.fields.company')}
                      value={task.company_id || null}
                      onChange={(v) => onPatch({ company_id: v })}
                      size="small"
                    />
                  </>
                ) : (
                  <>
                    {task.source_name && (
                      <PropertyRow label={t('workspace.task.sidebar.fields.source')}>
                        {task.source_name}
                      </PropertyRow>
                    )}
                    {task.category_name && (
                      <PropertyRow label={t('workspace.task.sidebar.fields.category')}>
                        {task.category_name}
                      </PropertyRow>
                    )}
                    {task.stream_name && (
                      <PropertyRow label={t('workspace.task.sidebar.fields.stream')}>
                        {task.stream_name}
                      </PropertyRow>
                    )}
                    {task.company_name && (
                      <PropertyRow label={t('workspace.task.sidebar.fields.company')}>
                        {task.company_name}
                      </PropertyRow>
                    )}
                    {!hasClassificationValues && (
                      <Typography variant="body2" color="text.secondary">
                        {t('workspace.task.sidebar.values.noClassification')}
                      </Typography>
                    )}
                  </>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
        </>
      )}

      {/* TIME - Fourth (hidden in create mode and for task types that don't support time logging) */}
      {!isCreate && supportsTimeLogging && (
        <>
          <Divider />

          <Accordion
            expanded={expanded.includes('time')}
            onChange={handleAccordionChange('time')}
            disableGutters
            elevation={0}
            sx={accordionSx}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={accordionSummarySx}>
              <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                {t('workspace.task.sidebar.sections.time')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Stack spacing={1.25} sx={compactFieldSx}>
                {!readOnly && supportsTimeLogging && canLogTime && (
                  <Button
                    startIcon={<AddIcon />}
                    size="small"
                    onClick={() => setLogTimeOpen(true)}
                  >
                    {t('dialogs.logTime.actions.logTime')}
                  </Button>
                )}
                <PropertyRow
                  label={t('workspace.task.sidebar.fields.timeSpent')}
                  valueSx={{ fontSize: '1rem', fontWeight: 500 }}
                >
                  {formatHours(totalTimeHours)}
                </PropertyRow>
              </Stack>
            </AccordionDetails>
          </Accordion>

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
        </>
      )}

      <Divider />

      {/* PEOPLE - Fifth */}
      <Accordion
        expanded={expanded.includes('people')}
        onChange={handleAccordionChange('people')}
        disableGutters
        elevation={0}
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={accordionSummarySx}>
          <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
            {t('workspace.task.sidebar.sections.people')}
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Stack spacing={1.25} sx={compactFieldSx}>
            <UserSelect
              label={t('workspace.task.sidebar.fields.requestor')}
              value={task.creator_id}
              onChange={(v) => onPatch({ creator_id: v })}
              disabled={readOnly}
              size="small"
            />
            <UserSelect
              label={t('workspace.task.sidebar.fields.assignee')}
              value={task.assignee_user_id}
              onChange={(v) => onPatch({ assignee_user_id: v })}
              disabled={readOnly}
              size="small"
            />
            <UserMultiSelect
              label={t('workspace.task.sidebar.fields.viewers')}
              value={task.viewer_ids || []}
              onChange={(v) => onPatch({ viewer_ids: v })}
              disabled={readOnly}
              size="small"
            />
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Divider />

      {/* DATES - Sixth (Last) */}
      <Accordion
        expanded={expanded.includes('dates')}
        onChange={handleAccordionChange('dates')}
        disableGutters
        elevation={0}
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={accordionSummarySx}>
          <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
            {t('workspace.task.sidebar.sections.dates')}
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Stack spacing={1.25} sx={compactFieldSx}>
            <DateEUField
              label={t('workspace.task.sidebar.fields.startDate')}
              valueYmd={task.start_date || ''}
              onChangeYmd={(v) => onPatch({ start_date: v || null })}
              disabled={readOnly}
              size="small"
            />
            <DateEUField
              label={t('workspace.task.sidebar.fields.dueDate')}
              valueYmd={task.due_date || ''}
              onChangeYmd={(v) => onPatch({ due_date: v || null })}
              disabled={readOnly}
              size="small"
            />
          </Stack>
        </AccordionDetails>
      </Accordion>

      {showKnowledge && (
        <>
          <Divider />
          <Accordion
            expanded={expanded.includes('knowledge')}
            onChange={handleAccordionChange('knowledge')}
            disableGutters
            elevation={0}
            sx={accordionSx}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={accordionSummarySx}>
              <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                {t('workspace.task.sidebar.sections.knowledge')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <EntityKnowledgePanel
                entityType="tasks"
                entityId={task.id}
                canCreate={canCreateKnowledge}
                variant="sidebar"
              />
            </AccordionDetails>
          </Accordion>
        </>
      )}
    </Box>
  );
}
