import '../../../i18n';
import { describe, expect, it } from 'vitest';
import i18n from '../../../i18n';
import { describeCveOrgMatch, describeMatch, describeNvdMatch, feedAges, nvdState, type CveOrgMatch, type CveOrgVersion } from './feedText';

const en = i18n.getFixedT('en', 'it');
const fr = i18n.getFixedT('fr', 'it');

const version = (entry: Partial<CveOrgVersion>): CveOrgVersion => ({ version: null, status: null, lessThan: null, lessThanOrEqual: null, changes: [], ...entry });
const block = (entry: Partial<CveOrgMatch>): CveOrgMatch => ({
  source: 'cve_org', vendor: 'Apache Software Foundation', product: 'Apache Tomcat', cpe: null, default_status: null, versions: [], versions_total: 0, ...entry,
});

describe('describeNvdMatch', () => {
  it('names the CPE and each bound, included or excluded', () => {
    const match = {
      source: 'nvd' as const,
      cpe: 'a:apache:tomcat',
      versions: [
        { end: '9.0.99', end_including: false },
        { start: '10.1.1', start_including: true, end: '10.1.35', end_including: false },
      ],
    };
    expect(describeNvdMatch(match, en)).toBe('CPE identifier a:apache:tomcat: versions before 9.0.99; versions from 10.1.1 to 10.1.35 excluded');
    expect(describeNvdMatch(match, fr)).toBe('Identifiant CPE a:apache:tomcat : versions antérieures à 9.0.99 ; versions de 10.1.1 à 10.1.35 exclue');
  });

  it('reads every other shape of bound', () => {
    const one = (bound: Record<string, unknown>) => describeNvdMatch({ source: 'nvd', cpe: 'a:x:y', versions: [bound] }, en).replace('CPE identifier a:x:y: ', '');
    expect(one({ exact: '2.4.1' })).toBe('version 2.4.1');
    expect(one({ exact: '*' })).toBe('all versions');
    expect(one({})).toBe('all versions');
    expect(one({ start: '1.0', start_including: true })).toBe('versions from 1.0');
    expect(one({ start: '1.0', start_including: false })).toBe('versions after 1.0');
    expect(one({ end: '2.0', end_including: true })).toBe('versions up to 2.0 included');
    expect(one({ start: '1.0', start_including: true, end: '2.0', end_including: true })).toBe('versions from 1.0 to 2.0 included');
    expect(one({ start: '1.0', start_including: false, end: '2.0', end_including: true })).toBe('versions after 1.0 up to 2.0 included');
    expect(one({ start: '1.0', start_including: false, end: '2.0', end_including: false })).toBe('versions after 1.0 and before 2.0');
    expect(one({ start: '*', start_including: true, end: '2.0', end_including: false })).toBe('versions before 2.0');
    // No bound at all: the CPE alone.
    expect(describeNvdMatch({ source: 'nvd', cpe: 'a:x:y', versions: [] }, en)).toBe('CPE identifier a:x:y');
  });
});

