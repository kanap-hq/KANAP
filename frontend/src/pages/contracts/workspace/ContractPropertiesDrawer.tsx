import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PropertyGroup, PropertyRow } from '../../../components/design';
import SupplierSelect from '../../../components/fields/SupplierSelect';
import CompanySelect from '../../../components/fields/CompanySelect';
import CostCenterSelect from '../../../components/fields/CostCenterSelect';
import DateEUField from '../../../components/fields/DateEUField';
import StatusLifecycleField from '../../../components/fields/StatusLifecycleField';
import UserSelect from '../../../components/fields/UserSelect';
import { useCostCenterNode } from '../../../hooks/useCostCenterTree';
import { useContractPlacementFilter } from '../../../hooks/usePlacementOptions';
import { STATUS_DISABLED, deriveStatusFromDisabledAt, normalizeDisabledAtInput, type StatusValue } from '../../../constants/status';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import type { BillingFrequency, ContractPatch } from '../contractForm';
import { BillingField, CurrencyField, NumberField, RenewalField } from './ContractFields';

export type ContractFormValues = {
  supplier_id: string;
  company_id: string;
  /** A group or a centre, empty when the contract has no place. */
  cost_center_id: string;
  owner_user_id: string | null;
  start_date: string;
  duration_months: number;
  notice_period_months: number;
  auto_renewal: boolean;
  yearly_amount_at_signature: number;
  currency: string;
  billing_frequency: BillingFrequency;
  status: StatusValue;
  disabled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type Props = {
  values: ContractFormValues;
  names: { supplier: string | null; company: string | null; owner: string | null };
  disabled: boolean;
  /** Saved at once: pickers, dates, selects. */
  onPatch: (patch: ContractPatch) => void;
  /** Typed values: shown at once, saved after a pause. */
  onTyped: (patch: ContractPatch) => void;
  /** A typed field lost the focus: what waits is saved now. */
  onCommit: () => void;
};

// The internal label of the field components stays hidden: the row draws it above the value.
const hideInnerLabelSx = {
  '& .MuiInputLabel-root': { display: 'none' },
  '& .MuiFormControl-root': { m: 0 },
} as const;

const twoColumnsSx = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '10px' } as const;

