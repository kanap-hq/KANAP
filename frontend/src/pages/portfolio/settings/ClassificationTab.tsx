import { useCallback, useEffect, useState } from 'react';
import { Alert, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { CategoriesSection } from './CategoriesSection';
import { CategoryEditDialog } from './CategoryEditDialog';
import { useInvalidateSharedLists } from './sharedLists';
import { SourceEditDialog } from './SourceEditDialog';
import { SourcesSection } from './SourcesSection';
import { StreamEditDialog } from './StreamEditDialog';
import { TaskTypeEditDialog } from './TaskTypeEditDialog';
import { TaskTypesSection } from './TaskTypesSection';
import type {
  PortfolioCategory, PortfolioSource, PortfolioStream, PortfolioTaskType, SettingsTabProps,
} from './types';
import { useSettingsDelete } from './useSettingsDelete';

/** The classification tab: the sources, the categories with their streams, and the task types. */
export default function ClassificationTab({ canEdit }: SettingsTabProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const invalidate = useInvalidateSharedLists();
  const [sources, setSources] = useState<PortfolioSource[]>([]);
  const [categories, setCategories] = useState<PortfolioCategory[]>([]);
  const [taskTypes, setTaskTypes] = useState<PortfolioTaskType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<PortfolioSource | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<PortfolioCategory | null>(null);
  const [streamDialogOpen, setStreamDialogOpen] = useState(false);
  const [editingStream, setEditingStream] = useState<PortfolioStream | null>(null);
  const [streamCategoryId, setStreamCategoryId] = useState<string | null>(null);
  const [taskTypeDialogOpen, setTaskTypeDialogOpen] = useState(false);
  const [editingTaskType, setEditingTaskType] = useState<PortfolioTaskType | null>(null);

  const loadData = useCallback(async () => {
    try {
      const classificationRes = await api.get('/portfolio/classification/all');
      setSources(classificationRes.data?.sources || []);
      setCategories(classificationRes.data?.categories || []);
      setTaskTypes(classificationRes.data?.taskTypes || []);
      setLoadError(null);
      setLoaded(true);
    } catch (e: any) {
      setLoadError(getApiErrorMessage(e, t, t('settings.messages.loadFailed')));
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const classificationChanged = useCallback(() => {
    loadData();
    invalidate('classification');
  }, [invalidate, loadData]);

  const deleteItem = useSettingsDelete({ canEdit, onDeleted: classificationChanged, onError: setError });

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
      classificationChanged();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.updateSourceFailed')));
    }
  }, [canEdit, classificationChanged, t]);

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
      classificationChanged();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.updateCategoryFailed')));
    }
  }, [canEdit, classificationChanged, t]);

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
      classificationChanged();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.updateStreamFailed')));
    }
  }, [canEdit, classificationChanged, t]);

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
      classificationChanged();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.classification.messages.updateTaskTypeFailed')));
    }
  }, [canEdit, classificationChanged, t]);

  const saved = (close: () => void) => () => {
    close();
    classificationChanged();
  };

  if (loadError) return <Alert severity="error">{loadError}</Alert>;
  if (!loaded) return null;

  return (
    <>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={3}>
        <SourcesSection
          sources={sources}
          canEdit={canEdit}
          onEditSource={handleEditSource}
          onCreateSource={handleCreateSource}
          onDeleteSource={handleDeleteSource}
          onToggleSource={handleToggleSource}
        />
        <CategoriesSection
          categories={categories}
          canEdit={canEdit}
          onEditCategory={handleEditCategory}
          onCreateCategory={handleCreateCategory}
          onDeleteCategory={handleDeleteCategory}
          onToggleCategory={handleToggleCategory}
          onEditStream={handleEditStream}
          onCreateStream={handleCreateStream}
          onDeleteStream={handleDeleteStream}
          onToggleStream={handleToggleStream}
        />
        <TaskTypesSection
          taskTypes={taskTypes}
          canEdit={canEdit}
          onEditTaskType={handleEditTaskType}
          onCreateTaskType={handleCreateTaskType}
          onDeleteTaskType={handleDeleteTaskType}
          onToggleTaskType={handleToggleTaskType}
        />
      </Stack>

      {/* Edit/Create Source Dialog */}
      <SourceEditDialog
        open={sourceDialogOpen}
        source={editingSource}
        onClose={() => setSourceDialogOpen(false)}
        onSave={saved(() => setSourceDialogOpen(false))}
      />

      {/* Edit/Create Category Dialog */}
      <CategoryEditDialog
        open={categoryDialogOpen}
        category={editingCategory}
        onClose={() => setCategoryDialogOpen(false)}
        onSave={saved(() => setCategoryDialogOpen(false))}
      />

      {/* Edit/Create Stream Dialog */}
      <StreamEditDialog
        open={streamDialogOpen}
        stream={editingStream}
        categoryId={streamCategoryId}
        onClose={() => setStreamDialogOpen(false)}
        onSave={saved(() => setStreamDialogOpen(false))}
      />

      {/* Edit/Create Task Type Dialog */}
      <TaskTypeEditDialog
        open={taskTypeDialogOpen}
        taskType={editingTaskType}
        onClose={() => setTaskTypeDialogOpen(false)}
        onSave={saved(() => setTaskTypeDialogOpen(false))}
      />
    </>
  );
}
