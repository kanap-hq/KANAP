import React, { useMemo, useState } from 'react';
import { Autocomplete, Checkbox, ListItemText, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

export type ExclusionOption = { id: string; label: string };

/** Height of one option row: fixed, so a long list draws only the rows in view. */
export const EXCLUSION_OPTION_HEIGHT = 32;
/** From this many options the list draws a window of rows instead of every row. */
const WINDOW_FROM = 100;
/** Rows drawn above and below the visible ones, so arrow keys and fast scrolls stay smooth. */
const OVERSCAN = 12;
/** Upper bound of the visible height (the list box is at most 40% of the viewport). */
const VIEWPORT = 800;

/**
 * The option list of an exclusion picker. With thousands of lines, drawing every option made the
 * picker slow to open and to type in; past `WINDOW_FROM` options only the rows in view (and a few
 * around them) are drawn, between two spacers holding the height of the others.
 */
const WindowedListbox = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLElement>>(function WindowedListbox(props, ref) {
  const { children, onScroll, ...other } = props;
  const items = React.Children.toArray(children);
  const [scrollTop, setScrollTop] = useState(0);
  const count = items.length;
  const windowed = count > WINDOW_FROM;
  // A search shortens the list: never start the window past its end.
  const top = Math.min(scrollTop, Math.max(0, count * EXCLUSION_OPTION_HEIGHT - VIEWPORT));
  const first = windowed ? Math.max(0, Math.floor(top / EXCLUSION_OPTION_HEIGHT) - OVERSCAN) : 0;
  const last = windowed ? Math.min(count, Math.ceil((top + VIEWPORT) / EXCLUSION_OPTION_HEIGHT) + OVERSCAN) : count;
  return (
    <ul
      {...other}
      ref={ref}
      onScroll={(event) => {
        if (windowed) setScrollTop(event.currentTarget.scrollTop);
        onScroll?.(event);
      }}
    >
      {first > 0 && <li aria-hidden style={{ height: first * EXCLUSION_OPTION_HEIGHT }} />}
      {windowed ? items.slice(first, last) : items}
      {last < count && <li aria-hidden style={{ height: (count - last) * EXCLUSION_OPTION_HEIGHT }} />}
    </ul>
  );
});

const listboxSx = {
  ...drawerAutocompleteListboxSx,
  '& .MuiAutocomplete-option': {
    ...drawerAutocompleteListboxSx['& .MuiAutocomplete-option'],
    height: EXCLUSION_OPTION_HEIGHT,
    py: 0,
  },
} as const;

/**
 * A multi-select of the values a report leaves out (lines, accounts, dimension values): a search
 * field, a windowed list with a checkbox per option, and "N selected" in the field. The options
 * load when the list first opens (`onFirstOpen`), not with the report: most reports are read
 * without excluding anything. Picked ids whose option is not loaded still count.
 */
export default function ReportExclusionPicker({
  options,
  loading,
  value,
  onChange,
  onFirstOpen,
  label,
  inFilter = false,
  placeholder,
  selectedText,
  noOptionsText,
  minWidth = 260,
}: {
  options: ExclusionOption[] | undefined;
  loading: boolean;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  onFirstOpen?: () => void;
  /** The field's name: its label, or only its accessible name inside a `ReportFilter` (`inFilter`). */
  label: string;
  inFilter?: boolean;
  placeholder: string;
  selectedText: (count: number) => string;
  noOptionsText: string;
  minWidth?: number;
}) {
  const { t } = useTranslation(['ops']);
  const [opened, setOpened] = useState(false);
  const list = options ?? [];
  const selected = useMemo(() => {
    if (value.length === 0) return [];
    const byId = new Map(list.map((option) => [option.id, option]));
    return value.map((id) => byId.get(id)).filter((option): option is ExclusionOption => Boolean(option));
  }, [value, list]);
  const fontSx = inFilter ? { fontSize: 13 } : undefined;

  return (
    <Autocomplete
      multiple
      size="small"
      disableCloseOnSelect
      options={list}
      value={selected}
      loading={loading}
      loadingText={t('reports.shared.loadingData')}
      onOpen={() => {
        if (!opened) {
          setOpened(true);
          onFirstOpen?.();
        }
      }}
      onChange={(_, next) => onChange(next.map((option) => option.id))}
      getOptionLabel={(option) => option.label}
      isOptionEqualToValue={(option, other) => option.id === other.id}
      ListboxComponent={WindowedListbox}
      ListboxProps={{ sx: listboxSx } as React.HTMLAttributes<HTMLElement>}
      renderOption={(props, option, { selected: checked }) => (
        <li {...props} key={option.id}>
          <Checkbox size="small" checked={checked} sx={{ p: 0.5, mr: 1 }} />
          <ListItemText primary={option.label} primaryTypographyProps={{ noWrap: true, ...(inFilter ? { fontSize: 13 } : {}) }} />
        </li>
      )}
      renderTags={() => []}
      renderInput={(params) => {
        const count = value.length;
        return (
          <TextField
            {...params}
            {...(inFilter ? {} : { label, InputLabelProps: { shrink: true } })}
            placeholder={count === 0 ? placeholder : ''}
            inputProps={{ ...params.inputProps, ...(inFilter ? { 'aria-label': label } : {}) }}
            sx={inFilter ? { '& input': { fontSize: 13 } } : undefined}
            InputProps={{
              ...params.InputProps,
              startAdornment: count > 0 ? (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5, mr: 1, whiteSpace: 'nowrap', ...fontSx }}>
                    {selectedText(count)}
                  </Typography>
                  {params.InputProps.startAdornment}
                </>
              ) : params.InputProps.startAdornment,
            }}
          />
        );
      }}
      sx={inFilter ? { width: '100%' } : { minWidth }}
      noOptionsText={noOptionsText}
    />
  );
}
