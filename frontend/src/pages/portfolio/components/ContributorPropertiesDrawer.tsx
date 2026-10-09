import React from 'react';
import { Box, MenuItem, Slider, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PropertyGroup, PropertyRow } from '../../../components/design';
import EnumAutocomplete from '../../../components/fields/EnumAutocomplete';
import CompanySelect from '../../../components/fields/CompanySelect';
import UserSelect from '../../../components/fields/UserSelect';
import { formatUserOption } from '../../../components/fields/userLookup';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';

export type ContributorDrawerTeam = { id: string; name: string; is_active: boolean };
export type ContributorDrawerOption = { id: string; name: string; is_active: boolean };
export type ContributorDrawerStream = ContributorDrawerOption & { category_id: string };

export type ContributorDrawerValues = {
  /** A column of `users`, shared by the whole app. See `canEditJobTitle`. */
  job_title: string | null;
  team_id: string | null;
  manager_user_id: string | null;
  manager_source: string | null;
  employment_type_id: string | null;
  project_availability: number;
  default_source_id: string | null;
  default_category_id: string | null;
  default_stream_id: string | null;
  default_company_id: string | null;
};

type Props = {
  values: ContributorDrawerValues;
  teams: ContributorDrawerTeam[];
  employmentTypes: ContributorDrawerOption[];
  sources: ContributorDrawerOption[];
  categories: ContributorDrawerOption[];
  streams: ContributorDrawerStream[];
  /** Name of the current manager, for the Entra read-only row. */
  managerName?: string | null;
  /** The contributor's own user, kept out of the manager list. */
  contributorUserId?: string | null;
  /** Team, manager and employment type are not part of the self-service profile. */
  showTeam: boolean;
  canEdit: boolean;
  canManageTeams: boolean;
  /** Own profile or `users:admin`; a portfolio right is not enough. */
  canEditJobTitle: boolean;
  /** The directory owns the job title and rewrites it at every sync. */
  jobTitleFromEntra: boolean;
  onChange: (patch: Partial<ContributorDrawerValues>) => void;
  /** Carries the picked name so the metadata bar does not wait for a refetch. */
  onManagerPicked?: (userId: string | null, name: string | null) => void;
};

const AVAILABILITY_MAX = 20;

/**
 * The query cache is the only state for drawer fields and its observer
 * notifications are batched, so an input driven straight by it drops characters
 * between keystrokes. Same local draft as the notes field on the page, which
 * follows the cache only while the field is not focused, with the save on blur
 * (charter rule 15 for short text).
 */
function JobTitleField({
  ariaLabel,
  value,
  readOnly,
  placeholder,
  onCommit,
}: {
  ariaLabel: string;
  value: string;
  readOnly: boolean;
  placeholder: string;
  onCommit: (next: string | null) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(value);
  }, [value]);
  return (
    <TextField
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        // `readOnly` stops a person typing, not a programmatic change, and a
        // blur with nothing typed must not cost a PATCH nor an audit row.
        if (readOnly || next === value.trim()) {
          setDraft(value);
          return;
        }
        onCommit(next || null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
      }}
      inputRef={inputRef}
      fullWidth
      variant="standard"
      InputProps={{ readOnly }}
      placeholder={placeholder}
      inputProps={{ 'aria-label': ariaLabel }}
    />
  );
}

