import React from 'react';
import { Box, Tooltip } from '@mui/material';

import { clampSkillLevel, MAX_SKILL_LEVEL, MIN_SKILL_LEVEL } from '../skillsMatrix';

// The level bounds live with the skills matrix, which the API's export shares.
export { clampSkillLevel, MAX_SKILL_LEVEL, MIN_SKILL_LEVEL };

export const SKILL_LEVELS = [1, 2, 3, 4] as const;

type SkillLevelControlProps = {
  /** Accessible group name, e.g. "Office 365 level". */
  ariaLabel: string;
  /** Level labels indexed by level (1–4). Also used as the tooltip of each pip. */
  labels: Record<number, string>;
  /** Builds the accessible name of one pip, e.g. "2 – Can execute with support". */
  optionLabel: (level: number, label: string) => string;
  value: number;
  onChange?: (level: number) => void;
  disabled?: boolean;
};

const PIP_SIZE = 14;
const HIT_SIZE = 24;

/**
 * Four pips (1–4), filled up to the current level. Each pip carries its own
 * tooltip so every level is described on hover, not only the selected one.
 * Behaves as a radio group: click or ←/→/Home/End to set the level. Arrow
 * keys stop propagating so the workspace shell's prev/next shortcuts
 * (window-level ArrowLeft/ArrowRight) never fire while adjusting a level.
 */
export default function SkillLevelControl({
  ariaLabel,
  labels,
  optionLabel,
  value,
  onChange,
  disabled = false,
}: SkillLevelControlProps) {
  const groupRef = React.useRef<HTMLDivElement | null>(null);
  const interactive = !disabled && !!onChange;

  const focusPip = (level: number) => {
    const pip = groupRef.current?.querySelector<HTMLElement>(`[data-level="${level}"]`);
    pip?.focus();
  };

  const select = (level: number) => {
    if (!interactive) return;
    const next = clampSkillLevel(level);
    if (next !== value) onChange?.(next);
    focusPip(next);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!interactive) return;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - 1;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + 1;
        break;
      case 'Home':
        next = MIN_SKILL_LEVEL;
        break;
      case 'End':
        next = MAX_SKILL_LEVEL;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    select(next);
  };

  return (
    <Box
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}
    >
      {SKILL_LEVELS.map((level) => {
        const filled = level <= value;
        const label = labels[level] ?? String(level);
        return (
          <Tooltip key={level} title={label} placement="top" enterDelay={300}>
            <Box
              component={interactive ? 'button' : 'span'}
              type={interactive ? 'button' : undefined}
              role="radio"
              aria-checked={level === value}
              aria-label={optionLabel(level, label)}
              aria-disabled={!interactive || undefined}
              data-level={level}
              tabIndex={interactive ? (level === value ? 0 : -1) : -1}
              onClick={interactive ? () => select(level) : undefined}
              sx={(theme) => ({
                width: HIT_SIZE,
                height: HIT_SIZE,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: 0,
                m: 0,
                border: 0,
                bgcolor: 'transparent',
                cursor: interactive ? 'pointer' : 'default',
                borderRadius: '4px',
                outline: 'none',
                '&:focus-visible': {
                  boxShadow: `0 0 0 2px ${theme.palette.kanap.teal}`,
                },
                '& > span': {
                  width: PIP_SIZE,
                  height: PIP_SIZE,
                  borderRadius: '3px',
                  border: `1px solid ${filled ? theme.palette.kanap.teal : theme.palette.kanap.border.default}`,
                  bgcolor: filled ? theme.palette.kanap.teal : 'transparent',
                  opacity: disabled && filled ? 0.6 : 1,
                  transition: 'background-color 120ms ease, border-color 120ms ease',
                },
                '&:hover > span': interactive
                  ? { borderColor: theme.palette.kanap.teal }
                  : undefined,
              })}
            >
              <span aria-hidden="true" />
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
