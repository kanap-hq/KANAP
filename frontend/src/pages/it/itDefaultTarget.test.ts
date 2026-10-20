import { describe, expect, it } from 'vitest';
import { itDefaultTarget } from './itDefaultTarget';

const rank: Record<string, number> = { reader: 1, admin: 4 };

function hasLevel(grants: Record<string, number>) {
  return (resource: string, level: 'reader' | 'admin') => (grants[resource] ?? 0) >= rank[level];
}

const open = {
  hasScopedApplicationReaderAccess: false,
  isLoading: false,
  shouldHideApplications: false,
};

describe('itDefaultTarget', () => {
  it('opens applications before locations, assets and settings', () => {
    const target = itDefaultTarget({
      ...open,
      hasLevel: hasLevel({ applications: 1, locations: 1, infrastructure: 4, settings: 1 }),
    });
    expect(target).toBe('/it/applications');
  });

  it('keeps locations, then assets, then settings once applications are not the landing page', () => {
    expect(itDefaultTarget({
      ...open,
      hasLevel: hasLevel({ locations: 1, infrastructure: 1, settings: 1 }),
    })).toBe('/it/locations');
    expect(itDefaultTarget({
      ...open,
      hasLevel: hasLevel({ infrastructure: 1, settings: 1 }),
    })).toBe('/it/assets');
    expect(itDefaultTarget({
      ...open,
      hasLevel: hasLevel({ settings: 1 }),
    })).toBe('/it/settings');
    expect(itDefaultTarget({ ...open, hasLevel: hasLevel({}) })).toBe('/403');
  });

  it('waits for a scoped reader, then skips a hidden applications list', () => {
    const grants = hasLevel({ applications: 1, locations: 1 });
    expect(itDefaultTarget({
      hasLevel: grants,
      hasScopedApplicationReaderAccess: true,
      isLoading: true,
      shouldHideApplications: false,
    })).toBe('loading');
    expect(itDefaultTarget({
      hasLevel: grants,
      hasScopedApplicationReaderAccess: true,
      isLoading: false,
      shouldHideApplications: false,
    })).toBe('/it/applications');
    expect(itDefaultTarget({
      hasLevel: grants,
      hasScopedApplicationReaderAccess: true,
      isLoading: false,
      shouldHideApplications: true,
    })).toBe('/it/locations');
  });
});
