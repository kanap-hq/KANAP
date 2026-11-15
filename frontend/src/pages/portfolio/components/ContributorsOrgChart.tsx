import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Box, Chip, IconButton, MenuItem, Select, Tooltip, useTheme } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { hierarchy as d3Hierarchy, tree as d3Tree } from 'd3';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { useKanapDialogs } from '../../../components/design';
import { formatShortDate } from '../../../lib/dateFormat';
import { useLocalStorageState } from '../../../hooks/useLocalStorageState';
import { buildItemPath } from '../../../utils/item-ref';
import { compactSelectMenuProps, drawerMenuItemSx, drawerSelectSx, inlineControlSx } from '../../../theme/formSx';
import { buildOrgForest, contributorName, orgReference, type OrgContributor, type OrgNode } from '../orgChart';
import { exportOrgChartAsPng, type OrgPngLink, type OrgPngNode } from './contributors-org-png';

type EmploymentTypeOption = { id: string; name: string; is_active: boolean };

type Props = {
  contributors: OrgContributor[];
  employmentTypes: EmploymentTypeOption[];
  /** Hands the print action to the page so it sits with the other page actions. */
  onActionChange?: (action: { label: string; run: () => void } | null) => void;
};

const NODE_WIDTH = 216;
const NODE_HEIGHT = 64;
const COLUMN_GAP = 26;
const ROW_GAP = 44;
const CANVAS_PADDING = 20;

const DEPTH_OPTIONS = [1, 2, 3, 4];
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;
const ZOOM_STORAGE_KEY = 'kanap.contributors.org.zoom';

/**
 * Only present while the chart is on screen, so the landscape page and the
 * hide-everything-else rule never reach another page's print. Colours are
 * forced light: an org chart printed from dark mode would be white on white.
 */
const PRINT_CSS = `
@media print {
  @page { size: landscape; margin: 10mm; }
  body * { visibility: hidden !important; }
  .kanap-org-canvas, .kanap-org-canvas * { visibility: visible !important; }
  .kanap-org-canvas {
    position: absolute !important;
    left: 0; top: 0;
    max-height: none !important;
    max-width: none !important;
    overflow: visible !important;
    border: 0 !important;
    background: #FFFFFF !important;
  }
  .kanap-org-hide-print { display: none !important; }
  .kanap-org-node {
    background: #FFFFFF !important;
    border-color: #D1D5DB !important;
    color: #111827 !important;
  }
  .kanap-org-muted { color: #6B7280 !important; }
  .kanap-org-canvas svg path { stroke: #9CA3AF !important; }
}
`;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

const monoSx = {
  fontFamily: MONO_FONT_FAMILY,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
} as const;

type PlacedNode = { node: OrgNode; left: number; top: number; parentKey: string | null };

/**
 * Reporting-line chart of the contributors. The tree is built in the browser
 * from the rows the page already holds (see `orgChart.ts`); this component owns
 * the presentation and the parameters, which live in the address so a branch
 * chart can be shared. Cards are HTML positioned absolutely over one SVG layer
 * of connectors, so type, ellipsis and dark mode come for free.
 */
