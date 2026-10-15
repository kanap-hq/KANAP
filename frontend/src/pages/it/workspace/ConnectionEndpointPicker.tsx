import React from 'react';
import { Autocomplete, Box, MenuItem, TextField, Typography } from '@mui/material';
import api from '../../../api';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';

export type EndpointValue = {
  asset_id: string | null;
  entity_code: string | null;
};

type AssetOption = { id: string; name: string; asset_reference?: string | null };

type Props = {
  label: string;
  value: EndpointValue;
  onChange: (next: EndpointValue) => void;
  disabled?: boolean;
  initialAssetName?: string | null;
  initialAssetReference?: string | null;
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
  initialAssetName,
  initialAssetReference,
}: Props) {
  const { settings } = useItOpsEnumOptions();
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

  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<AssetOption[]>(() =>
    value.asset_id && initialAssetName
      ? [{ id: value.asset_id, name: initialAssetName, asset_reference: initialAssetReference || null }]
      : [],
  );
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (mode !== 'server') return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<{ items: AssetOption[] }>('/assets', {
          params: { q: search || undefined, limit: 50, sort: 'name:ASC' },
        });
        if (!cancelled) setOptions(res.data.items || []);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, mode]);

  // Ensure the selected asset is always in the options pool (even before search returns).
  React.useEffect(() => {
    if (!value.asset_id) return;
    if (options.some((o) => o.id === value.asset_id)) return;
    if (initialAssetName) {
      setOptions((prev) =>
        prev.some((o) => o.id === value.asset_id)
          ? prev
          : [{ id: value.asset_id!, name: initialAssetName, asset_reference: initialAssetReference || null }, ...prev],
      );
    }
  }, [value.asset_id, initialAssetName, initialAssetReference, options]);

  const selectedOption = React.useMemo(
    () => (value.asset_id ? options.find((o) => o.id === value.asset_id) || null : null),
    [options, value.asset_id],
  );

  const handleAssetPick = (next: AssetOption | null) => {
    if (next) {
      onChange({ asset_id: next.id, entity_code: null });
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
            Server
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
            Entity
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
          value={selectedOption}
          onChange={(_, val) => handleAssetPick(val)}
          onInputChange={(_, val, reason) => {
            if (reason !== 'reset') setSearch(val);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="standard"
              placeholder={value.entity_code ? (entities.find((ent: any) => ent.code === value.entity_code)?.label || value.entity_code) : 'e.g., AST-12 or hostname'}
              sx={fieldSx}
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
              ? 'No entities configured (configure them in IT settings)'
              : value.asset_id
                ? 'Picking an entity will replace the selected server'
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
