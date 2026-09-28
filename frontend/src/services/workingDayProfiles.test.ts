import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../api', () => ({ default: api }));

import {
  createWorkingDayProfile,
  getWorkingDayProfile,
  getWorkingDayProfileYear,
  isStandardCalendar,
  listCalendarSuggestions,
  listCountries,
  listWorkingDayProfiles,
  updateWorkingDayProfile,
} from './workingDayProfiles';

describe('working-day calendars service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists every calendar with the names in the requested language', async () => {
    api.get.mockResolvedValue({ data: { items: [{ id: 'p1' }] } });
    expect(await listWorkingDayProfiles('fr')).toEqual([{ id: 'p1' }]);
    expect(api.get).toHaveBeenCalledWith('/working-day-profiles', {
      params: { page: 1, limit: 1000, sort: 'name:ASC', includeDisabled: true, lang: 'fr' },
    });
  });

  it('reads one calendar in the requested language', async () => {
    api.get.mockResolvedValue({ data: { id: 'p1', country_name: 'Allemagne' } });
    expect(await getWorkingDayProfile('p1', 'fr')).toEqual({ id: 'p1', country_name: 'Allemagne' });
    expect(api.get).toHaveBeenCalledWith('/working-day-profiles/p1', { params: { lang: 'fr' } });
  });

  it('reads the countries, one year of a calendar and the suggestions from their routes', async () => {
    api.get.mockResolvedValueOnce({ data: { items: [{ code: 'FR', name: 'France', regions: [] }] } });
    expect(await listCountries('de')).toEqual([{ code: 'FR', name: 'France', regions: [] }]);
    expect(api.get).toHaveBeenLastCalledWith('/working-day-profiles/countries', { params: { lang: 'de' } });

    const year = { year: 2026, source: 'standard', days: [], standard_days: [], holidays: [] };
    api.get.mockResolvedValueOnce({ data: year });
    expect(await getWorkingDayProfileYear('p1', 2026, 'es')).toEqual(year);
    expect(api.get).toHaveBeenLastCalledWith('/working-day-profiles/p1/years/2026', { params: { lang: 'es' } });

    api.get.mockResolvedValueOnce({ data: { items: [{ country_iso: 'IT', country_name: 'Italy', companies: ['Branch'] }] } });
    expect(await listCalendarSuggestions('en')).toEqual([{ country_iso: 'IT', country_name: 'Italy', companies: ['Branch'] }]);
    expect(api.get).toHaveBeenLastCalledWith('/working-day-profiles/suggestions', { params: { lang: 'en' } });
  });

  it('reads a missing list as empty', async () => {
    api.get.mockResolvedValue({ data: {} });
    expect(await listCountries('en')).toEqual([]);
    expect(await listCalendarSuggestions('en')).toEqual([]);
    expect(await listWorkingDayProfiles('en')).toEqual([]);
  });

  it('creates a standard calendar with its country and region', async () => {
    api.post.mockResolvedValue({ data: { id: 'p2' } });
    await createWorkingDayProfile({ code: 'FR-57', name: 'France (Moselle)', country_iso: 'FR', region_code: '57' });
    expect(api.post).toHaveBeenCalledWith('/working-day-profiles', {
      code: 'FR-57',
      name: 'France (Moselle)',
      country_iso: 'FR',
      region_code: '57',
    });
  });

  it('asks for the names of an update response in the UI language', async () => {
    api.patch.mockResolvedValue({ data: { id: 'p1' } });
    await updateWorkingDayProfile('p1', { days_by_year: { '2026': null } }, 'fr');
    expect(api.patch).toHaveBeenCalledWith('/working-day-profiles/p1', { days_by_year: { '2026': null } }, { params: { lang: 'fr' } });
  });

  it('tells a standard calendar from a custom one', () => {
    expect(isStandardCalendar({ country_iso: 'FR' })).toBe(true);
    expect(isStandardCalendar({ country_iso: null })).toBe(false);
    expect(isStandardCalendar(null)).toBe(false);
    expect(isStandardCalendar(undefined)).toBe(false);
  });
});
