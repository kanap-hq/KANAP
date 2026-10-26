import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentStatusStrip from './AgentStatusStrip';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import { formatEuro } from '../../i18n/formatters';

const runState = {
  isSre: false,
  sreLastPollAt: '',
  sreLastPollStatus: '',
  summary: { ingestion: { lastPollAt: '', lastPollStatus: '' } },
  watching: false,
  scopeFiltered: false,
  checkIntervalMinutes: 5,
  lifecycleKey: null,
  waitingCount: 0,
  inProgressCount: 0,
  failedCount: 0,
  daily: {
    runs: 2,
    estimatedTokens: 30,
    estimatedCostEur: 0.0012,
    cap: { maxRuns: 20, maxTokens: 1000, maxCostEur: 10 },
  },
};

vi.mock('./agentRunState', () => ({
  useAgentRunState: () => runState,
}));

function renderStrip() {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <AgentStatusStrip agentKey="helpdesk" />
    </ThemeProvider>,
  );
}

describe('AgentStatusStrip cost', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('formats today\'s euro cost in the interface language', async () => {
    await i18n.changeLanguage('fr');
    renderStrip();
    const cost = screen.getByText(`${formatEuro(0.0012, 'fr', 4)} / ${formatEuro(10, 'fr')}`.replace(/\s+/g, ' ').trim());
    expect(cost.textContent).not.toMatch(/\d\.\d/);
  });
});
