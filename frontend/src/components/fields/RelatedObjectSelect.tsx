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
  onChangeId: (id: string | null, name: string | null) => void;
  disabled?: boolean;
  size?: 'small' | 'medium';
  hideLabel?: boolean;
}

interface RelatedOption {
  id: string;
  name: string;
}

const STANDALONE_VALUE = '__standalone__';

const TYPE_OPTIONS = [
  { label: 'Standalone', value: STANDALONE_VALUE },
  { label: 'Project', value: 'project' },
  { label: 'Budget (OPEX)', value: 'spend_item' },
  { label: 'Contract', value: 'contract' },
  { label: 'CAPEX', value: 'capex_item' },
  { label: 'Incident', value: 'incident' },
];

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

  // Fetch items based on selected type. `inputValue` is only updated on actual
  // typing (`reason === 'input'`): Autocomplete also fires `reset` whenever the
  // selected label is written into the field, and feeding that label back as `q`
  // made incident options disappear (title vs `INC-N · title`) in a refetch loop.
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['related-object-search', relationType, inputValue],
    queryFn: async (): Promise<RelatedOption[]> => {
      if (!relationType) return [];

      const params = { limit: 50, q: inputValue || undefined };

      switch (relationType) {
        case 'project': {
          const res = await api.get<{ items: Array<{ id: string; name: string }> }>(
            '/portfolio/projects',
            { params }
          );
          return (res.data?.items || []).map((p) => ({ id: p.id, name: p.name }));
        }
        case 'spend_item':
        case 'capex_item': {
          const nature = relationType === 'spend_item' ? 'opex' : 'capex';
          const res = await api.get<{ items: Array<BudgetLineLabel & { id: string }> }>(
            '/budget-lines/summary',
            { params: { ...params, filters: JSON.stringify({ nature: { filterType: 'set', values: [nature] } }) } }
          );
          return (res.data?.items || []).map((line) => ({ id: line.id, name: budgetLineLabel(line) || '' }));
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
    const newType = value === STANDALONE_VALUE || value === '' ? null : (value as RelatedObjectType);
    // onChangeType already passes id: null, name: null to clear the selection
    // Do NOT call onChangeId here - it would use stale task.related_object_type from closure
    onChangeType(newType);
    setInputValue('');
  };

  const handleItemChange = (_: any, option: RelatedOption | null) => {
    onChangeId(option?.id || null, option?.name || null);
  };

  const itemLabel = TYPE_OPTIONS.find((o) => o.value === relationType)?.label || 'Item';

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
        {!hideLabel && <FieldLabel>Related To</FieldLabel>}
        <EnumAutocomplete
          label=""
          hideLabel={hideLabel}
          textFieldSx={undefined}
          value={relationType ?? STANDALONE_VALUE}
          onChange={handleTypeChange}
          options={TYPE_OPTIONS}
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
              placeholder={hideLabel ? t('selects.notSet') : 'Search...'}
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
