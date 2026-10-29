/**
 * Share of `value` in `total`, in percent points (4.95 means 4.95%).
 * Zero when `total` is not positive or `value` is not a finite number.
 */
export function percentPoints(value: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(value)) return 0;
  return (value / total) * 100;
}

/**
 * Sum of the slices a pie draws. A non-finite value does not move the sum.
 * An "others" slice counts when the chart draws one, because it is one of the values.
 */
export function drawnSliceTotal(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

/** A slice under this share of the drawn pie prints no label. */
const PIE_SLICE_LABEL_MIN = 3;

/**
 * The percent printed on a pie slice: its share of the slices drawn, or blank under 3%.
 * The comparison happens before rounding, so 3% is shown and anything under 3% stays blank.
 */
export function pieSliceLabel(value: number, drawnTotal: number): string {
  const share = percentPoints(value, drawnTotal);
  if (share < PIE_SLICE_LABEL_MIN) return '';
  return `${Math.round(share)}%`;
}
