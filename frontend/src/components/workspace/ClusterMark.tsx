import React from 'react';
import { Tooltip } from '@mui/material';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { useTranslation } from 'react-i18next';

/** Marks an asset that is a cluster: an icon whose tooltip says "Cluster" (no word on the row). */
export default function ClusterMark() {
  const { t } = useTranslation('it');
  const label = t('pages.assets.columns.cluster');
  return (
    <Tooltip title={label}>
      <HubOutlinedIcon role="img" aria-hidden={false} aria-label={label} sx={{ fontSize: 14, color: 'kanap.text.secondary', verticalAlign: 'text-bottom' }} />
    </Tooltip>
  );
}
