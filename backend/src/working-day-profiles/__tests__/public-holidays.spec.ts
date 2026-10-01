import * as assert from 'node:assert/strict';

// The holiday day is read from the package's local date string, never from an
// instant: pin a zone east of UTC first (the server's), where the ISO form of
// a holiday's start falls on the day before.
process.env.TZ = 'Europe/Paris';

import {
  canonicalCountry,
  canonicalRegion,
  countryName,
  generateWorkingDays,
  holidayLanguage,
  isKnownCountry,
  isKnownRegion,
  listCountries,
  regionName,
} from '../public-holidays';

// Standard working days from the public holidays of `date-holidays` 3.37.0
// (pinned exactly): Monday to Friday minus the public holidays on a weekday,
// multi-day holidays walked day by day, names in the language asked for.
// Pure, no database.

const total = (days: string[]) => days.reduce((sum, value) => sum + Number(value), 0);

function testFrance2026() {
  const france = generateWorkingDays('FR', null, 2026, 'en');
  assert.deepEqual(france.days, ['21', '20', '22', '21', '17', '22', '22', '21', '22', '22', '20', '22']);
  assert.equal(total(france.days), 252);
  assert.equal(france.holidays.length, 11);
  // Assumption and All Saints fall on a weekend: listed, flagged, not counted.
  const weekend = france.holidays.filter((holiday) => holiday.weekend).map((holiday) => holiday.date);
  assert.deepEqual(weekend, ['2026-08-15', '2026-11-01']);
  assert.deepEqual(france.holidays[0], { date: '2026-01-01', name: "New Year's Day", weekend: false });
  assert.ok(france.holidays.some((holiday) => holiday.date === '2026-04-06' && holiday.name === 'Easter Monday'));
  // Sorted by date.
  const dates = france.holidays.map((holiday) => holiday.date);
  assert.deepEqual(dates, [...dates].sort());
}

function testRegionsAndCountries() {
  // Moselle adds Good Friday; its St Stephen's Day falls on a Saturday.
  const moselle = generateWorkingDays('FR', '57', 2026, 'en');
  assert.equal(total(moselle.days), 251);
  assert.equal(moselle.days[3], '20', 'April loses Good Friday');
  assert.ok(moselle.holidays.some((holiday) => holiday.date === '2026-12-26' && holiday.weekend));
  assert.equal(total(generateWorkingDays('DE', 'BY', 2026, 'en').days), 252);
  assert.equal(total(generateWorkingDays('DE', null, 2026, 'en').days), 254);
  const us = generateWorkingDays('US', null, 2026, 'en');
  assert.equal(total(us.days), 250);
  // Independence Day on a Saturday: its substitute Friday is the public holiday counted.
  assert.ok(us.holidays.some((holiday) => holiday.date === '2026-07-03' && !holiday.weekend));
  assert.ok(us.holidays.some((holiday) => holiday.date === '2026-07-04' && holiday.weekend));
}

function testLeapFebruary() {
  // February 2028 has 29 days, 21 of them weekdays; 2027 has 20.
  assert.equal(generateWorkingDays('FR', null, 2028, 'en').days[1], '21');
  assert.equal(generateWorkingDays('FR', null, 2027, 'en').days[1], '20');
}

