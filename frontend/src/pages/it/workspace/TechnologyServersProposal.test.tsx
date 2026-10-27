import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { expectAnchoredLeft, expectAnchoredRight, placeAnchor, stubPopoverPaperWidth } from '../../../test/popoverAnchor';
import TechnologyServersProposal from './TechnologyServersProposal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const args = opts ? Object.entries(opts).filter(([name]) => name !== 'defaultValue').map(([name, value]) => `${name}=${value}`).join(',') : '';
      return args ? `${key}(${args})` : key;
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (_field: string, code: string) => code }),
}));

const anchors: HTMLElement[] = [];

function anchorAt(box: { left: number; top: number; width: number; height: number }) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  anchors.push(anchor);
  placeAnchor(anchor, box);
  return anchor;
}

const servers = [
  { asset_id: 'srv-1', name: 'srv-etl-1', asset_reference: 'AST-1', environments: ['prod'], roles: ['app'] },
];

function renderProposal(align?: 'left' | 'right') {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <TechnologyServersProposal
        anchorEl={anchorAt(align === 'right'
          ? { left: 900, top: 200, width: 32, height: 32 }
          : { left: 280, top: 80, width: 160, height: 32 })}
        align={align}
        technology="PHP"
        version="8.2"
        servers={servers}
        carrying={new Set()}
        mode={align === 'right' ? 'record' : 'add'}
        onConfirm={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />
    </ThemeProvider>,
  );
  expect(screen.getByRole('menuitemcheckbox', { name: /srv-etl-1/ })).toBeTruthy();
}

describe('TechnologyServersProposal anchor', () => {
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
    renderProposal();
    const paper = document.querySelector('.MuiPopover-paper') as HTMLElement;
    expect(getComputedStyle(paper).width).toBe('340px');
    expectAnchoredLeft({ left: 280, bottom: 112 });
  });

  it('stays right-aligned on a row anchor', () => {
    renderProposal('right');
    expectAnchoredRight(932, 340);
  });
});
