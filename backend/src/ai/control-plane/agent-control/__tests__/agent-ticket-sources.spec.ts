import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AiReplySynthesisService } from '../ai-reply-synthesis.service';
import { AiAgentActionPlannerService } from '../ai-agent-action-planner.service';
import { estimateTicketEvidenceExtractionUsage } from '../ai-ticket-evidence-extraction.service';
import {
  buildTicketTimeline,
  evaluateConversationGate,
  renderSynthesizedTriageNote,
} from '../agent-control-timeline-synthesis.util';
import { knowledgeDocumentFromOutput, knowledgeItemsFromOutput } from '../agent-control-knowledge.util';
import type { TicketNoteLike } from '../ai-agent-control.service';
import { AiKnowledgeSearchPlannerService } from '../ai-knowledge-search-planner.service';
import { newAgentScopePolicy, normalizeKnowledgeSources, readAgentKnowledgeSources } from '../agent-control-definition.util';
import { citableKnowledgeDocuments, conversationGateTheAgentReads, ticketItemsTheAgentReads } from '../agent-ticket-sources';
import {
  INTERNAL_NOTES_LINE,
  RUNTIME_SAFETY_FLOOR_ACTION_PLANNER,
  RUNTIME_SAFETY_FLOOR_ADMINISTRATIVE_REPLY,
  RUNTIME_SAFETY_FLOOR_SYNTHESIS,
  RUNTIME_SAFETY_FLOOR_TECHNICIAN_BRIEF,
} from '../ai-agent-prompt-compiler.service';
import { helpdeskAgentDefaults } from '../../agent/agent-definition-defaults';
import { AiCapabilityRegistry } from '../../capability/ai-capability.registry';

