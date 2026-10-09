import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, Collapse, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
  IconButton, Stack, Switch, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import PageHeader from '../../components/PageHeader';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useKanapDialogs } from '../../components/design';

interface CriterionValue {
  id?: string;
  label: string;
  triggers_mandatory_bypass: boolean;
}

interface Criterion {
  id: string;
  name: string;
  enabled: boolean;
  inverted: boolean;
  weight: number;
  display_order: number;
  values: CriterionValue[];
}

interface Settings {
  mandatory_bypass_enabled: boolean;
}

interface Skill {
  id: string;
  category: string;
  name: string;
  enabled: boolean;
  display_order: number;
}

interface PhaseTemplateItem {
  id?: string;
  name: string;
  has_milestone: boolean;
  milestone_name: string | null;
}

interface PhaseTemplate {
  id: string;
  name: string;
  is_system: boolean;
  sequence: number;
  items: PhaseTemplateItem[];
}

interface PortfolioTeam {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  is_system: boolean;
  parent_id: string | null;
  member_count: number;
}

interface EmploymentType {
  id: string;
  name: string;
  is_active: boolean;
  display_order: number;
  is_system: boolean;
  usage_count: number;
}

interface PortfolioSource {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  is_system: boolean;
}

interface PortfolioTaskType {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  is_system: boolean;
}

interface PortfolioStream {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
}

interface PortfolioCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  is_system: boolean;
  streams: PortfolioStream[];
}

/**
 * One evaluation criterion card. The left grip is only active when the user
 * can edit; it drives the @dnd-kit sortable reordering of the criteria list.
 */
