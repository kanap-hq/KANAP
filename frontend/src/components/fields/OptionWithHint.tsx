import React from 'react';
import { Box, Tooltip } from '@mui/material';

/** How long the pointer rests on an option before its hint shows. */
export const OPTION_HINT_DELAY_MS = 700;

type Props = {
  /** The `props` an Autocomplete's `renderOption` receives. */
  optionProps: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key };
  /** The option's name: the one line the list shows. */
  label: React.ReactNode;
  /** Short context kept on the same line, after the name (a status such as "Disabled"). */
  trailing?: React.ReactNode;
  /** Descriptive text: a delayed tooltip for the pointer, the option's accessible description for keyboards. */
  hint?: string | null;
};

/**
 * One option of a picker list: a single line with the name, and the description in a delayed tooltip.
 * The standard for the pickers of properties drawers.
 */
export default function OptionWithHint({ optionProps, label, trailing, hint }: Props) {
  const hintId = React.useId();
  const { key: _key, ...liProps } = optionProps;
  const text = hint?.trim() || '';

  const option = (
    <li
      {...liProps}
      // Tooltip with `describeChild` sets a native title while closed: keep only the delayed tooltip.
      title={undefined}
      aria-describedby={text ? hintId : undefined}
    >
      <Box component="span" sx={{ display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0, width: '100%' }}>
        <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </Box>
        {trailing ? (
          <Box
            component="span"
            sx={(theme) => ({ flexShrink: 0, fontSize: 11, color: theme.palette.kanap.text.tertiary })}
          >
            {trailing}
          </Box>
        ) : null}
      </Box>
      {/* The list moves a virtual focus (aria-activedescendant), so no tooltip opens from the keyboard:
          screen readers read the hint as the option's description. */}
      {text ? <span id={hintId} hidden>{text}</span> : null}
    </li>
  );

  if (!text) return option;
  return (
    <Tooltip
      title={text}
      placement="left"
      enterDelay={OPTION_HINT_DELAY_MS}
      enterNextDelay={OPTION_HINT_DELAY_MS}
      describeChild
      disableInteractive
    >
      {option}
    </Tooltip>
  );
}
