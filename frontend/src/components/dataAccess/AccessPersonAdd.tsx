import React from 'react';
import { Box, Button, MenuItem, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import UserSelect from '../fields/UserSelect';
import { formatUserOption, type UserOption } from '../fields/userLookup';
import { accessLevelLabel, type DataAccessLevel } from './dataAccess';

type Props = {
  /** False when the confirmation was cancelled: the picked person and access stay. */
  onAdd: (
    personId: string,
    access: DataAccessLevel,
    personName: string,
  ) => void | boolean | Promise<void | boolean>;
  busy?: boolean;
};

/** The person picker of an "Access" tab: one person, read or edit, then Add. */
export default function AccessPersonAdd({ onAdd, busy = false }: Props) {
  const { t } = useTranslation(['admin', 'common']);
  const [person, setPerson] = React.useState<UserOption | null>(null);
  const [access, setAccess] = React.useState<DataAccessLevel>('read');

  const add = () => {
    if (!person) return;
    // Same label as the picker: the lookup sends the email when another account shares the name.
    void Promise.resolve(onAdd(person.id, access, formatUserOption(person))).then((saved) => {
      if (saved === false) return;
      setPerson(null);
      setAccess('read');
    });
  };

  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Box sx={{ flex: '1 1 220px', minWidth: 200, maxWidth: 360 }}>
        <UserSelect
          hideLabel
          label={t('admin:dataAccess.person')}
          value={person?.id ?? null}
          onChange={(_id, user) => setPerson(user)}
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
      <Button size="small" variant="contained" disabled={!person || busy} onClick={add}>
        {t('admin:dataAccess.accessTab.addButton')}
      </Button>
    </Stack>
  );
}
