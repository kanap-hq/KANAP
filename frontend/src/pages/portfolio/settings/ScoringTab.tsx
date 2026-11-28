import { Box, Card, CardContent, IconButton, Stack, Switch, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TFunction } from 'i18next';
import type { Criterion } from './types';

/**
 * One evaluation criterion card. The left grip is only active when the user
 * can edit; it drives the @dnd-kit sortable reordering of the criteria list.
 */
export function SortableCriterionCard({
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
