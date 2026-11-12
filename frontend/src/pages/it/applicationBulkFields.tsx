import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BulkEditField } from '../../components/bulk-edit/BulkEditDialog';
import FlatSelect from '../../components/bulk-edit/BulkEditFlatSelect';
import UserMultiSelect from '../../components/fields/UserMultiSelect';
import useApplicationClassificationCatalog from '../../hooks/useApplicationClassificationCatalog';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { classificationText } from '../../utils/applicationClassification';

/** The dialog holds one value per field: a list of people travels as their ids joined by commas. */
const toIds = (value: string | null): string[] => (value ? value.split(',') : []);

function ownersField(field: 'owners_business' | 'owners_it', label: string): BulkEditField {
  return {
    key: field,
    label,
    optional: true,
    render: ({ value, onChange, label: aria, disabled }) => (
      <UserMultiSelect
        hideLabel
        label={aria}
        value={toIds(value)}
        // Removing every person is "nothing picked"; leaving the role empty is the dialog's Empty button.
        onChange={(ids) => onChange(ids.length > 0 ? ids.join(',') : null)}
        disabled={disabled}
      />
    ),
    changes: (value) => ({ [field]: toIds(value) }),
  };
}

/**
 * The fields "Change the selection" changes on applications (`POST /applications/bulk-update`, lot F2
 * of 26.11.8): business owners and IT owners (the people picked replace that role's, as on the
 * application page; emptied, the role has nobody), lifecycle (never empty) and business criticality
 * (the levels still offered, as on the application page; may be emptied).
 */
export function useApplicationBulkFields(): BulkEditField[] {
  const { t } = useTranslation(['it', 'common']);
  const { byField } = useItOpsEnumOptions();
  const { data: catalog } = useApplicationClassificationCatalog();

  return useMemo<BulkEditField[]>(() => {
    const lifecycleOptions = (byField.lifecycleStatus || [])
      .filter((option) => typeof option.code === 'string' && option.code.trim() !== '')
      .map((option) => ({ value: option.code, label: option.label || option.code }));
    const criticalityOptions = (catalog?.businessCriticalityLevels || [])
      .filter((level) => !level.deprecated)
      .map((level) => ({ value: level.code, label: level.label }));
    return [
      ownersField('owners_business', t('pages.applications.columns.businessOwners')),
      ownersField('owners_it', t('pages.applications.columns.itOwners')),
      {
        key: 'lifecycle',
        label: t('common.lifecycle'),
        optional: false,
        render: ({ value, onChange, label, disabled }) => <FlatSelect value={value} onChange={onChange} label={label} disabled={disabled} options={lifecycleOptions} />,
        changes: (value) => ({ lifecycle: value }),
      },
      {
        key: 'criticality',
        label: classificationText('Business criticality'),
        optional: true,
        render: ({ value, onChange, label, disabled }) => <FlatSelect value={value} onChange={onChange} label={label} disabled={disabled} options={criticalityOptions} />,
        changes: (value) => ({ criticality: value }),
      },
    ];
  }, [byField.lifecycleStatus, catalog?.businessCriticalityLevels, t]);
}