describe('describeCveOrgMatch', () => {
  it('names the publisher and product, then each version with its status', () => {
    const match = block({
      versions: [
        version({ version: '9.0.0.M1', status: 'affected', lessThanOrEqual: '9.0.98' }),
        version({ version: '3', status: 'unknown', lessThanOrEqual: '8.5.0' }),
      ],
      versions_total: 2,
    });
    expect(describeCveOrgMatch(match, en)).toBe('Apache Software Foundation · Apache Tomcat: versions 9.0.0.M1 to 9.0.98 affected; versions 3 to 8.5.0 status unknown');
    expect(describeCveOrgMatch(match, fr)).toBe('Apache Software Foundation · Apache Tomcat : versions 9.0.0.M1 à 9.0.98 concernées ; versions 3 à 8.5.0 statut inconnu');
  });

  it('reads exact versions, open bounds, excluded ends and the three statuses', () => {
    const one = (entry: Partial<CveOrgVersion>, t = en) => describeCveOrgMatch(block({ vendor: null, product: 'P', versions: [version(entry)], versions_total: 1 }), t).replace(/^P ?: /, '');
    expect(one({ version: '2.4.1', status: 'affected' })).toBe('version 2.4.1 affected');
    expect(one({ version: '2.4.1', status: 'affected' }, fr)).toBe('version 2.4.1 concernée');
    expect(one({ version: '2.4.1', status: 'unaffected' })).toBe('version 2.4.1 not affected');
    expect(one({ version: '1.0', status: 'affected', lessThan: '2.0' })).toBe('versions 1.0 to 2.0 (excluded) affected');
    expect(one({ version: '0', status: 'affected', lessThan: '2.0' })).toBe('versions before 2.0 affected');
    expect(one({ version: '*', status: 'affected', lessThanOrEqual: '2.0' })).toBe('versions up to 2.0 affected');
    expect(one({ version: '1.0', status: 'affected', lessThan: '*' })).toBe('versions 1.0 and later affected');
    expect(one({ version: '*', status: 'unaffected', lessThan: '*' })).toBe('all versions not affected');
    expect(one({ version: '*', status: 'unaffected', lessThan: '*' }, fr)).toBe('toutes les versions non concernées');
    // A version with no status says its range only.
    expect(one({ version: '2.4.1' })).toBe('version 2.4.1');
  });

  it('follows the changes inside a range', () => {
    const match = block({
      vendor: null,
      product: 'P',
      versions: [version({ version: '1.0', status: 'affected', lessThan: '2.0', changes: [{ at: '1.5', status: 'unaffected' }] })],
      versions_total: 1,
    });
    expect(describeCveOrgMatch(match, en)).toBe('P: versions 1.0 to 2.0 (excluded) affected, from 1.5 not affected');
    expect(describeCveOrgMatch(match, fr)).toBe('P : versions 1.0 à 2.0 (exclue) concernées, à partir de 1.5 non concernées');
  });

  it('adds the default status, the package, platforms and modules, and the versions past the 20 shown', () => {
    const versions = Array.from({ length: 20 }, (_, i) => version({ version: `1.${i}`, status: 'affected' }));
    const match = block({
      versions,
      versions_total: 23,
      default_status: 'unaffected',
      package_name: 'flatpak',
      platforms: ['x64'],
      modules: ['ABAP'],
    });
    const text = describeCveOrgMatch(match, en);
    expect(text.startsWith('Apache Software Foundation · Apache Tomcat: version 1.0 affected; version 1.1 affected')).toBe(true);
    expect(text.endsWith('version 1.19 affected; and 3 more versions; all other versions: not affected; package flatpak; platforms x64; modules ABAP')).toBe(true);
    expect(describeCveOrgMatch(block({ versions: [], versions_total: 0, default_status: 'unaffected' }), fr))
      .toBe('Apache Software Foundation · Apache Tomcat : toutes les autres versions : non concernées');
    expect(describeCveOrgMatch(block({ versions: versions.slice(0, 1), versions_total: 2 }), en))
      .toBe('Apache Software Foundation · Apache Tomcat: version 1.0 affected; and 1 more version');
    // Neither publisher nor product: the record names itself.
    expect(describeCveOrgMatch(block({ vendor: null, product: null }), en)).toBe('Publisher record');
  });

  it('routes each match to its feed', () => {
    expect(describeMatch({ source: 'nvd', cpe: 'a:x:y', versions: [{ exact: '1' }] }, en)).toBe('CPE identifier a:x:y: version 1');
    expect(describeMatch(block({ vendor: 'V', product: 'P' }), en)).toBe('V · P');
  });
});

describe('nvdState', () => {
  it('reads the NVD statuses in five words', () => {
    expect(['Analyzed', 'Modified'].map(nvdState)).toEqual(['analyzed', 'analyzed']);
    expect(['Awaiting Analysis', 'Undergoing Analysis', 'Received'].map(nvdState)).toEqual(['pending', 'pending', 'pending']);
    expect(nvdState('Deferred')).toBe('deferred');
    expect(nvdState('Rejected')).toBe('rejected');
    expect(nvdState(null)).toBe('absent');
  });
});

describe('feedAges', () => {
  const now = new Date('2026-10-21T08:00:00.000Z');
  const item = (entry: Record<string, unknown>) => ({ source: 'nvd' as const, last_success_at: null, last_attempt_at: null, failing: false, enabled: true, ...entry });

  it('keeps the feeds that are on, with their last success', () => {
    const ages = feedAges([
      item({ last_success_at: '2026-10-21T02:20:00.000Z' }),
      item({ source: 'cve_org', enabled: false, last_success_at: '2026-10-21T02:21:00.000Z' }),
    ], now);
    expect(ages).toEqual([{ source: 'nvd', readAt: new Date('2026-10-21T02:20:00.000Z'), warning: null }]);
  });

  it('warns past three days and on a failed last read', () => {
    expect(feedAges([item({ last_success_at: '2026-10-18T09:00:00.000Z' })], now)[0].warning).toBeNull();
    expect(feedAges([item({ last_success_at: '2026-10-16T07:00:00.000Z' })], now)[0].warning).toEqual({ kind: 'stale', days: 5 });
    expect(feedAges([item({ last_success_at: '2026-10-21T02:00:00.000Z', failing: true })], now)[0].warning).toEqual({ kind: 'failing' });
    // Never read: no date, and no warning unless the read failed.
    expect(feedAges([item({})], now)[0]).toEqual({ source: 'nvd', readAt: null, warning: null });
    expect(feedAges(undefined, now)).toEqual([]);
  });
});
