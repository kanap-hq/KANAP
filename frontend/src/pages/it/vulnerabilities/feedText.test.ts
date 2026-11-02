import '../../../i18n';
import { describe, expect, it } from 'vitest';
import i18n from '../../../i18n';
import { formatShortDate } from '../../../lib/dateFormat';
import { describeCveOrgMatch, describeFeedAges, describeMatch, describeNvdMatch, feedAges, groupMatchesByCpe, nvdState, type CveOrgMatch, type CveOrgVersion, type FeedSourceStatus } from './feedText';

const en = i18n.getFixedT('en', 'it');
const fr = i18n.getFixedT('fr', 'it');
const de = i18n.getFixedT('de', 'it');
const es = i18n.getFixedT('es', 'it');

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
    expect(describeNvdMatch(match, fr)).toBe('Identifiant CPE a:apache:tomcat\u00a0: versions antérieures à 9.0.99\u202f; versions de 10.1.1 à 10.1.35 exclue');
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

  it('lists each bound once and keeps distinct ranges that overlap', () => {
    const match = {
      source: 'nvd' as const,
      cpe: 'a:apache:tomcat',
      versions: [
        { end: '9.0.99', end_including: false },
        { exact: '10.1.0' },
        { exact: '10.1.0' },
        { exact: '11.0.0' },
        { start: '8.1.0', start_including: true, end: '8.3.8', end_including: false },
        { start: '8.1.0', start_including: true, end: '8.1.29', end_including: false },
        { start: '8.1.0', start_including: true, end: '8.1.29', end_including: false },
        { exact: '11.0.0' },
        { exact: '*' },
        {},
      ],
    };
    expect(describeNvdMatch(match, en)).toBe(
      'CPE identifier a:apache:tomcat: versions before 9.0.99; version 10.1.0; version 11.0.0; versions from 8.1.0 to 8.3.8 excluded; versions from 8.1.0 to 8.1.29 excluded; all versions',
    );
    // An open end is the same bound with or without its flag, and an exact version hides the range beside it.
    const same = (versions: Array<Record<string, unknown>>) => describeNvdMatch({ source: 'nvd', cpe: 'a:x:y', versions }, en);
    expect(same([
      { end: '2.0', end_including: false },
      { start: '*', start_including: true, end: '2.0', end_including: false },
      { exact: '1.0', end: '9.0', end_including: false },
      { exact: '1.0' },
    ])).toBe('CPE identifier a:x:y: versions before 2.0; version 1.0');
  });

  it('groups the NVD matches of one CPE and leaves the publisher blocks', () => {
    const org = block({ vendor: 'PHP Group', product: 'PHP', versions: [version({ version: '8.1.0', status: 'affected', lessThan: '8.1.29' })], versions_total: 1 });
    const grouped = groupMatchesByCpe([
      org,
      { source: 'nvd', cpe: 'a:php:php', versions: [
        { start: '8.1.0', start_including: true, end: '8.1.29', end_including: false },
        { start: '8.1.0', start_including: true, end: '8.3.8', end_including: false },
      ] },
      { source: 'nvd', cpe: 'A:PHP:PHP', versions: [
        { start: '8.1.0', start_including: true, end: '8.1.29', end_including: false },
        { start: '8.2.0', start_including: true, end: '8.2.20', end_including: false },
      ] },
      { source: 'nvd', cpe: 'a:apache:tomcat', versions: [{ exact: '9.0.0' }, { exact: '9.0.0' }] },
    ]);
    expect(grouped.map((match) => match.source === 'nvd' ? match.cpe : match.product)).toEqual(['PHP', 'a:php:php', 'a:apache:tomcat']);
    const php = grouped[1];
    const tomcat = grouped[2];
    if (php.source !== 'nvd' || tomcat.source !== 'nvd') throw new Error('expected the NVD rows');
    expect(describeNvdMatch(php, en)).toBe(
      'CPE identifier a:php:php: versions from 8.1.0 to 8.1.29 excluded; versions from 8.1.0 to 8.3.8 excluded; versions from 8.2.0 to 8.2.20 excluded',
    );
    expect(describeMatch(grouped[0], en)).toBe('PHP Group · PHP: versions 8.1.0 to 8.1.29 (excluded) affected');
    expect(describeNvdMatch(tomcat, en)).toBe('CPE identifier a:apache:tomcat: version 9.0.0');
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
    expect(describeCveOrgMatch(match, fr)).toBe('Apache Software Foundation · Apache Tomcat\u00a0: versions 9.0.0.M1 à 9.0.98 concernées\u202f; versions 3 à 8.5.0 statut inconnu');
  });

  it('reads exact versions, open bounds, excluded ends and the three statuses', () => {
    const one = (entry: Partial<CveOrgVersion>, t = en) => describeCveOrgMatch(block({ vendor: null, product: 'P', versions: [version(entry)], versions_total: 1 }), t).replace(/^P(?:\u00a0)?: /, '');
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
    expect(describeCveOrgMatch(match, fr)).toBe('P\u00a0: versions 1.0 à 2.0 (exclue) concernées, à partir de 1.5 non concernées');
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
      .toBe('Apache Software Foundation · Apache Tomcat\u00a0: toutes les autres versions\u00a0: non concernées');
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
    expect(ages).toEqual([{ source: 'nvd', readAt: new Date('2026-10-21T02:20:00.000Z'), scoreDate: null, warning: null }]);
  });

  it('warns past three days and on a failed last read', () => {
    expect(feedAges([item({ last_success_at: '2026-10-18T09:00:00.000Z' })], now)[0].warning).toBeNull();
    expect(feedAges([item({ last_success_at: '2026-10-16T07:00:00.000Z' })], now)[0].warning).toEqual({ kind: 'stale', days: 5 });
    expect(feedAges([item({ last_success_at: '2026-10-21T02:00:00.000Z', failing: true })], now)[0].warning).toEqual({ kind: 'failing' });
    // Never read: no date, and no warning unless the read failed.
    expect(feedAges([item({})], now)[0]).toEqual({ source: 'nvd', readAt: null, scoreDate: null, warning: null });
    expect(feedAges(undefined, now)).toEqual([]);
  });

  it('keeps the exploitation catalogues, and the day of the EPSS scores', () => {
    const ages = feedAges([
      item({ source: 'cisa_kev', last_success_at: '2026-10-16T07:00:00.000Z', failing: true }),
      item({ source: 'eu_kev', enabled: false, last_success_at: '2026-10-16T07:00:00.000Z' }),
      item({ source: 'epss', last_success_at: '2026-10-21T03:00:00.000Z', score_date: '2026-10-19' }),
      item({ source: 'euvd' }),
      item({ source: 'other' }),
    ], now);
    expect(ages.map((age) => age.source)).toEqual(['cisa_kev', 'epss', 'euvd']);
    expect(ages[0].warning).toEqual({ kind: 'failing' });
    expect(ages[1]).toMatchObject({ scoreDate: '2026-10-19', warning: null });
    expect(ages[2]).toEqual({ source: 'euvd', readAt: null, scoreDate: null, warning: null });
    // A failure wins over a reading older than three days.
    expect(feedAges([item({ source: 'eu_kev', last_success_at: '2026-10-16T07:00:00.000Z' })], now)[0].warning).toEqual({ kind: 'stale', days: 5 });
  });
});

