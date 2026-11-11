import * as assert from 'node:assert/strict';
import {
  ADMINISTRATIVE_REPLY_INTENT_INSTRUCTIONS,
  AiReplySynthesisService,
  synthesisWritesTechnicianBrief,
} from '../ai-reply-synthesis.service';
import { AiAgentActionPlannerService } from '../ai-agent-action-planner.service';
import { estimateTicketEvidenceExtractionUsage, ticketAttachmentRefs } from '../ai-ticket-evidence-extraction.service';
import {
  buildTicketTimeline,
  evaluateConversationGate,
  renderSynthesizedTriageNote,
} from '../agent-control-timeline-synthesis.util';
import {
  buildFallbackKnowledgeSearchPlan,
  buildWebSearchQueryCandidates,
  knowledgeDocumentFromOutput,
  knowledgeItemsFromOutput,
} from '../agent-control-knowledge.util';
import type { TicketNoteLike, TicketTimelineEntry } from '../ai-agent-control.service';
import { AiTicketNeedRepresentationService } from '../ai-ticket-need-representation.service';
import { AiKnowledgeSearchPlannerService } from '../ai-knowledge-search-planner.service';
import { readAgentKnowledgeSources } from '../agent-control-definition.util';
import {
  ADMINISTRATIVE_REPLY_INTENT_USES,
  ADMINISTRATIVE_REPLY_INTENTS,
  administrativeReplyIntent,
  citableKnowledgeDocuments,
} from '../public-reply-sources';
import { AiCapabilityRegistry } from '../../capability/ai-capability.registry';

/**
 * A public reply reads the public items of the ticket and the documents of the libraries the
 * agent may cite. An internal note proposed to a technician reads every item of the ticket.
 */

const INTERNAL_MARKER = 'marker-alpha-4417';
const UNMARKED_MARKER = 'marker-bravo-2208';
const LIBRARY_MARKER = 'marker-charlie-9031';
const CITABLE_LIBRARY = '11111111-1111-4111-8111-111111111111';
const OTHER_LIBRARY = '22222222-2222-4222-8222-222222222222';

const ticket = {
  id: '42',
  title: 'Printer on floor 2',
  description: 'The printer on floor 2 does not print.',
};

function notes(): TicketNoteLike[] {
  return [
    {
      id: '1',
      visibility: 'public',
      authorRole: 'requester',
      body: 'I restarted the printer this morning.',
      createdAt: '2026-11-01T08:00:00.000Z',
    },
    {
      id: '2',
      visibility: 'internal',
      authorRole: 'support',
      body: `Technician follow-up ${INTERNAL_MARKER}.`,
      createdAt: '2026-11-01T09:00:00.000Z',
    },
    {
      // An adapter that does not say whether the message is public.
      id: '3',
      authorRole: 'unknown',
      body: `Follow-up ${UNMARKED_MARKER}.`,
      createdAt: '2026-11-01T10:00:00.000Z',
    } as unknown as TicketNoteLike,
  ];
}

function timeline() {
  return buildTicketTimeline(ticket, notes(), new Set());
}

function structuredJson(value: unknown) {
  return {
    ok: true,
    value,
    text: JSON.stringify(value),
    runtime: {
      source: 'custom',
      provider: null,
      providerId: 'test-provider',
      model: 'test-model',
      apiKey: null,
      endpointUrl: null,
      modelConfigId: null,
      supportsVision: true,
      modelTimeoutMs: null,
      priceInputEurPerMtok: 2,
      priceOutputEurPerMtok: 2,
    },
    usage: null,
    latencyMs: 1,
    metadata: { taskName: 'test', attempts: [], failure: null },
  };
}

function testAPublicReplyReadsThePublicItemsOfTheTicket() {
  const payload = new AiReplySynthesisService({} as any).buildPromptPayload({
    ticket,
    timeline: timeline(),
    language: 'en',
    knowledgeDocs: [],
    webResults: [],
  });
  const text = JSON.stringify(payload);
  assert.ok(text.includes('I restarted the printer this morning.'));
  assert.ok(!text.includes(INTERNAL_MARKER));
  assert.ok(!text.includes(UNMARKED_MARKER));
  // The technician brief reads the internal items: another call writes it.
  assert.equal('technician_brief' in (payload.schema as Record<string, unknown>), false);
}

