import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { capabilityLabelFromName, statusLabel } from './agentControlPrimitives';
import { RunAuditDetail } from './RunTraceDialog';
import type { AiAgentControlRunDetail } from '../../ai/aiApi';
import { createAppTheme } from '../../config/ThemeContext';
import '../../i18n';

function detail(
  evidence: Array<{ id: string; summary: string | null; source_object_type: string }>,
  calls: { status?: string; run_steps?: unknown[]; tool_executions?: unknown[] } = {},
): AiAgentControlRunDetail {
  return {
    run: { id: 'run-1', status: calls.status ?? 'completed', started_at: '2026-11-11T09:00:00.000Z', completed_at: '2026-11-11T09:00:02.000Z', created_at: '2026-11-11T09:00:00.000Z' },
    run_steps: calls.run_steps ?? [],
    tool_executions: calls.tool_executions ?? [],
    evidence,
  } as unknown as AiAgentControlRunDetail;
}

function renderDetail(value: AiAgentControlRunDetail) {
  return render(
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

  it('shows a failed call by its tool and status when its message and arguments are not given to the reader', () => {
    const call = {
      capability_name: 'query_entities', status: 'failed', input_summary: null, output_summary: null, error_message: null,
      started_at: '2026-11-11T09:00:00.000Z', completed_at: '2026-11-11T09:00:01.000Z',
    };
    const { container } = renderDetail(detail([], {
      status: 'failed',
      run_steps: [{ ...call, id: 's1', step_index: 1, kind: 'tool' }],
      tool_executions: [{ ...call, id: 't1', input_hash: null, duration_ms: 840, metadata_json: {} }],
    }));
    // One line per step and per tool call: the tool, its duration, its status.
    expect(screen.getByText(`1. ${capabilityLabelFromName('query_entities')} · 1.0 s`)).toBeTruthy();
    expect(screen.getByText(`${capabilityLabelFromName('query_entities')} · 840 ms`)).toBeTruthy();
    expect(screen.getAllByText(statusLabel('failed'))).toHaveLength(2);
    expect(container.textContent).not.toMatch(/null|undefined/);
    // Nothing kept: the section is not drawn.
    expect(screen.queryByText('Evidence')).toBeNull();
  });
});