/** The contract's properties panel: parties, duration, amount, lifecycle. Every field saves itself. */
export default function ContractPropertiesDrawer({ values, names, disabled, onPatch, onTyped, onCommit }: Props) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const placement = useContractPlacementFilter(values.company_id || null, values.cost_center_id || null);
  // A place in another company than the contract's is kept; the hint only says so, as on a line.
  const costCenter = useCostCenterNode(values.cost_center_id || null);
  const costCenterHint = costCenter?.company_id && values.company_id && costCenter.company_id !== values.company_id
    ? t('opex.fields.costCenterCompanyHint', { company: costCenter.company_name ?? '' })
    : undefined;

  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('contracts.fields.supplier')} required>
          <Box sx={hideInnerLabelSx}>
            <SupplierSelect
              hideLabel
              label={t('contracts.fields.supplier')}
              value={values.supplier_id}
              onChange={(next) => { if (next && next !== values.supplier_id) onPatch({ supplier_id: next }); }}
              disabled={disabled}
              required
              selectedOption={values.supplier_id && names.supplier ? { id: values.supplier_id, name: names.supplier, erp_supplier_id: null, status: 'enabled' } : null}
            />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('contracts.fields.company')} required>
          <Box sx={hideInnerLabelSx}>
            <CompanySelect
              hideLabel
              label={t('contracts.fields.company')}
              value={values.company_id}
              onChange={(next) => { if (next && next !== values.company_id) onPatch({ company_id: next }); }}
              allowedCompanyIds={placement?.companyIds}
              disabled={disabled}
              required
              disableClearable
              selectedOption={values.company_id && names.company ? { id: values.company_id, name: names.company } : null}
            />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('contracts.fields.costCenter')} helperText={costCenterHint}>
          <Box sx={hideInnerLabelSx}>
            <CostCenterSelect
              hideLabel
              label={t('contracts.fields.costCenter')}
              selectable="contract_places"
              value={values.cost_center_id || null}
              onChange={(next) => {
                if ((next ?? '') !== values.cost_center_id) onPatch({ cost_center_id: next });
              }}
              isAllowed={placement?.isCostCenterAllowed}
              disabled={disabled}
            />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('contracts.fields.owner')}>
          <Box sx={hideInnerLabelSx}>
            <UserSelect
              hideLabel
              label={t('contracts.fields.owner')}
              value={values.owner_user_id}
              selectedOption={values.owner_user_id && names.owner ? { id: values.owner_user_id, first_name: names.owner } : null}
              onChange={(next) => onPatch({ owner_user_id: next })}
              placeholder={t('contracts.metadata.ownerMissing')}
              disabled={disabled}
            />
          </Box>
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('contracts.fields.startDate')} required>
          <Box sx={hideInnerLabelSx}>
            <DateEUField
              label=""
              valueYmd={values.start_date}
              onChangeYmd={(next) => { if (next && next !== values.start_date) onPatch({ start_date: next }); }}
              disabled={disabled}
              required
            />
          </Box>
        </PropertyRow>
        <Box sx={twoColumnsSx}>
          <PropertyRow label={t('contracts.fields.durationMonths')}>
            <NumberField
              kind="months"
              value={values.duration_months}
              onValue={(next) => onTyped({ duration_months: next })}
              onCommit={onCommit}
              disabled={disabled}
              ariaLabel={t('contracts.fields.durationMonths')}
            />
          </PropertyRow>
          <PropertyRow label={t('contracts.fields.noticeMonths')}>
            <NumberField
              kind="months"
              value={values.notice_period_months}
              onValue={(next) => onTyped({ notice_period_months: next })}
              onCommit={onCommit}
              disabled={disabled}
              ariaLabel={t('contracts.fields.noticeMonths')}
            />
          </PropertyRow>
        </Box>
        <PropertyRow label={t('contracts.fields.autoRenewal')}>
          <RenewalField
            value={values.auto_renewal}
            onChange={(next) => onPatch({ auto_renewal: next })}
            disabled={disabled}
            ariaLabel={t('contracts.fields.autoRenewal')}
          />
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('contracts.fields.yearlyAmount')}>
          <NumberField
            kind="amount"
            value={values.yearly_amount_at_signature}
            onValue={(next) => onTyped({ yearly_amount_at_signature: next })}
            onCommit={onCommit}
            disabled={disabled}
            ariaLabel={t('contracts.fields.yearlyAmount')}
          />
        </PropertyRow>
        <Box sx={twoColumnsSx}>
          <PropertyRow label={t('contracts.fields.currency')}>
            <CurrencyField
              value={values.currency}
              onChange={(next) => { if (next !== values.currency) onPatch({ currency: next }); }}
              disabled={disabled}
              ariaLabel={t('contracts.fields.currency')}
            />
          </PropertyRow>
          <PropertyRow label={t('contracts.fields.billingFrequency')}>
            <BillingField
              value={values.billing_frequency}
              onChange={(next) => onPatch({ billing_frequency: next })}
              disabled={disabled}
              ariaLabel={t('contracts.fields.billingFrequency')}
            />
          </PropertyRow>
        </Box>
      </PropertyGroup>

      <PropertyGroup>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
          <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>{t('contracts.fields.lifecycle')}</Typography>
          <StatusLifecycleField
            status={values.status}
            // The date carries the change (the switch sets it too); the server derives the status from it.
            onStatusChange={() => undefined}
            disabledAt={values.disabled_at}
            onDisabledAtChange={(next) => {
              const disabledAt = normalizeDisabledAtInput(next);
              if (disabledAt === values.disabled_at) return;
              onPatch({ status: deriveStatusFromDisabledAt(disabledAt), disabled_at: disabledAt });
            }}
            // Disable now: the status alone, the server sets the end of validity from its own clock.
            onDisableNow={() => onPatch({ status: STATUS_DISABLED })}
            disabled={disabled}
            statusLabel={t('opex.status.enabled')}
            statusOffLabel={t('opex.status.disabled')}
            disabledAtLabel={t('contracts.fields.endOfValidity')}
            disabledAtHelperText={t('contracts.fields.endOfValidityHint')}
          />
        </Box>
        <Box sx={twoColumnsSx}>
          <PropertyRow label={t('contracts.fields.created')}>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{formatShortDate(values.created_at, locale, { year: 'always', empty: '-' })}</Typography>
          </PropertyRow>
          <PropertyRow label={t('contracts.fields.updated')}>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{formatShortDate(values.updated_at, locale, { year: 'always', empty: '-' })}</Typography>
          </PropertyRow>
        </Box>
      </PropertyGroup>
    </>
  );
}
