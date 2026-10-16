import type { ContactRole } from '../contacts/contactModel';

export const SUPPLIERS_PATH = '/master-data/suppliers';

export type Supplier = {
  id: string;
  name: string;
  erp_supplier_id: string | null;
  notes: string | null;
  status: string;
  disabled_at: string | null;
};

export type SupplierPatch = Partial<Omit<Supplier, 'id'>>;

/** A contact linked to the supplier under a contact type (`GET /suppliers/:id/contacts`). */
export type SupplierContactLink = {
  id: string;
  supplier_id: string;
  contact_id: string;
  role: ContactRole;
  is_primary: boolean;
  contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
  };
};

/** A refusal for a name another supplier of the tenant already has (409 `duplicate`). */
export { isDuplicateError } from '../../utils/apiErrorMessage';

/** The address of the contact create form, opened from a supplier with the contact type set. */
export function newContactHref(supplierId: string, role: ContactRole): string {
  const sp = new URLSearchParams({
    supplier_id: supplierId,
    supplier_role: role,
    returnTo: `${SUPPLIERS_PATH}/${supplierId}/contacts`,
  });
  return `/master-data/contacts/new?${sp.toString()}`;
}
