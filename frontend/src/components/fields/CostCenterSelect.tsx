import React from 'react';
import { Autocomplete, Box, CircularProgress, Link as MLink, Paper, TextField } from '@mui/material';
import type { PaperProps } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { useCostCenterTree } from '../../hooks/useCostCenterTree';
import { costCenterLabel, type CostCenterNode } from '../../services/costCenters';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

/**
 * Which nodes can be picked:
 * - `cost_centers`: enabled cost centers (a line's assignment); groups are shown for navigation only.
 *   A disabled cost center stays pickable when it is the current value.
 * - `all`: every node, groups and disabled nodes included (report filters).
 * - `groups`: groups only, disabled ones included (a node's parent).
 */
export type CostCenterSelectable = 'cost_centers' | 'all' | 'groups';

export type CostCenterSelectProps = {
  label?: string;
  value: string | null | undefined;
  onChange: (id: string | null, node: CostCenterNode | null) => void;
  selectable?: CostCenterSelectable;
  /** Nodes left out of the list (e.g. a node's own subtree when picking its parent). */
  excludeIds?: ReadonlySet<string> | string[];
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  placeholder?: string;
  required?: boolean;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
  disableClearable?: boolean;
};

export const COST_CENTERS_PAGE = '/master-data/cost-centers';

function matches(node: CostCenterNode, needle: string): boolean {
  return (
    node.code.toLowerCase().includes(needle)
    || node.name.toLowerCase().includes(needle)
    || node.path.toLowerCase().includes(needle)
    // The list column shows the label, so a pasted "IT-200 · Applic" must match too.
    || costCenterLabel(node).toLowerCase().includes(needle)
  );
}

/** One line for a tenant that has nothing to pick yet, with a way to the page for people who can create. */
function NoCostCenterLine() {
  const { t } = useTranslation('common');
  const { hasLevel } = useAuth();
  return (
    <Box component="span">
      {t('selects.noCostCenterYet')}
      {hasLevel('cost_centers', 'member') && (
        <>
          {' '}
          <MLink component={RouterLink} to={COST_CENTERS_PAGE} underline="hover" sx={{ fontSize: 'inherit' }}>
            {t('selects.createCostCenter')}
          </MLink>
        </>
      )}
    </Box>
  );
}

type FooterPaperProps = PaperProps & { footer?: React.ReactNode };

// Module level so the popper does not remount on every render.
function FooterPaper({ footer, children, ...rest }: FooterPaperProps) {
  return (
    <Paper {...rest}>
      {children}
      {footer ? (
        <Box
          onMouseDown={(event) => event.preventDefault()}
          sx={(theme) => ({
            px: '14px',
            py: '8px',
            fontSize: 12,
            color: theme.palette.kanap.text.tertiary,
            borderTop: `1px solid ${theme.palette.kanap.border.soft}`,
          })}
        >
          {footer}
        </Box>
      ) : null}
    </Paper>
  );
}

const listboxSx = {
  ...drawerAutocompleteListboxSx,
  // Rows that cannot be picked stay readable: groups are the tree's headings.
  '& .MuiAutocomplete-option[aria-disabled="true"]': { opacity: 1 },
} as const;

