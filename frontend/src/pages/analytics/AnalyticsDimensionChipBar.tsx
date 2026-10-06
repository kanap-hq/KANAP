import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { isAnalyticsActive, type AnalyticsAxis } from '../../services/analytics';
import ChipToggleBar from '../../components/ChipToggleBar';

type Props = {
  axes: AnalyticsAxis[];
  selectedAxisId: string | null;
  label: (axis: AnalyticsAxis) => string;
  onSelect: (axisId: string) => void;
  onEdit: (axisId: string) => void;
  /** Edit for members; readers only open the dimension, and the button says so. */
  canEdit: boolean;
  /** Omitted when the user cannot create a dimension. */
  onCreate?: () => void;
};

/** One band of dimension toggles above the values grid, with New and Edit (or Open) on the right. */
export default function AnalyticsDimensionChipBar({ axes, selectedAxisId, label, onSelect, onEdit, canEdit, onCreate }: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  const selectedAxis = axes.find((axis) => axis.id === selectedAxisId) ?? null;
  const hasActions = !!onCreate || !!selectedAxis;
  return (
    <ChipToggleBar
      ariaLabel={t('analytics.dimensionsLabel')}
      selectedId={selectedAxisId}
      onSelect={onSelect}
      sx={{ mb: 2 }}
      items={axes.map((axis) => {
        const name = label(axis);
        const active = isAnalyticsActive(axis);
        return {
          id: axis.id,
          // The visible mark alone would run into the name ("Internal orderDisabled").
          ariaLabel: active ? undefined : t('analytics.disabledDimension', { name }),
          label: (
            <>
              {name}
              {!active && (
                <Box component="span" sx={{ ml: 0.75, opacity: 0.7 }}>
                  {t('analytics.disabledMark')}
                </Box>
              )}
            </>
          ),
        };
      })}
      actions={hasActions && (
        <>
          {onCreate && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              aria-label={t('analytics.newDimension')}
              onClick={onCreate}
            >
              {t('coa.chipBar.newChip')}
            </Button>
          )}
          {selectedAxis && (
            <Button
              size="small"
              variant="outlined"
              startIcon={canEdit ? <EditOutlinedIcon /> : undefined}
              aria-label={t(canEdit ? 'analytics.editDimension' : 'analytics.openDimension', { name: label(selectedAxis) })}
              onClick={() => onEdit(selectedAxis.id)}
            >
              {t(canEdit ? 'common:buttons.edit' : 'common:buttons.open')}
            </Button>
          )}
        </>
      )}
    />
  );
}
