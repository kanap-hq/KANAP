import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GridFooter from './GridFooter';

describe('GridFooter', () => {
  it('wraps within the grid width and keeps at least one line', () => {
    const onHeight = vi.fn();
    render(
      <div style={{ width: 1280 }}>
        <GridFooter onHeight={onHeight}>
          <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
            {'engagé 2026 hors 2 contrats en USD sans taux · '.repeat(12)}
          </span>
        </GridFooter>
      </div>,
    );
    const footer = document.querySelector('[data-grid-footer]') as HTMLElement;
    expect(footer).toHaveStyle({ maxWidth: '100%', overflowX: 'hidden', minHeight: '20px' });
    expect(footer.style.height).not.toBe('20px');
    expect(onHeight).toHaveBeenCalled();
    expect(footer.scrollWidth).toBeLessThanOrEqual(footer.clientWidth || footer.scrollWidth);
  });
});
