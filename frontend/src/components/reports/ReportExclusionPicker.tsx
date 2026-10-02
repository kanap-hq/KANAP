import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Autocomplete, Checkbox, ListItemText, TextField, Typography } from '@mui/material';
import { useForkRef } from '@mui/material/utils';
import { useTranslation } from 'react-i18next';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

export type ExclusionOption = { id: string; label: string };

/** Height of one option row: fixed, so a long list draws only the rows in view. */
export const EXCLUSION_OPTION_HEIGHT = 32;
/** From this many options the list draws a window of rows instead of every row. */
const WINDOW_FROM = 100;
/** Rows drawn above and below the visible ones: more than a PageUp or PageDown step (5). */
const OVERSCAN = 12;
/** Visible height assumed before the list is measured (the list box is at most 40% of the viewport). */
const VIEWPORT = 800;

/** The index (in the listed options) of the option the keyboard or the pointer highlights. */
const HighlightContext = createContext<number | null>(null);

/**
 * The option list of an exclusion picker. With thousands of lines, drawing every option made the
 * picker slow to open and to type in; past `WINDOW_FROM` options only the rows in view (and a few
 * around them) are drawn, between spacers holding the height of the others, plus the first and the
 * last option (Home and End). The autocomplete only moves its highlight to a drawn option, so the
 * window follows the highlight: when it leaves the visible rows, the list scrolls to it at once,
 * and the next rows the arrow keys reach are drawn.
 */
const WindowedListbox = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLElement>>(function WindowedListbox(props, ref) {
  const { children, onScroll, ...other } = props;
  const items = React.Children.toArray(children);
  const listRef = useRef<HTMLUListElement | null>(null);
  const handleRef = useForkRef(ref, listRef);
  const highlighted = useContext(HighlightContext);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(VIEWPORT);
  const count = items.length;
  const windowed = count > WINDOW_FROM;

  useLayoutEffect(() => {
    const height = listRef.current?.clientHeight;
    if (height && height !== viewport) setViewport(height);
  });

  // The highlight left the visible rows (arrow keys, Home, End, PageDown): scroll to it now.
  useLayoutEffect(() => {
    if (!windowed || highlighted == null || highlighted < 0 || highlighted >= count) return;
    const rowTop = highlighted * EXCLUSION_OPTION_HEIGHT;
    let next = scrollTop;
    if (rowTop < scrollTop) next = rowTop;
    else if (rowTop + EXCLUSION_OPTION_HEIGHT > scrollTop + viewport) next = rowTop + EXCLUSION_OPTION_HEIGHT - viewport;
    if (next !== scrollTop) {
      if (listRef.current) listRef.current.scrollTop = next;
      setScrollTop(next);
    }
    // Only when the highlight moves: a scroll by the wheel keeps its place.
  }, [highlighted]); // eslint-disable-line react-hooks/exhaustive-deps

  // A search shortens the list: never start the window past its end.
  const top = Math.max(0, Math.min(scrollTop, count * EXCLUSION_OPTION_HEIGHT - viewport));
  const first = windowed ? Math.max(0, Math.floor(top / EXCLUSION_OPTION_HEIGHT) - OVERSCAN) : 0;
  const last = windowed ? Math.min(count, Math.ceil((top + viewport) / EXCLUSION_OPTION_HEIGHT) + OVERSCAN) : count;
  const spacer = (rows: number, key: string) => (rows > 0 ? <li key={key} aria-hidden style={{ height: rows * EXCLUSION_OPTION_HEIGHT }} /> : null);
  return (
    <ul
      {...other}
      ref={handleRef}
      onScroll={(event) => {
        if (windowed) setScrollTop(event.currentTarget.scrollTop);
        onScroll?.(event);
      }}
    >
      {windowed && first > 0 && items[0]}
      {windowed && spacer(first - 1, 'before')}
      {windowed ? items.slice(first, last) : items}
      {windowed && spacer(count - last - 1, 'after')}
      {windowed && last < count && items[count - 1]}
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
  // The listed index of each option, read while the options are drawn, and the highlighted one.
  const indexById = useRef(new Map<string, number>());
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const list = options ?? [];
  const selected = useMemo(() => {
    if (value.length === 0) return [];
    const byId = new Map(list.map((option) => [option.id, option]));
    return value.map((id) => byId.get(id)).filter((option): option is ExclusionOption => Boolean(option));
  }, [value, list]);
  const fontSx = inFilter ? { fontSize: 13 } : undefined;

  return (
    <HighlightContext.Provider value={highlighted}>
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
      onHighlightChange={(_, option) => setHighlighted(option ? indexById.current.get(option.id) ?? null : null)}
      getOptionLabel={(option) => option.label}
      isOptionEqualToValue={(option, other) => option.id === other.id}
      ListboxComponent={WindowedListbox}
      ListboxProps={{ sx: listboxSx } as React.HTMLAttributes<HTMLElement>}
      renderOption={(props, option, { selected: checked }) => {
        const index = Number((props as unknown as Record<string, unknown>)['data-option-index']);
        if (Number.isInteger(index)) indexById.current.set(option.id, index);
        return (
          // A name cut by the row's width reads in full on hover.
          <li {...props} key={option.id} title={option.label}>
            <Checkbox size="small" checked={checked} sx={{ p: 0.5, mr: 1 }} />
            <ListItemText primary={option.label} primaryTypographyProps={{ noWrap: true, ...(inFilter ? { fontSize: 13 } : {}) }} />
          </li>
        );
      }}
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
    </HighlightContext.Provider>
  );
}
