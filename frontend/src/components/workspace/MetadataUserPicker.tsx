import React from 'react';
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  MenuItem,
  Popover,
  TextField,
  Typography,
} from '@mui/material';
import { fieldResetSx } from '../../theme/formSx';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { narrowToText, useLookupHydration, useLookupSearch } from '../../hooks/useLookupPicker';
import { useOwnerSuggestions } from '../../hooks/useOwnerSuggestions';
import { MoreResultsHint } from '../fields/LookupListPaper';
import { formatUserOption, USERS_LOOKUP_ENDPOINT, useMeOption, withMeFirst } from '../fields/userLookup';
import { taskDetailAvatarSizes, taskDetailTypography, metaItemSx, metaLabelSx } from '../../pages/tasks/theme/taskDetailTokens';
import { formatUserName, getInitials } from '../../utils/userDisplay';

export type MetadataUserOption = {
  id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  status?: string | null;
};

type MetadataUserPickerProps = {
  value: string | null | undefined;
  displayName?: string | null;
  placeholder: string;
  searchPlaceholder?: string;
  label?: React.ReactNode;
  disabled?: boolean;
  allowClear?: boolean;
  showAvatar?: boolean;
  onChange: (userId: string | null) => void;
  sx?: SxProps<Theme>;
  /**
   * Propose the people who read this cost centre first while nothing is typed, under their own
   * header and above a divider. The rest of the lookup follows, without duplicates; a text typed
   * searches as before. Absent or without a centre: the plain user lookup. `lineRef` is the line
   * shown in edit mode, so a limited owner reads a centre outside its nodes.
   */
  suggestedFirst?: { costCenterId: string | null; lineRef?: string | null } | null;
};

export function formatMetadataUserName(user: MetadataUserOption | null | undefined): string | null {
  return formatUserName(user);
}

const NO_KNOWN_USERS: ReadonlyMap<string, MetadataUserOption> = new Map();

function normalizeDisplayName(value: string | null | undefined): string | null {
  const name = String(value || '').trim();
  if (!name || name.includes('@')) return null;
  return name;
}

