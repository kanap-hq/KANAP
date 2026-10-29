import React from 'react';
import { Box, Button, Checkbox, CircularProgress, MenuItem, MenuList, Popover, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { LOOKUP_DEBOUNCE_MS } from '../../hooks/useLookupPicker';
import ContractLineMismatchMark, { type ContractLineMismatch } from '../finance/ContractLineMismatchMark';
import { fieldResetSx } from '../../theme/formSx';

export type RelationOption = {
  id: string;
  label: string;
  ref?: string | null;
  hint?: string | null;
  /** Present when linking this row would disagree with the record the picker belongs to. */
  mismatches?: ContractLineMismatch[];
};

type Props = {
  /** The "Add" button: the picker opens under it, aligned on its left edge. */
  anchorEl: HTMLElement;
  /** Distinguishes the searches in the query cache. */
  searchKey: string;
  /** One page of matches for the text typed (blank: the most recent rows), read on the server. */
  search: (q: string, signal?: AbortSignal) => Promise<RelationOption[]>;
  /** Rows already linked: never offered. */
  excludeIds: ReadonlySet<string>;
  placeholder: string;
  ariaLabel: string;
  onPick: (option: RelationOption) => void;
  onClose: () => void;
  /**
   * Several rows at once: a choice ticks the row instead of linking it, and a footer button links
   * the ticked rows (kept across searches). `label` words that button for the count ticked.
   * `onConfirm` saves them and resolves to an error message, or null once saved (the caller then
   * closes the picker): until it answers the picker stays open, and on an error it says so and
   * keeps the rows ticked.
   */
  multiple?: { label: (count: number) => string; onConfirm: (options: RelationOption[]) => Promise<string | null> };
};

const itemSx = { minHeight: 32, py: 0.75, fontSize: 13, color: 'kanap.text.primary' } as const;

/**
 * The "Add" picker of a Relations section, anchored to the button that opens it (the pattern of
 * `MetadataUserPicker`): a search field, then a flat list of matches read on the server as the user
 * types. One choice links the row and closes the picker (with `multiple`, choices tick rows and a
 * footer button links them). Arrow down moves into the list, Enter in the field takes the first
 * match, Escape closes.
 */
export default function RelationAddPicker({ anchorEl, searchKey, search, excludeIds, placeholder, ariaLabel, onPick, onClose, multiple }: Props) {
  const { t } = useTranslation('common');
  const [text, setText] = React.useState('');
  const [ticked, setTicked] = React.useState<Map<string, RelationOption>>(() => new Map());
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const confirm = async () => {
    if (!multiple) return;
    setSaving(true);
    setSaveError(null);
    const message = await multiple.onConfirm([...ticked.values()]);
    setSaving(false);
    if (message) setSaveError(message);
  };
  const choose = (option: RelationOption) => {
    if (!multiple) { onPick(option); return; }
    setTicked((prev) => {
      const next = new Map(prev);
      if (next.has(option.id)) next.delete(option.id);
      else next.set(option.id, option);
      return next;
    });
  };
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const q = useDebouncedValue(text.trim(), LOOKUP_DEBOUNCE_MS);
  const { data, isFetching } = useQuery({
    queryKey: ['relation-add', searchKey, q],
    queryFn: ({ signal }) => search(q, signal),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
  const options = React.useMemo(() => (data ?? []).filter((option) => !excludeIds.has(option.id)), [data, excludeIds]);
  const loading = !data && isFetching;

  const focusFirst = () => {
    const first = listRef.current?.querySelector<HTMLElement>('[role="option"]');
    first?.focus();
  };

  return (
    <Popover
      open
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { p: 1, width: 380, mt: 0.5 } } }}
    >
      <TextField
        autoFocus
        fullWidth
        size="small"
        variant="standard"
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); focusFirst(); }
          if (event.key === 'Enter' && options[0]) { event.preventDefault(); choose(options[0]); }
        }}
        inputProps={{ 'aria-label': ariaLabel, role: 'combobox', 'aria-expanded': true }}
        InputProps={{ endAdornment: isFetching ? <CircularProgress color="inherit" size={14} /> : null }}
        sx={[fieldResetSx, (theme) => ({
          mb: 0.75,
          px: 0.75,
          py: 0.375,
          borderRadius: 0.75,
          bgcolor: theme.palette.kanap.bg.composer,
          '& input': { fontSize: 13, py: 0.25 },
        })]}
      />
      <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={18} /></Box>
        ) : options.length === 0 ? (
          <Typography sx={{ px: 1, py: 1.25, fontSize: 13, color: 'kanap.text.secondary' }}>{t('filters.noResults')}</Typography>
        ) : (
          <MenuList ref={listRef} role="listbox" aria-label={ariaLabel} dense disablePadding sx={{ py: 0.25 }}>
            {options.map((option) => (
              <MenuItem key={option.id} role="option" aria-selected={multiple ? ticked.has(option.id) : false} onClick={() => choose(option)} sx={itemSx}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, width: '100%', minWidth: 0 }}>
                  {multiple && (
                    <Checkbox size="small" checked={ticked.has(option.id)} tabIndex={-1} disableRipple sx={{ p: 0, alignSelf: 'center' }} inputProps={{ 'aria-hidden': true }} />
                  )}
                  {option.ref && (
                    <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>{option.ref}</Box>
                  )}
                  <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {option.label}
                    {option.mismatches && option.mismatches.length > 0 ? <ContractLineMismatchMark mismatches={option.mismatches} /> : null}
                  </Box>
                  {option.hint && <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>{option.hint}</Box>}
                </Box>
              </MenuItem>
            ))}
          </MenuList>
        )}
      </Box>
      {multiple && saveError && (
        <Typography role="alert" sx={{ px: 1, pt: 0.75, fontSize: 12, color: 'kanap.danger' }}>{saveError}</Typography>
      )}
      {multiple && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, pt: 0.75 }}>
          {saving && <CircularProgress size={14} />}
          <Button
            variant="action-primary"
            size="small"
            disabled={ticked.size === 0 || saving}
            onClick={() => { void confirm(); }}
          >
            {multiple.label(ticked.size)}
          </Button>
        </Box>
      )}
    </Popover>
  );
}
