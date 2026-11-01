import { useState, useMemo, Suspense, lazy } from 'react';
import {
  Box,
  ButtonGroup,
  FormControlLabel,
  Stack,
  Switch,
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
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import TuneIcon from '@mui/icons-material/Tune';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import AddTaskIcon from '@mui/icons-material/AddTask';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import DnsIcon from '@mui/icons-material/Dns';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import DescriptionIcon from '@mui/icons-material/Description';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useDashboardConfig, type DashboardTileConfig } from './hooks/useDashboardConfig';
import { useBudgetDashboardConfig } from './hooks/useBudgetDashboardConfig';
import { useTilePermissions } from './hooks/useTilePermissions';
import { TILE_REGISTRY, TILE_LOADERS } from './tiles/TileRegistry';
import DashboardTile from './tiles/DashboardTile';
import TileOption from './settings/TileOption';
import QuickLogTimeModal from './actions/QuickLogTimeModal';
import SampleDataBanner from '../admin/sample-data/SampleDataBanner';
import EnablePlaidCard from './EnablePlaidCard';
import OnboardingStatusLine from '../../components/onboarding/OnboardingStatusLine';
import FirstStepsTile, { firstStepsShown } from '../../components/onboarding/FirstStepsTile';
import { useOnboarding } from '../../components/onboarding/useOnboarding';
import { angleSection, resolveSections, SECTION_TITLE_KEYS, type SectionId, type SectionState } from './sections';
import BudgetSection, { useBudgetTileAccess } from './BudgetSection';
import TileSection, { sectionSortId, type SectionEntry } from './TileSection';
import { editTileList, inOrder } from './tileListEditing';
import { TileEmptyContext, useEmptyTiles } from './tiles/emptyTiles';

/** What the person changes while customizing the page, saved together when they finish. */
type Draft = { tiles: DashboardTileConfig[]; budgetTiles: DashboardTileConfig[]; sections: SectionState[]; hideEmpty: boolean };

