import React from 'react';
import { Box, Button, MenuItem, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import UserSelect from '../fields/UserSelect';
import { accessLevelLabel, type DataAccessLevel } from './dataAccess';

type Props = {
  onAdd: (personId: string, access: DataAccessLevel) => void | Promise<void>;
  busy?: boolean;
};

/** The person picker of an "Access" tab: one person, read or edit, then Add. */
export default function AccessPersonAdd({ onAdd, busy = false }: Props) {
  const { t } = useTranslation(['admin', 'common']);
  const [personId, setPersonId] = React.useState<string | null>(null);
  const [access, setAccess] = React.useState<DataAccessLevel>('read');

  const add = () => {
    if (!personId) return;
    void Promise.resolve(onAdd(personId, access)).then(() => {
      setPersonId(null);
      setAccess('read');
    });
  };

  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Box sx={{ flex: '1 1 220px', minWidth: 200, maxWidth: 360 }}>
        <UserSelect
          hideLabel
          label={t('admin:dataAccess.person')}
          value={personId}
          onChange={(id) => setPersonId(id)}
          placeholder={t('admin:dataAccess.placeholders.person')}
          size="small"
        />
      </Box>
      <TextField
        select
        variant="standard"
        size="small"
        value={access}
        onChange={(event) => setAccess(event.target.value as DataAccessLevel)}
        inputProps={{ 'aria-label': t('admin:dataAccess.accessLabel', { name: t('admin:dataAccess.person') }) }}
        SelectProps={{ SelectDisplayProps: { 'aria-label': t('admin:dataAccess.accessLabel', { name: t('admin:dataAccess.person') }) } }}
        sx={{ width: 96 }}
      >
        <MenuItem value="read">{accessLevelLabel('read', t)}</MenuItem>
        <MenuItem value="edit">{accessLevelLabel('edit', t)}</MenuItem>
      </TextField>
      <Button size="small" variant="contained" disabled={!personId || busy} onClick={add}>
        {t('admin:dataAccess.accessTab.addButton')}
      </Button>
    </Stack>
  );
}
