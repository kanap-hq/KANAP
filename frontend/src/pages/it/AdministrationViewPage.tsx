import React from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import api from '../../api';
import PageHeader from '../../components/PageHeader';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../components/workspace/RelationsTable';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import type { DomainTrustDirection } from '../../services/itOpsSettings';

type Server = { id: string; name: string; reference: string | null; via_name: string | null };
type Technology = { id: string; reference: string | null; name: string; family: string; directory: boolean; servers: Server[] };
export type AdministrationZone = {
  code: string | null;
  label: string | null;
  admin_group: string | null;
  privilege_level: string | null;
  secrets_location: string | null;
  description: string | null;
  deprecated: boolean;
  unknown: boolean;
  technologies: Technology[];
  directory_services: Array<{ id: string; reference: string | null; name: string }>;
  server_count: number;
};
export type AdministrationDomain = {
  code: string;
  label: string;
  dns_suffix: string;
  forest: string | null;
  trusts: Array<{ domain: string; label: string; direction: DomainTrustDirection }>;
  account_count: number | null;
  machine_count: number | null;
  domain_controllers: Array<{ id: string; name: string; reference: string | null }>;
  deprecated: boolean;
};
export type AdministrationView = { zones: AdministrationZone[]; domains: AdministrationDomain[]; unplaced_count: number };

const ENDPOINT = '/technologies/reports/administration';

/** A catalog value's name in the user's language (tenant translation, then the stored name). */
function useCatalogName() {
  const { byField } = useItOpsEnumOptions();
  return React.useCallback((field: 'adminZone' | 'domain', code: string, fallback: string) => (
    (byField[field] || []).find((option) => option.code === code)?.label || fallback
  ), [byField]);
}

/** A neutral link inside a row that opens something else: it opens its own record only. */
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

function Servers({ servers }: { servers: Server[] }) {
  const { t } = useTranslation('it');
  if (!servers.length) return <Typography component="span" sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('pages.administrationView.noServer')}</Typography>;
  return (
    <>
      {servers.map((server, index) => (
        <React.Fragment key={server.id}>
          {index > 0 && ', '}
          <RecordLink to={`/it/assets/${server.id}`}>{server.name}</RecordLink>
          {server.via_name && <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}> {t('pages.administrationView.via', { name: server.via_name })}</Typography>}
        </React.Fragment>
      ))}
    </>
  );
}

/** A zone's attributes on one quiet line: "Administrator group: … · Privilege level: … · Secrets: …". */
function ZoneAttributes({ zone }: { zone: AdministrationZone }) {
  const { t } = useTranslation('it');
  const parts = [
    [t('pages.administrationView.attributes.adminGroup'), zone.admin_group],
    [t('pages.administrationView.attributes.privilegeLevel'), zone.privilege_level],
    [t('pages.administrationView.attributes.secretsLocation'), zone.secrets_location],
  ].filter(([, value]) => value) as Array<[string, string]>;
  return (
    <Stack spacing={0.25} sx={{ mb: 1 }}>
      {parts.length > 0 && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {parts.map(([label, value], index) => (
            <React.Fragment key={label}>
              {index > 0 && <Box component="span" sx={{ color: 'kanap.text.tertiary', mx: 0.75 }}>·</Box>}
              <Box component="span" sx={{ color: 'kanap.text.tertiary', mr: 0.5 }}>{label}</Box><span>{value}</span>
            </React.Fragment>
          ))}
        </Typography>
      )}
      {zone.description && <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{zone.description}</Typography>}
      {zone.directory_services.length > 0 && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('pages.administrationView.attributes.directoryServices')}</Box>{' '}
          {zone.directory_services.map((service) => service.name).join(', ')}
        </Typography>
      )}
    </Stack>
  );
}

function ZoneSection({ zone }: { zone: AdministrationZone }) {
  const { t } = useTranslation('it');
  const { labelFor } = useItOpsEnumOptions();
  const nameOf = useCatalogName();
  const columns: Array<RelationsColumn<Technology>> = [
    { key: 'reference', header: t('pages.administrationView.columns.reference'), width: 80, render: (row) => <RelationRef>{row.reference}</RelationRef> },
    { key: 'name', header: t('pages.administrationView.columns.technology'), width: 220, render: (row) => row.name },
    { key: 'family', header: t('pages.administrationView.columns.family'), width: 180, render: (row) => labelFor('technologyFamily', row.family) },
    { key: 'servers', header: t('pages.administrationView.columns.servers'), render: (row) => <Servers servers={row.servers} /> },
  ];
  const title = zone.code === null
    ? t('pages.administrationView.noZone')
    : zone.unknown ? t('pages.administrationView.unknownZone', { code: zone.code }) : nameOf('adminZone', zone.code, zone.label ?? zone.code);
  return (
    <Box>
      <RelationsSection title={title} count={zone.technologies.length}>
        {zone.code === null
          ? <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>{t('pages.administrationView.noZoneHint')}</Typography>
          : <ZoneAttributes zone={zone} />}
        {zone.technologies.length
          ? <RelationsTable columns={columns} rows={zone.technologies} rowKey={(row) => row.id} rowHref={(row) => `/it/technologies/${row.id}`} ariaLabel={title} />
          : <RelationsEmpty>{t('pages.administrationView.emptyZone')}</RelationsEmpty>}
      </RelationsSection>
    </Box>
  );
}