const BRIEF_MARKER = 'marker-india-1184';

function replyResult(overrides: Record<string, unknown> = {}) {
  return {
    language: 'en',
    usable: true,
    needs_human_review: false,
    requester_reply: 'Restart the print spooler.',
    technician_brief: `Brief from the reply call ${BRIEF_MARKER}.`,
    used_sources: [{ kind: 'knowledge', ref: 'DOC-1', url: null, title: 'Printer guide' }],
    rejected_sources: [],
    confidence: 0.8,
    ...overrides,
  };
}

const printerGuide = [{ ref: 'DOC-1', title: 'Printer guide', content_markdown: 'Restart the print spooler.' }];

async function testATicketWithInternalItemsGetsItsBriefFromAnotherCall() {
  const service = new AiReplySynthesisService({
    callStructuredJsonModel: async () => structuredJson(replyResult()),
  } as any);
  const reply = await service.synthesizeTicketReply({} as any, {
    ticket,
    timeline: timeline(),
    language: 'en',
    knowledgeDocs: printerGuide,
    webResults: [],
  });
  assert.equal(reply.requester_reply, 'Restart the print spooler.');
  assert.equal(reply.technician_brief, '');
  assert.equal(synthesisWritesTechnicianBrief(timeline()), false);
}

async function testATicketWithoutInternalItemsKeepsOneCall() {
  const publicOnly = timeline().filter((entry) => entry.visibility === 'public');
  assert.equal(synthesisWritesTechnicianBrief(publicOnly), true);
  const service = new AiReplySynthesisService({
    callStructuredJsonModel: async () => structuredJson(replyResult()),
  } as any);
  const payload = service.buildPromptPayload({ ticket, timeline: publicOnly, language: 'en', knowledgeDocs: printerGuide, webResults: [] });
  assert.equal(payload.task, 'Compose a grounded helpdesk requester reply and technician brief.');
  assert.ok('technician_brief' in (payload.schema as Record<string, unknown>));
  const reply = await service.synthesizeTicketReply({} as any, {
    ticket,
    timeline: publicOnly,
    language: 'en',
    knowledgeDocs: printerGuide,
    webResults: [],
  });
  assert.equal(reply.technician_brief, `Brief from the reply call ${BRIEF_MARKER}.`);
}

async function testTheTechnicianBriefReadsEveryItemOfTheTicket() {
  const calls: Array<{ taskName: string; payload: unknown }> = [];
  const service = new AiReplySynthesisService({
    callStructuredJsonModel: async (_context: unknown, options: { taskName: string; userPayload: unknown }) => {
      calls.push({ taskName: options.taskName, payload: options.userPayload });
      return structuredJson({ technician_brief: 'The requester restarted the printer; see the internal follow-up.' });
    },
  } as any);
  const brief = await service.composeTechnicianBrief({} as any, {
    ticket,
    timeline: timeline(),
    language: 'en',
    knowledgeDocs: printerGuide,
    webResults: [],
    reply: replyResult({ technician_brief: '' }) as any,
  });
  assert.equal(brief.technician_brief, 'The requester restarted the printer; see the internal follow-up.');
  assert.deepEqual(calls.map((call) => call.taskName), ['technician_brief']);
  const text = JSON.stringify(calls[0].payload);
  assert.ok(text.includes(INTERNAL_MARKER));
  assert.ok(text.includes(UNMARKED_MARKER));
  assert.ok(text.includes('Restart the print spooler.'));
}

function testAMessageNotMarkedPublicIsInternal() {
  const entry = timeline().find((candidate) => candidate.id === 'followup:3');
  assert.equal(entry?.visibility, 'internal');
  assert.notEqual(entry?.actor, 'requester_candidate');
}

