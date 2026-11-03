import React from 'react';
import { Autocomplete, Box, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useBusinessProcessTree, type BusinessProcessNode } from '../../hooks/useBusinessProcessTree';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

export type BusinessProcessParentSelectProps = {
  label: string;
  value: string | null | undefined;
  /** The current parent as the detail names it: shown before the tree loads. */
  selectedOption?: { id: string; name: string } | null;
  /** The process being edited: it and its sub-processes cannot become its parent. */
  processId?: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  textFieldSx?: SxProps<Theme>;
};

function knownAsNode(known: { id: string; name: string }): BusinessProcessNode {
  return { ...known, parent_id: null, process_type: null, status: 'enabled', disabled_at: null, depth: 0, path: known.name, path_ids: [known.id] };
}

/**
 * The parent of a process, picked in the tree (indented by depth, searched on the path). The
 * process and its subtree are left out; disabled processes stay pickable, as for cost centers.
 */
export default function BusinessProcessParentSelect({
  label,
  value,
  selectedOption,
  processId,
  onChange,
  placeholder,
  disabled,
  textFieldSx,
}: BusinessProcessParentSelectProps) {
  const { t } = useTranslation(['master-data', 'common']);
  // The tree loads when the list is first opened, or when the value cannot be named otherwise.
  const [opened, setOpened] = React.useState(false);
  const known = value && selectedOption?.id === value ? selectedOption : null;
  const tree = useBusinessProcessTree({ enabled: opened || (!!value && !known) });

  const options = React.useMemo(() => {
    const excluded = processId ? tree.descendantIds(processId) : null;
    return excluded?.size ? tree.nodes.filter((node) => !excluded.has(node.id)) : tree.nodes;
  }, [processId, tree]);

  const candidate = known ? knownAsNode(known) : (value && tree.byId.get(value)) || null;
  // One object per value, so the Autocomplete does not reset typed text when the tree arrives.
  const candidateKey = candidate ? `${candidate.id}\u0000${candidate.name}` : '';
  const selected = React.useMemo(() => candidate, [candidateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Autocomplete<BusinessProcessNode, false, false, false>
      options={options}
      value={selected}
      onOpen={() => setOpened(true)}
      onFocus={() => setOpened(true)}
      onChange={(_, next) => onChange(next?.id ?? null)}
      getOptionLabel={(option) => option.name}
      isOptionEqualToValue={(option, current) => option.id === current.id}
      filterOptions={(list, { inputValue }) => {
        const needle = inputValue.trim().toLowerCase();
        if (!needle) return list;
        // Keep each match's ancestors so the result still reads as a tree.
        const keep = new Set<string>();
        for (const node of list) {
          if (!node.path.toLowerCase().includes(needle)) continue;
          for (const id of node.path_ids) keep.add(id);
        }
        return list.filter((node) => keep.has(node.id));
      }}
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          <Box
            data-testid={`business-process-option-${option.id}`}
            sx={{ pl: option.depth * 2, display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0 }}
          >
            <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {option.name}
            </Box>
            {option.status === 'disabled' && (
              <Box component="span" sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary, flexShrink: 0 })}>
                {t('common:statuses.disabled')}
              </Box>
            )}
          </Box>
        </li>
      )}
      blurOnSelect
      disabled={disabled}
      loading={opened && !tree.ready}
      loadingText={t('common:selects.loading')}
      noOptionsText={t('businessProcesses.placeholders.noProcessFound')}
      ListboxProps={{ sx: drawerAutocompleteListboxSx } as React.HTMLAttributes<HTMLUListElement>}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          sx={textFieldSx}
          inputProps={{ ...params.inputProps, 'aria-label': label }}
          placeholder={placeholder}
        />
      )}
      fullWidth
    />
  );
}
