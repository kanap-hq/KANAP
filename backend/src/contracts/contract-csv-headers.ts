import type { CsvLanguage } from '../common/csv-sheet';

/** The columns of the contracts file, in the order the export writes them. */
export const CONTRACT_CSV_COLUMNS = [
  'name', 'company_name', 'supplier_name', 'cost_center', 'start_date', 'duration_months', 'auto_renewal', 'notice_period_months',
  'yearly_amount_at_signature', 'currency', 'billing_frequency', 'status', 'owner_email', 'notes',
] as const;

/**
 * The title of each column in the file's language. The export and the template write it, and the
 * import reads the titles of every language as well as the technical column (`company_name`).
 */
export const CONTRACT_CSV_HEADERS: Record<(typeof CONTRACT_CSV_COLUMNS)[number], Record<CsvLanguage, string>> = {
  name: { en: 'Name', fr: 'Nom', de: 'Name', es: 'Nombre' },
  company_name: { en: 'Company', fr: 'Société', de: 'Unternehmen', es: 'Empresa' },
  supplier_name: { en: 'Supplier', fr: 'Fournisseur', de: 'Lieferant', es: 'Proveedor' },
  cost_center: { en: 'Cost center', fr: 'Centre de coûts', de: 'Kostenstelle', es: 'Centro de coste' },
  start_date: { en: 'Start date', fr: 'Date de début', de: 'Startdatum', es: 'Fecha de inicio' },
  duration_months: { en: 'Duration in months', fr: 'Durée en mois', de: 'Laufzeit in Monaten', es: 'Duración en meses' },
  auto_renewal: { en: 'Auto renewal', fr: 'Reconduction tacite', de: 'Automatische Verlängerung', es: 'Renovación automática' },
  notice_period_months: { en: 'Notice period in months', fr: 'Préavis en mois', de: 'Kündigungsfrist in Monaten', es: 'Preaviso en meses' },
  yearly_amount_at_signature: {
    en: 'Yearly amount at signature', fr: 'Montant annuel à la signature', de: 'Jahresbetrag bei Unterzeichnung', es: 'Importe anual a la firma',
  },
  currency: { en: 'Currency', fr: 'Devise', de: 'Währung', es: 'Moneda' },
  billing_frequency: { en: 'Billing frequency', fr: 'Fréquence de facturation', de: 'Abrechnungsintervall', es: 'Frecuencia de facturación' },
  status: { en: 'Status', fr: 'Statut', de: 'Status', es: 'Estado' },
  owner_email: { en: 'Owner email', fr: 'E-mail du responsable', de: 'E-Mail des Verantwortlichen', es: 'Correo del responsable' },
  notes: { en: 'Notes', fr: 'Notes', de: 'Notizen', es: 'Notas' },
};
