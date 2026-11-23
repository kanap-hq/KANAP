import { describe, expect, it } from 'vitest';
import { displayedRequestPriority } from './requestPriority';

const enabled = ['value', 'cost'];

describe('displayedRequestPriority', () => {
  it('shows no score when no enabled criterion is answered', () => {
    expect(displayedRequestPriority({
      priorityScore: 50,
      priorityOverride: false,
      criteriaValues: {},
      enabledCriterionIds: enabled,
    })).toBeNull();
    expect(displayedRequestPriority({
      priorityScore: '50.00',
      criteriaValues: { retired: 'old-option' },
      enabledCriterionIds: enabled,
    })).toBeNull();
    expect(displayedRequestPriority({
      priorityScore: 50,
      criteriaValues: { value: '  ' },
      enabledCriterionIds: enabled,
    })).toBeNull();
    expect(displayedRequestPriority({
      priorityScore: 0,
      criteriaValues: null,
      enabledCriterionIds: [],
    })).toBeNull();
  });

  it('shows the stored score once an enabled criterion is answered', () => {
    expect(displayedRequestPriority({
      priorityScore: '64.40',
      criteriaValues: { value: 'high', retired: 'old-option' },
      enabledCriterionIds: enabled,
    })).toBe(64.4);
  });

  it('shows the override value whether or not a criterion is answered', () => {
    expect(displayedRequestPriority({
      priorityScore: 50,
      priorityOverride: true,
      overrideValue: '72.00',
      criteriaValues: {},
      enabledCriterionIds: enabled,
    })).toBe(72);
    expect(displayedRequestPriority({
      priorityScore: 40,
      priorityOverride: true,
      overrideValue: null,
      criteriaValues: { value: 'high' },
      enabledCriterionIds: enabled,
    })).toBe(40);
  });

  it('keeps the stored score when the answers or the catalogue are missing', () => {
    expect(displayedRequestPriority({
      priorityScore: 50,
      criteriaValues: undefined,
      enabledCriterionIds: enabled,
    })).toBe(50);
    expect(displayedRequestPriority({
      priorityScore: 50,
      criteriaValues: {},
      enabledCriterionIds: null,
    })).toBe(50);
  });
});
