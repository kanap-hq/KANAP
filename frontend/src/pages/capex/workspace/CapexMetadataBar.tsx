import React from 'react';
import { Box, MenuItem, Popover, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PortfolioMetadataItem } from '../../portfolio/workspace/PortfolioMetadataBar';
import MetadataUserPicker from '../../../components/workspace/MetadataUserPicker';
import BudgetHolderMetadataItem from '../../../components/workspace/BudgetHolderMetadataItem';
import { drawerMenuItemSx } from '../../../theme/formSx';
import { STATUS_ENABLED, STATUS_DISABLED, StatusValue } from '../../../constants/status';
import { StatusDot } from '../../../components/design';

export type CapexPriority = 'mandatory' | 'high' | 'medium' | 'low';

type Props = {
  status: StatusValue;
  priority: CapexPriority;
  ownerItId: string | null;
  ownerBizId: string | null;
  /** The line's current cost center: its budget holder shows after the owners. */
  costCenterId?: string | null;
  disabled?: boolean;
  onStatusChange: (next: StatusValue) => void;
  onPriorityChange: (next: CapexPriority) => void;
  onOwnerItChange: (next: string | null) => void;
  onOwnerBizChange: (next: string | null) => void;
};

export default function CapexMetadataBar({
  status,
  priority,
  ownerItId,
  ownerBizId,
  costCenterId = null,
  disabled = false,
  onStatusChange,
  onPriorityChange,
  onOwnerItChange,
  onOwnerBizChange,
}: Props) {
  const { t } = useTranslation(['ops', 'common']);
  const [statusAnchor, setStatusAnchor] = React.useState<HTMLElement | null>(null);
  const [priorityAnchor, setPriorityAnchor] = React.useState<HTMLElement | null>(null);

  const isEnabled = status !== STATUS_DISABLED;
  const statusColor = isEnabled ? '#10B981' : '#9CA3AF';
  const statusLabel = isEnabled ? t('capex.status.enabled') : t('capex.status.disabled');

  const statusOptions: Array<{ value: StatusValue; label: string }> = [
    { value: STATUS_ENABLED, label: t('capex.status.enabled') },
    { value: STATUS_DISABLED, label: t('capex.status.disabled') },
  ];
  const priorityOptions: Array<{ value: CapexPriority; label: string; color: string }> = [
    { value: 'mandatory', label: t('capex.priorityTypes.mandatory'), color: '#DC2626' },
    { value: 'high', label: t('capex.priorityTypes.high'), color: '#EA580C' },
    { value: 'medium', label: t('capex.priorityTypes.medium'), color: '#D97706' },
    { value: 'low', label: t('capex.priorityTypes.low'), color: '#6B7280' },
  ];
  const selectedPriority = priorityOptions.find((opt) => opt.value === priority) || priorityOptions[2];

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.75, alignItems: 'center' }}>
      <PortfolioMetadataItem
        label={t('capex.metadata.status')}
        onClick={(e) => !disabled && setStatusAnchor(e.currentTarget as HTMLElement)}
        disabled={disabled}
      >
        <StatusDot size={8} color={statusColor} sx={{ mr: 0.75 }} />
        <Typography component="span" sx={{ fontSize: 12 }}>{statusLabel}</Typography>
      </PortfolioMetadataItem>

      <PortfolioMetadataItem
        label={t('capex.metadata.priority')}
        onClick={(e) => !disabled && setPriorityAnchor(e.currentTarget as HTMLElement)}
        disabled={disabled}
      >
        <StatusDot size={8} color={selectedPriority.color} sx={{ mr: 0.75 }} />
        <Typography component="span" sx={{ fontSize: 12 }}>{selectedPriority.label}</Typography>
      </PortfolioMetadataItem>

      <PortfolioMetadataItem label={t('capex.metadata.itOwner')}>
        <MetadataUserPicker
          value={ownerItId}
          placeholder={t('capex.metadata.itOwnerMissing')}
          searchPlaceholder={t('capex.metadata.itOwner')}
          disabled={disabled}
          onChange={onOwnerItChange}
        />
      </PortfolioMetadataItem>

      <PortfolioMetadataItem label={t('capex.metadata.businessOwner')}>
        <MetadataUserPicker
          value={ownerBizId}
          placeholder={t('capex.metadata.businessOwnerMissing')}
          searchPlaceholder={t('capex.metadata.businessOwner')}
          disabled={disabled}
          onChange={onOwnerBizChange}
        />
      </PortfolioMetadataItem>

      <BudgetHolderMetadataItem costCenterId={costCenterId} />

      <Popover
        open={Boolean(statusAnchor)}
        anchorEl={statusAnchor}
        onClose={() => setStatusAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 180, py: 0.5 }}>
          {statusOptions.map((opt) => (
            <MenuItem
              key={opt.value}
              selected={opt.value === status}
              sx={drawerMenuItemSx}
              onClick={() => {
                onStatusChange(opt.value);
                setStatusAnchor(null);
              }}
            >
              {opt.label}
            </MenuItem>
          ))}
        </Box>
      </Popover>

      <Popover
        open={Boolean(priorityAnchor)}
        anchorEl={priorityAnchor}
        onClose={() => setPriorityAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 180, py: 0.5 }}>
          {priorityOptions.map((opt) => (
            <MenuItem
              key={opt.value}
              selected={opt.value === priority}
              sx={drawerMenuItemSx}
              onClick={() => {
                onPriorityChange(opt.value);
                setPriorityAnchor(null);
              }}
            >
              {opt.label}
            </MenuItem>
          ))}
        </Box>
      </Popover>
    </Box>
  );
}
