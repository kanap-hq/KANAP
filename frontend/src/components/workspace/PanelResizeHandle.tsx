import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { taskDetailTokens } from '../../pages/tasks/theme/taskDetailTokens';

/** How far one arrow key press moves the edge. */
const KEY_STEP = 16;

/** A properties panel: its usual width (also its narrowest), its widest, and what the content column keeps beside it. */
export const PROPERTIES_PANEL_WIDTH = {
  origin: taskDetailTokens.drawer.panelWidth,
  max: 520,
  contentMin: 480,
} as const;

export function clampPanelWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readStoredWidth(storageKey: string, fallback: number) {
  try {
    const parsed = Number.parseInt(window.localStorage.getItem(storageKey) ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The width the person gave a panel, kept in the browser under `storageKey` (`origin` until they
 * give one). The page shows it within the bounds of the moment, so a narrow window does not
 * overwrite it: the panel takes it back when there is room again.
 */
export function useStoredPanelWidth(storageKey: string, origin: number) {
  const [width, setWidthState] = React.useState(() => readStoredWidth(storageKey, origin));
  const setWidth = React.useCallback((next: number) => {
    const rounded = Math.round(next);
    setWidthState(rounded);
    try {
      window.localStorage.setItem(storageKey, String(rounded));
    } catch {
      // Local storage can be unavailable in private contexts.
    }
  }, [storageKey]);
  return [width, setWidth] as const;
}

/**
 * The width of a properties panel beside a content column, kept per family of records under
 * `storageKey`. It goes from the usual 280px to 520px, and the content column keeps 480px: the
 * bound follows the width of the row that holds both (`getRow`), measured while `active`. The row
 * is measured, never the content column, so a change of width cannot feed back into itself.
 */
export function usePropertiesPanelWidth(storageKey: string, getRow: () => HTMLElement | null, active: boolean) {
  const { origin, max: cap, contentMin } = PROPERTIES_PANEL_WIDTH;
  const [preferred, setPreferred] = useStoredPanelWidth(storageKey, origin);
  const [rowWidth, setRowWidth] = React.useState<number | null>(null);
  const getRowRef = React.useRef(getRow);
  getRowRef.current = getRow;

  React.useLayoutEffect(() => {
    if (!active) return undefined;
    const row = getRowRef.current();
    if (!row) return undefined;
    // An element not laid out yet measures 0: the window stands in for it.
    const measure = () => setRowWidth(row.getBoundingClientRect().width || window.innerWidth);
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(row);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [active]);

  const max = Math.max(origin, Math.min(cap, (rowWidth ?? window.innerWidth) - contentMin));
  const setWidth = React.useCallback(
    (next: number) => setPreferred(clampPanelWidth(next, origin, max)),
    [max, origin, setPreferred],
  );
  const reset = React.useCallback(() => setPreferred(origin), [origin, setPreferred]);
  return { width: clampPanelWidth(preferred, origin, max), min: origin, max, setWidth, reset };
}

type PanelResizeHandleProps = {
  ariaLabel: string;
  /** The panel's width now. */
  width: number;
  min: number;
  max: number;
  /** A new width asked for by a drag or an arrow key; the owner keeps it within its bounds. */
  onResize: (next: number) => void;
  /** Double-click or Enter: the panel's usual width. */
  onReset: () => void;
  /** Where the handle sits; by default on the left edge of the positioned panel that holds it. */
  sx?: SxProps<Theme>;
};

/**
 * The left edge of a right-hand panel, which a person drags to widen or narrow it: an invisible
 * 6px band with the resize cursor and a teal line on hover, on focus and while dragging. The arrow
 * keys move it, and a double-click or Enter brings the panel back to its usual width.
 */
export default function PanelResizeHandle({ ariaLabel, width, min, max, onResize, onReset, sx }: PanelResizeHandleProps) {
  const dragRef = React.useRef<{ x: number; width: number; pointerId: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // The capture may already be gone.
    }
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(width)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(Math.max(min, max))}
      tabIndex={0}
      data-dragging={dragging ? 'true' : undefined}
      onPointerDown={(event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        dragRef.current = { x: event.clientX, width, pointerId: event.pointerId };
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // Without capture the drag still follows the pointer over the handle.
        }
        event.preventDefault();
        setDragging(true);
      }}
      onPointerMove={(event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        // The edge follows the pointer from where the drag started: left widens the panel.
        onResize(drag.width + drag.x - event.clientX);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'ArrowLeft') onResize(width + KEY_STEP);
        else if (event.key === 'ArrowRight') onResize(width - KEY_STEP);
        else if (event.key === 'Enter') onReset();
        else return;
        // The page's own arrow keys (previous and next record) stay out of it.
        event.preventDefault();
        event.stopPropagation();
      }}
      sx={[
        (theme: Theme) => ({
          position: 'absolute',
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: 'col-resize',
          zIndex: 1,
          userSelect: 'none',
          touchAction: 'none',
          outline: 'none',
          // A line only on hover, focus and drag: no permanent bar.
          '&:hover::after, &:focus-visible::after, &[data-dragging="true"]::after': {
            content: '""',
            position: 'absolute',
            left: 2,
            top: 0,
            bottom: 0,
            width: 2,
            borderRadius: 1,
            background: theme.palette.primary.main,
          },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}

type ResizablePropertiesPanelProps = {
  /** The panel itself; it reads its width from `--properties-panel-width`. */
  children: React.ReactNode;
  ariaLabel: string;
  storageKey: string;
  /** How far the panel rises above the row (its negative top margin), so the handle covers its edge. */
  lift?: number;
};

/**
 * A properties panel with its own layout (a task's): the handle on its left edge and the width it
 * keeps under `storageKey`, given to the panel as `--properties-panel-width`. Only this frame
 * renders during a drag; the panel inside is the same element.
 */
export function ResizablePropertiesPanel({ children, ariaLabel, storageKey, lift = 0 }: ResizablePropertiesPanelProps) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const panel = usePropertiesPanelWidth(storageKey, () => frameRef.current?.parentElement ?? null, true);
  return (
    <Box
      ref={frameRef}
      data-testid="properties-panel-frame"
      style={{ '--properties-panel-width': `${panel.width}px` } as React.CSSProperties}
      sx={{ display: 'flex', flexShrink: 0, position: 'relative' }}
    >
      <PanelResizeHandle
        ariaLabel={ariaLabel}
        width={panel.width}
        min={panel.min}
        max={panel.max}
        onResize={panel.setWidth}
        onReset={panel.reset}
        sx={{ top: -lift }}
      />
      {children}
    </Box>
  );
}
