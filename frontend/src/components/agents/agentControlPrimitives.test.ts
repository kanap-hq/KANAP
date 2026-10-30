import { describe, expect, it } from 'vitest';
import {
  actionUpdateSummary,
  buildTicketGroups,
  capabilityLabelFromName,
  executableActions,
  executableTerminalActions,
  ticketingProviderKeyForDefinition,
} from './agentControlPrimitives';
import {
  canPersistIdentity,
  collectEffectivePromptBounds,
  droppedSharedContextLineCount,
  MAX_PERSONA_INSTRUCTIONS_TOTAL_CHARS,
  mergeInstructionsForDisplay,
  measurePersonaIdentityLimits,
  personaIdentitySavePatch,
  truncatedSharedContextLineCount,
} from './agentPersona';
import { targetingPredicateCount } from './agentRunState';
import {
  applyOptimisticDecisionOverlay,
  hasAgentControlInFlight,
  pruneConfirmedOptimisticDecisions,
  withOptimisticDecisionIds,
  withoutOptimisticDecisionIds,
} from '../../pages/agents/useAgentControlData';
import {
  type AiAgentControlActionRequest,
  type AiAgentControlQueueOverview,
  type AiAgentControlWorkItem,
} from '../../ai/aiApi';

const now = '2026-07-01T10:00:00.000Z';
const nowMs = Date.parse(now);
const future = '2999-01-01T00:00:00.000Z';

function action(overrides: Partial<AiAgentControlActionRequest> = {}): AiAgentControlActionRequest {
  return {
    id: 'action-1',
    run_id: 'run-1',
    tool_execution_id: null,
    capability_name: 'ticketing.ticket.internal_note.add_approved',
    capability_version: '1',
    effect: 'write',
    status: 'pending',
    target_type: 'ticket',
    target_id: null,
    target_ref: '1001',
    action_payload_json: null,
    provider_kind: 'ticketing',
    provider_key: 'mock',
    input_summary: null,
    evidence_ids: null,
    expires_at: future,
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    error_message: null,
    metadata_json: null,
    execution_readiness: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function workItem(overrides: Partial<AiAgentControlWorkItem> = {}): AiAgentControlWorkItem {
  return {
    id: 'work-item-1',
    agent_definition_id: 'agent-a',
    trigger_id: null,
    source_provider_kind: 'ticketing',
    source_provider_key: 'mock',
    source_object_type: 'ticket',
    source_object_ref: '1001',
    source_object_updated_at: null,
    work_kind: 'triage',
    status: 'waiting_approval',
    priority: 0,
    dedup_key: 'ticketing:mock:ticket:1001',
    lease_owner: null,
    leased_until: null,
    attempt_count: 0,
    max_attempts: 3,
    next_attempt_at: null,
    last_run_id: 'latest-run',
    last_action_request_ids: null,
    last_error: null,
    metadata_json: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function overview(overrides: Partial<AiAgentControlQueueOverview> = {}): AiAgentControlQueueOverview {
  return {
    definitions: [],
    work_items: [],
    target_states: [],
    action_requests: [],
    counts: {},
    ...overrides,
  };
}

describe('buildTicketGroups', () => {
  it('groups a pending action whose ticket has no work item instead of orphaning it', () => {
    const result = buildTicketGroups(overview(), [
      action({ id: 'action-out-of-slice', target_ref: '4711' }),
    ], null, nowMs);

    expect(result.orphanActions).toEqual([]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      key: 'ticketing:mock:ticket:4711',
      targetRef: '4711',
      workItem: null,
      queueStatus: 'unknown',
      lifecycle: 'needs_decision',
    });
    expect(result.groups[0].pendingActions.map((item) => item.id)).toEqual(['action-out-of-slice']);
  });

  it('attaches a pending action from an older run to its ticket group by target key', () => {
    const result = buildTicketGroups(overview({
      work_items: [workItem({ source_object_ref: '42', last_run_id: 'latest-run' })],
    }), [
      action({ id: 'older-run-action', run_id: 'older-run', target_ref: '42' }),
    ], null, nowMs);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].key).toBe('ticketing:mock:ticket:42');
    expect(result.groups[0].pendingActions.map((item) => item.id)).toEqual(['older-run-action']);
    expect(result.groups[0].lifecycle).toBe('needs_decision');
  });

  it('does not mark a waiting_approval work item as needs_decision when all actions are decided', () => {
    const approved = action({ id: 'approved-action', status: 'approved', target_ref: '77', expires_at: null });
    const rejected = action({ id: 'rejected-action', status: 'rejected', target_ref: '77', expires_at: null });
    const result = buildTicketGroups(overview({
      work_items: [workItem({
        source_object_ref: '77',
        status: 'waiting_approval',
        last_action_request_ids: ['approved-action', 'rejected-action'],
      })],
    }), [approved, rejected], null, nowMs);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].pendingActions.map((item) => item.status)).toEqual(['approved', 'rejected']);
    expect(result.groups[0].lifecycle).toBe('finished');
  });

  it('puts dismissed-only action groups in the finished lifecycle', () => {
    const dismissed = action({ id: 'dismissed-action', status: 'dismissed', target_ref: '78', expires_at: null });
    const result = buildTicketGroups(overview({
      work_items: [workItem({
        source_object_ref: '78',
        status: 'waiting_approval',
        last_action_request_ids: ['dismissed-action'],
      })],
    }), [dismissed], null, nowMs);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].pendingActions.map((item) => item.status)).toEqual(['dismissed']);
    expect(result.groups[0].lifecycle).toBe('finished');
  });

  it('does not attach cross-agent actions when agentDefinitionId is set', () => {
    const result = buildTicketGroups(overview({
      work_items: [workItem({ source_object_ref: '99', agent_definition_id: 'agent-a' })],
    }), [
      action({
        id: 'other-agent-action',
        target_ref: '99',
        metadata_json: { agent_definition_id: 'agent-b' },
      }),
    ], 'agent-a', nowMs);

    expect(result.orphanActions).toEqual([]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].pendingActions).toEqual([]);
  });

  it('groups non-ticketing provider actions by their own target key', () => {
    const result = buildTicketGroups(overview(), [
      action({
        id: 'monitoring-action',
        capability_name: 'monitoring.alert.acknowledge.approved',
        provider_kind: 'monitoring',
        provider_key: 'prometheus',
        target_type: 'alert',
        target_ref: 'alert-1',
      }),
    ], null, nowMs);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].key).toBe('monitoring:prometheus:alert:alert-1');
    expect(result.groups[0].targetRef).toBe('alert-1');
    expect(result.groups[0].pendingActions.map((item) => item.id)).toEqual(['monitoring-action']);
  });

  it('always returns an empty orphanActions list', () => {
    const result = buildTicketGroups(overview({
      work_items: [workItem({ source_object_ref: 'in-slice' })],
    }), [
      action({ id: 'out-of-slice-action', target_ref: 'out-of-slice' }),
    ], null, nowMs);

    expect(result.orphanActions).toEqual([]);
  });
});

