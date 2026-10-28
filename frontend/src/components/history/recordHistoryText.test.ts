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

  it('names the version in the header and the budget column of a round input', () => {
    expect(historySubjectText({ kind: 'version', label: 'Y2026' }, t)).toBe('Version Y2026');
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
    const versionCreate = { ...item({ kind: 'version', label: 'Y2026' }, []), action: 'create' };
    expect(historyChildTitle(versionCreate, t)).toBe('Version Y2026 added');
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
    expect(historyChildTitle(versionDelete, t)).toBe('Version Y2026 deleted');
    expect(historyChildTitle({
      ...item({ kind: 'version', label: 'Y2026' }, [{ field: 'input_grain', after: 'annual' }]),
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
