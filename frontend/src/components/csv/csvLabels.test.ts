import { describe, expect, it } from 'vitest';
import en from '../../locales/en/common.json';
import fr from '../../locales/fr/common.json';
import de from '../../locales/de/common.json';
import es from '../../locales/es/common.json';
import { csvEntityOf, csvFieldLabel, csvGroupLabel, csvPresetLabel } from './csvLabels';

// A `t` that knows a few keys, and answers the key itself for the others (as i18next does without a default).
const known: Record<string, string> = {
  'csv.fields.applications.name': 'Nom',
  'csv.groups.overview': 'Vue d’ensemble',
  'csv.presets.applications.enrichment': 'Enrichissement des données',
};
const t = ((key: string, options?: { defaultValue?: string }) => known[key] ?? options?.defaultValue ?? key) as never;
const keyOnly = ((key: string) => known[key] ?? key) as never;

describe('csv labels', () => {
  it('names the entity of an endpoint', () => {
    expect(csvEntityOf('/applications')).toBe('applications');
    expect(csvEntityOf('/it/assets?x=1')).toBe('it_assets');
  });

  it('translates a known field, group and preset', () => {
    expect(csvFieldLabel(t, 'applications', { csvColumn: 'name', label: 'Name' })).toBe('Nom');
    expect(csvGroupLabel(t, 'Overview')).toBe('Vue d’ensemble');
    expect(csvPresetLabel(t, 'applications', { name: 'enrichment', label: 'Data Enrichment' })).toBe('Enrichissement des données');
  });

  it('names the asset export in French, including the site and the enrichment preset', () => {
    expect(fr.csv.fields.assets.location_reference).toBe('Site');
    expect(fr.csv.fields.assets.hostname).toBe('Nom d’hôte');
    expect(fr.csv.fields.assets.ip_1_address).toBe('Adresse IP 1');
    expect(fr.csv.groups.ip_addresses).toBe('Adresses IP');
    expect(fr.csv.presets.assets.enrichment).toBe('Enrichissement des données');
  });

  it('falls back to the server label, without the __CLEAR__ hint, whatever t does with a missing key', () => {
    for (const translate of [t, keyOnly]) {
      expect(csvFieldLabel(translate, 'applications', { csvColumn: 'cyber_criticality', label: 'cyber_criticality (__CLEAR__ to clear)' })).toBe('cyber_criticality');
      expect(csvFieldLabel(translate, 'applications', { csvColumn: 'criticality', label: 'Business criticality (code or name; __CLEAR__ to clear)' })).toBe('Business criticality');
      expect(csvGroupLabel(translate, 'Mystery group')).toBe('Mystery group');
      expect(csvPresetLabel(translate, 'assets', { name: 'x', label: 'Server label' })).toBe('Server label');
    }
  });
});

// Columns of the assets and tasks export field lists (asset-csv.config.ts, task-csv.config.ts,
// plus the two vulnerability columns shared with applications).
const ASSET_COLUMNS = [
  'id', 'name', 'location_reference', 'kind', 'is_cluster', 'status', 'go_live_date', 'end_of_life_date', 'notes',
  'environment', 'hostname', 'domain', 'admin_zone', 'aliases', 'operating_system', 'cluster',
  'ip_1_type', 'ip_1_address', 'ip_1_subnet_cidr',
  'ip_2_type', 'ip_2_address', 'ip_2_subnet_cidr',
  'ip_3_type', 'ip_3_address', 'ip_3_subnet_cidr',
  'ip_4_type', 'ip_4_address', 'ip_4_subnet_cidr',
  'vulnerabilities_to_review', 'severe_vulnerabilities',
];
const TASK_COLUMNS = [
  'id', 'title', 'description', 'task_type_name',
  'related_object_type', 'related_object_id', 'related_object_name',
  'phase_name', 'priority_level', 'category_name', 'stream_name', 'source_name', 'company_name',
  'status', 'start_date', 'due_date', 'assignee_email', 'creator_email',
  'viewer_email_1', 'viewer_email_2', 'viewer_email_3', 'viewer_email_4',
  'owner_email_1', 'owner_email_2', 'owner_email_3', 'owner_email_4',
  'labels',
];
const NEW_GROUPS = ['basic', 'context', 'dates', 'ip_addresses'];

type CsvLocale = {
  csv: {
    fields: { assets: Record<string, string>; tasks: Record<string, string> };
    groups: Record<string, string>;
    presets: { assets: { enrichment: string }; tasks: { enrichment: string } };
  };
};

