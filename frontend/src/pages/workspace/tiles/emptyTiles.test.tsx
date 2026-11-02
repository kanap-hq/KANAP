import { render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import DashboardTile from './DashboardTile';
import { TileEmptyContext } from './emptyTiles';

const t = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));

function renderTile(props: { isEmpty?: boolean; isLoading?: boolean; isError?: boolean }) {
  const report = vi.fn();
  const view = render(
    <ThemeProvider theme={createAppTheme('light')}>
      <TileEmptyContext.Provider value={report}>
        <DashboardTile title="Tile" icon="Task" {...props}><div /></DashboardTile>
      </TileEmptyContext.Provider>
    </ThemeProvider>,
  );
  return { report, view };
}

describe('DashboardTile empty report', () => {
  it('says it is empty once loaded with nothing to show', async () => {
    const { report } = renderTile({ isEmpty: true });
    await waitFor(() => expect(report).toHaveBeenLastCalledWith(true));
  });

  it.each([
    ['still loading', { isEmpty: true, isLoading: true }],
    ['in error, where the retry prompt must stay', { isEmpty: true, isError: true }],
    ['with content', { isEmpty: false }],
  ])('says it is not empty while %s', async (_label, props) => {
    const { report } = renderTile(props);
    await waitFor(() => expect(report).toHaveBeenLastCalledWith(false));
  });

  it('renders without a home page around it', () => {
    expect(() => render(<ThemeProvider theme={createAppTheme('light')}><DashboardTile title="Tile" icon="Task" isEmpty><div /></DashboardTile></ThemeProvider>)).not.toThrow();
  });
});