function testAnInternalNoteReadsEveryItemOfTheTicket() {
  const note = renderSynthesizedTriageNote(ticket, timeline(), {
    language: 'en',
    usable: false,
    needs_human_review: true,
    requester_reply: '',
    technician_brief: 'Brief.',
    used_sources: [],
    rejected_sources: [],
    confidence: null,
    model: 'test:test',
    usage: null,
    estimated_tokens: 0,
    estimated_cost_eur: 0,
    latency_ms: 0,
    fallback_reason: null,
  });
  assert.ok(note.includes(INTERNAL_MARKER));
}

function testTheActionPlannerReadsEveryItemOfTheTicket() {
  const payload = new AiAgentActionPlannerService({} as any).buildPromptPayload({
    ticket,
    timeline: timeline(),
    contexts: { classification: null, lifecycle: null, routing: null, participants: null },
    gates: {},
    close_eligibility: { matched: false, has_inactivity_age: false, terminal: false },
    owned_action_types: [],
    granted_capabilities: [],
    verbatim_candidates: [],
  } as any);
  const text = JSON.stringify(payload);
  assert.ok(text.includes('I restarted the printer this morning.'));
  assert.ok(text.includes(INTERNAL_MARKER));
  assert.ok(text.includes(UNMARKED_MARKER));
  // The planner decides; it writes no text for the requester.
  const [actionSchema] = (payload.schema as { actions: Array<Record<string, unknown>> }).actions;
  assert.equal('body' in actionSchema, false);
}

const PLANNER_TEXT_MARKER = 'marker-hotel-3390';

async function testAnAdministrativeReplyReadsThePublicItemsOfTheTicket() {
  const payloads: unknown[] = [];
  const service = new AiReplySynthesisService({
    callStructuredJsonModel: async (_context: unknown, options: { taskName: string; userPayload: unknown }) => {
      payloads.push(options.userPayload);
      assert.equal(options.taskName, 'administrative_reply');
      return structuredJson({ language: 'en', requester_reply: 'Your request is in our queue.' });
    },
  } as any);
  const draft = await service.draftAdministrativeReply({} as any, {
    ticket,
    timeline: timeline(),
    language: 'en',
    intent: 'acknowledgement',
    // A caller handing over free text of the planner: the payload leaves it out.
    reason: `Planner reasoning ${PLANNER_TEXT_MARKER}`,
  } as any);
  assert.equal(draft.requester_reply, 'Your request is in our queue.');
  const text = JSON.stringify(payloads[0]);
  assert.ok(text.includes('I restarted the printer this morning.'));
  assert.ok(!text.includes(INTERNAL_MARKER));
  assert.ok(!text.includes(UNMARKED_MARKER));
  assert.ok(!text.includes(PLANNER_TEXT_MARKER));
  assert.equal((payloads[0] as Record<string, unknown>).reply_intent, 'acknowledgement');
}

async function testAnAdministrativeReplyKindComesFromAClosedList() {
  assert.deepEqual([...ADMINISTRATIVE_REPLY_INTENTS], [
    'close_reply',
    'acknowledgement',
    'request_information',
    'awaiting_requester',
    'escalation_notice',
    'resolution_confirmation',
  ]);
  assert.equal(administrativeReplyIntent('close_reply'), 'close_reply');
  assert.equal(administrativeReplyIntent(`Tell the requester ${PLANNER_TEXT_MARKER}`), null);
  assert.equal(administrativeReplyIntent('other'), null);
  assert.equal(administrativeReplyIntent(null), null);
  // A value outside the list writes nothing: no model call.
  for (const intent of [`Tell the requester ${PLANNER_TEXT_MARKER}`, 'other', null, undefined]) {
    let calls = 0;
    const service = new AiReplySynthesisService({
      callStructuredJsonModel: async () => {
        calls += 1;
        return structuredJson({ language: 'en', requester_reply: 'Hello.' });
      },
    } as any);
    await assert.rejects(service.draftAdministrativeReply({} as any, {
      ticket,
      timeline: timeline(),
      language: 'en',
      intent: intent as any,
    }));
    assert.equal(calls, 0, `no call for ${String(intent)}`);
  }
}

