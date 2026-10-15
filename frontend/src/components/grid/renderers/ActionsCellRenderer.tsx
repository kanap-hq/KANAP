import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Divider,
} from '@mui/material';
import { ICellRendererParams } from 'ag-grid-community';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

/**
 * Action definition
 */
export interface ActionDefinition<T = unknown> {
  /** Unique key for the action */
  key: string;
  /** Display label */
  label: string;
  /** Icon component */
  icon?: React.ReactNode;
  /** Color for the icon button (when shown inline) */
  color?: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  /** Whether the action is disabled */
  disabled?: boolean | ((data: T) => boolean);
  /** Whether the action is hidden */
  hidden?: boolean | ((data: T) => boolean);
  /** Tooltip text */
  tooltip?: string;
  /** Click handler */
  onClick: (data: T, event: React.MouseEvent) => void;
  /** Whether this is a destructive action (shown in red) */
  destructive?: boolean;
  /** Whether to show a divider before this action (in menu) */
  dividerBefore?: boolean;
}

/**
 * Props for the ActionsCellRenderer component
 */
export interface ActionsCellRendererProps<T = unknown> extends ICellRendererParams<T> {
  /** List of actions to display */
  actions?: ActionDefinition<T>[];
  /** Maximum number of actions to show inline (rest go in menu) */
  maxInlineActions?: number;
  /** Show menu button even if no overflow */
  alwaysShowMenu?: boolean;
  /** Size of action buttons */
  size?: 'small' | 'medium';
  /** Menu icon */
  menuIcon?: React.ReactNode;
}

/**
 * Check if an action is disabled for the given data
 */
function isActionDisabled<T>(action: ActionDefinition<T>, data: T | undefined): boolean {
  if (!data) return true;
  if (typeof action.disabled === 'function') {
    return action.disabled(data);
  }
  return action.disabled ?? false;
}

/**
 * Check if an action is hidden for the given data
 */
function isActionHidden<T>(action: ActionDefinition<T>, data: T | undefined): boolean {
  if (!data) return false;
  if (typeof action.hidden === 'function') {
    return action.hidden(data);
  }
  return action.hidden ?? false;
}

/**
 * ActionsCellRenderer - Renders action buttons/menu for row operations
 *
 * Usage in column definition:
 * ```tsx
 * {
 *   headerName: '',
 *   width: 120,
 *   cellRenderer: ActionsCellRenderer,
 *   cellRendererParams: {
 *     maxInlineActions: 2,
 *     actions: [
 *       {
 *         key: 'edit',
 *         label: 'Edit',
 *         icon: <EditIcon />,
 *         onClick: (data) => handleEdit(data),
 *       },
 *       {
 *         key: 'delete',
 *         label: 'Delete',
 *         icon: <DeleteIcon />,
 *         destructive: true,
 *         onClick: (data) => handleDelete(data),
 *       },
 *     ],
 *   },
 * }
 * ```
 */
