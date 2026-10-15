import React, { useState } from 'react';
import { Button, Snackbar, Alert } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import DeleteConfirmDialog, { DeleteConfirmKept } from './DeleteConfirmDialog';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiErrorMessage';
import { deleteFailureReason, refusalCounts, type DeleteFailure } from '../utils/deleteRefusal';
import { KanapDialog } from './design';

/**
 * What a delete of the selection would do, asked before any dialog: the rows it would refuse
 * (with the refusal's `code` and `usages`, as the bulk delete reports them), and for the others the
 * dialog's warning and main label ("Delete anyway" when something else goes too).
 */
export type DeleteCheck = {
  refused: Array<DeleteFailure & { id: string; name?: string }>;
  warning?: string;
  confirmLabel?: string;
  /** The body key sent `true` when the delete removes the dependants the warning names ("Delete anyway"). */
  forceKey?: string;
};

export interface DeleteSelectedButtonProps<T> {
  selectedRows: T[];
  endpoint: string; // e.g., '/spend-items/bulk'
  getItemId: (row: T) => string;
  getItemName: (row: T) => string;
  onDeleteSuccess: () => void;
  gridApi?: any; // AG Grid API to clear selection
  disabled?: boolean;
  label?: string;
  /** Optional cascade delete option for related data */
  cascadeOption?: {
    label: string;
    description?: string;
    /** The key to send in the API body when cascade is enabled */
    apiKey: string;
  };
  /**
   * Some selected rows have dependants the delete removes too: the dialog's warning says so
   * (`message`, with the exact count) in place of the generic one, its main action reads `confirmLabel` ("Delete anyway"), and the body sends
   * `apiKey: true` when given (no key: the endpoint removes the dependants without being asked). Undefined: the usual confirmation.
   */
  forceOption?: {
    message: string;
    confirmLabel: string;
    apiKey?: string;
  };
  /** The dialog's warning for these items when nothing else goes with them (in place of the generic one). */
  warning?: string;
  /**
   * Asked on click, before the dialog: which rows the delete would refuse. Refused rows are listed
   * as kept, with why, and only the others are sent; a single refused row gets the record's refusal
   * window (the reason, Close only). A failed check falls back to the usual confirmation.
   */
  checkDelete?: (ids: string[]) => Promise<DeleteCheck>;
  /** The item lines in the record's words: "2 contracts will be deleted:", "1 contract is kept:". */
  itemLabels?: { toDelete: (count: number) => string; kept: (count: number) => string };
}

