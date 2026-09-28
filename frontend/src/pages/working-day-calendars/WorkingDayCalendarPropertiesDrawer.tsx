import React from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PropertyGroup, PropertyRow } from '../../components/design';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import { drawerFieldValueSx } from '../../theme/formSx';
import type { WorkingDayProfileDetail } from '../../services/workingDayProfiles';
import type { WorkingDayCalendarField } from './workingDayCalendarFields';

type Props = {
  calendar: WorkingDayProfileDetail;
  disabled: boolean;
  errors: Partial<Record<WorkingDayCalendarField, string>>;
  onCodeCommit: (code: string) => void;
  onDisabledAtChange: (disabledAt: string | null) => void;
};

export default function WorkingDayCalendarPropertiesDrawer({
  calendar,
  disabled,
  errors,
  onCodeCommit,
  onDisabledAtChange,
}: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  const [code, setCode] = React.useState(calendar.code);

  // A refused code stays in the field so it can be corrected; a stored change replaces it.
  React.useEffect(() => { setCode(calendar.code); }, [calendar.code]);

  const commitCode = () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setCode(calendar.code);
      return;
    }
    if (trimmed !== calendar.code) onCodeCommit(trimmed);
  };

  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('workingDayCalendars.fields.code')} required helperText={t('workingDayCalendars.hints.code')}>
          <TextField
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onBlur={commitCode}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            }}
            variant="standard"
            sx={drawerFieldValueSx}
            placeholder={t('workingDayCalendars.placeholders.code')}
            disabled={disabled}
            error={!!errors.code}
            helperText={errors.code}
            inputProps={{ 'aria-label': t('workingDayCalendars.fields.code'), autoComplete: 'off', spellCheck: false }}
          />
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
          <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>
            {t('workingDayCalendars.fields.lifecycle')}
          </Typography>
          <StatusLifecycleField
            status={calendar.status}
            // The date carries the change (the switch sets it too); the server derives the status from it.
            onStatusChange={() => undefined}
            disabledAt={calendar.disabled_at}
            onDisabledAtChange={onDisabledAtChange}
            disabled={disabled}
            disabledAtError={!!errors.disabled_at}
            disabledAtHelperText={errors.disabled_at}
          />
        </Box>
      </PropertyGroup>
    </>
  );
}