describe('executable terminal approval filter', () => {
  const liveReply = action({
    id: 'live-reply',
    capability_name: 'ticketing.ticket.public_reply.add_approved',
    status: 'pending',
  });
  const liveSolve = action({
    id: 'live-solve',
    capability_name: 'ticketing.ticket.status_update.approved',
    status: 'pending',
    action_payload_json: { transitionKey: 'solved', targetStatus: 'solved', terminal: true },
  });
  const expiredSolves = [1, 2, 3, 4].map((index) => action({
    id: `expired-solve-${index}`,
    capability_name: 'ticketing.ticket.status_update.approved',
    status: 'expired',
    action_payload_json: { transitionKey: 'solved', targetStatus: 'solved', terminal: true },
    execution_readiness: {
      can_execute: false,
      can_reject: false,
      blocked_reason: 'expired',
      requires_sandbox_write_target: false,
      sandbox_write_target_ref: null,
    },
  }));

  it('lists only the live solve, not expired historical solves', () => {
    const listed = executableTerminalActions([liveReply, liveSolve, ...expiredSolves]);
    expect(listed.map((item) => item.id)).toEqual(['live-solve']);
  });

  it('approve payload is the executable set, not the expired solves', () => {
    const payload = executableActions([liveReply, liveSolve, ...expiredSolves]);
    expect(payload.map((item) => item.id)).toEqual(['live-reply', 'live-solve']);
  });
});

describe('targetingPredicateCount', () => {
  it('counts targeting predicates for helpdesk and SRE alike', () => {
    expect(targetingPredicateCount({
      scope_policy_json: {
        targeting: {
          predicates: [
            { field: 'status', operator: 'in', value: ['1'] },
            { field: 'created_at', operator: 'gte', value: '2026-01-01' },
          ],
        },
      },
    })).toBe(2);
  });

  it('treats missing targeting as unfiltered', () => {
    expect(targetingPredicateCount({ scope_policy_json: {} })).toBe(0);
    expect(targetingPredicateCount(null)).toBe(0);
  });
});

