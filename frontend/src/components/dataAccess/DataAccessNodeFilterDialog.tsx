import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';
import DataAccessNodePicker from './DataAccessNodePicker';
import type { AccessNode } from './dataAccess';

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (node: AccessNode) => void;
};

/** "Who has access to ...": a company or a cost center, picked like the dialog's Add picker. */
export default function DataAccessNodeFilterDialog({ open, onClose, onPick }: Props) {
  const { t } = useTranslation(['admin', 'common']);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('admin:dataAccess.filters.node')}</DialogTitle>
      <DialogContent>
        <DataAccessNodePicker
          onPick={(node) => {
            onPick(node);
            onClose();
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('common:buttons.cancel')}</Button>
      </DialogActions>
    </Dialog>
  );
}