/** The saved home tiles, with every tile of the registry: the ones never saved come in off. */
function allHomeTiles(tiles: DashboardTileConfig[]): DashboardTileConfig[] {
  const known = new Set(tiles.map((tile) => tile.id));
  const missing = Object.entries(TILE_REGISTRY)
    .filter(([id]) => !known.has(id))
    .map(([id, def], index) => ({ id, enabled: false, order: tiles.length + index + 1, config: def.defaultConfig }));
  return inOrder([...tiles, ...missing]);
}

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
  const { config, isLoading: homeLoading, updateConfig, resetConfig } = useDashboardConfig();
  const budgetSettings = useBudgetDashboardConfig();
  const configLoading = homeLoading || budgetSettings.isLoading;
  const { canViewTile } = useTilePermissions();
  const budgetAccess = useBudgetTileAccess();
  const { state: onboarding } = useOnboarding();
  const showFirstSteps = firstStepsShown(onboarding);
  const angle = onboarding?.angle ?? null;

  // Customizing: the page shows the draft until the person finishes or cancels.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const editing = draft !== null;
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [newDocAnchorEl, setNewDocAnchorEl] = useState<null | HTMLElement>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Quick actions visibility
  const canCreateTask = hasLevel('tasks', 'member');
  // Same rules as the server for time entries (see QuickLogTimeModal)
  const canLogTime = hasLevel('portfolio_projects', 'contributor') || hasLevel('tasks', 'member');
  // The creation right of the budget list, for both types of line.
  const canCreateBudgetLine = hasLevel('budget', 'manager');
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

  const homeTiles = draft?.tiles ?? config.tiles;
  const budgetTiles = draft?.budgetTiles ?? budgetSettings.config.tiles;
  const sections = draft?.sections ?? resolveSections(config.sections, angle);
  // A tile with nothing to show is left out while the option is on (the default).
  const hideEmpty = draft?.hideEmpty ?? config.hideEmptyTiles !== false;
  const { empty, reporter } = useEmptyTiles();

  const theme = useTheme();
  const upXl = useMediaQuery(theme.breakpoints.up('xl'));
  const upLg = useMediaQuery(theme.breakpoints.up('lg'));
  const upMd = useMediaQuery(theme.breakpoints.up('md'));
  const perRow = upXl ? 4 : upLg ? 3 : upMd ? 2 : 1;

  // A section exists for the person when they may read one of its tiles.
  const available = (id: SectionId) => (id === 'budget'
    ? budgetAccess.anyBudget
    : Object.entries(TILE_REGISTRY).some(([tileId, def]) => def.section === id && canViewTile(tileId)));
  const shownSections = sections.filter((section) => available(section.id) && (editing || !section.hidden));
  // The first steps lead the section of the person's path, else the first section.
  const stepsSection = showFirstSteps
    ? (shownSections.find((section) => section.id === angleSection(angle) && !section.hidden) ?? shownSections.find((section) => !section.hidden))?.id ?? null
    : null;
  const allEmpty = !editing && hideEmpty && !configLoading && !stepsSection && shownSections.length > 0
    && shownSections.every((section) => empty.has(section.id));
  const noTileOn = !editing && !configLoading && !stepsSection
    && !shownSections.some((section) => (section.id === 'budget'
      ? budgetTiles.some((tile) => tile.enabled && budgetAccess.canViewTile(tile.id) && tile.id !== 'my-tasks')
      : homeTiles.some((tile) => tile.enabled && canViewTile(tile.id) && TILE_REGISTRY[tile.id]?.section === section.id)));

  const startEditing = () => {
    setSaveFailed(false);
    setDraft({
      tiles: allHomeTiles(config.tiles),
      budgetTiles: inOrder(budgetSettings.config.tiles),
      sections: resolveSections(config.sections, angle),
      hideEmpty: config.hideEmptyTiles !== false,
    });
  };
  const finishEditing = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateConfig({ tiles: inOrder(draft.tiles), hideEmptyTiles: draft.hideEmpty, sections: draft.sections });
      if (budgetAccess.anyBudget) await budgetSettings.updateConfig({ tiles: inOrder(draft.budgetTiles) });
      setDraft(null);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };
  const resetToDefaults = async () => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await resetConfig();
      if (budgetAccess.anyBudget) await budgetSettings.resetConfig();
      setDraft(null);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };
  const updateDraft = (patch: Partial<Draft>) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  const toggleSection = (id: SectionId) => updateDraft({ sections: sections.map((section) => (section.id === id ? { ...section, hidden: !section.hidden } : section)) });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const moveSection = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = sections.map((section) => sectionSortId(section.id));
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) updateDraft({ sections: arrayMove(sections, from, to) });
  };

  /** A home tile, loaded on demand, with its options while the page is customized. */
  const homeEntry = (tile: DashboardTileConfig): SectionEntry | null => {
    const TileComponent = tileComponents[tile.id];
    const def = TILE_REGISTRY[tile.id];
    if (!TileComponent || !def) return null;
    const optionEntries = Object.entries(def.configSchema);
    return {
      id: tile.id,
      node: (
        <Suspense fallback={<DashboardTile title={t(def.titleKey)} icon={def.icon} isLoading><div /></DashboardTile>}>
          <TileComponent config={tile.config} />
        </Suspense>
      ),
      options: editing && optionEntries.length > 0 ? (
        <Box>
          {optionEntries.map(([name, schema]) => (
            <TileOption
              key={name}
              name={name}
              schema={schema}
              value={tile.config?.[name] ?? def.defaultConfig[name]}
              onChange={(value) => updateDraft({ tiles: homeTiles.map((entry) => (entry.id === tile.id ? { ...entry, config: { ...entry.config, [name]: value } } : entry)) })}
            />
          ))}
        </Box>
      ) : undefined,
    };
  };

  const renderSection = (section: SectionState) => {
    const leading = section.id === stepsSection ? <FirstStepsTile /> : undefined;
    const sectionEditing = draft ? { hidden: section.hidden, onToggleHidden: () => toggleSection(section.id) } : null;
    if (section.id === 'budget') {
      return (
        <BudgetSection
          tiles={budgetTiles}
          loading={budgetSettings.isLoading}
          leading={leading}
          hideEmpty={hideEmpty}
          perRow={perRow}
          editing={sectionEditing ? { section: sectionEditing, onChange: (next) => updateDraft({ budgetTiles: next }) } : null}
        />
      );
    }
    const inSection = (id: string) => TILE_REGISTRY[id]?.section === section.id && canViewTile(id);
    const entries = [
      ...(leading ? [{ id: 'first-steps', node: leading, fixed: true }] : []),
      ...inOrder(homeTiles).filter((tile) => tile.enabled && inSection(tile.id)).map(homeEntry).filter((entry): entry is SectionEntry => entry !== null),
    ];
    return (
      <TileSection
        id={section.id}
        title={t(SECTION_TITLE_KEYS[section.id])}
        entries={entries}
        perRow={perRow}
        hideEmpty={hideEmpty}
        editing={sectionEditing ? {
          ...sectionEditing,
          ...editTileList(homeTiles, (next) => updateDraft({ tiles: next }), inSection, (id) => t(TILE_REGISTRY[id].titleKey)),
        } : null}
      />
    );
  };

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
      <OnboardingStatusLine />
      <EnablePlaidCard />
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

        {editing ? (
          <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
            <FormControlLabel
              sx={{ mx: 0, gap: 1 }}
              control={<Switch size="small" checked={hideEmpty} onChange={(event) => updateDraft({ hideEmpty: event.target.checked })} />}
              label={<Typography variant="body2">{t('dashboard.settings.hideEmptyTiles')}</Typography>}
            />
            <Button variant="action" onClick={resetToDefaults} disabled={saving}>{t('dashboard.settings.resetToDefaults')}</Button>
            <Box flex={1} />
            {saveFailed && <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>{t('dashboard.budgetSettings.saveFailed')}</Typography>}
            <Button variant="action" onClick={() => setDraft(null)} disabled={saving}>{t('buttons.cancel')}</Button>
            <Button variant="action-primary" onClick={finishEditing} disabled={saving}>{t('dashboard.customize.done')}</Button>
          </Stack>
        ) : (
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
          {canCreateBudgetLine && (
            <Button
              variant="outlined"
              startIcon={<AccountBalanceWalletIcon />}
              // The creation screen lets the person switch the line to CAPEX.
              onClick={() => navigate('/ops/budget/new?nature=opex')}
              size="small"
              sx={quickActionSx}
            >
              {t('dashboard.newBudgetLine')}
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
          <Tooltip title={t('dashboard.customize.start')}>
            <span>
              <IconButton aria-label={t('dashboard.customize.start')} onClick={startEditing} size="small" disabled={configLoading}>
                <TuneIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        )}
      </Paper>

      {configLoading ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))`, gap: 3 }}>
          {[1, 2, 3, 4].map((i) => <TileLoader key={i} />)}
        </Box>
      ) : noTileOn ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            {t('dashboard.noTilesEnabled')}
          </Typography>
        </Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={moveSection}>
          <SortableContext items={shownSections.map((section) => sectionSortId(section.id))} strategy={rectSortingStrategy}>
            {/* One grid for every section: short sections share a row. */}
            <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))`, columnGap: 3, rowGap: 4, alignItems: 'start' }}>
              {shownSections.map((section) => (
                <TileEmptyContext.Provider key={section.id} value={reporter(section.id)}>
                  {renderSection(section)}
                </TileEmptyContext.Provider>
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      )}

      {allEmpty ? (
        <Typography variant="body2" sx={{ color: 'kanap.text.tertiary', textAlign: 'center', py: 2 }}>
          {t('dashboard.allTilesEmpty')}
        </Typography>
      ) : null}

      {/* Modals */}
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
