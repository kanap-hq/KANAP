import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createAppTheme } from '../../../config/ThemeContext';
import ApplicationClassificationPanel, { type ApplicationClassification } from './ApplicationClassificationPanel';
import ApplicationCriticalityMetadata from './ApplicationCriticalityMetadata';

const catalog: { businessCriticalityLevels: any[]; cyberCriticalityLevels: any[]; dataClasses: any[]; recoveryWaves: any[] } = {
  businessCriticalityLevels: [
    { code: 'critical', label: 'Critical', description: 'At most four hours', rank: 4, maxMtdMinutes: 240 },
    { code: 'high', label: 'High', description: 'Up to one day', rank: 3, maxMtdMinutes: 1440 },
    { code: 'low', label: 'Low', description: 'More than three days', rank: 1, maxMtdMinutes: null },
    { code: 'former', label: 'Former', description: 'Historical only', rank: 0, maxMtdMinutes: null, deprecated: true },
  ],
  cyberCriticalityLevels: [
    { code: 'critical', label: 'Critical', description: 'Catastrophic consequences', rank: 4 },
  ],
  dataClasses: [
    { code: 'restricted', label: 'Restricted', description: 'Strictly limited disclosure', rank: 4 },
  ],
  recoveryWaves: [
    { code: 'vital', label: 'V1 — Vital activities', description: 'Restore vital activities', order: 1 },
  ],
};

vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: catalog }),
}));

const theme = createAppTheme('light');

const completeApp: ApplicationClassification = {
  id: 'app-1',
  criticality: 'high',
  cyber_criticality: 'critical',
  recovery_wave: 'vital',
  rto_minutes: 240,
  rpo_minutes: 0,
  classification_justification: 'Customer operations require same-day recovery.',
  classification_revision: 4,
  classification_review_state: 'stale',
  classification_review_reason: 'never_reviewed',
  classification_reviewed_at: null,
  data_class: 'restricted',
  contains_pii: true,
  last_dr_test: null,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof ApplicationClassificationPanel>> = {}) {
  const onPatch = overrides.onPatch ?? vi.fn().mockResolvedValue(undefined);
  const onReview = overrides.onReview ?? vi.fn().mockResolvedValue(undefined);
  const { unmount } = render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <ApplicationClassificationPanel
          app={completeApp}
          canManage
          onPatch={onPatch}
          onReview={onReview}
          {...overrides}
        />
      </ThemeProvider>
    </MemoryRouter>,
  );
  return { onPatch, onReview, unmount };
}