describe('describeFeedAges', () => {
  const now = new Date('2026-10-21T08:00:00.000Z');
  const NVD = '2026-10-21T02:20:00.000Z';
  const CISA = '2026-10-21T02:22:00.000Z';
  const EU = '2026-10-16T07:00:00.000Z';
  const row = (entry: Partial<FeedSourceStatus> & { source: FeedSourceStatus['source'] }): FeedSourceStatus => ({
    last_success_at: null, last_attempt_at: null, failing: false, enabled: true, ...entry,
  });
  const items: FeedSourceStatus[] = [
    row({ source: 'nvd', last_success_at: NVD }),
    row({ source: 'cve_org' }),
    row({ source: 'cisa_kev', last_success_at: CISA, failing: true }),
    row({ source: 'eu_kev', last_success_at: EU }),
    row({ source: 'epss', last_success_at: '2026-10-21T03:00:00.000Z', score_date: '2026-10-19' }),
    row({ source: 'euvd' }),
    row({ source: 'eu_kev', enabled: false, last_success_at: EU }),
  ];

  function clock(locale: string, iso: string) {
    const date = new Date(iso);
    return {
      date: formatShortDate(date, locale),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date),
    };
  }

  it('names each catalogue, and warns in English, French, German and Spanish', () => {
    const languages = [
      ['en', en, 'EPSS scores of', 'CISA KEV on', 'EUVD not read yet', 'The last read of CISA KEV failed', 'EU KEV has not been read for 5 days'],
      ['fr', fr, 'scores EPSS du', 'CISA KEV le', 'EUVD pas encore lue', 'La dernière lecture de CISA KEV a échoué', 'EU KEV n\'a pas été lu depuis 5 jours'],
      ['de', de, 'EPSS-Scores vom', 'CISA KEV am', 'EUVD noch nicht gelesen', 'Das letzte Lesen von CISA KEV ist fehlgeschlagen', 'EU KEV wurde seit 5 Tagen nicht gelesen'],
      ['es', es, 'puntuaciones EPSS del', 'CISA KEV el', 'EUVD aún no leída', 'La última lectura de CISA KEV falló', 'EU KEV no se ha leído desde hace 5 días'],
    ] as const;
    for (const [locale, t, scores, cisa, never, failing, stale] of languages) {
      const described = describeFeedAges(items, t, locale, now);
      const nvd = clock(locale, NVD);
      const cisaAt = clock(locale, CISA);
      const eu = clock(locale, EU);
      const scoreDay = formatShortDate('2026-10-19', locale);
      const list = [
        t('pages.vulnerabilities.feeds.age.item', { source: t('pages.vulnerabilities.feeds.age.nvd'), date: nvd.date, time: nvd.time }),
        t('pages.vulnerabilities.feeds.age.never', { source: t('pages.vulnerabilities.feeds.age.cve_org') }),
        t('pages.vulnerabilities.feeds.age.item', { source: t('pages.vulnerabilities.feeds.age.cisa_kev'), date: cisaAt.date, time: cisaAt.time }),
        t('pages.vulnerabilities.feeds.age.item', { source: t('pages.vulnerabilities.feeds.age.eu_kev'), date: eu.date, time: eu.time }),
        t('pages.vulnerabilities.feeds.age.scores', { source: t('pages.vulnerabilities.feeds.age.epss'), date: scoreDay }),
        t('pages.vulnerabilities.feeds.age.never', { source: t('pages.vulnerabilities.feeds.age.euvd') }),
      ].join(' · ');
      expect(described!.text).toBe(t('pages.vulnerabilities.feeds.age.line', { list }));
      expect(described!.text).toContain(scores);
      expect(described!.text).toContain(cisa);
      expect(described!.text).toContain(never);
      expect(described!.warnings).toEqual([failing, stale]);
    }
    expect(describeFeedAges([row({ source: 'nvd', enabled: false })], en, 'en', now)).toBeNull();
  });
});
