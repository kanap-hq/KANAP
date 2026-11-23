import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import CheckboxSetFloatingFilter from './CheckboxSetFloatingFilter';

describe('CheckboxSetFloatingFilter', () => {
  it('skips removeEventListener once the grid is destroyed, and still removes the listener on a live grid', () => {
    const column = { getColId: () => 'status' };
    const mount = (isDestroyed: () => boolean) => {
      const api = {
        isDestroyed,
        getFilterModel: () => ({}),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      const view = render(<CheckboxSetFloatingFilter {...({ api, column, showParentFilter: vi.fn() } as any)} />);
      return { api, view };
    };

    const destroyed = mount(() => true);
    destroyed.view.unmount();
    expect(destroyed.api.removeEventListener).not.toHaveBeenCalled();

    const live = mount(() => false);
    live.view.unmount();
    expect(live.api.removeEventListener).toHaveBeenCalledTimes(1);
    expect(live.api.removeEventListener).toHaveBeenCalledWith('filterChanged', expect.any(Function));
  });
});
