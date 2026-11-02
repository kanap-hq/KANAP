import { describe, expect, it } from 'vitest';
import { getDocUrl } from './docUrls';

describe('getDocUrl', () => {
  it('opens the budget lines manual from the list and a line', () => {
    expect(getDocUrl('/ops/budget')).toBe('https://doc.kanap.net/budget-lines/');
    expect(getDocUrl('/ops/budget/BL-12/overview', 'fr')).toBe('https://doc.kanap.net/fr/budget-lines/');
  });

  it('opens the record history manual from the History tab of a line', () => {
    expect(getDocUrl('/ops/budget/BL-12/history')).toBe('https://doc.kanap.net/record-history/');
    expect(getDocUrl('/ops/budget/BL-12/history', 'de')).toBe('https://doc.kanap.net/de/record-history/');
  });

  it('opens the technologies manual, and the report its own page', () => {
    expect(getDocUrl('/it/technologies')).toBe('https://doc.kanap.net/technologies/');
    expect(getDocUrl('/it/technologies/TEC-4/overview', 'de')).toBe('https://doc.kanap.net/de/technologies/');
    expect(getDocUrl('/it/technologies/end-of-support')).toBe('https://doc.kanap.net/end-of-support/');
  });

  it('opens the vulnerabilities and administration view manuals', () => {
    expect(getDocUrl('/it/vulnerabilities')).toBe('https://doc.kanap.net/vulnerabilities/');
    expect(getDocUrl('/it/vulnerabilities', 'fr')).toBe('https://doc.kanap.net/fr/vulnerabilities/');
    expect(getDocUrl('/it/administration-view')).toBe('https://doc.kanap.net/administration-view/');
  });

  it('opens the incident register manual from the list and an incident', () => {
    expect(getDocUrl('/it/incidents')).toBe('https://doc.kanap.net/incidents/');
    expect(getDocUrl('/it/incidents/INC-14/journal', 'es')).toBe('https://doc.kanap.net/es/incidents/');
  });

  it('opens the Netbox manual from the Netbox tab and the IT settings manual from the lists', () => {
    expect(getDocUrl('/it/settings')).toBe('https://doc.kanap.net/it-ops-settings/');
    expect(getDocUrl('/it/settings', 'fr', '?tab=lists')).toBe('https://doc.kanap.net/fr/it-ops-settings/');
    expect(getDocUrl('/it/settings', 'de', '?tab=netbox')).toBe('https://doc.kanap.net/de/netbox/');
    expect(getDocUrl('/it/settings', 'es', '?tab=netbox&state=linked')).toBe('https://doc.kanap.net/es/netbox/');
    expect(getDocUrl('/it/netbox', undefined, '?state=missing')).toBe('https://doc.kanap.net/netbox/');
  });

  it('opens the data access manual from the administration page', () => {
    expect(getDocUrl('/admin/data-access')).toBe('https://doc.kanap.net/data-access/');
    expect(getDocUrl('/admin/data-access', 'fr')).toBe('https://doc.kanap.net/fr/data-access/');
  });

  it('keeps the overview and falls back to the docs home', () => {
    expect(getDocUrl('/ops')).toBe('https://doc.kanap.net/my-dashboard/');
    expect(getDocUrl('/ops/budgets')).toBe('https://doc.kanap.net/');
  });
});
