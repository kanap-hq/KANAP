import { Alert, Box, Card, CardContent, IconButton, Stack, Switch, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import type { EmploymentType } from './types';

// Employment Types Section Component
export function EmploymentTypesSection({
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
