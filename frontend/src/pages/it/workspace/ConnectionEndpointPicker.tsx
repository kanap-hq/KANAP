import React from 'react';
import { Autocomplete, Box, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import ClusterMark from '../../../components/workspace/ClusterMark';
import { renderServerOption, type ServerOption } from '../../../components/fields/serverOptionRender';
import { drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';
import useAssetPickerOptions from './useAssetPickerOptions';

export type EndpointValue = {
  asset_id: string | null;
  entity_code: string | null;
};

type Props = {
  label: string;
  value: EndpointValue;
  onChange: (next: EndpointValue, asset?: ServerOption) => void;
  disabled?: boolean;
  initialAsset?: ServerOption | null;
};

const fieldSx = {
  '& .MuiInputBase-root': { fontSize: 13 },
  '& input': { fontSize: 13 },
} as const;

/**
 * Server vs Entity picker for a connection endpoint.
 * Mode is purely UI state (which input to render). Switching modes does NOT clear the value
 * and does NOT trigger onChange — onChange only fires when the user picks a real value.
 */
export default function ConnectionEndpointPicker({
  label,
  value,
  onChange,
  disabled = false,
  initialAsset = null,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { settings, labelFor } = useItOpsEnumOptions();
  const entities = settings?.entities || [];

  // Mode follows the value when it has data; otherwise stays at the user's last choice.
  const [mode, setMode] = React.useState<'server' | 'entity'>(
    value.entity_code ? 'entity' : 'server',
  );

  // Auto-track mode when the value gets a real selection (e.g., loaded from server).
  React.useEffect(() => {
    if (value.asset_id) setMode('server');
    else if (value.entity_code) setMode('entity');
  }, [value.asset_id, value.entity_code]);

  const { options, loading, setSearch, selected } = useAssetPickerOptions({
    enabled: mode === 'server',
    assetId: value.asset_id,
    initialAsset,
  });

  const handleAssetPick = (next: ServerOption | null) => {
    if (next) {
      onChange({ asset_id: next.id, entity_code: null }, next);
    } else {
      // explicit clear
      onChange({ asset_id: null, entity_code: null });
    }
  };

  const handleEntityPick = (code: string) => {
    if (code) {
      onChange({ asset_id: null, entity_code: code });
    } else {
      onChange({ asset_id: null, entity_code: null });
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{label}</Typography>
        <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
          <Box
            component="button"
            type="button"
            onClick={() => !disabled && setMode('server')}
            disabled={disabled}
            sx={{
              fontSize: 11,
              border: 'none',
              background: 'transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              color: mode === 'server' ? 'kanap.teal' : 'kanap.text.tertiary',
              fontWeight: mode === 'server' ? 500 : 400,
              p: 0,
              '&:disabled': { opacity: 0.5 },
            }}
          >
            {t('it:workspace.connection.server')}
          </Box>
          <Box component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>·</Box>
          <Box
            component="button"
            type="button"
            onClick={() => !disabled && setMode('entity')}
            disabled={disabled}
            sx={{
              fontSize: 11,
              border: 'none',
              background: 'transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              color: mode === 'entity' ? 'kanap.teal' : 'kanap.text.tertiary',
              fontWeight: mode === 'entity' ? 500 : 400,
              p: 0,
              '&:disabled': { opacity: 0.5 },
            }}
          >
            {t('it:workspace.connection.picker.entity')}
          </Box>
        </Box>
      </Box>
      {mode === 'server' ? (
        <Autocomplete
          size="small"
          disabled={disabled}
          options={options}
          loading={loading}
          getOptionLabel={(opt) => (opt ? `${opt.asset_reference ? `${opt.asset_reference} · ` : ''}${opt.name}` : '')}
          isOptionEqualToValue={(opt, val) => opt.id === val.id}
          value={selected}
          onChange={(_, val) => handleAssetPick(val)}
          onInputChange={(_, val, reason) => {
            if (reason !== 'reset') setSearch(val);
          }}
          renderOption={(props, option) => renderServerOption(props, option, {
            showReference: true,
            noMembers: t('common:selects.noMembers'),
          })}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="standard"
              placeholder={value.entity_code ? t('it:workspace.connection.picker.entityPlaceholder', { code: labelFor('entity', value.entity_code) }) : t('it:workspace.connection.picker.serverPlaceholder')}
              sx={fieldSx}
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <>
                    {selected?.is_cluster ? <ClusterMark /> : null}
                    {params.InputProps.startAdornment}
                  </>
                ),
              }}
            />
          )}
        />
      ) : (
        <TextField
          select
          size="small"
          variant="standard"
          disabled={disabled || entities.length === 0}
          value={value.entity_code || ''}
          onChange={(e) => handleEntityPick(e.target.value)}
          sx={drawerSelectSx}
          SelectProps={{ displayEmpty: true }}
          helperText={
            entities.length === 0
              ? t('it:workspace.connection.picker.noEntities')
              : value.asset_id
                ? t('it:workspace.connection.picker.replaceServer')
                : undefined
          }
          FormHelperTextProps={{ sx: { fontSize: 11, mt: 0.25, ml: 0 } }}
        >
          <MenuItem value="" sx={drawerMenuItemSx}>
            <Box component="span" sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>—</Box>
          </MenuItem>
          {entities.map((ent: any) => (
            <MenuItem key={ent.code} value={ent.code} sx={drawerMenuItemSx}>
              {ent.label || ent.code}
            </MenuItem>
          ))}
        </TextField>
      )}
    </Box>
  );
}
