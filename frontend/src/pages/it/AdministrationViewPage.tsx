import React from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../components/workspace/RelationsTable';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import type { DomainTrustDirection } from '../../services/itOpsSettings';

/** Fixed columns stay next to each other; the unsized column takes the spare width. */
const COL = { ref: 96, name: 240, type: 160, zone: 180 } as const;

type ZoneAsset = { id: string; name: string; reference: string | null; kind: string };
type DirectoryService = { id: string; reference: string | null; name: string };

export type AdministrationZone = {
  code: string;
  label: string | null;
  admin_group: string | null;
  description: string | null;
  deprecated: boolean;
  unknown: boolean;
  assets: ZoneAsset[];
  asset_counts: Array<{ kind: string; count: number }>;
  hosted_application_count: number;
  directory_services: DirectoryService[];
};

export type AdministrationDomain = {
  code: string;
  label: string;
  dns_suffix: string;
  forest: string | null;
  trusts: Array<{ domain: string; label: string; direction: DomainTrustDirection }>;
  /** Trusts declared on other domains toward this one, read only, seen from this domain. */
  declared_by: Array<{ domain: string; label: string; direction: DomainTrustDirection }>;
  account_count: number | null;
  machine_count: number | null;
  domain_controllers: Array<{ id: string; name: string; reference: string | null }>;
  deprecated: boolean;
};

export type TrustRaised = {
  asset: ZoneAsset;
  asset_zone: string;
  holder: ZoneAsset;
  holder_zone: string;
  holder_kind: 'contains' | 'cluster';
};

export type HostedApplication = {
  id: string;
  name: string;
  reference: string | null;
  asset: ZoneAsset;
};

export type AdministrationControls = {
  most_sensitive_zone: string | null;
  assets_without_zone: ZoneAsset[];
  domain_controllers_outside: ZoneAsset[] | null;
  directory_assets_outside: ZoneAsset[] | null;
  trust_raised: TrustRaised[] | null;
  applications_on_most_sensitive: HostedApplication[] | null;
};

export type AdministrationView = {
  zones: AdministrationZone[];
  domains: AdministrationDomain[];
  controls: AdministrationControls;
};

const ENDPOINT = '/technologies/reports/administration';

function filler<T>(): RelationsColumn<T> {
  return { key: 'room', header: '\u00a0', render: () => null };
}

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

function referenceLink(to: string, reference: string | null, name: string) {
  return (
    <RecordLink to={to}>
      {reference ? <RelationRef>{reference}</RelationRef> : name}
    </RecordLink>
  );
}

function NameLinks({ items }: { items: Array<{ id: string; name: string }> }) {
  return (
    <>
      {items.map((item, index) => (
        <React.Fragment key={item.id}>
          {index > 0 && ', '}
          <RecordLink to={`/it/assets/${item.id}`}>{item.name}</RecordLink>
        </React.Fragment>
      ))}
    </>
  );
}

function ZoneSection({ zone }: { zone: AdministrationZone }) {
  const { t } = useTranslation(['it', 'common']);
  const { labelFor } = useItOpsEnumOptions();
  const nameOf = useCatalogName();
  const assetColumns: Array<RelationsColumn<ZoneAsset>> = [
    { key: 'reference', header: t('pages.administrationView.columns.reference'), width: COL.ref, render: (row) => referenceLink(`/it/assets/${row.id}`, row.reference, row.name) },
    { key: 'name', header: t('common.name'), width: COL.name, render: (row) => row.name },
    { key: 'kind', header: t('pages.administrationView.columns.type'), width: COL.type, render: (row) => labelFor('serverKind', row.kind) },
    filler(),
  ];
  const directoryColumns: Array<RelationsColumn<DirectoryService>> = [
    { key: 'reference', header: t('pages.administrationView.columns.reference'), width: COL.ref, render: (row) => referenceLink(`/it/technologies/${row.id}`, row.reference, row.name) },
    { key: 'name', header: t('common.name'), width: COL.name, render: (row) => row.name },
    filler(),
  ];
  const title = zone.unknown
    ? t('pages.administrationView.unknownZone', { code: zone.code })
    : `${nameOf('adminZone', zone.code, zone.label ?? zone.code)}${zone.deprecated ? ` (${t('common:enumEditor.retiredSuffix')})` : ''}`;
  const counts = zone.asset_counts.map((item) => `${labelFor('serverKind', item.kind)}: ${item.count}`).join(', ');
  return (
    <RelationsSection title={title} count={zone.assets.length}>
      <Stack spacing={0.25} sx={{ mb: 1 }}>
        {zone.admin_group && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            <Box component="span" sx={{ color: 'kanap.text.tertiary', mr: 0.5 }}>{t('pages.administrationView.attributes.adminGroup')}</Box>
            <span>{zone.admin_group}</span>
          </Typography>
        )}
        {zone.description && <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{zone.description}</Typography>}
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>
        {zone.assets.length
          ? (
            <>
              <Box component="span">{counts}</Box>
              <Box component="span" sx={{ color: 'kanap.text.tertiary', mx: 0.75 }}>·</Box>
              {t('pages.administrationView.hostedApplications', { count: zone.hosted_application_count })}
            </>
          )
          : t('pages.administrationView.scopeEmpty')}
      </Typography>
      {zone.assets.length
        ? (
          <RelationsTable
            columns={assetColumns}
            rows={zone.assets}
            rowKey={(row) => row.id}
            rowHref={(row) => `/it/assets/${row.id}`}
            ariaLabel={t('pages.administrationView.scope')}
          />
        )
        : null}
      {zone.directory_services.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography component="h3" sx={{ m: 0, mb: 0.75, fontSize: 13, fontWeight: 500 }}>
            {t('pages.administrationView.attributes.directoryServices')}
          </Typography>
          <RelationsTable
            columns={directoryColumns}
            rows={zone.directory_services}
            rowKey={(row) => row.id}
            rowHref={(row) => `/it/technologies/${row.id}`}
            ariaLabel={t('pages.administrationView.attributes.directoryServices')}
          />
        </Box>
      )}
    </RelationsSection>
  );
}

