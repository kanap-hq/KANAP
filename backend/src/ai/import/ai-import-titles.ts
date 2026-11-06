import type { CsvLanguage } from '../../common/csv-sheet';

type Titles = Record<CsvLanguage, string>;

/**
 * Titles of the template columns whose import names them by their technical column only (`parent_code`):
 * the card and the template description show them in the person's language.
 */
const COLUMN_TITLES: Record<string, Titles> = {
  name: { en: 'Name', fr: 'Nom', de: 'Name', es: 'Nombre' },
  title: { en: 'Title', fr: 'Titre', de: 'Titel', es: 'Título' },
  description: { en: 'Description', fr: 'Description', de: 'Beschreibung', es: 'Descripción' },
  notes: { en: 'Notes', fr: 'Notes', de: 'Notizen', es: 'Notas' },
  status: { en: 'Status', fr: 'Statut', de: 'Status', es: 'Estado' },
  disabled_at: { en: 'Disabled on', fr: 'Désactivé le', de: 'Deaktiviert am', es: 'Desactivado el' },
  code: { en: 'Code', fr: 'Code', de: 'Code', es: 'Código' },
  kind: { en: 'Type', fr: 'Type', de: 'Typ', es: 'Tipo' },
  company_name: { en: 'Company', fr: 'Société', de: 'Unternehmen', es: 'Empresa' },
  department_name: { en: 'Department', fr: 'Département', de: 'Abteilung', es: 'Departamento' },
  supplier_name: { en: 'Supplier', fr: 'Fournisseur', de: 'Lieferant', es: 'Proveedor' },
  supplier_erp_id: { en: 'Supplier ERP id', fr: 'ID fournisseur ERP', de: 'ERP-Lieferantennummer', es: 'ID de proveedor en el ERP' },
  source_name: { en: 'Source', fr: 'Source', de: 'Quelle', es: 'Origen' },
  category_name: { en: 'Category', fr: 'Catégorie', de: 'Kategorie', es: 'Categoría' },
  stream_name: { en: 'Stream', fr: 'Filière', de: 'Stream', es: 'Línea' },
  purpose: { en: 'Purpose', fr: 'Objectif', de: 'Zweck', es: 'Objetivo' },
  requestor_email: { en: 'Requestor e-mail', fr: 'E-mail du demandeur', de: 'E-Mail des Antragstellers', es: 'Correo del solicitante' },
  target_delivery_date: { en: 'Target delivery date', fr: 'Date de livraison cible', de: 'Geplantes Lieferdatum', es: 'Fecha de entrega prevista' },
  business_sponsor_email: {
    en: 'Business sponsor e-mail', fr: 'E-mail du sponsor métier', de: 'E-Mail des fachlichen Sponsors', es: 'Correo del patrocinador de negocio',
  },
  business_lead_email: {
    en: 'Business lead e-mail', fr: 'E-mail du responsable métier', de: 'E-Mail der fachlichen Leitung', es: 'Correo del responsable de negocio',
  },
  it_sponsor_email: { en: 'IT sponsor e-mail', fr: 'E-mail du sponsor IT', de: 'E-Mail des IT-Sponsors', es: 'Correo del patrocinador de TI' },
  it_lead_email: { en: 'IT lead e-mail', fr: 'E-mail du responsable IT', de: 'E-Mail der IT-Leitung', es: 'Correo del responsable de TI' },
  risks: { en: 'Risks', fr: 'Risques', de: 'Risiken', es: 'Riesgos' },
  current_situation: { en: 'Current situation', fr: 'Situation actuelle', de: 'Aktuelle Situation', es: 'Situación actual' },
  expected_benefits: { en: 'Expected benefits', fr: 'Bénéfices attendus', de: 'Erwarteter Nutzen', es: 'Beneficios esperados' },
  priority_override: { en: 'Priority override', fr: 'Priorité forcée', de: 'Priorität überschrieben', es: 'Prioridad forzada' },
  override_value: { en: 'Override value', fr: 'Valeur forcée', de: 'Überschriebener Wert', es: 'Valor forzado' },
  override_justification: {
    en: 'Override justification', fr: 'Justification du forçage', de: 'Begründung der Überschreibung', es: 'Justificación del forzado',
  },
  related_object_type: { en: 'Related record type', fr: "Type de l'élément lié", de: 'Typ des verknüpften Datensatzes', es: 'Tipo del registro vinculado' },
  related_object_id: { en: 'Related record id', fr: "ID de l'élément lié", de: 'ID des verknüpften Datensatzes', es: 'ID del registro vinculado' },
  related_object_name: { en: 'Related record', fr: 'Élément lié', de: 'Verknüpfter Datensatz', es: 'Registro vinculado' },
  phase_name: { en: 'Phase', fr: 'Phase', de: 'Phase', es: 'Fase' },
  task_type_name: { en: 'Task type', fr: 'Type de tâche', de: 'Aufgabentyp', es: 'Tipo de tarea' },
  priority_level: { en: 'Priority', fr: 'Priorité', de: 'Priorität', es: 'Prioridad' },
  assignee_email: { en: 'Assignee e-mail', fr: 'E-mail du responsable', de: 'E-Mail des Zuständigen', es: 'Correo del asignado' },
  owner_email: { en: 'Owner e-mail', fr: 'E-mail du responsable', de: 'E-Mail des Verantwortlichen', es: 'Correo del responsable' },
  start_date: { en: 'Start date', fr: 'Date de début', de: 'Startdatum', es: 'Fecha de inicio' },
  due_date: { en: 'Due date', fr: 'Échéance', de: 'Fälligkeitsdatum', es: 'Fecha límite' },
  labels: { en: 'Labels', fr: 'Étiquettes', de: 'Labels', es: 'Etiquetas' },
  first_name: { en: 'First name', fr: 'Prénom', de: 'Vorname', es: 'Nombre' },
  last_name: { en: 'Last name', fr: 'Nom', de: 'Nachname', es: 'Apellido' },
  job_title: { en: 'Job title', fr: 'Fonction', de: 'Funktion', es: 'Cargo' },
  email: { en: 'E-mail', fr: 'E-mail', de: 'E-Mail', es: 'Correo' },
  phone: { en: 'Phone', fr: 'Téléphone', de: 'Telefon', es: 'Teléfono' },
  mobile: { en: 'Mobile', fr: 'Mobile', de: 'Mobil', es: 'Móvil' },
  country: { en: 'Country', fr: 'Pays', de: 'Land', es: 'País' },
  country_iso: { en: 'Country', fr: 'Pays', de: 'Land', es: 'País' },
  active: { en: 'Active', fr: 'Actif', de: 'Aktiv', es: 'Activo' },
  address1: { en: 'Address', fr: 'Adresse', de: 'Adresse', es: 'Dirección' },
  address2: { en: 'Address line 2', fr: "Complément d'adresse", de: 'Adresszusatz', es: 'Dirección, línea 2' },
  postal_code: { en: 'Postal code', fr: 'Code postal', de: 'Postleitzahl', es: 'Código postal' },
  city: { en: 'City', fr: 'Ville', de: 'Ort', es: 'Ciudad' },
  state: { en: 'State or region', fr: 'État ou région', de: 'Bundesland oder Region', es: 'Estado o región' },
  reg_number: { en: 'Registration number', fr: "N° d'immatriculation", de: 'Registernummer', es: 'Número de registro' },
  vat_number: { en: 'VAT number', fr: 'N° de TVA', de: 'USt-IdNr.', es: 'NIF-IVA' },
  base_currency: { en: 'Base currency', fr: 'Devise de base', de: 'Basiswährung', es: 'Moneda base' },
  currency: { en: 'Currency', fr: 'Devise', de: 'Währung', es: 'Moneda' },
  parent_code: { en: 'Parent code', fr: 'Code parent', de: 'Übergeordneter Code', es: 'Código padre' },
  parent_name: { en: 'Parent', fr: 'Parent', de: 'Übergeordnet', es: 'Padre' },
  coa_code: { en: 'Chart of accounts', fr: 'Plan comptable', de: 'Kontenplan', es: 'Plan de cuentas' },
  account_number: { en: 'Account number', fr: 'N° de compte', de: 'Kontonummer', es: 'Número de cuenta' },
  account_name: { en: 'Account name', fr: 'Nom du compte', de: 'Kontoname', es: 'Nombre de la cuenta' },
  native_name: { en: 'Native name', fr: 'Nom natif', de: 'Originalname', es: 'Nombre original' },
  consolidation_account_number: {
    en: 'Consolidation account number', fr: 'N° de compte de consolidation', de: 'Konsolidierungskontonummer', es: 'Número de cuenta de consolidación',
  },
  consolidation_account_name: {
    en: 'Consolidation account name', fr: 'Nom du compte de consolidation', de: 'Name des Konsolidierungskontos', es: 'Nombre de la cuenta de consolidación',
  },
  consolidation_account_description: {
    en: 'Consolidation account description',
    fr: 'Description du compte de consolidation',
    de: 'Beschreibung des Konsolidierungskontos',
    es: 'Descripción de la cuenta de consolidación',
  },
  nature: { en: 'Nature', fr: 'Nature', de: 'Art', es: 'Naturaleza' },
  axis_code: { en: 'Dimension', fr: 'Dimension', de: 'Dimension', es: 'Dimensión' },
  applies_to: { en: 'Applies to', fr: "S'applique à", de: 'Gilt für', es: 'Se aplica a' },
  process_type: { en: 'Process type', fr: 'Type de processus', de: 'Prozesstyp', es: 'Tipo de proceso' },
  region: { en: 'Region', fr: 'Région', de: 'Region', es: 'Región' },
  year: { en: 'Year', fr: 'Année', de: 'Jahr', es: 'Año' },
  asset_reference: { en: 'Server reference', fr: 'Référence du serveur', de: 'Serverreferenz', es: 'Referencia del servidor' },
  asset_name: { en: 'Server', fr: 'Serveur', de: 'Server', es: 'Servidor' },
  technology_reference: {
    en: 'Technology reference', fr: 'Référence de la technologie', de: 'Technologiereferenz', es: 'Referencia de la tecnología',
  },
  technology_name: { en: 'Technology', fr: 'Technologie', de: 'Technologie', es: 'Tecnología' },
  version: { en: 'Version', fr: 'Version', de: 'Version', es: 'Versión' },
  operating_system: { en: 'Operating system', fr: "Système d'exploitation", de: 'Betriebssystem', es: 'Sistema operativo' },
  application_reference: {
    en: 'Application reference', fr: "Référence de l'application", de: 'Anwendungsreferenz', es: 'Referencia de la aplicación',
  },
  application_name: { en: 'Application', fr: 'Application', de: 'Anwendung', es: 'Aplicación' },
  cost_center_code: { en: 'Cost center code', fr: 'Code du centre de coûts', de: 'Kostenstellencode', es: 'Código del centro de coste' },
  run_build: { en: 'Run or build', fr: 'Run ou build', de: 'Run oder Build', es: 'Run o build' },
  owner_it_email: { en: 'IT owner e-mail', fr: 'E-mail du responsable IT', de: 'E-Mail des IT-Verantwortlichen', es: 'Correo del responsable de TI' },
  owner_business_email: {
    en: 'Business owner e-mail', fr: 'E-mail du responsable métier', de: 'E-Mail des fachlichen Verantwortlichen', es: 'Correo del responsable de negocio',
  },
  project: { en: 'Project', fr: 'Projet', de: 'Projekt', es: 'Proyecto' },
  effective_start: { en: 'Effective start', fr: "Début d'effet", de: 'Gültig ab', es: 'Inicio de vigencia' },
  end_of_validity: { en: 'End of validity', fr: 'Fin de validité', de: 'Gültig bis', es: 'Fin de vigencia' },
};

