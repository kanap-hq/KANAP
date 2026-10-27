import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { expectAnchoredLeft, expectAnchoredRight, placeAnchor, stubPopoverPaperWidth } from '../../../test/popoverAnchor';
import TechnologyVersionPicker from './TechnologyVersionPicker';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

const anchors: HTMLElement[] = [];

function anchorAt(box: { left: number; top: number; width: number; height: number }) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  anchors.push(anchor);
  placeAnchor(anchor, box);
  return anchor;
}

function renderPicker(align?: 'left' | 'right') {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <TechnologyVersionPicker
        anchorEl={anchorAt(align === 'right'
          ? { left: 900, top: 200, width: 32, height: 32 }
          : { left: 280, top: 80, width: 160, height: 32 })}
        align={align}
        versions={[{ id: 'v-8', label: '8.2' }]}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    </ThemeProvider>,
  );
  expect(screen.getByRole('option', { name: '8.2' })).toBeTruthy();
}

describe('TechnologyVersionPicker anchor', () => {
  const innerWidth = window.innerWidth;
  let restoreWidth: () => void = () => undefined;

  beforeEach(() => {
    window.innerWidth = 1280;
    restoreWidth = stubPopoverPaperWidth();
  });

  afterEach(() => {
    window.innerWidth = innerWidth;
    restoreWidth();
    anchors.splice(0).forEach((anchor) => anchor.remove());
  });

  it('opens under an Add anchor, on the button left edge', () => {
    renderPicker();
    const paper = document.querySelector('.MuiPopover-paper') as HTMLElement;
    expect(getComputedStyle(paper).width).toBe('300px');
    expectAnchoredLeft({ left: 280, bottom: 112 });
  });

  it('stays right-aligned on a row anchor', () => {
    renderPicker('right');
    expectAnchoredRight(932, 300);
  });
});
