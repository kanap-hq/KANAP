import React, { useState } from 'react';
import { Button, Snackbar, Alert } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import DeleteConfirmDialog from './DeleteConfirmDialog';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiErrorMessage';

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
}: DeleteSelectedButtonProps<T>) {
  const { t } = useTranslation('common');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'warning';
  }>({ open: false, message: '', severity: 'success' });

  const handleOpenConfirm = () => {
    if (selectedRows.length === 0) return;
    setConfirmOpen(true);
  };

  const handleCloseConfirm = () => {
    if (loading) return;
    setConfirmOpen(false);
  };

  const handleConfirmDelete = async (options?: { deleteRelated?: boolean }) => {
    setLoading(true);
    try {
      const ids = selectedRows.map(getItemId);
      const data: Record<string, any> = { ids };
      if (options?.deleteRelated && cascadeOption) {
        data[cascadeOption.apiKey] = true;
      }
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
        // Each failed item with its reason (for example a frozen budget column), all failed or not.
        const reasons = failed.map((f: any) => `${f.productName || f.name || f.description || 'Item'}: ${f.reason}`).join('; ');
        setSnackbar(deleted.length === 0
          ? { open: true, message: t('delete.failedAll', { reasons }), severity: 'error' }
          : { open: true, message: t('delete.partial', { deleted: deleted.length, failed: failed.length, reasons }), severity: 'warning' });
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

  return (
    <>
      {/* Neutral while nothing is selected, red once there is something to delete. */}
      <Button
        variant={selectedRows.length > 0 ? 'action-danger' : 'action'}
        startIcon={<DeleteIcon sx={{ fontSize: '14px !important' }} />}
        onClick={handleOpenConfirm}
        disabled={disabled || selectedRows.length === 0}
      >
        {label || t('buttons.deleteSelected')} ({selectedRows.length})
      </Button>

      <DeleteConfirmDialog
        open={confirmOpen}
        onClose={handleCloseConfirm}
        onConfirm={handleConfirmDelete}
        title={t('delete.deleteSelectedTitle')}
        itemCount={selectedRows.length}
        items={items}
        loading={loading}
        cascadeOption={cascadeOption ? { label: cascadeOption.label, description: cascadeOption.description } : undefined}
      />

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