function DomainsSection({ domains }: { domains: AdministrationDomain[] }) {
  const { t } = useTranslation('it');
  const nameOf = useCatalogName();
  const count = (value: number | null) => (value == null ? <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('pages.administrationView.notSet')}</Box> : value.toLocaleString());
  const columns: Array<RelationsColumn<AdministrationDomain>> = [
    { key: 'name', header: t('pages.administrationView.columns.domain'), width: 180, render: (row) => nameOf('domain', row.code, row.label) },
    { key: 'dns', header: t('pages.administrationView.columns.dnsSuffix'), width: 180, render: (row) => row.dns_suffix },
    { key: 'forest', header: t('pages.administrationView.columns.forest'), width: 180, render: (row) => row.forest ?? <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('pages.administrationView.notSet')}</Box> },
    {
      key: 'trusts',
      header: t('pages.administrationView.columns.trusts'),
      width: 220,
      render: (row) => (row.trusts.length
        ? row.trusts.map((trust) => `${nameOf('domain', trust.domain, trust.label)} (${t(`pages.settings.trusts.directions.${trust.direction}`)})`).join(', ')
        : <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('pages.administrationView.none')}</Box>),
    },
    { key: 'accounts', header: t('pages.administrationView.columns.accounts'), width: 90, align: 'right', render: (row) => count(row.account_count) },
    { key: 'machines', header: t('pages.administrationView.columns.machines'), width: 90, align: 'right', render: (row) => count(row.machine_count) },
    {
      key: 'controllers',
      header: t('pages.administrationView.columns.domainControllers'),
      render: (row) => (row.domain_controllers.length
        ? <><Box component="span" sx={{ mr: 0.75 }}>{row.domain_controllers.length}</Box><Servers servers={row.domain_controllers.map((dc) => ({ ...dc, via_name: null }))} /></>
        : <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('pages.administrationView.noController')}</Box>),
    },
  ];
  return (
    <RelationsSection title={t('pages.administrationView.domains')} count={domains.length}>
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>{t('pages.administrationView.domainsHint')}</Typography>
      {domains.length
        ? <RelationsTable columns={columns} rows={domains} rowKey={(row) => row.code} ariaLabel={t('pages.administrationView.domains')} />
        : <RelationsEmpty>{t('pages.administrationView.noDomains')}</RelationsEmpty>}
    </RelationsSection>
  );
}

/**
 * The administration view (ANSSI mapping guide, view 4): per administration zone, its attributes,
 * technologies, servers and directory services; the technologies without a zone to complete; then
 * the domains with forest, trusts, counts and the domain controllers deduced from the server role.
 */
export default function AdministrationViewPage() {
  const { t, i18n } = useTranslation(['it', 'common']);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState<'zones' | 'domains' | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['technologies', 'reports', 'administration'],
    queryFn: async () => (await api.get<AdministrationView>(ENDPOINT)).data,
  });

  const exportList = async (list: 'zones' | 'domains') => {
    setExporting(list);
    setExportError(null);
    try {
      const language = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);
      const res = await api.get(`${ENDPOINT}/export`, { params: { list, language }, responseType: 'blob' });
      downloadBlob(res.data as Blob, extractFilenameFromDisposition(res.headers?.['content-disposition']) || `administration_view_${list}.csv`);
    } catch (err) {
      setExportError(getApiErrorMessage(err, t, t('pages.administrationView.exportFailed')));
    } finally {
      setExporting(null);
    }
  };

  const zones = data?.zones ?? [];
  const catalogEmpty = !!data && !zones.some((zone) => zone.code !== null);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader
        title={t('pages.administrationView.title')}
        actions={(
          <Stack direction="row" spacing={1}>
            <Button variant="action" disabled={!data || exporting !== null} onClick={() => void exportList('zones')}>{t('pages.administrationView.exportZones')}</Button>
            <Button variant="action" disabled={!data || exporting !== null} onClick={() => void exportList('domains')}>{t('pages.administrationView.exportDomains')}</Button>
          </Stack>
        )}
      />
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('pages.administrationView.intro')}</Typography>
      {error && <Alert severity="error">{getApiErrorMessage(error, t, t('pages.administrationView.loadFailed'))}</Alert>}
      {exportError && <Alert severity="error">{exportError}</Alert>}
      {data && data.unplaced_count > 0 && (
        <Alert severity="warning">{t('pages.administrationView.unplaced', { count: data.unplaced_count })}</Alert>
      )}
      {isLoading && <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('pages.administrationView.loading')}</Typography>}
      {data && (
        <Stack spacing={3}>
          <Box>
            <Typography component="h2" sx={{ m: 0, mb: 1, fontSize: 16, fontWeight: 500 }}>{t('pages.administrationView.zones')}</Typography>
            {catalogEmpty && (
              <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary', mb: 1 }}>
                {t('pages.administrationView.noZones')}{' '}
                <RecordLink to="/it/settings">{t('pages.administrationView.openSettings')}</RecordLink>
              </Typography>
            )}
            <Stack spacing={2.5}>
              {zones.map((zone) => <ZoneSection key={zone.code ?? '__none__'} zone={zone} />)}
            </Stack>
          </Box>
          <DomainsSection domains={data.domains} />
        </Stack>
      )}
    </Box>
  );
}