describe('capabilityLabelFromName', () => {
  it('maps provider capability names to action labels', () => {
    expect(capabilityLabelFromName('ticketing.ticket.public_reply.add_approved')).toBe('Requester reply');
    expect(capabilityLabelFromName('ticketing.ticket.internal_note.add_approved')).toBe('Internal note');
    expect(capabilityLabelFromName('ticketing.ticket.status_update.prepare')).toBe('Status');
    expect(capabilityLabelFromName('ticketing.ticket.participant_update.prepare')).toBe('Observers');
  });

  it('does not label read-only context lookups as write actions', () => {
    expect(capabilityLabelFromName('ticketing.ticket.classification_context.get')).toBe('Classification context get');
    expect(capabilityLabelFromName('ticketing.ticket.participant_context.get')).toBe('Participant context get');
  });
});

describe('ticketingProviderKeyForDefinition', () => {
  it('uses the explicit ticketing provider binding first', () => {
    expect(ticketingProviderKeyForDefinition({
      provider_bindings_json: {
        ticketing: {
          provider_kind: 'ticketing',
          provider_key: 'mock',
        },
      },
      scope_policy_json: {
        provider_kind: 'ticketing',
        provider_key: 'legacy-ticketing',
      },
    })).toBe('mock');
  });

  it('falls back to the ticketing scope provider for legacy definitions', () => {
    expect(ticketingProviderKeyForDefinition({
      provider_bindings_json: null,
      scope_policy_json: {
        provider_kind: 'ticketing',
        provider_key: 'prod-ticketing',
      },
    })).toBe('prod-ticketing');
  });

  it('returns null for non-ticketing definitions', () => {
    expect(ticketingProviderKeyForDefinition({
      provider_bindings_json: {
        ticketing: {
          provider_kind: 'monitoring',
          provider_key: 'prometheus',
        },
      },
      scope_policy_json: {
        provider_kind: 'monitoring',
        provider_key: 'prometheus',
      },
    })).toBeNull();
  });
});

describe('agent control polling and optimistic overlay helpers', () => {
  it('detects in-flight actions and leased or running work items', () => {
    expect(hasAgentControlInFlight({ actions: [action({ status: 'executing' })] })).toBe(true);
    expect(hasAgentControlInFlight({
      actions: [action({
        status: 'approved',
        executed_at: null,
        metadata_json: { approved_batch_context: { execution_queued: true } },
      })],
    })).toBe(true);
    expect(hasAgentControlInFlight({
      overview: overview({ work_items: [workItem({ status: 'leased' })] }),
      actions: [],
    })).toBe(true);
    expect(hasAgentControlInFlight({
      overview: overview({ work_items: [workItem({ status: 'waiting_approval' })] }),
      actions: [action({ status: 'pending' })],
    })).toBe(false);
  });

  it('applies, prunes, and rolls back optimistic decisions', () => {
    const base = action({ id: 'optimistic-action', status: 'pending' });
    const approvedOverlay = withOptimisticDecisionIds(new Map(), [base.id], 'approved');
    const overlaid = applyOptimisticDecisionOverlay([base], approvedOverlay);

    expect(overlaid[0].status).toBe('approved');
    expect(overlaid[0].metadata_json?.approved_batch_context).toMatchObject({ execution_queued: true });

    const dismissedOverlay = withOptimisticDecisionIds(new Map(), [base.id], 'dismissed');
    const dismissed = applyOptimisticDecisionOverlay([base], dismissedOverlay);
    expect(dismissed[0].status).toBe('dismissed');

    expect(pruneConfirmedOptimisticDecisions(approvedOverlay, [base]).has(base.id)).toBe(true);
    expect(pruneConfirmedOptimisticDecisions(approvedOverlay, [{ ...base, status: 'executing' }]).has(base.id)).toBe(false);
    expect(pruneConfirmedOptimisticDecisions(dismissedOverlay, [{ ...base, status: 'dismissed' }]).has(base.id)).toBe(false);
    expect(withoutOptimisticDecisionIds(approvedOverlay, [base.id]).has(base.id)).toBe(false);
  });
});

