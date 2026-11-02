import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import type { Translate } from '../../lib/audit/auditLogLabels';
import {
  historyActionText,
  historyActorText,
  historyChildTitle,
  historyLines,
  historySubjectText,
  historyValueText,
  type HistoryTextContext,
  type RecordHistoryChange,
  type RecordHistoryItem,
} from './recordHistoryText';

const t = i18n.getFixedT('en', ['admin', 'ops', 'common']) as unknown as Translate;
const context: HistoryTextContext = { t, locale: 'en' };
const ID = '11111111-2222-4333-8444-555555555555';

function item(subject: RecordHistoryItem['subject'], changes: RecordHistoryChange[]): RecordHistoryItem {
  return {
    id: ID,
    at: '2026-10-15T12:34:00.000Z',
    action: 'update',
    actor: { kind: 'user', name: 'Ava Reader' },
    subject,
    changes,
  };
}

describe('history values', () => {
  it('names a visible reference with its business reference', () => {
    expect(historyValueText({ kind: 'project', id: ID, label: 'Portal', reference: 'PRJ-7' }, 'project_id', context))
      .toBe('Portal (PRJ-7)');
    expect(historyValueText({ kind: 'contract', id: ID, label: 'Beta Contract' }, 'contract_id', context))
      .toBe('Beta Contract');
  });

  it('reads a hidden or nameless record as its kind, and never shows an identifier', () => {
    expect(historyValueText({ hidden: true, kind: 'contract' }, 'contract_id', context)).toBe('a contract');
    expect(historyLines(item({ kind: 'contract' }, [
      { field: 'contract', event: 'added', after: { hidden: true, kind: 'contract' } },
    ]), context)).toEqual([{ text: 'Contract added: a contract' }]);
    expect(historyValueText({ hidden: true, kind: 'application' }, 'application_id', context)).toBe('an application');
    expect(historyValueText({ kind: 'contact', id: ID, label: null }, 'contact_id', context)).toBe('a contact');
    expect(historyValueText(ID, 'predecessor_id', context)).toBe('a record');
    expect(historyValueText({ some: 'object' }, 'nodes', context)).toBe('—');
    expect(historyValueText([{ some: 'object' }], 'nodes', context)).toBe('—');
  });

  it('formats a scalar through the audit formatters', () => {
    expect(historyValueText('2026-01-01', 'effective_start', context)).toBe('1 Jan 2026');
    expect(historyValueText(1234.5, 'amount', context)).toBe('1,234.5');
    expect(historyValueText(null, 'description', context)).toBe('—');
  });
});

