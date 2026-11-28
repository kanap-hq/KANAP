import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Collapse, IconButton, Stack, Switch, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useTranslation } from 'react-i18next';
import { localizeTaskType } from '../../../utils/taskTypeLocalization';
import { useCatalogLocale } from '../../../hooks/useLocalizedTaskTypes';
import type { PortfolioCategory, PortfolioSource, PortfolioStream, PortfolioTaskType } from './types';

// Classification Section Component
export function ClassificationSection({
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
  const catalogLocale = useCatalogLocale();
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <Stack spacing={3}>

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
    </Stack>
  );
}
