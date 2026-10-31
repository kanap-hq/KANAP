import React, { useState } from 'react';
import { Alert, Badge, Box, Button, Snackbar, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import DeleteConfirmDialog, { DeleteConfirmKept } from './DeleteConfirmDialog';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiErrorMessage';
import { deleteFailureReason, refusalUsages, usageTotal, type DeleteFailure } from '../utils/deleteRefusal';
import { joinNames } from '../pages/working-day-calendars/workingDayCalendarFields';
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
  /**
   * The refusal codes the window's `cascadeOption` lifts (an interface's bindings): those items are
   * listed as kept, and checking the option moves them to the items deleted.
   */
  cascadeLifts?: string[];
  /** A short note under an item that goes (by id): what its delete takes with it, one line per case. */
  notes?: Record<string, string>;
};

export interface DeleteSelectedButtonProps<T> {
  selectedRows: T[];
  endpoint: string; // e.g., '/spend-items/bulk'
  getItemId: (row: T) => string;
  getItemName: (row: T) => string;
  onDeleteSuccess: () => void;
  gridApi?: any; // AG Grid API to clear selection
  disabled?: boolean;
  /** Replaces "Delete" in the tooltip and the accessible name ("Delete (n)"). */
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
  /**
   * The item lines in the record's words: "2 contracts will be deleted:", "1 contract is kept:", and
   * for the message once done, "2 contracts deleted" (else "Deleted 2 items").
   */
  itemLabels?: {
    toDelete: (count: number) => string;
    /** Only for lists whose delete can refuse items. */
    kept?: (count: number) => string;
    deleted?: (count: number) => string;
    /** Several selected items: "Delete the 2 selected companies". One item stays named. */
    title?: (count: number) => string;
    /** Once done: "1 company kept". */
    keptDone?: (count: number) => string;
    /**
     * Why an item that other records use is kept, as a sentence ("Acme is kept: 2 interfaces use it."):
     * its name, what uses it counted ("2 interfaces") and how many records that is.
     */
    keptReason?: (kept: { name: string; usages: string; count: number }) => string;
    /**
     * The window's title counts the items that will really be deleted (the refused ones are left
     * out), not the whole selection. The default counts the selection.
     */
    titleCountsDeleted?: boolean;
  };
}

/** The names a success message lists before "and n more". */
const NAMED_DELETES = 3;

/** Count on the trash: 9px on a 14px badge, sitting on the icon's corner inside the pill. */
const selectedCountBadgeSx = {
  '& .MuiBadge-badge': {
    bgcolor: 'kanap.danger',
    color: 'kanap.tealForeground',
    fontSize: 9,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    height: 14,
    minWidth: 14,
    lineHeight: '14px',
    padding: '0 3px',
    top: 3,
    right: 3,
  },
};

