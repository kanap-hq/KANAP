import React from 'react';
import { Autocomplete, Chip, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ClusterMark from '../../../components/workspace/ClusterMark';
import { renderServerOption, type ServerOption } from '../../../components/fields/serverOptionRender';
import useAssetPickerOptions from './useAssetPickerOptions';

type Props = {
  value: ServerOption[];
  onChange: (next: ServerOption[]) => void;
  disabled?: boolean;
  placeholder?: string;
};

const optionLabel = (option: ServerOption) => (
  `${option.asset_reference ? `${option.asset_reference} · ` : ''}${option.name}`
);

/** The multi-server list of a connection: a search over the assets, with a mark on each cluster. */
export default function ConnectionServersPicker({ value, onChange, disabled = false, placeholder }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { options, loading, setSearch } = useAssetPickerOptions({ enabled: !disabled });

  // The chosen servers stay on screen while the search asks the server for other names.
  const shownOptions = React.useMemo(() => {
    const map = new Map(options.map((option) => [option.id, option]));
    value.forEach((option) => {
      if (!map.has(option.id)) map.set(option.id, option);
    });
    return Array.from(map.values());
  }, [options, value]);

  return (
    <Autocomplete
      multiple
      size="small"
      disabled={disabled}
      options={shownOptions}
      loading={loading}
      value={value}
      getOptionLabel={optionLabel}
      isOptionEqualToValue={(option, current) => option.id === current.id}
      onChange={(_, next) => onChange(next as ServerOption[])}
      onInputChange={(_, next, reason) => {
        if (reason !== 'reset') setSearch(next);
      }}
      renderOption={(props, option) => renderServerOption(props, option, {
        showReference: true,
        noMembers: t('common:selects.noMembers'),
      })}
      renderTags={(chosen, getTagProps) => chosen.map((option, index) => {
        const { key, ...tagProps } = getTagProps({ index });
        return (
          <Chip
            key={key}
            {...tagProps}
            size="small"
            label={optionLabel(option)}
            icon={option.is_cluster ? <ClusterMark /> : undefined}
          />
        );
      })}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          placeholder={placeholder}
          sx={{ '& input': { fontSize: 13, padding: '4px 0 !important' } }}
        />
      )}
    />
  );
}