describe('agent persona purpose + instructions helpers', () => {
  const stored = {
    mission: 'Triage incoming work.',
    instructionsStored: 'Prefer internal notes when evidence is incomplete.',
    instructionsDraft: 'Prefer internal notes when evidence is incomplete.\nHand over when a human must decide.\nClear and concise.',
    escalationGuidance: 'Hand over when a human must decide.',
    outputStyleTone: 'Clear and concise.',
    outputStyleLanguage: 'fr',
    sharedContextEnabled: false,
    sharedContextProfileId: null as string | null,
  };

  it('merges escalation and tone onto instructions for display only', () => {
    expect(mergeInstructionsForDisplay({
      instructions: 'Prefer internal notes when evidence is incomplete.',
      escalationGuidance: 'Hand over when a human must decide.',
      outputStyleTone: 'Clear and concise.',
    })).toBe('Prefer internal notes when evidence is incomplete.\nHand over when a human must decide.\nClear and concise.');
    expect(mergeInstructionsForDisplay({
      instructions: 'Prefer internal notes when evidence is incomplete.',
      escalationGuidance: '  ',
      outputStyleTone: '',
    })).toBe('Prefer internal notes when evidence is incomplete.');
  });

  it('keeps legacy escalation and tone on an untouched save', () => {
    expect(personaIdentitySavePatch({
      ...stored,
      instructionsTouched: false,
    })).toMatchObject({
      mission: 'Triage incoming work.',
      instructions: ['Prefer internal notes when evidence is incomplete.'],
      output_style: { tone: 'Clear and concise.', language: 'fr' },
      escalation_guidance: 'Hand over when a human must decide.',
    });
  });

  it('clears legacy escalation and tone on the first instructions edit', () => {
    expect(personaIdentitySavePatch({
      ...stored,
      instructionsDraft: 'Prefer internal notes when evidence is incomplete.\nAlways cite knowledge.',
      instructionsTouched: true,
    })).toMatchObject({
      instructions: ['Prefer internal notes when evidence is incomplete.', 'Always cite knowledge.'],
      output_style: { tone: '', language: 'fr' },
      escalation_guidance: '',
    });
  });

  it('counts total cleaned characters the same way the backend does', () => {
    // Whitespace runs collapse before counting; line count and per-line
    // length are deliberately unlimited.
    const manyLongLines = Array.from({ length: 40 }, () => `rule${' '.repeat(10)}${'x'.repeat(200)}`).join('\n');
    const inRange = measurePersonaIdentityLimits({
      mission: 'ok',
      instructionsDraft: manyLongLines,
    });
    expect(inRange.instructionsChars).toBe(40 * ('rule x'.length + 200 - 1));
    expect(inRange.instructionsOverLimit).toBe(false);

    const over = measurePersonaIdentityLimits({
      mission: 'ok',
      instructionsDraft: 'x'.repeat(MAX_PERSONA_INSTRUCTIONS_TOTAL_CHARS + 1),
    });
    expect(over.instructionsOverLimit).toBe(true);
    expect(measurePersonaIdentityLimits({
      mission: 'ok',
      instructionsDraft: 'x'.repeat(MAX_PERSONA_INSTRUCTIONS_TOTAL_CHARS),
    }).instructionsOverLimit).toBe(false);
  });

  it('surfaces the counter only near the limit', () => {
    expect(measurePersonaIdentityLimits({ mission: 'ok', instructionsDraft: 'One rule.' }).instructionsNearLimit).toBe(false);
    expect(measurePersonaIdentityLimits({
      mission: 'ok',
      instructionsDraft: 'x'.repeat(Math.floor(MAX_PERSONA_INSTRUCTIONS_TOTAL_CHARS * 0.8)),
    }).instructionsNearLimit).toBe(true);
    expect(measurePersonaIdentityLimits({ mission: 'x'.repeat(400), instructionsDraft: '' }).purposeNearLimit).toBe(true);
    expect(measurePersonaIdentityLimits({ mission: 'x'.repeat(399), instructionsDraft: '' }).purposeNearLimit).toBe(false);
  });

  it('blocks every identity save while the instructions draft is over the limit', () => {
    const overTotal = 'x'.repeat(MAX_PERSONA_INSTRUCTIONS_TOTAL_CHARS + 1);
    expect(canPersistIdentity({
      mission: 'Triage incoming work.',
      instructionsDraft: overTotal,
      instructionsTouched: true,
    })).toBe(false);
    expect(canPersistIdentity({
      mission: 'Triage incoming work.',
      instructionsDraft: overTotal,
      instructionsTouched: false,
    })).toBe(true);
    expect(canPersistIdentity({
      mission: 'm'.repeat(501),
      instructionsDraft: 'One rule.',
      instructionsTouched: false,
    })).toBe(false);
  });

  it('reads dropped and shortened shared-context lines from bounds_applied', () => {
    expect(droppedSharedContextLineCount(['shared_context_lines_clamped:45->30'])).toBe(15);
    // Budget-clamp tokens carry their count; the bare legacy token reads as 1;
    // across slices the worst case wins.
    expect(droppedSharedContextLineCount([
      'shared_context_lines_clamped:45->30',
      'total_guidance_chars_clamped:shared_context:5',
    ])).toBe(20);
    expect(droppedSharedContextLineCount([
      'total_guidance_chars_clamped:shared_context',
      'total_guidance_chars_clamped:shared_context:3',
    ])).toBe(3);
    expect(truncatedSharedContextLineCount([
      'shared_context_line_2_chars_clamped',
      'shared_context_line_7_chars_clamped',
      'shared_context_line_2_chars_clamped',
    ])).toBe(2);
    expect(collectEffectivePromptBounds({
      prompt_profile: { bounds_applied: ['instructions_clamped:20->16'] },
      tasks: { synthesis: { bounds_applied: ['shared_context_lines_clamped:45->30'] } },
    })).toEqual(['instructions_clamped:20->16', 'shared_context_lines_clamped:45->30']);
  });
});

