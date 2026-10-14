import { z } from 'zod';
import type { TFunction } from 'i18next';

export const CONTACT_ROLES = ['commercial', 'technical', 'support', 'other'] as const;
export type ContactRole = typeof CONTACT_ROLES[number];
/** The type a supplier choice gives a contact that has none: a supplier never stays without a type. */
export const DEFAULT_CONTACT_ROLE: ContactRole = 'commercial';

export type Contact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string;
  phone: string | null;
  mobile: string | null;
  country: string | null;
  notes: string | null;
  active: boolean;
  supplier_id: string | null;
  supplier_role: ContactRole | null;
  supplier_name?: string | null;
};

export type ContactPatch = Partial<Omit<Contact, 'id' | 'supplier_name'>>;

export const NOTES_MAX_LENGTH = 2000;

export function isContactRole(value: unknown): value is ContactRole {
  return typeof value === 'string' && (CONTACT_ROLES as readonly string[]).includes(value);
}

/** First and last name, or null when the contact has neither. */
export function contactName(contact: Pick<Contact, 'first_name' | 'last_name'>): string | null {
  const name = [contact.first_name, contact.last_name].map((part) => (part ?? '').trim()).filter(Boolean).join(' ');
  return name || null;
}

const emailSchema = z.string().email().max(320);
// A dial code and 7 to 15 digits in all (E.164), spaces allowed.
const PHONE_PATTERN = /^\+?[1-9]\d{6,14}$/;

export function emailError(value: string, t: TFunction): string | undefined {
  return emailSchema.safeParse(value.trim()).success ? undefined : t('master-data:contacts.messages.emailInvalid');
}

export function phoneError(value: string | null, t: TFunction): string | undefined {
  if (!value) return undefined;
  return PHONE_PATTERN.test(value.replace(/\s+/g, '')) ? undefined : t('master-data:contacts.messages.phoneInvalid');
}

/** A return address inside the app only (the supplier page that opened the create form). */
export function safeReturnTo(raw: string | null): string | null {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
}
