import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, MenuItem, Popover, Typography, useTheme } from '@mui/material';
import {
  PortfolioMetadataItem,
  PortfolioStatusMetadata,
} from '../../portfolio/workspace/PortfolioMetadataBar';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { drawerMenuItemSx } from '../../../theme/formSx';
import { CRITICALITY_COLORS, getDotColor, LIFECYCLE_COLORS } from '../../../utils/statusColors';
import { classificationText } from '../../../utils/applicationClassification';

type Props = {
  lifecycle: string;
  criticality: string;
  classificationIncomplete?: boolean;
  sourceName?: string | null;
  targetName?: string | null;
  routeType: 'direct' | 'via_middleware';
  dataClass: string;
  containsPii: boolean;
  disabled?: boolean;
  onLifecycleChange: (next: string) => void;
  onCriticalityChange: (next: string) => void;
  onDataClassChange: (next: string) => void;
  onFlowClick?: () => void;
};

function humanize(value: string | null | undefined) {
  const text = String(value || '').trim();
  if (!text) return 'Not set';
  return text.replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

export default function InterfaceMetadataBar({
  lifecycle,
  criticality,
  classificationIncomplete = false,
  sourceName,
  targetName,
  routeType,
  dataClass,
  containsPii,
  disabled = false,
  onLifecycleChange,
  onCriticalityChange,
  onDataClassChange,
  onFlowClick,
}: Props) {
  const { t } = useTranslation('it');
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const theme = useTheme();
  const { byField, labelFor } = useItOpsEnumOptions();
  const [dataClassAnchor, setDataClassAnchor] = React.useState<HTMLElement | null>(null);

  const lifecycleOptions = React.useMemo(() => (
    (byField.lifecycleStatus || [])
      .filter((item) => !item.deprecated || item.code === lifecycle)
      .map((item) => ({
        value: item.code,
        label: item.deprecated ? `${item.label} (deprecated)` : item.label,
        color: getDotColor(LIFECYCLE_COLORS[item.code] || 'default', theme.palette.mode),
      }))
  ), [byField.lifecycleStatus, lifecycle, theme.palette.mode]);

  const criticalityOptions = [{ value: '', label: 'Not set', color: getDotColor('default', theme.palette.mode) }, ...(classificationCatalog?.businessCriticalityLevels || []).filter((item) => !item.deprecated || item.code === criticality).map((item) => ({ value: item.code, label: item.label, color: getDotColor('default', theme.palette.mode) }))];

  const dataClassOptions = React.useMemo(() => (
    (byField.dataClass || [])
      .filter((item) => !item.deprecated || item.code === dataClass)
      .map((item) => ({
        value: item.code,
        label: item.deprecated ? `${item.label} (deprecated)` : item.label,
      }))
  ), [byField.dataClass, dataClass]);

  const flowLabel = sourceName && targetName
    ? `${sourceName} -> ${targetName}`
    : 'Applications missing';
  const routeLabel = routeType === 'via_middleware' ? 'Via middleware' : 'Direct';
  const dataClassLabel = classificationCatalog?.dataClasses.find((item) => item.code === dataClass)?.label || dataClass || 'Not set';

  return (
    <>
      <PortfolioStatusMetadata
        value={lifecycle || 'active'}
        label={labelFor('lifecycleStatus', lifecycle) || humanize(lifecycle)}
        color={getDotColor(LIFECYCLE_COLORS[lifecycle] || 'default', theme.palette.mode)}
        options={lifecycleOptions}
        onChange={onLifecycleChange}
        disabled={disabled}
      />
      <PortfolioStatusMetadata
        value={criticality || ''}
        label={`${classificationCatalog?.businessCriticalityLevels.find((item) => item.code === criticality)?.label || criticality || 'Not set'}${classificationIncomplete ? ` (${classificationText('Incomplete inheritance')})` : ''}`}
        color={getDotColor(CRITICALITY_COLORS[criticality] || 'default', theme.palette.mode)}
        options={criticalityOptions}
        onChange={onCriticalityChange}
        disabled={disabled}
      />
      <PortfolioMetadataItem label="Flow" onClick={onFlowClick} disabled={!onFlowClick}>
        {flowLabel}
      </PortfolioMetadataItem>
      <PortfolioMetadataItem label="Route" onClick={onFlowClick} disabled={!onFlowClick}>
        {routeLabel}
      </PortfolioMetadataItem>
      <PortfolioMetadataItem
        label={t('classification.data')}
        onClick={(event) => !disabled && setDataClassAnchor(event.currentTarget)}
        disabled={disabled}
      >
        {dataClassLabel}
      </PortfolioMetadataItem>
      <PortfolioMetadataItem disabled>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Typography component="span" sx={{ fontSize: 12 }}>
            {containsPii ? t('workspace.interface.pii.label') : t('workspace.interface.pii.none')}
          </Typography>
        </Box>
      </PortfolioMetadataItem>

      <Popover
        open={Boolean(dataClassAnchor)}
        anchorEl={dataClassAnchor}
        onClose={() => setDataClassAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 200, py: 0.5 }}>
          {dataClassOptions.map((option) => (
            <MenuItem
              key={option.value}
              selected={option.value === dataClass}
              sx={drawerMenuItemSx}
              onClick={() => {
                onDataClassChange(option.value);
                setDataClassAnchor(null);
              }}
            >
              {option.label}
            </MenuItem>
          ))}
        </Box>
      </Popover>
    </>
  );
}
