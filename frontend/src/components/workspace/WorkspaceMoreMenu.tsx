import React from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useTranslation } from 'react-i18next';
import { drawerMenuItemSx } from '../../theme/formSx';

export type WorkspaceMoreMenuItem = {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

/**
 * The "…" pill of a workspace title row: the actions used rarely (change the type of a budget
 * line), kept out of the row. An action pill (`variant="action"`) opening a flat menu anchored
 * under it; nothing shown without an item.
 */
export default function WorkspaceMoreMenu({ items, disabled = false }: { items: WorkspaceMoreMenuItem[]; disabled?: boolean }) {
  const { t } = useTranslation('common');
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      <Button
        variant="action"
        aria-label={t('buttons.moreActions')}
        title={t('buttons.moreActions')}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        disabled={disabled}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ px: '8px' }}
      >
        <MoreHorizIcon sx={{ fontSize: '16px !important' }} />
      </Button>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {items.map((item) => (
          <MenuItem
            key={item.key}
            disabled={item.disabled}
            sx={drawerMenuItemSx}
            onClick={() => {
              setAnchor(null);
              item.onClick();
            }}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
