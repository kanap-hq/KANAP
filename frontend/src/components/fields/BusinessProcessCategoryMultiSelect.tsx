import React from 'react';
import { Autocomplete, Box, Chip, CircularProgress, Stack, TextField, Button } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { FieldLabel, useKanapDialogs } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

type BusinessProcessCategory = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order?: number;
};

type Props = {
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  helperText?: React.ReactNode;
  error?: boolean;
  disabled?: boolean;
  onManageCategoriesClick?: () => void;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
};

export default function BusinessProcessCategoryMultiSelect({
  value,
  onChange,
  label: labelProp,
  helperText,
  error,
  disabled,
  onManageCategoriesClick,
  hideLabel = false,
  textFieldSx,
}: Props) {
  const { t } = useTranslation('common');
  const dialogs = useKanapDialogs();
  const label = labelProp ?? t('selects.categories');
  const naked = hideLabel || label === '';
  const queryClient = useQueryClient();

  // The full list on purpose: categories are a short admin-managed list in a manual order
  // (sort_order), created from this picker; a server search would lose that order.
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['business-process-categories', 'all'],
    queryFn: async () => {
      const res = await api.get<{ items: BusinessProcessCategory[] }>('/business-process-categories', {
        params: { limit: 1000, sort: 'sort_order:ASC', includeInactive: true },
      });
      const items = res.data?.items || [];
      return items.slice().sort((a, b) => {
        const sa = a.sort_order ?? 100;
        const sb = b.sort_order ?? 100;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name);
      });
    },
  });

  const options = data || [];

  const selectedOptions = React.useMemo(() => {
    if (!options.length) return [] as BusinessProcessCategory[];
    return options.filter((opt) => value.includes(opt.id));
  }, [options, value]);

  const handleCreateCategory = async () => {
    const name = await dialogs.prompt({
      title: 'New category name',
      required: true,
    });
    const trimmed = (name ?? '').trim();
    if (!trimmed) return;
    try {
      const res = await api.post<BusinessProcessCategory>('/business-process-categories', { name: trimmed });
      const created = res.data as BusinessProcessCategory;
      queryClient.setQueryData<BusinessProcessCategory[] | undefined>(
        ['business-process-categories', 'all'],
        (old) => {
          const base = old ? [...old] : [];
          if (!base.some((c) => c.id === created.id)) base.push(created);
          return base.sort((a, b) => {
            const sa = a.sort_order ?? 100;
            const sb = b.sort_order ?? 100;
            if (sa !== sb) return sa - sb;
            return a.name.localeCompare(b.name);
          });
        },
      );
      const nextIds = Array.from(new Set([...(value || []), created.id]));
      onChange(nextIds);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to create category', e);
    }
  };

  const control = (
    <Stack spacing={0.5} alignItems="flex-start">
      <Autocomplete<BusinessProcessCategory, true, false, false>
        multiple
        options={options}
        value={selectedOptions}
        disabled={disabled || isLoading}
        onChange={(_, newValue) => {
          const ids = newValue.map((opt) => opt.id);
          onChange(ids);
        }}
        getOptionLabel={(option) => option.name}
        ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
        renderTags={(tagValue, getTagProps) =>
          tagValue.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option.id}
              label={option.is_active ? option.name : `${option.name} ${t('selects.inactiveSuffix')}`}
              size="small"
            />
          ))
        }
        renderInput={(params) => (
          <TextField
            {...params}
            variant="standard"
            sx={textFieldSx}
            placeholder={t('selects.selectCategories')}
            helperText={helperText}
            error={error}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {(isLoading || isFetching) ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
        loading={isLoading || isFetching}
        noOptionsText={isLoading ? t('selects.loadingEllipsis') : t('selects.noCategoriesFound')}
        fullWidth
      />
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          onClick={handleCreateCategory}
          disabled={disabled}
        >
          {t('selects.newCategory')}
        </Button>
        {onManageCategoriesClick && (
          <Button
            size="small"
            onClick={onManageCategoriesClick}
            disabled={disabled}
          >
            {t('selects.editCategories')}
          </Button>
        )}
      </Stack>
    </Stack>
  );

  if (naked || !label) return control;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
      <FieldLabel>{label}</FieldLabel>
      {control}
    </Box>
  );
}
