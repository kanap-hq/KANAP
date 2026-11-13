import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BulkEditField } from '../../components/bulk-edit/BulkEditDialog';
import FlatSelect from '../../components/bulk-edit/BulkEditFlatSelect';
import AccountSelect from '../../components/fields/AccountSelect';
import AnalyticsCategorySelect from '../../components/fields/AnalyticsCategorySelect';
import CompanySelect from '../../components/fields/CompanySelect';
import CostCenterSelect from '../../components/fields/CostCenterSelect';
import SupplierSelect from '../../components/fields/SupplierSelect';
import UserSelect from '../../components/fields/UserSelect';
import { axisRequiredFor, useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { useLinePlacementFilter } from '../../hooks/usePlacementOptions';
import type { BudgetNatureScope } from './listPreferences';

/**
 * The fields "Change the selection" changes on budget lines (`POST /budget-lines/bulk-update`,
 * rules of 12/11): cost center, account, paying company, supplier, IT owner, business owner,
 * dimension values, run or build; no amount. The pickers are those of a line's properties panel. The
 * account and the paying company cannot be emptied. The account is picked in the chart of accounts of
 * a company chosen first; a dimension value after its dimension. With one nature in the list's Type
 * filter, the accounts and values offered are those of that nature; with both, the server refuses
 * (and the dialog counts) the lines of the other nature.
 */
export function useBudgetLineBulkFields(scope: BudgetNatureScope): BulkEditField[] {
  const { t } = useTranslation(['ops', 'common']);
  const nature = scope === 'all' ? undefined : scope;
  const axes = useAnalyticsAxes({ scope: nature ?? null });
  // A limited person is offered the places the server accepts, as on a line.
  const placement = useLinePlacementFilter(null);

  return useMemo<BulkEditField[]>(() => {
    const dimensionOptions = axes.enabled.map((axis) => ({ value: axis.id, label: axes.label(axis) }));
    const required = (axisId: string) => {
      const axis = axes.enabled.find((a) => a.id === axisId);
      if (!axis) return false;
      return nature ? axisRequiredFor(axis, nature) : axisRequiredFor(axis, 'opex') && axisRequiredFor(axis, 'capex');
    };
    const fields: BulkEditField[] = [
      {
        key: 'cost_center_id',
        label: t('opex.fields.costCenter'),
        optional: true,
        render: ({ value, onChange, label, disabled }) => (
          <CostCenterSelect
            hideLabel
            label={label}
            selectable="cost_centers"
            value={value}
            onChange={(id) => onChange(id)}
            isAllowed={placement?.isCostCenterAllowed}
            disabled={disabled}
          />
        ),
        changes: (value) => ({ cost_center_id: value }),
      },
      {
        key: 'account_id',
        label: t('opex.fields.account'),
        optional: false,
        first: {
          label: t('budget.bulkEdit.chartOf'),
          render: ({ value, onChange, label, disabled }) => <CompanySelect hideLabel disabled={disabled} label={label} value={value} onChange={(id) => onChange(id)} />,
        },
        render: ({ value, onChange, label, disabled, first }) => (
          <AccountSelect hideLabel disabled={disabled} label={label} nature={nature} companyId={first} value={value} onChange={onChange} />
        ),
        changes: (value) => ({ account_id: value }),
      },
      {
        key: 'paying_company_id',
        label: t('opex.fields.payingCompany'),
        optional: false,
        render: ({ value, onChange, label, disabled }) => (
          <CompanySelect hideLabel disabled={disabled} label={label} value={value} onChange={(id) => onChange(id)} allowedCompanyIds={placement?.companyIds} />
        ),
        changes: (value) => ({ paying_company_id: value }),
      },
      {
        key: 'supplier_id',
        label: t('opex.fields.supplier'),
        optional: true,
        render: ({ value, onChange, label, disabled }) => <SupplierSelect hideLabel disabled={disabled} label={label} value={value} onChange={onChange} />,
        changes: (value) => ({ supplier_id: value }),
      },
      {
        key: 'owner_it_id',
        label: t('opex.metadata.itOwner'),
        optional: true,
        render: ({ value, onChange, label, disabled }) => <UserSelect hideLabel disabled={disabled} label={label} value={value} onChange={(id) => onChange(id)} />,
        changes: (value) => ({ owner_it_id: value }),
      },
      {
        key: 'owner_business_id',
        label: t('opex.metadata.businessOwner'),
        optional: true,
        render: ({ value, onChange, label, disabled }) => <UserSelect hideLabel disabled={disabled} label={label} value={value} onChange={(id) => onChange(id)} />,
        changes: (value) => ({ owner_business_id: value }),
      },
    ];
    if (dimensionOptions.length > 0) {
      fields.push({
        key: 'analytics_values',
        label: t('budget.bulkEdit.dimensionValue'),
        // A dimension required for every line of the list cannot be emptied; one required for a
        // single nature can, and the server refuses (the dialog counts) the lines of that nature.
        optional: (axisId) => !required(axisId),
        first: {
          label: t('budget.bulkEdit.dimension'),
          namesField: true,
          render: ({ value, onChange, label, disabled }) => <FlatSelect value={value} onChange={onChange} label={label} disabled={disabled} options={dimensionOptions} />,
        },
        render: ({ value, onChange, label, disabled, first }) => (
          <AnalyticsCategorySelect axisId={first!} disabled={disabled} hideLabel label={label} lineType={nature} value={value} onChange={onChange} />
        ),
        changes: (value, axisId) => ({ analytics_values: { [axisId!]: value } }),
      });
    }
    fields.push({
      key: 'run_build',
      label: t('opex.fields.runBuild'),
      optional: true,
      render: ({ value, onChange, label, disabled }) => (
        <FlatSelect
          value={value}
          onChange={onChange}
          label={label}
          disabled={disabled}
          options={[{ value: 'run', label: t('opex.runBuild.run') }, { value: 'build', label: t('opex.runBuild.build') }]}
        />
      ),
      changes: (value) => ({ run_build: value }),
    });
    return fields;
  }, [axes, nature, placement, t]);
}