async function testEachAdministrativeIntentHasItsFixedInstruction() {
  for (const intent of ADMINISTRATIVE_REPLY_INTENTS) {
    const payloads: Array<Record<string, unknown>> = [];
    const service = new AiReplySynthesisService({
      callStructuredJsonModel: async (_context: unknown, options: { userPayload: Record<string, unknown> }) => {
        payloads.push(options.userPayload);
        return structuredJson({ language: 'en', requester_reply: 'Hello.' });
      },
    } as any);
    await service.draftAdministrativeReply({} as any, {
      ticket,
      timeline: timeline(),
      language: 'en',
      intent,
      reason: `Planner reasoning ${PLANNER_TEXT_MARKER}`,
      rationale: `Planner rationale ${PLANNER_TEXT_MARKER}`,
    } as any);
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].reply_intent, intent);
    assert.equal(payloads[0].reply_intent_instruction, ADMINISTRATIVE_REPLY_INTENT_INSTRUCTIONS[intent]);
    const text = JSON.stringify(payloads[0]);
    assert.ok(!text.includes(PLANNER_TEXT_MARKER), `${intent}: nothing from the planner`);
    assert.ok(!text.includes(INTERNAL_MARKER), `${intent}: no internal item`);
  }
}

async function testTheShortTextsReserveTheOutputOfTheirNeighbours() {
  const options: Array<{ taskName: string; maxTokens: number; maxTokensEnvName: string }> = [];
  const service = new AiReplySynthesisService({
    callStructuredJsonModel: async (_context: unknown, request: { taskName: string; maxTokens: number; maxTokensEnvName: string }) => {
      options.push(request);
      return structuredJson({ technician_brief: 'Brief.', language: 'en', requester_reply: 'Hello.' });
    },
  } as any);
  await service.composeTechnicianBrief({} as any, {
    ticket, timeline: timeline(), language: 'en', knowledgeDocs: [], webResults: [], reply: replyResult() as any,
  });
  await service.draftAdministrativeReply({} as any, { ticket, timeline: timeline(), language: 'en', intent: 'acknowledgement' });
  // Same reserve as the knowledge planner and interpreter, which write outputs of the same size.
  assert.deepEqual(options.map((option) => [option.taskName, option.maxTokens, option.maxTokensEnvName]), [
    ['technician_brief', 4000, 'AI_AGENT_TECHNICIAN_BRIEF_MAX_TOKENS'],
    ['administrative_reply', 4000, 'AI_AGENT_ADMINISTRATIVE_REPLY_MAX_TOKENS'],
  ]);
  assert.equal(service.technicianBriefMaxOutputTokens(), 4000);
  assert.equal(service.administrativeReplyMaxOutputTokens(), 4000);
  assert.equal(service.maxOutputTokens(), 8000);
}

function testThePlannerKnowsWhenToChooseEachIntent() {
  const payload = new AiAgentActionPlannerService({} as any).buildPromptPayload({
    ticket,
    timeline: timeline(),
    contexts: { classification: null, lifecycle: null, routing: null, participants: null },
    gates: {},
    close_eligibility: { matched: false, has_inactivity_age: false, terminal: false },
    owned_action_types: ['requester_reply'],
    granted_capabilities: [],
    verbatim_candidates: [],
  } as any);
  assert.deepEqual(Object.keys(payload.administrative_intents as Record<string, string>), [...ADMINISTRATIVE_REPLY_INTENTS]);
  assert.deepEqual(payload.administrative_intents, ADMINISTRATIVE_REPLY_INTENT_USES);
  const [actionSchema] = (payload.schema as { actions: Array<Record<string, unknown>> }).actions;
  assert.match(String(actionSchema.administrative_intent), /^required when reply_kind=administrative/);
}