describe('history lines', () => {
  it('reads an amount change with its year and budget column', () => {
    const lines = historyLines(item({ kind: 'amounts' }, [
      { field: 'planned', before: '10000.00', after: '12000.00', year: 2026, column: 'planned' },
    ]), context);
    expect(lines).toEqual([{ label: 'Amount 2026, Budget', before: '10 000', after: '12 000' }]);
  });

  it('names the months a write touched, or the whole year, and a yearly total without a before', () => {
    const months = historyLines(item({ kind: 'amounts' }, [
      { field: 'planned', before: '100.00', after: '150.00', year: 2026, column: 'planned', months: ['2026-01', '2026-03'] },
    ]), context);
    expect(months).toEqual([{
      label: 'Amount 2026, Budget',
      before: '100',
      after: '150',
      suffix: ['months Jan 2026, Mar 2026'],
    }]);

    const wholeYear = historyLines(item({ kind: 'amounts' }, [
      { field: 'planned', before: '100.00', after: '150.00', year: 2026, column: 'planned', wholeYear: true },
    ]), context);
    expect(wholeYear).toEqual([{
      label: 'Amount 2026, Budget',
      before: '100',
      after: '150',
      suffix: ['whole year'],
    }]);

    const yearlyTotal = historyLines(item({ kind: 'amounts' }, [
      { field: 'planned', after: '12000.00', year: 2026, column: 'planned', wholeYear: true },
    ]), context);
    expect(yearlyTotal).toEqual([{
      label: 'Amount 2026, Budget',
      after: '12 000',
      suffix: ['whole year'],
    }]);
  });

  it('names a monthly redistribution and a copied column', () => {
    const monthly = historyLines(item({ kind: 'amounts' }, [
      { field: 'planned', before: '200.00', after: '200.00', year: 2026, column: 'planned', monthlyOnly: true },
    ]), context);
    expect(monthly).toEqual([{ text: 'Amount 2026, Budget: monthly distribution changed' }]);

    const copied = historyLines(item({ kind: 'amounts' }, [
      { field: 'forecast', before: '100.00', after: '150.00', year: 2027, column: 'forecast', sourceColumn: 'committed', sourceYear: 2026 },
    ]), context);
    expect(copied).toEqual([{
      label: 'Amount 2027, Forecast',
      before: '100',
      after: '150',
      suffix: ['copied from Revision 2026'],
    }]);
  });

  it('counts allocations and names the copy and the overwrite', () => {
    const lines = historyLines(item({ kind: 'allocations' }, [
      { field: 'allocations', before: 1, after: 2, year: 2026, sourceYear: 2025, overwrite: true },
    ]), context);
    expect(lines).toEqual([{
      label: 'Allocations 2026',
      before: '1',
      after: '2',
      suffix: ['copied from 2025', 'manual rows replaced'],
    }]);
  });

  it('writes the child writes as sentences', () => {
    expect(historyLines(item({ kind: 'link', label: 'Spec link' }, [
      { field: 'link', event: 'added', after: { kind: 'link', id: ID, label: 'Spec link' } },
    ]), context)).toEqual([{ text: 'Link added: Spec link' }]);
    // The assistant's whole-set replacement carries the label, not a record reference.
    expect(historyLines(item({ kind: 'link' }, [
      { field: 'link', event: 'added', after: 'New docs' },
    ]), context)).toEqual([{ text: 'Link added: New docs' }]);
    expect(historyLines(item({ kind: 'attachment', label: 'note.txt' }, [
      { field: 'attachment', event: 'removed', before: { kind: 'attachment', id: ID, label: 'note.txt' } },
    ]), context)).toEqual([{ text: 'Attachment removed: note.txt' }]);
    expect(historyLines(item({ kind: 'task', label: 'Follow up' }, [
      { field: 'task', event: 'added', after: { kind: 'task', id: ID, label: 'Follow up', reference: 'T-5' } },
    ]), context)).toEqual([{ text: 'Task added: Follow up (T-5)' }]);
    expect(historyLines(item({ kind: 'contract', label: 'Support Contract' }, [
      { field: 'contract', event: 'added', after: { kind: 'contract', id: ID, label: 'Support Contract' } },
    ]), context)).toEqual([{ text: 'Contract added: Support Contract' }]);
    expect(historyLines(item({ kind: 'contract', label: 'Support Contract' }, [
      { field: 'contract', event: 'removed', before: { kind: 'contract', id: ID, label: 'Support Contract' } },
    ]), context)).toEqual([{ text: 'Contract removed: Support Contract' }]);
    expect(historyLines(item({ kind: 'project' }, [
      { field: 'project', event: 'added', after: { kind: 'project', id: ID, label: 'Portal', reference: 'PRJ-7' } },
    ]), context)).toEqual([{ text: 'Project added: Portal (PRJ-7)' }]);
    expect(historyLines(item({ kind: 'request' }, [
      { field: 'request', event: 'added', after: { kind: 'request', id: ID, label: null } },
    ]), context)).toEqual([{ text: 'Request added: a request' }]);
    expect(historyLines(item({ kind: 'round_input', label: 'planned' }, [
      { field: 'line', event: 'added', after: { kind: 'line', id: ID, label: 'Database' } },
    ]), context)).toEqual([{ text: 'Costed line added: Database' }]);
    // A contact's supplier link: the supplier named, the link's role and primary flag in words.
    expect(historyLines(item({ kind: 'supplier', label: 'Acme Supplies' }, [
      { field: 'supplier', event: 'added', after: { kind: 'supplier', id: ID, label: 'Acme Supplies' } },
      { field: 'role', after: 'commercial' },
      { field: 'is_primary', after: true },
    ]), context)).toEqual([
      { text: 'Supplier added: Acme Supplies' },
      { label: 'Role', after: 'Commercial' },
      { label: 'Primary', after: 'Yes' },
    ]);
    // A contact's budget-line link: the line named with its business reference.
    expect(historyLines(item({ kind: 'budget_line', label: 'Main line' }, [
      { field: 'budget_line', event: 'added', after: { kind: 'budget_line', id: ID, label: 'Main line', reference: 'BL-1' } },
    ]), context)).toEqual([{ text: 'Budget line added: Main line (BL-1)' }]);
  });

  it('falls back to the stored field key when the audit log has no label for it', () => {
    const lines = historyLines(item({ kind: 'record' }, [
      { field: 'unknown_field', before: 'Before', after: 'After' },
    ]), context);
    expect(lines).toEqual([{ label: 'unknown_field', before: 'Before', after: 'After' }]);
  });

  it('reads a dimension by its name and a field by its label', () => {
    const lines = historyLines(item({ kind: 'record' }, [
      { field: 'dimension', dimension: 'Budget reference', before: 'REF-12', after: 'REF-13' },
      { field: 'product_name', before: 'Old', after: 'New' },
      { field: 'contract_id', after: { hidden: true, kind: 'contract' } },
    ]), context);
    expect(lines).toEqual([
      { label: 'Dimension Budget reference', before: 'REF-12', after: 'REF-13' },
      { label: 'Product name', before: 'Old', after: 'New' },
      { label: 'Contract', after: 'a contract' },
    ]);
  });

  it('reads a dimension set on creation as its value only', () => {
    const lines = historyLines(item({ kind: 'record' }, [
      { field: 'dimension', dimension: 'Cost pool', after: 'Cloud' },
    ]), context);
    expect(lines).toEqual([{ label: 'Dimension Cost pool', after: 'Cloud' }]);
  });

  it('compresses consecutive months into a range and keeps separate months', () => {
    const amount = (months: string[], wholeYear?: boolean) => historyLines(item({ kind: 'amounts' }, [
      { field: 'planned', before: '100.00', after: '150.00', year: 2027, column: 'planned', months, ...(wholeYear ? { wholeYear } : {}) },
    ]), context);

    const year = Array.from({ length: 12 }, (_, index) => `2027-${String(index + 1).padStart(2, '0')}`);
    expect(amount(year, true)[0].suffix).toEqual(['months January to December 2027']);
    expect(amount(['2027-05', '2027-03', '2027-04'])[0].suffix).toEqual(['months March to May 2027']);
    expect(amount(['2027-03', '2027-01'])[0].suffix).toEqual(['months Jan 2027, Mar 2027']);
    expect(amount(['2026-12', '2027-01', '2027-02'])[0].suffix).toEqual(['months December 2026 to February 2027']);
  });

  it('names the version in the header and the budget column of a round input', () => {
    expect(historySubjectText({ kind: 'version', label: '2026' }, t)).toBe('Budget 2026');
    expect(historySubjectText({ kind: 'round_input', label: 'planned' }, t)).toBe('Budget input Budget');
    expect(historySubjectText({ kind: 'allocations', label: 'Y2026' }, t)).toBe('Allocation Y2026');
    expect(historySubjectText({ kind: 'record' }, t)).toBeNull();
  });

  it('names an asset hardware sheet, a support sheet, a technology version and a vulnerability', () => {
    expect(historySubjectText({ kind: 'hardware' }, t)).toBe('Hardware');
    expect(historySubjectText({ kind: 'support' }, t)).toBe('Support');
    expect(historySubjectText({ kind: 'technology_version', label: '2.1' }, t)).toBe('Version 2.1');
    expect(historySubjectText({ kind: 'technology_version' }, t)).toBe('Version');
    expect(historySubjectText({ kind: 'vulnerability', label: 'CVE-2026-1234' }, t)).toBe('Vulnerability CVE-2026-1234');
    expect(historySubjectText({ kind: 'relation' }, t)).toBeNull();
  });

  it('writes the asset and technology child writes as sentences', () => {
    expect(historyLines(item({ kind: 'relation' }, [
      { field: 'relation_depends_on', event: 'added', after: { kind: 'asset', id: ID, label: 'Server Two', reference: 'AST-2' } },
    ]), context)).toEqual([{ text: 'Dependency added: Server Two (AST-2)' }]);
    expect(historyLines(item({ kind: 'member' }, [
      { field: 'member', event: 'removed', before: { kind: 'asset', id: ID, label: 'Server One', reference: 'AST-1' } },
    ]), context)).toEqual([{ text: 'Member removed: Server One (AST-1)' }]);
    expect(historyLines(item({ kind: 'owner' }, [
      { field: 'owner_it', event: 'added', after: { kind: 'user', id: ID, label: 'Ava Reader' } },
    ]), context)).toEqual([{ text: 'IT owner added: Ava Reader' }]);
    expect(historyLines(item({ kind: 'technology' }, [
      { field: 'operating_system', event: 'added', after: { kind: 'technology', id: ID, label: 'Windows Server 2019', reference: 'TEC-4' } },
    ]), context)).toEqual([{ text: 'Operating system added: Windows Server 2019 (TEC-4)' }]);
    expect(historyLines(item({ kind: 'budget_line' }, [
      { field: 'budget_line', event: 'added', after: { kind: 'budget_line', id: ID, label: 'Main line', reference: 'BL-1' } },
    ]), context)).toEqual([{ text: 'Budget line added: Main line (BL-1)' }]);
    expect(historyLines(item({ kind: 'vulnerability', label: 'CVE-2026-1234' }, [
      { field: 'vulnerability_state', before: 'to_review', after: 'handled' },
    ]), context)).toEqual([{ label: 'State', before: 'To review', after: 'Handled' }]);
    expect(historyLines(item({ kind: 'technology_version', label: '2.1' }, [
      { field: 'standard_support_end', before: '2027-06-30', after: '2028-06-30' },
    ]), context)).toEqual([{ label: 'Standard support end', before: '30 Jun 2027', after: '30 Jun 2028' }]);
  });

  it('reads the technology enumerations in the reader language', () => {
    expect(historyValueText('public_cloud', 'hosting_type', context)).toBe('Public cloud');
    expect(historyValueText('database', 'family', context)).toBe('Database');
    expect(historyValueText('physical_server', 'kind', { ...context, table: 'assets' })).toBe('Physical server');
    expect(historyValueText('handled', 'vulnerability_state', context)).toBe('Handled');
    expect(historyValueText('high', 'cyber_criticality', context)).toBe('High');
    expect(historyValueText('vital', 'recovery_wave', context)).toBe('V1 Vital activities');
  });

  it('reads a technical child creation and deletion by its title alone', () => {
    const versionCreate = { ...item({ kind: 'version', label: '2027' }, []), action: 'create' };
    expect(historyChildTitle(versionCreate, t)).toBe('Budget 2027 added');
    expect(historyChildTitle({ ...item({ kind: 'technology_version', label: '2.1' }, []), action: 'create' }, t)).toBe('Version 2.1 added');
    expect(historyChildTitle({ ...item({ kind: 'hardware' }, []), action: 'create' }, t)).toBe('Hardware added');
    expect(historyChildTitle({ ...item({ kind: 'hardware' }, []), action: 'delete' }, t)).toBe('Hardware removed');
    expect(historyChildTitle({ ...item({ kind: 'support' }, []), action: 'create' }, t)).toBe('Support added');
    expect(historyChildTitle({ ...item({ kind: 'support' }, []), action: 'delete' }, t)).toBe('Support removed');
    const inputCreate = { ...item({ kind: 'round_input', label: 'planned' }, []), action: 'create' };
    expect(historyChildTitle(inputCreate, t)).toBe('Budget input Budget added');
    const allocationCreate = { ...item({ kind: 'allocations', label: 'Y2026' }, []), action: 'create' };
    expect(historyChildTitle(allocationCreate, t)).toBe('Allocation Y2026 added');
    const versionDelete = { ...versionCreate, action: 'delete' };
    expect(historyChildTitle(versionDelete, t)).toBe('Budget 2027 deleted');
    expect(historyChildTitle({
      ...item({ kind: 'version', label: '2027' }, [{ field: 'input_grain', after: 'annual' }]),
      action: 'create',
    }, t)).toBeNull();
    expect(historyChildTitle({ ...item({ kind: 'record' }, []), action: 'create' }, t)).toBeNull();
  });

  it('names the record event in the history wording, not the audit log action', () => {
    expect(historyActionText('create', t)).toBe('Created');
    expect(historyActionText('update', t)).toBe('Updated');
    expect(historyActionText('delete', t)).toBe('Deleted');
    expect(historyActionText('restored', t)).toBe('Restore');
    expect(historyActionText('', t)).toBe('');
  });

  it('names each author in the reader language', () => {
    expect(historyActorText({ kind: 'user', name: 'Ava Reader' }, t)).toBe('Ava Reader');
    expect(historyActorText({ kind: 'user', name: null }, t)).toBe('Unknown person');
    expect(historyActorText({ kind: 'system', name: null }, t)).toBe('System');
    expect(historyActorText({ kind: 'import', name: 'Ava Reader' }, t)).toBe('Import');
    expect(historyActorText({ kind: 'assistant', name: 'Ava Reader' }, t)).toBe('Plaid for Ava Reader');
    expect(historyActorText({ kind: 'assistant', name: null }, t)).toBe('Plaid');
  });
});

