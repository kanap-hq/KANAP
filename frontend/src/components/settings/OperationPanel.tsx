import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useKanapDialogs, type KanapConfirmOptions } from '../design';

/** How many lines of the preview the panel shows. */
export const OPERATION_PREVIEW_LINES = 5;

/** One number of the preview: "Lines", "Lines with an amount", "Total value". */
export type OperationStat = { label: string; value: React.ReactNode };

/** A column of the preview lines. */
export type OperationPreviewColumn = { key: string; label: string; align?: 'left' | 'right' };

/** A line of the preview, its cells by column key. */
export type OperationPreviewRow = { id: string; cells: Record<string, React.ReactNode> };

export type OperationPreview = {
  columns: OperationPreviewColumn[];
  /** The lines in the page's order; the panel shows the first five. */
  rows: OperationPreviewRow[];
  /** How many lines the operation touches: beyond the five shown, "and N more lines". Defaults to the rows given. */
  total?: number;
  /** A link to every line (the page's full grid), after "and N more lines". */
  allLines?: React.ReactNode;
};

export type OperationAction = {
  /** The verb: "Clear column". The confirmation's button repeats it. */
  label: string;
  /** While it runs. */
  busyLabel?: string;
  /** `danger` for an action that removes data (the default), `primary` otherwise. */
  intent?: 'danger' | 'primary';
  /** Nothing to do, or a refusal shown above: the pill is off. */
  disabled?: boolean;
  busy?: boolean;
  /**
   * The question asked first (`useKanapDialogs().confirm`): its title asks with the verb, its message
   * says the effect in numbers and what is kept. Its button repeats the verb unless it names its own.
   */
  confirm?: KanapConfirmOptions;
  /** Runs once confirmed. The page does the work and gives the result back through `result`. */
  onRun: () => void | Promise<void>;
};

export interface OperationPanelProps {
  /** The options, on one line: type, year, column. */
  options: React.ReactNode;
  /** One sentence instead of the preview: no choice yet, or nothing to do. */
  message?: React.ReactNode;
  /** The numbers of the preview, once the choice is complete. */
  stats?: OperationStat[];
  /** The first lines of the preview. */
  preview?: OperationPreview;
  /** Refusals and warnings about the choice (a frozen column): above the consequence. */
  notices?: React.ReactNode;
  /** What the action does when it cannot be undone, in one sentence. */
  consequence?: React.ReactNode;
  /** Pills before the main one (a dry run). */
  secondaryActions?: React.ReactNode;
  action: OperationAction;
  /** The outcome, beside the pill: "45 lines cleared." A refusal says so in the danger colour. */
  result?: { ok: boolean; message: string } | null;
  /** The place of the export of the operation's table (`ReportExportButton`), at the end of the options. */
  exportSlot?: React.ReactNode;
}

const statLabelSx = { fontSize: 12, color: 'kanap.text.tertiary' } as const;
const statValueSx = { fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums' } as const;
const headSx = { fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1, py: 0.75 } as const;
const cellSx = { fontSize: 13, color: 'kanap.text.primary', px: 1, py: 0.75 } as const;

/**
 * An operation (design-ecrans.md §7): options in a row, a preview in numbers and its first five
 * lines, the consequence, then a pill that carries the verb, confirmed first, and the result beside
 * it. A frame: the page computes the preview, runs the operation and writes the result.
 */
export function OperationPanel({
  options,
  message,
  stats,
  preview,
  notices,
  consequence,
  secondaryActions,
  action,
  result,
  exportSlot,
}: OperationPanelProps) {
  const { t } = useTranslation(['common']);
  const dialogs = useKanapDialogs();
  const intent = action.intent ?? 'danger';

  const run = async () => {
    if (action.confirm) {
      const confirmed = await dialogs.confirm({
        ...action.confirm,
        confirmLabel: action.confirm.confirmLabel ?? action.label,
        intent: action.confirm.intent ?? (intent === 'danger' ? 'danger' : undefined),
      });
      if (!confirmed) return;
    }
    await action.onRun();
  };

  const shown = preview?.rows.slice(0, OPERATION_PREVIEW_LINES) ?? [];
  const more = preview ? Math.max(0, (preview.total ?? preview.rows.length) - shown.length) : 0;

  return (
    <Stack spacing={2} alignItems="stretch">
      <Stack direction="row" spacing={2} useFlexGap alignItems="flex-end" sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
        {options}
        {exportSlot && <Box sx={{ ml: 'auto', alignSelf: 'flex-end' }}>{exportSlot}</Box>}
      </Stack>

      {notices}

      {message && <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{message}</Typography>}

      {stats && stats.length > 0 && (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: `repeat(${Math.min(stats.length, 3)}, minmax(0, 1fr))` } }}>
          {stats.map((stat) => (
            <Box key={stat.label} sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <Typography sx={statLabelSx}>{stat.label}</Typography>
              <Typography sx={statValueSx}>{stat.value}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {preview && shown.length > 0 && (
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { borderBottom: '1px solid', borderColor: 'kanap.border.soft' } }}>
          <Box component="thead">
            <Box component="tr">
              {preview.columns.map((column) => (
                <Box component="th" key={column.key} sx={{ ...headSx, textAlign: column.align ?? 'left' }}>{column.label}</Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {shown.map((row) => (
              <Box component="tr" key={row.id}>
                {preview.columns.map((column) => (
                  <Box
                    component="td"
                    key={column.key}
                    sx={{ ...cellSx, textAlign: column.align ?? 'left', ...(column.align === 'right' ? { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } : {}) }}
                  >
                    {row.cells[column.key]}
                  </Box>
                ))}
              </Box>
            ))}
            {(more > 0 || preview.allLines) && (
              <Box component="tr">
                <Box component="td" colSpan={preview.columns.length} sx={{ ...cellSx, color: 'kanap.text.tertiary' }}>
                  <Stack direction="row" spacing={1.5} alignItems="baseline">
                    {more > 0 && <span>{t('common:operationPanel.moreLines', { count: more })}</span>}
                    {preview.allLines}
                  </Stack>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      )}
      {preview && shown.length === 0 && preview.allLines && <Box sx={{ fontSize: 13 }}>{preview.allLines}</Box>}

      {consequence && <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{consequence}</Typography>}

      <Stack direction="row" spacing={1.5} alignItems="center">
        {secondaryActions}
        <Button
          variant={intent === 'danger' ? 'action-danger' : 'action-primary'}
          onClick={() => void run()}
          disabled={action.disabled || action.busy}
        >
          {action.busy && action.busyLabel ? action.busyLabel : action.label}
        </Button>
        {/* Always there, so a screen reader announces the result when it is written. */}
        <Typography role="status" aria-live="polite" sx={{ fontSize: 13, color: result && !result.ok ? 'kanap.danger' : 'kanap.text.secondary' }}>
          {result?.message ?? ''}
        </Typography>
      </Stack>
    </Stack>
  );
}

export default OperationPanel;
