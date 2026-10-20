type ItLevel = 'reader' | 'admin';

/**
 * Where `/it` opens. Applications come first. A scoped reader waits until the app knows whether
 * that list is visible, then the previous order applies: locations, assets, settings.
 * `'loading'` means the choice is not known yet.
 */
export function itDefaultTarget(args: {
  hasLevel: (resource: string, level: ItLevel) => boolean;
  hasScopedApplicationReaderAccess: boolean;
  isLoading: boolean;
  shouldHideApplications: boolean;
}): string {
  const { hasLevel } = args;
  if (hasLevel('applications', 'reader')) {
    if (args.hasScopedApplicationReaderAccess) {
      if (args.isLoading) return 'loading';
      if (!args.shouldHideApplications) return '/it/applications';
    } else {
      return '/it/applications';
    }
  }
  if (hasLevel('locations', 'reader')) return '/it/locations';
  if (hasLevel('infrastructure', 'reader')) return '/it/assets';
  if (hasLevel('settings', 'reader')) return '/it/settings';
  return '/403';
}