describe('contact and mapping history lines', () => {
  it('names a hidden contact field without its value, and a mapping group by its title', () => {
    expect(historyLines(item({ kind: 'record' }, [
      { field: 'email', text: 'emailChanged' },
      { field: 'phone', text: 'phoneChanged' },
      { field: 'mobile', text: 'mobileChanged' },
      { field: 'notes', text: 'notesChanged' },
    ]), context)).toEqual([
      { text: 'Email changed' },
      { text: 'Phone changed' },
      { text: 'Mobile changed' },
      { text: 'Notes changed' },
    ]);
    expect(historyLines(item({ kind: 'set' }, [
      { field: 'mapping_group', event: 'added', after: 'Header' },
    ]), context)).toEqual([{ text: 'Mapping group added: Header' }]);
    expect(historyLines(item({ kind: 'set' }, [
      { field: 'mapping_rule', event: 'removed', before: 'Customer id' },
    ]), context)).toEqual([{ text: 'Mapping rule removed: Customer id' }]);
  });
});

describe('contract history lines', () => {
  it('reads the renewal markers as sentences, with the contract screen labels', () => {
    expect(historyLines(item({ kind: 'record' }, [
      { field: 'renewal_decision', after: 'terminate' },
      { field: 'renewal_reason', after: 'Price increase' },
    ]), context)).toEqual([
      { text: 'Renewal decided: Terminate' },
      { text: 'Justification: Price increase' },
    ]);
    expect(historyLines(item({ kind: 'record' }, [{ field: 'renewal_decision', after: 'end' }]), context))
      .toEqual([{ text: 'Renewal decided: Let it end' }]);
    expect(historyLines(item({ kind: 'record' }, [{ field: 'renewal_decision', after: 'undo' }]), context))
      .toEqual([{ text: 'Renewal decision undone' }]);
    expect(historyLines(item({ kind: 'record' }, [
      { field: 'renewal_stop', text: 'renewalStopped' },
      { field: 'renewal_resume', text: 'renewalResumed' },
      { field: 'notes', text: 'notesChanged' },
    ]), context)).toEqual([
      { text: 'Renewal stopped' },
      { text: 'Renewal resumed' },
      { text: 'Notes changed' },
    ]);
    expect(historyLines(item({ kind: 'record' }, [
      { field: 'renewal_task', event: 'added', after: { kind: 'task', id: ID, label: 'Decide', reference: 'T-12' } },
    ]), context)).toEqual([{ text: 'Renewal task created: Decide (T-12)' }]);
  });

  it('counts the budget lines outside the reader access, never names them', () => {
    expect(historyLines(item({ kind: 'budget_line' }, [
      { field: 'budget_line', event: 'added', after: { kind: 'budget_line', id: ID, label: 'Hosting', reference: 'BL-3' } },
      { field: 'budget_lines_outside', event: 'added', after: 2 },
    ]), context)).toEqual([
      { text: 'Budget line added: Hosting (BL-3)' },
      { text: 'and 2 lines outside your access' },
    ]);
    expect(historyLines(item({ kind: 'budget_line' }, [
      { field: 'budget_lines_outside', event: 'removed', before: 1 },
    ]), context)).toEqual([{ text: '1 budget line outside your access removed' }]);
  });

  it('names a compliance item by its requirement and reads its state', () => {
    expect(historySubjectText({ kind: 'compliance_item', label: 'exit_plan' }, t)).toBe('Exit plan');
    expect(historySubjectText({ kind: 'compliance_item', label: 'unknown_code' }, t)).toBeNull();
    expect(historyLines(item({ kind: 'compliance_item', label: 'exit_plan' }, [
      { field: 'compliance_state', before: null, after: 'not_applicable' },
      { field: 'compliance_reference', before: 'Clause 4', after: 'Clause 5' },
    ]), context)).toEqual([
      { label: 'State', before: '—', after: 'Not applicable' },
      { label: 'Reference', before: 'Clause 4', after: 'Clause 5' },
    ]);
    expect(historyLines(item({ kind: 'record' }, [{ field: 'billing_frequency', before: 'annual', after: 'monthly' }]), context))
      .toEqual([{ label: 'Billing', before: 'Annual', after: 'Monthly' }]);
  });
});

