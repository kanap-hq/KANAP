import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, FormControlLabel, IconButton, Stack, Switch, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
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
import InfoHint from '../../../components/workspace/InfoHint';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { CriterionEditDialog } from './CriterionEditDialog';
import { useInvalidateSharedLists } from './sharedLists';
import TabActions from './TabActions';
import type { Criterion, Settings, SettingsTabProps } from './types';
import { useSettingsDelete } from './useSettingsDelete';

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

/** The scoring tab: the mandatory bypass setting and the evaluation criteria, in their order. */
export default function ScoringTab({ canEdit }: SettingsTabProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const invalidate = useInvalidateSharedLists();
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [settings, setSettings] = useState<Settings>({ mandatory_bypass_enabled: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCriterion, setEditingCriterion] = useState<Criterion | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [criteriaRes, settingsRes] = await Promise.all([
        api.get('/portfolio/criteria'),
        api.get('/portfolio/settings'),
      ]);
      setCriteria(criteriaRes.data || []);
      setSettings(settingsRes.data || { mandatory_bypass_enabled: false });
      setLoadError(null);
      setLoaded(true);
    } catch (e: any) {
      setLoadError(getApiErrorMessage(e, t, t('settings.messages.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const criteriaChanged = useCallback(() => {
    loadData();
    invalidate('criteria');
  }, [invalidate, loadData]);

  const deleteItem = useSettingsDelete({ canEdit, onDeleted: criteriaChanged, onError: setError });

  const handleToggleEnabled = useCallback(async (criterion: Criterion) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/criteria/${criterion.id}`, {
        enabled: !criterion.enabled,
      });
      criteriaChanged();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.scoring.messages.updateFailed')));
    }
  }, [criteriaChanged, canEdit, t]);

  const handleToggleBypassSetting = useCallback(async () => {
    if (!canEdit) return;
    try {
      await api.patch('/portfolio/settings', {
        mandatory_bypass_enabled: !settings.mandatory_bypass_enabled,
      });
      loadData();
      invalidate('settings');
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.scoring.messages.updateSettingsFailed')));
    }
  }, [settings.mandatory_bypass_enabled, loadData, invalidate, canEdit, t]);

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
      invalidate('criteria');
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.scoring.messages.reorderFailed')));
      loadData();
    }
  }, [criteria, invalidate, loadData, t]);

  if (loadError) return <Alert severity="error">{loadError}</Alert>;
  if (!loaded) return null;

  return (
    <>
      {canEdit && (
        <TabActions>
          <Button variant="action-primary" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleCreateClick}>
            {t('settings.actions.addCriterion')}
          </Button>
        </TabActions>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

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

      {/* Edit/Create Criterion Dialog */}
      <CriterionEditDialog
        open={editDialogOpen}
        criterion={editingCriterion}
        onClose={() => setEditDialogOpen(false)}
        onSave={() => {
          setEditDialogOpen(false);
          criteriaChanged();
        }}
      />
    </>
  );
}