function SortableCriterionCard({
  criterion,
  canEdit,
  onToggle,
  onEdit,
  onDelete,
  t,
}: {
  criterion: Criterion;
  canEdit: boolean;
  onToggle: (criterion: Criterion) => void;
  onEdit: (criterion: Criterion) => void;
  onDelete: (id: string) => void;
  t: TFunction;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: criterion.id, disabled: !canEdit });

  return (
    <Card
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Box
            component="span"
            aria-label={t('settings.scoring.dragToReorder')}
            sx={{
              display: 'inline-flex',
              cursor: canEdit ? 'grab' : 'default',
              touchAction: 'none',
              color: 'kanap.text.tertiary',
            }}
            {...(canEdit ? attributes : {})}
            {...(canEdit ? listeners : {})}
          >
            <DragIndicatorIcon fontSize="small" />
          </Box>

          <Switch
            checked={criterion.enabled}
            onChange={() => onToggle(criterion)}
            size="small"
            disabled={!canEdit}
          />

          <Box sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1">{criterion.name}</Typography>
              {criterion.inverted && (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                  {t('settings.scoring.chips.inverted')}
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                {t('settings.scoring.chips.weight', { value: criterion.weight })}
              </Typography>
              {!criterion.enabled && (
                <Typography variant="body2" color="warning.main" sx={{ fontSize: '0.8125rem' }}>
                  {t('common:statuses.disabled')}
                </Typography>
              )}
            </Stack>

            <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
              {criterion.values.map((v, idx) => (
                <Typography
                  key={v.id || idx}
                  variant="body2"
                  sx={{
                    fontSize: '0.8125rem',
                    color: v.triggers_mandatory_bypass ? 'error.main' : 'text.secondary',
                    fontWeight: v.triggers_mandatory_bypass ? 500 : 400,
                  }}
                >
                  {v.label}
                </Typography>
              ))}
            </Stack>
          </Box>

          {canEdit && (
            <>
              <IconButton onClick={() => onEdit(criterion)}>
                <EditIcon />
              </IconButton>
              <IconButton color="error" onClick={() => onDelete(criterion.id)}>
                <DeleteIcon />
              </IconButton>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { hasLevel } = useAuth();
  const { t } = useTranslation(['portfolio', 'common']);
  const dialogs = useKanapDialogs();
  const canEdit = hasLevel('portfolio_settings', 'admin');
  const confirmDelete = useCallback((message: string) => dialogs.confirm({
    message,
    confirmLabel: t('common:buttons.delete'),
    intent: 'danger',
  }), [dialogs, t]);

  const [activeTab, setActiveTab] = useState(0);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [settings, setSettings] = useState<Settings>({ mandatory_bypass_enabled: false });
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsGrouped, setSkillsGrouped] = useState<Record<string, Skill[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCriterion, setEditingCriterion] = useState<Criterion | null>(null);
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [phaseTemplates, setPhaseTemplates] = useState<PhaseTemplate[]>([]);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PhaseTemplate | null>(null);

  // Classification state
  const [sources, setSources] = useState<PortfolioSource[]>([]);
  const [categories, setCategories] = useState<PortfolioCategory[]>([]);
  const [taskTypes, setTaskTypes] = useState<PortfolioTaskType[]>([]);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<PortfolioSource | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<PortfolioCategory | null>(null);
  const [streamDialogOpen, setStreamDialogOpen] = useState(false);
  const [editingStream, setEditingStream] = useState<PortfolioStream | null>(null);
  const [streamCategoryId, setStreamCategoryId] = useState<string | null>(null);
  const [taskTypeDialogOpen, setTaskTypeDialogOpen] = useState(false);
  const [editingTaskType, setEditingTaskType] = useState<PortfolioTaskType | null>(null);

  // Teams state
  const [teams, setTeams] = useState<PortfolioTeam[]>([]);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<PortfolioTeam | null>(null);

  // Employment types state
  const [employmentTypes, setEmploymentTypes] = useState<EmploymentType[]>([]);
  const [employmentTypeDialogOpen, setEmploymentTypeDialogOpen] = useState(false);
  const [editingEmploymentType, setEditingEmploymentType] = useState<EmploymentType | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [criteriaRes, settingsRes, skillsRes, templatesRes, classificationRes, teamsRes, employmentTypesRes] = await Promise.all([
        api.get('/portfolio/criteria'),
        api.get('/portfolio/settings'),
        api.get('/portfolio/skills'),
        api.get('/portfolio/phase-templates'),
        api.get('/portfolio/classification/all'),
        api.get('/portfolio/teams'),
        api.get('/portfolio/employment-types'),
      ]);
      setCriteria(criteriaRes.data || []);
      setSettings(settingsRes.data || { mandatory_bypass_enabled: false });
      setSkills(skillsRes.data?.items || []);
      setSkillsGrouped(skillsRes.data?.grouped || {});
      setPhaseTemplates(templatesRes.data || []);
      setSources(classificationRes.data?.sources || []);
      setCategories(classificationRes.data?.categories || []);
      setTaskTypes(classificationRes.data?.taskTypes || []);
      setTeams(teamsRes.data || []);
      setEmploymentTypes(employmentTypesRes.data || []);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleEnabled = useCallback(async (criterion: Criterion) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/criteria/${criterion.id}`, {
        enabled: !criterion.enabled,
      });
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.scoring.messages.updateFailed')));
    }
  }, [loadData, canEdit, t]);

  const handleToggleBypassSetting = useCallback(async () => {
    if (!canEdit) return;
    try {
      await api.patch('/portfolio/settings', {
        mandatory_bypass_enabled: !settings.mandatory_bypass_enabled,
      });
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.scoring.messages.updateSettingsFailed')));
    }
  }, [settings.mandatory_bypass_enabled, loadData, canEdit, t]);

  const handleEditClick = useCallback((criterion: Criterion) => {
    setEditingCriterion(criterion);
    setEditDialogOpen(true);
  }, []);

  const handleCreateClick = useCallback(() => {
    setEditingCriterion(null);
    setEditDialogOpen(true);
  }, []);

  const handleDeleteCriterion = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!await confirmDelete(t('settings.scoring.confirmDelete'))) return;

    try {
      await api.delete(`/portfolio/criteria/${id}`);
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.scoring.messages.deleteFailed')));
    }
  }, [loadData, canEdit, confirmDelete, t]);

  const criteriaSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleCriteriaDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = criteria.findIndex((c) => c.id === active.id);
    const newIndex = criteria.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(criteria, oldIndex, newIndex);
    setCriteria(reordered);

    try {
      await api.post('/portfolio/criteria/reorder', {
        criterion_ids: reordered.map((c) => c.id),
      });
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.scoring.messages.reorderFailed')));
      loadData();
    }
  }, [criteria, loadData, t]);

  // Skills handlers
  const handleSeedDefaults = useCallback(async () => {
    if (!canEdit) return;
    try {
      const res = await api.post('/portfolio/skills/seed-defaults');
      if (res.data?.created > 0) {
        loadData();
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.skills.messages.seedDefaultsFailed')));
    }
  }, [canEdit, loadData, t]);

  const handleSkillToggle = useCallback(async (skill: Skill) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/skills/${skill.id}`, { enabled: !skill.enabled });
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.skills.messages.updateFailed')));
    }
  }, [canEdit, loadData, t]);

  const handleDeleteSkill = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!await confirmDelete(t('settings.skills.confirmDelete'))) return;
    try {
      await api.delete(`/portfolio/skills/${id}`);
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.skills.messages.deleteFailed')));
    }
  }, [canEdit, confirmDelete, loadData, t]);

  const handleEditSkill = useCallback((skill: Skill) => {
    setEditingSkill(skill);
    setSkillDialogOpen(true);
  }, []);

  const handleCreateSkill = useCallback(() => {
    setEditingSkill(null);
    setSkillDialogOpen(true);
  }, []);

  // Phase Template handlers
  const handleEditTemplate = useCallback((template: PhaseTemplate) => {
    setEditingTemplate(template);
    setTemplateDialogOpen(true);
  }, []);

  const handleCreateTemplate = useCallback(() => {
    setEditingTemplate(null);
    setTemplateDialogOpen(true);
  }, []);

  const handleDeleteTemplate = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!await confirmDelete(t('settings.phaseTemplates.confirmDelete'))) return;
    try {
      await api.delete(`/portfolio/phase-templates/${id}`);
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.phaseTemplates.messages.deleteFailed')));
    }
  }, [canEdit, confirmDelete, loadData, t]);

  // Classification handlers
  const handleEditSource = useCallback((source: PortfolioSource) => {
    setEditingSource(source);
    setSourceDialogOpen(true);
  }, []);

  const handleCreateSource = useCallback(() => {
    setEditingSource(null);
    setSourceDialogOpen(true);
  }, []);

  const handleDeleteSource = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!await confirmDelete(t('settings.classification.confirmations.deleteSource'))) return;
    try {
      await api.delete(`/portfolio/classification/sources/${id}`);
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.deleteSourceFailed')));
    }
  }, [canEdit, confirmDelete, loadData, t]);

  const handleToggleSource = useCallback(async (source: PortfolioSource) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/classification/sources/${source.id}`, { is_active: !source.is_active });
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.updateSourceFailed')));
    }
  }, [canEdit, loadData, t]);

  const handleEditCategory = useCallback((category: PortfolioCategory) => {
    setEditingCategory(category);
    setCategoryDialogOpen(true);
  }, []);

  const handleCreateCategory = useCallback(() => {
    setEditingCategory(null);
    setCategoryDialogOpen(true);
  }, []);

  const handleDeleteCategory = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!await confirmDelete(t('settings.classification.confirmations.deleteCategory'))) return;
    try {
      await api.delete(`/portfolio/classification/categories/${id}`);
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.deleteCategoryFailed')));
    }
  }, [canEdit, confirmDelete, loadData, t]);

  const handleToggleCategory = useCallback(async (category: PortfolioCategory) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/classification/categories/${category.id}`, { is_active: !category.is_active });
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.updateCategoryFailed')));
    }
  }, [canEdit, loadData, t]);

  const handleEditStream = useCallback((stream: PortfolioStream) => {
    setEditingStream(stream);
    setStreamCategoryId(stream.category_id);
    setStreamDialogOpen(true);
  }, []);

  const handleCreateStream = useCallback((categoryId: string) => {
    setEditingStream(null);
    setStreamCategoryId(categoryId);
    setStreamDialogOpen(true);
  }, []);

  const handleDeleteStream = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!await confirmDelete(t('settings.classification.confirmations.deleteStream'))) return;
    try {
      await api.delete(`/portfolio/classification/streams/${id}`);
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.deleteStreamFailed')));
    }
  }, [canEdit, confirmDelete, loadData, t]);

  const handleToggleStream = useCallback(async (stream: PortfolioStream) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/classification/streams/${stream.id}`, { is_active: !stream.is_active });
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.updateStreamFailed')));
    }
  }, [canEdit, loadData, t]);

  // Task Type handlers
  const handleEditTaskType = useCallback((taskType: PortfolioTaskType) => {
    setEditingTaskType(taskType);
    setTaskTypeDialogOpen(true);
  }, []);

  const handleCreateTaskType = useCallback(() => {
    setEditingTaskType(null);
    setTaskTypeDialogOpen(true);
  }, []);

  const handleDeleteTaskType = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!await confirmDelete(t('settings.classification.confirmations.deleteTaskType'))) return;
    try {
      await api.delete(`/portfolio/classification/task-types/${id}`);
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.deleteTaskTypeFailed')));
    }
  }, [canEdit, confirmDelete, loadData, t]);

  const handleToggleTaskType = useCallback(async (taskType: PortfolioTaskType) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/classification/task-types/${taskType.id}`, { is_active: !taskType.is_active });
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.updateTaskTypeFailed')));
    }
  }, [canEdit, loadData, t]);

  // Teams handlers
  const handleEditTeam = useCallback((team: PortfolioTeam) => {
    setEditingTeam(team);
    setTeamDialogOpen(true);
  }, []);

  const handleCreateTeam = useCallback(() => {
    setEditingTeam(null);
    setTeamDialogOpen(true);
  }, []);

  const handleDeleteTeam = useCallback(async (id: string) => {
    if (!canEdit) return;
    if (!await confirmDelete(t('settings.teams.confirmDelete'))) return;
    try {
      await api.delete(`/portfolio/teams/${id}`);
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.teams.messages.deleteFailed')));
    }
  }, [canEdit, confirmDelete, loadData, t]);

  const handleToggleTeam = useCallback(async (team: PortfolioTeam) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/teams/${team.id}`, { is_active: !team.is_active });
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.teams.messages.updateFailed')));
    }
  }, [canEdit, loadData, t]);

  const handleSeedTeams = useCallback(async () => {
    if (!canEdit) return;
    try {
      const res = await api.post('/portfolio/teams/seed-defaults');
      if (res.data?.created > 0) {
        loadData();
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.teams.messages.seedDefaultsFailed')));
    }
  }, [canEdit, loadData, t]);

  // Employment types handlers
  const handleEditEmploymentType = useCallback((type: EmploymentType) => {
    setEditingEmploymentType(type);
    setEmploymentTypeDialogOpen(true);
  }, []);

  const handleCreateEmploymentType = useCallback(() => {
    setEditingEmploymentType(null);
    setEmploymentTypeDialogOpen(true);
  }, []);

  // Delete is only offered when nothing references the type, so there is
  // nothing to warn about and no confirmation to show.
  const handleDeleteEmploymentType = useCallback(async (id: string) => {
    if (!canEdit) return;
    try {
      await api.delete(`/portfolio/employment-types/${id}`);
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.employmentTypes.messages.deleteFailed')));
    }
  }, [canEdit, loadData, t]);

  const handleToggleEmploymentType = useCallback(async (type: EmploymentType) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/employment-types/${type.id}`, { is_active: !type.is_active });
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.employmentTypes.messages.updateFailed')));
    }
  }, [canEdit, loadData, t]);

  const handleSeedEmploymentTypes = useCallback(async () => {
    if (!canEdit) return;
    try {
      const res = await api.post('/portfolio/employment-types/seed-defaults');
      if (res.data?.created > 0) {
        loadData();
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.employmentTypes.messages.seedDefaultsFailed')));
    }
  }, [canEdit, loadData, t]);

  const actions = canEdit ? (
    activeTab === 0 ? (
      <Button variant="action-primary" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleCreateClick}>
        {t('settings.actions.addCriterion')}
      </Button>
    ) : activeTab === 1 ? (
      <Stack direction="row" spacing={1}>
        {skills.length === 0 && (
          <Button variant="action" startIcon={<PlaylistAddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleSeedDefaults}>
            {t('settings.actions.seedDefaults')}
          </Button>
        )}
        <Button variant="action-primary" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleCreateSkill}>
          {t('settings.actions.addSkill')}
        </Button>
      </Stack>
    ) : activeTab === 2 ? (
      <Button variant="action-primary" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleCreateTemplate}>
        {t('settings.actions.addTemplate')}
      </Button>
    ) : activeTab === 4 ? (
      <Stack direction="row" spacing={1}>
        {teams.length === 0 && (
          <Button variant="action" startIcon={<PlaylistAddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleSeedTeams}>
            {t('settings.actions.seedDefaults')}
          </Button>
        )}
        <Button variant="action-primary" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleCreateTeam}>
          {t('settings.actions.addTeam')}
        </Button>
      </Stack>
    ) : activeTab === 5 ? (
      <Stack direction="row" spacing={1}>
        {employmentTypes.length === 0 && (
          <Button variant="action" startIcon={<PlaylistAddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleSeedEmploymentTypes}>
            {t('settings.actions.seedDefaults')}
          </Button>
        )}
        <Button variant="action-primary" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleCreateEmploymentType}>
          {t('settings.actions.addEmploymentType')}
        </Button>
      </Stack>
    ) : null
  ) : null;

  return (
    <>
      <PageHeader title={t('settings.title')} actions={actions} />

      <Box sx={{ p: 3, maxWidth: 1200 }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 3 }}>
          <Tab label={t('settings.tabs.scoringCriteria')} />
          <Tab label={t('settings.tabs.skills')} />
          <Tab label={t('settings.tabs.phaseTemplates')} />
          <Tab label={t('settings.tabs.classification')} />
          <Tab label={t('settings.tabs.teams')} />
          <Tab label={t('settings.tabs.employmentTypes')} />
        </Tabs>

        {/* Tab 0: Scoring Criteria */}
        {activeTab === 0 && (
          <>
            {/* Mandatory Bypass Setting */}
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.mandatory_bypass_enabled}
                      onChange={handleToggleBypassSetting}
                      disabled={!canEdit}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="subtitle1">
                        {t('settings.scoring.mandatoryBypassTitle')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('settings.scoring.mandatoryBypassDescription')}
                      </Typography>
                    </Box>
                  }
                />
              </CardContent>
            </Card>

            {/* Evaluation Criteria */}
            <Typography variant="h6" sx={{ mb: 1 }}>
              {t('settings.scoring.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('settings.scoring.reorderHint')}
            </Typography>

            {criteria.length === 0 && !loading && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('settings.scoring.empty')}
              </Alert>
            )}

            <DndContext
              sensors={criteriaSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleCriteriaDragEnd}
            >
              <SortableContext
                items={criteria.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <Stack spacing={2}>
                  {criteria.map((criterion) => (
                    <SortableCriterionCard
                      key={criterion.id}
                      criterion={criterion}
                      canEdit={canEdit}
                      onToggle={handleToggleEnabled}
                      onEdit={handleEditClick}
                      onDelete={handleDeleteCriterion}
                      t={t}
                    />
                  ))}
                </Stack>
              </SortableContext>
            </DndContext>
          </>
        )}

        {/* Tab 1: Skills */}
        {activeTab === 1 && (
          <SkillsSection
            skills={skills}
            skillsGrouped={skillsGrouped}
            canEdit={canEdit}
            onToggle={handleSkillToggle}
            onEdit={handleEditSkill}
            onDelete={handleDeleteSkill}
          />
        )}

        {/* Tab 2: Phase Templates */}
        {activeTab === 2 && (
          <PhaseTemplatesSection
            templates={phaseTemplates}
            canEdit={canEdit}
            onEdit={handleEditTemplate}
            onDelete={handleDeleteTemplate}
          />
        )}

        {/* Tab 3: Classification */}
        {activeTab === 3 && (
          <ClassificationSection
            sources={sources}
            categories={categories}
            taskTypes={taskTypes}
            canEdit={canEdit}
            onEditSource={handleEditSource}
            onCreateSource={handleCreateSource}
            onDeleteSource={handleDeleteSource}
            onToggleSource={handleToggleSource}
            onEditCategory={handleEditCategory}
            onCreateCategory={handleCreateCategory}
            onDeleteCategory={handleDeleteCategory}
            onToggleCategory={handleToggleCategory}
            onEditStream={handleEditStream}
            onCreateStream={handleCreateStream}
            onDeleteStream={handleDeleteStream}
            onToggleStream={handleToggleStream}
            onEditTaskType={handleEditTaskType}
            onCreateTaskType={handleCreateTaskType}
            onDeleteTaskType={handleDeleteTaskType}
            onToggleTaskType={handleToggleTaskType}
          />
        )}

        {/* Tab 4: Teams */}
        {activeTab === 4 && (
          <TeamsSection
            teams={teams}
            canEdit={canEdit}
            onEdit={handleEditTeam}
            onDelete={handleDeleteTeam}
            onToggle={handleToggleTeam}
          />
        )}

        {/* Tab 5: Employment types */}
        {activeTab === 5 && (
          <EmploymentTypesSection
            employmentTypes={employmentTypes}
            canEdit={canEdit}
            onEdit={handleEditEmploymentType}
            onDelete={handleDeleteEmploymentType}
            onToggle={handleToggleEmploymentType}
          />
        )}

        {/* Edit/Create Criterion Dialog */}
        <CriterionEditDialog
          open={editDialogOpen}
          criterion={editingCriterion}
          onClose={() => setEditDialogOpen(false)}
          onSave={() => {
            setEditDialogOpen(false);
            loadData();
          }}
        />

        {/* Edit/Create Skill Dialog */}
        <SkillEditDialog
          open={skillDialogOpen}
          skill={editingSkill}
          existingCategories={Object.keys(skillsGrouped)}
          onClose={() => setSkillDialogOpen(false)}
          onSave={() => {
            setSkillDialogOpen(false);
            loadData();
          }}
        />

        {/* Edit/Create Phase Template Dialog */}
        <PhaseTemplateEditDialog
          open={templateDialogOpen}
          template={editingTemplate}
          onClose={() => setTemplateDialogOpen(false)}
          onSave={() => {
            setTemplateDialogOpen(false);
            loadData();
          }}
        />

        {/* Edit/Create Source Dialog */}
        <SourceEditDialog
          open={sourceDialogOpen}
          source={editingSource}
          onClose={() => setSourceDialogOpen(false)}
          onSave={() => {
            setSourceDialogOpen(false);
            loadData();
          }}
        />

        {/* Edit/Create Category Dialog */}
        <CategoryEditDialog
          open={categoryDialogOpen}
          category={editingCategory}
          onClose={() => setCategoryDialogOpen(false)}
          onSave={() => {
            setCategoryDialogOpen(false);
            loadData();
          }}
        />

        {/* Edit/Create Stream Dialog */}
        <StreamEditDialog
          open={streamDialogOpen}
          stream={editingStream}
          categoryId={streamCategoryId}
          onClose={() => setStreamDialogOpen(false)}
          onSave={() => {
            setStreamDialogOpen(false);
            loadData();
          }}
        />

        {/* Edit/Create Task Type Dialog */}
        <TaskTypeEditDialog
          open={taskTypeDialogOpen}
          taskType={editingTaskType}
          onClose={() => setTaskTypeDialogOpen(false)}
          onSave={() => {
            setTaskTypeDialogOpen(false);
            loadData();
          }}
        />

        {/* Edit/Create Team Dialog */}
        <TeamEditDialog
          open={teamDialogOpen}
          team={editingTeam}
          onClose={() => setTeamDialogOpen(false)}
          onSave={() => {
            setTeamDialogOpen(false);
            loadData();
          }}
        />

        {/* Edit/Create Employment Type Dialog */}
        <EmploymentTypeEditDialog
          open={employmentTypeDialogOpen}
          employmentType={editingEmploymentType}
          onClose={() => setEmploymentTypeDialogOpen(false)}
          onSave={() => {
            setEmploymentTypeDialogOpen(false);
            loadData();
          }}
        />
      </Box>
    </>
  );
}

