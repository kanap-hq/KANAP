import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { AgChartsReact } from 'ag-charts-react';
import { PRINT_CONTENT_WIDTH, registerPrintPreparer, useReportPrinting, useReportTheme } from './reportPrint';

/**
 * An ag-charts chart that survives printing. A live canvas keeps its screen pixel size
 * on paper and overflows the page, so on paper the chart is a copy of its pixels in a
 * page-wide canvas. The copy is taken synchronously when print mode starts (so it exists
 * before the browser lays the pages out) and taken again by the print preparer once the
 * live chart has actually been redrawn in the light theme at its paper width. The live
 * chart stays mounted and laid out off-page meanwhile, so it can redraw and the instance
 * survives the round trip. A copy is never scaled up: if the redraw did not happen in
 * time, the chart prints at its screen size rather than blurred and oversized.
 *
 * Charts follow the screen theme (light on paper) on a transparent background, so the
 * card behind them shows through; a page that sets its own `theme` or `background` keeps it.
 */
const nextFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
export default function PrintableChart({
  options,
  height,
  chartRef,
  label,
  printWidth = PRINT_CONTENT_WIDTH,
}: {
  options: any;
  height: number | string;
  chartRef?: React.Ref<any>;
  label?: string;
  /** Width the chart is redrawn at for paper: the page, or a share of it for tiles. */
  printWidth?: number;
}) {
  const printing = useReportPrinting();
  const dark = useReportTheme().palette.mode === 'dark';
  const themedOptions = useMemo(() => ({
    ...options,
    theme: options?.theme ?? (dark ? 'ag-default-dark' : 'ag-default'),
    background: options?.background ?? { fill: 'transparent' },
  }), [options, dark]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const printCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copy, setCopy] = useState<{ width: number } | null>(null);

  const snapshot = useCallback(() => {
    const live = wrapperRef.current?.querySelector('canvas');
    const target = printCanvasRef.current;
    if (!live || !target || live.width === 0 || live.height === 0) return;
    try {
      target.width = live.width;
      target.height = live.height;
      const width = live.clientWidth || live.width;
      target.style.maxWidth = `${width}px`;
      const ctx = target.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(live, 0, 0);
      setCopy({ width });
    } catch (e) {
      console.warn('Chart snapshot failed', e);
    }
  }, []);

  useLayoutEffect(() => {
    if (!printing) {
      setCopy(null);
      return;
    }
    snapshot();
  }, [printing, snapshot]);

  // Wait for the live chart to be laid out and drawn at the paper width, then copy it.
  useEffect(() => registerPrintPreparer(async () => {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const live = wrapperRef.current?.querySelector('canvas');
      const dpr = window.devicePixelRatio || 1;
      if (live && Math.abs(live.clientWidth - printWidth) <= 2 && live.width >= Math.floor(live.clientWidth * dpr)) {
        await nextFrame();
        await nextFrame();
        await wait(150);
        break;
      }
      await wait(50);
    }
    snapshot();
  }), [printWidth, snapshot]);

  const parked = printing && copy != null;

  return (
    <>
      {printing && (
        <canvas
          ref={printCanvasRef}
          aria-label={label}
          style={{ display: copy ? 'block' : 'none', width: '100%', height: 'auto' }}
        />
      )}
      {/* Same slot in both modes so the chart instance survives the switch to print and back. */}
      <Box
        ref={wrapperRef}
        sx={
          parked
            ? { position: 'absolute', left: -10000, top: 0, width: printWidth, height, opacity: 0, pointerEvents: 'none' }
            : { height }
        }
      >
        <AgChartsReact ref={chartRef} options={themedOptions} />
      </Box>
    </>
  );
}
