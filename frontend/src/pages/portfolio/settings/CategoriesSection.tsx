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
import type { PortfolioCategory, PortfolioStream } from './types';

/** The categories of the classification tab, each with its streams. */
export function CategoriesSection({
  categories,
  canEdit,
  onEditCategory,
  onCreateCategory,
  onDeleteCategory,
  onToggleCategory,
  onEditStream,
  onCreateStream,
  onDeleteStream,
  onToggleStream,
}: {
  categories: PortfolioCategory[];
  canEdit: boolean;
  onEditCategory: (category: PortfolioCategory) => void;
  onCreateCategory: () => void;
  onDeleteCategory: (id: string) => void;
  onToggleCategory: (category: PortfolioCategory) => void;
  onEditStream: (stream: PortfolioStream) => void;
  onCreateStream: (categoryId: string) => void;
  onDeleteStream: (id: string) => void;
  onToggleStream: (stream: PortfolioStream) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
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
  );
}