// Criterion Edit Dialog Component
function CriterionEditDialog({
  open,
  criterion,
  onClose,
  onSave,
}: {
  open: boolean;
  criterion: Criterion | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [inverted, setInverted] = useState(false);
  const [weight, setWeight] = useState(1);
  const [values, setValues] = useState<CriterionValue[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (criterion) {
      setName(criterion.name);
      setInverted(criterion.inverted);
      setWeight(criterion.weight);
      setValues(criterion.values.map((v) => ({ ...v })));
    } else {
      setName('');
      setInverted(false);
      setWeight(1);
      setValues([
        { label: t('settings.scoring.dialog.defaults.low'), triggers_mandatory_bypass: false },
        { label: t('settings.scoring.dialog.defaults.high'), triggers_mandatory_bypass: false },
      ]);
    }
    setError(null);
  }, [criterion, open, t]);

  const handleAddValue = () => {
    setValues([...values, { label: '', triggers_mandatory_bypass: false }]);
  };

  const handleRemoveValue = (index: number) => {
    if (values.length <= 2) return;
    setValues(values.filter((_, i) => i !== index));
  };

  const handleValueChange = (index: number, field: keyof CriterionValue, value: any) => {
    setValues(
      values.map((v, i) =>
        i === index ? { ...v, [field]: value } : v
      )
    );
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    try {
      const payload = {
        name,
        inverted,
        weight,
        values: values.map((v) => ({
          id: v.id,
          label: v.label,
          triggers_mandatory_bypass: v.triggers_mandatory_bypass,
        })),
      };

      if (criterion) {
        await api.patch(`/portfolio/criteria/${criterion.id}`, payload);
      } else {
        await api.post('/portfolio/criteria', payload);
      }

      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {criterion ? t('settings.scoring.dialog.editTitle') : t('settings.scoring.dialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t('settings.fields.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label={t('settings.scoring.dialog.weight')}
              type="number"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              inputProps={{ min: 0.1, step: 0.1 }}
              sx={{ width: 120 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={inverted}
                  onChange={(e) => setInverted(e.target.checked)}
                />
              }
              label={t('settings.scoring.dialog.inverted')}
            />
          </Stack>

          <Divider />

          <Typography variant="subtitle2">{t('settings.scoring.dialog.scaleValues')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('settings.scoring.dialog.scaleValuesDescription')}
          </Typography>

          {values.map((v, idx) => (
            <Stack key={idx} direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" sx={{ width: 20 }}>
                {idx + 1}.
              </Typography>
              <TextField
                value={v.label}
                onChange={(e) => handleValueChange(idx, 'label', e.target.value)}
                size="small"
                fullWidth
                placeholder={t('settings.scoring.dialog.valueLabelPlaceholder')}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={v.triggers_mandatory_bypass}
                    onChange={(e) =>
                      handleValueChange(idx, 'triggers_mandatory_bypass', e.target.checked)
                    }
                    size="small"
                  />
                }
                label={t('settings.scoring.dialog.mandatory')}
                sx={{ minWidth: 110 }}
              />
              <IconButton
                size="small"
                onClick={() => handleRemoveValue(idx)}
                disabled={values.length <= 2}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}

          <Button startIcon={<AddIcon />} onClick={handleAddValue} size="small">
            {t('settings.actions.addValue')}
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !name.trim() || values.some((v) => !v.label.trim())}
        >
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Skills Section Component
function SkillsSection({
  skills,
  skillsGrouped,
  canEdit,
  onToggle,
  onEdit,
  onDelete,
}: {
  skills: Skill[];
  skillsGrouped: Record<string, Skill[]>;
  canEdit: boolean;
  onToggle: (skill: Skill) => void;
  onEdit: (skill: Skill) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  if (skills.length === 0) {
    return (
      <Alert severity="info">
        {t('settings.skills.empty')}
      </Alert>
    );
  }

  const categories = Object.keys(skillsGrouped).sort();

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('settings.skills.description')}
      </Typography>

      {categories.map((category) => {
        const categorySkills = skillsGrouped[category] || [];
        const enabledCount = categorySkills.filter((s) => s.enabled).length;
        const isExpanded = expandedCategories[category] ?? true;

        return (
          <Card key={category}>
            <CardContent sx={{ pb: isExpanded ? 2 : '16px !important' }}>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ cursor: 'pointer' }}
                onClick={() => toggleCategory(category)}
              >
                <IconButton size="small">
                  {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
                <Typography variant="subtitle1" sx={{ flex: 1 }}>
                  {category}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {`${enabledCount}/${categorySkills.length}`}
                </Typography>
              </Stack>

              <Collapse in={isExpanded}>
                <Stack spacing={1} sx={{ mt: 2 }}>
                  {categorySkills.map((skill) => (
                    <Stack
                      key={skill.id}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{
                        p: 1,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        opacity: skill.enabled ? 1 : 0.6,
                      }}
                    >
                      <Switch
                        checked={skill.enabled}
                        onChange={() => onToggle(skill)}
                        size="small"
                        disabled={!canEdit}
                      />
                      <Typography variant="body2" sx={{ flex: 1 }}>
                        {skill.name}
                      </Typography>
                      {canEdit && (
                        <>
                          <IconButton size="small" onClick={() => onEdit(skill)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => onDelete(skill.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </>
                      )}
                    </Stack>
                  ))}
                </Stack>
              </Collapse>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}

// Skill Edit Dialog Component
function SkillEditDialog({
  open,
  skill,
  existingCategories,
  onClose,
  onSave,
}: {
  open: boolean;
  skill: Skill | null;
  existingCategories: string[];
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (skill) {
      setCategory(skill.category);
      setName(skill.name);
    } else {
      setCategory('');
      setName('');
    }
    setError(null);
  }, [skill, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    try {
      if (skill) {
        await api.patch(`/portfolio/skills/${skill.id}`, { category, name });
      } else {
        await api.post('/portfolio/skills', { category, name });
      }
      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {skill ? t('settings.skills.dialog.editTitle') : t('settings.skills.dialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Autocomplete
            freeSolo
            options={existingCategories}
            value={category}
            onChange={(_, v) => setCategory(v || '')}
            onInputChange={(_, v) => setCategory(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('settings.skills.dialog.category')}
                required
                placeholder={t('settings.skills.dialog.categoryPlaceholder')}
              />
            )}
          />

          <TextField
            label={t('settings.skills.dialog.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !category.trim() || !name.trim()}
        >
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Phase Templates Section Component
function PhaseTemplatesSection({
  templates,
  canEdit,
  onEdit,
  onDelete,
}: {
  templates: PhaseTemplate[];
  canEdit: boolean;
  onEdit: (template: PhaseTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  if (templates.length === 0) {
    return (
      <Alert severity="info">
        {t('settings.phaseTemplates.empty')}
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('settings.phaseTemplates.description')}
      </Typography>

      {templates.map((template) => (
        <Card key={template.id}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="subtitle1">{template.name}</Typography>
                  {template.is_system && (
                    <Typography variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                      {t('settings.labels.system')}
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                    {t('settings.phaseTemplates.chips.phaseCount', { count: template.items.length })}
                  </Typography>
                </Stack>

                <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
                  {template.items.map((item, idx) => (
                    <Typography
                      key={item.id || idx}
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontSize: '0.8125rem' }}
                    >
                      {item.name}
                    </Typography>
                  ))}
                </Stack>
              </Box>

              {canEdit && (
                <>
                  <IconButton onClick={() => onEdit(template)}>
                    <EditIcon />
                  </IconButton>
                  <IconButton color="error" onClick={() => onDelete(template.id)}>
                    <DeleteIcon />
                  </IconButton>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

// Phase Template Edit Dialog Component
function PhaseTemplateEditDialog({
  open,
  template,
  onClose,
  onSave,
}: {
  open: boolean;
  template: PhaseTemplate | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [items, setItems] = useState<PhaseTemplateItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setItems(template.items.map((i) => ({ ...i })));
    } else {
      setName('');
      setItems([
        {
          name: t('settings.phaseTemplates.dialog.defaults.phaseName', { number: 1 }),
          has_milestone: true,
          milestone_name: t('settings.phaseTemplates.dialog.defaults.milestoneName', { number: 1 }),
        },
      ]);
    }
    setError(null);
  }, [template, open, t]);

  const handleAddItem = () => {
    setItems([...items, { name: '', has_milestone: true, milestone_name: '' }]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (
    index: number,
    field: keyof PhaseTemplateItem,
    value: any
  ) => {
    setItems(
      items.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    try {
      const payload = {
        name,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          has_milestone: item.has_milestone,
          milestone_name: item.has_milestone ? item.milestone_name : null,
        })),
      };

      if (template) {
        await api.patch(`/portfolio/phase-templates/${template.id}`, payload);
      } else {
        await api.post('/portfolio/phase-templates', payload);
      }

      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const isValid =
    name.trim() &&
    items.length > 0 &&
    items.every((item) => item.name.trim());

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {template ? t('settings.phaseTemplates.dialog.editTitle') : t('settings.phaseTemplates.dialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t('settings.phaseTemplates.dialog.templateName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />

          <Divider />

          <Typography variant="subtitle2">{t('settings.phaseTemplates.dialog.phases')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('settings.phaseTemplates.dialog.phasesDescription')}
          </Typography>

          {items.map((item, idx) => (
            <Stack
              key={idx}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1 }}
            >
              <Typography variant="caption" sx={{ width: 24 }}>
                {idx + 1}.
              </Typography>
              <TextField
                value={item.name}
                onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                size="small"
                placeholder={t('settings.phaseTemplates.dialog.phaseNamePlaceholder')}
                sx={{ flex: 1 }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={item.has_milestone}
                    onChange={(e) =>
                      handleItemChange(idx, 'has_milestone', e.target.checked)
                    }
                    size="small"
                  />
                }
                label={t('settings.phaseTemplates.dialog.milestone')}
                sx={{ minWidth: 100 }}
              />
              {item.has_milestone && (
                <TextField
                  value={item.milestone_name || ''}
                  onChange={(e) =>
                    handleItemChange(idx, 'milestone_name', e.target.value)
                  }
                  size="small"
                  placeholder={t('settings.phaseTemplates.dialog.milestoneNamePlaceholder')}
                  sx={{ width: 200 }}
                />
              )}
              <IconButton
                size="small"
                onClick={() => handleRemoveItem(idx)}
                disabled={items.length <= 1}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}

          <Button startIcon={<AddIcon />} onClick={handleAddItem} size="small">
            {t('settings.actions.addPhase')}
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !isValid}
        >
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Classification Section Component
function ClassificationSection({
  sources,
  categories,
  taskTypes,
  canEdit,
  onEditSource,
  onCreateSource,
  onDeleteSource,
  onToggleSource,
  onEditCategory,
  onCreateCategory,
  onDeleteCategory,
  onToggleCategory,
  onEditStream,
  onCreateStream,
  onDeleteStream,
  onToggleStream,
  onEditTaskType,
  onCreateTaskType,
  onDeleteTaskType,
  onToggleTaskType,
}: {
  sources: PortfolioSource[];
  categories: PortfolioCategory[];
  taskTypes: PortfolioTaskType[];
  canEdit: boolean;
  onEditSource: (source: PortfolioSource) => void;
  onCreateSource: () => void;
  onDeleteSource: (id: string) => void;
  onToggleSource: (source: PortfolioSource) => void;
  onEditCategory: (category: PortfolioCategory) => void;
  onCreateCategory: () => void;
  onDeleteCategory: (id: string) => void;
  onToggleCategory: (category: PortfolioCategory) => void;
  onEditStream: (stream: PortfolioStream) => void;
  onCreateStream: (categoryId: string) => void;
  onDeleteStream: (id: string) => void;
  onToggleStream: (stream: PortfolioStream) => void;
  onEditTaskType: (taskType: PortfolioTaskType) => void;
  onCreateTaskType: () => void;
  onDeleteTaskType: (id: string) => void;
  onToggleTaskType: (taskType: PortfolioTaskType) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <Stack spacing={3}>
      <Typography variant="body2" color="text.secondary">
        {t('settings.classification.description')}
      </Typography>

      {/* Sources Section */}
      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h6">{t('settings.classification.sections.sources')}</Typography>
          {canEdit && (
            <Button size="small" startIcon={<AddIcon />} onClick={onCreateSource}>
              {t('settings.actions.addSource')}
            </Button>
          )}
        </Stack>
        <Card>
          <CardContent sx={{ p: 2 }}>
            <Stack spacing={1}>
              {sources.map((source) => (
                <Stack
                  key={source.id}
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{
                    p: 1,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    opacity: source.is_active ? 1 : 0.6,
                  }}
                >
                  <Switch
                    checked={source.is_active}
                    onChange={() => onToggleSource(source)}
                    size="small"
                    disabled={!canEdit}
                  />
                  <Typography sx={{ flex: 1 }}>{source.name}</Typography>
                  {source.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 2 }}>
                      {source.description}
                    </Typography>
                  )}
                  {source.is_system && (
                    <Typography variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                      {t('settings.labels.system')}
                    </Typography>
                  )}
                  {canEdit && (
                    <>
                      <IconButton size="small" onClick={() => onEditSource(source)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => onDeleteSource(source.id)}
                        disabled={source.is_system}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </>
                  )}
                </Stack>
              ))}
              {sources.length === 0 && (
                <Typography color="text.secondary">{t('settings.classification.empty.sources')}</Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Box>

      {/* Categories & Streams Section */}
      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h6">{t('settings.classification.sections.categoriesAndStreams')}</Typography>
          {canEdit && (
            <Button size="small" startIcon={<AddIcon />} onClick={onCreateCategory}>
              {t('settings.actions.addCategory')}
            </Button>
          )}
        </Stack>
        <Stack spacing={2}>
          {categories.map((category) => {
            const isExpanded = expandedCategories[category.id] ?? true;
            const activeStreams = category.streams.filter((s) => s.is_active).length;

            return (
              <Card key={category.id} sx={{ opacity: category.is_active ? 1 : 0.7 }}>
                <CardContent sx={{ pb: isExpanded ? 2 : '16px !important' }}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ cursor: 'pointer' }}
                    onClick={() => toggleCategory(category.id)}
                  >
                    <IconButton size="small">
                      {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                    <Switch
                      checked={category.is_active}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleCategory(category);
                      }}
                      size="small"
                      disabled={!canEdit}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Typography variant="subtitle1" sx={{ flex: 1 }}>
                      {category.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                      {t('settings.classification.chips.streamsCount', {
                        active: activeStreams,
                        total: category.streams.length,
                      })}
                    </Typography>
                    {category.is_system && (
                      <Typography variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                        {t('settings.labels.system')}
                      </Typography>
                    )}
                    {canEdit && (
                      <>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditCategory(category);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteCategory(category.id);
                          }}
                          disabled={category.is_system}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </Stack>

                  <Collapse in={isExpanded}>
                    <Box sx={{ mt: 2, pl: 5 }}>
                      <Stack spacing={1}>
                        {category.streams.map((stream) => (
                          <Stack
                            key={stream.id}
                            direction="row"
                            alignItems="center"
                            spacing={1}
                            sx={{
                              p: 1,
                              bgcolor: 'action.hover',
                              borderRadius: 1,
                              opacity: stream.is_active ? 1 : 0.6,
                            }}
                          >
                            <Switch
                              checked={stream.is_active}
                              onChange={() => onToggleStream(stream)}
                              size="small"
                              disabled={!canEdit}
                            />
                            <Typography variant="body2" sx={{ flex: 1 }}>
                              {stream.name}
                            </Typography>
                            {canEdit && (
                              <>
                                <IconButton size="small" onClick={() => onEditStream(stream)}>
                                  <EditIcon fontSize="small" />
                                </IconButton>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => onDeleteStream(stream.id)}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </>
                            )}
                          </Stack>
                        ))}
                        {category.streams.length === 0 && (
                          <Typography variant="body2" color="text.secondary">
                            {t('settings.classification.empty.streams')}
                          </Typography>
                        )}
                        {canEdit && (
                          <Button
                            size="small"
                            startIcon={<AddIcon />}
                            onClick={() => onCreateStream(category.id)}
                            sx={{ alignSelf: 'flex-start' }}
                          >
                            {t('settings.actions.addStream')}
                          </Button>
                        )}
                      </Stack>
                    </Box>
                  </Collapse>
                </CardContent>
              </Card>
            );
          })}
          {categories.length === 0 && (
            <Alert severity="info">{t('settings.classification.empty.categories')}</Alert>
          )}
        </Stack>
      </Box>

      {/* Task Types Section */}
      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h6">{t('settings.classification.sections.taskTypes')}</Typography>
          {canEdit && (
            <Button size="small" startIcon={<AddIcon />} onClick={onCreateTaskType}>
              {t('settings.actions.addTaskType')}
            </Button>
          )}
        </Stack>
        <Card>
          <CardContent sx={{ p: 2 }}>
            <Stack spacing={1}>
              {taskTypes.map((taskType) => (
                <Stack
                  key={taskType.id}
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{
                    p: 1,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    opacity: taskType.is_active ? 1 : 0.6,
                  }}
                >
                  <Switch
                    checked={taskType.is_active}
                    onChange={() => onToggleTaskType(taskType)}
                    size="small"
                    disabled={!canEdit}
                  />
                  <Typography sx={{ flex: 1 }}>{taskType.name}</Typography>
                  {taskType.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 2 }}>
                      {taskType.description}
                    </Typography>
                  )}
                  {taskType.is_system && (
                    <Typography variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                      {t('settings.labels.system')}
                    </Typography>
                  )}
                  {canEdit && (
                    <>
                      <IconButton size="small" onClick={() => onEditTaskType(taskType)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => onDeleteTaskType(taskType.id)}
                        disabled={taskType.is_system}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </>
                  )}
                </Stack>
              ))}
              {taskTypes.length === 0 && (
                <Typography color="text.secondary">{t('settings.classification.empty.taskTypes')}</Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Stack>
  );
}

// Source Edit Dialog
function SourceEditDialog({
  open,
  source,
  onClose,
  onSave,
}: {
  open: boolean;
  source: PortfolioSource | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source) {
      setName(source.name);
      setDescription(source.description || '');
    } else {
      setName('');
      setDescription('');
    }
    setError(null);
  }, [source, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (source) {
        await api.patch(`/portfolio/classification/sources/${source.id}`, { name, description });
      } else {
        await api.post('/portfolio/classification/sources', { name, description });
      }
      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {source ? t('settings.classification.sourceDialog.editTitle') : t('settings.classification.sourceDialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('settings.fields.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label={t('settings.fields.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Category Edit Dialog
function CategoryEditDialog({
  open,
  category,
  onClose,
  onSave,
}: {
  open: boolean;
  category: PortfolioCategory | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (category) {
      setName(category.name);
      setDescription(category.description || '');
    } else {
      setName('');
      setDescription('');
    }
    setError(null);
  }, [category, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (category) {
        await api.patch(`/portfolio/classification/categories/${category.id}`, { name, description });
      } else {
        await api.post('/portfolio/classification/categories', { name, description });
      }
      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {category ? t('settings.classification.categoryDialog.editTitle') : t('settings.classification.categoryDialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('settings.fields.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label={t('settings.fields.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Stream Edit Dialog
function StreamEditDialog({
  open,
  stream,
  categoryId,
  onClose,
  onSave,
}: {
  open: boolean;
  stream: PortfolioStream | null;
  categoryId: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stream) {
      setName(stream.name);
      setDescription(stream.description || '');
    } else {
      setName('');
      setDescription('');
    }
    setError(null);
  }, [stream, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (stream) {
        await api.patch(`/portfolio/classification/streams/${stream.id}`, { name, description });
      } else if (categoryId) {
        await api.post('/portfolio/classification/streams', { category_id: categoryId, name, description });
      }
      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {stream ? t('settings.classification.streamDialog.editTitle') : t('settings.classification.streamDialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('settings.fields.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label={t('settings.fields.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Task Type Edit Dialog
function TaskTypeEditDialog({
  open,
  taskType,
  onClose,
  onSave,
}: {
  open: boolean;
  taskType: PortfolioTaskType | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (taskType) {
      setName(taskType.name);
      setDescription(taskType.description || '');
    } else {
      setName('');
      setDescription('');
    }
    setError(null);
  }, [taskType, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (taskType) {
        await api.patch(`/portfolio/classification/task-types/${taskType.id}`, { name, description });
      } else {
        await api.post('/portfolio/classification/task-types', { name, description });
      }
      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {taskType ? t('settings.classification.taskTypeDialog.editTitle') : t('settings.classification.taskTypeDialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('settings.fields.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label={t('settings.fields.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Teams Section Component
function TeamsSection({
  teams,
  canEdit,
  onEdit,
  onDelete,
  onToggle,
}: {
  teams: PortfolioTeam[];
  canEdit: boolean;
  onEdit: (team: PortfolioTeam) => void;
  onDelete: (id: string) => void;
  onToggle: (team: PortfolioTeam) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  if (teams.length === 0) {
    return (
      <Alert severity="info">
        {t('settings.teams.empty')}
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('settings.teams.description')}
      </Typography>

      <Card>
        <CardContent sx={{ p: 2 }}>
          <Stack spacing={1}>
            {teams.map((team) => (
              <Stack
                key={team.id}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  p: 1,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  opacity: team.is_active ? 1 : 0.6,
                }}
              >
                <Switch
                  checked={team.is_active}
                  onChange={() => onToggle(team)}
                  size="small"
                  disabled={!canEdit}
                />
                <Box sx={{ flex: 1 }}>
                  <Typography>{team.name}</Typography>
                  {team.description && (
                    <Typography variant="caption" color="text.secondary">
                      {team.description}
                    </Typography>
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                  {t('settings.teams.memberCount', { count: team.member_count })}
                </Typography>
                {team.is_system && (
                  <Typography variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                    {t('settings.labels.system')}
                  </Typography>
                )}
                {canEdit && (
                  <>
                    <IconButton size="small" onClick={() => onEdit(team)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => onDelete(team.id)}
                      disabled={team.is_system || team.member_count > 0}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

// Team Edit Dialog
function TeamEditDialog({
  open,
  team,
  onClose,
  onSave,
}: {
  open: boolean;
  team: PortfolioTeam | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (team) {
      setName(team.name);
      setDescription(team.description || '');
    } else {
      setName('');
      setDescription('');
    }
    setError(null);
  }, [team, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (team) {
        await api.patch(`/portfolio/teams/${team.id}`, { name, description });
      } else {
        await api.post('/portfolio/teams', { name, description });
      }
      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {team ? t('settings.teams.dialog.editTitle') : t('settings.teams.dialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('settings.fields.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label={t('settings.fields.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Employment Types Section Component
function EmploymentTypesSection({
  employmentTypes,
  canEdit,
  onEdit,
  onDelete,
  onToggle,
}: {
  employmentTypes: EmploymentType[];
  canEdit: boolean;
  onEdit: (type: EmploymentType) => void;
  onDelete: (id: string) => void;
  onToggle: (type: EmploymentType) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  if (employmentTypes.length === 0) {
    return (
      <Alert severity="info">
        {t('settings.employmentTypes.empty')}
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('settings.employmentTypes.description')}
      </Typography>

      <Card>
        <CardContent sx={{ p: 2 }}>
          <Stack spacing={1}>
            {employmentTypes.map((type) => (
              <Stack
                key={type.id}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  p: 1,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  opacity: type.is_active ? 1 : 0.6,
                }}
              >
                <Switch
                  checked={type.is_active}
                  onChange={() => onToggle(type)}
                  size="small"
                  disabled={!canEdit}
                />
                <Box sx={{ flex: 1 }}>
                  <Typography>{type.name}</Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                  {t('settings.employmentTypes.usageCount', { count: type.usage_count })}
                </Typography>
                {type.is_system && (
                  <Typography variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                    {t('settings.labels.system')}
                  </Typography>
                )}
                {canEdit && (
                  <>
                    <IconButton size="small" onClick={() => onEdit(type)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => onDelete(type.id)}
                      disabled={type.is_system || type.usage_count > 0}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

// Employment Type Edit Dialog
function EmploymentTypeEditDialog({
  open,
  employmentType,
  onClose,
  onSave,
}: {
  open: boolean;
  employmentType: EmploymentType | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(employmentType ? employmentType.name : '');
    setError(null);
  }, [employmentType, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (employmentType) {
        await api.patch(`/portfolio/employment-types/${employmentType.id}`, { name });
      } else {
        await api.post('/portfolio/employment-types', { name });
      }
      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {employmentType ? t('settings.employmentTypes.dialog.editTitle') : t('settings.employmentTypes.dialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('settings.fields.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
