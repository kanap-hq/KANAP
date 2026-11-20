import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';
import type { AiImportChoice, AiImportMapping } from '../aiTypes';
import ImportRunReport from './ImportRunReport';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';
import { formatAmount } from '../../i18n/formatters';

type ImportMappingPreviewProps = {
  mapping: AiImportMapping;
  /** The person's choices on a pending check, the whole list; absent: read only. */
  onChoices?: (choices: AiImportChoice[]) => void;
  choicesDisabled?: boolean;
};

const cellSx = {
  py: 0.5,
  pr: 1.5,
  fontSize: 12,
  lineHeight: 1.45,
  verticalAlign: 'top',
  borderBottom: 1,
  borderColor: 'kanap.border.soft',
  textAlign: 'left',
} as const;

const headCellSx = {
  ...cellSx,
  fontSize: 11,
  fontWeight: 500,
  color: 'kanap.text.secondary',
  borderColor: 'kanap.border.default',
  whiteSpace: 'nowrap',
} as const;

const sectionLabelSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.secondary',
} as const;

const edgeSx = {
  position: 'absolute',
  top: 0,
  display: 'flex',
  alignItems: 'center',
  height: 24,
  color: 'kanap.text.tertiary',
  pointerEvents: 'none',
  '& svg': { fontSize: 18 },
} as const;

/**
 * A table wider than the card scrolls sideways; the columns it hides are marked on their side: the
 * edge fades and a chevron shows, whether or not the browser draws a scrollbar.
 */
function SideScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const left = element.scrollLeft > 1;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setHidden((was) => (was.left === left && was.right === right ? was : { left, right }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  const fade = [hidden.left ? 'transparent, black 32px' : 'black', hidden.right ? 'black calc(100% - 32px), transparent' : 'black'].join(', ');
  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        ref={ref}
        onScroll={measure}
        sx={{ overflowX: 'auto', ...(hidden.left || hidden.right ? { maskImage: `linear-gradient(to right, ${fade})` } : {}) }}
      >
        {children}
      </Box>
      {hidden.left && <Box data-testid="columns-hidden-left" aria-hidden sx={{ ...edgeSx, left: -4 }}><ChevronLeftIcon /></Box>}
      {hidden.right && <Box data-testid="columns-hidden-right" aria-hidden sx={{ ...edgeSx, right: -4 }}><ChevronRightIcon /></Box>}
    </Box>
  );
}

/**
 * The column mapping of an attached spreadsheet onto an import's template, on Plaid's preview card:
 * each template column with the file's column it reads (or the value given for every row), the
 * confidence of the match and how many values read; then what is missing, what the file holds that
 * is not used, what was supposed, and the first rows as the template will hold them. Last, the
 * import's check of the file, or what the import did once the card is approved.
 */
