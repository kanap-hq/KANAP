import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import de from '../../locales/de/admin.json';
import deOps from '../../locales/de/ops.json';
import en from '../../locales/en/admin.json';
import enOps from '../../locales/en/ops.json';
import es from '../../locales/es/admin.json';
import esOps from '../../locales/es/ops.json';
import fr from '../../locales/fr/admin.json';
import frOps from '../../locales/fr/ops.json';
import type { Translate } from '../../lib/audit/auditLogLabels';
import {
  historyActorText,
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
const LANGUAGE_NAMES = ['en', 'fr', 'de', 'es'] as const;
const ID = '11111111-2222-4333-8444-555555555555';
const EVENT_KINDS = ['link', 'attachment', 'contact', 'application', 'technology', 'asset', 'contract', 'project', 'request', 'task', 'line',
  'budget_line', 'relation_contains', 'relation_depends_on', 'member', 'owner_it', 'owner_business', 'operating_system'];
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
  for (const kind of RECORD_HISTORY_UNNAMED_KINDS) strings.push(history.unnamed[kind]);
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
    for (const kind of RECORD_HISTORY_UNNAMED_KINDS) paths.push(`unnamed.${kind}`);

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
      'account_id', 'account_name', 'account_number', 'accountNature', 'allocation_method', 'allocation_pct',
      'as_of_date', 'budget_year', 'coa_id', 'code', 'consolidation_account_description',
      'consolidation_account_name', 'consolidation_account_number', 'contract_id', 'cost_center_id',
      'costCenterOwner', 'effective_start', 'input_grain', 'kind', 'lines', 'measure', 'native_name', 'nature',
      'owner_business_id', 'owner_it_id', 'parent_id', 'paying_company_id', 'product_name',
      'project_id', 'run_build', 'successor_id', 'version_name',
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
    ];
    for (const language of LANGUAGE_NAMES) {
      for (const key of fields) {
        expect(LOCALES[language].auditLogs.fields[key], `${language} ${key}`).toBeTruthy();
      }
      expect(OPS[language].opex.tabs.history, `${language} tab`).toBeTruthy();
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
      const subject = historySubjectText({ kind: 'version', label: 'Y2026' }, ctx.t);
      expect(subject).toBeTruthy();
      expect(subject).not.toContain('{{');
      expect(subject).not.toContain('auditLogs.');
    }
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

    const frHidden = historyLines(item({
      changes: [{ field: 'contract_id', before: null, after: { hidden: true, kind: 'contract' } }],
    }), frCtx);
    expect(lineText(frHidden[0], frCtx)).toBe('Contrat\u00a0: — → un contrat');

    const enCtx = context('en');
    const enHidden = historyLines(item({
      changes: [{ field: 'contract_id', before: null, after: { hidden: true, kind: 'contract' } }],
    }), enCtx);
    expect(lineText(enHidden[0], enCtx)).toBe('Contract: — → a contract');
  });
});
