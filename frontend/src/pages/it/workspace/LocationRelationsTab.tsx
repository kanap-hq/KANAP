import React from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';

type AssetRow = {
  id: string;
  name: string;
  kind: string;
  provider: string;
  environment: string;
  region: string | null;
  zone: string | null;
  status: string;
  sub_location_id?: string | null;
  sub_location_name?: string | null;
};

type ApplicationRow = {
  id: string;
  name: string;
  environments: string[];
};

type Props = {
  locationId: string;
};

const headerSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.tertiary',
  textTransform: 'none',
  letterSpacing: 0,
  pb: 1,
} as const;

const cellSx = {
  fontSize: 13,
  color: 'kanap.text.primary',
  py: '8px',
  verticalAlign: 'top',
} as const;

export default function LocationRelationsTab({ locationId }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const navigate = useNavigate();
  const { labelFor } = useItOpsEnumOptions();
  const [assets, setAssets] = React.useState<AssetRow[]>([]);
  const [applications, setApplications] = React.useState<ApplicationRow[]>([]);
  const [hasSubLocations, setHasSubLocations] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [assetRes, appRes, subRes] = await Promise.all([
        api.get(`/locations/${locationId}/servers`),
        api.get(`/locations/${locationId}/applications`),
        api.get(`/locations/${locationId}/sub-items`),
      ]);
      setAssets((assetRes.data || []) as AssetRow[]);
      const apps = (appRes.data || []) as ApplicationRow[];
      setApplications(apps.map((app) => ({
        ...app,
        environments: Array.isArray(app.environments) ? app.environments : [],
      })));
      setHasSubLocations(Array.isArray(subRes.data) && subRes.data.length > 0);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.loadRelationsFailed')));
    }
  }, [locationId, t]);

  React.useEffect(() => { void load(); }, [load]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {error && <Alert severity="error">{error}</Alert>}

      <Box>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'kanap.text.primary', mb: 1 }}>
          {t('it:workspace.location.relations.assetsTitle')}
        </Typography>
        {assets.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
            {t('it:workspace.location.relations.noAssets')}
          </Typography>
        ) : (
          <Box
            component="table"
            sx={(theme) => ({
              width: '100%',
              borderCollapse: 'collapse',
              '& th': {
                ...headerSx,
                textAlign: 'left',
                borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
              },
              '& td': {
                ...cellSx,
                borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
              },
              '& tbody tr': {
                cursor: 'pointer',
              },
              '& tbody tr:hover': {
                backgroundColor: theme.palette.kanap.bg.hover,
              },
            })}
          >
            <Box component="thead">
              <Box component="tr">
                <Box component="th">{t('it:common.name')}</Box>
                {hasSubLocations && <Box component="th">{t('it:workspace.location.relations.subLocation')}</Box>}
                <Box component="th">{t('it:common.environment')}</Box>
                <Box component="th">{t('it:workspace.location.relations.type')}</Box>
                <Box component="th">{t('it:workspace.location.relations.provider')}</Box>
                <Box component="th">{t('it:workspace.location.relations.regionZone')}</Box>
                <Box component="th">{t('it:workspace.location.relations.status')}</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {assets.map((server) => (
                <Box
                  component="tr"
                  key={server.id}
                  onClick={() => navigate(`/it/assets/${server.id}/overview`)}
                >
                  <Box component="td">{server.name}</Box>
                  {hasSubLocations && (
                    <Box component="td" sx={{ color: 'kanap.text.secondary' }}>
                      {server.sub_location_name || '—'}
                    </Box>
                  )}
                  <Box component="td">{server.environment || '—'}</Box>
                  <Box component="td">{labelFor('serverKind', server.kind) || server.kind || '—'}</Box>
                  <Box component="td">{labelFor('serverProvider', server.provider) || server.provider || '—'}</Box>
                  <Box component="td">{[server.region, server.zone].filter(Boolean).join(' / ') || '—'}</Box>
                  <Box component="td" sx={{ color: 'kanap.text.secondary' }}>{server.status}</Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      <Box>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'kanap.text.primary', mb: 1 }}>
          {t('it:workspace.location.relations.applicationsTitle')}
        </Typography>
        {applications.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
            {t('it:workspace.location.relations.noApplications')}
          </Typography>
        ) : (
          <Box
            component="table"
            sx={(theme) => ({
              width: '100%',
              borderCollapse: 'collapse',
              '& th': {
                ...headerSx,
                textAlign: 'left',
                borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
              },
              '& td': {
                ...cellSx,
                borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
              },
              '& tbody tr': { cursor: 'pointer' },
              '& tbody tr:hover': { backgroundColor: theme.palette.kanap.bg.hover },
            })}
          >
            <Box component="thead">
              <Box component="tr">
                <Box component="th">{t('it:common.name')}</Box>
                <Box component="th">{t('it:workspace.location.relations.environments')}</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {applications.map((app) => (
                <Box
                  component="tr"
                  key={app.id}
                  onClick={() => navigate(`/it/applications/${app.id}/overview`)}
                >
                  <Box component="td">{app.name}</Box>
                  <Box component="td" sx={{ color: 'kanap.text.secondary' }}>
                    {app.environments.filter(Boolean).join(', ') || '—'}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