describe('incident history lines', () => {
  it('reads the incident fields with the register labels', () => {
    const incident: HistoryTextContext = { ...context, table: 'incidents' };
    expect(historyLines(item({ kind: 'record' }, [
      { field: 'category', before: 'security', after: 'data' },
      { field: 'severity', before: 'low', after: 'critical' },
      { field: 'description', text: 'descriptionChanged' },
      { field: 'notified_parties', before: null, after: 'Regulator' },
    ]), incident)).toEqual([
      { label: 'Category', before: 'Security', after: 'Data' },
      { label: 'Severity', before: 'Low', after: 'Critical' },
      { text: 'Description changed' },
      { label: 'Parties informed', before: '—', after: 'Regulator' },
    ]);
  });
});

describe('application history entries', () => {
  const fr = i18n.getFixedT('fr', ['admin', 'ops', 'common', 'it']) as unknown as Translate;
  const en = i18n.getFixedT('en', ['admin', 'ops', 'common', 'it']) as unknown as Translate;

  it('reads a deployment by its environment, as the Deployments tab names it', () => {
    const added = item({ kind: 'instance' }, [{ field: 'instance', event: 'added', after: 'pre_prod' }]);
    expect(historyLines(added, { t: en, locale: 'en' }).map((line) => line.text)).toEqual(['Environment added: Pre-prod']);
    expect(historyLines(added, { t: fr, locale: 'fr' }).map((line) => line.text)).toEqual(['Environnement ajouté : Pré-prod']);
    expect(historySubjectText({ kind: 'instance', label: 'prod' }, en)).toBe('Prod environment');
  });

  it('names a server under its environment, or the noun when the asset is not readable', () => {
    const changes: RecordHistoryChange[] = [{ field: 'assignment', event: 'added', after: { kind: 'asset', id: ID, label: 'srv-db-1', reference: 'AST-4' } }];
    expect(historyLines(item({ kind: 'assignment', label: 'prod' }, changes), { t: en, locale: 'en' })[0].text).toBe('Server added: srv-db-1 (AST-4)');
    expect(historySubjectText({ kind: 'assignment', label: 'prod' }, fr)).toBe('Environnement Prod');
    const hidden = item({ kind: 'assignment' }, [{ field: 'assignment', event: 'removed', before: { hidden: true, kind: 'asset' } }]);
    expect(historyLines(hidden, { t: fr, locale: 'fr' })[0].text).toBe('Serveur retiré : un actif');
  });
});

