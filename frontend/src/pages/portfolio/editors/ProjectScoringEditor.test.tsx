import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import ProjectScoringEditor from './ProjectScoringEditor';

const get = vi.hoisted(() => vi.fn());
const stableT = (key: string) => key;

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const CRITERIA = [{
  id: 'c-reg',
  name: 'Regulation',
  enabled: true,
  inverted: false,
  weight: 1,
  values: [
    { id: 'v-no', label: 'No', position: 0, triggers_mandatory_bypass: false },
    { id: 'v-yes', label: 'Required', position: 1, triggers_mandatory_bypass: true },
  ],
}];

function renderEditor(props: Partial<ComponentProps<typeof ProjectScoringEditor>> = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <ProjectScoringEditor
        projectId="prj-1"
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

describe('ProjectScoringEditor bypass mark', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/criteria') return { data: CRITERIA };
      return { data: {} };
    });
  });

  it('shows the bypass mark on a scale value only when the setting is on', async () => {
    const off = renderEditor();
    expect((await screen.findByRole('button', { name: /^Required/ })).textContent).toBe('Required');
    off.unmount();
    renderEditor({ mandatoryBypassEnabled: true });
    expect((await screen.findByRole('button', { name: 'Required *' })).textContent).toBe('Required *');
  });
});
