import '../i18n';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import { moduleRightLabel, rightLevelLabel } from './permissionLabels';

describe('permission labels', () => {
  it('names a module and a level as the roles screen does', () => {
    expect(moduleRightLabel(i18n.getFixedT('fr'), 'budget')).toBe('Budget');
    expect(moduleRightLabel(i18n.getFixedT('fr'), 'infrastructure')).toBe('Infrastructure');
    expect(moduleRightLabel(i18n.getFixedT('en'), 'budget_ops')).toBe('Budget ops');
    expect(moduleRightLabel(i18n.getFixedT('en'), 'not_a_module')).toBe('not_a_module');
    expect(rightLevelLabel(i18n.getFixedT('fr'), 'reader')).toBe('Lecteur');
    expect(rightLevelLabel(i18n.getFixedT('en'), 'reader')).toBe('Reader');
    expect(rightLevelLabel(i18n.getFixedT('en'), 'unknown')).toBe('unknown');
  });
});