describe('project history entries', () => {
  const fr = i18n.getFixedT('fr', ['admin', 'ops', 'common', 'portfolio']) as unknown as Translate;
  const en = i18n.getFixedT('en', ['admin', 'ops', 'common', 'portfolio']) as unknown as Translate;
  const jane = { kind: 'user', id: ID, label: 'Jane Doe' };

  it('names a phase, a milestone, a time entry and a team member as they are added or removed', () => {
    const changes: RecordHistoryChange[] = [
      { field: 'phase', event: 'added', after: 'Design' },
      { field: 'milestone', event: 'removed', before: 'Go-live' },
      { field: 'time_entry', event: 'added', after: jane },
      { field: 'it_team', event: 'added', after: jane },
      { field: 'business_team', event: 'removed', before: { hidden: true, kind: 'user' } },
    ];
    expect(historyLines(item({ kind: 'team' }, changes), { t: en, locale: 'en' }).map((line) => line.text)).toEqual([
      'Phase added: Design',
      'Milestone removed: Go-live',
      'Time entry added: Jane Doe',
      'IT team member added: Jane Doe',
      'Business team member removed: a user',
    ]);
    const frLines = historyLines(item({ kind: 'phase' }, changes.slice(0, 1)), { t: fr, locale: 'fr' });
    expect(frLines[0].text).toMatch(/^Phase ajoutée\u00a0: Design$/);
  });

  it('titles an updated phase or milestone by its name', () => {
    expect(historySubjectText({ kind: 'phase', label: 'Design' }, en)).toBe('Design');
    expect(historySubjectText({ kind: 'milestone', label: 'Go-live' }, en)).toBe('Go-live');
    expect(historySubjectText({ kind: 'phase' }, en)).toBeNull();
  });

  it('reads a scoring criterion by its name and options, never an identifier', () => {
    const lines = historyLines(item({ kind: 'record' }, [
      { field: 'criterion', dimension: 'Strategic fit', before: 'Low', after: 'High' },
      { field: 'criterion', dimension: null, before: 'High', after: { hidden: true, kind: 'criterion_value', deleted: true } },
    ]), { t: en, locale: 'en' });
    expect(lines).toEqual([
      { label: 'Criterion Strategic fit', before: 'Low', after: 'High' },
      { label: 'A criterion', before: 'High', after: 'a deleted option' },
    ]);
    expect(JSON.stringify(lines)).not.toContain(ID);
  });

  it('reads a link whose address changed under its label, from the old address to the new', () => {
    const changes: RecordHistoryChange[] = [
      { field: 'link', dimension: 'Specification', before: 'https://a.example/spec', after: 'https://b.example/spec' },
      { field: 'link', event: 'added', after: 'Doc (https://example.invalid/two)' },
    ];
    expect(historyLines(item({ kind: 'link' }, changes), { t: en, locale: 'en' })).toEqual([
      { label: 'Link Specification changed', before: 'https://a.example/spec', after: 'https://b.example/spec' },
      { text: 'Link added: Doc (https://example.invalid/two)' },
    ]);
    const frLines = historyLines(item({ kind: 'link' }, changes.slice(0, 1)), { t: fr, locale: 'fr' });
    expect(frLines[0].label).toBe('Lien Specification modifié');
  });

  it('reads an effort share as a percentage, under the person', () => {
    const changes: RecordHistoryChange[] = [
      { field: 'effort_allocation_it', dimension: 'Jane Doe', before: 40, after: 60 },
      { field: 'effort_allocation_business', dimension: null, before: null, after: 25 },
    ];
    expect(historyLines(item({ kind: 'team' }, changes), { t: en, locale: 'en' })).toEqual([
      { label: 'IT effort share, Jane Doe', before: '40%', after: '60%' },
      { label: 'Business effort share, a user', before: '—', after: '25%' },
    ]);
    const frLine = historyLines(item({ kind: 'team' }, changes.slice(0, 1)), { t: fr, locale: 'fr' })[0];
    expect(frLine.after).toBe('60\u00a0%');
  });

  it('names the edited document by the label of its screen', () => {
    const lines = (slot: string, t: Translate, locale: string) =>
      historyLines(item({ kind: 'document' }, [{ field: 'document_updated', after: slot }]), { t, locale }).map((line) => line.text);
    expect(lines('purpose', en, 'en')).toEqual(['Document modified: Purpose']);
    expect(lines('risks_mitigations', en, 'en')).toEqual(['Document modified: Risks']);
    expect(lines('purpose', fr, 'fr')[0]).toMatch(/Objectif$/);
    expect(lines('specification', en, 'en')).toEqual(['Document modified']);
  });
});