async function testAnAdministrativeReplyKeepsThePublicReplyGuards() {
  const service = new AiReplySynthesisService({
    callStructuredJsonModel: async () => structuredJson({
      language: 'en',
      requester_reply: 'Note that the escalation desk works only on weekdays from 8 to 18.',
    }),
  } as any);
  const draft = await service.draftAdministrativeReply({} as any, {
    ticket,
    timeline: timeline(),
    language: 'en',
    intent: 'acknowledgement',
    profile: {
      task: 'synthesis',
      operating_context: { profile_id: 'p', name: 'Desk', lines: ['the escalation desk works only on weekdays from 8 to 18'] },
      bounds_applied: [],
    },
  });
  assert.equal(draft.requester_reply, '');
  assert.equal(draft.fallback_reason, 'operating_context_leak');
}

function testScreenshotsOfInternalNotesStayOutOfThePublicReply() {
  const image = (id: string, noteId: string) => ({
    id,
    kind: 'image' as const,
    source: 'ticket_note' as const,
    sourceNoteId: noteId,
    target: `Document/${id}`,
    mimeType: 'image/png',
  });
  const [publicNote, internalNote, unmarkedNote] = notes();
  const usage = estimateTicketEvidenceExtractionUsage({
    systemPrompt: '',
    ticket: { id: ticket.id, attachments: [] },
    notes: [
      { ...publicNote, attachments: [image('10', '1')] },
      { ...internalNote, attachments: [image('20', '2')] },
      { ...unmarkedNote, attachments: [image('30', '3')] },
    ],
    maxImages: 5,
  }, null);
  assert.equal(usage.attachmentCount, 1);
  // The list the triage keeps when the extraction does not run holds the same screenshots.
  const refs = ticketAttachmentRefs({
    ticket: { attachments: [{ ...image('5', ''), source: 'ticket_description' as const, sourceNoteId: null }] },
    notes: [
      { ...publicNote, attachments: [image('10', '1')] },
      { ...internalNote, attachments: [image('20', '2')] },
      { ...unmarkedNote, attachments: [image('30', '3')] },
    ],
  });
  assert.deepEqual(refs.map((ref) => ref.id), ['5', '10']);
}

function testKnowledgeItemsKeepTheirLibrary() {
  const [item] = knowledgeItemsFromOutput({
    items: [{ id: 'd2', ref: 'DOC-2', title: 'Doc', library: { id: OTHER_LIBRARY, name: 'Other' } }],
  });
  assert.equal(item.library_id, OTHER_LIBRARY);
  const document = knowledgeDocumentFromOutput({ id: 'd2', ref: 'DOC-2' }, {
    id: 'd2',
    ref: 'DOC-2',
    content_markdown: 'Body',
    library: { id: OTHER_LIBRARY },
  });
  assert.equal(document?.library_id, OTHER_LIBRARY);
}

async function testAPublicReplyCitesTheLibrariesTheAgentMayCite() {
  const payloads: unknown[] = [];
  const service = new AiReplySynthesisService({
    callStructuredJsonModel: async (_context: unknown, options: { userPayload: unknown }) => {
      payloads.push(options.userPayload);
      return structuredJson({
        language: 'en',
        usable: true,
        needs_human_review: false,
        requester_reply: 'Restart the print spooler.',
        technician_brief: 'Brief.',
        used_sources: [
          { kind: 'knowledge', ref: 'DOC-1', url: null, title: 'Printer guide' },
          { kind: 'knowledge', ref: 'DOC-2', url: null, title: 'Other guide' },
          { kind: 'knowledge', ref: 'DOC-3', url: null, title: 'Guide without library' },
        ],
        rejected_sources: [],
        confidence: 0.8,
      });
    },
  } as any);
  const input = {
    ticket,
    timeline: timeline(),
    language: 'en',
    knowledgeDocs: [
      { ref: 'DOC-1', title: 'Printer guide', content_markdown: 'Restart the print spooler.', library_id: CITABLE_LIBRARY },
      { ref: 'DOC-2', title: 'Other guide', content_markdown: `Procedure ${LIBRARY_MARKER}.`, library_id: OTHER_LIBRARY },
      { ref: 'DOC-3', title: 'Guide without library', content_markdown: `Procedure ${LIBRARY_MARKER}.` },
    ],
    webResults: [],
  };

  const restricted = await service.synthesizeTicketReply({} as any, { ...input, citableLibraryIds: [CITABLE_LIBRARY] });
  assert.ok(!JSON.stringify(payloads[0]).includes(LIBRARY_MARKER));
  assert.deepEqual(restricted.used_sources.map((source) => source.ref), ['DOC-1']);
  assert.ok(!JSON.stringify(service.buildPromptPayload({ ...input, citableLibraryIds: [CITABLE_LIBRARY] })).includes(LIBRARY_MARKER));

  // An agent set to cite every library it reads keeps every document it found.
  const open = await service.synthesizeTicketReply({} as any, { ...input, citableLibraryIds: null });
  assert.deepEqual(open.used_sources.map((source) => source.ref), ['DOC-1', 'DOC-2', 'DOC-3']);
}

