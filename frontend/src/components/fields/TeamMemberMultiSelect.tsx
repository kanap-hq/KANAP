import { Fragment, useCallback, useMemo, useState } from 'react';
import {
  Autocomplete, CircularProgress, Divider, IconButton, Stack, TextField, Typography,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { formatUserOption, USERS_LOOKUP_ENDPOINT, useMeOption, withMeFirst, type UserOption } from './userLookup';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

interface TeamMember {
  user_id: string;
  user_display_name?: string;
  user_email?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

type User = UserOption;

interface TeamMemberMultiSelectProps {
  label: string;
  value: TeamMember[];
  onChange: (userIds: string[]) => Promise<void>;
  disabled?: boolean;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
}

export default function TeamMemberMultiSelect({
  label,
  value,
  onChange,
  disabled,
  hideLabel = false,
  textFieldSx,
}: TeamMemberMultiSelectProps) {
  const { t } = useTranslation('common');
  const [loading, setLoading] = useState(false);
  const me = useMeOption();
  const myId = me?.id ?? null;

  // People searched as the user types; the ones already in the team are not offered.
  const picker = useLookupPicker<User>({ endpoint: USERS_LOOKUP_ENDPOINT, value: [] });
  const selectedUserIds = useMemo(() => new Set(value.map((m) => m.user_id)), [value]);
  const availableUsers = useMemo(
    () => withMeFirst(picker.options, me, picker.searching, (u) => selectedUserIds.has(u.id))
      .filter((u) => !selectedUserIds.has(u.id)),
    [picker.options, me, picker.searching, selectedUserIds],
  );

  // Get display name for a team member
  const getDisplayName = useCallback((m: TeamMember) => {
    if (m.user_display_name) return m.user_display_name;
    if (m.display_name) return m.display_name;
    if (m.first_name || m.last_name) return `${m.first_name || ''} ${m.last_name || ''}`.trim();
    return m.user_email || m.email || m.user_id;
  }, []);

  const handleAdd = useCallback(async (user: User | null) => {
    if (!user) {
      return;
    }
    setLoading(true);
    try {
      const existingIds = (value || []).map((m) => m.user_id).filter(Boolean);
      const newUserIds = [...existingIds, user.id];
      await onChange(newUserIds);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  }, [value, onChange]);

  const handleRemove = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const newUserIds = (value || [])
        .filter((m) => m.user_id !== userId)
        .map((m) => m.user_id)
        .filter(Boolean);
      await onChange(newUserIds);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  }, [value, onChange]);

  const isLoading = picker.loading || loading;

  return (
    <Stack spacing={0.75}>
      {!hideLabel && <FieldLabel>{label}</FieldLabel>}

      {value.length > 0 ? (
        <Stack spacing={0.5}>
          {value.map((m) => (
            <Stack
              key={m.user_id}
              direction="row"
              alignItems="center"
              spacing={1}
              sx={(theme) => ({
                p: 0.5,
                bgcolor: 'action.hover',
                borderRadius: '4px',
                '&:hover': { bgcolor: theme.palette.kanap.bg.hover },
              })}
            >
              <Typography sx={(theme) => ({ flex: 1, fontSize: 13, color: theme.palette.kanap.text.primary })}>
                {getDisplayName(m)}
              </Typography>
              {!disabled && (
                <IconButton
                  size="small"
                  onClick={() => handleRemove(m.user_id)}
                  disabled={loading}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          ))}
        </Stack>
      ) : !hideLabel ? (
        <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary })}>
          {t('selects.noTeamMembers')}
        </Typography>
      ) : null}

      <Autocomplete
        {...picker.autocomplete}
        options={availableUsers}
        getOptionLabel={(option) => formatUserOption(option)}
        value={null}
        onChange={(_, v) => {
          void handleAdd(v);
        }}
        renderOption={(props, option) => {
          const { key, ...other } = props as any;
          return (
            <Fragment key={option.id}>
              <li {...other}>
                <Typography variant="body2" fontWeight={500}>
                  {formatUserOption(option)}{option.id === myId ? ` ${t('selects.meSuffix')}` : ''}
                </Typography>
              </li>
              {option.id === myId && !picker.searching && <Divider />}
            </Fragment>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={t('selects.addTeamMember')}
            size="small"
            variant={hideLabel ? 'standard' : undefined}
            sx={textFieldSx}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {isLoading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
        disabled={disabled || loading}
        ListboxProps={hideLabel ? { sx: drawerAutocompleteListboxSx } : undefined}
        size="small"
      />
    </Stack>
  );
}