function ImportMappingPreview({ mapping, onChoices, choicesDisabled }: ImportMappingPreviewProps) {
  const { t, i18n } = useTranslation(['ai']);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const kindOf = new Map(mapping.columns.map((column) => [column.column, column.kind]));
  // The columns the mapping fills, then those the import matches without the file (a supplier found by its publisher).
  const titleOf = new Map([
    ...Object.entries(mapping.matched_titles ?? {}),
    ...mapping.columns.map((column): [string, string] => [column.column, column.title]),
  ]);
  // The budget lines' amounts, the values one checks, come right after the title: on a narrow card they stay in view.
  const sampleOrder = mapping.sample.columns.map((_, index) => index);
  if (mapping.import_key === 'budget_lines') {
    const title = mapping.sample.columns.indexOf('name');
    const rank = (index: number) => {
      if (index <= title) return 0;
      return kindOf.get(mapping.sample.columns[index]) === 'number' ? 1 : 2;
    };
    sampleOrder.sort((a, b) => rank(a) - rank(b) || a - b);
  }

  const sourceLabel = (column: AiImportMapping['columns'][number]) => {
    if (column.source) {
      return column.source.header
        ?? t('ai:previewCard.importMapping.columnAt', { position: column.source.position });
    }
    return t('ai:previewCard.importMapping.everyRow', { value: column.value ?? '' });
  };

  const sampleCell = (column: string, value: string) => {
    if (!value) return '';
    const kind = kindOf.get(column);
    if (kind === 'date') return formatShortDate(value, locale, { year: 'always' }) || value;
    // A day and time as the file writes it, `2026-10-02 07:48`: shown as written, in no other time zone.
    if (kind === 'datetime') {
      return /[ T]\d/.test(value)
        ? formatShortDateTime(value.replace(' ', 'T'), locale) || value
        : formatShortDate(value, locale, { year: 'always' }) || value;
    }
    // A budget line's amount, as the budget screens write it in the person's language (`52 000`).
    if (kind === 'number' && mapping.import_key === 'budget_lines' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return formatAmount(Number(value), locale);
    }
    if (kind === 'boolean') {
      if (value === 'true') return t('ai:previewCard.importMapping.yes');
      if (value === 'false') return t('ai:previewCard.importMapping.no');
    }
    return value;
  };

  return (
    <Stack spacing={1.5}>
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <Box component="th" sx={headCellSx}>{t('ai:previewCard.importMapping.column')}</Box>
              <Box component="th" sx={headCellSx}>{t('ai:previewCard.importMapping.fromFile')}</Box>
              <Box component="th" sx={headCellSx}>{t('ai:previewCard.importMapping.confidence')}</Box>
              <Box component="th" sx={headCellSx}>{t('ai:previewCard.importMapping.read')}</Box>
            </tr>
          </thead>
          <tbody>
            {mapping.columns.map((column) => {
              const unreadValues = mapping.unread_values?.[column.column] ?? [];
              const readError = mapping.read_errors?.[column.column];
              return (
                <tr key={column.column}>
                  <Box component="td" sx={{ ...cellSx, color: 'kanap.text.primary' }}>
                    {column.title}
                    {column.required && (
                      <Box component="span" sx={{ color: 'warning.main', ml: 0.25 }} aria-hidden>*</Box>
                    )}
                  </Box>
                  <Box component="td" sx={{ ...cellSx, color: 'kanap.text.secondary' }}>
                    <div>{sourceLabel(column)}</div>
                    {column.note && (
                      <Box sx={{ color: 'kanap.text.tertiary', fontSize: 11 }}>{column.note}</Box>
                    )}
                  </Box>
                  <Box
                    component="td"
                    sx={{
                      ...cellSx,
                      whiteSpace: 'nowrap',
                      color: column.confidence === 'low' ? 'warning.main' : 'kanap.text.secondary',
                    }}
                  >
                    {t(`ai:previewCard.importMapping.confidenceLevels.${column.confidence}`)}
                  </Box>
                  <Box component="td" sx={{ ...cellSx, color: 'kanap.text.secondary' }}>
                    {column.source ? (
                      <>
                        <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
                          {t('ai:previewCard.importMapping.filled', { filled: column.filled, rows: mapping.row_count })}
                        </Box>
                        {column.read_as && (
                          <Box sx={{ color: 'kanap.text.tertiary', fontSize: 11 }}>
                            {t(`ai:previewCard.importMapping.readAs.${column.read_as}`)}
                          </Box>
                        )}
                        {readError && (
                          <Box sx={{ color: 'warning.main' }}>{t(`ai:previewCard.importMapping.readErrors.${readError}`)}</Box>
                        )}
                        {!readError && column.unread > 0 && (
                          <Box sx={{ color: 'warning.main' }}>
                            {t('ai:previewCard.importMapping.unread', { count: column.unread })}
                            {unreadValues.length > 0 && (
                              <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>
                                {' '}({unreadValues.join(', ')})
                              </Box>
                            )}
                          </Box>
                        )}
                      </>
                    ) : (
                      <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>
                        {t('ai:previewCard.importMapping.allRows')}
                      </Box>
                    )}
                  </Box>
                </tr>
              );
            })}
          </tbody>
        </Box>
      </Box>

      {mapping.missing_required.length > 0 && (
        <Typography sx={{ fontSize: 12, color: 'warning.main' }}>
          {t('ai:previewCard.importMapping.missingRequired', {
            columns: mapping.missing_required.map((column) => column.title).join(', '),
          })}
        </Typography>
      )}
      {mapping.rows_missing_required > 0 && (
        <Typography sx={{ fontSize: 12, color: 'warning.main' }}>
          {t('ai:previewCard.importMapping.rowsMissingRequired', { count: mapping.rows_missing_required })}
        </Typography>
      )}
      {mapping.unplaced.length > 0 && (
        <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>
          {t('ai:previewCard.importMapping.unplaced', {
            columns: mapping.unplaced
              .map((column) => column.header ?? t('ai:previewCard.importMapping.columnAt', { position: column.position }))
              .join(', '),
          })}
        </Typography>
      )}

      {mapping.assumptions.length > 0 && (
        <Stack spacing={0.5}>
          <Typography component="div" sx={sectionLabelSx}>{t('ai:previewCard.importMapping.assumptions')}</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.25, fontSize: 12, lineHeight: 1.5, color: 'kanap.text.primary' }}>
            {mapping.assumptions.map((assumption, index) => (
              <li key={index}>{assumption}</li>
            ))}
          </Box>
        </Stack>
      )}

      {mapping.sample.rows.length > 0 && (
        <Stack spacing={0.5}>
          <Typography component="div" sx={sectionLabelSx}>{t('ai:previewCard.importMapping.firstRows')}</Typography>
          <SideScroll>
            <Box component="table" sx={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {sampleOrder.map((columnIndex) => {
                    const column = mapping.sample.columns[columnIndex];
                    return <Box component="th" key={column} sx={headCellSx}>{titleOf.get(column) ?? column}</Box>;
                  })}
                </tr>
              </thead>
              <tbody>
                {mapping.sample.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {sampleOrder.map((columnIndex) => {
                      const column = mapping.sample.columns[columnIndex];
                      // A value the import will not read shows as the file writes it.
                      const unread = mapping.sample.unread?.[rowIndex]?.[columnIndex] === true;
                      const value = row[columnIndex] ?? '';
                      return (
                        <Box
                          component="td"
                          key={column}
                          sx={{
                            ...cellSx,
                            color: unread ? 'warning.main' : 'kanap.text.primary',
                            whiteSpace: 'nowrap',
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {unread ? value : sampleCell(column, value)}
                        </Box>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Box>
          </SideScroll>
        </Stack>
      )}

      {(mapping.result ?? mapping.validation) && (
        <ImportRunReport
          run={(mapping.result ?? mapping.validation)!}
          importKey={mapping.import_key}
          titles={titleOf}
          onChoices={mapping.result ? undefined : onChoices}
          choicesDisabled={choicesDisabled}
        />
      )}
    </Stack>
  );
}

export default React.memo(ImportMappingPreview);
