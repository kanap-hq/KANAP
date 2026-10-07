import { isISO31661Alpha2 } from 'class-validator';

/**
 * The invoice details a tenant must fill in before it subscribes, and the EU VAT
 * rules Stripe needs to print the VAT number on its invoices.
 */

/** EU member states (ISO 3166-1 alpha-2). The frontend keeps its own copy. */
export const EU_COUNTRY_CODES: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];

const EU_COUNTRIES = new Set(EU_COUNTRY_CODES);

/** Stable keys of the invoice fields a subscription needs, in display order. */
export type InvoiceFieldKey =
  | 'company'
  | 'email'
  | 'addressLine1'
  | 'postalCode'
  | 'city'
  | 'country'
  | 'vatNumber';

export type InvoiceProfileContact = {
  company: string | null;
  email: string | null;
  vatNumber: string | null;
  address: {
    line1: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  };
};

function filled(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The ISO alpha-2 code of a country value, or null when it is not one ("France", "FRA"). */
export function toIsoCountry(value: string | null | undefined): string | null {
  if (!filled(value)) return null;
  const code = value.trim().toUpperCase();
  return isISO31661Alpha2(code) ? code : null;
}

export function isEuCountry(code: string | null | undefined): boolean {
  const iso = toIsoCountry(code);
  return !!iso && EU_COUNTRIES.has(iso);
}

export function isValidEmail(value: string | null | undefined): boolean {
  return filled(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** A VAT number without spaces, dots and dashes, uppercased. */
export function normaliseVatNumber(value: string | null | undefined): string {
  return String(value ?? '').replace(/[\s.\-]/g, '').toUpperCase();
}

/**
 * VAT number format of each EU member state, as the VIES service defines it, applied to
 * the normalised number (prefix included; Greece uses EL). Stripe's `eu_vat` check
 * refuses a number outside these formats.
 */
const EU_VAT_FORMATS: Readonly<Record<string, RegExp>> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE[01]\d{9}$/,
  BG: /^BG\d{9,10}$/,
  HR: /^HR\d{11}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-HJ-NP-Z0-9]{2}\d{9}$/,
  DE: /^DE\d{9}$/,
  GR: /^EL\d{9}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^IT\d{11}$/,
  LV: /^LV\d{11}$/,
  LT: /^LT(\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SK: /^SK\d{10}$/,
  SI: /^SI\d{8}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  SE: /^SE\d{12}$/,
};

/** Local format check: the VIES format of the country's VAT numbers. */
export function isValidEuVatNumber(country: string | null | undefined, vatNumber: string | null | undefined): boolean {
  const iso = toIsoCountry(country);
  const format = iso ? EU_VAT_FORMATS[iso] : undefined;
  if (!format) return false;
  return format.test(normaliseVatNumber(vatNumber));
}

/**
 * The value to register on the Stripe customer as an `eu_vat` tax id: the normalised
 * VAT number when the country is in the EU and the number is well formed, null
 * otherwise (non-EU numbers stay in KANAP).
 */
export function euVatTaxIdValue(contact: Pick<InvoiceProfileContact, 'vatNumber' | 'address'>): string | null {
  if (!isValidEuVatNumber(contact.address.country, contact.vatNumber)) return null;
  return normaliseVatNumber(contact.vatNumber);
}

/** The invoice fields still missing (or malformed) before the tenant can subscribe. */
export function missingInvoiceFields(contact: InvoiceProfileContact): InvoiceFieldKey[] {
  const missing: InvoiceFieldKey[] = [];
  if (!filled(contact.company)) missing.push('company');
  if (!isValidEmail(contact.email)) missing.push('email');
  if (!filled(contact.address.line1)) missing.push('addressLine1');
  if (!filled(contact.address.postalCode)) missing.push('postalCode');
  if (!filled(contact.address.city)) missing.push('city');
  const country = toIsoCountry(contact.address.country);
  if (!country) missing.push('country');
  if (country && EU_COUNTRIES.has(country) && !isValidEuVatNumber(country, contact.vatNumber)) {
    missing.push('vatNumber');
  }
  return missing;
}
