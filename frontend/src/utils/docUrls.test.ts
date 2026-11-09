import { describe, expect, it } from 'vitest';
import { getDocUrl } from './docUrls';
import { STEP_SCREENS, stepHref } from '../components/onboarding/onboardingPaths';

describe('getDocUrl', () => {
  it('opens the budget lines manual from the list and a line', () => {
    expect(getDocUrl('/ops/budget')).toBe('https://doc.kadratis.com/budget-lines/');
    expect(getDocUrl('/ops/budget/BL-12/overview', 'fr')).toBe('https://doc.kadratis.com/fr/budget-lines/');
  });

  it('opens the record history manual from the History tab of a line', () => {
    expect(getDocUrl('/ops/budget/BL-12/history')).toBe('https://doc.kadratis.com/record-history/');
    expect(getDocUrl('/ops/budget/BL-12/history', 'de')).toBe('https://doc.kadratis.com/de/record-history/');
  });

  it('opens the technologies manual, and the report its own page', () => {
    expect(getDocUrl('/it/technologies')).toBe('https://doc.kadratis.com/technologies/');
    expect(getDocUrl('/it/technologies/TEC-4/overview', 'de')).toBe('https://doc.kadratis.com/de/technologies/');
    expect(getDocUrl('/it/technologies/end-of-support')).toBe('https://doc.kadratis.com/end-of-support/');
  });

  it('opens the vulnerabilities and administration view manuals', () => {
    expect(getDocUrl('/it/vulnerabilities')).toBe('https://doc.kadratis.com/vulnerabilities/');
    expect(getDocUrl('/it/vulnerabilities', 'fr')).toBe('https://doc.kadratis.com/fr/vulnerabilities/');
    expect(getDocUrl('/it/administration-view')).toBe('https://doc.kadratis.com/administration-view/');
  });

  it('opens the incident register manual from the list and an incident', () => {
    expect(getDocUrl('/it/incidents')).toBe('https://doc.kadratis.com/incidents/');
    expect(getDocUrl('/it/incidents/INC-14/journal', 'es')).toBe('https://doc.kadratis.com/es/incidents/');
  });

  it('opens the Netbox manual from the Netbox tab and the IT settings manual from the lists', () => {
    expect(getDocUrl('/it/settings')).toBe('https://doc.kadratis.com/it-ops-settings/');
    expect(getDocUrl('/it/settings', 'fr', '?tab=lists')).toBe('https://doc.kadratis.com/fr/it-ops-settings/');
    expect(getDocUrl('/it/settings', 'de', '?tab=netbox')).toBe('https://doc.kadratis.com/de/netbox/');
    expect(getDocUrl('/it/settings', 'es', '?tab=netbox&state=linked')).toBe('https://doc.kadratis.com/es/netbox/');
    expect(getDocUrl('/it/netbox', undefined, '?state=missing')).toBe('https://doc.kadratis.com/netbox/');
  });

  it('opens the data access manual from the administration page', () => {
    expect(getDocUrl('/admin/data-access')).toBe('https://doc.kadratis.com/data-access/');
    expect(getDocUrl('/admin/data-access', 'fr')).toBe('https://doc.kadratis.com/fr/data-access/');
  });

  it('opens the guide of the trial step a screen was opened from', () => {
    expect(getDocUrl('/ops/budget', undefined, '?step=budget_overview')).toBe('https://doc.kadratis.com/first-steps/budget-example/');
    expect(getDocUrl('/it/locations', 'fr', '?step=own_sites')).toBe('https://doc.kadratis.com/fr/first-steps/landscape-own-data/');
    expect(getDocUrl('/portfolio/projects/PRJ-3/relations', 'de', '?step=own_project_budget')).toBe('https://doc.kadratis.com/de/first-steps/portfolio-own-data/');
    expect(getDocUrl('/portfolio/contributors/me', 'es', '?step=own_invite')).toBe('https://doc.kadratis.com/es/first-steps/portfolio-own-data/');
    // On the users list, the colleague step ends two paths: the route's manual stays.
    expect(getDocUrl('/admin/users', undefined, '?step=own_invite')).toBe('https://doc.kadratis.com/admin/');
    expect(getDocUrl('/ops/budget', undefined, '?step=unknown')).toBe('https://doc.kadratis.com/budget-lines/');
  });

  it('gives every trial step a guide', () => {
    for (const key of Object.keys(STEP_SCREENS)) {
      const [path, search] = (stepHref(key, key === 'own_invite' ? 'portfolio' : null) ?? '').split('?');
      expect(getDocUrl(path, undefined, `?${search}`), key).toMatch(/^https:\/\/doc\.kadratis\.com\/first-steps\//);
    }
  });

  it('keeps the overview and falls back to the docs home', () => {
    expect(getDocUrl('/ops')).toBe('https://doc.kadratis.com/my-dashboard/');
    expect(getDocUrl('/ops/budgets')).toBe('https://doc.kadratis.com/');
  });
});
