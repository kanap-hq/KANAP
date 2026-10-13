import { Autocomplete, Chip, CircularProgress, TextField } from '@mui/material';
import { useLookupPicker, type LookupScope } from '../../hooks/useLookupPicker';
import { drawerAutocompleteListboxSx, drawerFieldValueSx } from '../../theme/formSx';

export type NamedRelation = { id: string; name: string };

const relationTagSx = { borderRadius: '6px', height: 24, '& .MuiChip-label': { px: '8px', fontSize: 12 } } as const;
const relationAutocompleteSx = [drawerFieldValueSx, { width: '100%', maxWidth: 420 }] as const;

/**
 * One relation picker of a Relations tab: chips of the linked rows (a click opens the row), and a
 * server search of the others as the user types, through the list or lookup route of the rows
 * (their access rules apply).
 */
export default function RelationLookupPicker({
  endpoint, scope, href, placeholder, value, onChange, disabled, ariaLabel,
}: {
  endpoint: string;
  scope?: LookupScope;
  href: (row: NamedRelation) => string;
  placeholder: string;
  value: NamedRelation[];
  onChange: (next: NamedRelation[]) => void;
  disabled: boolean;
  ariaLabel?: string;
}) {
  const picker = useLookupPicker<NamedRelation>({
    endpoint,
    scope,
    value: value.map((v) => v.id),
    given: value,
    // The search pages hold whole rows: the picker keeps id and name.
  });
  return (
    <Autocomplete
      multiple
      {...picker.autocomplete}
      options={picker.options}
      value={picker.selected}
      getOptionLabel={(o) => picker.label(o, (row) => row.name ?? '')}
      onChange={(_, v) => {
        const next = (v as NamedRelation[]).map((o) => ({ id: o.id, name: o.name }));
        picker.remember(next);
        onChange(next);
      }}
      renderOption={(props, option) => (<li {...props} key={option.id}>{option.name}</li>)}
      renderTags={(vals, getTagProps) => vals.map((option, index) => (
        <Chip
          {...getTagProps({ index })}
          key={option.id}
          label={picker.label(option, (row) => row.name ?? '')}
          sx={relationTagSx}
          onClick={() => window.open(href(option), '_self')}
          clickable
        />
      ))}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder}
          variant="standard"
          inputProps={{ ...params.inputProps, ...(ariaLabel ? { 'aria-label': ariaLabel } : {}) }}
          InputProps={{
            ...params.InputProps,
            endAdornment: (<>{picker.loading ? <CircularProgress color="inherit" size={16} /> : null}{params.InputProps.endAdornment}</>),
          }}
          sx={drawerFieldValueSx}
        />
      )}
      ListboxProps={{ sx: drawerAutocompleteListboxSx }}
      filterSelectedOptions
      disabled={disabled}
      sx={relationAutocompleteSx}
    />
  );
}
