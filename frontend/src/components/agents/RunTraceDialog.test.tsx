import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { RunAuditDetail } from './RunTraceDialog';
import type { AiAgentControlRunDetail } from '../../ai/aiApi';
import { createAppTheme } from '../../config/ThemeContext';
import '../../i18n';

function detail(evidence: Array<{ id: string; summary: string | null; source_object_type: string }>): AiAgentControlRunDetail {
  return {
    run: { id: 'run-1', status: 'completed', started_at: '2026-11-11T09:00:00.000Z', completed_at: '2026-11-11T09:00:02.000Z', created_at: '2026-11-11T09:00:00.000Z' },
    run_steps: [],
    tool_executions: [],
    evidence,
  } as unknown as AiAgentControlRunDetail;
}

function renderDetail(value: AiAgentControlRunDetail) {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <RunAuditDetail detail={value} />
    </ThemeProvider>,
  );
}

describe('RunAuditDetail', () => {
  it('shows what a tool kept with its summary', () => {
    renderDetail(detail([{ id: 'e1', summary: 'Object keys: items', source_object_type: 'query_entities' }]));
    expect(screen.getByText('Object keys: items · query entities')).toBeTruthy();
  });

  it('shows the tool alone when the summary is not given to the reader', () => {
    renderDetail(detail([{ id: 'e1', summary: null, source_object_type: 'query_entities' }]));
    // The whole line is the tool: no empty summary, no separator.
    expect(screen.getByText('query entities')).toBeTruthy();
    expect(screen.queryByText(/null/)).toBeNull();
  });
});
