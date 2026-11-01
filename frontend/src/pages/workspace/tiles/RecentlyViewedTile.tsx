import { useNavigate } from 'react-router-dom';
import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InboxIcon from '@mui/icons-material/Inbox';
import AppsIcon from '@mui/icons-material/Apps';
import StorageIcon from '@mui/icons-material/Storage';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import CableIcon from '@mui/icons-material/Cable';
import DescriptionIcon from '@mui/icons-material/Description';
import TaskIcon from '@mui/icons-material/Task';
import ReceiptIcon from '@mui/icons-material/Receipt';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import PlaceIcon from '@mui/icons-material/Place';
import ArticleIcon from '@mui/icons-material/Article';
import BusinessIcon from '@mui/icons-material/Business';
import { useRecentlyViewed, ENTITY_TYPE_CONFIG, RecentEntityType } from '../hooks/useRecentlyViewed';
import { useAuth } from '../../../auth/AuthContext';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import DashboardTile, { TileEmptyState } from './DashboardTile';
import { useRelativeTime } from './useRelativeTime';
import { useDropGoneRecentItems } from '../hooks/useDropGoneRecentItems';
import { useKanapDialogs } from '../../../components/design';

interface RecentlyViewedTileProps {
  config: Record<string, unknown>;
}

const ICON_COMPONENTS: Record<string, typeof FolderOpenIcon> = {
  FolderOpen: FolderOpenIcon,
  Inbox: InboxIcon,
  Apps: AppsIcon,
  Storage: StorageIcon,
  SwapHoriz: SwapHorizIcon,
  Cable: CableIcon,
  Description: DescriptionIcon,
  Task: TaskIcon,
  Receipt: ReceiptIcon,
  AccountBalance: AccountBalanceIcon,
  ReportProblem: ReportProblemIcon,
  Place: PlaceIcon,
  Article: ArticleIcon,
  Business: BusinessIcon,
};

const MAX_TILE_ITEMS = 10;

export default function RecentlyViewedTile({ config }: RecentlyViewedTileProps) {
  const navigate = useNavigate();
  const { items, clearRecent } = useRecentlyViewed();
  const { hasLevel } = useAuth();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const relativeTime = useRelativeTime();
  const dialogs = useKanapDialogs();
  const limit = Math.min((config.limit as number) || 5, MAX_TILE_ITEMS);
  // Entries whose record is gone (deleted with another one, or elsewhere) leave the list.
  useDropGoneRecentItems(items);

  // Filter items by permission
  const visibleItems = items
    .filter((item) => {
      const entityConfig = ENTITY_TYPE_CONFIG[item.type];
      if (!entityConfig) return false;
      return hasLevel(entityConfig.resource, 'reader');
    })
    .slice(0, limit);

  const formatTime = (timestamp: number) => relativeTime(timestamp, () => formatShortDate(new Date(timestamp), locale));

  const handleNavigate = (type: RecentEntityType, id: string) => {
    const entityConfig = ENTITY_TYPE_CONFIG[type];
    if (entityConfig) {
      navigate(entityConfig.route(id));
    }
  };

  const handleClear = async () => {
    const confirmed = await dialogs.confirm({
      title: t('dashboard.tiles.clearHistoryTitle'),
      message: t('dashboard.tiles.clearHistoryMessage'),
      confirmLabel: t('buttons.clear'),
      intent: 'danger',
    });
    if (confirmed) clearRecent();
  };

  return (
    <DashboardTile title={t('dashboard.tiles.recentlyViewed')} icon="History" isEmpty={visibleItems.length === 0}>
      {visibleItems.length === 0 ? (
        <TileEmptyState message={t('dashboard.tiles.noRecentlyViewed')} />
      ) : (
        <Box>
          <List dense disablePadding>
            {visibleItems.map((item, index) => {
              const entityConfig = ENTITY_TYPE_CONFIG[item.type];
              const IconComponent = entityConfig
                ? ICON_COMPONENTS[entityConfig.icon] || FolderOpenIcon
                : FolderOpenIcon;

              return (
                <ListItemButton
                  key={`${item.type}-${item.id}-${index}`}
                  onClick={() => handleNavigate(item.type, item.id)}
                  sx={{ py: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <IconComponent fontSize="small" color="action" />
                  </ListItemIcon>
                  <ListItemText
                    primary={(
                      <Box component="span" sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                        {item.ref && (
                          <Box
                            component="span"
                            sx={{ fontFamily: 'monospace', fontSize: 12, color: 'kanap.text.tertiary', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                          >
                            {item.ref}
                          </Box>
                        )}
                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.label}
                        </Box>
                      </Box>
                    )}
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {entityConfig ? t(entityConfig.labelKey) : ''} - {formatTime(item.viewedAt)}
                      </Typography>
                    }
                    primaryTypographyProps={{ variant: 'body2', component: 'div' }}
                  />
                </ListItemButton>
              );
            })}
          </List>
          {/* Destructive action kept away from the header, where every other tile has "View all" */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
            <Typography
              component="button"
              type="button"
              variant="caption"
              onClick={handleClear}
              sx={{ border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer', color: 'kanap.text.tertiary', font: 'inherit', fontSize: 12, '&:hover': { textDecoration: 'underline' } }}
            >
              {t('dashboard.tiles.clearHistory')}
            </Typography>
          </Box>
        </Box>
      )}
    </DashboardTile>
  );
}
