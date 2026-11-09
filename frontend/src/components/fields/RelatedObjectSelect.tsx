import React from 'react';
import { Autocomplete, TextField, CircularProgress, Stack, Box, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { budgetLineLabel, type BudgetLineLabel } from '../finance/budgetLineLabel';
import EnumAutocomplete from './EnumAutocomplete';
import { FieldLabel } from '../design';

export type RelatedObjectType = 'project' | 'spend_item' | 'contract' | 'capex_item' | 'incident' | null;

interface RelatedObjectSelectProps {
  relationType: RelatedObjectType;
  relationId: string | null;
  relationName?: string | null;
  onChangeType: (type: RelatedObjectType) => void;
  /** `type`: the object's type, which for a budget line follows the nature of the line picked. */
  onChangeId: (id: string | null, name: string | null, type: RelatedObjectType) => void;
  disabled?: boolean;
  size?: 'small' | 'medium';
  hideLabel?: boolean;
}

interface RelatedOption {
  id: string;
  name: string;
  type?: RelatedObjectType;
}

const STANDALONE_VALUE = '__standalone__';
// A task of a budget line keeps the type of the line's nature (`spend_item` OPEX, `capex_item`
// CAPEX). The picker offers one "Budget" choice, searches the lines of both natures and takes the
// type from the line picked; until then the task holds `spend_item`.
const BUDGET_VALUE = 'budget';

const TYPE_OPTIONS = [
  { labelKey: 'standalone', value: STANDALONE_VALUE },
  { labelKey: 'project', value: 'project' },
  { labelKey: 'budgetLine', value: BUDGET_VALUE },
  { labelKey: 'contract', value: 'contract' },
  { labelKey: 'incident', value: 'incident' },
];

function typeValue(type: RelatedObjectType): string {
  if (type === null) return STANDALONE_VALUE;
  return type === 'spend_item' || type === 'capex_item' ? BUDGET_VALUE : type;
}

export default function RelatedObjectSelect({
  relationType,
  relationId,
  relationName = null,
  onChangeType,
  onChangeId,
  disabled = false,
  size = 'small',
  hideLabel = false,
}: RelatedObjectSelectProps) {
  const { t } = useTranslation('common');
  const [inputValue, setInputValue] = React.useState('');
  const selectedType = typeValue(relationType);

  // Fetch items based on selected type. `inputValue` is only updated on actual
  // typing (`reason === 'input'`): Autocomplete also fires `reset` whenever the
  // selected label is written into the field, and feeding that label back as `q`
  // made incident options disappear (title vs `INC-N · title`) in a refetch loop.
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['related-object-search', selectedType, inputValue],
    queryFn: async (): Promise<RelatedOption[]> => {
      if (!relationType) return [];

      const params = { limit: 50, q: inputValue || undefined };

      switch (selectedType) {
        case 'project': {
          const res = await api.get<{ items: Array<{ id: string; name: string }> }>(
            '/portfolio/projects',
            { params }
          );
          return (res.data?.items || []).map((p) => ({ id: p.id, name: p.name }));
        }
        case BUDGET_VALUE: {
          const res = await api.get<{ items: Array<BudgetLineLabel & { id: string; nature: 'opex' | 'capex' }> }>(
            '/budget-lines/summary',
            { params }
          );
          return (res.data?.items || []).map((line) => ({
            id: line.id,
            name: budgetLineLabel(line) || '',
            type: line.nature === 'capex' ? 'capex_item' : 'spend_item',
          }));
        }
        case 'contract': {
          const res = await api.get<{ items: Array<{ id: string; name: string }> }>(
            '/contracts', { params }
          );
          return (res.data?.items || []).map((contract) => ({ id: contract.id, name: contract.name }));
        }
        case 'incident': {
          const res = await api.get<{ items: Array<{ id: string; item_number: number; title: string }> }>(
            '/incidents',
            { params: { ...params, limit: 20 } }
          );
          return (res.data?.items || []).map((i) => ({ id: i.id, name: `INC-${i.item_number} · ${i.title}` }));
        }
        default:
          return [];
      }
    },
    enabled: !!relationType,
  });

  // Find selected item from items list. Always keep the current value in the
  // options so Autocomplete does not drop it when a typed search omits it.
  const selectedItem = React.useMemo(() => {
    if (!relationId) return null;
    const match = items.find((i) => i.id === relationId);
    if (match) return match;
    // No name yet (the list is still loading): show nothing rather than a
    // blank option row with a clear button; the name arrives with the task.
    return relationName ? { id: relationId, name: relationName } : null;
  }, [relationId, relationName, items]);

  const options = React.useMemo(() => {
    if (!selectedItem) return items;
    if (items.some((item) => item.id === selectedItem.id)) return items;
    return [selectedItem, ...items];
  }, [items, selectedItem]);

  const handleTypeChange = (value: string) => {
    const newType = value === STANDALONE_VALUE || value === ''
      ? null
      : value === BUDGET_VALUE ? 'spend_item' : (value as RelatedObjectType);
    // onChangeType already passes id: null, name: null to clear the selection
    // Do NOT call onChangeId here - it would use stale task.related_object_type from closure
    onChangeType(newType);
    setInputValue('');
  };

  const handleItemChange = (_: any, option: RelatedOption | null) => {
    onChangeId(option?.id || null, option?.name || null, option?.type ?? relationType);
  };

  const typeOptions = React.useMemo(
    () => TYPE_OPTIONS.map((option) => ({ value: option.value, label: t(`relatedObject.types.${option.labelKey}`) })),
    [t],
  );
  const itemLabel = typeOptions.find((o) => o.value === selectedType)?.label || t('relatedObject.item');

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
        {!hideLabel && <FieldLabel>{t('labels.relatedTo')}</FieldLabel>}
        <EnumAutocomplete
          label=""
          hideLabel={hideLabel}
          textFieldSx={undefined}
          value={selectedType}
          onChange={handleTypeChange}
          options={typeOptions}
          size={size}
          disabled={disabled}
        />
      </Box>

      {relationType && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
          {!hideLabel && <FieldLabel>{itemLabel}</FieldLabel>}
          <Autocomplete
          options={options}
          value={selectedItem}
          onChange={handleItemChange}
          onInputChange={(_, val, reason) => {
            if (reason === 'input' || reason === 'clear') setInputValue(val);
          }}
          getOptionLabel={(option) => option?.name || ''}
          isOptionEqualToValue={(option, value) => option?.id === value?.id}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <Box>
                <Typography variant="body2">{option.name}</Typography>
              </Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={hideLabel ? t('selects.notSet') : t('filters.search')}
              size={size}
              variant="standard"
              sx={undefined}
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {isLoading ? <CircularProgress color="inherit" size={20} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
          disabled={disabled}
          loading={isLoading}
          fullWidth
          size={size}
          />
        </Box>
      )}
    </Stack>
  );
}
