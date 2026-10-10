import React from 'react';
import {
  Typography,
  Box,
  Alert,
  List,
  ListItem,
  ListItemText,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { KanapDialog } from './design';

export interface DeleteConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (options?: { deleteRelated?: boolean }) => void;
  title?: string;
  message?: string;
  itemCount: number;
  items?: Array<{ id: string; name: string }>;
  loading?: boolean;
  maxDisplayItems?: number;
  /** Optional checkbox for cascade deletion of related data */
  cascadeOption?: {
    label: string;
    description?: string;
  };
}

export default function DeleteConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  itemCount,
  items = [],
  loading = false,
  maxDisplayItems = 10,
  cascadeOption,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation('common');
  const [deleteRelated, setDeleteRelated] = React.useState(false);
  const displayItems = items.slice(0, maxDisplayItems);
  const hasMore = items.length > maxDisplayItems;

  // Reset checkbox when dialog closes
  React.useEffect(() => {
    if (!open) setDeleteRelated(false);
  }, [open]);

  return (
    <KanapDialog
      open={open}
      title={title || t('delete.confirmTitle')}
      onClose={() => { if (!loading) onClose(); }}
      onSave={() => onConfirm(cascadeOption ? { deleteRelated } : undefined)}
      saveLabel={loading ? t('status.deleting') : t('buttons.delete')}
      saveVariant="action-danger"
      saveLoading={loading}
      cancelLabel={t('buttons.cancel')}
    >
      <Alert severity="warning" sx={{ mb: 2 }}>
        {t('delete.warningMessage')}
      </Alert>

      {message && (
        <Typography sx={{ fontSize: 13.5, mb: 2 }}>
          {message}
        </Typography>
      )}

      <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
        {itemCount === 1
          ? t('delete.singleItem')
          : t('delete.multipleItems', { count: itemCount })}
      </Typography>

      {displayItems.length > 0 && (
        <Box
          sx={{
            maxHeight: 200,
            overflowY: 'auto',
            border: '1px solid',
            borderColor: 'kanap.border.default',
            borderRadius: '6px',
            mb: 1,
          }}
        >
          <List dense disablePadding>
            {displayItems.map((item) => (
              <ListItem key={item.id} divider>
                <ListItemText
                  primary={item.name}
                  primaryTypographyProps={{ variant: 'body2' }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {hasMore && (
        <Typography variant="caption" color="text.secondary">
          {t('delete.andMore', { count: items.length - maxDisplayItems })}
        </Typography>
      )}

      {cascadeOption && (
        <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: '6px' }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={deleteRelated}
                onChange={(e) => setDeleteRelated(e.target.checked)}
                disabled={loading}
              />
            }
            label={cascadeOption.label}
          />
          {cascadeOption.description && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
              {cascadeOption.description}
            </Typography>
          )}
        </Box>
      )}

      <Typography variant="body2" sx={{ mt: 2, fontWeight: 500 }}>
        {t('delete.confirmPrompt')}
      </Typography>
    </KanapDialog>
  );
}
