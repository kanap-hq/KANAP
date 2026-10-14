import * as assert from 'node:assert/strict';
import {
  INVOICE_OPERATION_NATURE,
  customerSiren,
  invoiceCustomFields,
  invoiceLocale,
  sirenFromFrenchVat,
} from '../invoice-mentions';

/**
 * Every invoice carries the operation nature (in French, for every customer); a French
 * customer's invoice also carries its SIREN, the last 9 digits of its FR VAT number. The
 * invoice language follows the customer's country.
 */

const contact = (country: string | null, vatNumber: string | null) => ({ vatNumber, address: { country } });

function testSirenDerivation() {
  assert.equal(sirenFromFrenchVat('FR12345678901'), '345678901');
  assert.equal(sirenFromFrenchVat('fr 12 345 678 901'), '345678901', 'spaces and lowercase are normalised');
  assert.equal(sirenFromFrenchVat('FR-12.345.678.901'), '345678901');
  assert.equal(sirenFromFrenchVat('FRAB345678901'), '345678901', 'the key may hold letters');
  assert.equal(sirenFromFrenchVat('DE123456789'), null, 'not a French number');
  assert.equal(sirenFromFrenchVat('FR1234567890'), null, 'one digit short');
  assert.equal(sirenFromFrenchVat('FR123456789012'), null, 'one digit too many');
  assert.equal(sirenFromFrenchVat('FR12 3456789O1'), null, 'a letter in the SIREN');
  assert.equal(sirenFromFrenchVat(''), null);
  assert.equal(sirenFromFrenchVat(null), null);
  assert.equal(sirenFromFrenchVat(undefined), null);
}

function testCustomFieldsForAFrenchCustomer() {
  assert.deepEqual(invoiceCustomFields(contact('FR', 'FR 12 345678901')), [
    { name: "Nature de l'opération", value: 'Prestation de services' },
    { name: 'SIREN', value: '345678901' },
  ]);
  assert.equal(customerSiren(contact('fr', 'FR12345678901')), '345678901', 'a lowercase country code is French too');
}

function testCustomFieldsWithoutSiren() {
  const natureOnly = [{ name: "Nature de l'opération", value: 'Prestation de services' }];
  assert.deepEqual(invoiceCustomFields(contact('DE', 'DE123456789')), natureOnly);
  assert.deepEqual(invoiceCustomFields(contact('FR', null)), natureOnly, 'no VAT number, no SIREN');
  assert.deepEqual(invoiceCustomFields(contact('BE', 'FR12345678901')), natureOnly, 'SIREN for French customers only');
  assert.deepEqual(invoiceCustomFields(contact(null, null)), natureOnly);
  // The shared constant is never handed out for mutation.
  const fields = invoiceCustomFields(contact('DE', null));
  assert.notEqual(fields[0], INVOICE_OPERATION_NATURE);
}

function testStripeLimits() {
  for (const field of invoiceCustomFields(contact('FR', 'FR12345678901'))) {
    assert.ok(field.name.length <= 40, `name within 40 characters: ${field.name}`);
    assert.ok(field.value.length <= 140, `value within 140 characters: ${field.value}`);
  }
}

function testLocaleMapping() {
  assert.equal(invoiceLocale('FR'), 'fr');
  assert.equal(invoiceLocale('MC'), 'fr');
  assert.equal(invoiceLocale('DE'), 'de');
  assert.equal(invoiceLocale('AT'), 'de');
  assert.equal(invoiceLocale('ES'), 'es');
  assert.equal(invoiceLocale('fr'), 'fr', 'lowercase code');
  assert.equal(invoiceLocale('BE'), 'en');
  assert.equal(invoiceLocale('CH'), 'en');
  assert.equal(invoiceLocale('US'), 'en');
  assert.equal(invoiceLocale('France'), 'en', 'a free-text country is not a code');
  assert.equal(invoiceLocale(null), 'en');
}

testSirenDerivation();
testCustomFieldsForAFrenchCustomer();
testCustomFieldsWithoutSiren();
testStripeLimits();
testLocaleMapping();
