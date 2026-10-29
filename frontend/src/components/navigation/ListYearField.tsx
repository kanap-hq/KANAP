import React, { useId } from 'react';
import { Box, IconButton, Stack, TextField } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useTranslation } from 'react-i18next';
import { companyListYear } from '../../pages/companies/companyYear';

/**
 * Year control of the companies and departments list headers.
 *
 * Action pills are 31px (12px text, 1.75 line-height, 4px padding, 1px border).
 * A floating label made this field about 50px and stretched or dropped the pills.
 * The label sits in the row, and the field stays 31px, so the header stays centred.
 */
const PILL_HEIGHT = 31;

const arrowSx = {
  width: PILL_HEIGHT,
  height: PILL_HEIGHT,
  minWidth: PILL_HEIGHT,
  p: 0,
  flexShrink: 0,
  color: 'kanap.text.secondary',
} as const;

type ListYearFieldProps = {
  /** What the field shows, including a year that is still being typed. */
  draft: string;
  /** The year the list is showing. The arrows step from this, not from a partial draft. */
  year: number;
  /** The new field text. The page commits it once it is a complete year. */
  onChange: (text: string) => void;
};

export default function ListYearField({ draft, year, onChange }: ListYearFieldProps) {
  const { t } = useTranslation(['master-data', 'common']);
  const inputId = useId();

  const step = (delta: -1 | 1) => {
    const text = String(year + delta);
    if (companyListYear(text) == null) return;
    onChange(text);
  };

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.5}
      sx={{ height: PILL_HEIGHT, maxHeight: PILL_HEIGHT, flexShrink: 0, alignSelf: 'center' }}
    >
      <IconButton
        size="small"
        onClick={() => step(-1)}
        disabled={companyListYear(String(year - 1)) == null}
        aria-label={t('common:yearTabs.previous')}
        sx={arrowSx}
      >
        <ArrowBackIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <Box
        component="label"
        htmlFor={inputId}
        sx={{
          fontSize: 12,
          fontWeight: 400,
          lineHeight: `${PILL_HEIGHT}px`,
          height: PILL_HEIGHT,
          color: 'kanap.text.tertiary',
          whiteSpace: 'nowrap',
          cursor: 'text',
        }}
      >
        {t('shared.fields.year')}
      </Box>
      <TextField
        id={inputId}
        variant="standard"
        type="number"
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        sx={{
          width: 72,
          m: 0,
          height: PILL_HEIGHT,
          flexShrink: 0,
          '& .MuiInputBase-root': {
            height: PILL_HEIGHT,
            maxHeight: PILL_HEIGHT,
            boxSizing: 'border-box',
            py: '4px',
          },
          '& .MuiInputBase-input': {
            fontSize: '13px !important',
            lineHeight: '21px',
            height: '21px',
            py: '0 !important',
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'center',
            MozAppearance: 'textfield',
            '&::-webkit-outer-spin-button, &::-webkit-inner-spin-button': {
              WebkitAppearance: 'none',
              margin: 0,
            },
          },
        }}
      />
      <IconButton
        size="small"
        onClick={() => step(1)}
        disabled={companyListYear(String(year + 1)) == null}
        aria-label={t('common:yearTabs.next')}
        sx={arrowSx}
      >
        <ArrowForwardIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Stack>
  );
}
