import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Autocomplete, Box, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { createFilterOptions } from '@mui/material/Autocomplete';
import { useTranslation } from 'react-i18next';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { CreationActions, useCreationLeave, useCreationTitle } from '../../components/workspace/creation';
import { PropertyRow } from '../../components/design';
import { useCalendarCountries } from '../../hooks/useWorkingDayProfiles';
import { createWorkingDayProfile, type CalendarCountry } from '../../services/workingDayProfiles';
import {
  compactSelectMenuProps,
  drawerAutocompleteListboxSx,
  drawerFieldValueSx,
  drawerMenuItemSx,
  pageSelectSx,
} from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import {
  calendarSourceLabel,
  refusalField,
  standardCalendarCode,
  type WorkingDayCalendarField,
} from './workingDayCalendarFields';

type CreateField = 'code' | 'name' | 'description' | 'country';
type FieldErrors = Partial<Record<CreateField, string>>;

/** A refusal the server attaches to a field, mapped to the field the form shows. */
const REFUSAL_TO_FIELD: Partial<Record<WorkingDayCalendarField, CreateField>> = {
  code: 'code',
  name: 'name',
  description: 'description',
  country_iso: 'country',
  region_code: 'country',
};

type CreateForm = {
  code: string;
  description: string;
  country: string | null;
  region: string | null;
};

const EMPTY_FORM: CreateForm = { code: '', description: '', country: null, region: null };

// Typed search matches the country's name or its two-letter code.
const filterCountries = createFilterOptions<CalendarCountry>({ stringify: (option) => `${option.name} ${option.code}` });

/**
 * The create page of a calendar. With a country (and a region when the country has some), the
 * calendar is a standard one: its working days follow the public holidays, and code and name are
 * prefilled (the name in the header title). Without, it is a custom calendar whose years are
 * entered by hand.
 */
