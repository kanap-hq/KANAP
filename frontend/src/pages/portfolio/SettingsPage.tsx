import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, FormControlLabel,
  Stack, Switch, Tab, Tabs, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import InfoHint from '../../components/workspace/InfoHint';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { recordRefusal } from '../../utils/deleteCheck';
import { deleteFailureReason } from '../../utils/deleteRefusal';
import { useKanapDialogs } from '../../components/design';
import type {
  Criterion, EmploymentType, PhaseTemplate, PortfolioCategory, PortfolioSource,
  PortfolioStream, PortfolioTaskType, PortfolioTeam, Settings, Skill,
} from './settings/types';
import { SortableCriterionCard } from './settings/ScoringTab';
import { CriterionEditDialog } from './settings/CriterionEditDialog';
import { SkillsSection } from './settings/SkillsTab';
import { SkillEditDialog } from './settings/SkillEditDialog';
import { PhaseTemplatesSection } from './settings/PhaseTemplatesTab';
import { PhaseTemplateEditDialog } from './settings/PhaseTemplateEditDialog';
import { ClassificationSection } from './settings/ClassificationTab';
import { SourceEditDialog } from './settings/SourceEditDialog';
import { CategoryEditDialog } from './settings/CategoryEditDialog';
import { StreamEditDialog } from './settings/StreamEditDialog';
import { TaskTypeEditDialog } from './settings/TaskTypeEditDialog';
import { TeamsSection } from './settings/TeamsTab';
import { TeamEditDialog } from './settings/TeamEditDialog';
import { EmploymentTypesSection } from './settings/EmploymentTypesTab';
import { EmploymentTypeEditDialog } from './settings/EmploymentTypeEditDialog';

export default function SettingsPage() {
  const { hasLevel } = useAuth();
  const { t, i18n } = useTranslation(['portfolio', 'common']);
  const language = i18n?.resolvedLanguage || i18n?.language || 'en';
  const dialogs = useKanapDialogs();
  const canEdit = hasLevel('portfolio_settings', 'admin');

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

  /**
   * The delete of a settings item (`<base>/<id>`). Where the delete can be refused (`check`), it is
   * asked first: a refused item gets the refusal and why, with Close only. Otherwise the item is
   * confirmed by its name, then deleted.
   */
  const deleteItem = useCallback(async (item: {
    id: string;
    name: string;
    base: string;
    check?: boolean;
    message?: string;
    failed: string;
  }) => {
    if (!canEdit) return;
    const title = t('common:delete.recordTitle', { name: item.name });
    if (item.check) {
      const refusal = await recordRefusal(item.base, item.id);
      if (refusal) {
        await dialogs.alert({ title, message: deleteFailureReason(refusal, t, language) });
        return;
      }
    }
    if (!await dialogs.confirm({
      title,
      message: item.message ?? t('common:delete.cannotUndo'),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    })) return;
    try {
      await api.delete(`${item.base}/${item.id}`);
      loadData();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, item.failed));
    }
  }, [canEdit, dialogs, language, loadData, t]);

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

  const handleDeleteCriterion = useCallback((id: string) => deleteItem({
    id,
    name: criteria.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/criteria',
    message: t('settings.scoring.confirmDelete'),
    failed: t('settings.scoring.messages.deleteFailed'),
  }), [criteria, deleteItem, t]);

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

  const handleDeleteSkill = useCallback((id: string) => deleteItem({
    id,
    name: skills.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/skills',
    failed: t('settings.skills.messages.deleteFailed'),
  }), [deleteItem, skills, t]);

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

  const handleDeleteTemplate = useCallback((id: string) => deleteItem({
    id,
    name: phaseTemplates.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/phase-templates',
    failed: t('settings.phaseTemplates.messages.deleteFailed'),
  }), [deleteItem, phaseTemplates, t]);

  // Classification handlers
  const handleEditSource = useCallback((source: PortfolioSource) => {
    setEditingSource(source);
    setSourceDialogOpen(true);
  }, []);

  const handleCreateSource = useCallback(() => {
    setEditingSource(null);
    setSourceDialogOpen(true);
  }, []);

  const handleDeleteSource = useCallback((id: string) => deleteItem({
    id,
    name: sources.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/classification/sources',
    check: true,
    failed: t('settings.classification.messages.deleteSourceFailed'),
  }), [deleteItem, sources, t]);

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

  const handleDeleteCategory = useCallback((id: string) => deleteItem({
    id,
    name: categories.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/classification/categories',
    check: true,
    message: t('settings.classification.confirmations.deleteCategory'),
    failed: t('settings.classification.messages.deleteCategoryFailed'),
  }), [categories, deleteItem, t]);

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

  const handleDeleteStream = useCallback((id: string) => deleteItem({
    id,
    name: categories.flatMap((category) => category.streams ?? []).find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/classification/streams',
    check: true,
    failed: t('settings.classification.messages.deleteStreamFailed'),
  }), [categories, deleteItem, t]);

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

  const handleDeleteTaskType = useCallback((id: string) => deleteItem({
    id,
    name: taskTypes.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/classification/task-types',
    check: true,
    failed: t('settings.classification.messages.deleteTaskTypeFailed'),
  }), [deleteItem, taskTypes, t]);

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

  const handleDeleteTeam = useCallback((id: string) => deleteItem({
    id,
    name: teams.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/teams',
    check: true,
    failed: t('settings.teams.messages.deleteFailed'),
  }), [deleteItem, teams, t]);

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

  const handleDeleteEmploymentType = useCallback((id: string) => deleteItem({
    id,
    name: employmentTypes.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/employment-types',
    check: true,
    failed: t('settings.employmentTypes.messages.deleteFailed'),
  }), [deleteItem, employmentTypes, t]);

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
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <FormControlLabel
                    control={
                      <Switch
                        checked={settings.mandatory_bypass_enabled}
                        onChange={handleToggleBypassSetting}
                        disabled={!canEdit}
                      />
                    }
                    label={
                      <Typography variant="subtitle1">
                        {t('settings.scoring.mandatoryBypassTitle')}
                      </Typography>
                    }
                    sx={{ mr: 0 }}
                  />
                  <InfoHint text={t('settings.scoring.mandatoryBypassDescription')} />
                </Stack>
              </CardContent>
            </Card>

            {/* Evaluation Criteria */}
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6">
                {t('settings.scoring.title')}
              </Typography>
              <InfoHint text={t('settings.scoring.reorderHint')} />
            </Stack>

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
