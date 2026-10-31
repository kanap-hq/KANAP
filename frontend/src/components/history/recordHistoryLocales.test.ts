import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import de from '../../locales/de/admin.json';
import deMasterData from '../../locales/de/master-data.json';
import deOps from '../../locales/de/ops.json';
import en from '../../locales/en/admin.json';
import enMasterData from '../../locales/en/master-data.json';
import enOps from '../../locales/en/ops.json';
import es from '../../locales/es/admin.json';
import esMasterData from '../../locales/es/master-data.json';
import esOps from '../../locales/es/ops.json';
import deKnowledge from '../../locales/de/knowledge.json';
import enKnowledge from '../../locales/en/knowledge.json';
import esKnowledge from '../../locales/es/knowledge.json';
import frKnowledge from '../../locales/fr/knowledge.json';
import fr from '../../locales/fr/admin.json';
import frMasterData from '../../locales/fr/master-data.json';
import frOps from '../../locales/fr/ops.json';
import type { Translate } from '../../lib/audit/auditLogLabels';
import {
  historyActorText,
  historyChildTitle,
  historyLines,
  historySubjectText,
  RECORD_HISTORY_UNNAMED_KINDS,
  type HistoryTextContext,
  type RecordHistoryItem,
} from './recordHistoryText';

// Every string the record history builds at run time exists in the four languages, keeps the
// interpolation of the English source, and reads as a full sentence in each language. A new child
// kind or a new author without its keys fails here.

const LOCALES = { en, fr, de, es } as Record<string, any>;
const OPS = { en: enOps, fr: frOps, de: deOps, es: esOps } as Record<string, any>;
const KNOWLEDGE = { en: enKnowledge, fr: frKnowledge, de: deKnowledge, es: esKnowledge } as Record<string, any>;
const MASTER_DATA = { en: enMasterData, fr: frMasterData, de: deMasterData, es: esMasterData } as Record<string, any>;
const LANGUAGE_NAMES = ['en', 'fr', 'de', 'es'] as const;
const ID = '11111111-2222-4333-8444-555555555555';
const EVENT_KINDS = ['link', 'attachment', 'contact', 'application', 'technology', 'asset', 'contract', 'project', 'request', 'task', 'line', 'value', 'supplier',
  'budget_line', 'relation_contains', 'relation_depends_on', 'member', 'owner_it', 'owner_business', 'operating_system',
  'sub_item', 'person', 'owner', 'company', 'dependency', 'country', 'key_identifier', 'interface_leg', 'mapping_set',
  'middleware', 'renewal_task', 'instance', 'assignment', 'department', 'suite', 'business_process', 'task_owner', 'task_viewer',
  'phase', 'milestone', 'time_entry', 'it_team', 'business_team'];
const ACTORS = ['assistant', 'assistantFor', 'unknown'];
const ACTIONS = ['create', 'update', 'delete'];

function placeholders(value: string): string[] {
  return Array.from(value.matchAll(/\{\{(\w+)\}\}/g)).map((match) => match[1]).sort();
}

function context(language: string): HistoryTextContext {
  return {
    locale: language,
    t: i18n.getFixedT(language, ['admin', 'ops', 'common']) as unknown as Translate,
  };
}

function item(overrides: Partial<RecordHistoryItem>): RecordHistoryItem {
  return {
    id: ID,
    at: '2026-10-15T12:34:00.000Z',
    action: 'update',
    actor: { kind: 'user', name: 'Ava Reader' },
    subject: { kind: 'record' },
    changes: [],
    ...overrides,
  };
}

/** The strings a history entry can produce, all from the English source. */
function englishStrings(): string[] {
  const history = en.auditLogs.history as Record<string, any>;
  const strings = Object.entries(history)
    .filter(([, value]) => typeof value === 'string')
    .map(([, value]) => value as string);
  for (const actor of ACTORS) strings.push(history.actors[actor]);
  for (const action of ACTIONS) strings.push(history.actions[action]);
  for (const kind of EVENT_KINDS) {
    strings.push(history.events[kind].added, history.events[kind].removed);
  }
  for (const kind of RECORD_HISTORY_UNNAMED_KINDS) strings.push(history.unnamed[kind], history.deleted[kind]);
  return strings;
}

function valueAt(tree: any, path: string): unknown {
  return path.split('.').reduce((node, part) => node?.[part], tree);
}


