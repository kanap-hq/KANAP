import { describe, expect, it } from 'vitest';
import { getDotColor, SAMPLE_DATA_STATUS_COLORS } from './statusColors';

describe('sample data status colours', () => {
  it('shows a running load or reset as in progress (blue), never as attention', () => {
    expect(SAMPLE_DATA_STATUS_COLORS).toEqual({
      idle: 'default',
      loading: 'info',
      resetting: 'info',
      loaded: 'success',
      failed: 'error',
    });
    expect(getDotColor(SAMPLE_DATA_STATUS_COLORS.resetting, 'light')).toBe(getDotColor('info', 'light'));
  });
});
