import { Box, Button, Card, CardContent, IconButton, Stack, Switch, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { localizeTaskType } from '../../../utils/taskTypeLocalization';
import { useCatalogLocale } from '../../../hooks/useLocalizedTaskTypes';
import type { PortfolioTaskType } from './types';

/** The task types of the classification tab. */
export function TaskTypesSection({
  taskTypes,
  canEdit,
  onEditTaskType,
  onCreateTaskType,
  onDeleteTaskType,
  onToggleTaskType,
}: {
  taskTypes: PortfolioTaskType[];
  canEdit: boolean;
  onEditTaskType: (taskType: PortfolioTaskType) => void;
  onCreateTaskType: () => void;
  onDeleteTaskType: (id: string) => void;
  onToggleTaskType: (taskType: PortfolioTaskType) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const catalogLocale = useCatalogLocale();

  return (
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
                <Typography sx={{ flex: 1 }}>{localizeTaskType(taskType, catalogLocale).name}</Typography>
                {taskType.description && (
                  <Typography variant="caption" color="text.secondary" sx={{ flex: 2 }}>
                    {localizeTaskType(taskType, catalogLocale).description}
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
  );
}
