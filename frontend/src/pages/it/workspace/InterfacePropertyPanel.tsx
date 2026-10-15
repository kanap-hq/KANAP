import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Checkbox,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { classificationText } from '../../../utils/applicationClassification';
import { useLookupHydration, useLookupPicker } from '../../../hooks/useLookupPicker';
import { formatUserOption, USERS_LOOKUP_ENDPOINT, type UserOption } from '../../../components/fields/userLookup';
import BusinessProcessSelect from '../../../components/fields/BusinessProcessSelect';
import EnumAutocomplete from '../../../components/fields/EnumAutocomplete';
import TeamMemberMultiSelect from '../../../components/fields/TeamMemberMultiSelect';
import { PropertyGroup, PropertyRow } from '../../../components/design';
import type { CountryOption } from '../../../constants/isoOptions';
import { filterCountryOptions, useCountryOptions } from '../../../i18n/countries';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { drawerFieldValueSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { formatShortDate } from '../../../lib/dateFormat';
import { useLocale } from '../../../i18n/useLocale';
import type {
  InterfaceCompany,
  InterfaceDataResidency,
  InterfaceDetail,
  InterfaceOwner,
} from '../components/interface-workspace/types';


type CompanyOption = {
  id: string;
  name: string;
};

type TeamMemberValue = {
  user_id: string;
  user_display_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
};

type Props = {
  canManage: boolean;
  data: InterfaceDetail | null;
  isCreate: boolean;
  onPatch: (patch: Partial<InterfaceDetail>) => Promise<void>;
  onReplaceCompanies: (companyIds: string[]) => Promise<void>;
  onReplaceDataResidency: (codes: string[]) => Promise<void>;
  onReplaceOwners: (ownerType: 'business' | 'it', userIds: string[]) => Promise<void>;
};

function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 13, color: 'kanap.text.primary', minHeight: 26, display: 'flex', alignItems: 'center' }}>
      {children}
    </Typography>
  );
}

