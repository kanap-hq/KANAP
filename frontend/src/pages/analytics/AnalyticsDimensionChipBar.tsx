import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Chip, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { isAnalyticsActive, type AnalyticsAxis } from '../../services/analytics';
import { tealLinkSx } from '../../theme/formSx';

type Props = {
  axes: AnalyticsAxis[];
  selectedAxisId: string | null;
  label: (axis: AnalyticsAxis) => string;
  onSelect: (axisId: string) => void;
  onEdit: (axisId: string) => void;
  /** The pencil edits for members; for readers it only opens the dimension, and says so. */
  canEdit: boolean;
  /** Omitted when the user cannot create a dimension. */
  onCreate?: () => void;
};

/** One line of dimension toggles above the values grid; the selected one carries its edit button. */
export default function AnalyticsDimensionChipBar({ axes, selectedAxisId, label, onSelect, onEdit, canEdit, onCreate }: Props) {
  const { t } = useTranslation('master-data');
  return (
    <Box
      role="group"
      aria-label={t('analytics.dimensionsLabel')}
      sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: -0.5, mb: 1.5 }}
    >
      {axes.map((axis) => {
        const selected = axis.id === selectedAxisId;
        const name = label(axis);
        const active = isAnalyticsActive(axis);
        return (
          <Box key={axis.id} sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px', minWidth: 0 }}>
            <Chip
              size="small"
              clickable
              color={selected ? 'primary' : 'default'}
              variant={selected ? 'filled' : 'outlined'}
              aria-pressed={selected}
              // The visible mark alone would run into the name ("Internal orderDisabled").
              aria-label={active ? undefined : t('analytics.disabledDimension', { name })}
              onClick={() => onSelect(axis.id)}
              label={(
                <>
                  {name}
                  {!active && (
                    <Box component="span" sx={{ ml: 0.75, opacity: 0.7 }}>
                      {t('analytics.disabledMark')}
                    </Box>
                  )}
                </>
              )}
              sx={{ maxWidth: 280, fontSize: 12 }}
            />
            {selected && (
              <IconButton
                size="small"
                aria-label={t(canEdit ? 'analytics.editDimension' : 'analytics.openDimension', { name })}
                onClick={() => onEdit(axis.id)}
                sx={{ p: '4px', color: 'kanap.text.secondary' }}
              >
                <EditOutlinedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Box>
        );
      })}
      {onCreate && (
        <Box
          component="button"
          type="button"
          onClick={onCreate}
          sx={{ ...tealLinkSx, display: 'inline-flex', alignItems: 'center', gap: '2px', ml: 0.5 }}
        >
          <AddIcon sx={{ fontSize: 14 }} />
          {t('analytics.newDimension')}
        </Box>
      )}
    </Box>
  );
}
