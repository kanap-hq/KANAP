import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
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

// Quiet time after the last keystroke before the typed text filters the grid. Enter and leaving the
// box apply it at once.
export const TEXT_FILTER_APPLY_DELAY_MS = 300;

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
  // The typed text not applied yet, and its timer.
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // The same model again (text typed back to what is applied, Enter then leaving the box) reloads nothing.
    if (JSON.stringify(nextModel[colId] ?? null) === JSON.stringify(current[colId] ?? null)) return;

    if (typeof api.setFilterModel === 'function') {
      api.setFilterModel(nextModel);
    }
  }, [props.api, props.column, defaultTextType]);

  const cancelPending = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    cancelPending();
    if (pending != null) applyTextFilterModel(pending);
  }, [applyTextFilterModel, cancelPending]);

  useEffect(() => cancelPending, [cancelPending]);

  useImperativeHandle(ref, () => ({
    onParentModelChanged(model: TextFilterModel | null) {
      // Text typed but not applied yet is newer than the grid's model: keep it in the box.
      if (pendingRef.current != null) return;
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
    pendingRef.current = next;
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushPending();
    }, TEXT_FILTER_APPLY_DELAY_MS);
  }, [flushPending]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') flushPending();
  }, [flushPending]);

  const handleClear = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!hasValue) return;
    cancelPending();
    setValue('');
    setHasValue(false);
    activeTextTypeRef.current = defaultTextType;
    applyTextFilterModel('');
  }, [applyTextFilterModel, cancelPending, defaultTextType, hasValue]);

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
          onKeyDown={handleKeyDown}
          onBlur={flushPending}
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
