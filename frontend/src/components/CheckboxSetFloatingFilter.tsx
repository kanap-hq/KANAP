import React, { useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Button, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import type { IFloatingFilter, IFloatingFilterParams } from 'ag-grid-community';

type SetFilterModel = {
  filterType: 'set';
  /** 'exclude': `values` are the values unticked from "All" (lists with exclude mode). */
  mode?: 'include' | 'exclude';
  values: Array<string | null>;
};

type FloatingFilterProps = IFloatingFilterParams<SetFilterModel>;

const CheckboxSetFloatingFilter = React.forwardRef<IFloatingFilter, FloatingFilterProps>((props, ref) => {
  const { t } = useTranslation('common');
  const [selectedCount, setSelectedCount] = useState(0);
  const [excludedCount, setExcludedCount] = useState(0);
  const [isNone, setIsNone] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const colId = props.column?.getColId?.();

  const syncFromModel = useCallback((model: SetFilterModel | null | undefined) => {
    if (!model) {
      setSelectedCount(0);
      setExcludedCount(0);
      setIsNone(false);
      setIsActive(false);
      return;
    }
    const count = model.values?.length ?? 0;
    if (model.mode === 'exclude') {
      // "All but N": every value except the N unticked ones.
      setSelectedCount(0);
      setExcludedCount(count);
      setIsNone(false);
      setIsActive(count > 0);
      return;
    }
    setExcludedCount(0);
    setSelectedCount(count);
    setIsNone(count === 0);
    setIsActive(true);
  }, []);

  useImperativeHandle(ref, () => ({
    onParentModelChanged(model: SetFilterModel | null) {
      syncFromModel(model);
    },
  }));

  const label = useMemo(() => {
    if (isNone) return t('labels.none');
    if (excludedCount) return t('filters.allExcept', { count: excludedCount });
    if (!selectedCount) return t('labels.all');
    return t('filters.selectedCount', { count: selectedCount });
  }, [selectedCount, excludedCount, isNone, t]);

  const handleClear = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const api = props.api;
    if (!api || !colId) return;
    const current = api.getFilterModel?.() ?? {};
    if (Object.prototype.hasOwnProperty.call(current, colId)) {
      const next = { ...current };
      delete next[colId];
      api.setFilterModel?.(next);
    }
  }, [props.api, colId]);

  useEffect(() => {
    const api = props.api;
    if (!api || !colId) return;
    const handleFilterChanged = () => {
      const model = api.getFilterModel?.() ?? {};
      syncFromModel(model[colId]);
    };
    handleFilterChanged();
    api.addEventListener?.('filterChanged', handleFilterChanged);
    return () => {
      api.removeEventListener?.('filterChanged', handleFilterChanged);
    };
  }, [props.api, colId, syncFromModel]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', overflow: 'hidden' }}>
      <Button
        size="small"
        variant="text"
        onClick={() => props.showParentFilter?.()}
        sx={{
          textTransform: 'none',
          minWidth: 0,
          px: 0.5,
          justifyContent: 'flex-start',
          flex: '1 1 auto',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </Button>
      {isActive && (
        <IconButton
          size="small"
          onClick={handleClear}
          aria-label={t('filters.clearFilter')}
          sx={{ p: 0.25, flex: '0 0 auto' }}
        >
          <CloseIcon fontSize="inherit" />
        </IconButton>
      )}
    </div>
  );
});

CheckboxSetFloatingFilter.displayName = 'CheckboxSetFloatingFilter';

export default CheckboxSetFloatingFilter;
