import { Autocomplete, MenuItem, Select, TextField } from '@mui/material';
import { createFilterOptions } from '@mui/material/Autocomplete';
import { useTranslation } from 'react-i18next';
import { PropertyRow } from '../../components/design';
import type { CalendarCountry } from '../../services/workingDayProfiles';
import {
  compactSelectMenuProps,
  drawerAutocompleteListboxSx,
  drawerFieldValueSx,
  drawerMenuItemSx,
  pageSelectSx,
} from '../../theme/formSx';

// Typed search matches the country's name or its two-letter code.
const filterCountries = createFilterOptions<CalendarCountry>({ stringify: (option) => `${option.name} ${option.code}` });

/**
 * The country and region of a new calendar, in its Properties drawer. With a country (and a region
 * when the country has some), the calendar is a standard one: its working days follow the public
 * holidays. Without, it is a custom calendar whose years are entered by hand. Both are set at
 * creation only: the calendar's page shows them as text afterwards.
 */
export default function CalendarSourceFields({
  countries,
  loading,
  countryCode,
  regionCode,
  error,
  onChoose,
}: {
  countries: CalendarCountry[];
  loading: boolean;
  countryCode: string | null;
  regionCode: string | null;
  error?: string;
  /** `region`: the choice came from the region list, the source's last step. */
  onChoose: (country: CalendarCountry | null, regionCode: string | null, from: 'country' | 'region') => void;
}) {
  const { t } = useTranslation(['master-data']);
  const country = countryCode ? countries.find((option) => option.code === countryCode) ?? null : null;
  const regions = country?.regions ?? [];
  return (
    <>
      <PropertyRow label={t('workingDayCalendars.fields.country')} helperText={t('workingDayCalendars.hints.country')}>
        <Autocomplete<CalendarCountry, false, false, false>
          options={countries}
          value={country}
          loading={loading}
          filterOptions={filterCountries}
          onChange={(_event, option) => onChoose(option, null, 'country')}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(option, value) => option.code === value.code}
          ListboxProps={{ sx: drawerAutocompleteListboxSx }}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('workingDayCalendars.placeholders.country')}
              error={!!error}
              helperText={error}
              inputProps={{ ...params.inputProps, 'aria-label': t('workingDayCalendars.fields.country') }}
            />
          )}
        />
      </PropertyRow>
      {country && regions.length > 0 && (
        <PropertyRow label={t('workingDayCalendars.fields.region')}>
          <Select
            variant="standard"
            value={regionCode ?? ''}
            onChange={(event) => onChoose(country, String(event.target.value) || null, 'region')}
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
    </>
  );
}
