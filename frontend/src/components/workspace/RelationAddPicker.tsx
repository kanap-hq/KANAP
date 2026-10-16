import React from 'react';
import { Autocomplete, Box, CircularProgress, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { LOOKUP_DEBOUNCE_MS } from '../../hooks/useLookupPicker';
import { drawerAutocompleteListboxSx, drawerFieldValueSx } from '../../theme/formSx';

export type RelationOption = { id: string; label: string; ref?: string | null; hint?: string | null };

type Props = {
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

/**
 * The "Add" picker of a Relations section: it opens on the click that shows it, searches on the
 * server as the user types (nothing is loaded before), and one choice links the row and closes it.
 */
export default function RelationAddPicker({ searchKey, search, excludeIds, placeholder, ariaLabel, onPick, onClose }: Props) {
  const [text, setText] = React.useState('');
  const q = useDebouncedValue(text.trim(), LOOKUP_DEBOUNCE_MS);
  const { data = [], isFetching } = useQuery({
    queryKey: ['relation-add', searchKey, q],
    queryFn: ({ signal }) => search(q, signal),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
  const options = React.useMemo(() => data.filter((option) => !excludeIds.has(option.id)), [data, excludeIds]);
  return (
    <Box sx={{ maxWidth: 420, mb: 1 }}>
      <Autocomplete<RelationOption>
        open
        openOnFocus
        options={options}
        value={null}
        loading={isFetching}
        filterOptions={(items) => items}
        getOptionLabel={(option) => (option.ref ? `${option.ref} · ${option.label}` : option.label)}
        isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
        inputValue={text}
        onInputChange={(_, next, reason) => { if (reason === 'input') setText(next); }}
        onChange={(_, option) => { if (option) onPick(option); }}
        onClose={(_, reason) => { if (reason !== 'toggleInput') onClose(); }}
        renderOption={(props, option) => {
          const { key, ...optionProps } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
          return (
            <li key={key} {...optionProps}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, width: '100%', minWidth: 0 }}>
                {option.ref && (
                  <Box component="span" sx={{ fontFamily: 'inherit', fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>{option.ref}</Box>
                )}
                <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{option.label}</Box>
                {option.hint && <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>{option.hint}</Box>}
              </Box>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            autoFocus
            placeholder={placeholder}
            variant="standard"
            inputProps={{ ...params.inputProps, 'aria-label': ariaLabel }}
            InputProps={{
              ...params.InputProps,
              endAdornment: (<>{isFetching ? <CircularProgress color="inherit" size={16} /> : null}{params.InputProps.endAdornment}</>),
            }}
            sx={drawerFieldValueSx}
          />
        )}
        ListboxProps={{ sx: drawerAutocompleteListboxSx }}
        sx={[drawerFieldValueSx, { width: '100%' }]}
      />
    </Box>
  );
}