/** A `t` that reads one common locale the way i18next does, and falls back like a missing key. */
function tOf(locale: object) {
  return ((key: string, options?: { defaultValue?: string }) => {
    const value = key.split('.').reduce<unknown>((node, part) => (
      node && typeof node === 'object' && part in (node as Record<string, unknown>)
        ? (node as Record<string, unknown>)[part]
        : undefined
    ), locale);
    return typeof value === 'string' ? value : (options?.defaultValue ?? key);
  }) as never;
}

describe('assets and tasks export labels', () => {
  const locales = { en: en as CsvLocale, fr: fr as CsvLocale, de: de as CsvLocale, es: es as CsvLocale };

  it('names every field, group and preset in the four languages', () => {
    const englishAssets = Object.keys(locales.en.csv.fields.assets).sort();
    const englishTasks = Object.keys(locales.en.csv.fields.tasks).sort();
    expect(englishAssets).toEqual([...ASSET_COLUMNS].sort());
    expect(englishTasks).toEqual([...TASK_COLUMNS].sort());
    for (const locale of Object.values(locales)) {
      expect(Object.keys(locale.csv.fields.assets).sort()).toEqual(englishAssets);
      expect(Object.keys(locale.csv.fields.tasks).sort()).toEqual(englishTasks);
      for (const column of ASSET_COLUMNS) expect(locale.csv.fields.assets[column]).not.toBe('');
      for (const column of TASK_COLUMNS) expect(locale.csv.fields.tasks[column]).not.toBe('');
      for (const group of NEW_GROUPS) expect(locale.csv.groups[group]).not.toBe('');
      expect(locale.csv.presets.assets.enrichment).not.toBe('');
      expect(locale.csv.presets.tasks.enrichment).not.toBe('');
    }
  });

  it('shows the screen language instead of the server labels', () => {
    const french = tOf(locales.fr);
    expect(csvEntityOf('/assets')).toBe('assets');
    expect(csvEntityOf('/tasks')).toBe('tasks');
    expect(csvFieldLabel(french, 'assets', { csvColumn: 'ip_1_address', label: 'IP 1 Address' })).toBe('Adresse IP 1');
    expect(csvFieldLabel(french, 'assets', { csvColumn: 'operating_system', label: 'Operating System' })).toBe('Système d’exploitation');
    expect(csvGroupLabel(french, 'IP Addresses')).toBe('Adresses IP');
    expect(csvPresetLabel(french, 'assets', { name: 'enrichment', label: 'Data Enrichment' })).toBe('Enrichissement des données');
    expect(csvFieldLabel(french, 'tasks', { csvColumn: 'task_type_name', label: 'Task Type' })).toBe('Type de tâche');
    expect(csvGroupLabel(french, 'Basic')).toBe('Informations de base');
    expect(csvPresetLabel(french, 'tasks', { name: 'enrichment', label: 'Data Enrichment' })).toBe('Enrichissement des données');

    const english = tOf(locales.en);
    expect(csvFieldLabel(english, 'assets', { csvColumn: 'operating_system', label: 'Operating System' })).toBe('Operating system');
    expect(csvFieldLabel(english, 'assets', { csvColumn: 'is_cluster', label: 'Is Cluster' })).toBe('Is a cluster');
    expect(csvFieldLabel(english, 'tasks', { csvColumn: 'related_object_type', label: 'Related Object Type' })).toBe('Related object type');
    expect(csvGroupLabel(english, 'IP Addresses')).toBe('IP addresses');
    expect(csvPresetLabel(english, 'tasks', { name: 'enrichment', label: 'Data Enrichment' })).toBe('Data enrichment');
  });
});

// Columns of the portfolio project and request export field lists
// (portfolio-project-csv.config.ts, portfolio-request-csv.config.ts).
const PROJECT_COLUMNS = [
  'id', 'name', 'status', 'purpose', 'origin',
  'source_name', 'category_name', 'stream_name', 'company_name', 'department_name',
  'planned_start', 'planned_end', 'actual_start', 'actual_end', 'baseline_start_date', 'baseline_end_date',
  'execution_progress',
  'estimated_effort_it', 'estimated_effort_business',
  'actual_effort_it', 'actual_effort_business',
  'baseline_effort_it', 'baseline_effort_business',
  'business_sponsor_email', 'business_lead_email', 'it_sponsor_email', 'it_lead_email',
  'criteria_values', 'priority_score', 'priority_override', 'override_value', 'override_justification',
];
const REQUEST_COLUMNS = [
  'id', 'name', 'status', 'purpose',
  'source_name', 'category_name', 'stream_name', 'requestor_email', 'company_name', 'department_name',
  'target_delivery_date', 'current_situation', 'expected_benefits', 'risks',
  'business_sponsor_email', 'business_lead_email', 'it_sponsor_email', 'it_lead_email',
  'criteria_values', 'priority_score', 'priority_override', 'override_value', 'override_justification',
];
const PORTFOLIO_GROUPS = ['effort', 'team', 'scoring', 'analysis'];

