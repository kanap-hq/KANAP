import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolResultBody } from '../components/ToolResultRenderer';

describe('ToolResultBody', () => {
  it('renders search payloads', () => {
    render(
      <ToolResultBody
        name="search_all"
        result={{
          items: [
            {
              id: 'app-1',
              type: 'applications',
              ref: 'APP-1',
              label: 'CRM',
              status: 'active',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('APP-1')).toBeInTheDocument();
    expect(screen.getByText('CRM')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders document payloads', () => {
    render(
      <ToolResultBody
        name="get_document"
        result={{
          ref: 'DOC-7',
          title: 'Runbook',
          summary: 'Keep it updated.',
        }}
      />,
    );

    expect(screen.getByText('DOC-7: Runbook')).toBeInTheDocument();
    expect(screen.getByText('Keep it updated.')).toBeInTheDocument();
  });

  it('renders record history payloads as the History tab lines', () => {
    render(
      <ToolResultBody
        name="get_record_history"
        result={{
          entity: { type: 'technologies', id: 'TEC-3' },
          items: [
            { at: '2026-10-20T08:00:00.000Z', action: 'update', actor: { kind: 'user', name: 'Alex Operator' }, subject: { kind: 'record' }, changes: [] },
            { at: '2026-10-01T08:00:00.000Z', action: 'create', actor: { kind: 'system', name: null }, subject: { kind: 'record' }, changes: [] },
          ],
          returned: 2,
          next_cursor: null,
        }}
      />,
    );

    expect(screen.getByText('Alex Operator')).toBeInTheDocument();
    // One line per entry, dated as the History tab dates it.
    const times = document.querySelectorAll('time');
    expect(times).toHaveLength(2);
    expect(times[0].getAttribute('datetime')).toBe('2026-10-20T08:00:00.000Z');
  });

  it('says a record history without entries in the History tab words', () => {
    render(<ToolResultBody name="get_record_history" result={{ items: [], returned: 0, next_cursor: null }} />);
    expect(screen.getByText('admin:auditLogs.history.empty')).toBeInTheDocument();
  });

  it('renders entity comments payloads', () => {
    render(
      <ToolResultBody
        name="get_entity_comments"
        result={{
          entity: {
            type: 'projects',
            ref: 'PRJ-7',
            label: 'Migration',
          },
          items: [
            {
              author: 'Alex Operator',
              content: 'We need a rollback plan.',
              created_at: '2026-03-29T10:00:00.000Z',
              updated_at: '2026-03-29T10:00:00.000Z',
              edited: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('PRJ-7')).toBeInTheDocument();
    expect(screen.getByText('Migration')).toBeInTheDocument();
    expect(screen.getByText('Alex Operator')).toBeInTheDocument();
    expect(screen.getByText('We need a rollback plan.')).toBeInTheDocument();
  });

  it('falls back to generic JSON rendering for unknown payloads', () => {
    render(
      <ToolResultBody
        name="custom_tool"
        result={{
          ok: true,
          nested: { count: 2 },
        }}
      />,
    );

    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
    expect(screen.getByText(/"count": 2/)).toBeInTheDocument();
  });

  it('shows a warning when a tool result contains ignored filter fields', () => {
    render(
      <ToolResultBody
        name="query_entities"
        result={{
          items: [],
          total: 14,
          filters_applied: [],
          filters_ignored: ['assignee'],
        }}
      />,
    );

    expect(screen.getByText('Ignored fields: assignee')).toBeInTheDocument();
  });

  it('renders structured query metadata and repair suggestions', () => {
    render(
      <ToolResultBody
        name="query_entities"
        result={{
          status: 'invalid_filter',
          items: [],
          total: 0,
          returned: 0,
          complete: false,
          truncated: false,
          filters_applied: [],
          filters_ignored: ['assignee_id'],
          suggested_repairs: [
            {
              field: 'assignee',
              reason: 'Use supported AI field "assignee" instead of unsupported alias "assignee_id".',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('status: invalid_filter')).toBeInTheDocument();
    expect(screen.getByText(/assignee: Use supported AI field/)).toBeInTheDocument();
  });

  it('renders filter descriptions', () => {
    render(
      <ToolResultBody
        name="describe_entity_filters"
        result={{
          entity_type: 'tasks',
          fields: [
            {
              field: 'assignee',
              type: 'set',
              accepted_value_kind: 'user display name',
              aliases: ['assignee_id'],
            },
          ],
          total: 1,
          returned: 1,
          complete: true,
          truncated: false,
        }}
      />,
    );

    expect(screen.getByText('assignee')).toBeInTheDocument();
    expect(screen.getByText('user display name')).toBeInTheDocument();
    expect(screen.getByText('toolResults.aliases')).toBeInTheDocument();
  });
});
