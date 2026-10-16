import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { formatShortDate } from './dateFormat';

describe('formatShortDate', () => {
  const thisYear = new Date().getFullYear();

  it('omits the current year and shows another one by default', () => {
    expect(formatShortDate(`${thisYear}-03-15`, 'en')).toBe('15 Mar');
    expect(formatShortDate('2001-11-30', 'en')).toBe('30 Nov 2001');
  });

  it('always shows the year when asked', () => {
    expect(formatShortDate(`${thisYear}-03-15`, 'en', { year: 'always' })).toBe(`15 Mar ${thisYear}`);
  });

  it('never shows the year when the screen already does', () => {
    expect(formatShortDate('2001-04-06', 'en', { year: 'never' })).toBe('6 Apr');
    expect(formatShortDate('2001-12-25', 'de', { year: 'never' })).toMatch(/^25\.? Dez/);
  });

  it('gives the empty text for a missing or unreadable date', () => {
    expect(formatShortDate(null, 'en', { empty: 'Not set' })).toBe('Not set');
    expect(formatShortDate('not a date', 'en', { year: 'never', empty: 'not a date' })).toBe('not a date');
  });

  it('writes the short date of each language', () => {
    expect(formatShortDate('2001-10-19', 'en')).toBe('19 Oct 2001');
    expect(formatShortDate('2001-10-19', 'fr')).toBe('19 oct. 2001');
    expect(formatShortDate('2001-10-19', 'de')).toBe('19. Okt. 2001');
    expect(formatShortDate('2001-10-19', 'es')).toBe('19 oct 2001');
  });

  it('ends a sentence on an abbreviated month with a single period', () => {
    const fr = i18n.getFixedT('fr', 'portfolio');
    const de = i18n.getFixedT('de', 'portfolio');
    const key = 'planning.roadmap.explainText.finalStarted';
    expect(fr(key, { week: formatShortDate('2001-10-19', 'fr', { year: 'never' }) })).toBe('Démarré la semaine du 19 oct.');
    expect(de(key, { week: formatShortDate('2001-10-19', 'de', { year: 'never' }) })).toBe('Gestartet in der Woche vom 19. Okt.');
    // A period after anything else stays.
    expect(fr('planning.roadmap.explainText.summaryNoStart', { project: 'ERP v2.' })).toBe("ERP v2. n'a pas de semaine de début.");
  });
});