type PortfolioCsvLocale = {
  csv: {
    fields: { portfolio_projects: Record<string, string>; portfolio_requests: Record<string, string> };
    groups: Record<string, string>;
    presets: { portfolio_projects: { enrichment: string }; portfolio_requests: { enrichment: string } };
  };
};

describe('project and request export labels', () => {
  const locales = {
    en: en as PortfolioCsvLocale,
    fr: fr as PortfolioCsvLocale,
    de: de as PortfolioCsvLocale,
    es: es as PortfolioCsvLocale,
  };

  it('names every field, group and preset in the four languages', () => {
    const englishProjects = Object.keys(locales.en.csv.fields.portfolio_projects).sort();
    const englishRequests = Object.keys(locales.en.csv.fields.portfolio_requests).sort();
    expect(englishProjects).toEqual([...PROJECT_COLUMNS].sort());
    expect(englishRequests).toEqual([...REQUEST_COLUMNS].sort());
    for (const locale of Object.values(locales)) {
      expect(Object.keys(locale.csv.fields.portfolio_projects).sort()).toEqual(englishProjects);
      expect(Object.keys(locale.csv.fields.portfolio_requests).sort()).toEqual(englishRequests);
      for (const column of PROJECT_COLUMNS) expect(locale.csv.fields.portfolio_projects[column]).not.toBe('');
      for (const column of REQUEST_COLUMNS) expect(locale.csv.fields.portfolio_requests[column]).not.toBe('');
      for (const group of PORTFOLIO_GROUPS) expect(locale.csv.groups[group]).not.toBe('');
      expect(locale.csv.presets.portfolio_projects.enrichment).not.toBe('');
      expect(locale.csv.presets.portfolio_requests.enrichment).not.toBe('');
    }
  });

  it('shows the screen language instead of the server labels', () => {
    expect(csvEntityOf('/portfolio/projects')).toBe('portfolio_projects');
    expect(csvEntityOf('/portfolio/requests')).toBe('portfolio_requests');

    const french = tOf(locales.fr);
    expect(csvFieldLabel(french, 'portfolio_projects', { csvColumn: 'execution_progress', label: 'Execution Effort (%)' })).toBe('Progression (%)');
    expect(csvFieldLabel(french, 'portfolio_projects', { csvColumn: 'business_sponsor_email', label: 'Business Sponsor Email' })).toBe('E-mail du sponsor métier');
    expect(csvFieldLabel(french, 'portfolio_projects', { csvColumn: 'estimated_effort_it', label: 'Estimated Effort IT (MD)' })).toBe('Charge IT estimée (JH)');
    expect(csvGroupLabel(french, 'Effort')).toBe('Charge');
    expect(csvGroupLabel(french, 'Scoring')).toBe('Évaluation');
    expect(csvPresetLabel(french, 'portfolio_projects', { name: 'enrichment', label: 'Data Enrichment' })).toBe('Enrichissement des données');
    expect(csvFieldLabel(french, 'portfolio_requests', { csvColumn: 'requestor_email', label: 'Requestor Email' })).toBe('E-mail du demandeur');
    expect(csvFieldLabel(french, 'portfolio_requests', { csvColumn: 'target_delivery_date', label: 'Target Delivery Date' })).toBe('Date de livraison cible');
    expect(csvGroupLabel(french, 'Analysis')).toBe('Analyse');
    expect(csvGroupLabel(french, 'Team')).toBe('Équipe');
    expect(csvPresetLabel(french, 'portfolio_requests', { name: 'enrichment', label: 'Data Enrichment' })).toBe('Enrichissement des données');

    const english = tOf(locales.en);
    expect(csvFieldLabel(english, 'portfolio_projects', { csvColumn: 'planned_start', label: 'Planned Start' })).toBe('Planned start');
    expect(csvFieldLabel(english, 'portfolio_projects', { csvColumn: 'criteria_values', label: 'Criteria Values (JSON)' })).toBe('Evaluation criteria (JSON)');
    expect(csvFieldLabel(english, 'portfolio_requests', { csvColumn: 'current_situation', label: 'Current Situation' })).toBe('Current situation');
    expect(csvGroupLabel(english, 'Effort')).toBe('Effort');
    expect(csvPresetLabel(english, 'portfolio_requests', { name: 'enrichment', label: 'Data Enrichment' })).toBe('Data enrichment');
  });
});