export default function ContributorPropertiesDrawer({
  values,
  teams,
  employmentTypes,
  sources,
  categories,
  streams,
  managerName,
  contributorUserId,
  showTeam,
  canEdit,
  canManageTeams,
  canEditJobTitle,
  jobTitleFromEntra,
  onChange,
  onManagerPicked,
}: Props) {
  const { t } = useTranslation(['portfolio', 'common']);
  // Local slider position while dragging; the save fires once on release.
  const [draftAvailability, setDraftAvailability] = React.useState<number | null>(null);
  const availability = draftAvailability ?? values.project_availability;

  const activeTeams = React.useMemo(
    () => teams.filter((team) => team.is_active || team.id === values.team_id)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [teams, values.team_id],
  );
  // A type deactivated after it was assigned stays in the list, like teams.
  const activeEmploymentTypes = React.useMemo(
    () => employmentTypes.filter((type) => type.is_active || type.id === values.employment_type_id),
    [employmentTypes, values.employment_type_id],
  );
  // Same rule as the server: an Entra manager is read-only, unless the account
  // it pointed at is gone and the foreign key already cleared the reference.
  const managerFromEntra = values.manager_source === 'entra' && !!values.manager_user_id;
  const activeSources = React.useMemo(() => sources.filter((s) => s.is_active), [sources]);
  const activeCategories = React.useMemo(() => categories.filter((c) => c.is_active), [categories]);
  const categoryStreams = React.useMemo(
    () => (values.default_category_id
      ? streams.filter((s) => s.is_active && s.category_id === values.default_category_id)
      : []),
    [streams, values.default_category_id],
  );

  const handleCategoryChange = (nextCategoryId: string) => {
    const patch: Partial<ContributorDrawerValues> = { default_category_id: nextCategoryId || null };
    // A stream that no longer belongs to the category travels in the same save.
    const streamStillValid = !!values.default_stream_id && streams.some(
      (stream) => stream.id === values.default_stream_id && stream.category_id === nextCategoryId,
    );
    if (values.default_stream_id && !streamStillValid) patch.default_stream_id = null;
    onChange(patch);
  };

  const jobTitleReadOnly = !canEditJobTitle || jobTitleFromEntra;

  return (
    <>
      <PropertyGroup>
        <PropertyRow
          label={t('portfolio:workspace.contributor.fields.jobTitle')}
          helperText={jobTitleFromEntra ? t('portfolio:workspace.contributor.values.fromEntra') : undefined}
        >
          <JobTitleField
            ariaLabel={t('portfolio:workspace.contributor.fields.jobTitle')}
            value={values.job_title ?? ''}
            readOnly={jobTitleReadOnly}
            placeholder={
              jobTitleReadOnly
                ? t('common:selects.notSet')
                : t('portfolio:workspace.contributor.placeholders.jobTitle')
            }
            onCommit={(next) => onChange({ job_title: next })}
          />
        </PropertyRow>
        {showTeam && (
          <PropertyRow label={t('portfolio:workspace.contributor.fields.team')}>
            <TextField
              select
              value={values.team_id ?? ''}
              onChange={(e) => onChange({ team_id: e.target.value || null })}
              variant="standard"
              sx={drawerSelectSx}
              disabled={!canManageTeams}
              SelectProps={{ displayEmpty: true }}
            >
              <MenuItem value="" sx={drawerMenuItemSx}>
                {t('portfolio:workspace.contributor.values.unassigned')}
              </MenuItem>
              {activeTeams.map((team) => (
                <MenuItem key={team.id} value={team.id} sx={drawerMenuItemSx}>
                  {team.name}
                </MenuItem>
              ))}
            </TextField>
          </PropertyRow>
        )}
        {showTeam && (
          <PropertyRow label={t('portfolio:workspace.contributor.fields.manager')}>
            {managerFromEntra ? (
              <Box>
                <Box sx={(theme) => ({ fontSize: 13, lineHeight: 1.4, color: theme.palette.kanap.text.primary })}>
                  {managerName || t('portfolio:workspace.contributor.values.noManager')}
                </Box>
                <Box sx={(theme) => ({ fontSize: 12, lineHeight: 1.4, color: theme.palette.kanap.text.tertiary })}>
                  {t('portfolio:workspace.contributor.values.fromEntra')}
                </Box>
              </Box>
            ) : (
              <UserSelect
                label=""
                hideLabel
                size="small"
                value={values.manager_user_id}
                placeholder={t('portfolio:workspace.contributor.values.noManager')}
                disabled={!canManageTeams}
                excludeUserId={contributorUserId}
                onChange={(value, user) => {
                  onChange({ manager_user_id: value });
                  onManagerPicked?.(value, formatUserOption(user) || null);
                }}
                textFieldSx={drawerFieldValueSx}
              />
            )}
          </PropertyRow>
        )}
        {showTeam && (
          <PropertyRow label={t('portfolio:workspace.contributor.fields.employmentType')}>
            <TextField
              select
              value={values.employment_type_id ?? ''}
              onChange={(e) => onChange({ employment_type_id: e.target.value || null })}
              variant="standard"
              sx={drawerSelectSx}
              disabled={!canManageTeams}
            >
              {activeEmploymentTypes.map((type) => (
                <MenuItem key={type.id} value={type.id} sx={drawerMenuItemSx}>
                  {type.name}
                </MenuItem>
              ))}
            </TextField>
          </PropertyRow>
        )}
        <PropertyRow label={t('portfolio:workspace.contributor.fields.projectAvailability')}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', pr: '4px' }}>
            <Slider
              value={availability}
              onChange={(_, v) => setDraftAvailability(v as number)}
              onChangeCommitted={(_, v) => {
                setDraftAvailability(null);
                const next = v as number;
                if (next !== values.project_availability) onChange({ project_availability: next });
              }}
              min={0}
              max={AVAILABILITY_MAX}
              step={0.5}
              disabled={!canEdit}
              aria-label={t('portfolio:workspace.contributor.fields.projectAvailability')}
              sx={{ flex: 1 }}
            />
            <Box
              component="span"
              sx={(theme) => ({
                fontFamily: MONO_FONT_FAMILY,
                fontSize: 12,
                color: theme.palette.kanap.text.secondary,
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
                minWidth: 56,
                textAlign: 'right',
              })}
            >
              {t('portfolio:workspace.contributor.values.daysPerMonthShort', { count: availability })}
            </Box>
          </Box>
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <Box sx={(theme) => ({ fontSize: 12, lineHeight: 1.4, color: theme.palette.kanap.text.tertiary, pb: '4px' })}>
          {t('portfolio:workspace.contributor.sections.classificationDefaultsHelp')}
        </Box>
        <PropertyRow label={t('portfolio:workspace.contributor.fields.source')}>
          <EnumAutocomplete
            label=""
            hideLabel
            value={values.default_source_id ?? ''}
            onChange={(value) => onChange({ default_source_id: value || null })}
            options={activeSources.map((source) => ({ value: source.id, label: source.name }))}
            disabled={!canEdit}
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
        <PropertyRow label={t('portfolio:workspace.contributor.fields.category')}>
          <EnumAutocomplete
            label=""
            hideLabel
            value={values.default_category_id ?? ''}
            onChange={handleCategoryChange}
            options={activeCategories.map((category) => ({ value: category.id, label: category.name }))}
            disabled={!canEdit}
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
        <PropertyRow label={t('portfolio:workspace.contributor.fields.stream')}>
          <EnumAutocomplete
            label=""
            hideLabel
            value={values.default_stream_id ?? ''}
            onChange={(value) => onChange({ default_stream_id: value || null })}
            options={categoryStreams.map((stream) => ({ value: stream.id, label: stream.name }))}
            disabled={!canEdit || !values.default_category_id}
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
        <PropertyRow label={t('portfolio:workspace.contributor.fields.company')}>
          <CompanySelect
            value={values.default_company_id}
            onChange={(value) => onChange({ default_company_id: value })}
            disabled={!canEdit}
            hideLabel
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
      </PropertyGroup>
    </>
  );
}