async function testAnAgentWithoutLibrariesCitesNoDocument() {
  const agent = (knowledge: Record<string, unknown>) => ({
    scope_policy_json: { knowledge_sources: { knowledge: { enabled: true, ...knowledge } } },
  }) as any;
  const none = readAgentKnowledgeSources(agent({ all_libraries: false, library_ids: [] })).knowledgeLibraryIds;
  assert.deepEqual(none, []);
  const documents = [{ ref: 'DOC-1', library_id: CITABLE_LIBRARY }, { ref: 'DOC-2', library_id: null }];
  assert.deepEqual(citableKnowledgeDocuments(documents, none), []);
  assert.deepEqual(readAgentKnowledgeSources(agent({ all_libraries: false, library_ids: [CITABLE_LIBRARY] })).knowledgeLibraryIds, [CITABLE_LIBRARY]);
  assert.equal(readAgentKnowledgeSources(agent({ all_libraries: true, library_ids: [] })).knowledgeLibraryIds, null);
  assert.equal(readAgentKnowledgeSources(null).knowledgeLibraryIds, null);

  // The search reads the same setting: an empty library list finds nothing.
  let searched = false;
  const registry = Object.create(AiCapabilityRegistry.prototype) as any;
  registry.policy = { assertKnowledgeReadAccess: async () => undefined };
  registry.knowledge = {
    search: async () => {
      searched = true;
      return { items: [{ id: 'd1', item_number: 1, title: 'Doc', library_id: CITABLE_LIBRARY }], total: 1 };
    },
  };
  const empty = await registry.searchKnowledgeInternal({ manager: {}, userId: 'user' }, { query: 'printer', library_ids: [] });
  assert.equal(searched, false);
  assert.deepEqual(empty.items, []);
  const open = await registry.searchKnowledgeInternal({ manager: {}, userId: 'user' }, { query: 'printer' });
  assert.equal(searched, true);
  assert.equal(open.items.length, 1);
}

const AGENT_NOTE_MARKER = 'marker-delta-6604';

// A whole timeline, internal items included, as a caller could hand it over.
function wholeTimeline(): TicketTimelineEntry[] {
  const entry = (id: string, visibility: 'public' | 'internal', actor: TicketTimelineEntry['actor'], body: string): TicketTimelineEntry => ({
    id,
    kind: 'followup',
    visibility,
    actor,
    actorSource: actor === 'kanap_agent' ? 'kanap_marker' : 'provider_requester_user',
    actorId: null,
    body,
    createdAt: `2026-11-01T0${id}:00:00.000Z`,
    updatedAt: null,
    updateFingerprint: null,
  });
  return [
    entry('1', 'public', 'requester_candidate', 'The printer spooler stopped on floor two.'),
    entry('2', 'public', 'kanap_agent', 'Please restart the printer spooler service.'),
    entry('3', 'internal', 'kanap_agent', `Triage note ${AGENT_NOTE_MARKER} for the technician.`),
    entry('4', 'internal', 'requester_candidate', `Private message ${INTERNAL_MARKER} spooler.`),
  ];
}

function assertNoInternalMarker(value: unknown, label: string) {
  const text = JSON.stringify(value);
  assert.ok(!text.includes(INTERNAL_MARKER), `${label} reads an internal note`);
  assert.ok(!text.includes(AGENT_NOTE_MARKER), `${label} reads the agent's internal note`);
}

