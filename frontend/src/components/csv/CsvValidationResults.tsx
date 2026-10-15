import React from 'react';
import {
  Alert,
  Box,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getDotColor } from '../../utils/statusColors';
import { StatusDot } from '../design';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import { useTranslation } from 'react-i18next';
import { CsvImportResult } from './csv.types';
import { csvMessageText } from './csvMessage';

interface CsvValidationResultsProps {
  result: CsvImportResult;
  maxErrors?: number;
  maxWarnings?: number;
}

export function CsvValidationResults({
  result,
  maxErrors = 10,
  maxWarnings = 5,
}: CsvValidationResultsProps) {
  const { t } = useTranslation('common');
  const mode = useTheme().palette.mode;
  const isValidation = result.dryRun;
  const hasErrors = result.errors.length > 0;
  const hasWarnings = result.warnings.length > 0;

  return (
    <Box>
      {/* Summary */}
      <Alert
        severity={result.ok ? 'success' : 'error'}
        icon={result.ok ? <CheckCircleIcon /> : <ErrorIcon />}
        sx={{ mb: 2 }}
      >
        {result.ok ? (
          isValidation ? (
            <>{t('csv.validationPassed', { count: result.total })}</>
          ) : (
            <>{t('csv.importCompleted')}</>
          )
        ) : (
          <>{t('csv.validationFailed')}</>
        )}
      </Alert>

      {/* Counts */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <StatusDot color={getDotColor('default', mode)} />
          <Typography variant="body2" sx={{ color: getDotColor('default', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('csv.totalRows', { count: result.total })}</Typography>
        </Box>
        {result.inserted > 0 && (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <StatusDot color={getDotColor('success', mode)} />
            <Typography variant="body2" sx={{ color: getDotColor('success', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('csv.toInsert', { count: result.inserted })}</Typography>
          </Box>
        )}
        {result.updated > 0 && (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <StatusDot color={getDotColor('info', mode)} />
            <Typography variant="body2" sx={{ color: getDotColor('info', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('csv.toUpdate', { count: result.updated })}</Typography>
          </Box>
        )}
        {result.skipped > 0 && (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <StatusDot color={getDotColor('warning', mode)} />
            <Typography variant="body2" sx={{ color: getDotColor('warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('csv.skipped', { count: result.skipped })}</Typography>
          </Box>
        )}
      </Stack>

      {/* Errors */}
      {hasErrors && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" color="error" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <ErrorIcon fontSize="small" />
            {t('csv.errors', { count: result.errors.length })}
          </Typography>
          <List dense disablePadding sx={{ bgcolor: 'error.50', borderRadius: 1 }}>
            {result.errors.slice(0, maxErrors).map((err, i) => (
              <ListItem key={i} sx={{ py: 0.5 }}>
                <ListItemText
                  primary={
                    <Typography variant="body2">
                      {err.row > 0 && <strong>{t('csv.rowPrefix', { row: err.row })}</strong>} {csvMessageText(err, t)}
                      {err.column && <Typography component="span" color="text.secondary"> ({err.column})</Typography>}
                    </Typography>
                  }
                />
              </ListItem>
            ))}
            {result.errors.length > maxErrors && (
              <ListItem sx={{ py: 0.5 }}>
                <ListItemText
                  primary={
                    <Typography variant="caption" color="text.secondary">
                      {t('csv.andMoreErrors2', { count: result.errors.length - maxErrors })}
                    </Typography>
                  }
                />
              </ListItem>
            )}
          </List>
        </Box>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <Box>
          <Typography variant="subtitle2" color="warning.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <WarningIcon fontSize="small" />
            {t('csv.warnings', { count: result.warnings.length })}
          </Typography>
          <List dense disablePadding sx={{ bgcolor: 'warning.50', borderRadius: 1 }}>
            {result.warnings.slice(0, maxWarnings).map((warn, i) => (
              <ListItem key={i} sx={{ py: 0.5 }}>
                <ListItemText
                  primary={
                    <Typography variant="body2">
                      {warn.row > 0 && <strong>{t('csv.rowPrefix', { row: warn.row })}</strong>} {csvMessageText(warn, t)}
                      {warn.column && <Typography component="span" color="text.secondary"> ({warn.column})</Typography>}
                    </Typography>
                  }
                />
              </ListItem>
            ))}
            {result.warnings.length > maxWarnings && (
              <ListItem sx={{ py: 0.5 }}>
                <ListItemText
                  primary={
                    <Typography variant="caption" color="text.secondary">
                      {t('csv.andMoreWarnings', { count: result.warnings.length - maxWarnings })}
                    </Typography>
                  }
                />
              </ListItem>
            )}
          </List>
        </Box>
      )}
    </Box>
  );
}
