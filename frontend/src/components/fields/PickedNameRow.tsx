import React from 'react';
import { Box, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Link as RouterLink } from 'react-router-dom';

type Props = {
  /** The name shown (a person, a process). */
  children: React.ReactNode;
  /** The page the name leads to, when it has one. */
  href?: string;
  /** Shown faded (a disabled object stays listed). */
  muted?: boolean;
  /** Hover-revealed removal, absent for readers. */
  onRemove?: () => void;
  removeLabel?: string;
  removeDisabled?: boolean;
};

/**
 * One chosen name of a multiple-name field in a properties panel (business owners, business
 * processes): a 26px line, the height of a panel field, and a small cross revealed on hover and
 * on keyboard focus, as the remove action of the relations tables.
 */
export default function PickedNameRow({ children, href, muted = false, onRemove, removeLabel, removeDisabled }: Props) {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        minHeight: 26,
        px: 0.75,
        borderRadius: '4px',
        bgcolor: 'action.hover',
        '&:hover': { bgcolor: theme.palette.kanap.bg.hover },
        '& .picked-name-remove': { opacity: 0, transition: 'opacity 120ms' },
        '&:hover .picked-name-remove, & .picked-name-remove:focus-visible': { opacity: 1 },
        // No hover on a touch screen: the cross stays visible.
        '@media (hover: none)': { '& .picked-name-remove': { opacity: 1 } },
      })}
    >
      <Box
        component={href ? RouterLink : 'span'}
        {...(href ? { to: href } : {})}
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: muted ? 'kanap.text.tertiary' : 'kanap.text.primary',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: 'none',
          ...(href ? { '&:hover': { textDecoration: 'underline' } } : {}),
        }}
      >
        {children}
      </Box>
      {onRemove && (
        <IconButton
          className="picked-name-remove"
          size="small"
          aria-label={removeLabel}
          onClick={onRemove}
          disabled={removeDisabled}
          sx={{ p: '2px', color: 'kanap.text.tertiary' }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      )}
    </Box>
  );
}
