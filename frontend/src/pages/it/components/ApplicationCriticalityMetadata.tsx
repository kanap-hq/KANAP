import React from 'react';
import { Menu, MenuItem } from '@mui/material';
import { useTranslation } from 'react-i18next';
import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import { drawerMenuItemSx } from '../../../theme/formSx';
import { classificationText } from '../../../utils/applicationClassification';
import { catalogOptionLabel } from '../../../utils/catalogOffered';
import { PortfolioMetadataItem } from '../../portfolio/workspace/PortfolioMetadataBar';

/** Metadata-bar chip for the business criticality: the level name at rest, a flat menu of tenant levels on click. */
export default function ApplicationCriticalityMetadata({ criticality, disabled, onCommit }: { criticality: string | null; disabled?: boolean; onCommit: (value: string | null) => Promise<void> }) {
  const { t } = useTranslation(['it', 'common']);
  const { data: catalog } = useApplicationClassificationCatalog();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [pending, setPending] = React.useState(false);
  const commit = async (value: string | null) => {
    setAnchor(null);
    if (value === criticality) return;
    setPending(true);
    try { await onCommit(value); } catch { /* The workspace displays the error. */ }
    finally { setPending(false); }
  };
  const levels = catalog?.businessCriticalityLevels || [];
  const level = levels.find((item) => item.code === criticality);
  const options = levels.filter((item) => !item.deprecated || item.code === criticality);
  return <>
    <PortfolioMetadataItem label={classificationText('Business criticality')} disabled={disabled || pending || !catalog} onClick={(event) => setAnchor(event.currentTarget)}>
      {level ? catalogOptionLabel(level, t) : criticality || classificationText('Not set')}
    </PortfolioMetadataItem>
    <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}>
      {criticality && <MenuItem onClick={() => void commit(null)} sx={drawerMenuItemSx}>— {classificationText('Clear')} —</MenuItem>}
      {options.map((item) => <MenuItem key={item.code} selected={item.code === criticality} onClick={() => void commit(item.code)} sx={drawerMenuItemSx}>{catalogOptionLabel(item, t)}</MenuItem>)}
    </Menu>
  </>;
}