export function ActionsCellRenderer<T = unknown>(
  props: ActionsCellRendererProps<T>
): React.ReactElement | null {
  const { t } = useTranslation('common');
  const {
    data,
    actions = [],
    maxInlineActions = 2,
    alwaysShowMenu = false,
    size = 'small',
    menuIcon,
  } = props;

  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);
  const menuOpen = Boolean(menuAnchor);

  // Filter out hidden actions
  const visibleActions = actions.filter((action) => !isActionHidden(action, data));

  if (visibleActions.length === 0) {
    return null;
  }

  // Determine inline vs menu actions
  const showMenu = alwaysShowMenu || visibleActions.length > maxInlineActions;
  const inlineActions = showMenu
    ? visibleActions.slice(0, maxInlineActions - 1)
    : visibleActions;
  const menuActions = showMenu
    ? visibleActions.slice(maxInlineActions - 1)
    : [];

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleActionClick = (action: ActionDefinition<T>, event: React.MouseEvent) => {
    event.stopPropagation();
    if (data && !isActionDisabled(action, data)) {
      action.onClick(data, event);
    }
    handleMenuClose();
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 0.5,
        height: '100%',
      }}
    >
      {/* Inline actions */}
      {inlineActions.map((action) => {
        const disabled = isActionDisabled(action, data);
        const button = (
          <IconButton
            key={action.key}
            size={size}
            color={action.destructive ? 'error' : action.color ?? 'default'}
            disabled={disabled}
            onClick={(e) => handleActionClick(action, e)}
            sx={{
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {action.icon}
          </IconButton>
        );

        return action.tooltip ? (
          <Tooltip key={action.key} title={action.tooltip}>
            <span>{button}</span>
          </Tooltip>
        ) : (
          button
        );
      })}

      {/* Menu button */}
      {showMenu && menuActions.length > 0 && (
        <>
          <IconButton
            size={size}
            onClick={handleMenuOpen}
            aria-label={t('buttons.moreActions')}
            aria-haspopup="true"
            aria-expanded={menuOpen ? 'true' : undefined}
          >
            {menuIcon ?? <MoreVertIcon />}
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={menuOpen}
            onClose={handleMenuClose}
            onClick={(e) => e.stopPropagation()}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'right',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
          >
            {menuActions.map((action, index) => {
              const disabled = isActionDisabled(action, data);
              return (
                <React.Fragment key={action.key}>
                  {action.dividerBefore && index > 0 && <Divider />}
                  <MenuItem
                    onClick={(e) => handleActionClick(action, e)}
                    disabled={disabled}
                    sx={{
                      color: action.destructive ? 'error.main' : undefined,
                    }}
                  >
                    {action.icon && (
                      <ListItemIcon
                        sx={{
                          color: action.destructive ? 'error.main' : undefined,
                        }}
                      >
                        {action.icon}
                      </ListItemIcon>
                    )}
                    <ListItemText primary={action.label} />
                  </MenuItem>
                </React.Fragment>
              );
            })}
          </Menu>
        </>
      )}
    </Box>
  );
}

/**
 * Factory function to create an ActionsCellRenderer with preset configurations
 */
export function createActionsCellRenderer<T = unknown>(
  config: Omit<ActionsCellRendererProps<T>, keyof ICellRendererParams<T>>
): React.FC<ICellRendererParams<T>> {
  return function ConfiguredActionsCellRenderer(params: ICellRendererParams<T>) {
    return <ActionsCellRenderer {...params} {...config} />;
  };
}

/**
 * Common action icons (re-exported for convenience)
 */
export const ActionIcons = {
  Edit: EditIcon,
  Delete: DeleteIcon,
  View: VisibilityIcon,
  Copy: ContentCopyIcon,
  More: MoreVertIcon,
};

/**
 * Helper to create common actions
 */
export const createCommonActions = {
  view: <T extends { id: string }>(onClick: (data: T) => void): ActionDefinition<T> => ({
    key: 'view',
    label: 'View',
    icon: <VisibilityIcon fontSize="small" />,
    tooltip: 'View details',
    onClick,
  }),
  edit: <T extends { id: string }>(onClick: (data: T) => void): ActionDefinition<T> => ({
    key: 'edit',
    label: 'Edit',
    icon: <EditIcon fontSize="small" />,
    tooltip: 'Edit',
    onClick,
  }),
  delete: <T extends { id: string }>(onClick: (data: T) => void): ActionDefinition<T> => ({
    key: 'delete',
    label: 'Delete',
    icon: <DeleteIcon fontSize="small" />,
    tooltip: 'Delete',
    destructive: true,
    dividerBefore: true,
    onClick,
  }),
  copy: <T extends { id: string }>(onClick: (data: T) => void): ActionDefinition<T> => ({
    key: 'copy',
    label: 'Duplicate',
    icon: <ContentCopyIcon fontSize="small" />,
    tooltip: 'Create a copy',
    onClick,
  }),
};

export default ActionsCellRenderer;
