import React from 'react';
import { Autocomplete, Box, Chip, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PropertyRow } from '../../../components/design';

/** Trim, drop blanks, and keep the first of each exact label. */
export function normalizeTaskLabels(values: readonly unknown[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const label = String(raw ?? '').trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    next.push(label);
  }
  return next;
}

function sameLabels(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((label, index) => label === right[index]);
}

/**
 * Labels row: chips plus free entry. A reader sees the chips only.
 * `open` stays false because there is no suggestion list: an empty popup would
 * only report that no options exist.
 */
export default function TaskLabelsField({
  labels,
  readOnly = false,
  onChange,
}: {
  labels: string[] | null | undefined;
  readOnly?: boolean;
  onChange: (labels: string[]) => void;
}) {
  const { t } = useTranslation('portfolio');
  const value = labels ?? [];
  const label = t('workspace.task.sidebar.fields.labels');

  return (
    <PropertyRow label={label}>
      {readOnly ? (
        value.length === 0 ? (
          <Typography sx={{ fontSize: 13 }}>-</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {value.map((item) => (
              <Chip key={item} size="small" label={item} />
            ))}
          </Box>
        )
      ) : (
        <Autocomplete<string, true, false, true>
          multiple
          freeSolo
          fullWidth
          size="small"
          open={false}
          forcePopupIcon={false}
          options={[]}
          value={value}
          onChange={(_, next) => {
            const normalized = normalizeTaskLabels(next);
            if (sameLabels(normalized, value)) return;
            onChange(normalized);
          }}
          renderTags={(tags, getTagProps) =>
            tags.map((option, index) => {
              const { key, ...tagProps } = getTagProps({ index });
              return <Chip key={key} {...tagProps} size="small" label={option} />;
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={value.length === 0 ? t('workspace.task.sidebar.fields.labelsPlaceholder') : ''}
              size="small"
              variant="standard"
              inputProps={{
                ...params.inputProps,
                'aria-label': label,
              }}
            />
          )}
        />
      )}
    </PropertyRow>
  );
}
