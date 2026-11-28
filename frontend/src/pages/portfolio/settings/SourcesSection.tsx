import { Box, Button, Card, CardContent, IconButton, Stack, Switch, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import type { PortfolioSource } from './types';

/** The sources of the classification tab. */
export function SourcesSection({
  sources,
  canEdit,
  onEditSource,
  onCreateSource,
  onDeleteSource,
  onToggleSource,
}: {
  sources: PortfolioSource[];
  canEdit: boolean;
  onEditSource: (source: PortfolioSource) => void;
  onCreateSource: () => void;
  onDeleteSource: (id: string) => void;
  onToggleSource: (source: PortfolioSource) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);

  return (
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
  );
}