function DomainsSection({ domains }: { domains: AdministrationDomain[] }) {
  const { t } = useTranslation(['it', 'common']);
  const nameOf = useCatalogName();
  // An absent value: a grey dash, "Not set" on hover (the convention of an unknown version in the Relations tab).
  const notSet = <Box component="span" title={t('pages.administrationView.notSet')} sx={{ color: 'kanap.text.tertiary' }}>—</Box>;
  const count = (value: number | null) => (value == null ? notSet : value.toLocaleString());
  const columns: Array<RelationsColumn<AdministrationDomain>> = [
    { key: 'name', header: t('pages.administrationView.columns.domain'), width: 180, render: (row) => `${nameOf('domain', row.code, row.label)}${row.deprecated ? ` (${t('common:enumEditor.retiredSuffix')})` : ''}` },
    { key: 'dns', header: t('pages.administrationView.columns.dnsSuffix'), width: 180, render: (row) => row.dns_suffix },
    { key: 'forest', header: t('pages.administrationView.columns.forest'), width: 180, render: (row) => row.forest ?? notSet },
    {
      key: 'trusts',
      header: t('pages.administrationView.columns.trusts'),
      width: 220,
      render: (row) => (row.trusts.length || row.declared_by.length
        ? (
          <>
            {row.trusts.map((trust) => `${nameOf('domain', trust.domain, trust.label)} (${t(`pages.settings.trusts.directions.${trust.direction}`)})`).join(', ')}
            {row.declared_by.length > 0 && (
              <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>
                {row.trusts.length > 0 && ', '}
                {row.declared_by.map((trust) => t('pages.administrationView.declaredTrust', { name: nameOf('domain', trust.domain, trust.label), direction: t(`pages.settings.trusts.directions.${trust.direction}`) })).join(', ')}
              </Box>
            )}
          </>
        )
        : <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('pages.administrationView.none')}</Box>),
    },
    { key: 'accounts', header: t('pages.administrationView.columns.accounts'), width: 80, align: 'right', render: (row) => count(row.account_count) },
    { key: 'machines', header: t('pages.administrationView.columns.machines'), width: 80, align: 'right', render: (row) => count(row.machine_count) },
    {
      key: 'controllers',
      header: t('pages.administrationView.columns.domainControllers'),
      render: (row) => (row.domain_controllers.length
        ? <><Box component="span" sx={{ mr: 0.75 }}>{row.domain_controllers.length}</Box><NameLinks items={row.domain_controllers} /></>
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

function ControlPoints({ view }: { view: AdministrationView }) {
  const { t } = useTranslation(['it', 'common']);
  const { labelFor } = useItOpsEnumOptions();
  const nameOf = useCatalogName();
  const zoneLabel = (code: string | null) => {
    if (!code) return t('pages.administrationView.noZone');
    const zone = view.zones.find((item) => item.code === code);
    if (!zone || zone.unknown) return t('pages.administrationView.unknownZone', { code });
    const name = nameOf('adminZone', code, zone.label ?? code);
    return zone.deprecated ? `${name} (${t('common:enumEditor.retiredSuffix')})` : name;
  };
  const kind = (code: string) => labelFor('serverKind', code);
  const assetColumns = (href: (row: ZoneAsset) => string): Array<RelationsColumn<ZoneAsset>> => [
    { key: 'reference', header: t('pages.administrationView.columns.reference'), width: COL.ref, render: (row) => referenceLink(href(row), row.reference, row.name) },
    { key: 'name', header: t('common.name'), width: COL.name, render: (row) => row.name },
    { key: 'kind', header: t('pages.administrationView.columns.type'), width: COL.type, render: (row) => kind(row.kind) },
    { key: 'zone', header: t('pages.administrationView.columns.zone'), width: COL.zone, render: (row) => zoneLabel(view.zones.find((zone) => zone.assets.some((asset) => asset.id === row.id))?.code ?? null) },
    filler(),
  ];
  const most = view.controls.most_sensitive_zone;
  const mostZone = most ? view.zones.find((zone) => zone.code === most) : undefined;
  const mostName = most ? nameOf('adminZone', most, mostZone?.label ?? most) : null;
  const section = <T,>(key: string, rows: T[], columns: Array<RelationsColumn<T>>, rowKey: (row: T) => string, rowHref: (row: T) => string) => (
    <RelationsSection title={t(`pages.administrationView.controlsList.${key}.title`)} count={rows.length}>
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>{t(`pages.administrationView.controlsList.${key}.hint`)}</Typography>
      {rows.length
        ? <RelationsTable columns={columns} rows={rows} rowKey={rowKey} rowHref={rowHref} ariaLabel={t(`pages.administrationView.controlsList.${key}.title`)} />
        : <RelationsEmpty>{t('pages.administrationView.none')}</RelationsEmpty>}
    </RelationsSection>
  );
  const assetHref = (row: ZoneAsset) => `/it/assets/${row.id}`;
  const placedColumns = assetColumns(assetHref);
  const trustColumns: Array<RelationsColumn<TrustRaised>> = [
    { key: 'reference', header: t('pages.administrationView.columns.reference'), width: COL.ref, render: (row) => referenceLink(`/it/assets/${row.holder.id}`, row.holder.reference, row.holder.name) },
    { key: 'name', header: t('common.name'), width: COL.name, render: (row) => row.holder.name },
    { key: 'relation', header: t('pages.administrationView.columns.relation'), width: COL.type, render: (row) => t(`pages.administrationView.relation.${row.holder_kind}`) },
    {
      key: 'contained',
      header: t('pages.administrationView.columns.contained'),
      render: (row) => (
        <>
          {row.asset.reference ? <><RelationRef>{row.asset.reference}</RelationRef>{' '}</> : null}
          {row.asset.name}
          <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{` · ${zoneLabel(row.asset_zone)}`}</Box>
        </>
      ),
    },
  ];
  const applicationColumns: Array<RelationsColumn<HostedApplication>> = [
    { key: 'reference', header: t('pages.administrationView.columns.reference'), width: COL.ref, render: (row) => referenceLink(`/it/applications/${row.id}`, row.reference, row.name) },
    { key: 'name', header: t('common.name'), width: COL.name, render: (row) => row.name },
    { key: 'asset', header: t('pages.administrationView.columns.asset'), width: COL.type, render: (row) => row.asset.reference ?? row.asset.name },
    filler(),
  ];
  const { controls } = view;
  return (
    <Box>
      <Typography component="h2" sx={{ m: 0, mb: 1, fontSize: 16, fontWeight: 500 }}>{t('pages.administrationView.controls')}</Typography>
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1.5 }}>
        {mostName ? t('pages.administrationView.controlsHint', { zone: mostName }) : t('pages.administrationView.controlsNoCatalog')}
      </Typography>
      <Stack spacing={2.5}>
        {section('assetsWithoutZone', controls.assets_without_zone, placedColumns, (row) => row.id, assetHref)}
        {controls.domain_controllers_outside !== null && section('domainControllers', controls.domain_controllers_outside, placedColumns, (row) => row.id, assetHref)}
        {controls.directory_assets_outside !== null && section('directoryAssets', controls.directory_assets_outside, placedColumns, (row) => row.id, assetHref)}
        {controls.trust_raised !== null && section('trustRaised', controls.trust_raised, trustColumns, (row) => `${row.holder.id}:${row.asset.id}:${row.holder_kind}`, (row) => `/it/assets/${row.holder.id}`)}
        {controls.applications_on_most_sensitive !== null && section('applications', controls.applications_on_most_sensitive, applicationColumns, (row) => `${row.id}:${row.asset.id}`, (row) => `/it/applications/${row.id}`)}
      </Stack>
    </Box>
  );
}

/**
 * The administration view (ANSSI mapping guide, view 4): per administration zone, the assets it
 * covers and the directory services placed in it; the domains; then the control points.
 */
export default function AdministrationViewPage() {
  const { t, i18n } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
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
  const catalogEmpty = !!data && zones.every((zone) => zone.unknown);

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
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('pages.administrationView.lead')}</Typography>
      {error && <Alert severity="error">{getApiErrorMessage(error, t, t('pages.administrationView.loadFailed'))}</Alert>}
      {exportError && <Alert severity="error">{exportError}</Alert>}
      {isLoading && <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('pages.administrationView.loading')}</Typography>}
      {data && (
        <Stack spacing={3}>
          <Box>
            <Typography component="h2" sx={{ m: 0, mb: 1, fontSize: 16, fontWeight: 500 }}>{t('pages.administrationView.zones')}</Typography>
            {catalogEmpty && (
              <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary', mb: 1 }}>
                {t('pages.administrationView.noZones')}
                {hasLevel('settings', 'reader') && <>{' '}<RecordLink to="/it/settings">{t('pages.administrationView.openSettings')}</RecordLink></>}
              </Typography>
            )}
            <Stack spacing={2.5}>
              {zones.map((zone) => <ZoneSection key={zone.code} zone={zone} />)}
            </Stack>
          </Box>
          <DomainsSection domains={data.domains} />
          <ControlPoints view={data} />
        </Stack>
      )}
    </Box>
  );
}