function testMultiDayHolidays() {
  // Bosnia and Herzegovina, Eid al-Adha 2026: four days from Wednesday May 27.
  const bosnia = generateWorkingDays('BA', null, 2026, 'en');
  const eid = bosnia.holidays.filter((holiday) => holiday.name === 'Feast of the Sacrifice (Eid al-Adha)');
  assert.deepEqual(eid.map((holiday) => [holiday.date, holiday.weekend]), [
    ['2026-05-27', false], ['2026-05-28', false], ['2026-05-29', false], ['2026-05-30', true],
  ]);
  // May: 21 weekdays minus Labour Day (Friday) and the three weekdays of Eid.
  assert.equal(bosnia.days[4], '17');

  // Eswatini, Incwala: six days from December 28, so it reaches into the next year. A year
  // gets the last days of the one that started the year before and the first days of its own.
  const eswatini2026 = generateWorkingDays('SZ', null, 2026, 'en');
  assert.deepEqual(
    eswatini2026.holidays.filter((holiday) => holiday.name === 'Incwala Festival').map((holiday) => holiday.date),
    ['2026-01-01', '2026-01-02', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31'],
    'only the days of the year asked for',
  );
  const eswatini2027 = generateWorkingDays('SZ', null, 2027, 'en');
  assert.deepEqual(
    eswatini2027.holidays.filter((holiday) => holiday.date <= '2027-01-02').map((holiday) => [holiday.date, holiday.name]),
    [['2027-01-01', 'Incwala Festival'], ['2027-01-01', "New Year's Day"], ['2027-01-02', 'Incwala Festival']],
    'the days a holiday of the year before carries into this one; two holidays of one day are both listed',
  );
}

function testPartialDayHolidays() {
  // Whole days are the unit. A public holiday that starts at 18:00 or later removes no
  // working day: AU-NT counts Christmas Eve and New Year's Eve from 19:00, both Thursdays.
  const territory = generateWorkingDays('AU', 'NT', 2026, 'en');
  assert.equal(territory.days[11], '21', 'December: 23 weekdays minus Christmas Day and the Boxing Day substitute');
  const december = territory.holidays.filter((holiday) => holiday.date >= '2026-12-01');
  assert.deepEqual(december.map((holiday) => holiday.date), ['2026-12-25', '2026-12-26', '2026-12-28']);
  // One that starts earlier counts as a whole day: CH-VS counts Labour Day (a Friday) from 12:00.
  const valais = generateWorkingDays('CH', 'VS', 2026, 'en');
  assert.ok(valais.holidays.some((holiday) => holiday.date === '2026-05-01' && holiday.name === 'Labour Day'));
  assert.equal(valais.days[4], '18', 'May: 21 weekdays minus Labour Day, Ascension Day and Whit Monday');
  // France has no partial day: unchanged.
  assert.equal(total(generateWorkingDays('FR', null, 2026, 'en').days), 252);
}

function testNamesInLanguages() {
  const newYear = (lang: string) => generateWorkingDays('FR', null, 2026, lang).holidays[0].name;
  assert.equal(newYear('fr'), 'Nouvel An');
  assert.equal(newYear('de'), 'Neujahr');
  assert.equal(newYear('es'), 'Año Nuevo');
  assert.equal(newYear('fr-FR'), 'Nouvel An', 'a regional tag reads as its language');
  // The days do not depend on the language.
  assert.deepEqual(generateWorkingDays('DE', 'BY', 2026, 'es').days, generateWorkingDays('DE', 'BY', 2026, 'en').days);
  assert.equal(generateWorkingDays('DE', 'BY', 2026, 'es').holidays[1].name, 'Día de los Reyes Magos');

  assert.equal(countryName('DE', 'fr'), 'Allemagne');
  assert.equal(countryName('NL', 'es'), 'Países Bajos');
  assert.equal(countryName('FR', 'de'), 'Frankreich');
  assert.equal(countryName('IT', 'en'), 'Italy');
  assert.equal(countryName('us', 'xx'), 'United States', 'an unknown language falls back to English');
  assert.equal(countryName('ZZ', 'fr'), 'ZZ', 'an unknown country reads as its code');
  assert.equal(regionName('FR', '57', 'fr'), 'Département Moselle');
  assert.equal(regionName('DE', 'by', 'de'), 'Bayern');
  // Region names are the package's: where it has one name only, every language reads it.
  assert.equal(regionName('DE', 'BY', 'en'), 'Bayern');
  assert.equal(regionName('FR', 'XX', 'en'), 'XX', 'an unknown region reads as its code');

  const french = listCountries('fr');
  assert.equal(french.length, 207);
  assert.equal(listCountries('fr-FR'), french, 'cached per language');
  const names = french.map((country) => country.name);
  const collator = new Intl.Collator(['fr', 'en'], { sensitivity: 'base' });
  assert.deepEqual(names, [...names].sort((a, b) => collator.compare(a, b)), 'sorted by name in the language');
  const france = french.find((country) => country.code === 'FR')!;
  assert.equal(france.name, 'France');
  assert.deepEqual(france.regions.map((region) => region.code).sort(), ['57', '67', '68', 'BL', 'GF', 'GP', 'MF', 'MQ', 'RE', 'YT']);
  assert.equal(french.find((country) => country.code === 'DE')!.regions.length, 16);
  assert.equal(french.find((country) => country.code === 'NL')!.name, 'Pays-Bas');
}

function testUnknownRefused() {
  assert.equal(isKnownCountry('FR'), true);
  assert.equal(isKnownCountry('fr'), true);
  assert.equal(isKnownCountry('ZZ'), false);
  assert.equal(isKnownCountry(''), false);
  assert.equal(isKnownRegion('FR', '57'), true);
  assert.equal(isKnownRegion('DE', 'by'), true);
  assert.equal(isKnownRegion('FR', 'BY'), false, 'a region of another country');
  assert.equal(isKnownRegion('ZZ', '57'), false);
  assert.equal(canonicalCountry(' fr '), 'FR');
  assert.equal(canonicalRegion('de', 'by'), 'BY');
  assert.equal(canonicalRegion('FR', ''), null);

  assert.throws(() => generateWorkingDays('ZZ', null, 2026, 'en'), /country ZZ/);
  assert.throws(() => generateWorkingDays('FR', 'BY', 2026, 'en'), /region BY/);
  assert.throws(() => generateWorkingDays('FR', null, 1999, 'en'), /2000 to 2100/);
  assert.throws(() => generateWorkingDays('FR', null, 2101, 'en'), /2000 to 2100/);
  assert.throws(() => generateWorkingDays('FR', null, 2026.5, 'en'), /2000 to 2100/);
  // The limits themselves are years.
  assert.equal(generateWorkingDays('FR', null, 2000, 'en').days.length, 12);
  assert.equal(generateWorkingDays('FR', null, 2100, 'en').days.length, 12);
}

function testTimeZoneAndCache() {
  const paris = generateWorkingDays('FR', null, 2026, 'en');
  // A fresh computation (another language, so no cache) in the zones at both ends of the clock.
  for (const [zone, lang] of [['Pacific/Kiritimati', 'it'], ['Pacific/Pago_Pago', 'nl'], ['UTC', 'pt']] as const) {
    process.env.TZ = zone;
    const other = generateWorkingDays('FR', null, 2026, lang);
    assert.deepEqual(other.days, paris.days, zone);
    assert.deepEqual(other.holidays.map((holiday) => holiday.date), paris.holidays.map((holiday) => holiday.date), zone);
  }
  process.env.TZ = 'Europe/Paris';

  // A result handed out is a copy: changing it leaves the cache as it was.
  const first = generateWorkingDays('FR', null, 2026, 'en');
  first.days[0] = '0';
  first.holidays[0].name = 'Changed';
  const again = generateWorkingDays('FR', null, 2026, 'en');
  assert.equal(again.days[0], '21');
  assert.equal(again.holidays[0].name, "New Year's Day");

  assert.equal(holidayLanguage('FR-fr'), 'fr');
  assert.equal(holidayLanguage(undefined), 'en');
  assert.equal(holidayLanguage('  '), 'en');
  assert.equal(holidayLanguage('de_DE'), 'de');
}

function main() {
  testFrance2026();
  testRegionsAndCountries();
  testLeapFebruary();
  testMultiDayHolidays();
  testPartialDayHolidays();
  testNamesInLanguages();
  testUnknownRefused();
  testTimeZoneAndCache();
  console.log('public-holidays.spec: ok');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
