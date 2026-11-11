// What the Fromage & Co data set translates (tools/translate-dataset.mjs).
//
// English is the source. Only the columns listed here are translated, whole cells, through the
// translation memory of each language (translations/<language>.json). Every other column stays
// as it is: identifiers, codes, e-mail addresses, enum values, amounts, dates, and the names of
// companies, people, suppliers, applications and assets. A column that names a record another
// file or the runner looks up (a budget line, a project, a department, an incident) is listed
// in every file that names it, so the same memory gives the same name everywhere.
//
// Not listed on purpose: the `analytics:*` columns of the budget files and 27-analytics-values.csv
// (fixture-dimensions.mjs names those values in the tenant's seed language), the consolidation
// columns of the charts of accounts (the API derives them from the group chart), and the asset
// kinds (the file names them in English so the runner can match the IT operations settings; the
// kinds the fixture adds are named in the dataset language through t() in the runner).

/** The languages the data set is generated in, besides English. */
export const TRANSLATED_LANGUAGES = ['fr', 'de', 'es'];

/**
 * Per CSV file, its translated columns. A `{ column, markdown: true }` entry is a Markdown text,
 * translated block by block (see translateMarkdown).
 */
export const TRANSLATED_COLUMNS = {
  '01-companies.csv': ['notes'],
  '03-accounts-fr.csv': ['account_name', 'description'],
  '04-accounts-nl.csv': ['account_name', 'description'],
  '05-accounts-it.csv': ['account_name', 'description'],
  '06-accounts-us.csv': ['account_name', 'description'],
  '07-suppliers.csv': ['notes'],
  '08-departments.csv': ['name', 'description'],
  '09-contacts.csv': ['job_title', 'notes'],
  '10-users.csv': ['department_name'],
  '11-business-processes.csv': ['name', 'parent_name', 'description', 'notes'],
  '12-applications.csv': ['description', 'notes', 'classification_justification'],
  '13-contracts.csv': ['name', 'notes'],
  '14-spend-items.csv': ['product_name', 'description', 'notes'],
  '15-capex-items.csv': ['product_name', 'description', 'notes'],
  '16-portfolio-projects.csv': ['name', 'purpose', 'source_name', 'category_name', 'stream_name', 'department_name'],
  '17-portfolio-requests.csv': [
    'name', 'purpose', 'source_name', 'category_name', 'stream_name', 'department_name',
    'current_situation', 'expected_benefits', 'risks',
  ],
  '18-assets.csv': ['notes'],
  '19-tasks.csv': ['title', 'description', 'related_object_name', 'labels'],
  '19b-incident-tasks.csv': ['title', 'description', 'labels'],
  '20-app-instances.csv': ['notes'],
  '21-interfaces.csv': ['name', 'business_purpose'],
  '22-interface-bindings.csv': ['trigger_details', 'env_notes'],
  '23-connections.csv': ['name', 'description'],
  '24-connection-legs.csv': ['notes'],
  '25-interface-connection-links.csv': ['notes'],
  '26-cost-centers.csv': ['name', 'description'],
  '28-working-day-calendars.csv': ['name', 'description'],
  '29-budget-rows.csv': ['item_name'],
  '30-costed-lines.csv': ['item_name', 'label'],
  '31-incidents.csv': ['title', 'description', { column: 'review', markdown: true }, 'notified_parties'],
  '32-incident-journal.csv': ['incident_title', 'content'],
};

/** The Service Desk documents (docs/), translated block by block. */
export const TRANSLATED_DOCS = [
  'docs/caveguard-alert-runbook.md',
  'docs/guest-wifi-visitors.md',
  'docs/label-printer-troubleshooting.md',
  'docs/sap-access-request.md',
  'docs/vpn-remote-access.md',
];

/** The runner, whose `t('…')` texts are translated too. */
export const RUNNER_FILES = ['setup-tenant.mjs', 'demand-scores.mjs', 'sample-story.mjs'];
