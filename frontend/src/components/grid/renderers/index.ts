/**
 * Shared grid cell renderers for AG Grid
 *
 * Usage:
 *   import { StatusCellRenderer, DateCellRenderer } from '@/components/grid/renderers';
 *
 *   const columns = [
 *     {
 *       field: 'status',
 *       cellRenderer: StatusCellRenderer,
 *       cellRendererParams: { size: 'small' },
 *     },
 *     {
 *       field: 'created_at',
 *       cellRenderer: DateCellRenderer,
 *       cellRendererParams: { format: 'datetime' },
 *     },
 *   ];
 */

// Status renderer
export {
  StatusCellRenderer,
  createStatusCellRenderer,
  EnabledDisabledRenderer,
  LifecycleStatusRenderer,
  ProjectStatusRenderer,
  DEFAULT_STATUS_CONFIGS,
} from './StatusCellRenderer';
export type { StatusCellRendererProps, StatusConfig } from './StatusCellRenderer';

// Date renderer
export {
  DateCellRenderer,
  createDateCellRenderer,
  DateOnlyRenderer,
  DateTimeRenderer,
  RelativeDateRenderer,
  CreatedAtRenderer,
} from './DateCellRenderer';
export type { DateCellRendererProps, DateFormat } from './DateCellRenderer';

// User renderer
export {
  UserCellRenderer,
  createUserCellRenderer,
  UserWithAvatarRenderer,
  UserFullRenderer,
  UserNameRenderer,
} from './UserCellRenderer';
export type { UserCellRendererProps, UserData } from './UserCellRenderer';

// Link renderer
export {
  LinkCellRenderer,
  createLinkCellRenderer,
  wholeCellLinkSx,
  aboveCellLinkSx,
  ExternalLinkRenderer,
  EmailLinkRenderer,
  PhoneLinkRenderer,
} from './LinkCellRenderer';
export type { LinkCellRendererProps, LinkType } from './LinkCellRenderer';

// Actions renderer
export {
  ActionsCellRenderer,
  createActionsCellRenderer,
  ActionIcons,
  createCommonActions,
} from './ActionsCellRenderer';
export type { ActionsCellRendererProps, ActionDefinition } from './ActionsCellRenderer';
