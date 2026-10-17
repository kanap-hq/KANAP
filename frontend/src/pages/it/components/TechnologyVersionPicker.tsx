import React from 'react';
import { Box, CircularProgress, MenuItem, MenuList, Popover, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fieldResetSx } from '../../../theme/formSx';

export type VersionOption = { id: string; label: string };

/**
 * What a link names as its version, in the body of the link routes: an existing version, a label
 * the server resolves without case and creates when missing, or none ("version unknown").
 */
export type VersionChoice = { technology_version_id: string | null } | { version_label: string };

type Props = {
  anchorEl: HTMLElement;
  /** The technology's versions, newest first; undefined while they load. */
  versions: VersionOption[] | undefined;
  /** The version the link names now (`null`: unknown), marked in the list; absent when adding. */
  current?: string | null;
  onPick: (choice: VersionChoice) => void;
  onClose: () => void;
};

const itemSx = { minHeight: 32, py: 0.75, fontSize: 13, color: 'kanap.text.primary' } as const;

/**
 * The version of a technology link, chosen in one step under the control that opens it: "version
 * unknown", one of the existing versions (filtered as the user types), or the label typed, which
 * the server creates. Enter takes the version whose label matches, else creates the label typed.
 */
export default function TechnologyVersionPicker({ anchorEl, versions, current, onPick, onClose }: Props) {
  const { t } = useTranslation('it');
  const [text, setText] = React.useState('');
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const typed = text.trim();
  const needle = typed.toLowerCase();
  const matches = (versions ?? []).filter((version) => !needle || version.label.toLowerCase().includes(needle));
  const exact = (versions ?? []).find((version) => version.label.toLowerCase() === needle);
  const label = t('workspace.technology.versionPicker.search');

  const submit = () => {
    if (exact) onPick({ technology_version_id: exact.id });
    else if (typed) onPick({ version_label: typed });
  };

  return (
    <Popover
      open
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { p: 1, width: 300, mt: 0.5 } } }}
    >
      <TextField
        autoFocus
        fullWidth
        size="small"
        variant="standard"
        placeholder={t('workspace.technology.versionPicker.placeholder')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            listRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
          }
          if (event.key === 'Enter') { event.preventDefault(); submit(); }
        }}
        inputProps={{ 'aria-label': label, role: 'combobox', 'aria-expanded': true }}
        sx={[fieldResetSx, (theme) => ({
          mb: 0.75,
          px: 0.75,
          py: 0.375,
          borderRadius: 0.75,
          bgcolor: theme.palette.kanap.bg.composer,
          '& input': { fontSize: 13, py: 0.25 },
        })]}
      />
      {!versions ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={18} /></Box>
      ) : (
        <MenuList ref={listRef} role="listbox" aria-label={label} dense disablePadding sx={{ py: 0.25, maxHeight: 300, overflowY: 'auto' }}>
          {!typed && (
            <MenuItem role="option" aria-selected={current === null} selected={current === null} onClick={() => onPick({ technology_version_id: null })} sx={{ ...itemSx, color: 'kanap.text.secondary' }}>
              {t('workspace.technology.versionPicker.unknown')}
            </MenuItem>
          )}
          {matches.map((version) => (
            <MenuItem
              key={version.id}
              role="option"
              aria-selected={current === version.id}
              selected={current === version.id}
              onClick={() => onPick({ technology_version_id: version.id })}
              sx={itemSx}
            >
              {version.label}
            </MenuItem>
          ))}
          {typed && !exact && (
            <MenuItem role="option" aria-selected={false} onClick={() => onPick({ version_label: typed })} sx={itemSx}>
              {t('workspace.technology.versionPicker.create', { label: typed })}
            </MenuItem>
          )}
        </MenuList>
      )}
    </Popover>
  );
}