export default function ContributorsOrgChart({ contributors, employmentTypes, onActionChange }: Props) {
  const { t, i18n } = useTranslation(['portfolio']);
  const navigate = useNavigate();
  const theme = useTheme();
  const dialogs = useKanapDialogs();
  const [searchParams, setSearchParams] = useSearchParams();
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [zoom, setZoom] = useLocalStorageState<number>(ZOOM_STORAGE_KEY, 1);

  const patchParams = React.useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  // A type that is no longer offered but still carried by somebody must stay
  // togglable, otherwise those people could never be filtered out.
  const pillTypes = React.useMemo(() => {
    const used = new Set(contributors.map((row) => row.employment_type_id).filter(Boolean));
    return employmentTypes.filter((type) => type.is_active || used.has(type.id));
  }, [contributors, employmentTypes]);

  // Contract types travel by name, not by id: a shared link stays readable and
  // carries no UUID. Names are unique per tenant.
  const hiddenTypeNames = React.useMemo(() => {
    const raw = searchParams.get('hide');
    return raw ? raw.split(',').map((name) => name.trim()).filter(Boolean) : [];
  }, [searchParams]);

  const hiddenTypeIds = React.useMemo(
    () => pillTypes.filter((type) => hiddenTypeNames.includes(type.name)).map((type) => type.id),
    [hiddenTypeNames, pillTypes],
  );

  // An address saved before MEM-N still names its root by CTR-N.
  const rootReference = searchParams.get('root')?.replace(/^CTR-/i, 'MEM-') ?? null;
  const includeDisabled = searchParams.get('disabled') === '1';
  const depthParam = Number(searchParams.get('depth'));
  const maxDepth = DEPTH_OPTIONS.includes(depthParam) ? depthParam : null;

  const forest = React.useMemo(() => buildOrgForest({
    contributors,
    hiddenEmploymentTypeIds: hiddenTypeIds,
    includeDisabled,
    rootReference,
    maxDepth,
  }), [contributors, hiddenTypeIds, includeDisabled, maxDepth, rootReference]);

  const layout = React.useMemo(() => {
    if (forest.roots.length === 0) return { placed: [] as PlacedNode[], links: [] as OrgPngLink[], width: 0, height: 0 };

    type Datum = { key: string; node: OrgNode | null; children?: Datum[] };
    const toDatum = (node: OrgNode): Datum => ({
      key: node.key,
      node,
      children: collapsed.has(node.key) ? undefined : node.children.map(toDatum),
    });
    // One synthetic parent lays the roots of a forest out side by side; it is
    // dropped again right after, and everything shifts up by its row.
    const root = d3Hierarchy<Datum>(
      { key: '', node: null, children: forest.roots.map(toDatum) },
      (datum) => datum.children,
    );
    const laid = d3Tree<Datum>().nodeSize([NODE_WIDTH + COLUMN_GAP, NODE_HEIGHT + ROW_GAP])(root);
    const points = laid.descendants().slice(1);

    const rawLeft = points.map((point) => point.x - NODE_WIDTH / 2);
    const offsetX = CANVAS_PADDING - Math.min(...rawLeft);
    const placed: PlacedNode[] = points.map((point) => ({
      node: point.data.node!,
      left: point.x - NODE_WIDTH / 2 + offsetX,
      top: point.y - (NODE_HEIGHT + ROW_GAP) + CANVAS_PADDING,
      parentKey: point.parent?.data.node ? point.parent.data.key : null,
    }));

    // Geometry rather than a path string: the SVG layer and the PNG export both
    // read it, so an elbow can never be drawn two different ways.
    const byKey = new Map(placed.map((item) => [item.node.key, item]));
    const links = placed.flatMap<OrgPngLink>((child) => {
      const parent = child.parentKey ? byKey.get(child.parentKey) : undefined;
      if (!parent) return [];
      const fromY = parent.top + NODE_HEIGHT;
      return [{
        fromX: parent.left + NODE_WIDTH / 2,
        fromY,
        midY: fromY + ROW_GAP / 2,
        toX: child.left + NODE_WIDTH / 2,
        toY: child.top,
      }];
    });

    return {
      placed,
      links,
      width: Math.max(...placed.map((item) => item.left + NODE_WIDTH)) + CANVAS_PADDING,
      height: Math.max(...placed.map((item) => item.top + NODE_HEIGHT)) + CANVAS_PADDING,
    };
  }, [collapsed, forest.roots]);

  const exportPng = React.useCallback(async () => {
    try {
      await exportOrgChartAsPng({
        nodes: layout.placed.map<OrgPngNode>(({ node, left, top }) => ({
          name: node.name,
          jobTitle: node.contributor.job_title ?? null,
          contractType: node.contributor.employment_type_name ?? null,
          skillCount: node.contributor.skills?.length ?? 0,
          initials: initialsOf(node.name),
          left,
          top,
          hiddenReports: collapsed.has(node.key) ? node.children.length : 0,
        })),
        links: layout.links,
        width: layout.width,
        height: layout.height,
        nodeWidth: NODE_WIDTH,
        nodeHeight: NODE_HEIGHT,
        padding: CANVAS_PADDING,
        caption: formatShortDate(new Date(), i18n.language, { year: 'always' }),
        fileName: `org-chart-${new Date().toISOString().slice(0, 10)}`,
      });
    } catch {
      await dialogs.alert({ message: t('contributors.org.exportFailed'), intent: 'danger' });
    }
  }, [collapsed, dialogs, i18n.language, layout, t]);

  React.useEffect(() => {
    onActionChange?.(layout.placed.length > 0 ? { label: t('contributors.org.exportPng'), run: () => { void exportPng(); } } : null);
  }, [exportPng, layout.placed.length, onActionChange, t]);

  React.useEffect(() => () => onActionChange?.(null), [onActionChange]);

  const toggleCollapse = (key: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleType = (name: string) => {
    const next = hiddenTypeNames.includes(name)
      ? hiddenTypeNames.filter((item) => item !== name)
      : [...hiddenTypeNames, name];
    patchParams({ hide: next.length > 0 ? next.join(',') : null });
  };

  // Through the updater, so two clicks in the same frame both count.
  const stepZoom = (delta: number) => setZoom((previous) => (
    Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, previous + delta)) * 100) / 100
  ));

  // An unknown reference falls back to the forest, so the picker has to agree.
  const rootValue = forest.rootMissing || !rootReference ? '' : rootReference;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <style>{PRINT_CSS}</style>

      <Box
        className="kanap-org-hide-print"
        role="group"
        aria-label={t('contributors.org.filtersLabel')}
        sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}
      >
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', mr: '8px' }}>
          <Box component="span" sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary })}>
            {t('contributors.org.root.label')}
          </Box>
          <Select
            variant="standard"
            displayEmpty
            value={rootValue}
            onChange={(event) => patchParams({ root: event.target.value ? String(event.target.value) : null })}
            SelectDisplayProps={{ 'aria-label': t('contributors.org.root.label') }}
            sx={[drawerSelectSx, inlineControlSx, { width: 'auto', flexShrink: 0 }]}
            MenuProps={compactSelectMenuProps}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>{t('contributors.org.root.everyone')}</MenuItem>
            {forest.eligible.map((contributor) => (
              <MenuItem key={contributor.id} value={orgReference(contributor)} sx={drawerMenuItemSx}>
                {contributorName(contributor)}
              </MenuItem>
            ))}
          </Select>
        </Box>

        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', mr: '8px' }}>
          <Box component="span" sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary })}>
            {t('contributors.org.depth.label')}
          </Box>
          <Select
            variant="standard"
            value={maxDepth === null ? '' : String(maxDepth)}
            displayEmpty
            onChange={(event) => patchParams({ depth: event.target.value ? String(event.target.value) : null })}
            SelectDisplayProps={{ 'aria-label': t('contributors.org.depth.label') }}
            sx={[drawerSelectSx, inlineControlSx, { width: 'auto', flexShrink: 0 }]}
            MenuProps={compactSelectMenuProps}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>{t('contributors.org.depth.all')}</MenuItem>
            {DEPTH_OPTIONS.map((depth) => (
              <MenuItem key={depth} value={String(depth)} sx={drawerMenuItemSx}>
                {t('contributors.org.depth.levels', { count: depth })}
              </MenuItem>
            ))}
          </Select>
        </Box>

        {pillTypes.map((type) => {
          const active = !hiddenTypeNames.includes(type.name);
          return (
            <Chip
              key={type.id}
              clickable
              size="small"
              label={type.name}
              aria-pressed={active}
              color={active ? 'primary' : 'default'}
              variant={active ? 'filled' : 'outlined'}
              onClick={() => toggleType(type.name)}
            />
          );
        })}

        <Box sx={{ flex: 1, minWidth: '8px' }} />

        <Chip
          clickable
          size="small"
          label={t('contributors.org.includeDisabled')}
          aria-pressed={includeDisabled}
          color={includeDisabled ? 'primary' : 'default'}
          variant={includeDisabled ? 'filled' : 'outlined'}
          onClick={() => patchParams({ disabled: includeDisabled ? null : '1' })}
        />

        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          <IconButton
            size="small"
            aria-label={t('contributors.org.zoom.out')}
            onClick={() => stepZoom(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            sx={(theme) => ({ p: '3px', color: theme.palette.kanap.text.secondary })}
          >
            <RemoveIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <Box
            component="button"
            type="button"
            onClick={() => setZoom(1)}
            aria-label={t('contributors.org.zoom.reset')}
            sx={(theme) => ({
              ...monoSx,
              minWidth: 40,
              p: 0,
              border: 0,
              background: 'none',
              cursor: 'pointer',
              color: theme.palette.kanap.text.tertiary,
            })}
          >
            {`${Math.round(zoom * 100)}%`}
          </Box>
          <IconButton
            size="small"
            aria-label={t('contributors.org.zoom.in')}
            onClick={() => stepZoom(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            sx={(theme) => ({ p: '3px', color: theme.palette.kanap.text.secondary })}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>

      {layout.placed.length === 0 ? (
        <Box sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary })}>
          {t('contributors.org.states.allFiltered')}
        </Box>
      ) : (
        <Box
          className="kanap-org-canvas"
          role="group"
          aria-label={t('contributors.org.canvasLabel')}
          sx={(theme) => ({
            // The opposite of the matrix: the block never grows the page, it
            // scrolls on both axes inside its own frame.
            overflow: 'auto',
            width: '100%',
            maxHeight: 'calc(100vh - 260px)',
            border: `1px solid ${theme.palette.kanap.border.default}`,
            borderRadius: '8px',
            bgcolor: theme.palette.kanap.bg.primary,
          })}
        >
          {/* Scaling with a transform leaves the layout size untouched, so the
              scrollable box is sized for the zoomed drawing. */}
          <Box sx={{ width: layout.width * zoom, height: layout.height * zoom, position: 'relative' }}>
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: layout.width,
                height: layout.height,
                transform: `scale(${zoom})`,
                transformOrigin: '0 0',
              }}
            >
              <svg
                aria-hidden="true"
                data-testid="org-connectors"
                width={layout.width}
                height={layout.height}
                style={{ position: 'absolute', top: 0, left: 0 }}
              >
                {layout.links.map((link) => (
                  <path
                    key={`${link.fromX},${link.fromY},${link.toX}`}
                    d={`M${link.fromX},${link.fromY} V${link.midY} H${link.toX} V${link.toY}`}
                    fill="none"
                    stroke={theme.palette.kanap.border.default}
                    strokeWidth={1}
                  />
                ))}
              </svg>

              {layout.placed.map(({ node, left, top }) => (
                <OrgChartNode
                  key={node.key}
                  node={node}
                  left={left}
                  top={top}
                  collapsed={collapsed.has(node.key)}
                  onToggle={() => toggleCollapse(node.key)}
                  onOpen={() => navigate(buildItemPath('contributor', node.reference))}
                />
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

type NodeProps = {
  node: OrgNode;
  left: number;
  top: number;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: () => void;
};

function OrgChartNode({ node, left, top, collapsed, onToggle, onOpen }: NodeProps) {
  const { t } = useTranslation(['portfolio']);
  const { contributor } = node;
  // Collapsing only prunes the layout, so the real reports are still here.
  const reports = node.children.length;
  const hasChildren = reports > 0;
  const skillCount = contributor.skills?.length ?? 0;

  const card = (
    <Box
      className="kanap-org-node"
      role="button"
      tabIndex={0}
      aria-label={node.name}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '9px',
        height: '100%',
        px: '10px',
        borderRadius: '8px',
        border: `1px solid ${theme.palette.kanap.border.default}`,
        bgcolor: theme.palette.kanap.bg.primary,
        cursor: 'pointer',
        transition: 'background-color 160ms ease',
        '&:hover, &:focus-visible': { bgcolor: theme.palette.kanap.bg.hover, outline: 'none' },
        '&:focus-visible': { borderColor: theme.palette.primary.main },
      })}
    >
      <Avatar sx={{ width: 18, height: 18, fontSize: 9, fontWeight: 500, bgcolor: 'kanap.teal', color: 'kanap.tealForeground' }}>
        {initialsOf(node.name)}
      </Avatar>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={(theme) => ({
          fontSize: 13,
          fontWeight: 500,
          color: theme.palette.kanap.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        })}>
          {node.name}
        </Box>
        {contributor.job_title && (
          <Box className="kanap-org-muted" sx={(theme) => ({
            fontSize: 12,
            color: theme.palette.kanap.text.tertiary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          })}>
            {contributor.job_title}
          </Box>
        )}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <Box className="kanap-org-muted" sx={(theme) => ({
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: theme.palette.kanap.text.tertiary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          })}>
            {contributor.employment_type_name || ''}
          </Box>
          <Box
            className="kanap-org-muted"
            component="span"
            aria-label={t('contributors.cards.skillCount', { count: skillCount })}
            sx={(theme) => ({ ...monoSx, color: theme.palette.kanap.text.tertiary })}
          >
            {skillCount}
          </Box>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ position: 'absolute', left, top, width: NODE_WIDTH, height: NODE_HEIGHT }}>
      {node.via.length > 0 ? (
        <Tooltip title={t('contributors.org.via', { names: node.via.join(' · ') })} placement="top" enterDelay={300}>
          {card}
        </Tooltip>
      ) : card}
      {hasChildren && (
        <IconButton
          className="kanap-org-hide-print"
          size="small"
          aria-label={collapsed
            ? t('contributors.org.expand', { count: reports })
            : t('contributors.org.collapse', { count: reports })}
          onClick={onToggle}
          sx={(theme) => ({
            position: 'absolute',
            left: '50%',
            bottom: -11,
            transform: 'translateX(-50%)',
            p: 0,
            width: 20,
            height: 20,
            border: `1px solid ${theme.palette.kanap.border.default}`,
            bgcolor: theme.palette.kanap.bg.primary,
            color: theme.palette.kanap.text.secondary,
            '&:hover': { bgcolor: theme.palette.kanap.bg.hover },
          })}
        >
          {collapsed ? <ExpandMoreIcon sx={{ fontSize: 14 }} /> : <ExpandLessIcon sx={{ fontSize: 14 }} />}
        </IconButton>
      )}
    </Box>
  );
}
