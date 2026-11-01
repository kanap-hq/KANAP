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
  /** Replaces the generic warning (which says a referenced item is kept) when the delete removes the references too. */
  warning?: string;
  /** The main action's label; "Delete" by default ("Delete anyway" when the delete removes dependants). */
  confirmLabel?: string;
  itemCount: number;
  items?: Array<{ id: string; name: string; note?: string }>;
  loading?: boolean;
  maxDisplayItems?: number;
  /** The line above the items, in the record's words ("2 contracts will be deleted:"). */
  itemsLabel?: string;
  /** Selected items the delete would refuse, kept, each with why (`reason`), under their own line. */
  kept?: { label: string; items: Array<{ id: string; name: string; reason?: string }> };
  /** Optional checkbox for cascade deletion of related data */
  cascadeOption?: {
    label: string;
    description?: string;
  };
  /** The checkbox's state, when the caller owns it (what it deletes changes with it). */
  deleteRelated?: boolean;
  onDeleteRelatedChange?: (checked: boolean) => void;
  /** No main action while nothing would be deleted (every item kept until the option is checked). */
  confirmDisabled?: boolean;
  /** A refusal from the delete itself, shown in the dialog. The list behind may already have changed. */
  error?: string | null;
}

export default function DeleteConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  warning,
  confirmLabel,
  itemCount,
  items = [],
  loading = false,
  maxDisplayItems = 10,
  itemsLabel,
  kept,
  cascadeOption,
  deleteRelated: ownedDeleteRelated,
  onDeleteRelatedChange,
  confirmDisabled = false,
  error = null,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation('common');
  const [localDeleteRelated, setLocalDeleteRelated] = React.useState(false);
  const deleteRelated = ownedDeleteRelated ?? localDeleteRelated;
  const setDeleteRelated = (checked: boolean) => {
    setLocalDeleteRelated(checked);
    onDeleteRelatedChange?.(checked);
  };
  const displayItems = items.slice(0, maxDisplayItems);
  const hasMore = items.length > maxDisplayItems;

  // Reset checkbox when dialog closes
  React.useEffect(() => {
    if (!open) setLocalDeleteRelated(false);
  }, [open]);

  return (
    <KanapDialog
      open={open}
      title={title || t('delete.confirmTitle')}
      onClose={() => { if (!loading) onClose(); }}
      onSave={() => onConfirm(cascadeOption ? { deleteRelated } : undefined)}
      saveLabel={loading ? t('status.deleting') : confirmLabel ?? t('buttons.delete')}
      saveVariant="action-danger"
      saveLoading={loading}
      saveDisabled={confirmDisabled}
      cancelLabel={t('buttons.cancel')}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
      )}
      <Alert severity="warning" sx={{ mb: 2 }}>
        {warning ?? t('delete.warningMessage', { count: itemCount })}
      </Alert>

      {message && (
        <Typography sx={{ fontSize: 13.5, mb: 2 }}>
          {message}
        </Typography>
      )}

      {/* A zero count ("0 interfaces will be deleted") reads as a bug: the kept list says why. */}
      {itemCount > 0 && (
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
          {itemsLabel ?? t('delete.itemsToDelete', { count: itemCount })}
        </Typography>
      )}

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
                  secondary={item.note}
                  primaryTypographyProps={{ variant: 'body2' }}
                  secondaryTypographyProps={{ variant: 'caption', sx: { whiteSpace: 'pre-line' } }}
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

      {kept && kept.items.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <DeleteConfirmKept label={kept.label} items={kept.items} />
        </Box>
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

/** The selected items a delete keeps (refused), each with why: "Acme" / "2 contracts and 1 application". */
export function DeleteConfirmKept({ label, items }: { label: string; items: Array<{ id: string; name: string; reason?: string }> }) {
  return (
    <Box data-testid="delete-kept">
      <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>{label}</Typography>
      <Box sx={{ maxHeight: 160, overflowY: 'auto', border: '1px solid', borderColor: 'kanap.border.default', borderRadius: '6px' }}>
        <List dense disablePadding>
          {items.map((item) => (
            <ListItem key={item.id} divider>
              <ListItemText
                primary={item.name}
                secondary={item.reason}
                primaryTypographyProps={{ variant: 'body2' }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
          ))}
        </List>
      </Box>
    </Box>
  );
}