describe('Application classification workspace surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets the top bar and the Compliance tab choose the business level directly', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <ThemeProvider theme={theme}>
        <ApplicationCriticalityMetadata criticality="high" onCommit={onCommit} />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Business criticality.*High/ }));
    expect(screen.queryByRole('menuitem', { name: /Former/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Critical' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('critical'));
    unmount();

    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onPatch });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Business criticality' }));
    expect(screen.queryByRole('option', { name: /Former/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Critical/ }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ criticality: 'critical' }));
    expect(screen.queryByText(/downtime/i, { selector: 'label, span' })).not.toBeInTheDocument();
  });

  it('keeps a retired level selectable only for the application that already uses it', () => {
    renderPanel({ app: { ...completeApp, criticality: 'former' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Business criticality' }));
    expect(screen.getByRole('option', { name: /Former \(No longer offered\)/ })).toBeInTheDocument();
  });

  it('warns when the RTO reaches the downtime of the chosen level, and only then', () => {
    const { unmount } = renderPanel({ app: { ...completeApp, rto_minutes: 1440 } });
    expect(screen.getByRole('alert')).toHaveTextContent('maximum tolerable downtime (MTD) of the High level (1 day)');
    unmount();
    const unbounded = renderPanel({ app: { ...completeApp, rto_minutes: 1440, criticality: 'low' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unbounded.unmount();
    renderPanel({ app: { ...completeApp, rto_minutes: 1440, criticality: null } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['incomplete data', { app: { ...completeApp, cyber_criticality: null } }],
    ['an active save', { saving: true }],
    ['a server error', { error: 'The classification could not be saved.' }],
    ['an up-to-date review', { app: { ...completeApp, classification_review_state: 'reviewed' as const, classification_review_reason: null, classification_reviewed_at: '2026-09-05T10:00:00Z' } }],
  ])('disables review during %s', (_label, props) => {
    renderPanel(props);

    expect(screen.getByRole('button', { name: 'Mark as reviewed' })).toBeDisabled();
  });

  it('marks a complete classification reviewed only after an explicit click', () => {
    const { onReview } = renderPanel();

    expect(screen.getByText('Never reviewed')).toBeInTheDocument();
    expect(onReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as reviewed' }));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it('blocks review while a duration draft is invalid even when the saved classification is complete', () => {
    const { onReview } = renderPanel();
    const reviewButton = screen.getByRole('button', { name: 'Mark as reviewed' });
    const rto = screen.getByRole('textbox', { name: 'Recovery time objective' });

    expect(reviewButton).toBeEnabled();
    fireEvent.change(rto, { target: { value: '0.01' } });

    expect(reviewButton).toBeDisabled();
    fireEvent.click(reviewButton);
    expect(onReview).not.toHaveBeenCalled();
  });

  it('does not render option descriptions in the closed classification controls', () => {
    renderPanel();
    expect(screen.queryByText('Up to one day')).not.toBeInTheDocument();
    expect(screen.queryByText('Catastrophic consequences')).not.toBeInTheDocument();
    expect(screen.queryByText('Restore vital activities')).not.toBeInTheDocument();
  });

  it('keeps the review timestamp and reviewer while flagging later changes', () => {
    renderPanel({ app: { ...completeApp, classification_review_reason: 'data_changed', classification_reviewed_at: '2026-09-05T10:00:00Z', classification_reviewer_name: 'Jane Doe' } });
    expect(screen.getByText(/Reviewed on .*2026.*· Jane Doe/)).toBeInTheDocument();
    expect(screen.getByText('Changed since review')).toBeInTheDocument();
    expect(screen.queryByText('Never reviewed')).not.toBeInTheDocument();
  });

  it('explains missing review fields without dropping an earlier review', () => {
    renderPanel({ app: { ...completeApp, cyber_criticality: null, classification_review_state: 'incomplete', classification_review_reason: 'missing_fields', classification_reviewed_at: '2026-09-05T10:00:00Z' } });
    expect(screen.getByText(/Before review, complete: Cyber criticality/)).toBeInTheDocument();
    expect(screen.getByText(/Reviewed on/)).toBeInTheDocument();
    expect(screen.getByText('Changed since review')).toBeInTheDocument();
  });

  it('raises the light coherence hints from the active catalog ranks and a twelve-month test threshold', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 7));
    try {
      // Catalog out of order, with a retired level above the active maximum: retired levels do not define the extremes.
      catalog.dataClasses.splice(0, catalog.dataClasses.length, { code: 'internal', label: 'Internal', description: '', rank: 2 }, { code: 'secret', label: 'Secret', description: '', rank: 9, deprecated: true }, { code: 'restricted', label: 'Restricted', description: '', rank: 4 });
      catalog.cyberCriticalityLevels.splice(0, catalog.cyberCriticalityLevels.length, { code: 'moderate', label: 'Moderate', description: '', rank: 2 }, { code: 'low', label: 'Low', description: '', rank: 1 }, { code: 'critical', label: 'Critical', description: 'Catastrophic consequences', rank: 4 });
      const { unmount } = renderPanel({ app: { ...completeApp, data_class: 'restricted', cyber_criticality: 'low', criticality: 'critical', last_dr_test: '2025-09-07' } });
      expect(screen.getByText(/highest confidentiality level with the lowest cyber criticality/)).toBeInTheDocument();
      expect(screen.getByText(/No recovery test in the last twelve months/)).toBeInTheDocument();
      unmount();
      const recent = renderPanel({ app: { ...completeApp, data_class: 'restricted', cyber_criticality: 'moderate', criticality: 'critical', last_dr_test: '2025-09-08' } });
      expect(screen.queryByText(/lowest cyber criticality/)).not.toBeInTheDocument();
      expect(screen.queryByText(/No recovery test/)).not.toBeInTheDocument();
      recent.unmount();
      renderPanel({ app: { ...completeApp, criticality: 'high', last_dr_test: null } });
      expect(screen.queryByText(/No recovery test/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      catalog.dataClasses.splice(0, catalog.dataClasses.length, { code: 'restricted', label: 'Restricted', description: 'Strictly limited disclosure', rank: 4 });
      catalog.cyberCriticalityLevels.splice(0, catalog.cyberCriticalityLevels.length, { code: 'critical', label: 'Critical', description: 'Catastrophic consequences', rank: 4 });
    }
  });

  it('lists interfaces to applications restored later under the wave, and nothing without a wave', () => {
    const dependencies = [{ interface_id: 'i1', interface_reference: 'INT-8', interface_name: 'Orders feed', direction: 'source' as const, application_id: 'a2', application_ref: 'APP-2', application_name: 'CRM', recovery_wave: 'vital' }];
    const { unmount } = renderPanel({ recoveryDependencies: dependencies });
    expect(screen.getByText(/Exchanges with CRM, planned in V1 — Vital activities/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'INT-8' })).toHaveAttribute('href', '/it/interfaces/INT-8/overview');
    unmount();
    renderPanel({ app: { ...completeApp, recovery_wave: null }, recoveryDependencies: dependencies });
    expect(screen.queryByText(/Exchanges with/)).not.toBeInTheDocument();
  });

  it('shows save errors as an accessible alert', () => {
    renderPanel({ error: 'The classification could not be saved.' });

    expect(screen.getByRole('alert')).toHaveTextContent('The classification could not be saved.');
  });

  it('exposes classification guidance through labelled tooltip controls', async () => {
    renderPanel();

    const helpButton = screen.getByRole('button', { name: 'Cyber criticality' });
    fireEvent.mouseOver(helpButton);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Choose the highest level justified by a plausible consequence');
  });
});
