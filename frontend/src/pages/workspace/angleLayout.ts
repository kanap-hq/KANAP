import type { OnboardingAngle } from '../../components/onboarding/onboardingApi';

/**
 * The home tiles that come first for each onboarding path. The budget path puts the whole budget
 * section first instead.
 */
export const ANGLE_TILES: Record<Exclude<OnboardingAngle, 'budget'>, string[]> = {
  cartography: ['application-compliance', 'vulnerabilities', 'netbox-sync'],
  portfolio: ['projects-i-lead', 'projects-i-contribute', 'new-requests', 'global-status-changes'],
};

/** The tiles in their saved order, those of the workspace's path first. */
export function orderTilesForAngle<T extends { id: string; order: number }>(tiles: T[], angle: OnboardingAngle | null): T[] {
  const first = angle && angle !== 'budget' ? ANGLE_TILES[angle] : [];
  const rank = (id: string) => (first.includes(id) ? 0 : 1);
  return tiles.slice().sort((a, b) => rank(a.id) - rank(b.id) || a.order - b.order);
}
