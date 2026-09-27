import React, { useCallback, useImperativeHandle, useRef, useState } from 'react';
import CloseIcon from '@mui/icons-material/Close';
import { IconButton } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type {
  IFloatingFilter,
  IFloatingFilterParams,
  TextFilterModel,
} from 'ag-grid-community';

export type ClearableColumnFloatingFilterRef = IFloatingFilter;

type FloatingFilterProps = IFloatingFilterParams<TextFilterModel>;

const ClearableColumnFloatingFilter = React.forwardRef<ClearableColumnFloatingFilterRef, FloatingFilterProps>((props, ref) => {
  const { t } = useTranslation('common');
  const columnDef = props.column.getColDef();
  const filterParams = columnDef.filterParams as any;

  const computeDefaultTextType = () => {
    const option = filterParams?.defaultOption;
    return typeof option === 'string' ? option : 'contains';
  };

  const defaultTextTypeRef = useRef<string>(computeDefaultTextType());
  const defaultTextType = defaultTextTypeRef.current;
  const activeTextTypeRef = useRef<string>(defaultTextType);

  const [value, setValue] = useState('');
  const [hasValue, setHasValue] = useState(false);

  const applyTextFilterModel = useCallback((raw: string) => {
    const trimmed = raw?.trim?.() ?? '';
    const api = props.api;
    const colId = props.column.getColId();
    if (!api || !colId) return;

    const current: any = api.getFilterModel?.() ?? {};
    const nextModel: any = { ...current };

    if (trimmed.length === 0) {
      if (Object.prototype.hasOwnProperty.call(nextModel, colId)) {
        delete nextModel[colId];
      }
    } else {
      const type = activeTextTypeRef.current || defaultTextType;
      nextModel[colId] = {
        filter: trimmed,
        type,
        filterType: 'text',
      } as TextFilterModel & { filterType: 'text' };
    }

    if (typeof api.setFilterModel === 'function') {
      api.setFilterModel(nextModel);
    }
  }, [props.api, props.column, defaultTextType]);

  useImperativeHandle(ref, () => ({
    onParentModelChanged(model: TextFilterModel | null) {
      if (!model) {
        activeTextTypeRef.current = defaultTextType;
        setValue('');
        setHasValue(false);
        return;
      }

      const nextValue = model.filter ?? '';
      activeTextTypeRef.current = typeof model.type === 'string' ? model.type : defaultTextType;
      if (nextValue !== '') {
        setValue(String(nextValue));
        setHasValue(true);
      } else {
        setValue('');
        setHasValue(false);
      }
    },
  }));

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value ?? '';
    setValue(next);
    const active = next.trim().length > 0;
    setHasValue(active);
    applyTextFilterModel(next);
  }, [applyTextFilterModel]);

  const handleClear = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!hasValue) return;
    setValue('');
    setHasValue(false);
    activeTextTypeRef.current = defaultTextType;
    applyTextFilterModel('');
  }, [applyTextFilterModel, defaultTextType, hasValue]);

  const inputWrapperStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
  };

  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', minHeight: 30 }}>
      <div className="ag-input-wrapper ag-text-field-input-wrapper" style={inputWrapperStyle}>
        <input
          value={value}
          onChange={handleInputChange}
          aria-label={t('filters.filterColumn', { column: columnDef.headerName ?? columnDef.field ?? '' }).trim()}
          placeholder={t('filters.columnPlaceholder')}
          className="ag-input-field-input ag-text-field-input"
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            font: 'inherit',
            background: 'transparent',
          }}
        />
      </div>
      <IconButton
        size="small"
        onClick={handleClear}
        aria-label={t('filters.clearFilter')}
        sx={{
          visibility: hasValue ? 'visible' : 'hidden',
          ml: 0.5,
          p: 0.25,
        }}
      >
        <CloseIcon fontSize="inherit" />
      </IconButton>
    </div>
  );
});

ClearableColumnFloatingFilter.displayName = 'ClearableColumnFloatingFilter';

export default ClearableColumnFloatingFilter;
