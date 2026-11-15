import type { CsvLanguage } from '../common/csv-sheet';

/**
 * The columns of the suppliers file after its reference, in the order the export writes them: those
 * a file from elsewhere carries, and the assistant's import maps (it leaves the reference out).
 */
export const SUPPLIER_CSV_COLUMNS = [
  'name', 'erp_supplier_id', 'commercial_contact', 'technical_contact', 'support_contact', 'notes', 'status', 'disabled_at',
] as const;

/**
 * Every column of the file the export writes: the supplier's reference (`SUP-12`) first. On import
 * it is optional; filled, it names the supplier the row updates.
 */
export const SUPPLIER_FILE_COLUMNS = ['reference', ...SUPPLIER_CSV_COLUMNS] as const;

/**
 * The title of each column in the file's language. The export and the template write it, and the
 * import reads the titles of every language as well as the technical column (`erp_supplier_id`).
 */
export const SUPPLIER_CSV_HEADERS: Record<(typeof SUPPLIER_FILE_COLUMNS)[number], Record<CsvLanguage, string>> = {
  reference: { en: 'Reference', fr: 'Référence', de: 'Referenz', es: 'Referencia' },
  name: { en: 'Name', fr: 'Nom', de: 'Name', es: 'Nombre' },
  erp_supplier_id: { en: 'ERP supplier ID', fr: 'ID fournisseur ERP', de: 'ERP-Lieferanten-ID', es: 'ID de proveedor ERP' },
  commercial_contact: { en: 'Commercial contact', fr: 'Contact commercial', de: 'Kaufmännischer Kontakt', es: 'Contacto comercial' },
  technical_contact: { en: 'Technical contact', fr: 'Contact technique', de: 'Technischer Kontakt', es: 'Contacto técnico' },
  support_contact: { en: 'Support contact', fr: 'Contact support', de: 'Support-Kontakt', es: 'Contacto de soporte' },
  notes: { en: 'Notes', fr: 'Notes', de: 'Notizen', es: 'Notas' },
  status: { en: 'Status', fr: 'Statut', de: 'Status', es: 'Estado' },
  disabled_at: { en: 'Disabled on', fr: 'Désactivé le', de: 'Deaktiviert am', es: 'Desactivado el' },
};
