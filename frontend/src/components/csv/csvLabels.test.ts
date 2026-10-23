import { describe, expect, it } from 'vitest';
import { csvEntityOf, csvFieldLabel, csvGroupLabel, csvPresetLabel } from './csvLabels';

// A `t` that knows a few keys, and answers the key itself for the others (as i18next does without a default).
const known: Record<string, string> = {
  'csv.fields.applications.name': 'Nom',
  'csv.groups.overview': 'Vue d’ensemble',
  'csv.presets.applications.enrichment': 'Enrichissement des données',
};
const t = ((key: string, options?: { defaultValue?: string }) => known[key] ?? options?.defaultValue ?? key) as never;
const keyOnly = ((key: string) => known[key] ?? key) as never;

describe('csv labels', () => {
  it('names the entity of an endpoint', () => {
    expect(csvEntityOf('/applications')).toBe('applications');
    expect(csvEntityOf('/it/assets?x=1')).toBe('it_assets');
  });

  it('translates a known field, group and preset', () => {
    expect(csvFieldLabel(t, 'applications', { csvColumn: 'name', label: 'Name' })).toBe('Nom');
    expect(csvGroupLabel(t, 'Overview')).toBe('Vue d’ensemble');
    expect(csvPresetLabel(t, 'applications', { name: 'enrichment', label: 'Data Enrichment' })).toBe('Enrichissement des données');
  });

  it('falls back to the server label, without the __CLEAR__ hint, whatever t does with a missing key', () => {
    for (const translate of [t, keyOnly]) {
      expect(csvFieldLabel(translate, 'applications', { csvColumn: 'cyber_criticality', label: 'cyber_criticality (__CLEAR__ to clear)' })).toBe('cyber_criticality');
      expect(csvFieldLabel(translate, 'applications', { csvColumn: 'criticality', label: 'Business criticality (code or name; __CLEAR__ to clear)' })).toBe('Business criticality');
      expect(csvGroupLabel(translate, 'Mystery group')).toBe('Mystery group');
      expect(csvPresetLabel(translate, 'assets', { name: 'x', label: 'Server label' })).toBe('Server label');
    }
  });
});
