import { describe, expect, it } from 'vitest';
import { formatOperationAmount } from './operationAmount';

describe('formatOperationAmount', () => {
  it('shows whole values like the rest of the app and cents otherwise', () => {
    expect(formatOperationAmount(18750)).toBe('18 750');
    expect(formatOperationAmount(1204.8)).toBe('1 204.80');
    expect(formatOperationAmount(1333.33)).toBe('1 333.33');
    expect(formatOperationAmount(-1204.05)).toBe('-1 204.05');
    expect(formatOperationAmount(-0.5)).toBe('-0.50');
    expect(formatOperationAmount(0)).toBe('0');
    expect(formatOperationAmount(null)).toBe('0');
  });
});
