// Parts of the Fromage & Co story the runner (setup-tenant.mjs) writes through the API rather
// than from a CSV file: the service desk agent, the contracts that cover an application, and the
// dates of the project converted from the cave demand. Texts go through the runner's `t`, so the
// translation generator reads them here (translations/fields.mjs, RUNNER_FILES).

/** The service desk agent and its shared context, as the agent pages show them. */
export function serviceDeskAgentTexts(t) {
  return {
    name: t('Fromage Service Desk Agent'),
    description: t('Triages inbound IT tickets, searches company knowledge, and prepares source-cited replies for technician approval.'),
    sharedContext: {
      name: t('Fromage & Co Company Context'),
      description: t('Shared facts about Fromage & Co for all agents'),
      lines: [
        t('Fromage & Co is a European cheese group: Fromage & Co SA (France, HQ), Kaasmeester BV (Netherlands), Formaggio Supremo SRL (Italy), Fromage & Co Inc. (US).'),
        t('Core systems: SAP S/4HANA (ERP, production), Salesforce (CRM), Microsoft 365 (collaboration), Workday HCM (HR), ServiceNow (ITSM).'),
        t('The Paris Data Center (PAR-DC1) hosts SAP production; site firewalls are FortiGate appliances.'),
        t('Business hours are 08:00-18:00 CET; the production sites in Paris and Parma run until 22:00.'),
        t('IT service desk language is English; requesters may write in French, Dutch or Italian.'),
      ],
    },
    persona: {
      mission: t('Support the Fromage & Co IT service desk: triage incoming tickets, investigate using the IT landscape, and prepare source-cited replies for technician approval.'),
      instructions: [
        t('Always cite the evidence used for a conclusion.'),
        t('Prefer an internal note when evidence is incomplete or confidence is low.'),
        t('Never promise delivery dates; route scheduling questions to the service desk lead.'),
      ],
      tone: t('Professional, concise and friendly; address requesters by first name.'),
      escalationGuidance: t('Escalate security incidents and anything touching SAP production to Pierre Martin.'),
    },
  };
}

/**
 * The applications each contract covers, by the English names of 13-contracts.csv (translated by
 * the runner) and 12-applications.csv (application names are not translated).
 */
export const CONTRACT_APPLICATIONS = {
  'SAP Maintenance & Support': ['SAP S/4HANA', 'SAP BW/4HANA', 'SAP Concur'],
  'Broadcom VMware ELA': ['VMware vSphere'],
  'Nearshore Digital — development': ['Cornerstone OnDemand'],
};

/**
 * The project converted from the Cave Climate Digital Twin demand. Dates of the dataset year,
 * moved like the dataset when they are sent. It started with its first phase, which is completed.
 */
export const CAVE_PROJECT = {
  planned_start: '2026-02-01',
  planned_end: '2027-09-30',
  actual_start: '2026-02-01',
};

/** The cave project's phases: name, planned start, planned end, status. */
export function caveProjectPhases(t) {
  return [
    [t('Sensor history baseline'), '2026-02-01', '2026-06-30', 'completed'],
    [t('Airflow and temperature model'), '2026-05-01', '2026-12-31', 'in_progress'],
    [t('Cave master review'), '2026-10-01', '2027-03-31', 'pending'],
    [t('Remote cave management'), '2027-01-15', '2027-09-30', 'pending'],
  ];
}
