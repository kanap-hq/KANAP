import { normaliseVatNumber, toIsoCountry } from './billing-profile.util';

/** What the mentions read from the invoice details. */
export type InvoiceMentionsContact = { vatNumber: string | null; address: { country: string | null } };

/**
 * Mentions printed on every KANAP invoice, set on the Stripe customer as
 * `invoice_settings.custom_fields` (Stripe copies them onto each new invoice of that
 * customer). Stripe allows 4 fields, a name up to 40 characters, a value up to 140.
 */
export type InvoiceCustomField = { name: string; value: string };

/** French mention required on every invoice, whatever the customer's country. */
export const INVOICE_OPERATION_NATURE: Readonly<InvoiceCustomField> = Object.freeze({
  name: "Nature de l'opération",
  value: 'Prestation de services',
});

/**
 * The SIREN of a French company: the last 9 digits of its FR VAT number
 * (`FR` + 2-character key + SIREN). Null for any other number.
 */
export function sirenFromFrenchVat(vat: string | null | undefined): string | null {
  const match = /^FR[0-9A-Z]{2}(\d{9})$/.exec(normaliseVatNumber(vat));
  return match ? match[1] : null;
}

/** The SIREN to print for this customer: French customers only, derived from the VAT number. */
export function customerSiren(contact: InvoiceMentionsContact): string | null {
  if (toIsoCountry(contact.address.country) !== 'FR') return null;
  return sirenFromFrenchVat(contact.vatNumber);
}

/** The custom fields of the customer's invoices: the operation nature, then the SIREN when known. */
export function invoiceCustomFields(contact: InvoiceMentionsContact): InvoiceCustomField[] {
  const fields: InvoiceCustomField[] = [{ ...INVOICE_OPERATION_NATURE }];
  const siren = customerSiren(contact);
  if (siren) fields.push({ name: 'SIREN', value: siren });
  return fields;
}

const INVOICE_LOCALES: Readonly<Record<string, string>> = {
  FR: 'fr',
  MC: 'fr',
  DE: 'de',
  AT: 'de',
  ES: 'es',
};

/** The language of the customer's invoices and Stripe emails, from its country; English otherwise. */
export function invoiceLocale(country: string | null | undefined): string {
  const iso = toIsoCountry(country);
  return (iso && INVOICE_LOCALES[iso]) || 'en';
}