export default function MetadataUserPicker({
  value,
  displayName,
  placeholder,
  searchPlaceholder,
  label,
  disabled = false,
  allowClear = true,
  showAvatar = true,
  onChange,
  sx,
  suggestedFirst,
}: MetadataUserPickerProps) {
  const { t } = useTranslation('common');
  const { profile } = useAuth();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [searchText, setSearch] = React.useState('');
  const me = useMeOption();
  const [localSelectedUser, setLocalSelectedUser] = React.useState<MetadataUserOption | null>(null);
  const selectedUserId = value || null;
  // People picked here are lookup rows: their label is the email when the name is shared.
  const localSelectedName = localSelectedUser?.id === selectedUserId
    ? formatUserOption(localSelectedUser) || null
    : null;

  const normalizedDisplayName = normalizeDisplayName(displayName);
  const needSelectedFetch = !!selectedUserId && !normalizedDisplayName && !localSelectedName;

  // People searched as the user types, once the popover is open (names only, server side).
  const search = useLookupSearch<MetadataUserOption>({ endpoint: USERS_LOOKUP_ENDPOINT, open: !!anchorEl, text: searchText });
  // The cost centre group is read when the popover opens, and re-read when the centre or line changes.
  const suggested = useOwnerSuggestions(suggestedFirst?.costCenterId ?? null, {
    lineRef: suggestedFirst?.lineRef ?? null,
    enabled: !!anchorEl,
  });
  const { items: selectedUsers, isLoading: isLoadingSelected, unavailable } = useLookupHydration<MetadataUserOption>({
    endpoint: USERS_LOOKUP_ENDPOINT,
    ids: selectedUserId ? [selectedUserId] : [],
    known: NO_KNOWN_USERS,
    enabled: needSelectedFetch,
  });
  const selectedUser = selectedUsers.find((user) => user.id === selectedUserId) ?? null;

  const searching = search.searchedText !== '';
  // A typed text searches exactly as before; the group only leads an empty popover.
  const showSuggestions = searchText.trim() === '' && !searching && suggested.length > 0;
  const suggestedIds = React.useMemo(() => new Set(suggested.map((user) => user.id)), [suggested]);
  // While the next page loads, the people listed are the ones that still match the text typed.
  const filteredUsers = React.useMemo(
    () => narrowToText(
      showSuggestions ? search.items : withMeFirst(search.items, me, searching),
      search.pendingText,
      formatUserOption,
    ),
    [search.items, me, searching, search.pendingText, showSuggestions],
  );
  const otherUsers = React.useMemo(
    () => (showSuggestions ? filteredUsers.filter((user) => !suggestedIds.has(user.id)) : filteredUsers),
    [filteredUsers, showSuggestions, suggestedIds],
  );
  const shownUsers = showSuggestions ? [...suggested, ...otherUsers] : otherUsers;

  const selectedName = localSelectedName || normalizedDisplayName || formatUserOption(selectedUser) || null;
  // A chosen person whose name cannot be read says so instead of looking unset.
  const selectedUnavailable = !selectedName && !!selectedUserId && unavailable.has(selectedUserId);
  const displayedName = selectedName || (selectedUnavailable ? t('selects.valueUnavailable') : placeholder);
  // The previous matches stay listed while the next ones load; the spinner only shows before the
  // first page, and not over the suggested group, which can arrive on its own.
  const loading = (search.isFetching && search.items.length === 0 && !showSuggestions) || isLoadingSelected;

  const close = React.useCallback(() => {
    setAnchorEl(null);
    setSearch('');
  }, []);

  const handleSelect = React.useCallback((user: MetadataUserOption | null) => {
    setLocalSelectedUser(user);
    onChange(user?.id || null);
    close();
  }, [close, onChange]);

  const renderUser = (user: MetadataUserOption, dividerAfter: boolean) => {
    const name = formatUserOption(user) || t('labels.unknown');
    const isCurrentUser = user.id === profile?.id;
    return (
      <React.Fragment key={user.id}>
        <MenuItem
          selected={user.id === selectedUserId}
          onClick={() => handleSelect(user)}
          sx={{ minHeight: 32, py: 0.75, fontSize: 13, color: 'kanap.text.primary' }}
        >
          {name}
          {isCurrentUser ? ` ${t('selects.meSuffix')}` : ''}
        </MenuItem>
        {dividerAfter && isCurrentUser && (
          <Divider sx={(theme) => ({ my: 0.25, borderColor: theme.palette.kanap.border.soft })} />
        )}
      </React.Fragment>
    );
  };

  React.useEffect(() => {
    if (!selectedUserId) setLocalSelectedUser(null);
  }, [selectedUserId]);

  return (
    <>
      <Box
        component="button"
        type="button"
        disabled={disabled}
        onClick={disabled ? undefined : (event) => {
          setSearch('');
          setAnchorEl(event.currentTarget);
        }}
        sx={[
          (theme) => ({
            ...metaItemSx,
            border: 0,
            p: 0,
            bgcolor: 'transparent',
            color: theme.palette.kanap.text.primary,
            fontFamily: 'inherit',
            cursor: disabled ? 'default' : 'pointer',
            minWidth: 0,
          }),
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
      >
        {label && (
          <Box component="span" sx={(theme) => ({ ...metaLabelSx, color: theme.palette.kanap.text.tertiary })}>
            {label}
          </Box>
        )}
        {showAvatar && (
          <Avatar
            sx={(theme) => ({
              width: taskDetailAvatarSizes.metadata,
              height: taskDetailAvatarSizes.metadata,
              fontSize: 9,
              fontWeight: 500,
              bgcolor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
            })}
          >
            {getInitials(selectedName)}
          </Avatar>
        )}
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayedName}
        </Box>
      </Box>

      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              p: 1,
              width: 280,
              overflow: 'visible',
            },
          },
        }}
      >
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder={searchPlaceholder || t('selects.user')}
          value={searchText}
          onChange={(event) => setSearch(event.target.value)}
          variant="standard"
          sx={[fieldResetSx, (theme) => ({
            mb: 0.75,
            px: 0.75,
            py: 0.375,
            borderRadius: 0.75,
            bgcolor: theme.palette.kanap.bg.composer,
            '& input': { fontSize: 13, py: 0.25 },
          })]}
        />
        <Box role="listbox" sx={{ maxHeight: 260, overflowY: 'auto', py: 0.25 }}>
          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={18} />
            </Box>
          )}
          {!loading && showSuggestions && (
            <>
              <Typography
                sx={{
                  px: 1,
                  pt: 0.75,
                  pb: 0.25,
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: 1.5,
                  color: 'kanap.text.tertiary',
                }}
              >
                {t('selects.costCenterAccess')}
              </Typography>
              {suggested.map((user) => renderUser(user, false))}
              <Divider sx={(theme) => ({ my: 0.25, borderColor: theme.palette.kanap.border.soft })} />
            </>
          )}
          {!loading && otherUsers.map((user, index) => renderUser(
            user,
            !showSuggestions && index === 0 && user.id === profile?.id && !searching && otherUsers.length > 1,
          ))}
          {!loading && shownUsers.length === 0 && (
            <Typography sx={{ px: 1, py: 1.25, fontSize: 13, color: 'kanap.text.secondary' }}>
              {t('selects.noUsersFound')}
            </Typography>
          )}
          {!loading && search.hasMore && <MoreResultsHint />}
        </Box>
        {allowClear && selectedUserId && (
          <Box sx={(theme) => ({ mt: 0.5, pt: 0.5, borderTop: `1px solid ${theme.palette.kanap.border.soft}` })}>
            <Button variant="action" size="small" onClick={() => handleSelect(null)}>
              {t('buttons.clear')}
            </Button>
          </Box>
        )}
      </Popover>
    </>
  );
}
