import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { allocationListLabel, allocationMethodLabel, chargebackDepartmentLabel } from './allocationLabels';
import { allocationWarningKey, allocationWarningText, amountFxMissingOf, type ReportWarning } from './allocationWarnings';

const warning = {
  code: 'turnover_fx_missing' as const,
  items: [{ companyId: 'ny', companyName: 'New York', currency: 'USD', year: 2026 }],
  reportingCurrency: 'EUR',
};

describe('allocationWarningText', () => {
  it('words the missing turnover rate in each language', () => {
    for (const lng of ['en', 'fr', 'de', 'es']) {
      const t = i18n.getFixedT(lng);
      const text = allocationWarningText(t, warning);
      expect(text).not.toContain('shared.allocationWarnings');
      expect(text).toContain('New York');
      expect(text).toContain('USD');
      expect(text).toContain('EUR');
      expect(text).toContain('2026');
    }
    expect(allocationWarningText(i18n.getFixedT('fr'), warning)).toBe(
      'New York est exclue de la répartition\u00a0: pas de taux de change USD vers EUR pour 2026.',
    );
  });

  it('names each company on its own line', () => {
    const text = allocationWarningText(i18n.getFixedT('fr'), {
      ...warning,
      items: [
        warning.items[0],
        { companyId: 'tokyo', companyName: 'Tokyo', currency: 'JPY', year: 2027 },
      ],
    });
    expect(text).toBe([
      'New York est exclue de la répartition\u00a0: pas de taux de change USD vers EUR pour 2026.',
      'Tokyo est exclue de la répartition\u00a0: pas de taux de change JPY vers EUR pour 2027.',
    ].join('\n'));
  });

  it('names a company with no name from the catalogue', () => {
    const text = allocationWarningText(i18n.getFixedT('fr'), {
      ...warning,
      items: [{ ...warning.items[0], companyName: '  ' }],
    });
    expect(text.startsWith('Société est exclue')).toBe(true);
  });

  it('shows a sentence from the server as it is', () => {
    expect(allocationWarningText(i18n.getFixedT('fr'), 'Missing paying company for "X" (year 2026).')).toBe('Missing paying company for "X" (year 2026).');
  });

  it('words a missing paying company in each language', () => {
    const missing = { code: 'missing_paying_company' as const, item: 'Messagerie', year: 2026 };
    for (const lng of ['en', 'fr', 'de', 'es']) {
      const text = allocationWarningText(i18n.getFixedT(lng), missing);
      expect(text).not.toContain('chargebackWarnings');
      expect(text).toContain('Messagerie');
      expect(text).toContain('2026');
    }
    expect(allocationWarningText(i18n.getFixedT('fr'), missing)).toBe(
      'Société payeuse manquante pour «\u00a0Messagerie\u00a0» (année 2026). Les totaux payés excluent cette ligne.',
    );
    expect(allocationWarningKey(missing)).toBe('missing_paying_company:2026:Messagerie');
  });

  it('words a stored allocation and a skipped one from their codes', () => {
    const stored = {
      code: 'stored_allocation_used' as const,
      item: 'Paie',
      year: 2026,
      reason: { code: 'provide_driver' as const, driver: 'headcount' as const },
    };
    expect(allocationWarningText(i18n.getFixedT('fr'), stored)).toBe(
      'Ventilation enregistrée utilisée pour «\u00a0Paie\u00a0» (année 2026)\u00a0: Fournissez Effectif pour les sociétés sélectionnées.',
    );
    const skipped = {
      code: 'allocations_skipped' as const,
      item: 'Paie',
      year: 2026,
      reason: { code: 'text' as const, text: 'Calculator detail' },
    };
    expect(allocationWarningText(i18n.getFixedT('en'), skipped)).toBe(
      'Skipped allocations for "Paie" (year 2026): Calculator detail',
    );
    expect(allocationWarningKey(stored)).toBe('stored_allocation_used:2026:Paie');
  });
});

