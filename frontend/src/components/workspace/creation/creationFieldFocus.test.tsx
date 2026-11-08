import { describe, expect, it, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { clearCreationFieldFocus, focusFirstCreationField, useCreationFieldFocus } from './creationFieldFocus';

function Page() {
  const ref = React.useRef<HTMLDivElement>(null);
  useCreationFieldFocus(ref, false);
  return (
    <div ref={ref}>
      <div data-creation-panel="main" data-primary-scroll="" tabIndex={-1}>
        <input aria-label="first" />
      </div>
    </div>
  );
}

describe('useCreationFieldFocus', () => {
  afterEach(() => clearCreationFieldFocus());

  it('takes the focus back from the page scroller Layout focused after the navigation', () => {
    focusFirstCreationField();
    const scroller = document.createElement('div');
    scroller.setAttribute('data-primary-scroll', '');
    scroller.tabIndex = -1;
    document.body.appendChild(scroller);
    scroller.focus();
    const view = render(<Page />);
    expect(document.activeElement).toBe(view.getByLabelText('first'));
    scroller.remove();
  });
});