describe('classification approval summary', () => {
  it('shows category names verbatim and hides the technical category key', () => {
    const summary = actionUpdateSummary(action({
      capability_name: 'ticketing.ticket.classification_update.approved',
      action_payload_json: { current: { category: null }, proposed: { category: 'Software > SAP_HR', categoryKey: '301' } },
    }));
    expect(summary).toContain('Category: Not set -> Software > SAP_HR');
    expect(summary).not.toContain('categoryKey');
    expect(summary).not.toContain('301');
  });
});

describe('technician assignment approval summary', () => {
  it('names the technician being added and the technicians already on the ticket', () => {
    const summary = actionUpdateSummary(action({
      capability_name: 'ticketing.ticket.assignment_update.approved',
      action_payload_json: {
        target: { kind: 'user', key: '42', label: 'Marie Dupont' },
        current: {
          assignedUsers: [
            { kind: 'user', key: '7', label: 'Paul Martin' },
            { kind: 'user', key: '9', label: 'Sophie Bernard' },
          ],
        },
      },
    }));
    expect(summary).toContain('Assign to technician: Marie Dupont');
    expect(summary).toContain('Currently assigned: Paul Martin, Sophie Bernard');
    expect(summary).not.toContain('Assignee:');
  });

  it('says so when no technician is on the ticket yet', () => {
    const summary = actionUpdateSummary(action({
      capability_name: 'ticketing.ticket.assignment_update.approved',
      action_payload_json: {
        target: { kind: 'user', key: '42', label: 'Marie Dupont' },
        current: { assignedUsers: [] },
      },
    }));
    expect(summary).toContain('Assign to technician: Marie Dupont');
    expect(summary).toContain('Currently assigned: No technician assigned');
  });
});

describe('observer approval summary', () => {
  it('names the observer being added and the observers already on the ticket', () => {
    const summary = actionUpdateSummary(action({
      capability_name: 'ticketing.ticket.participant_update.approved',
      action_payload_json: {
        operation: 'add_observer',
        participants: [{ kind: 'group', key: '12', label: 'SAP-team' }],
        current: {
          observerTargets: [{ kind: 'user', key: '21', label: 'Marie Dupont' }],
          observers: ['Marie Dupont'],
        },
        reason: 'Keep SAP informed.',
      },
    }));
    expect(summary).toContain('Observer update');
    expect(summary).toContain('Add observer: SAP-team');
    expect(summary).toContain('Current observers: Marie Dupont');
    expect(summary).toContain('Reason: Keep SAP informed.');
  });

  it('says so when the ticket has no observer yet', () => {
    const summary = actionUpdateSummary(action({
      capability_name: 'ticketing.ticket.participant_update.approved',
      action_payload_json: {
        participants: [{ kind: 'user', key: '21', label: 'Marie Dupont' }],
        current: { observers: [] },
      },
    }));
    expect(summary).toContain('Add observer: Marie Dupont');
    expect(summary).toContain('Current observers: No observers');
  });
});