type Item = { id: string; name: string };
/** What the dialog shows, taken when it opens: it keeps saying it while it closes, after the selection is cleared. */
type Opened = { items: Item[]; check: DeleteCheck | null };

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
  const [opened, setOpened] = useState<Opened>({ items: [], check: null });
  const [deleteRelated, setDeleteRelated] = useState(false);
  const check = opened.check;
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'warning';
  }>({ open: false, message: '', severity: 'success' });

  const handleOpenConfirm = async () => {
    if (selectedRows.length === 0) return;
    const selection = selectedRows.map((row) => ({ id: getItemId(row), name: getItemName(row) }));
    let answered: DeleteCheck | null = null;
    if (checkDelete) {
      setChecking(true);
      try {
        answered = await checkDelete(selection.map((item) => item.id));
      } catch {
        // No check: the usual confirmation, and the server still refuses what it must.
      } finally {
        setChecking(false);
      }
    }
    setOpened({ items: selection, check: answered });
    setDeleteRelated(false);
    setConfirmOpen(true);
  };

  const handleCloseConfirm = () => {
    if (loading) return;
    setConfirmOpen(false);
  };

  const handleConfirmDelete = async (options?: { deleteRelated?: boolean }) => {
    setLoading(true);
    try {
      const ids = toDelete.map((item) => item.id);
      const data: Record<string, any> = { ids };
      if (options?.deleteRelated && cascadeOption) {
        data[cascadeOption.apiKey] = true;
      }
      // An answered check says what goes too; without one, the force option from the rows.
      const forceKey = check ? check.forceKey : forceOption?.apiKey;
      if (forceKey) data[forceKey] = true;
      const response = await api.delete(endpoint, { data });

      const { deleted = [], failed = [] } = response.data;
      const deletedIds: string[] = Array.isArray(deleted) ? deleted.map(String) : [];
      // What was deleted, then what the check kept, by name.
      const done = shownKept.length > 0
        ? t('delete.withKept', { deleted: deletedMessage(deletedIds), kept: keptMessage() })
        : deletedMessage(deletedIds);

      if (failed.length === 0) {
        // All deleted successfully
        setSnackbar({
          open: true,
          message: done,
          severity: 'success',
        });
      } else {
        // Each failed item with its reason (for example a frozen budget column, or what still uses it), all failed or not.
        const reasons = failed
          .map((f: any) => `${f.productName || f.name || f.description || 'Item'}: ${deleteFailureReason(f, t, language)}`)
          .join('; ');
        setSnackbar(deletedIds.length === 0
          ? { open: true, message: t('delete.failedAll', { reasons }), severity: 'error' }
          : {
            open: true,
            message: t('delete.partialResult', { deleted: done, failed: t('delete.partialFailed', { count: failed.length, reasons }) }),
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

  const items = opened.items;
  /** "2 contracts deleted: Alpha and Beta", the names capped ("…, and 2 more"). */
  const deletedMessage = (ids: string[]) => {
    const what = itemLabels?.deleted?.(ids.length) ?? t('delete.successAll', { count: ids.length });
    const nameById = new Map(items.map((item) => [item.id, item.name]));
    return namedMessage(what, ids.map((id) => nameById.get(id)).filter((name): name is string => !!name));
  };
  /** "<what>: Alpha, Beta, Gamma and 2 more", or `what` alone without names. */
  const namedMessage = (what: string, names: string[]) => {
    if (names.length === 0) return what;
    const shown = names.slice(0, NAMED_DELETES);
    if (names.length > NAMED_DELETES) shown.push(t('delete.namesMore', { count: names.length - NAMED_DELETES }));
    return t('delete.namedList', { what, names: joinNames(shown, language) });
  };
  /** "1 item kept: Beta", the names capped as for the deleted ones. */
  const keptMessage = () => namedMessage(
    itemLabels?.keptDone?.(shownKept.length) ?? t('delete.keptDone', { count: shownKept.length }),
    shownKept.map((item) => item.name),
  );
  // Refused rows stay out of the delete; each is listed as kept, with what makes it refused.
  const refusedById = new Map((check?.refused ?? []).map((refusal) => [refusal.id, refusal]));
  const deletable = items.filter((item) => !refusedById.has(item.id));
  const keptItems = items
    .filter((item) => refusedById.has(item.id))
    .map((item) => {
      const refusal = refusedById.get(item.id)!;
      // What uses it, counted; a refusal without counts (a frozen column) in its own words.
      if (!refusal.usages?.length) return { ...item, reason: deleteFailureReason(refusal, t, language) };
      const usages = refusalUsages(refusal.usages, refusal.applications, t, language, refusal.connections);
      const count = (usageTotal(refusal.usages) as { count?: number }).count ?? 0;
      return { ...item, reason: itemLabels?.keptReason?.({ name: item.name, usages, count }) ?? usages };
    });
  // Kept items whose refusal the window's option lifts: checked, they are deleted too.
  const lifts = new Set(cascadeOption ? check?.cascadeLifts ?? [] : []);
  const liftable = keptItems.filter((item) => lifts.has(refusedById.get(item.id)!.code ?? ''));
  const released = deleteRelated ? liftable : [];
  const releasedIds = new Set(released.map((item) => item.id));
  const toDelete = items.filter((item) => !refusedById.has(item.id) || releasedIds.has(item.id));
  const shownKept = keptItems.filter((item) => !releasedIds.has(item.id));
  const keptLabel = (count: number) => itemLabels?.kept?.(count) ?? t('delete.itemsKept', { count });
  /** "Delete Acme?" for one item, "Delete the 3 selected items" for several: one item is always named. */
  const selectionTitle = (named: Item[]) => (named.length === 1
    ? t('delete.recordTitle', { name: named[0].name })
    : itemLabels?.title?.(named.length) ?? t('delete.deleteSelectedTitle', { count: named.length }));
  const titleCountsDeleted = itemLabels?.titleCountsDeleted === true;
  const onlyRefused = !!check && deletable.length === 0 && keptItems.length > 0 && liftable.length === 0;
  const selectedCount = selectedRows.length;
  // Same words as the old text pill, so the button keeps its accessible name.
  const accessibleName = `${label || t('buttons.deleteSelected')} (${selectedCount})`;

  return (
    <>
      <Tooltip title={accessibleName} describeChild>
        {/* A disabled button fires no events: the wrapper keeps the tooltip working. */}
        <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
          <Button
            variant="action-danger"
            aria-label={accessibleName}
            onClick={() => { void handleOpenConfirm(); }}
            disabled={disabled || checking || selectedCount === 0}
            sx={{ px: '8px' }}
          >
            <Badge
              badgeContent={selectedCount}
              max={9999}
              showZero
              slotProps={{ badge: { 'aria-hidden': true } }}
              sx={selectedCountBadgeSx}
            >
              <DeleteIcon sx={{ fontSize: '16px !important' }} />
            </Badge>
          </Button>
        </Box>
      </Tooltip>

      {onlyRefused ? (
        // Nothing left to delete: the refusal and why, as on a record page, with Close only.
        <KanapDialog
          open={confirmOpen}
          title={selectionTitle(keptItems)}
          onClose={handleCloseConfirm}
          onSave={handleCloseConfirm}
          saveLabel={t('buttons.close')}
          saveVariant="action"
          showCancel={false}
        >
          {keptItems.length === 1 ? (
            <Alert severity="warning">
              {itemLabels?.keptReason && keptItems[0].reason ? keptItems[0].reason : deleteFailureReason(refusedById.get(keptItems[0].id)!, t, language)}
            </Alert>
          ) : (
            <DeleteConfirmKept label={keptLabel(keptItems.length)} items={keptItems} />
          )}
        </KanapDialog>
      ) : (
        <DeleteConfirmDialog
          open={confirmOpen}
          onClose={handleCloseConfirm}
          onConfirm={handleConfirmDelete}
          // The item named, or the selection counted: the lists below say what goes and what is kept.
          title={selectionTitle(titleCountsDeleted && toDelete.length > 0 ? toDelete : items)}
          // Once the check has answered, the refused items are listed as kept: no generic "referenced items are kept".
          warning={check ? (check.warning ?? warning ?? t('delete.cannotUndo')) : (forceOption?.message ?? warning)}
          confirmLabel={check ? check.confirmLabel : forceOption?.confirmLabel}
          itemCount={toDelete.length}
          items={toDelete.map((item) => ({ ...item, note: check?.notes?.[item.id] }))}
          itemsLabel={itemLabels?.toDelete(toDelete.length)}
          kept={shownKept.length > 0 ? { label: keptLabel(shownKept.length), items: shownKept } : undefined}
          loading={loading}
          cascadeOption={cascadeOption ? { label: cascadeOption.label, description: cascadeOption.description } : undefined}
          deleteRelated={deleteRelated}
          onDeleteRelatedChange={setDeleteRelated}
          confirmDisabled={toDelete.length === 0}
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
