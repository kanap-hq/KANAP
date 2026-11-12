import React, { useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import BackspaceOutlined from '@mui/icons-material/BackspaceOutlined';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { KanapDialog, PropertyRow } from '../design';
import { useNotify } from '../notify/NotifyProvider';
import { reportFilterMenuProps } from '../reports/ReportLayout';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

/** A picker of the dialog: the value, or null (nothing picked). */
export type BulkEditPickerProps = { value: string | null; onChange: (next: string | null) => void; label: string };

/**
 * One field a list changes in bulk, declared by the list (lot F1 of 26.11.8): its label, its value
 * picker, whether it may be emptied, and how its value goes into the route's `changes`.
 */
export type BulkEditField = {
  key: string;
  label: string;
  /**
   * A choice made before the value, which the value picker depends on: the dimension of a dimension
   * value, the company whose chart of accounts lists the accounts. Changing it drops the value.
   */
  first?: { label: string; render: (props: BulkEditPickerProps) => React.ReactNode };
  /** The value may be emptied (with `first`, for that choice): the dialog offers "Empty" beside the picker. */
  optional: boolean | ((first: string) => boolean);
  /** The value picker; `first`, the choice made before it (the picker is shown once it is made). */
  render: (props: BulkEditPickerProps & { first: string | null }) => React.ReactNode;
  /** The route's `changes` for the value (null: the field emptied). */
  changes: (value: string | null, first: string | null) => Record<string, unknown>;
};

/** The count of a dry run (`common/bulk-edit/bulk-edit.ts`). */
type BulkCount = { rows: number; changes: number; unchanged: number; refused: Record<string, number>; as_of: string };
/** The answer of the write. */
export type BulkEditWriteResult = { rows: number; changed: number; unchanged: number; refused: Record<string, number> };

/** Counting or writing 5,000 rows takes about a minute: the proxy's limit, without a retry. */
export const BULK_EDIT_TIMEOUT_MS = 300_000;

/** The value of the dialog: nothing picked yet (null), a value, or the field emptied. */
type Picked = { value: string | null } | null;

const statusSx = { fontSize: 13, color: 'kanap.text.secondary' } as const;
const quietSx = { fontSize: 12, color: 'kanap.text.tertiary' } as const;
// The pickers draw their own label: hidden here, the row carries it.
const hideInnerLabelSx = { flex: 1, minWidth: 0, '& .MuiInputLabel-root': { display: 'none' }, '& .MuiFormControl-root': { m: 0 } } as const;

const refusalTotal = (refused: Record<string, number> | undefined) => Object.values(refused ?? {}).reduce((sum, n) => sum + n, 0);

/**
 * "Change the selection" of a list: a field, then its value (for a dimension, the dimension then the
 * value); a dry run counts the rows that will change, those that already hold the value and the
 * refused ones by reason, each time the value changes; the write sends back the count's `as_of` and
 * `expected_rows`. The rows: `selection`, the body part of `useBulkSelection`. Once written, a
 * notice says how many rows changed and were refused, and `onDone` reloads the list.
 */
export default function BulkEditDialog({ open, onClose, endpoint, selection, fields, onDone }: {
  open: boolean;
  onClose: () => void;
  /** The bulk route (`/budget-lines/bulk-update`). */
  endpoint: string;
  selection: Record<string, unknown>;
  fields: BulkEditField[];
  onDone: (result: BulkEditWriteResult) => void;
}) {
  const { t } = useTranslation('common');
  const notify = useNotify();
  const [fieldKey, setFieldKey] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Each opening starts afresh, on the first field.
  useEffect(() => {
    if (!open) return;
    setFieldKey(fields[0]?.key ?? '');
    setFirst(null);
    setPicked(null);
    setError(null);
    // The fields at the opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const field = fields.find((f) => f.key === fieldKey) ?? null;
  const firstMade = !field?.first || first != null;
  const optional = !!field && firstMade && (typeof field.optional === 'function' ? field.optional(first ?? '') : field.optional);
  const changes = useMemo(
    () => (field && firstMade && picked && (picked.value != null || optional) ? field.changes(picked.value, first) : null),
    [field, first, firstMade, optional, picked],
  );
  const body = useMemo(() => (changes ? { ...selection, changes } : null), [changes, selection]);

  // Counted once a value is picked, again at each new value (never on a search typed in a picker).
  const count = useQuery({
    queryKey: ['bulk-edit-count', endpoint, body],
    queryFn: async () => (await api.post<BulkCount>(endpoint, { ...body, dry_run: true }, { timeout: BULK_EDIT_TIMEOUT_MS })).data,
    enabled: open && body != null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const counting = body != null && count.isFetching;
  const countError = count.error as any;
  const tooMany = !counting && count.isError && countError?.response?.data?.code === 'bulk_too_many';
  // A change the route refuses as a whole (a value that names nothing, a disabled cost center): its reason.
  const refusedChange = !counting && count.isError && !tooMany && countError?.response?.status === 400
    ? getApiErrorMessage(countError, t, t('bulkEdit.countFailed'))
    : null;
  const result = body != null && !counting && !count.isError ? count.data ?? null : null;

  const choose = (key: string) => {
    setFieldKey(key);
    setFirst(null);
    setPicked(null);
    setError(null);
  };
  const chooseFirst = (next: string | null) => {
    setFirst(next);
    setPicked(null);
    setError(null);
  };
  const pick = (next: Picked) => {
    setPicked(next);
    setError(null);
  };

  const save = async () => {
    if (!body || !result) return;
    setSaving(true);
    setError(null);
    try {
      // Only the rows of the count: more rows than counted is refused (409), rows created since stay out.
      const res = await api.post<BulkEditWriteResult>(
        endpoint,
        { ...body, as_of: result.as_of, expected_rows: result.rows },
        { timeout: BULK_EDIT_TIMEOUT_MS },
      );
      const done = res.data;
      const refused = refusalTotal(done.refused);
      const changed = t('bulkEdit.doneChanged', { count: done.changed });
      notify({ message: refused > 0 ? t('bulkEdit.doneWithRefused', { changed, refused: t('bulkEdit.doneRefused', { count: refused }) }) : changed });
      onDone(done);
    } catch (failure: any) {
      const status = failure?.response?.status;
      if (status === 409) {
        setError(t('bulkEdit.listChanged'));
        void count.refetch();
      } else if (failure?.response?.data?.code === 'bulk_too_many') {
        setError(t('bulkEdit.tooMany'));
      } else if (status === 400) {
        setError(getApiErrorMessage(failure, t, t('bulkEdit.failed')));
      } else if (!failure?.response) {
        // No answer (network, time out): the change may have gone through.
        setError(t('bulkEdit.noAnswer'));
      } else {
        setError(getApiErrorMessage(failure, t, t('bulkEdit.failed')));
      }
    } finally {
      setSaving(false);
    }
  };

  const refusals = Object.entries(result?.refused ?? {}).filter(([, n]) => n > 0);
  const refusedCount = refusalTotal(result?.refused);

  return (
    <KanapDialog
      open={open}
      title={t('bulkEdit.title')}
      onClose={onClose}
      onSave={save}
      saveLabel={result ? t('bulkEdit.save', { count: result.changes }) : t('bulkEdit.saveIdle')}
      saveDisabled={!result || result.changes === 0 || counting}
      saveLoading={saving}
    >
      <Stack spacing={1.5}>
        <PropertyRow label={t('bulkEdit.field')}>
          <TextField
            select
            variant="standard"
            value={fieldKey}
            onChange={(event) => choose(event.target.value)}
            SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('bulkEdit.field') } }}
            sx={drawerSelectSx}
            disabled={saving}
          >
            {fields.map((option) => (
              <MenuItem key={option.key} value={option.key} sx={drawerMenuItemSx}>{option.label}</MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        {field?.first && (
          <PropertyRow label={field.first.label}>
            <Box sx={hideInnerLabelSx}>
              {field.first.render({ value: first, onChange: chooseFirst, label: field.first.label })}
            </Box>
          </PropertyRow>
        )}
        {field && firstMade && (
          <PropertyRow label={t('bulkEdit.value')}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              {picked && picked.value == null ? (
                <Typography sx={{ ...statusSx, flex: 1, py: '5px' }} data-testid="bulk-edit-emptied">{t('bulkEdit.emptied')}</Typography>
              ) : (
                <Box sx={hideInnerLabelSx} key={`${field.key}:${first ?? ''}`}>
                  {field.render({
                    value: picked?.value ?? null,
                    // Clearing the picker is "nothing picked"; emptying the field is the button beside it.
                    onChange: (next) => pick(next == null ? null : { value: next }),
                    label: field.label,
                    first,
                  })}
                </Box>
              )}
              {optional && (
                <Tooltip title={picked && picked.value == null ? t('bulkEdit.chooseValue') : t('bulkEdit.empty')}>
                  <IconButton
                    size="small"
                    aria-label={t('bulkEdit.empty')}
                    aria-pressed={!!picked && picked.value == null}
                    onClick={() => pick(picked && picked.value == null ? null : { value: null })}
                    disabled={saving}
                  >
                    <BackspaceOutlined sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </PropertyRow>
        )}
        {body && (
          <Box role="status" aria-busy={counting}>
            {counting ? (
              <Stack direction="row" alignItems="center" spacing={1}>
                <CircularProgress size={12} />
                <Typography sx={statusSx}>{t('bulkEdit.counting')}</Typography>
              </Stack>
            ) : tooMany ? (
              <Typography sx={statusSx}>{t('bulkEdit.tooMany')}</Typography>
            ) : refusedChange ? (
              <Typography sx={statusSx}>{refusedChange}</Typography>
            ) : count.isError ? (
              <Typography sx={statusSx}>{t('bulkEdit.countFailed')}</Typography>
            ) : result ? (
              <Stack spacing={0.25}>
                <Typography sx={statusSx}>{t('bulkEdit.willChange', { count: result.changes })}</Typography>
                {result.unchanged > 0 && <Typography sx={quietSx}>{t('bulkEdit.unchanged', { count: result.unchanged })}</Typography>}
                {refusedCount > 0 && (
                  <>
                    <Typography sx={statusSx}>{t('bulkEdit.refused', { count: refusedCount })}</Typography>
                    <Box component="ul" sx={{ m: 0, pl: 2 }}>
                      {refusals.map(([code, n]) => (
                        <Typography component="li" key={code} sx={quietSx} data-refusal={code}>
                          {t('bulkEdit.refusal', { reason: t(`bulkEdit.refusals.${code}`, { defaultValue: t('bulkEdit.refusals.other') }), count: n })}
                        </Typography>
                      ))}
                    </Box>
                  </>
                )}
              </Stack>
            ) : null}
          </Box>
        )}
        {saving && (
          <Stack direction="row" alignItems="center" spacing={1} role="status" aria-busy>
            <CircularProgress size={12} />
            <Typography sx={statusSx}>{t('bulkEdit.saving')}</Typography>
          </Stack>
        )}
        {error && <Typography role="alert" sx={statusSx}>{error}</Typography>}
      </Stack>
    </KanapDialog>
  );
}
