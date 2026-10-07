import * as assert from 'node:assert/strict';
import {
  euVatTaxIdValue,
  isEuCountry,
  isValidEuVatNumber,
  missingInvoiceFields,
  type InvoiceProfileContact,
} from '../billing-profile.util';

/**
 * Before a tenant subscribes, its invoice details must hold a company, a valid email,
 * an address with an ISO country code, and an EU VAT number when the country is in
 * the EU. Stripe needs these to send and print the invoice.
 */

type Overrides = Partial<Omit<InvoiceProfileContact, 'address'>> & { address?: Partial<InvoiceProfileContact['address']> };

function contact(overrides: Overrides = {}): InvoiceProfileContact {
  const { address, ...rest } = overrides;
  return {
    company: 'Fromage SAS',
    email: 'billing@fromage-co.com',
    vatNumber: 'FR 12 345678901',
    ...rest,
    address: {
      line1: '1 rue de la Paix',
      postalCode: '75002',
      city: 'Paris',
      country: 'FR',
      ...(address ?? {}),
    },
  };
}

function testCompleteFrenchProfilePasses() {
  assert.deepEqual(missingInvoiceFields(contact()), []);
}

function testFrenchProfileWithoutVatListsVat() {
  assert.deepEqual(missingInvoiceFields(contact({ vatNumber: null })), ['vatNumber']);
  // A number that does not start with the country prefix is malformed.
  assert.deepEqual(missingInvoiceFields(contact({ vatNumber: 'DE123456789' })), ['vatNumber']);
}

function testUsProfileWithoutVatPasses() {
  const us = contact({ vatNumber: null, address: { country: 'US', postalCode: '10001', city: 'New York' } });
  assert.deepEqual(missingInvoiceFields(us), []);
  assert.equal(euVatTaxIdValue(contact({ address: { country: 'US' } })), null);
}

function testFreeTextCountryListsCountry() {
  assert.deepEqual(missingInvoiceFields(contact({ address: { country: 'France' } })), ['country']);
  assert.deepEqual(missingInvoiceFields(contact({ address: { country: 'XX' } })), ['country']);
}

function testGreekVatUsesElPrefix() {
  assert.deepEqual(missingInvoiceFields(contact({ vatNumber: 'EL 123456789', address: { country: 'GR' } })), []);
  assert.deepEqual(missingInvoiceFields(contact({ vatNumber: 'GR123456789', address: { country: 'GR' } })), ['vatNumber']);
  assert.equal(isValidEuVatNumber('GR', 'el-123.456.789'), true);
}

function testVatNumberFollowsTheCountryFormat() {
  // Looser numbers used to pass the local check and were then refused by Stripe.
  assert.deepEqual(missingInvoiceFields(contact({ vatNumber: 'FR12345' })), ['vatNumber']);
  assert.deepEqual(missingInvoiceFields(contact({ vatNumber: 'FR1234567890' })), ['vatNumber']);
  assert.equal(euVatTaxIdValue(contact({ vatNumber: 'FR12345' })), null);

  const valid: Array<[string, string]> = [
    ['FR', 'FR12345678901'],
    ['AT', 'ATU12345678'],
    ['NL', 'NL123456789B01'],
    ['GR', 'EL123456789'],
    ['IE', 'IE1234567T'],
    ['ES', 'ESX1234567L'],
  ];
  for (const [country, vatNumber] of valid) {
    assert.equal(isValidEuVatNumber(country, vatNumber), true, `${vatNumber} is valid for ${country}`);
    assert.deepEqual(missingInvoiceFields(contact({ vatNumber, address: { country } })), [], `${vatNumber} is complete`);
  }
  assert.equal(isValidEuVatNumber('GR', 'GR123456789'), false);
  // A number from another member state does not match the country of the address.
  assert.equal(isValidEuVatNumber('BE', 'NL123456789B01'), false);
}

function testBadEmailListsEmail() {
  assert.deepEqual(missingInvoiceFields(contact({ email: 'billing@fromage' })), ['email']);
  assert.deepEqual(missingInvoiceFields(contact({ email: null })), ['email']);
}

function testEmptyProfileListsEverythingInOrder() {
  const empty: InvoiceProfileContact = {
    company: null,
    email: null,
    vatNumber: null,
    address: { line1: null, postalCode: null, city: null, country: null },
  };
  assert.deepEqual(missingInvoiceFields(empty), ['company', 'email', 'addressLine1', 'postalCode', 'city', 'country']);
}

function testEuHelpers() {
  assert.equal(isEuCountry('fr'), true);
  assert.equal(isEuCountry('CH'), false);
  assert.equal(isEuCountry('France'), false);
  assert.equal(euVatTaxIdValue(contact()), 'FR12345678901');
  // A malformed number saved from the form is not sent to Stripe.
  assert.equal(euVatTaxIdValue(contact({ vatNumber: '12345' })), null);
}

function run() {
  testCompleteFrenchProfilePasses();
  testFrenchProfileWithoutVatListsVat();
  testUsProfileWithoutVatPasses();
  testFreeTextCountryListsCountry();
  testGreekVatUsesElPrefix();
  testVatNumberFollowsTheCountryFormat();
  testBadEmailListsEmail();
  testEmptyProfileListsEverythingInOrder();
  testEuHelpers();
}

run();
