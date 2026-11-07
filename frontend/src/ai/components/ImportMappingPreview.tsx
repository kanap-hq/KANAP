import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AiImportMapping } from '../aiTypes';
import ImportRunReport from './ImportRunReport';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';

type ImportMappingPreviewProps = {
  mapping: AiImportMapping;
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

/**
 * The column mapping of an attached spreadsheet onto an import's template, on Plaid's preview card:
 * each template column with the file's column it reads (or the value given for every row), the
 * confidence of the match and how many values read; then what is missing, what the file holds that
 * is not used, what was supposed, and the first rows as the template will hold them. Last, the
 * import's check of the file, or what the import did once the card is approved.
 */
function ImportMappingPreview({ mapping }: ImportMappingPreviewProps) {
  const { t, i18n } = useTranslation(['ai']);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const kindOf = new Map(mapping.columns.map((column) => [column.column, column.kind]));
  const titleOf = new Map(mapping.columns.map((column) => [column.column, column.title]));

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
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {mapping.sample.columns.map((column) => (
                    <Box component="th" key={column} sx={headCellSx}>{titleOf.get(column) ?? column}</Box>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mapping.sample.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {mapping.sample.columns.map((column, columnIndex) => {
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
          </Box>
        </Stack>
      )}

      {(mapping.result ?? mapping.validation) && <ImportRunReport run={(mapping.result ?? mapping.validation)!} titles={titleOf} />}
    </Stack>
  );
}

export default React.memo(ImportMappingPreview);
