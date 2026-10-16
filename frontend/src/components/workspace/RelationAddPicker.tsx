import React from 'react';
import { Box, CircularProgress, MenuItem, MenuList, Popover, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { LOOKUP_DEBOUNCE_MS } from '../../hooks/useLookupPicker';
import { fieldResetSx } from '../../theme/formSx';

export type RelationOption = { id: string; label: string; ref?: string | null; hint?: string | null };

type Props = {
  /** The "Add" button: the picker opens under it, aligned on its right edge. */
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
};

const itemSx = { minHeight: 32, py: 0.75, fontSize: 13, color: 'kanap.text.primary' } as const;

/**
 * The "Add" picker of a Relations section, anchored to the button that opens it (the pattern of
 * `MetadataUserPicker`): a search field, then a flat list of matches read on the server as the user
 * types. One choice links the row and closes the picker. Arrow down moves into the list, Enter in
 * the field takes the first match, Escape closes.
 */
export default function RelationAddPicker({ anchorEl, searchKey, search, excludeIds, placeholder, ariaLabel, onPick, onClose }: Props) {
  const { t } = useTranslation('common');
  const [text, setText] = React.useState('');
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
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
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
          if (event.key === 'Enter' && options[0]) { event.preventDefault(); onPick(options[0]); }
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
              <MenuItem key={option.id} role="option" aria-selected={false} onClick={() => onPick(option)} sx={itemSx}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, width: '100%', minWidth: 0 }}>
                  {option.ref && (
                    <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>{option.ref}</Box>
                  )}
                  <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.label}</Box>
                  {option.hint && <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>{option.hint}</Box>}
                </Box>
              </MenuItem>
            ))}
          </MenuList>
        )}
      </Box>
    </Popover>
  );
}