export default function WorkingDayCalendarCreate({
  canCreate,
  onClose,
}: {
  canCreate: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const { countries, ready: countriesReady } = useCalendarCountries({ enabled: canCreate });
  const [form, setForm] = React.useState<CreateForm>(EMPTY_FORM);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const leave = useCreationLeave(onClose);
  const title = useCreationTitle({ requiredMessage: t('workingDayCalendars.messages.nameRequired'), onCancel: leave });
  // The code and name the last country choice wrote: a field still holding them follows the next choice.
  const prefillRef = React.useRef<{ code: string; name: string }>({ code: '', name: '' });

  const update = (next: Partial<CreateForm>) => setForm((prev) => ({ ...prev, ...next }));

  const country = React.useMemo(
    () => (form.country ? countries.find((option) => option.code === form.country) ?? null : null),
    [countries, form.country],
  );
  const regions = country?.regions ?? [];
  const region = form.region ? regions.find((option) => option.code === form.region) ?? null : null;
  const source = country
    ? calendarSourceLabel({
      country_iso: country.code,
      country_name: country.name,
      region_code: region?.code ?? null,
      region_name: region?.name ?? null,
    })
    : null;

  const chooseSource = (nextCountry: CalendarCountry | null, regionCode: string | null) => {
    const nextRegion = nextCountry && regionCode ? nextCountry.regions.find((option) => option.code === regionCode) ?? null : null;
    const prefill = nextCountry
      ? {
        code: standardCalendarCode(nextCountry.code, nextRegion?.code ?? null),
        name: calendarSourceLabel({
          country_iso: nextCountry.code,
          country_name: nextCountry.name,
          region_code: nextRegion?.code ?? null,
          region_name: nextRegion?.name ?? null,
        }) ?? '',
      }
      : { code: '', name: '' };
    const previous = prefillRef.current;
    prefillRef.current = prefill;
    const follows = (value: string, last: string) => value.trim() === '' || value === last;
    setForm((prev) => ({
      ...prev,
      country: nextCountry?.code ?? null,
      region: nextRegion?.code ?? null,
      code: follows(prev.code, previous.code) ? prefill.code : prev.code,
    }));
    if (follows(title.current(), previous.name)) title.fill(prefill.name);
    setErrors((prev) => ({ ...prev, country: undefined }));
  };

  const handleCreate = async () => {
    if (!canCreate || submitting) return;
    const code = form.code.trim();
    const name = title.require();
    const nextErrors: FieldErrors = {};
    if (!code) nextErrors.code = t('workingDayCalendars.messages.codeRequired');
    setErrors(nextErrors);
    if (!name || Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await createWorkingDayProfile({
        code,
        name,
        description: form.description.trim() || null,
        ...(form.country ? { country_iso: form.country, region_code: form.region } : {}),
      });
      void queryClient.invalidateQueries({ queryKey: ['working-day-profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['working-day-profiles-ids'] });
      leave();
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('workingDayCalendars.messages.createFailed'));
      const refused = refusalField(e);
      const field = refused ? REFUSAL_TO_FIELD[refused] : undefined;
      // A refusal goes under the field it names when the form shows that field.
      if (field === 'name') title.refuse(message);
      else if (field) setErrors({ [field]: message });
      else setServerError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey="kanap.workingDayCalendars.drawerOpen"
        backLabel={t('workingDayCalendars.title')}
        onBack={leave}
        {...title.shellProps}
        titleFallback={t('workingDayCalendars.newCalendar')}
        isCreate
        actions={<CreationActions onCreate={() => void handleCreate()} onCancel={leave} busy={!canCreate || submitting} />}
      >
        <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
          <PropertyRow label={t('workingDayCalendars.fields.country')} helperText={t('workingDayCalendars.hints.country')} valueSx={{ maxWidth: 520 }}>
            <Autocomplete<CalendarCountry, false, false, false>
              options={countries}
              value={country}
              loading={canCreate && !countriesReady}
              filterOptions={filterCountries}
              onChange={(_event, option) => chooseSource(option, null)}
              getOptionLabel={(option) => option.name}
              isOptionEqualToValue={(option, value) => option.code === value.code}
              ListboxProps={{ sx: drawerAutocompleteListboxSx }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  sx={drawerFieldValueSx}
                  placeholder={t('workingDayCalendars.placeholders.country')}
                  error={!!errors.country}
                  helperText={errors.country}
                  inputProps={{ ...params.inputProps, 'aria-label': t('workingDayCalendars.fields.country') }}
                />
              )}
            />
          </PropertyRow>
          {country && regions.length > 0 && (
            <PropertyRow label={t('workingDayCalendars.fields.region')} valueSx={{ maxWidth: 520 }}>
              <Select
                variant="standard"
                value={form.region ?? ''}
                onChange={(event) => chooseSource(country, String(event.target.value) || null)}
                displayEmpty
                sx={pageSelectSx}
                MenuProps={compactSelectMenuProps}
                SelectDisplayProps={{ 'aria-label': t('workingDayCalendars.fields.region') }}
              >
                <MenuItem value="" sx={drawerMenuItemSx}>{t('workingDayCalendars.wholeCountry')}</MenuItem>
                {regions.map((option) => (
                  <MenuItem key={option.code} value={option.code} sx={drawerMenuItemSx}>{option.name}</MenuItem>
                ))}
              </Select>
            </PropertyRow>
          )}
          <PropertyRow label={t('workingDayCalendars.fields.code')} required helperText={t('workingDayCalendars.hints.code')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={form.code}
              onChange={(e) => update({ code: e.target.value })}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('workingDayCalendars.placeholders.code')}
              error={!!errors.code}
              helperText={errors.code}
              inputProps={{ 'aria-label': t('workingDayCalendars.fields.code'), autoComplete: 'off', spellCheck: false }}
            />
          </PropertyRow>
          <PropertyRow label={t('workingDayCalendars.fields.description')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              multiline
              minRows={2}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('workingDayCalendars.placeholders.description')}
              error={!!errors.description}
              helperText={errors.description}
              inputProps={{ 'aria-label': t('workingDayCalendars.fields.description') }}
            />
          </PropertyRow>
          <Typography data-testid="working-day-calendar-create-hint" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
            {source ? t('workingDayCalendars.createHintStandard', { source }) : t('workingDayCalendars.createHint')}
          </Typography>
          {serverError && <Alert severity="error">{serverError}</Alert>}
        </Stack>
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