/**
 * What a service desk agent reads of a ticket. With its internal notes setting at "used" (or
 * absent), the searches, the action planner and the brief to the technician read every item of
 * the ticket; at "ignored", the public items only. A reply to the requester is written on the
 * public items only. An item the ticketing system does not mark public is internal. A reply cites
 * the documents of the libraries the agent may cite.
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

function testAMessageNotMarkedPublicIsInternal() {
  const entry = timeline().find((candidate) => candidate.id === 'followup:3');
  assert.equal(entry?.visibility, 'internal');
  assert.notEqual(entry?.actor, 'requester_candidate');
}

function testTheSettingDecidesWhatTheAgentReads() {
  const items = timeline();
  const used = JSON.stringify(ticketItemsTheAgentReads(items, 'used'));
  assert.ok(used.includes(INTERNAL_MARKER));
  assert.ok(used.includes(UNMARKED_MARKER));
  const ignored = ticketItemsTheAgentReads(items, 'ignored');
  assert.ok(ignored.length > 0);
  assert.ok(ignored.every((item) => item.visibility === 'public'));
  assert.ok(!JSON.stringify(ignored).includes(INTERNAL_MARKER));
  assert.ok(!JSON.stringify(ignored).includes(UNMARKED_MARKER), 'an item not marked public is internal');
  // The same rule for the raw messages, which carry the screenshots.
  assert.deepEqual(ticketItemsTheAgentReads(notes(), 'ignored').map((note) => note.id), ['1']);
  assert.deepEqual(ticketItemsTheAgentReads(notes(), 'used').map((note) => note.id), ['1', '2', '3']);
}

// The model calls read the items they are given: the triage gives them the items the agent reads.
async function testEachModelCallReadsTheItemsItIsGiven() {
  const items = buildTicketTimeline(ticket, [
    ...notes(),
    {
      id: '4',
      visibility: 'internal',
      authorRole: 'requester',
      body: `Private message ${INTERNAL_MARKER}.`,
      createdAt: '2026-11-01T11:00:00.000Z',
    },
  ], new Set());
  const synthesis = new AiReplySynthesisService({} as any).buildPromptPayload({
    ticket,
    timeline: items,
    language: 'en',
    knowledgeDocs: [],
    webResults: [],
  });
  assert.ok(JSON.stringify(synthesis).includes(INTERNAL_MARKER), 'synthesis');
  const planner = new AiAgentActionPlannerService({} as any).buildPromptPayload({
    ticket,
    timeline: items,
    contexts: { classification: null, lifecycle: null, routing: null, participants: null },
    gates: {},
    close_eligibility: { matched: false, has_inactivity_age: false, terminal: false },
    owned_action_types: [],
    granted_capabilities: [],
    verbatim_candidates: [],
  } as any);
  assert.ok(JSON.stringify(planner).includes(INTERNAL_MARKER), 'action planner');

  const payloads: unknown[] = [];
  const searchPlanner = new AiKnowledgeSearchPlannerService({
    callStructuredJsonModel: async (_context: unknown, options: { userPayload: unknown }) => {
      payloads.push(options.userPayload);
      return null;
    },
  } as any);
  const plan = await searchPlanner.planKnowledgeSearch({} as any, { ticket, timeline: items });
  await searchPlanner.interpretKnowledgeResults({} as any, {
    plan,
    ticket,
    timeline: items,
    candidates: [{ ref: 'DOC-1', title: 'Printer', summary: null, snippet: null, status: 'published', search_queries: ['printer'] }],
  });
  assert.ok(JSON.stringify(payloads[0]).includes(INTERNAL_MARKER), 'search planner');
  assert.ok(JSON.stringify(payloads[1]).includes(INTERNAL_MARKER), 'interpreter');
}

function testScreenshotsFollowTheMessagesTheAgentReads() {
  const image = (id: string, noteId: string) => ({
    id,
    kind: 'image' as const,
    source: 'ticket_note' as const,
    sourceNoteId: noteId,
    target: `Document/${id}`,
    mimeType: 'image/png',
  });
  const withImages = () => {
    const [publicNote, internalNote, unmarkedNote] = notes();
    return [
      { ...publicNote, attachments: [image('10', '1')] },
      { ...internalNote, attachments: [image('20', '2')] },
      { ...unmarkedNote, attachments: [image('30', '3')] },
    ];
  };
  const count = (setting: 'used' | 'ignored') => estimateTicketEvidenceExtractionUsage({
    systemPrompt: '',
    ticket: { id: ticket.id, attachments: [] },
    notes: ticketItemsTheAgentReads(withImages(), setting),
    maxImages: 5,
  }, null).attachmentCount;
  assert.equal(count('used'), 3);
  assert.equal(count('ignored'), 1);
}

function testTheConversationGateReadsTheWholeThread() {
  // A guard that passes nothing to a model: it reads every item, whatever the setting.
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
  assert.equal(gate.latest_requester_message_id, 'followup:4');
}

function testThePlannerReadsTheGateWithoutFingerprintsWhenNotesAreIgnored() {
  const gate = evaluateConversationGate([], timeline(), notes());
  // The latest message is the unmarked one: its fingerprint holds its text.
  assert.ok(String(gate.latest_ticket_note_fingerprint).includes(UNMARKED_MARKER));
  assert.deepEqual(conversationGateTheAgentReads(gate, 'used'), { ...gate });
  const ignored = conversationGateTheAgentReads(gate, 'ignored');
  assert.ok(!JSON.stringify(ignored).includes(UNMARKED_MARKER));
  assert.equal(ignored.can_prepare_public_reply, gate.can_prepare_public_reply);
  // What the gate decides and why, nothing else: no date, counter or identifier of the thread,
  // and a field added to the gate later stays out.
  assert.deepEqual(Object.keys(ignored).sort(), [
    'administrative_close_reply_reason',
    'can_prepare_administrative_close_reply',
    'can_prepare_internal_note',
    'can_prepare_public_reply',
    'can_prepare_sourced_answer',
    'internal_note_reason',
    'public_reply_reason',
    'sourced_answer_reason',
  ]);
  const later = conversationGateTheAgentReads({ ...gate, latest_internal_note_excerpt: UNMARKED_MARKER }, 'ignored');
  assert.ok(!('latest_internal_note_excerpt' in later));
  assert.ok('latest_internal_note_excerpt' in conversationGateTheAgentReads({ ...gate, latest_internal_note_excerpt: UNMARKED_MARKER }, 'used'));
}

function testTheInternalNoteIsBuiltFromTheItemsTheAgentReads() {
  const result = {
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
  };
  assert.ok(renderSynthesizedTriageNote(ticket, ticketItemsTheAgentReads(timeline(), 'used'), result).includes(INTERNAL_MARKER));
  assert.ok(!renderSynthesizedTriageNote(ticket, ticketItemsTheAgentReads(timeline(), 'ignored'), result).includes(INTERNAL_MARKER));
}

// The planner and the brief read internal items; the calls that write a reply to the requester
// never get any, so their prompt does not speak of them.
function testUsedInternalNotesAreExplainedToTheModels() {
  const line = INTERNAL_NOTES_LINE;
  assert.ok(RUNTIME_SAFETY_FLOOR_ACTION_PLANNER.includes(line));
  assert.ok(RUNTIME_SAFETY_FLOOR_TECHNICIAN_BRIEF.some((entry) => entry.includes('visibility "internal"')));
  for (const floor of [RUNTIME_SAFETY_FLOOR_SYNTHESIS, RUNTIME_SAFETY_FLOOR_ADMINISTRATIVE_REPLY]) {
    assert.ok(!floor.some((entry) => entry.includes('internal')));
  }
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

function definitionWithSources(sources: Record<string, unknown> | undefined) {
  return { scope_policy_json: sources === undefined ? {} : { knowledge_sources: sources } } as any;
}

function testInternalNotesAreUsedUnlessTheAgentIgnoresThem() {
  assert.equal(readAgentKnowledgeSources(null).internalNotes, 'used');
  assert.equal(readAgentKnowledgeSources(definitionWithSources(undefined)).internalNotes, 'used');
  assert.equal(readAgentKnowledgeSources(definitionWithSources({ knowledge: { enabled: true } })).internalNotes, 'used');
  assert.equal(readAgentKnowledgeSources(definitionWithSources({ internal_notes: 'used' })).internalNotes, 'used');
  assert.equal(readAgentKnowledgeSources(definitionWithSources({ internal_notes: 'ignored' })).internalNotes, 'ignored');
}

function testANewAgentUsesInternalNotesExplicitly() {
  assert.equal((newAgentScopePolicy({}).knowledge_sources as any).internal_notes, 'used');
  assert.equal((newAgentScopePolicy({ knowledge_sources: { internal_notes: 'ignored' } }).knowledge_sources as any).internal_notes, 'ignored');
  const defaults = helpdeskAgentDefaults({ ticketingProviderKey: 'glpi' });
  assert.equal((defaults.scope_policy_json.knowledge_sources as any).internal_notes, 'used');
}

function testAnUnknownInternalNotesValueIsRefused() {
  for (const value of ['public', '', null, true, 1]) {
    assert.throws(() => normalizeKnowledgeSources({ internal_notes: value }), BadRequestException, String(value));
    assert.throws(() => newAgentScopePolicy({ knowledge_sources: { internal_notes: value } }), BadRequestException);
  }
  assert.equal(normalizeKnowledgeSources({ internal_notes: 'ignored' }).internal_notes, 'ignored');
  assert.equal(normalizeKnowledgeSources({}).internal_notes, 'used');
}

async function run() {
  const tests: Array<() => unknown> = [
    testAMessageNotMarkedPublicIsInternal,
    testTheSettingDecidesWhatTheAgentReads,
    testEachModelCallReadsTheItemsItIsGiven,
    testScreenshotsFollowTheMessagesTheAgentReads,
    testTheConversationGateReadsTheWholeThread,
    testThePlannerReadsTheGateWithoutFingerprintsWhenNotesAreIgnored,
    testTheInternalNoteIsBuiltFromTheItemsTheAgentReads,
    testUsedInternalNotesAreExplainedToTheModels,
    testInternalNotesAreUsedUnlessTheAgentIgnoresThem,
    testANewAgentUsesInternalNotesExplicitly,
    testAnUnknownInternalNotesValueIsRefused,
    testKnowledgeItemsKeepTheirLibrary,
    testAPublicReplyCitesTheLibrariesTheAgentMayCite,
    testAnAgentWithoutLibrariesCitesNoDocument,
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