export default function InterfacePropertyPanel({
  canManage,
  data,
  isCreate,
  onPatch,
  onReplaceCompanies,
  onReplaceDataResidency,
  onReplaceOwners,
}: Props) {
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const { t } = useTranslation(['it', 'common']);
  const locale = useLocale();
  const { byField } = useItOpsEnumOptions();
  const [panelError, setPanelError] = React.useState<string | null>(null);
  const [interfaceIdDraft, setInterfaceIdDraft] = React.useState(data?.interface_id || '');
  const [piiDescriptionDraft, setPiiDescriptionDraft] = React.useState(data?.pii_description || '');
  const owners = (data?.owners || []) as InterfaceOwner[];
  const companies = (data?.companies || []) as InterfaceCompany[];
  const residency = (data?.data_residency || []) as InterfaceDataResidency[];
  const disabled = !canManage;

  // The owners' names, read by id (no people list): the names already read are kept, so adding or
  // removing an owner reads only the new one and the others never flash. The companies are searched
  // as the user types.
  const ownerIds = React.useMemo(() => owners.map((owner) => owner.user_id).filter(Boolean), [owners]);
  const knownOwnersRef = React.useRef(new Map<string, UserOption>());
  const ownerHydration = useLookupHydration<UserOption>({
    endpoint: USERS_LOOKUP_ENDPOINT,
    ids: ownerIds,
    known: knownOwnersRef.current,
    enabled: !isCreate,
  });
  for (const user of ownerHydration.items) knownOwnersRef.current.set(user.id, user);
  const unavailableOwners = ownerHydration.unavailable;
  const companyIds = React.useMemo(() => companies.map((row) => row.company_id).filter(Boolean), [companies]);
  const companyPicker = useLookupPicker<CompanyOption>({ endpoint: '/companies/lookup', value: companyIds, enabled: !isCreate });

  React.useEffect(() => {
    setInterfaceIdDraft(data?.interface_id || '');
  }, [data?.id, data?.interface_id]);

  React.useEffect(() => {
    setPiiDescriptionDraft(data?.pii_description || '');
  }, [data?.id, data?.pii_description]);

  const runPersist = React.useCallback(async (action: () => Promise<void>) => {
    setPanelError(null);
    try {
      await action();
    } catch (panelSaveError: any) {
      setPanelError(getApiErrorMessage(panelSaveError, t, t('messages.saveInterfaceFailed')));
    }
  }, [t]);

  const userById = knownOwnersRef.current;

  const enrichOwners = (ownerType: 'business' | 'it'): TeamMemberValue[] => {
    return owners
      .filter((owner) => owner.owner_type === ownerType)
      .map((owner) => {
        const user = userById.get(owner.user_id);
        const firstName = user?.first_name || '';
        const lastName = user?.last_name || '';
        // The name, or the email the lookup returns when the name is shared or missing.
        const displayName = formatUserOption(user);
        return {
          user_id: owner.user_id,
          // '…' while the name loads, never the raw id; a person no longer readable says so.
          user_display_name: displayName || (unavailableOwners.has(owner.user_id) ? t('common:selects.valueUnavailable') : '…'),
          first_name: firstName || undefined,
          last_name: lastName || undefined,
          email: user?.email ?? undefined,
        };
      });
  };

  const dataClassOptions = React.useMemo(() => {
    const list = classificationCatalog?.dataClasses || [];
    const base = list.filter((item) => !item.deprecated).map((item) => ({ label: item.label, value: item.code }));
    const current = data?.data_class || '';
    return list.some((item) => item.code === current) || !current
      ? base
      : [...base, { label: current, value: current }];
  }, [classificationCatalog?.dataClasses, data?.data_class]);

  const dataCategoryOptions = React.useMemo(() => {
    const list = byField.interfaceDataCategory || [];
    const base = list.filter((item) => !item.deprecated).map((item) => ({ label: item.label, value: item.code }));
    const current = data?.data_category || '';
    return list.some((item) => item.code === current) || !current
      ? base
      : [...base, { label: current, value: current }];
  }, [byField.interfaceDataCategory, data?.data_category]);

  const lifecycleOptions = React.useMemo(() => {
    const list = byField.lifecycleStatus || [];
    const current = data?.lifecycle;
    const options = list.map((item) => ({
      label: item.deprecated ? `${item.label} (deprecated)` : item.label,
      value: item.code,
      deprecated: !!item.deprecated,
    }));
    if (current && !options.some((item) => item.value === current)) {
      options.push({ label: current, value: current, deprecated: false });
    }
    return options.filter((item) => !item.deprecated || item.value === current);
  }, [byField.lifecycleStatus, data?.lifecycle]);

  const criticalityOptions = [{ value: '', label: classificationText('Not set') }, ...(classificationCatalog?.businessCriticalityLevels || []).filter((item) => !item.deprecated || item.code === data?.criticality).map((item) => ({ value: item.code, label: item.label }))];

  const residencyCodes = React.useMemo(
    () => residency.map((item) => String(item.country_iso || '').toUpperCase()).filter((item) => item.length === 2),
    [residency],
  );

  const countryOptions = useCountryOptions();
  const residencyOptions = React.useMemo<CountryOption[]>(() => {
    const extras = residencyCodes
      .filter((code) => !countryOptions.some((option) => option.code === code))
      .map((code) => ({ code, name: t('it:workspace.location.fields.unknownCountry', { code }) }));
    return [...countryOptions, ...extras];
  }, [countryOptions, residencyCodes]);

  return (
    <>
      {!!panelError && (
        <PropertyGroup>
          <Alert severity="error">{panelError}</Alert>
        </PropertyGroup>
      )}

      <PropertyGroup>
        {!isCreate && (
          <PropertyRow label={t('it:workspace.interface.fields.reference')}>
            <ReadOnlyValue>{data?.interface_reference || t('it:workspace.interface.fields.assignedOnCreate')}</ReadOnlyValue>
          </PropertyRow>
        )}
        <PropertyRow label={t('it:workspace.interface.fields.interfaceCode')}>
          <TextField
            value={interfaceIdDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              setInterfaceIdDraft(nextValue);
              if (isCreate) {
                void onPatch({ interface_id: nextValue });
              }
            }}
            onBlur={() => {
              if (!disabled && !isCreate && interfaceIdDraft !== (data?.interface_id || '')) {
                void runPersist(() => onPatch({ interface_id: interfaceIdDraft }));
              }
            }}
            variant="standard"
            sx={drawerFieldValueSx}
            placeholder={t('it:workspace.interface.fields.interfaceCodePlaceholder')}
            disabled={disabled}
          />
        </PropertyRow>
        <PropertyRow label={t('it:workspace.interface.fields.businessProcess')}>
          <BusinessProcessSelect
            value={data?.business_process_id || null}
            onChange={(value) => {
              void runPersist(() => onPatch({ business_process_id: value || null }));
            }}
            disabled={disabled}
            hideLabel
            textFieldSx={drawerFieldValueSx}
            placeholder={t('it:workspace.interface.fields.selectProcess')}
          />
        </PropertyRow>
        <PropertyRow label={t('it:common.lifecycle')}>
          <EnumAutocomplete
            label={t('it:common.lifecycle')}
            value={data?.lifecycle || 'active'}
            onChange={(value) => {
              void runPersist(() => onPatch({ lifecycle: value }));
            }}
            options={lifecycleOptions}
            size="small"
            hideLabel
            textFieldSx={drawerFieldValueSx}
            disabled={disabled}
          />
        </PropertyRow>
        {!isCreate && (
          <>
            <PropertyRow label={t('it:workspace.interface.fields.created')}>
              <ReadOnlyValue>{formatShortDate(data?.created_at, locale, { empty: classificationText('Not set') })}</ReadOnlyValue>
            </PropertyRow>
            <PropertyRow label={t('it:workspace.interface.fields.updated')}>
              <ReadOnlyValue>{formatShortDate(data?.updated_at, locale, { empty: classificationText('Not set') })}</ReadOnlyValue>
            </PropertyRow>
          </>
        )}
      </PropertyGroup>

      {!isCreate && (
        <PropertyGroup>
          <PropertyRow label={t('it:workspace.interface.fields.businessOwners')}>
            <TeamMemberMultiSelect
              label={t('it:workspace.interface.fields.businessOwners')}
              value={enrichOwners('business')}
              onChange={async (userIds) => runPersist(() => onReplaceOwners('business', userIds))}
              disabled={!canManage}
              hideLabel
              textFieldSx={drawerFieldValueSx}
            />
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.fields.itOwners')}>
            <TeamMemberMultiSelect
              label={t('it:workspace.interface.fields.itOwners')}
              value={enrichOwners('it')}
              onChange={async (userIds) => runPersist(() => onReplaceOwners('it', userIds))}
              disabled={!canManage}
              hideLabel
              textFieldSx={drawerFieldValueSx}
            />
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.fields.impactedCompanies')}>
            <Autocomplete
              multiple
              size="small"
              {...companyPicker.autocomplete}
              options={companyPicker.options}
              value={companyPicker.selected}
              onChange={(_, value) => {
                companyPicker.remember(value);
                void runPersist(() => onReplaceCompanies(value.map((item) => item.id)));
              }}
              getOptionLabel={(option) => companyPicker.label(option, (company) => company.name ?? '')}
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  {option.name}
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  sx={drawerFieldValueSx}
                  placeholder={t('it:workspace.interface.fields.addCompanies')}
                />
              )}
              disabled={!canManage || companyPicker.hydrating}
            />
          </PropertyRow>
        </PropertyGroup>
      )}

      <PropertyGroup>
        <PropertyRow label={t('it:workspace.connection.compliance.criticality')}>
          <EnumAutocomplete
            label={t('it:workspace.connection.compliance.criticality')}
            value={data?.criticality || ''}
            onChange={(value) => {
              void runPersist(() => onPatch({ criticality: value as InterfaceDetail['criticality'] }));
            }}
            options={criticalityOptions}
            size="small"
            hideLabel
            textFieldSx={drawerFieldValueSx}
            disabled={disabled}
          />
        </PropertyRow>
        <PropertyRow label={t('it:workspace.interface.fields.dataCategory')} required>
          <EnumAutocomplete
            label={t('it:workspace.interface.fields.dataCategory')}
            value={data?.data_category || ''}
            onChange={(value) => {
              void runPersist(() => onPatch({ data_category: value }));
            }}
            options={dataCategoryOptions}
            size="small"
            hideLabel
            textFieldSx={drawerFieldValueSx}
            disabled={disabled}
          />
        </PropertyRow>
        <PropertyRow label={t('it:workspace.connection.compliance.dataClass')}>
          <EnumAutocomplete
            label={t('it:workspace.connection.compliance.dataClass')}
            value={data?.data_class || ''}
            onChange={(value) => {
              void runPersist(() => onPatch({ data_class: value }));
            }}
            options={dataClassOptions}
            size="small"
            hideLabel
            textFieldSx={drawerFieldValueSx}
            disabled={disabled}
          />
        </PropertyRow>
        <PropertyRow label={t('it:workspace.connection.compliance.containsPii')}>
          <Box sx={{ minHeight: 26, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Switch
              size="small"
              checked={!!data?.contains_pii}
              onChange={(event) => {
                void runPersist(() => onPatch({ contains_pii: event.target.checked }));
              }}
              disabled={disabled}
            />
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
              {data?.contains_pii ? 'Yes' : 'No'}
            </Typography>
          </Box>
        </PropertyRow>
        {data?.contains_pii && (
          <PropertyRow label={t('it:workspace.interface.fields.piiDescription')}>
            <TextField
              value={piiDescriptionDraft}
              onChange={(event) => {
                const next = event.target.value;
                setPiiDescriptionDraft(next);
                if (isCreate) {
                  void onPatch({ pii_description: next });
                }
              }}
              onBlur={() => {
                if (!disabled && !isCreate && piiDescriptionDraft !== (data?.pii_description || '')) {
                  void runPersist(() => onPatch({ pii_description: piiDescriptionDraft || null }));
                }
              }}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('it:workspace.interface.fields.piiPlaceholder')}
              disabled={disabled}
              multiline
              minRows={2}
            />
          </PropertyRow>
        )}
        <PropertyRow label={t('it:workspace.interface.fields.dataResidency')}>
          <Autocomplete
            multiple
            size="small"
            options={residencyOptions}
            value={residencyOptions.filter((option) => residencyCodes.includes(option.code))}
            onChange={(_, value) => {
              void runPersist(() => onReplaceDataResidency(value.map((item) => item.code)));
            }}
            getOptionLabel={(option) => `${option.name} (${option.code})`}
            filterOptions={filterCountryOptions}
            isOptionEqualToValue={(option, value) => option.code === value.code}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="standard"
                sx={drawerFieldValueSx}
                placeholder={t('it:workspace.interface.fields.addCountries')}
              />
            )}
            renderOption={(props, option, state) => (
              <li {...props} key={option.code}>
                <Checkbox checked={state.selected} size="small" sx={{ mr: 1, p: 0.25 }} />
                {option.name} ({option.code})
              </li>
            )}
            fullWidth
            disabled={disabled}
          />
        </PropertyRow>
      </PropertyGroup>
    </>
  );
}