export default function CostCenterSelect({
  label: labelProp,
  value,
  onChange,
  selectable = 'cost_centers',
  excludeIds,
  disabled,
  error,
  helperText,
  placeholder,
  required,
  hideLabel = false,
  textFieldSx,
  disableClearable = false,
}: CostCenterSelectProps) {
  const { t } = useTranslation('common');
  const label = labelProp ?? t('selects.costCenter');
  const naked = hideLabel || label === '';
  const tree = useCostCenterTree();

  const excluded = React.useMemo(() => {
    if (!excludeIds) return null;
    return excludeIds instanceof Set ? excludeIds : new Set(excludeIds as string[]);
  }, [excludeIds]);

  const options = React.useMemo(() => {
    const list = excluded ? tree.nodes.filter((node) => !excluded.has(node.id)) : tree.nodes;
    // Parent picking only needs the groups; their tree order and depth stay meaningful.
    return selectable === 'groups' ? list.filter((node) => node.kind === 'group') : list;
  }, [excluded, selectable, tree.nodes]);

  const isPickable = React.useCallback(
    (node: CostCenterNode) => {
      if (selectable === 'all') return true;
      if (selectable === 'groups') return node.kind === 'group';
      if (node.kind !== 'cost_center') return false;
      return node.status === 'enabled' || node.id === value;
    },
    [selectable, value],
  );

  const selected = (value && tree.byId.get(value)) || null;
  const hasPickable = React.useMemo(() => options.some(isPickable), [isPickable, options]);
  const loading = !tree.ready;
  const footer = tree.ready && !tree.isError && options.length > 0 && !hasPickable && selectable === 'cost_centers'
    ? <NoCostCenterLine />
    : null;

  const control = (
    <Autocomplete<CostCenterNode, false, boolean, false>
      options={options}
      value={selected}
      onChange={(_, next) => {
        // Disabled options are not clickable in a browser; the guard keeps any other path honest.
        if (next && !isPickable(next)) return;
        onChange(next?.id ?? null, next ?? null);
      }}
      getOptionLabel={(option) => costCenterLabel(option)}
      isOptionEqualToValue={(option, current) => option.id === current.id}
      getOptionDisabled={(option) => !isPickable(option)}
      filterOptions={(list, { inputValue }) => {
        const needle = inputValue.trim().toLowerCase();
        if (!needle) return list;
        // Keep each match's ancestors so the result still reads as a tree.
        const keep = new Set<string>();
        for (const node of list) {
          if (!matches(node, needle)) continue;
          for (const id of node.path_ids) keep.add(id);
          keep.add(node.id);
        }
        return list.filter((node) => keep.has(node.id));
      }}
      renderOption={(props, option) => {
        const muted = !isPickable(option);
        return (
          <li {...props} key={option.id}>
            <Box
              data-testid={`cost-center-option-${option.id}`}
              data-depth={option.depth}
              sx={(theme) => ({
                pl: option.depth * 2,
                display: 'flex',
                alignItems: 'baseline',
                gap: '6px',
                minWidth: 0,
                color: muted ? theme.palette.kanap.text.tertiary : theme.palette.kanap.text.primary,
              })}
            >
              <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Box
                  component="span"
                  sx={(theme) => ({
                    fontFamily: MONO_FONT_FAMILY,
                    fontSize: 12,
                    fontVariantNumeric: 'tabular-nums',
                    color: muted ? theme.palette.kanap.text.tertiary : theme.palette.kanap.text.secondary,
                  })}
                >
                  {option.code}
                </Box>
                {` · ${option.name}`}
              </Box>
              {option.status === 'disabled' && (
                <Box component="span" sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary, flexShrink: 0 })}>
                  {t('statuses.disabled')}
                </Box>
              )}
            </Box>
          </li>
        );
      }}
      disableClearable={disableClearable}
      blurOnSelect
      disabled={disabled}
      loading={loading}
      loadingText={t('selects.loading')}
      noOptionsText={
        tree.isError
          ? t('selects.costCentersLoadFailed')
          : tree.hasAny ? t('selects.noCostCentersFound') : <NoCostCenterLine />
      }
      ListboxProps={{ sx: listboxSx } as React.HTMLAttributes<HTMLUListElement>}
      PaperComponent={FooterPaper}
      slotProps={{ paper: { footer } as FooterPaperProps }}
      renderInput={(params) => (
        <TextField
          {...params}
          required={required}
          variant="standard"
          sx={textFieldSx}
          placeholder={placeholder ?? (naked ? t('selects.notSet') : undefined)}
          error={error}
          helperText={helperText}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading && value ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      fullWidth
    />
  );

  if (naked) return control;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {control}
    </Box>
  );
}
