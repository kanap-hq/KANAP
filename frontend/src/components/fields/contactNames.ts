import { formatItemRef } from '../../utils/item-ref';

/** A typed reference (`CTCT-12`) names a contact to find, never one to create. */
const CONTACT_REFERENCE = new RegExp(`^${formatItemRef('contact', 0).replace(/0$/, '')}\\d+$`, 'i');

export function isContactReference(text: string): boolean {
  return CONTACT_REFERENCE.test(text.trim());
}

/** A contact is named, never shown by email: the email only stands in for a contact with no name. */
export function contactName(c: { first_name?: string | null; last_name?: string | null; email: string }): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email;
}
