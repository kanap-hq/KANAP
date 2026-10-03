import React from 'react';
import { Box, MenuItem, Popover, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PortfolioMetadataItem } from '../../portfolio/workspace/PortfolioMetadataBar';
import MetadataUserPicker from '../../../components/workspace/MetadataUserPicker';
import BudgetHolderMetadataItem from '../../../components/workspace/BudgetHolderMetadataItem';
import type { CostCenterRef } from '../../../services/costCenters';
import { drawerMenuItemSx } from '../../../theme/formSx';
import { STATUS_ENABLED, STATUS_DISABLED, StatusValue } from '../../../constants/status';
import { StatusDot } from '../../../components/design';

type Props = {
  status: StatusValue;
  ownerItId: string | null;
  ownerBizId: string | null;
  /** The owners' names from the detail: shown without reading the user records. */
  ownerItName?: string | null;
  ownerBizName?: string | null;
  /** The line's current cost center: its budget holder shows after the owners. */
  costCenterId?: string | null;
  /** That cost center from the detail (`references.cost_center`): its budget holder without the tree. */
  costCenter?: CostCenterRef | null;
  disabled?: boolean;
  onStatusChange: (next: StatusValue) => void;
  onOwnerItChange: (next: string | null) => void;
  onOwnerBizChange: (next: string | null) => void;
};

export default function SpendMetadataBar({
  status,
  ownerItId,
  ownerBizId,
  ownerItName = null,
  ownerBizName = null,
  costCenterId = null,
  costCenter = null,
  disabled = false,
  onStatusChange,
  onOwnerItChange,
  onOwnerBizChange,
}: Props) {
  const { t } = useTranslation(['ops', 'common']);
  const [statusAnchor, setStatusAnchor] = React.useState<HTMLElement | null>(null);

  const isEnabled = status !== STATUS_DISABLED;
  const statusColor = isEnabled ? '#10B981' : '#9CA3AF';
  const statusLabel = isEnabled ? t('opex.status.enabled') : t('opex.status.disabled');

  const statusOptions: Array<{ value: StatusValue; label: string }> = [
    { value: STATUS_ENABLED, label: t('opex.status.enabled') },
    { value: STATUS_DISABLED, label: t('opex.status.disabled') },
  ];

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.75, alignItems: 'center' }}>
      <PortfolioMetadataItem
        label={t('opex.metadata.status')}
        onClick={(e) => !disabled && setStatusAnchor(e.currentTarget as HTMLElement)}
        disabled={disabled}
      >
        <StatusDot size={8} color={statusColor} sx={{ mr: 0.75 }} />
        <Typography component="span" sx={{ fontSize: 12 }}>{statusLabel}</Typography>
      </PortfolioMetadataItem>

      <PortfolioMetadataItem label={t('opex.metadata.itOwner')}>
        <MetadataUserPicker
          value={ownerItId}
          displayName={ownerItName}
          placeholder={t('opex.metadata.itOwnerMissing')}
          searchPlaceholder={t('opex.metadata.itOwner')}
          disabled={disabled}
          onChange={onOwnerItChange}
        />
      </PortfolioMetadataItem>

      <PortfolioMetadataItem label={t('opex.metadata.businessOwner')}>
        <MetadataUserPicker
          value={ownerBizId}
          displayName={ownerBizName}
          placeholder={t('opex.metadata.businessOwnerMissing')}
          searchPlaceholder={t('opex.metadata.businessOwner')}
          disabled={disabled}
          onChange={onOwnerBizChange}
        />
      </PortfolioMetadataItem>

      <BudgetHolderMetadataItem costCenterId={costCenterId} known={costCenter} />

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
    </Box>
  );
}
