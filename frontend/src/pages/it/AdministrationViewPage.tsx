import React from 'react';
import { Alert, Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';

const ENDPOINT = '/technologies/reports/administration';

/** The five control points, in the order the server counts them. */
export const CONTROL_KEYS = [
  'assets_without_zone',
  'domain_controllers_outside',
  'directory_assets_outside',
  'trust_raised',
  'applications_on_most_sensitive',
] as const;
export type ControlKey = (typeof CONTROL_KEYS)[number];

/** A zone of the catalog, or a code the catalog no longer has (`unknown`). */
export type AdministrationZone = {
  code: string;
  label: string | null;
  description: string | null;
  admin_group: string | null;
  deprecated: boolean;
  unknown: boolean;
  asset_counts: Array<{ kind: string; count: number }>;
  hosted_application_count: number;
  directory_services: Array<{ id: string; reference: string | null; name: string }>;
};

/** `GET /technologies/reports/administration`. A control's `count` is null when it does not apply. */
export type AdministrationSummary = {
  most_sensitive: string | null;
  zones: AdministrationZone[];
  without_zone: { asset_count: number };
  controls: Array<{ key: ControlKey; count: number | null }>;
};

/** A catalog value's name in the user's language (tenant translation, then the stored name). */
function useZoneName() {
  const { t } = useTranslation(['it', 'common']);
  const { byField } = useItOpsEnumOptions();
  return React.useCallback((code: string | null, zones: AdministrationZone[]) => {
    if (!code) return t('pages.administrationView.noZone');
    const zone = zones.find((item) => item.code === code);
    if (!zone || zone.unknown) return t('pages.administrationView.unknownZone', { code });
    const name = (byField.adminZone || []).find((option) => option.code === code)?.label || zone.label || code;
    return zone.deprecated ? `${name} (${t('common:enumEditor.retiredSuffix')})` : name;
  }, [byField, t]);
}

/** A neutral link (a record of another page): underline and teal on hover only. */
function RecordLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Box
      component={RouterLink}
      to={to}
      onClick={(event: React.MouseEvent) => event.stopPropagation()}
      sx={{ color: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline', color: 'primary.main' } }}
    >
      {children}
    </Box>
  );
}

const quietSx = { color: 'kanap.text.tertiary' } as const;
const dot = <Box component="span" sx={{ ...quietSx, mx: 0.75 }}>·</Box>;

/**
 * One row of the band: the zone's name with its description under it, its administrator group, then
 * its counts on one line. A button: it narrows the asset list to the zone, again to clear.
 */
function ZoneRow({ name, description, adminGroup, counts, selected, onSelect }: {
  name: string;
  description: string | null;
  adminGroup: string | null;
  counts: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('it');
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(180px, 2fr) minmax(140px, 1.2fr) 3fr' },
        columnGap: 2,
        rowGap: 0.25,
        alignItems: 'baseline',
        width: '100%',
        px: 1.5,
        py: 0.75,
        border: 0,
        borderBottom: '1px solid',
        borderColor: 'kanap.border.default',
        borderLeft: '2px solid',
        borderLeftColor: selected ? 'primary.main' : 'transparent',
        bgcolor: selected ? 'action.selected' : 'transparent',
        color: 'kanap.text.primary',
        font: 'inherit',
        fontSize: 13,
        textAlign: 'left',
        cursor: 'pointer',
        '&:last-of-type': { borderBottom: 0 },
        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ fontWeight: 500 }}>{name}</Box>
        {description && <Box data-testid="zone-description" sx={{ ...quietSx, fontSize: 12 }}>{description}</Box>}
      </Box>
      <Box sx={{ minWidth: 0, color: 'kanap.text.secondary' }}>
        {adminGroup && (
          <>
            <Box component="span" sx={{ ...quietSx, mr: 0.5 }}>{t('pages.administrationView.attributes.adminGroup')}</Box>
            {adminGroup}
          </>
        )}
      </Box>
      <Box sx={{ minWidth: 0, color: 'kanap.text.secondary' }}>{counts}</Box>
    </Box>
  );
}

