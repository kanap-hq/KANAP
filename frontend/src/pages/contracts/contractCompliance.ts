import type { TFunction } from 'i18next';
import type { CatalogLocale, CatalogTranslations } from '../../services/itOpsSettings';
import { localizeCatalogItem } from '../../utils/catalogLocalization';
import { classificationDefaults } from '../../utils/applicationClassification';

/**
 * The compliance register of a contract, as the API computes it (`backend/src/contracts/contract-compliance.ts`):
 * every requirement, whether the contract is expected to hold it and why, and what was recorded.
 */
export const COMPLIANCE_REQUIREMENTS = ['gdpr_dpa', 'data_location', 'reversibility', 'exit_plan', 'audit_security'] as const;
export type ComplianceRequirement = (typeof COMPLIANCE_REQUIREMENTS)[number];

export const COMPLIANCE_STATES = ['present', 'absent', 'not_applicable'] as const;
export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

/** The list's summary of a contract: missing first, then to check, then complete; none when nothing is expected. */
export const COMPLIANCE_SUMMARY_STATES = ['missing', 'to_check', 'complete', 'none'] as const;
export type ComplianceSummaryState = (typeof COMPLIANCE_SUMMARY_STATES)[number];
export type ComplianceSummary = { expected: number; missing: number; to_check: number; state: ComplianceSummaryState };

export type ComplianceReason = {
  rule: 'personal_data' | 'business_criticality' | 'cyber_criticality' | 'cloud_hosting';
  application: { id: string; name: string };
  asset: { id: string; name: string } | null;
  level: { axis: 'businessCriticalityLevels' | 'cyberCriticalityLevels' | 'hostingTypes'; code: string; label: string; translations?: CatalogTranslations } | null;
};

export type ComplianceRequirementView = {
  requirement: ComplianceRequirement;
  expected: boolean;
  reasons: ComplianceReason[];
  state: ComplianceState | null;
  reference: string | null;
  updated_at: string | null;
  updated_by: { id: string; name: string | null } | null;
};

export type ContractCompliance = { summary: ComplianceSummary; requirements: ComplianceRequirementView[] };

export const contractComplianceKey = (contractId: string) => ['contract-compliance', contractId] as const;

/** The longest reference the API takes. */
export const COMPLIANCE_REFERENCE_MAX = 500;

/** A reason in words: the level or hosting type in the user's language (tenant translation, shipped default, name). */
export function complianceReasonText(t: TFunction, reason: ComplianceReason, locale: CatalogLocale): string {
  const level = reason.level
    ? localizeCatalogItem(reason.level, locale, classificationDefaults(reason.level.axis)).label
    : '';
  const text = t(`contracts.compliance.reasons.${reason.rule}`, { app: reason.application.name, level });
  return reason.asset ? t('contracts.compliance.reasons.viaAsset', { text, asset: reason.asset.name }) : text;
}