async function testTheNeedAndTheSearchesReadThePublicItemsOfTheTicket() {
  const timeline = wholeTimeline();
  const need = new AiTicketNeedRepresentationService({} as any);
  const needPayload = need.buildPromptPayload({ ticket, timeline });
  assertNoInternalMarker(needPayload, 'need payload');
  assert.ok(JSON.stringify(needPayload).includes('Please restart the printer spooler service.'));
  assertNoInternalMarker(need.buildDeterministicNeedRepresentation({ ticket, timeline }), 'deterministic need');

  const payloads: unknown[] = [];
  const planner = new AiKnowledgeSearchPlannerService({
    callStructuredJsonModel: async (_context: unknown, options: { userPayload: unknown }) => {
      payloads.push(options.userPayload);
      return null;
    },
  } as any);
  const plan = await planner.planKnowledgeSearch({} as any, { ticket, timeline });
  assertNoInternalMarker(plan, 'search plan');
  assertNoInternalMarker(payloads[0], 'search plan payload');
  const interpretation = await planner.interpretKnowledgeResults({} as any, {
    plan,
    ticket,
    timeline,
    candidates: [{ ref: 'DOC-1', title: 'Spooler', summary: null, snippet: null, status: 'published', search_queries: ['spooler'] }],
  });
  assertNoInternalMarker(interpretation, 'search interpretation');
  assertNoInternalMarker(payloads[1], 'search interpretation payload');

  assertNoInternalMarker(buildFallbackKnowledgeSearchPlan(ticket, timeline, []), 'fallback search plan');
  assertNoInternalMarker(buildWebSearchQueryCandidates(ticket, timeline, []), 'web queries');
}

function testRequesterSignalsComeFromThePublicItemsOfTheTicket() {
  const requesterNotes: TicketNoteLike[] = [
    ...notes(),
    {
      id: '4',
      visibility: 'internal',
      authorRole: 'requester',
      body: `Private message ${INTERNAL_MARKER}.`,
      createdAt: '2026-11-01T11:00:00.000Z',
    },
  ];
  const gate = evaluateConversationGate([], buildTicketTimeline(ticket, requesterNotes, new Set()), requesterNotes);
  assert.equal(gate.latest_requester_message_id, 'followup:1');
  assert.equal(gate.latest_requester_message_at, '2026-11-01T08:00:00.000Z');
}

async function run() {
  const tests: Array<() => unknown> = [
    testAPublicReplyReadsThePublicItemsOfTheTicket,
    testATicketWithInternalItemsGetsItsBriefFromAnotherCall,
    testATicketWithoutInternalItemsKeepsOneCall,
    testTheTechnicianBriefReadsEveryItemOfTheTicket,
    testAMessageNotMarkedPublicIsInternal,
    testAnInternalNoteReadsEveryItemOfTheTicket,
    testTheActionPlannerReadsEveryItemOfTheTicket,
    testAnAdministrativeReplyReadsThePublicItemsOfTheTicket,
    testAnAdministrativeReplyKindComesFromAClosedList,
    testEachAdministrativeIntentHasItsFixedInstruction,
    testThePlannerKnowsWhenToChooseEachIntent,
    testTheShortTextsReserveTheOutputOfTheirNeighbours,
    testAnAdministrativeReplyKeepsThePublicReplyGuards,
    testScreenshotsOfInternalNotesStayOutOfThePublicReply,
    testKnowledgeItemsKeepTheirLibrary,
    testAPublicReplyCitesTheLibrariesTheAgentMayCite,
    testAnAgentWithoutLibrariesCitesNoDocument,
    testTheNeedAndTheSearchesReadThePublicItemsOfTheTicket,
    testRequesterSignalsComeFromThePublicItemsOfTheTicket,
  ];
  let failures = 0;
  for (const test of tests) {
    try {
      await test();
      console.log(`ok ${test.name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${test.name}`, error);
    }
  }
  if (failures > 0) process.exit(1);
}

void run();
