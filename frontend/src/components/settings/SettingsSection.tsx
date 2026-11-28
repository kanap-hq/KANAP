import React from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoHint from '../workspace/InfoHint';

export interface SettingsSectionProps {
  title: string;
  description?: string;
  /** What the list is for, when its rows do not say it: one sentence in a tooltip beside the title. */
  hint?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  actions?: React.ReactNode;
  /** Controls section (add button + autosave status) shown above the content */
  controls?: React.ReactNode;
  /**
   * `collapsible` (default): the folding section of the lists of values. `flat`: a section of a
   * settings page (design-ecrans.md §3): the title (13 px, 500) with 24 px above it, the hint beside
   * it, nothing under it; `description`, `defaultExpanded`, `actions` and `controls` do not apply.
   */
  variant?: 'collapsible' | 'flat';
}

/** A flat section of a settings page: its title, then its fields. */
function FlatSettingsSection({ title, hint, children }: Pick<SettingsSectionProps, 'title' | 'hint' | 'children'>) {
  const titleId = React.useId();
  return (
    <Box component="section" aria-labelledby={titleId} sx={{ mt: 3 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
        <Typography id={titleId} component="h2" sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}>
          {title}
        </Typography>
        {hint && <InfoHint text={hint} />}
      </Stack>
      {children}
    </Box>
  );
}

/**
 * A section of a settings page: collapsible (MUI Accordion with deferred rendering), or flat.
 */
export function SettingsSection(props: SettingsSectionProps) {
  if (props.variant === 'flat') return <FlatSettingsSection title={props.title} hint={props.hint}>{props.children}</FlatSettingsSection>;
  return <CollapsibleSettingsSection {...props} />;
}

function CollapsibleSettingsSection({
  title,
  description,
  hint,
  children,
  defaultExpanded = false,
  actions,
  controls,
}: SettingsSectionProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const [hasOpened, setHasOpened] = React.useState(defaultExpanded);

  const handleChange = (_: React.SyntheticEvent, nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    if (nextExpanded) setHasOpened(true);
  };

  const shouldRender = hasOpened || expanded;

  return (
    <Accordion
      expanded={expanded}
      onChange={handleChange}
      disableGutters
      elevation={0}
      square
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        '&:before': { display: 'none' },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" alignItems="center" sx={{ flex: 1, pr: 2 }}>
          <Stack spacing={0.25} sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>{title}</Typography>
              {hint && <InfoHint text={hint} />}
            </Stack>
            {description && (
              <Typography variant="caption" color="text.secondary">{description}</Typography>
            )}
          </Stack>
          {actions && (
            <Box onClick={(e) => e.stopPropagation()}>
              {actions}
            </Box>
          )}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        {shouldRender ? (
          <>
            {controls}
            {children}
          </>
        ) : null}
      </AccordionDetails>
    </Accordion>
  );
}

export interface SettingsControlsProps {
  onAdd: () => void;
  saving?: boolean;
  dirty?: boolean;
  addLabel?: string;
  /** Hides the add button and the save status. The list stays visible and cannot be changed. */
  readOnly?: boolean;
}

/**
 * Controls bar for settings sections: add button plus a subtle autosave
 * status ("Saving..." during the API call, "Saved" briefly after success).
 * Edits persist via debounced autosave — there is no manual save action.
 */
export function SettingsControls({
  onAdd,
  saving,
  dirty,
  addLabel: addLabelProp,
  readOnly = false,
}: SettingsControlsProps) {
  const { t } = useTranslation('common');
  const addLabel = addLabelProp ?? t('settingsSection.addItem');
  const [justSaved, setJustSaved] = React.useState(false);
  const prevSaving = React.useRef(!!saving);

  React.useEffect(() => {
    const wasSaving = prevSaving.current;
    prevSaving.current = !!saving;
    if (wasSaving && !saving) {
      setJustSaved(true);
      const timer = setTimeout(() => setJustSaved(false), 1500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [saving]);

  const status = saving ? t('status.saving') : justSaved && !dirty ? t('status.saved') : '';

  if (readOnly) return null;

  return (
    <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="flex-end" sx={{ mb: 1 }}>
      <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', minHeight: 18 }}>
        {status}
      </Typography>
      <Button size="small" variant="outlined" onClick={onAdd}>{addLabel}</Button>
    </Stack>
  );
}

export interface SettingsGroupProps {
  title: string;
  children: React.ReactNode;
  showDivider?: boolean;
}

/**
 * A group container for organizing related settings sections.
 */
export function SettingsGroup({
  title,
  children,
  showDivider = true,
}: SettingsGroupProps) {
  return (
    <Stack spacing={1.5}>
      <Stack spacing={0.25} sx={{ pt: 0.5 }}>
        <Typography
          variant="caption"
          sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary' }}
        >
          {title}
        </Typography>
      </Stack>
      {showDivider && <Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}
      <Stack spacing={1.5}>{children}</Stack>
    </Stack>
  );
}

export default SettingsSection;