describe('allocation method and department labels', () => {
  it('translates the method codes and the department fallbacks', () => {
    const fr = i18n.getFixedT('fr');
    expect(allocationMethodLabel(fr, 'headcount')).toBe('Effectif');
    expect(allocationMethodLabel(fr, 'it_users')).toBe('Utilisateurs IT');
    expect(allocationMethodLabel(fr, 'turnover')).toBe("Chiffre d'affaires");
    expect(allocationMethodLabel(fr, 'manual_company')).toBe('Manuel par société');
    expect(allocationMethodLabel(fr, 'manual_department')).toBe('Manuel par département');
    expect(allocationMethodLabel(fr, 'manual_pct')).toBe('Pourcentages manuels');
    expect(allocationMethodLabel(fr, 'default')).toBe('Par défaut');
    expect(allocationMethodLabel(fr, null)).toBe('');
    // The budget list receives the English constants and shows the same words.
    expect(allocationListLabel(fr, 'Headcount')).toBe('Effectif');
    expect(allocationListLabel(fr, 'IT users')).toBe('Utilisateurs IT');
    expect(allocationListLabel(fr, 'Turnover')).toBe("Chiffre d'affaires");
    expect(allocationListLabel(fr, 'Company')).toBe('Manuel par société');
    expect(allocationListLabel(fr, 'Department')).toBe('Manuel par département');
    expect(allocationListLabel(fr, 'Manual %')).toBe('Pourcentages manuels');
    expect(allocationListLabel(fr, 'Default')).toBe('Par défaut');
    expect(allocationListLabel(fr, null)).toBe('');
    expect(allocationListLabel(fr, '')).toBe('');
    expect(allocationListLabel(fr, 'Other')).toBe('Other');
    expect(allocationListLabel(i18n.getFixedT('en'), 'Company')).toBe('Manual by company');
    expect(allocationListLabel(i18n.getFixedT('en'), 'Manual %')).toBe('Manual percentages');
    expect(allocationListLabel(i18n.getFixedT('de'), 'Headcount')).toBe('Mitarbeiterzahl');
    expect(allocationListLabel(i18n.getFixedT('de'), 'Company')).toBe('Manuell nach Unternehmen');
    expect(allocationListLabel(i18n.getFixedT('es'), 'IT users')).toBe('Usuarios IT');
    expect(allocationListLabel(i18n.getFixedT('es'), 'Department')).toBe('Manual por departamento');
    expect(chargebackDepartmentLabel(fr, null, null)).toBe('Coûts communs');
    expect(chargebackDepartmentLabel(fr, 'dept-1', null)).toBe('Département inconnu');
    expect(chargebackDepartmentLabel(fr, 'dept-1', 'Finance')).toBe('Finance');
    for (const lng of ['en', 'de', 'es']) {
      const t = i18n.getFixedT(lng);
      expect(allocationMethodLabel(t, 'manual_pct')).not.toContain('allocationMethod');
      expect(chargebackDepartmentLabel(t, null, 'Common Costs')).toBe(t('ops:reports.globalChargeback.commonCosts'));
      expect(chargebackDepartmentLabel(t, 'dept-1', '  ')).not.toContain('unknownDepartment');
    }
  });
});

const amountWarning = {
  code: 'amount_fx_missing' as const,
  items: [{ currency: 'JPY', year: 2026, lines: 2 }],
  reportingCurrency: 'EUR',
};

describe('amount_fx_missing warning', () => {
  it('reads as the notice of the budget reports', () => {
    expect(allocationWarningText(i18n.getFixedT('en'), amountWarning)).toBe('Excluding 2 lines with no exchange rate: JPY 2026.');
    const several = { ...amountWarning, items: [...amountWarning.items, { currency: 'USD', year: 2026, lines: 1 }] };
    expect(allocationWarningText(i18n.getFixedT('en'), several)).toBe('Excluding lines with no exchange rate: JPY 2026 (2), USD 2026 (1).');
    for (const lng of ['fr', 'de', 'es']) {
      const text = allocationWarningText(i18n.getFixedT(lng), amountWarning);
      expect(text).not.toContain('shared.fxMissing');
      expect(text).toContain('JPY 2026');
    }
  });

  it('gives each code a key without throwing', () => {
    expect(allocationWarningKey(amountWarning)).toBe('amount_fx_missing:JPY-2026');
    expect(allocationWarningKey(warning)).toBe('turnover_fx_missing:ny:USD:2026');
    expect(allocationWarningKey('A sentence.')).toBe('A sentence.');
  });

  it('collects the left-out lines from the warnings', () => {
    const warnings: ReportWarning[] = ['A sentence.', { ...warning }, amountWarning];
    expect(amountFxMissingOf(warnings)).toEqual([{ currency: 'JPY', year: 2026, lines: 2 }]);
    expect(amountFxMissingOf(['A sentence.'])).toEqual([]);
  });
});
