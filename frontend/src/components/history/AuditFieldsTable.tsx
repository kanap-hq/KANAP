import { Box } from '@mui/material';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import type { Translate } from '../../lib/audit/auditLogLabels';
import {
  formatAuditValue,
  type AuditFields,
  type AuditValueContext,
} from '../../lib/audit/auditLogValues';

/** The field table of one audit entry: the changed fields, or the one side a create or delete wrote. */
const auditFieldsTableSx = {
  width: '100%',
  minWidth: 520,
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
  '& th': {
    fontSize: 11,
    fontWeight: 500,
    color: 'kanap.text.tertiary',
    textAlign: 'left',
    py: '6px',
    pr: '12px',
    borderBottom: '1px solid',
    borderColor: 'kanap.border.default',
    whiteSpace: 'nowrap',
  },
  '& td': {
    fontSize: 13,
    color: 'kanap.text.primary',
    py: '6px',
    pr: '12px',
    borderBottom: '1px solid',
    borderColor: 'kanap.border.soft',
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
  '& tr:last-of-type td': { borderBottom: 0 },
} as const;

const unknownFieldSx = {
  fontFamily: MONO_FONT_FAMILY,
  fontSize: 12,
  color: 'kanap.text.secondary',
} as const;

export function AuditValueCell({ value, field, context }: { value: unknown; field: string; context: AuditValueContext }) {
  const display = formatAuditValue(value, field, context);
  return (
    <Box
      component="td"
      sx={{
        color: display.secondary ? 'kanap.text.secondary' : 'kanap.text.primary',
        whiteSpace: display.text.includes('\n') ? 'pre-line' : undefined,
      }}
      title={display.title}
    >
      {display.text}
    </Box>
  );
}

export function AuditFieldsTable({ fields, t, context }: { fields: AuditFields; t: Translate; context: AuditValueContext }) {
  const twoSided = fields.mode === 'change';
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={auditFieldsTableSx}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ width: twoSided ? '30%' : '34%' }}>{t('auditLogs.details.field')}</Box>
            {twoSided ? (
              <>
                <Box component="th">{t('auditLogs.details.before')}</Box>
                <Box component="th">{t('auditLogs.details.after')}</Box>
              </>
            ) : (
              <Box component="th">{t('auditLogs.details.value')}</Box>
            )}
          </Box>
        </Box>
        <Box component="tbody">
          {fields.rows.map((row) => {
            const label = t(`auditLogs.fields.${row.key}`, { defaultValue: row.key });
            return (
              <Box component="tr" key={row.key}>
                <Box component="td">
                  <Box component="span" sx={label === row.key ? unknownFieldSx : undefined}>{label}</Box>
                </Box>
                {twoSided ? (
                  <>
                    <AuditValueCell value={row.before} field={row.key} context={context} />
                    <AuditValueCell value={row.after} field={row.key} context={context} />
                  </>
                ) : (
                  <AuditValueCell value={row.value} field={row.key} context={context} />
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