/** The zones of the catalog in their order (the most sensitive first), then "No zone". */
function ZoneBand({ summary, selected, onSelect }: {
  summary: AdministrationSummary;
  selected: string | null | undefined;
  onSelect: (code: string | null) => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const { labelFor } = useItOpsEnumOptions();
  const zoneName = useZoneName();
  const zoneCounts = (zone: AdministrationZone) => {
    if (!zone.asset_counts.length && !zone.directory_services.length) {
      return <Box component="span" sx={quietSx}>{t('pages.administrationView.scopeEmpty')}</Box>;
    }
    const kinds = zone.asset_counts.map((item) => t('pages.administrationView.kindCount', { kind: labelFor('serverKind', item.kind), count: item.count })).join(', ');
    const services = zone.directory_services.map((service) => service.name).join(', ');
    return (
      <>
        {kinds}
        {kinds && dot}
        {t('pages.administrationView.hostedApplications', { count: zone.hosted_application_count })}
        {zone.directory_services.length > 0 && (
          <>
            {dot}
            <Tooltip title={services}>
              <span>{t('pages.administrationView.directoryServiceCount', { count: zone.directory_services.length })}</span>
            </Tooltip>
          </>
        )}
      </>
    );
  };
  return (
    <Box
      role="group"
      aria-label={t('pages.administrationView.zones')}
      sx={{ border: '1px solid', borderColor: 'kanap.border.default', borderRadius: 1, overflow: 'hidden' }}
    >
      {summary.zones.map((zone) => (
        <ZoneRow
          key={zone.code}
          name={zoneName(zone.code, summary.zones)}
          description={zone.description}
          adminGroup={zone.admin_group}
          counts={zoneCounts(zone)}
          selected={selected === zone.code}
          onSelect={() => onSelect(zone.code)}
        />
      ))}
      <ZoneRow
        name={t('pages.administrationView.noZone')}
        description={null}
        adminGroup={null}
        counts={summary.without_zone.asset_count
          ? t('pages.administrationView.assetCount', { count: summary.without_zone.asset_count })
          : <Box component="span" sx={quietSx}>{t('pages.administrationView.scopeEmpty')}</Box>}
        selected={selected === null}
        onSelect={() => onSelect(null)}
      />
    </Box>
  );
}

/**
 * Administration zones (the administration view of the ANSSI mapping guide): the zones in a compact
 * band, the control points, then the assets with their zone, technologies, applications and findings.
 */
export default function AdministrationViewPage() {
  const { t, i18n } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);
  // The zone the band narrows the list to: a code, `null` for "No zone", `undefined` for none.
  const [zoneFilter, setZoneFilter] = React.useState<string | null | undefined>(undefined);
  const summary = useQuery({
    queryKey: ['technologies', 'reports', 'administration', 'summary'],
    queryFn: async () => (await api.get<AdministrationSummary>(ENDPOINT)).data,
  });

  const selectZone = (code: string | null) => setZoneFilter((current) => (current === code ? undefined : code));

  const exportDomains = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const language = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);
      const res = await api.get(`${ENDPOINT}/export`, { params: { list: 'domains', language }, responseType: 'blob' });
      downloadBlob(res.data as Blob, extractFilenameFromDisposition(res.headers?.['content-disposition']) || 'administration_view_domains.csv');
    } catch (err) {
      setExportError(getApiErrorMessage(err, t, t('pages.administrationView.exportFailed')));
    } finally {
      setExporting(false);
    }
  };

  const data = summary.data;
  const catalogEmpty = !!data && data.zones.every((zone) => zone.unknown);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <PageHeader
          title={t('pages.administrationView.zones')}
          actions={<Button variant="action" disabled={exporting} onClick={() => void exportDomains()}>{t('pages.administrationView.exportDomains')}</Button>}
        />
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('pages.administrationView.subtitle')}</Typography>
      </Box>
      {exportError && <Alert severity="error">{exportError}</Alert>}
      {!data && <ReportDataStatus loading={summary.isLoading} error={summary.isError} onRetry={() => void summary.refetch()} />}
      {data && (
        <Box>
          {catalogEmpty && (
            <Typography sx={{ fontSize: 13, ...quietSx, mb: 1 }}>
              {t('pages.administrationView.noZones')}
              {hasLevel('settings', 'reader') && <>{' '}<RecordLink to="/it/settings">{t('pages.administrationView.openSettings')}</RecordLink></>}
            </Typography>
          )}
          <ZoneBand summary={data} selected={zoneFilter} onSelect={selectZone} />
        </Box>
      )}
    </Box>
  );
}
