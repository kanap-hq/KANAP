import { useState, useMemo, Suspense, lazy } from 'react';
import {
  Box,
  ButtonGroup,
  Grid,
  Stack,
  Button,
  IconButton,
  Tooltip,
  Skeleton,
  Card,
  Paper,
  Typography,
  Menu,
  MenuItem,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListSubheader,
  TextField,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import AddTaskIcon from '@mui/icons-material/AddTask';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import InboxIcon from '@mui/icons-material/Inbox';
import DnsIcon from '@mui/icons-material/Dns';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import DescriptionIcon from '@mui/icons-material/Description';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useDashboardConfig } from './hooks/useDashboardConfig';
import { useTilePermissions } from './hooks/useTilePermissions';
import { TILE_REGISTRY, TILE_LOADERS } from './tiles/TileRegistry';
import DashboardTile from './tiles/DashboardTile';
import DashboardSettingsModal from './settings/DashboardSettingsModal';
import QuickLogTimeModal from './actions/QuickLogTimeModal';
import SampleDataBanner from '../admin/sample-data/SampleDataBanner';

// Create lazy-loaded tile components
const tileComponents: Record<string, ReturnType<typeof lazy>> = {};
Object.entries(TILE_LOADERS).forEach(([id, loader]) => {
  tileComponents[id] = lazy(async () => {
    const component = await loader();
    return { default: component };
  });
});

// Quick actions keep their outlined look, at the height and radius of the action pills.
const quickActionSx = { height: 30, borderRadius: '5px' } as const;

function TileLoader() {
  return (
    <Card sx={{ height: '100%', p: 2 }}>
      <Skeleton variant="text" width="60%" height={32} />
      <Skeleton variant="rectangular" height={120} sx={{ mt: 2 }} />
    </Card>
  );
}

type DocumentLibrary = {
  id: string;
  name: string;
  slug: string;
  is_system: boolean;
  display_order: number;
};

type TemplateListItem = {
  id: string;
  item_number: number;
  title: string;
  document_type_name: string | null;
};

