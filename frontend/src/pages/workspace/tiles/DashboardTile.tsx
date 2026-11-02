import { ReactNode } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Skeleton,
  Box,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useReportEmpty } from './emptyTiles';
import TaskIcon from '@mui/icons-material/Task';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';
import GroupsIcon from '@mui/icons-material/Groups';
import HistoryIcon from '@mui/icons-material/History';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import InboxIcon from '@mui/icons-material/Inbox';
import UpdateIcon from '@mui/icons-material/Update';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import WarningIcon from '@mui/icons-material/Warning';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AssignmentIcon from '@mui/icons-material/Assignment';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import PlaceIcon from '@mui/icons-material/Place';
import ArticleIcon from '@mui/icons-material/Article';
import DnsIcon from '@mui/icons-material/Dns';
import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';

export const TILE_ICONS: Record<string, typeof TaskIcon> = {
  Task: TaskIcon,
  Leaderboard: LeaderboardIcon,
  Groups: GroupsIcon,
  History: HistoryIcon,
  AccessTime: AccessTimeIcon,
  Inbox: InboxIcon,
  Update: UpdateIcon,
  SwapHoriz: SwapHorizIcon,
  Warning: WarningIcon,
  AccountBalanceWallet: AccountBalanceWalletIcon,
  AccountBalance: AccountBalanceIcon,
  Assignment: AssignmentIcon,
  EventAvailable: EventAvailableIcon,
  ReportProblemOutlined: ReportProblemOutlinedIcon,
  TrendingUp: TrendingUpIcon,
  VerifiedUser: VerifiedUserIcon,
  Place: PlaceIcon,
  Article: ArticleIcon,
  Dns: DnsIcon,
  GppMaybe: GppMaybeOutlinedIcon,
};

interface DashboardTileProps {
  title: string;
  /** What the tile reads (column, years), on a second line under a one-line title. */
  subtitle?: string;
  /**
   * Reporting currency of the amounts, once, after the subtitle. It stays visible when the
   * subtitle line is cut short.
   */
  currency?: string;
  icon: string;
  isLoading?: boolean;
  /** Query failed: the tile shows a retry prompt instead of an empty state that would read as "nothing to do". */
  isError?: boolean;
  onRetry?: () => void;
  /** Nothing to show (empty list, zero counts): the home page can leave the tile out. */
  isEmpty?: boolean;
  children: ReactNode;
  action?: ReactNode;
  minHeight?: number;
}

export default function DashboardTile({
  title,
  subtitle,
  currency,
  icon,
  isLoading = false,
  isError = false,
  onRetry,
  isEmpty = false,
  children,
  action,
  minHeight = 120,
}: DashboardTileProps) {
  const { t } = useTranslation('common');
  useReportEmpty(isEmpty && !isLoading && !isError);
  const IconComponent = TILE_ICONS[icon] || TaskIcon;
  const hasSub = Boolean(subtitle || currency);
  // The full second line, for the tooltip when the column name is cut. The currency itself does not shrink.
  const subheaderLabel = subtitle && currency
    ? t('dashboard.withCurrency', { context: subtitle, currency })
    : subtitle || currency || '';

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <CardHeader
        avatar={<IconComponent sx={{ color: 'text.secondary' }} />}
        title={
          <Typography variant="subtitle1" fontWeight={500} noWrap={hasSub} title={hasSub ? title : undefined}>
            {title}
          </Typography>
        }
        subheader={hasSub ? (
          <Box title={subheaderLabel} sx={{ display: 'flex', minWidth: 0, alignItems: 'baseline' }}>
            {subtitle && (
              <Typography variant="body2" noWrap sx={{ minWidth: 0, color: 'kanap.text.secondary' }}>
                {subtitle}
              </Typography>
            )}
            {currency && (
              <Typography component="span" variant="body2" sx={{ flexShrink: 0, color: 'kanap.text.secondary', whiteSpace: 'nowrap' }}>
                {subtitle ? `\u00a0·\u00a0${currency}` : currency}
              </Typography>
            )}
          </Box>
        ) : undefined}
        action={action}
        // With a subtitle, the icon, the title and the action share the first line.
        sx={hasSub ? { pb: 0, alignItems: 'flex-start', '& .MuiCardHeader-content': { minWidth: 0 } } : { pb: 0 }}
      />
      <CardContent sx={{ flex: 1, pt: 1, minHeight }}>
        {isLoading ? (
          <Box>
            <Skeleton variant="rectangular" height={24} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" height={24} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" height={24} sx={{ mb: 1 }} />
          </Box>
        ) : isError ? (
          <TileEmptyState
            message={t('dashboard.tiles.loadError')}
            action={onRetry ? (
              <Button size="small" onClick={onRetry}>{t('buttons.retry')}</Button>
            ) : undefined}
          />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

interface EmptyStateProps {
  message: string;
  action?: ReactNode;
}

/** Compact empty state: one line of tertiary text with the optional action inline, so an empty tile stays short. */
export function TileEmptyState({ message, action }: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 1.5,
        py: 2,
        color: 'kanap.text.tertiary',
      }}
    >
      <Typography variant="body2" sx={{ color: 'inherit' }}>
        {message}
      </Typography>
      {action}
    </Box>
  );
}
