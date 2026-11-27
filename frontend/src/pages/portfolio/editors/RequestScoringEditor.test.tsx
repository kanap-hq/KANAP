import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import RequestScoringEditor from './RequestScoringEditor';

const get = vi.hoisted(() => vi.fn());
const stableT = (key: string) => key;

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const CRITERIA = [
  {
    id: 'c-value',
    name: 'Value',
    enabled: true,
    inverted: false,
    weight: 1,
    values: [
      { id: 'v-low', label: 'Low', position: 0, triggers_mandatory_bypass: false },
      { id: 'v-high', label: 'High', position: 1, triggers_mandatory_bypass: false },
    ],
  },
  {
    id: 'c-cost',
    name: 'Cost',
    enabled: true,
    inverted: true,
    weight: 1,
    values: [
      { id: 'v-cheap', label: 'Cheap', position: 0, triggers_mandatory_bypass: false },
      { id: 'v-dear', label: 'Dear', position: 1, triggers_mandatory_bypass: false },
    ],
  },
  {
    id: 'c-old',
    name: 'Retired',
    enabled: false,
    inverted: false,
    weight: 1,
    values: [
      { id: 'v-a', label: 'A', position: 0, triggers_mandatory_bypass: false },
      { id: 'v-b', label: 'B', position: 1, triggers_mandatory_bypass: false },
    ],
  },
];

function priorityFigure(): string {
  const label = screen.getByText('editors.scoring.labels.priorityScore');
  return label.parentElement?.lastElementChild?.textContent ?? '';
}

function renderEditor(props: Partial<ComponentProps<typeof RequestScoringEditor>> = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <RequestScoringEditor
        requestId="req-1"
        criteriaValues={{}}
        priorityScore={50}
        priorityOverride={false}
        overrideValue={null}
        overrideJustification={null}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('RequestScoringEditor priority', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/criteria') return { data: CRITERIA };
      return { data: {} };
    });
  });

  it('shows no score until an enabled criterion is answered, then the live score', async () => {
    renderEditor();
    expect(await screen.findByText('Value')).toBeInTheDocument();
    expect(priorityFigure()).toBe('-');

    fireEvent.click(screen.getByRole('button', { name: 'High' }));
    await waitFor(() => expect(priorityFigure()).toBe('100'));
  });

  it('ignores an answer stored for a disabled criterion', async () => {
    renderEditor({ criteriaValues: { 'c-old': 'v-b' }, priorityScore: 40 });
    expect(await screen.findByText('Value')).toBeInTheDocument();
    expect(priorityFigure()).toBe('-');
  });

  it('shows the override value when no criterion is answered', async () => {
    renderEditor({ priorityOverride: true, overrideValue: 72, priorityScore: 50 });
    expect(await screen.findByText('Value')).toBeInTheDocument();
    expect(priorityFigure()).toBe('72');
  });

  it('shows the bypass mark on a scale value only when the setting is on', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/criteria') {
        return {
          data: [{
            id: 'c-reg',
            name: 'Regulation',
            enabled: true,
            inverted: false,
            weight: 1,
            values: [
              { id: 'v-no', label: 'No', position: 0, triggers_mandatory_bypass: false },
              { id: 'v-yes', label: 'Required', position: 1, triggers_mandatory_bypass: true },
            ],
          }],
        };
      }
      return { data: {} };
    });
    const off = renderEditor();
    expect((await screen.findByRole('button', { name: /^Required/ })).textContent).toBe('Required');
    off.unmount();
    renderEditor({ mandatoryBypassEnabled: true });
    expect((await screen.findByRole('button', { name: 'Required *' })).textContent).toBe('Required *');
  });
});
