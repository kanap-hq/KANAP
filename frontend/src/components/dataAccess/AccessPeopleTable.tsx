import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';
import { accessLevelLabel, type DataAccessLevel } from './dataAccess';

export type AccessPersonRow = {
  key: string;
  name: string;
  access: DataAccessLevel;
  /** The access may be removed here (a direct node). */
  onRemove?: () => void;
  /** Where the access comes from, when it is inherited or partial. */
  via?: React.ReactNode;
};

type Props = {
  rows: AccessPersonRow[];
  busyPersonId?: string | null;
};

const tableSx = {
  width: '100%',
  borderCollapse: 'collapse',
  '& th': {
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 500,
    color: 'kanap.text.tertiary',
    py: 0.5,
    borderBottom: '1px solid',
    borderColor: 'kanap.border.default',
  },
  '& td': {
    fontSize: 13,
    py: 0.75,
    borderBottom: '1px solid',
    borderColor: 'kanap.border.soft',
    verticalAlign: 'middle',
  },
  '& tr:last-of-type td': { borderBottom: 0 },
} as const;

/** The people of one access section, dense: name, access, where it comes from, remove. */
export default function AccessPeopleTable({ rows, busyPersonId = null }: Props) {
  const { t } = useTranslation(['admin', 'common']);
  const showVia = rows.some((row) => row.via !== undefined);
  const showRemove = rows.some((row) => row.onRemove);

  if (rows.length === 0) {
    return (
      <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('common:labels.none')}</Typography>
    );
  }

  return (
    <Box component="table" sx={tableSx}>
      <thead>
        <tr>
          <th>{t('admin:dataAccess.columns.person')}</th>
          <th>{t('admin:dataAccess.columns.access')}</th>
          {showVia && <th>{t('admin:dataAccess.columns.via')}</th>}
          {showRemove && <th aria-label={t('admin:dataAccess.columns.actions')} />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const busy = busyPersonId === row.key;
          return (
            <tr key={row.key}>
              <td>{row.name}</td>
              <td>{accessLevelLabel(row.access, t)}</td>
              {showVia && <td>{row.via ?? null}</td>}
              {showRemove && (
                <td align="right">
                  {row.onRemove && (
                    <IconButton
                      size="small"
                      disabled={busy}
                      aria-label={t('admin:dataAccess.accessTab.remove', { name: row.name })}
                      onClick={row.onRemove}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </Box>
  );
}
