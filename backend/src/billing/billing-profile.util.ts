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

/** The prefix an EU VAT number starts with: the country code, except Greece (EL). */
function euVatPrefix(country: string): string {
  return country === 'GR' ? 'EL' : country;
}

/** Local format check: country prefix followed by 2 to 12 letters or digits. */
export function isValidEuVatNumber(country: string | null | undefined, vatNumber: string | null | undefined): boolean {
  const iso = toIsoCountry(country);
  if (!iso || !EU_COUNTRIES.has(iso)) return false;
  const value = normaliseVatNumber(vatNumber);
  const prefix = euVatPrefix(iso);
  return value.startsWith(prefix) && /^[A-Z0-9]{2,12}$/.test(value.slice(prefix.length));
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