/** Columns numbered in the template (`viewer_email_2`): the title, then the number. */
const NUMBERED_TITLES: Record<string, Titles> = {
  viewer_email: { en: 'Viewer e-mail', fr: 'E-mail observateur', de: 'E-Mail Beobachter', es: 'Correo del observador' },
  owner_email: { en: 'Owner e-mail', fr: 'E-mail responsable', de: 'E-Mail Verantwortlicher', es: 'Correo del responsable' },
};

/** Columns of one year (`headcount_2026`): the title, then the year. */
const YEARLY_TITLES: Record<string, Titles> = {
  headcount: { en: 'Headcount', fr: 'Effectif', de: 'Mitarbeiter', es: 'Plantilla' },
  it_users: { en: 'IT users', fr: 'Utilisateurs IT', de: 'IT-Nutzer', es: 'Usuarios de TI' },
  turnover: { en: 'Turnover in millions', fr: "Chiffre d'affaires en millions", de: 'Umsatz in Millionen', es: 'Facturación en millones' },
  budget: { en: 'Budget', fr: 'Budget', de: 'Budget', es: 'Presupuesto' },
  revision: { en: 'Revision', fr: 'Révision', de: 'Revision', es: 'Revisión' },
  forecast: { en: 'Forecast', fr: 'Prévision', de: 'Prognose', es: 'Previsión' },
  actual: { en: 'Actuals', fr: 'Réalisé', de: 'Ist-Werte', es: 'Realizado' },
  landing: { en: 'Expected landing', fr: 'Atterrissage prévu', de: 'Erwarteter Endwert', es: 'Aterrizaje previsto' },
};

/** The months of the working-day calendars (`jan` to `dec`). */
const MONTH_COLUMNS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthTitle(month: number, language: CsvLanguage): string {
  const name = new Intl.DateTimeFormat(language, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month, 1)));
  return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
}

/** A template column's title in the language, for the imports that name their columns by key only; null when none is known. */
export function defaultColumnTitle(column: string, language: CsvLanguage): string | null {
  const plain = COLUMN_TITLES[column];
  if (plain) return plain[language];
  const month = MONTH_COLUMNS.indexOf(column);
  if (month >= 0) return monthTitle(month, language);
  const numbered = /^(.+)_(\d)$/.exec(column);
  if (numbered && NUMBERED_TITLES[numbered[1]]) return `${NUMBERED_TITLES[numbered[1]][language]} ${numbered[2]}`;
  const yearly = /^(.+)_(\d{4})$/.exec(column);
  if (yearly && YEARLY_TITLES[yearly[1]]) return `${YEARLY_TITLES[yearly[1]][language]} ${yearly[2]}`;
  return null;
}
