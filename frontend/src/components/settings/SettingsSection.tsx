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

export interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  actions?: React.ReactNode;
  /** Controls section (add button + autosave status) shown above the content */
  controls?: React.ReactNode;
}

/**
 * A collapsible section wrapper for settings pages.
 * Uses MUI Accordion with deferred rendering for performance.
 */
export function SettingsSection({
  title,
  description,
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
            <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>{title}</Typography>
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
  subtitle?: string;
  children: React.ReactNode;
  showDivider?: boolean;
}

/**
 * A group container for organizing related settings sections.
 */
export function SettingsGroup({
  title,
  subtitle,
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
        {subtitle && (
          <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
        )}
      </Stack>
      {showDivider && <Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}
      <Stack spacing={1.5}>{children}</Stack>
    </Stack>
  );
}

export default SettingsSection;