/** The line as the component draws it: label, the separator, then the value(s). */
function lineText(line: { label?: string; text?: string; before?: string; after?: string }, ctx: HistoryTextContext): string {
  if (line.text) return line.text;
  const separator = ctx.t('auditLogs.history.separator');
  if (line.before !== undefined && line.after !== undefined) {
    return `${line.label}${separator}${line.before} → ${line.after}`;
  }
  return `${line.label}${separator}${line.before ?? line.after ?? ''}`;
}

describe('record history locales', () => {
  it('holds every history string, with the same interpolation, in the four languages', () => {
    const paths: string[] = [];
    const history = en.auditLogs.history as Record<string, any>;
    for (const [key, value] of Object.entries(history)) {
      if (typeof value === 'string') paths.push(key);
    }
    for (const actor of ACTORS) paths.push(`actors.${actor}`);
    for (const action of ACTIONS) paths.push(`actions.${action}`);
    for (const kind of EVENT_KINDS) {
      paths.push(`events.${kind}.added`, `events.${kind}.removed`);
    }
    for (const kind of RECORD_HISTORY_UNNAMED_KINDS) paths.push(`unnamed.${kind}`, `deleted.${kind}`);
    paths.push('versionNumber', 'versionChanged', 'texts.contentChanged', 'texts.workingDaysChanged');

    for (const language of LANGUAGE_NAMES) {
      const target = LOCALES[language].auditLogs.history;
      for (const path of paths) {
        const translated = valueAt(target, path);
        expect(typeof translated, `${language} ${path}`).toBe('string');
        expect((translated as string).trim().length, `${language} ${path}`).toBeGreaterThan(0);
        const source = valueAt(en.auditLogs.history, path) as string;
        expect(placeholders(translated as string), `${language} ${path}`).toEqual(placeholders(source));
      }
    }
  });

  it('has the new field labels and the tab label in the four languages', () => {
    const fields = [
      'account_id', 'account_name', 'account_number', 'accountNature', 'address1', 'address2', 'allocation_method',
      'allocation_pct', 'applies_to', 'application_id', 'as_of_date', 'axis_id', 'base_currency', 'budget_year',
      'capex_lines', 'city', 'coa_id', 'code', 'company_id', 'consolidation_account_description',
      'consolidation_account_name', 'consolidation_account_number', 'contract_id', 'cost_center_id',
      'costCenterOwner', 'country_iso', 'disabled_at', 'effective_start', 'headcount', 'input_grain', 'is_default',
      'is_frozen', 'it_owner_user_id', 'it_users', 'kind', 'lines', 'measure', 'name', 'native_name', 'nature',
      'notes', 'open_values', 'opex_lines', 'owner_business_id', 'owner_it_id', 'parent_id', 'paying_company_id',
      'postal_code', 'product_name', 'project_id', 'region_code', 'reg_number', 'required', 'run_build',
      'sort_order', 'state', 'status', 'successor_id', 'turnover', 'values', 'vat_number', 'version_name',
      'summary', 'folder_id', 'library_id', 'document_type_id', 'template_document_id',
      'review_due_at', 'last_reviewed_at', 'published_at', 'current_version_number', 'revision',
      // Family D: assets and technologies, and their children.
      'asset_reference', 'provider', 'region', 'zone', 'hostname', 'domain', 'fqdn', 'aliases', 'admin_zone',
      'is_cluster', 'end_of_life_date', 'location_id', 'sub_location_id', 'operating_system', 'members', 'relations',
      'external_links', 'ip_addresses', 'cluster', 'serial_number', 'manufacturer', 'model', 'purchase_date',
      'rack_location', 'rack_unit', 'vendor_id', 'support_contract_id', 'support_tier', 'support_expiry',
      'spend_item_id', 'family', 'hosting_type', 'cpe_products', 'replaced_by_id', 'vulnerability_alerts',
      'catalog_sync', 'versions_added', 'versions_updated', 'versions_attached', 'cpe_products_added',
      'cpe_products_removed', 'cve_names_added', 'cve_names_removed', 'description_filled', 'description_updated',
      'converted_from_application', 'moved', 'catalog_key', 'catalog_state', 'cve_names', 'cpe_version',
      'build_prefixes', 'standard_support_end', 'extended_support_end', 'vulnerability_alerts_effective',
      'owner_type', 'application_id', 'technology_version_id', 'is_operating_system', 'cve_id', 'state', 'note',
      'vulnerability_state',
      // The supplier and contact fields of lot 2 family B.
      'erp_supplier_id', 'is_primary', 'job_title', 'supplier_role', 'active', 'phone', 'mobile', 'country',
    ];
    for (const language of LANGUAGE_NAMES) {
      for (const key of fields) {
        expect(LOCALES[language].auditLogs.fields[key], `${language} ${key}`).toBeTruthy();
      }
      expect(OPS[language].opex.tabs.history, `${language} tab`).toBeTruthy();
      expect(KNOWLEDGE[language].sidebar.tabs.history, `${language} knowledge tab`).toBeTruthy();
      expect(MASTER_DATA[language].shared.labels.history, `${language} supplier tab`).toBeTruthy();
    }
  });

  it('reads a sample of entries in each language without a raw key or interpolation', () => {
    for (const language of LANGUAGE_NAMES) {
      const ctx = context(language);
      const itemFor = item({
        subject: { kind: 'record' },
        changes: [
          { field: 'dimension', dimension: 'Budget reference', before: 'REF-12', after: 'REF-13' },
          { field: 'contract_id', after: { hidden: true, kind: 'contract' } },
          { field: 'product_name', before: 'Old', after: 'New' },
        ],
      });
      const lines = historyLines(itemFor, ctx).map((line) => line.text ?? `${line.label}${ctx.t('auditLogs.history.separator')}${line.before ?? ''}${line.after ?? ''}`).join('\n');
      expect(lines).not.toContain('{{');
      expect(lines).not.toContain('auditLogs.');
      const link = historyLines(item({
        subject: { kind: 'link', label: 'Spec link' },
        changes: [{ field: 'link', event: 'added', after: { kind: 'link', id: ID, label: 'Spec link' } }],
      }), ctx).map((line) => line.text).join('');
      expect(link).toBeTruthy();
      expect(link).not.toContain('{{');
      expect(link).not.toContain('auditLogs.');
      for (const actor of [
        { kind: 'system' as const, name: null },
        { kind: 'import' as const, name: 'Ava Reader' },
        { kind: 'assistant' as const, name: 'Ava Reader' },
      ]) {
        const text = historyActorText(actor, ctx.t);
        expect(text).toBeTruthy();
        expect(text).not.toContain('{{');
        expect(text).not.toContain('auditLogs.');
      }
      const subject = historySubjectText({ kind: 'version', label: '2026' }, ctx.t);
      expect(subject).toBeTruthy();
      expect(subject).not.toContain('{{');
      expect(subject).not.toContain('auditLogs.');
      expect(subject).not.toContain('Y2026');
    }
  });

  it('reads a site, a connection and an interface entry in French and English', () => {
    const enCtx = context('en');
    const frCtx = context('fr');

    const subFr = historyLines(item({
      subject: { kind: 'sub_item' },
      action: 'create',
      changes: [{ field: 'sub_item', event: 'added', after: 'Rack 5' }],
    }), frCtx);
    expect(subFr[0].text).toBe('Sous-site ajouté\u00a0: Rack 5');

    const legFr = historyChildTitle(item({ subject: { kind: 'leg', label: '2' }, action: 'create' }), frCtx.t);
    expect(legFr).toBe('Segment 2 ajouté');
    const legEn = historyChildTitle(item({ subject: { kind: 'leg', label: '2' }, action: 'delete' }), enCtx.t);
    expect(legEn).toBe('Segment 2 removed');
    const hopFr = historyChildTitle(item({ subject: { kind: 'leg', label: '3' }, action: 'create' }), frCtx.t, 'connections');
    expect(hopFr).toBe('Saut 3 ajouté');
    const hopEn = historyChildTitle(item({ subject: { kind: 'leg', label: '3' }, action: 'delete' }), enCtx.t, 'connections');
    expect(hopEn).toBe('Hop 3 removed');

    const bindingFr = historyChildTitle(item({ subject: { kind: 'binding', label: 'PROD' }, action: 'create' }), frCtx.t);
    expect(bindingFr).toBe('Liaison PROD ajoutée');
    expect(historySubjectText({ kind: 'binding', label: 'PROD' }, enCtx.t)).toBe('Binding PROD');

    const ownerFr = historyLines(item({
      subject: { kind: 'set' },
      changes: [{ field: 'owner_it', event: 'added', after: { kind: 'user', id: ID, label: 'Ava Reader' } }],
    }), frCtx);
    expect(ownerFr[0].text).toBe('Propriétaire IT ajouté\u00a0: Ava Reader');

    const legEventFr = historyLines(item({
      subject: { kind: 'set' },
      changes: [{ field: 'interface_leg', event: 'added', after: { kind: 'leg', id: ID, label: '2' } }],
    }), frCtx);
    expect(legEventFr[0].text).toBe('Segment ajouté\u00a0: Segment 2');

    const personEn = historyLines(item({
      subject: { kind: 'person' },
      action: 'create',
      changes: [{ field: 'person', event: 'added', after: { kind: 'user', id: ID, label: 'Ava Reader' } }],
    }), enCtx);
    expect(personEn[0].text).toBe('Person added: Ava Reader');

    const middlewareEn = historyLines(item({
      subject: { kind: 'record' },
      changes: [{ field: 'middleware', event: 'added', after: { kind: 'application', id: ID, label: 'Hub' } }],
    }), enCtx);
    expect(middlewareEn[0].text).toBe('Middleware added: Hub');
  });

  it('reads an account and a cost center entry in French and English', () => {
    const accountChanges = [
      { field: 'account_name', before: 'Software', after: 'Software and services' },
      { field: 'coa_id', after: { kind: 'chart_of_accounts', id: ID, label: 'FR · Local chart' } },
      { field: 'nature', before: null, after: 'opex' },
    ];
    const enAccount = { ...context('en'), table: 'accounts' };
    const accountEn = historyLines(item({ changes: accountChanges }), enAccount);
    expect(lineText(accountEn[0], enAccount)).toBe('Account name: Software → Software and services');
    expect(lineText(accountEn[1], enAccount)).toBe('Chart of accounts: FR · Local chart');
    expect(lineText(accountEn[2], enAccount)).toBe('Used for: — → OPEX only');

    const frAccount = { ...context('fr'), table: 'accounts' };
    const accountFr = historyLines(item({ changes: accountChanges }), frAccount);
    expect(lineText(accountFr[0], frAccount)).toBe('Nom du compte\u00a0: Software → Software and services');
    expect(lineText(accountFr[1], frAccount)).toBe('Plan comptable\u00a0: FR · Local chart');
    expect(lineText(accountFr[2], frAccount)).toBe('Utilisé pour\u00a0: — → OPEX uniquement');

    const costChanges = [
      { field: 'kind', before: 'cost_center', after: 'group' },
      { field: 'parent_id', after: { kind: 'cost_center', id: ID, label: 'CC-B · Centre B' } },
      { field: 'company_id', after: { hidden: true, kind: 'company' } },
    ];
    const enCost = { ...context('en'), table: 'cost_centers' };
    const costEn = historyLines(item({ changes: costChanges }), enCost);
    expect(lineText(costEn[0], enCost)).toBe('Type: Cost center → Group');
    expect(lineText(costEn[1], enCost)).toBe('Parent group: CC-B · Centre B');
    expect(lineText(costEn[2], enCost)).toBe('Company: a company');

    const frCost = { ...context('fr'), table: 'cost_centers' };
    const costFr = historyLines(item({ changes: costChanges }), frCost);
    expect(lineText(costFr[0], frCost)).toBe('Type\u00a0: Centre de coûts → Groupe');
    expect(lineText(costFr[1], frCost)).toBe('Groupe parent\u00a0: CC-B · Centre B');
    expect(lineText(costFr[2], frCost)).toBe('Société\u00a0: une société');
  });

  it('reads a document entry: a content word, a version and its status in French and English', () => {
    const docChanges = [
      { field: 'content_markdown', text: 'contentChanged' },
      { field: 'current_version_number', before: 3, after: 4 },
      { field: 'current_version_number', after: 1 },
      { field: 'status', after: 'published' },
    ];
    const docEn = { ...context('en'), table: 'documents' };
    const enLines = historyLines(item({ changes: docChanges }), docEn);
    expect(lineText(enLines[0], docEn)).toBe('Content changed');
    expect(lineText(enLines[1], docEn)).toBe('Version 3 → 4');
    expect(lineText(enLines[2], docEn)).toBe('Version 1');
    expect(lineText(enLines[3], docEn)).toBe('Status: Published');

    const docFr = { ...context('fr'), table: 'documents' };
    const frLines = historyLines(item({ changes: docChanges }), docFr);
    expect(lineText(frLines[0], docFr)).toBe('Contenu modifié');
    expect(lineText(frLines[1], docFr)).toBe('Version 3 → 4');
    expect(lineText(frLines[2], docFr)).toBe('Version 1');
    expect(lineText(frLines[3], docFr)).toBe('Statut\u00a0: Publié');
  });

  it('names a budget year and a month range in each language', () => {
    const expected = {
      en: { subject: 'Budget 2027', created: 'Budget 2027 added', deleted: 'Budget 2027 deleted', months: 'months March to May 2027' },
      fr: { subject: 'Budget 2027', created: 'Budget 2027 ajouté', deleted: 'Budget 2027 supprimé', months: 'mois de mars à mai 2027' },
      de: { subject: 'Budget 2027', created: 'Budget 2027 hinzugefügt', deleted: 'Budget 2027 gelöscht', months: 'Monate März bis Mai 2027' },
      es: { subject: 'Presupuesto 2027', created: 'Presupuesto 2027 añadido', deleted: 'Presupuesto 2027 eliminado', months: 'meses de marzo a mayo de 2027' },
    };
    for (const language of LANGUAGE_NAMES) {
      const ctx = context(language);
      const created = item({ subject: { kind: 'version', label: '2027' }, action: 'create' });
      expect(historySubjectText({ kind: 'version', label: '2027' }, ctx.t)).toBe(expected[language].subject);
      expect(historyChildTitle(created, ctx.t)).toBe(expected[language].created);
      expect(historyChildTitle({ ...created, action: 'delete' }, ctx.t)).toBe(expected[language].deleted);
      const lines = historyLines(item({
        subject: { kind: 'amounts' },
        changes: [{ field: 'planned', before: '1.00', after: '2.00', year: 2027, column: 'planned', months: ['2027-03', '2027-04', '2027-05'] }],
      }), ctx);
      expect(lines[0].suffix).toEqual([expected[language].months]);
    }
  });

  it('reads the brief examples in French and English', () => {
    const frCtx = context('fr');
    const frAmount = historyLines(item({
      subject: { kind: 'amounts' },
      changes: [{ field: 'planned', before: '10000.00', after: '12000.00', year: 2026, column: 'planned' }],
    }), frCtx);
    expect(lineText(frAmount[0], frCtx)).toBe('Montant 2026, Budget\u00a0: 10 000 → 12 000');

    const frDimension = historyLines(item({
      changes: [{ field: 'dimension', dimension: 'Référence budget', before: 'REF-12', after: 'REF-13' }],
    }), frCtx);
    expect(lineText(frDimension[0], frCtx)).toBe('Dimension Référence budget\u00a0: REF-12 → REF-13');

    const frCreatedDimension = historyLines(item({
      changes: [{ field: 'dimension', dimension: 'Cost pool', after: 'Cloud' }],
    }), frCtx);
    expect(lineText(frCreatedDimension[0], frCtx)).toBe('Dimension Cost pool\u00a0: Cloud');

    const frYear = Array.from({ length: 12 }, (_, index) => `2027-${String(index + 1).padStart(2, '0')}`);
    const frMonths = historyLines(item({
      subject: { kind: 'amounts' },
      changes: [{ field: 'planned', before: '100.00', after: '150.00', year: 2027, column: 'planned', months: frYear }],
    }), frCtx);
    expect(frMonths[0].suffix).toEqual(['mois de janvier à décembre 2027']);
    const frSpring = historyLines(item({
      subject: { kind: 'amounts' },
      changes: [{ field: 'planned', before: '100.00', after: '150.00', year: 2027, column: 'planned', months: ['2027-04', '2027-05', '2027-06'] }],
    }), frCtx);
    expect(frSpring[0].suffix).toEqual(["mois d'avril à juin 2027"]);

    expect(historyLines(item({
      subject: { kind: 'link', label: 'Spec link' },
      changes: [{ field: 'link', event: 'added', after: { kind: 'link', id: ID, label: 'Spec link' } }],
    }), frCtx)[0].text).toBe('Lien ajouté\u00a0: Spec link');
    expect(historyLines(item({
      subject: { kind: 'attachment', label: 'note.txt' },
      changes: [{ field: 'attachment', event: 'removed', before: { kind: 'attachment', id: ID, label: 'note.txt' } }],
    }), frCtx)[0].text).toBe('Pièce jointe retirée\u00a0: note.txt');
    expect(historyLines(item({
      subject: { kind: 'contact', label: 'Cora Contact' },
      changes: [{ field: 'contact', event: 'added', after: { kind: 'contact', id: ID, label: 'Cora Contact' } }],
    }), frCtx)[0].text).toBe('Contact ajouté\u00a0: Cora Contact');
    expect(historyLines(item({
      subject: { kind: 'supplier', label: 'Acme Supplies' },
      changes: [{ field: 'supplier', event: 'added', after: { kind: 'supplier', id: ID, label: 'Acme Supplies' } }],
    }), frCtx)[0].text).toBe('Fournisseur ajouté\u00a0: Acme Supplies');
    expect(historyLines(item({
      subject: { kind: 'budget_line', label: 'Main line' },
      changes: [{ field: 'budget_line', event: 'added', after: { kind: 'budget_line', id: ID, label: 'Main line', reference: 'BL-1' } }],
    }), frCtx)[0].text).toBe('Ligne budgétaire ajoutée\u00a0: Main line (BL-1)');
    expect(historyLines(item({
      subject: { kind: 'supplier' },
      changes: [
        { field: 'role', before: 'commercial', after: 'technical' },
        { field: 'is_primary', before: false, after: true },
      ],
    }), frCtx)).toEqual([
      { label: 'Rôle', before: 'Commercial', after: 'Technique' },
      { label: 'Principal', before: 'Non', after: 'Oui' },
    ]);

    const frHidden = historyLines(item({
      changes: [{ field: 'contract_id', before: null, after: { hidden: true, kind: 'contract' } }],
    }), frCtx);
    expect(lineText(frHidden[0], frCtx)).toBe('Contrat\u00a0: — → un contrat');

    const frDeleted = historyLines(item({
      changes: [{ field: 'asset', event: 'removed', before: { hidden: true, kind: 'asset', deleted: true } }],
    }), frCtx);
    expect(frDeleted[0].text).toBe('Actif retiré\u00a0: un actif supprimé');
    const frHiddenField = historyLines(item({
      changes: [{ field: 'contract_id', before: null, after: { hidden: true, kind: 'contract', deleted: true } }],
    }), frCtx);
    expect(lineText(frHiddenField[0], frCtx)).toBe('Contrat\u00a0: — → un contrat supprimé');

    const frValue = historyLines(item({
      subject: { kind: 'value' },
      changes: [{ field: 'value', event: 'added', after: 'Run' }],
    }), frCtx);
    expect(frValue[0].text).toBe('Valeur ajoutée\u00a0: Run');
    expect(historySubjectText({ kind: 'value', label: 'Run' }, frCtx.t)).toBe('Valeur Run');
    expect(historySubjectText({ kind: 'metrics', label: '2026' }, frCtx.t)).toBe('Indicateurs 2026');

    const enCtx = context('en');
    const enValue = historyLines(item({
      subject: { kind: 'value' },
      changes: [{ field: 'value', event: 'removed', before: 'Run' }],
    }), enCtx);
    expect(enValue[0].text).toBe('Value removed: Run');
    expect(historySubjectText({ kind: 'value', label: 'Run' }, enCtx.t)).toBe('Value Run');
    expect(historySubjectText({ kind: 'metrics', label: '2026' }, enCtx.t)).toBe('Metrics 2026');
    const enHidden = historyLines(item({
      changes: [{ field: 'contract_id', before: null, after: { hidden: true, kind: 'contract' } }],
    }), enCtx);
    expect(lineText(enHidden[0], enCtx)).toBe('Contract: — → a contract');
    expect(historyLines(item({
      subject: { kind: 'supplier' },
      changes: [
        { field: 'role', before: 'commercial', after: 'technical' },
        { field: 'is_primary', before: false, after: true },
      ],
    }), enCtx)).toEqual([
      { label: 'Role', before: 'Commercial', after: 'Technical' },
      { label: 'Primary', before: 'No', after: 'Yes' },
    ]);
  });
});
