import React, { createContext, useContext, useImperativeHandle } from 'react';
import { Box, Button, FormControlLabel, Radio, RadioGroup } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useGridFilter } from 'ag-grid-react';
import type { IFloatingFilter, IFloatingFilterParams } from 'ag-grid-community';
import type { StatusScope } from '../ServerDataGrid';

/**
 * The list's Show scope (All / Enabled / Disabled), shared by the toolbar and the status column:
 * one value, so the column filter never says "All" while the list shows the disabled rows only.
 */
export type StatusScopeState = {
  scope: StatusScope;
  scopes: StatusScope[];
  setScope: (next: StatusScope) => void;
};

export const StatusScopeContext = createContext<StatusScopeState | null>(null);

/**
 * Whether a status column can show the Show scope as its filter: each value its filter offers is a
 * scope of the list. The users list also filters on statuses the scope does not cover ("pending
 * access"), so its column keeps its own filter.
 */
export function columnFollowsStatusScope(filterParams: unknown, scopes: readonly StatusScope[]): boolean {
  const values = (filterParams as { values?: unknown } | undefined)?.values;
  if (!Array.isArray(values) || values.length === 0) return false;
  return values.every((option) => {
    const value = option && typeof option === 'object' ? (option as { value?: unknown }).value : option;
    return scopes.includes(value as StatusScope);
  });
}

/**
 * The scope a status set filter model stands for (a filter written in an address before the
 * column followed the scope), or null when it stands for none of the list's scopes.
 */
export function scopeOfStatusModel(model: unknown, scopes: readonly StatusScope[]): StatusScope | null {
  const values = (model as { values?: unknown } | null | undefined)?.values;
  if (!Array.isArray(values)) return null;
  if (values.length === 1 && scopes.includes(values[0] as StatusScope)) return values[0] as StatusScope;
  const concrete = scopes.filter((scope) => scope !== 'all');
  if (scopes.includes('all') && concrete.every((scope) => values.includes(scope))) return 'all';
  return null;
}

/** The column's filter popup: the Show scope as radio buttons. The grid never holds a model for it. */
export function StatusScopeColumnFilter() {
  const { t } = useTranslation('common');
  const state = useContext(StatusScopeContext);
  useGridFilter({ doesFilterPass: () => true });
  if (!state) return null;
  return (
    <Box sx={{ px: 1.5, py: 1 }}>
      <RadioGroup value={state.scope} onChange={(event) => state.setScope(event.target.value as StatusScope)}>
        {state.scopes.map((scope) => (
          <FormControlLabel
            key={scope}
            value={scope}
            control={<Radio size="small" />}
            label={t(`common:labels.${scope}`)}
            sx={{ '& .MuiFormControlLabel-label': { fontSize: 13 } }}
          />
        ))}
      </RadioGroup>
    </Box>
  );
}

/** The box under the status header: the Show scope in words; a click opens the column's filter. */
export const StatusScopeFloatingFilter = React.forwardRef<IFloatingFilter, IFloatingFilterParams>((props, ref) => {
  const { t } = useTranslation('common');
  const state = useContext(StatusScopeContext);
  useImperativeHandle(ref, () => ({ onParentModelChanged() {} }));
  return (
    <Button
      size="small"
      variant="text"
      onClick={() => props.showParentFilter?.()}
      sx={{
        textTransform: 'none',
        minWidth: 0,
        px: 0.5,
        justifyContent: 'flex-start',
        width: '100%',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}
    >
      {state ? t(`common:labels.${state.scope}`) : ''}
    </Button>
  );
});

StatusScopeFloatingFilter.displayName = 'StatusScopeFloatingFilter';