export default function WorkspaceDashboardPage() {
  const navigate = useNavigate();
  const { hasLevel, profile } = useAuth();
  const { t } = useTranslation('common');
  const { config, isLoading: configLoading } = useDashboardConfig();
  const { filterVisibleTiles, canViewTile } = useTilePermissions();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [newDocAnchorEl, setNewDocAnchorEl] = useState<null | HTMLElement>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Quick actions visibility
  const canCreateTask = hasLevel('tasks', 'member');
  const canLogTime = hasLevel('portfolio_projects', 'member') || hasLevel('tasks', 'member');
  const canCreateRequest = hasLevel('portfolio_requests', 'member');
  const canCreateAsset = hasLevel('infrastructure', 'member');
  const canCreateApp = hasLevel('applications', 'member');
  const canCreateDocument = hasLevel('knowledge', 'member');

  const { data: knowledgeLibraries = [] } = useQuery({
    queryKey: ['knowledge-libraries'],
    queryFn: async () => (await api.get('/knowledge-libraries')).data as DocumentLibrary[],
    enabled: canCreateDocument,
    staleTime: 5 * 60 * 1000,
  });

  const templatesLibrary = useMemo(
    () => knowledgeLibraries.find((row) => row.slug === 'templates') || null,
    [knowledgeLibraries],
  );

  const { data: templatesData } = useQuery({
    queryKey: ['dashboard', 'knowledge-templates', templatesLibrary?.id],
    queryFn: async () => {
      const res = await api.get('/knowledge', {
        params: {
          library_id: templatesLibrary?.id,
          status: 'published',
          limit: 200,
          sort: 'updated_at:DESC',
        },
      });
      return res.data as { items: TemplateListItem[] };
    },
    enabled: templatePickerOpen && !!templatesLibrary?.id,
    staleTime: 5 * 60 * 1000,
  });

  const groupedTemplates = useMemo(() => {
    const groups: Array<{ typeName: string; items: TemplateListItem[] }> = [];
    const byType = new Map<string, TemplateListItem[]>();
    for (const item of templatesData?.items || []) {
      const typeName = String(item.document_type_name || 'Document').trim() || 'Document';
      if (!byType.has(typeName)) byType.set(typeName, []);
      byType.get(typeName)!.push(item);
    }
    Array.from(byType.keys())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .forEach((typeName) => {
        groups.push({
          typeName,
          items: (byType.get(typeName) || []).sort((a, b) => {
            if (a.title === b.title) return Number(b.item_number || 0) - Number(a.item_number || 0);
            return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
          }),
        });
      });
    return groups;
  }, [templatesData?.items]);

  // Filter tiles by permission AND enabled status
  const visibleTiles = useMemo(() => {
    return filterVisibleTiles(config.tiles)
      .filter((t) => t.enabled)
      .sort((a, b) => a.order - b.order);
  }, [config.tiles, filterVisibleTiles]);

  const userName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  const welcome = userName ? t('dashboard.welcomeBack', { name: profile?.first_name || userName }) : t('dashboard.welcome');

  const goToBlankDocument = () => {
    navigate('/knowledge/new');
  };

  const openTemplatePicker = () => {
    setTemplatePickerOpen(true);
    setSelectedTemplateId('');
  };

  const createFromTemplate = () => {
    if (!selectedTemplateId) return;
    navigate(`/knowledge/new?template_document_id=${encodeURIComponent(selectedTemplateId)}`);
    setTemplatePickerOpen(false);
    setSelectedTemplateId('');
  };

  return (
    <Box sx={{ p: 3 }}>
      <SampleDataBanner />
      <Paper
        variant="outlined"
        sx={{ mb: 3, p: 2.5, borderRadius: '8px', bgcolor: 'kanap.bg.drawer' }}
      >
        {/* Header */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="h5" fontWeight={500} sx={{ mb: 1 }}>
            {welcome}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('dashboard.workOverview')}
          </Typography>
        </Box>

        {/* Quick Actions */}
        <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
          {canCreateTask && (
            <Button
              variant="outlined"
              startIcon={<AddTaskIcon />}
              onClick={() => navigate('/portfolio/tasks/new/overview')}
              size="small"
              sx={quickActionSx}
            >
              {t('dashboard.createTask')}
            </Button>
          )}
          {canLogTime && (
            <Button
              variant="outlined"
              startIcon={<AccessTimeIcon />}
              onClick={() => setLogTimeOpen(true)}
              size="small"
              sx={quickActionSx}
            >
              {t('dashboard.logTime')}
            </Button>
          )}
          {canCreateRequest && (
          <Button
              variant="outlined"
              startIcon={<InboxIcon />}
              onClick={() => navigate('/portfolio/requests/new/summary')}
              size="small"
              sx={quickActionSx}
            >
              {t('dashboard.newRequest')}
            </Button>
          )}
          {canCreateApp && (
            <Button
              variant="outlined"
              startIcon={<WorkOutlineIcon />}
              onClick={() => navigate('/it/applications/new/overview')}
              size="small"
              sx={quickActionSx}
            >
              {t('dashboard.newApplication')}
            </Button>
          )}
          {canCreateAsset && (
            <Button
              variant="outlined"
              startIcon={<DnsIcon />}
              onClick={() => navigate('/it/assets/new/overview')}
              size="small"
              sx={quickActionSx}
            >
              {t('dashboard.newAsset')}
            </Button>
          )}
          {canCreateDocument && (
            <ButtonGroup variant="outlined" size="small">
              <Button
                startIcon={<DescriptionIcon />}
                onClick={goToBlankDocument}
                sx={quickActionSx}
              >
                {t('dashboard.newDocument')}
              </Button>
              <Button
                onClick={(event) => setNewDocAnchorEl(event.currentTarget)}
                sx={[quickActionSx, { px: 0.5, minWidth: 'auto' }]}
              >
                <ArrowDropDownIcon />
              </Button>
            </ButtonGroup>
          )}
          <Box flex={1} />
          <Tooltip title={t('dashboard.dashboardSettings')}>
            <IconButton onClick={() => setSettingsOpen(true)} size="small">
              <SettingsIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Paper>

      {/* Tile Grid */}
      {configLoading ? (
        <Grid container spacing={3}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Grid item xs={12} md={6} lg={4} xl={3} key={i}>
              <TileLoader />
            </Grid>
          ))}
        </Grid>
      ) : visibleTiles.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            {t('dashboard.noTilesEnabled')}
          </Typography>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {visibleTiles.map((tile) => {
            const TileComponent = tileComponents[tile.id];
            const tileInfo = TILE_REGISTRY[tile.id];

            if (!TileComponent || !tileInfo) return null;

            return (
              <Grid item xs={12} md={6} lg={4} xl={3} key={tile.id}>
                <Suspense
                  fallback={
                    <DashboardTile
                      title={t(tileInfo.titleKey)}
                      icon={tileInfo.icon}
                      isLoading
                    >
                      <div />
                    </DashboardTile>
                  }
                >
                  <TileComponent config={tile.config} />
                </Suspense>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Modals */}
      <DashboardSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        canViewTile={canViewTile}
      />
      <QuickLogTimeModal open={logTimeOpen} onClose={() => setLogTimeOpen(false)} />

      <Menu
        anchorEl={newDocAnchorEl}
        open={Boolean(newDocAnchorEl)}
        onClose={() => setNewDocAnchorEl(null)}
      >
        <MenuItem onClick={() => { setNewDocAnchorEl(null); goToBlankDocument(); }}>
          {t('dashboard.blankDocument')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setNewDocAnchorEl(null);
            openTemplatePicker();
          }}
          disabled={!templatesLibrary}
        >
          {t('dashboard.fromTemplate')}
        </MenuItem>
      </Menu>

      <Dialog open={templatePickerOpen} onClose={() => setTemplatePickerOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('dashboard.selectTemplate')}</DialogTitle>
        <DialogContent>
          <TextField
            select
            fullWidth
            margin="dense"
            label={t('labels.template')}
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
          >
            {groupedTemplates.map((group) => ([
              <ListSubheader key={`${group.typeName}-header`} disableSticky>
                {group.typeName}
              </ListSubheader>,
              ...group.items.map((row) => (
                <MenuItem key={row.id} value={row.id}>
                  {`DOC-${row.item_number} - ${row.title}`}
                </MenuItem>
              )),
            ]))}
          </TextField>
          {!templatesData?.items?.length && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('dashboard.noTemplatesAvailable')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="action" onClick={() => setTemplatePickerOpen(false)}>{t('buttons.cancel')}</Button>
          <Button variant="action-primary" onClick={createFromTemplate} disabled={!selectedTemplateId}>
            {t('dashboard.useTemplate')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
