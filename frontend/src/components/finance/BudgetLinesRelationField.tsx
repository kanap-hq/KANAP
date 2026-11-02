import React from 'react';
import { Autocomplete, Box, Chip, CircularProgress, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import ContractLineMismatchMark, { type ContractLineMismatch } from './ContractLineMismatchMark';
import { budgetTypeChipSx } from '../../pages/budget/budgetTypeChipSx';
import { drawerAutocompleteListboxSx, drawerFieldValueSx } from '../../theme/formSx';
import { budgetLineLabel } from './budgetLineLabel';

export type BudgetLineNature = 'opex' | 'capex';

/** A budget line linked to an application, an asset, a project or a request. */
export type LinkedBudgetLine = {
  id: string;
  nature: BudgetLineNature;
  item_number?: number | null;
  product_name: string;
  /** Set when the line would disagree with the contract the picker belongs to. */
  mismatches?: ContractLineMismatch[];
};

type LinkedRow = { id: string; item_number?: number | null; product_name?: string | null; description?: string | null };

/**
 * One list of the lines of both natures, from the two per-nature lists the
 * relation routes return (a CAPEX line's title may come back as `description`).
 */
export function mergeLinkedBudgetLines(opex: LinkedRow[] = [], capex: LinkedRow[] = []): LinkedBudgetLine[] {
  const toLine = (nature: BudgetLineNature) => (row: LinkedRow): LinkedBudgetLine => ({
    id: row.id,
    nature,
    item_number: row.item_number ?? null,
    product_name: row.product_name ?? row.description ?? '',
  });
  return [...opex.map(toLine('opex')), ...capex.map(toLine('capex'))]
    .sort((a, b) => a.product_name.localeCompare(b.product_name));
}

/** The ids of the lines of one nature: each relation route replaces the links of its own nature only. */
export function budgetLineIdsOf(lines: LinkedBudgetLine[], nature: BudgetLineNature): string[] {
  return lines.filter((line) => line.nature === nature).map((line) => line.id);
}

export function sameBudgetLineIds(a: LinkedBudgetLine[], b: LinkedBudgetLine[]): boolean {
  return JSON.stringify(a.map((line) => line.id).sort()) === JSON.stringify(b.map((line) => line.id).sort());
}

const labelOf = (line: LinkedBudgetLine) => budgetLineLabel(line) || line.id;

const relationTagSx = {
  height: 22,
  borderRadius: '4px',
  fontSize: 12,
  '& .MuiChip-label': { px: '7px' },
} as const;

type Props = {
  value: LinkedBudgetLine[];
  onChange: (next: LinkedBudgetLine[]) => void;
  disabled?: boolean;
  sx?: SxProps<Theme>;
  /** The contract these lines would be linked to. Candidates then show a mismatch mark. */
  contractId?: string;
};

/**
 * A single picker over the budget lines of both natures (the unified budget):
 * the server searches title and reference (`BL-n`), each option carries its
 * type as a neutral badge.
 */
export default function BudgetLinesRelationField({ value, onChange, disabled = false, sx, contractId }: Props) {
  const { t } = useTranslation(['common', 'ops']);
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  const { data: options = [], isFetching } = useQuery({
    queryKey: ['budget-lines-relation-options', search, contractId ?? null],
    queryFn: async ({ signal }) => {
      const res = await api.get<{ items: Array<LinkedRow & { nature: BudgetLineNature }> }>('/budget-lines/summary', {
        params: { page: 1, limit: 50, status: 'enabled', sort: 'product_name:ASC', q: search || undefined },
        signal,
      });
      const lines = (res.data?.items || []).map((row): LinkedBudgetLine => ({
        id: row.id,
        nature: row.nature,
        item_number: row.item_number ?? null,
        product_name: row.product_name ?? '',
      }));
      if (!contractId || lines.length === 0) return lines;
      const consistency = await api.get<{ items: Array<{ id: string; mismatches: ContractLineMismatch[] }> }>(
        `/contracts/${encodeURIComponent(contractId)}/budget-line-consistency`,
        { params: { ids: lines.map((line) => line.id).join(',') }, signal },
      );
      const byId = new Map((consistency.data?.items ?? []).map((item) => [item.id, item.mismatches]));
      return lines.map((line) => {
        const mismatches = byId.get(line.id);
        return mismatches && mismatches.length > 0 ? { ...line, mismatches } : line;
      });
    },
    enabled: open && !disabled,
    staleTime: 30_000,
  });


  return (
    <Autocomplete
      multiple
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      options={options}
      value={value}
      loading={isFetching}
      filterOptions={(items) => items}
      filterSelectedOptions
      inputValue={input}
      onInputChange={(_, next, reason) => {
        if (reason === 'input' || reason === 'clear') setInput(next);
        if (reason === 'reset') setInput('');
      }}
      getOptionLabel={labelOf}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      onChange={(_, next) => onChange(next)}
      renderOption={(props, option) => {
        const { key, ...optionProps } = props;
        return (
          <li key={key} {...optionProps}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
              <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                {labelOf(option)}
                {option.mismatches && option.mismatches.length > 0 ? <ContractLineMismatchMark mismatches={option.mismatches} /> : null}
              </Box>
              <Chip size="small" label={t(`ops:budget.${option.nature}`)} sx={budgetTypeChipSx} />
            </Box>
          </li>
        );
      }}
      renderTags={(selected, getTagProps) => selected.map((option, index) => (
        <Chip {...getTagProps({ index })} key={option.id} label={labelOf(option)} sx={relationTagSx} />
      ))}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={t('common:selects.searchBudgetLines')}
          variant="standard"
          inputProps={{ ...params.inputProps, 'aria-label': t('common:selects.budgetLines') }}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {isFetching ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
          sx={drawerFieldValueSx}
        />
      )}
      noOptionsText={t('common:selects.noBudgetLinesFound')}
      loadingText={t('common:selects.loading')}
      ListboxProps={{ sx: drawerAutocompleteListboxSx }}
      disabled={disabled}
      fullWidth
      sx={sx}
    />
  );
}