export default function DeleteSelectedButton<T>({
  selectedRows,
  endpoint,
  getItemId,
  getItemName,
  onDeleteSuccess,
  gridApi,
  disabled = false,
  label,
  cascadeOption,
  forceOption,
  warning,
  checkDelete,
  itemLabels,
}: DeleteSelectedButtonProps<T>) {
  const { t, i18n } = useTranslation('common');
  const language = i18n?.resolvedLanguage || i18n?.language || 'en';
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<DeleteCheck | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'warning';
  }>({ open: false, message: '', severity: 'success' });

  const handleOpenConfirm = async () => {
    if (selectedRows.length === 0) return;
    setCheck(null);
    if (checkDelete) {
      setChecking(true);
      try {
        setCheck(await checkDelete(selectedRows.map(getItemId)));
      } catch {
        // No check: the usual confirmation, and the server still refuses what it must.
      } finally {
        setChecking(false);
      }
    }
    setConfirmOpen(true);
  };

  const handleCloseConfirm = () => {
    if (loading) return;
    setConfirmOpen(false);
  };

  const handleConfirmDelete = async (options?: { deleteRelated?: boolean }) => {
    setLoading(true);
    try {
      const ids = deletable.map((item) => item.id);
      const data: Record<string, any> = { ids };
      if (options?.deleteRelated && cascadeOption) {
        data[cascadeOption.apiKey] = true;
      }
      // An answered check says what goes too; without one, the force option from the rows.
      const forceKey = check ? check.forceKey : forceOption?.apiKey;
      if (forceKey) data[forceKey] = true;
      const response = await api.delete(endpoint, { data });

      const { deleted = [], failed = [] } = response.data;

      if (failed.length === 0) {
        // All deleted successfully
        setSnackbar({
          open: true,
          message: t('delete.successAll', { count: deleted.length }),
          severity: 'success',
        });
      } else {
        // Each failed item with its reason (for example a frozen budget column, or what still uses it), all failed or not.
        const reasons = failed
          .map((f: any) => `${f.productName || f.name || f.description || 'Item'}: ${deleteFailureReason(f, t, language)}`)
          .join('; ');
        setSnackbar(deleted.length === 0
          ? { open: true, message: t('delete.failedAll', { reasons }), severity: 'error' }
          : {
            open: true,
            message: `${t('delete.partialDeleted', { count: deleted.length })} ${t('delete.partialFailed', { count: failed.length, reasons })}`,
            severity: 'warning',
          });
      }

      setConfirmOpen(false);

      // Clear grid selection
      if (gridApi) {
        try {
          gridApi.deselectAll?.();
        } catch (e) {
          console.warn('Failed to clear grid selection:', e);
        }
      }

      onDeleteSuccess();
    } catch (error: any) {
      console.error('Delete error:', error);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, t, t('delete.failedGeneric')),
        severity: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  const items = selectedRows.map((row) => ({
    id: getItemId(row),
    name: getItemName(row),
  }));
  // Refused rows stay out of the delete; each is listed as kept, with what makes it refused.
  const refusedById = new Map((check?.refused ?? []).map((refusal) => [refusal.id, refusal]));
  const deletable = items.filter((item) => !refusedById.has(item.id));
  const keptItems = items
    .filter((item) => refusedById.has(item.id))
    .map((item) => {
      const refusal = refusedById.get(item.id)!;
      // What uses it, counted; a refusal without counts (a frozen column) in its own words.
      return { ...item, reason: refusal.usages?.length ? refusalCounts(refusal, t, language) : deleteFailureReason(refusal, t, language) };
    });
  const keptLabel = (count: number) => itemLabels?.kept(count) ?? t('delete.itemsKept', { count });
  const onlyRefused = !!check && deletable.length === 0 && keptItems.length > 0;

  return (
    <>
      {/* Neutral while nothing is selected, red once there is something to delete. */}
      <Button
        variant={selectedRows.length > 0 ? 'action-danger' : 'action'}
        startIcon={<DeleteIcon sx={{ fontSize: '14px !important' }} />}
        onClick={() => { void handleOpenConfirm(); }}
        disabled={disabled || checking || selectedRows.length === 0}
      >
        {label || t('buttons.deleteSelected')} ({selectedRows.length})
      </Button>

      {onlyRefused ? (
        // Nothing left to delete: the refusal and why, as on a record page, with Close only.
        <KanapDialog
          open={confirmOpen}
          title={keptItems.length === 1
            ? t('delete.recordTitle', { name: keptItems[0].name })
            : t('delete.deleteSelectedTitle', { count: keptItems.length })}
          onClose={handleCloseConfirm}
          onSave={handleCloseConfirm}
          saveLabel={t('buttons.close')}
          saveVariant="action"
          showCancel={false}
        >
          {keptItems.length === 1 ? (
            <Alert severity="warning">{deleteFailureReason(refusedById.get(keptItems[0].id)!, t, language)}</Alert>
          ) : (
            <DeleteConfirmKept label={keptLabel(keptItems.length)} items={keptItems} />
          )}
        </KanapDialog>
      ) : (
        <DeleteConfirmDialog
          open={confirmOpen}
          onClose={handleCloseConfirm}
          onConfirm={handleConfirmDelete}
          title={t('delete.deleteSelectedTitle', { count: deletable.length })}
          warning={check ? (check.warning ?? warning) : (forceOption?.message ?? warning)}
          confirmLabel={check ? check.confirmLabel : forceOption?.confirmLabel}
          itemCount={deletable.length}
          items={deletable}
          itemsLabel={itemLabels?.toDelete(deletable.length)}
          kept={keptItems.length > 0 ? { label: keptLabel(keptItems.length), items: keptItems } : undefined}
          loading={loading}
          cascadeOption={cascadeOption ? { label: cascadeOption.label, description: cascadeOption.description } : undefined}
        />
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
