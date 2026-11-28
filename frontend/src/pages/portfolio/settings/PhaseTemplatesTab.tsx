import { Alert, Box, Card, CardContent, IconButton, Stack, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import type { PhaseTemplate } from './types';

// Phase Templates Section Component
export function PhaseTemplatesSection({
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