describe('request history entries', () => {
  const fr = i18n.getFixedT('fr', ['admin', 'ops', 'common', 'portfolio']) as unknown as Translate;
  const en = i18n.getFixedT('en', ['admin', 'ops', 'common', 'portfolio']) as unknown as Translate;
  const task = { kind: 'task', id: ID, label: 'Follow up', reference: 'T-4' };

  it('reads the request fields with its screen labels, the rich texts as changed only', () => {
    const changes: RecordHistoryChange[] = [
      { field: 'origin_task_id', after: task },
      { field: 'origin_task_id', before: { hidden: true, kind: 'task', deleted: true }, after: null },
      { field: 'status', before: 'pending_review', after: 'candidate' },
      { field: 'current_situation', text: 'currentSituationChanged' },
      { field: 'feasibility_review', text: 'feasibilityReviewChanged' },
    ];
    const read = (t: Translate, locale: string) => historyLines(item({ kind: 'record' }, changes), { t, locale, table: 'portfolio_requests' });
    expect(read(en, 'en')).toEqual([
      { label: 'Created from task', after: 'Follow up (T-4)' },
      { label: 'Created from task', before: 'a deleted task', after: '—' },
      { label: 'Status', before: 'Pending review', after: 'Candidate' },
      { text: 'Current situation changed' },
      { text: 'Feasibility review changed' },
    ]);
    const frLines = read(fr, 'fr');
    expect(frLines[0]).toEqual({ label: 'Créée depuis la tâche', after: 'Follow up (T-4)' });
    expect(frLines[2]).toEqual({ label: 'Statut', before: 'En attente de revue', after: 'Candidat' });
    expect(frLines[3]).toEqual({ text: 'Situation actuelle modifiée' });
  });

  it('names a business process and a request dependency as the request adds them', () => {
    const changes: RecordHistoryChange[] = [
      { field: 'business_process', event: 'added', after: { kind: 'business_process', id: ID, label: 'Order to cash' } },
      { field: 'dependency', event: 'added', after: { kind: 'request', id: ID, label: 'Request Beta', reference: 'REQ-12' } },
    ];
    expect(historyLines(item({ kind: 'business_process' }, changes), { t: en, locale: 'en' }).map((line) => line.text)).toEqual([
      'Business process added: Order to cash',
      'Dependency added: Request Beta (REQ-12)',
    ]);
    expect(historyLines(item({ kind: 'business_process' }, changes.slice(0, 1)), { t: fr, locale: 'fr' })[0].text)
      .toMatch(/ : Order to cash$/);
  });
});
