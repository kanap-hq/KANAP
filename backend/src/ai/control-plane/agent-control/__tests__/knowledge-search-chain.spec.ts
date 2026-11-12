import * as assert from 'node:assert/strict';
import {
  applyKnowledgeInterpretation,
  knowledgeItemsFromOutput,
  mergeKnowledgeAttempts,
  plannerCandidatesFromKnowledge,
} from '../agent-control-knowledge.util';
import {
  buildTriageNote,
  isKanapMarkedBody,
  renderSynthesizedTriageNote,
  TriageNoteLanguage,
} from '../agent-control-timeline-synthesis.util';
import {
  AiKnowledgeSearchPlannerService,
  KnowledgePlannerCandidate,
  KnowledgeSearchPlan,
  MAX_INTERPRETER_BODY_LEAD_CANDIDATES,
  MAX_INTERPRETER_BODY_LEAD_CHARS,
  MAX_INTERPRETER_CANDIDATES,
  MAX_INTERPRETER_PASSAGE_CANDIDATES,
  MAX_INTERPRETER_PASSAGE_CHARS,
  MAX_INTERPRETER_PASSAGES_PER_CANDIDATE,
} from '../ai-knowledge-search-planner.service';
import { AiReplySynthesisService, MAX_SOURCE_PASSAGE_CHARS, MAX_SOURCE_PASSAGES } from '../ai-reply-synthesis.service';
import { AiTicketNeedRepresentationService, MAX_DERIVED_QUERIES } from '../ai-ticket-need-representation.service';
import type { TicketNeedRepresentation } from '../ai-ticket-need-representation.types';

/**
 * The chain of the support agent on knowledge documents (lot R1 of 26.11.8, tickets 94 to 96 of
 * the fromage tenant): what the interpreter reads of a document, the fallback results, the queries
 * in the languages of the documents, the frame of the internal note in the tenant's language.
 */

const plan: KnowledgeSearchPlan = {
  source: 'llm',
  need: null,
  intent: 'Imprimante d\'étiquettes en bourrage',
  language: 'fr',
  positive_terms: ['bourrage', 'imprimante'],
  negative_terms: [],
  queries: ['label printer jam'],
  rationale: null,
  confidence: null,
  model: null,
  warnings: [],
};
const ticket = { id: '94', title: 'Panne imprimante étiquettes', description: 'Je crois qu\'elle est en bourrage papier' };

function interpreterWith(respond: (payload: any) => unknown) {
  const payloads: any[] = [];
  const service = new AiKnowledgeSearchPlannerService({
    callStructuredJsonModel: async (_context: unknown, request: any) => {
      payloads.push(request.userPayload);
      return {
        ok: true,
        value: respond(request.userPayload),
        text: '{}',
        runtime: { providerId: 'test', model: 'interpreter' },
        usage: { input_tokens: 10, output_tokens: 10 },
        latencyMs: 1,
        metadata: { retry_attempted: false },
      };
    },
  } as any);
  return { service, payloads };
}

// The interpreter reads passages of the body within named bounds: 16 candidates at most, passages
// for the first 8 (3 of 480 characters each), the start of the body for 3 at most of those where
// no search word falls, the search snippet for the others.
async function testInterpreterPromptIsBounded() {
  const long = (label: string) => `${label} `.repeat(800);
  const candidates: KnowledgePlannerCandidate[] = Array.from({ length: 20 }, (_, index) => ({
    ref: `DOC-${index + 1}`,
    title: `Document ${index + 1}`,
    summary: long('summary'),
    snippet: long('snippet'),
    status: 'published',
    search_queries: ['label printer jam'],
    match_count: 1,
    score: 20 - index,
    passages: index % 2 === 0
      ? Array.from({ length: 8 }, () => long('passage'))
      : [long('lead')],
    passages_matched: index % 2 === 0,
  }));
  const { service, payloads } = interpreterWith(() => ({ selected_refs: [], rejected: [], confidence: 0.2, rationale: 'None.' }));
  await service.interpretKnowledgeResults({} as any, { plan, ticket, timeline: [], candidates });
  const shown = payloads[0].candidates as Array<Record<string, any>>;
  assert.equal(shown.length, MAX_INTERPRETER_CANDIDATES);
  let documentText = 0;
  let bodyStarts = 0;
  shown.forEach((candidate, index) => {
    const passages: string[] = candidate.body_passages ?? [];
    assert.ok(passages.length <= MAX_INTERPRETER_PASSAGES_PER_CANDIDATE);
    for (const passage of passages) assert.ok(passage.length <= MAX_INTERPRETER_PASSAGE_CHARS);
    if (index >= MAX_INTERPRETER_PASSAGE_CANDIDATES) {
      assert.equal(candidate.body_passages, undefined, `${candidate.ref} beyond the first 8 shows no passage`);
      assert.equal(candidate.body_start, undefined);
    }
    if (candidate.body_start) {
      bodyStarts += 1;
      assert.ok(candidate.body_start.length <= MAX_INTERPRETER_BODY_LEAD_CHARS);
    }
    documentText += String(candidate.summary ?? '').length
      + String(candidate.snippet ?? '').length
      + String(candidate.body_start ?? '').length
      + passages.reduce((total, passage) => total + passage.length, 0);
  });
  assert.equal(shown[0].body_passages.length, MAX_INTERPRETER_PASSAGES_PER_CANDIDATE, 'the first candidate shows its passages');
  assert.ok(bodyStarts > 0 && bodyStarts <= MAX_INTERPRETER_BODY_LEAD_CANDIDATES);
  assert.ok(documentText <= 18_240, `document text in the interpreter prompt: ${documentText}`);
}

// A result of the whole-word fallback keeps its mark, is shown as such to the interpreter, and
// never becomes an unvalidated source the reply may cite without the interpreter's selection.
async function testFallbackResultsAreCandidatesOnly() {
  const items = knowledgeItemsFromOutput({
    items: [
      { id: 'a', ref: 'DOC-1', title: 'Gouda', status: 'published', score: 0, fallback: true },
      { id: 'b', ref: 'DOC-2', title: 'Printer', status: 'published', score: 0.8, fallback: false },
    ],
    fallback: true,
  });
  assert.deepEqual(items.map((item) => item.fallback), [true, false]);
  const merged = mergeKnowledgeAttempts([
    { query: 'gouda', result: {} as any, items: [items[0]] },
    { query: 'printer', result: {} as any, items: [items[1]] },
  ]);
  const deterministic = applyKnowledgeInterpretation(merged, {
    source: 'deterministic', selected_refs: ['DOC-1', 'DOC-2'], rejected: [], facet_match: null, confidence: null,
    rationale: null, model: null, usage: null, estimated_tokens: 0, estimated_cost_eur: 0, latency_ms: null, warnings: [],
  });
  assert.deepEqual(deterministic.unvalidated.map((item) => item.ref), ['DOC-2'], 'a fallback result is no unvalidated source');
  const judged = applyKnowledgeInterpretation(merged, {
    source: 'llm', selected_refs: ['DOC-1'], rejected: [], facet_match: null, confidence: 0.7,
    rationale: null, model: null, usage: null, estimated_tokens: 0, estimated_cost_eur: 0, latency_ms: null, warnings: [],
  });
  assert.deepEqual(judged.selected.map((item) => item.ref), ['DOC-1'], 'the interpreter may select it after reading it');

  const { service, payloads } = interpreterWith(() => ({ selected_refs: ['DOC-2'], rejected: [], confidence: 0.7, rationale: 'Printer.' }));
  const interpretation = await service.interpretKnowledgeResults({} as any, {
    plan, ticket, timeline: [], candidates: plannerCandidatesFromKnowledge(merged),
  });
  const shown = payloads[0].candidates as Array<Record<string, unknown>>;
  assert.equal(shown.find((candidate) => candidate.ref === 'DOC-1')?.fallback, true);
  assert.equal(shown.find((candidate) => candidate.ref === 'DOC-2')?.fallback, undefined);
  // The model answered: the warning of the deterministic interpretation does not appear.
  assert.deepEqual(interpretation.warnings, []);
  assert.equal('needs_human_review' in interpretation, false);
}

const need = (overrides: Partial<TicketNeedRepresentation>): TicketNeedRepresentation => ({
  intent: 'Imprimante d\'étiquettes en bourrage papier',
  language: 'fr',
  entities: { applications: [], modules: [], screens: [], equipment: [], services: [] },
  symptoms: ['bourrage papier'],
  exact_codes: [],
  actions_attempted: [],
  context: { environment: [], version: [], site: [], role: [], os: [], browser: [], network: [] },
  constraints: { positive: [], negative: [] },
  evidence_refs: [],
  warnings: [],
  confidence: 0.7,
  search_terms: { en: [], fr: [], de: [], es: [] },
  ...overrides,
});

// The need step gives its terms in the four languages of the documents; the queries cover them,
// one per language, within the cap.
function testQueriesCoverTheLanguagesOfTheDocuments() {
  const builder = new AiTicketNeedRepresentationService({} as any);
  const derivation = builder.deriveKnowledgeQueries({
    need: need({
      exact_codes: Array.from({ length: 6 }, (_, index) => ({ value: `ERR-10${index}`, kind: 'error_code' as const, source: 'ticket_description' as const })),
      entities: { applications: ['Zebra'], modules: [], screens: [], equipment: [], services: [] },
      symptoms: ['bourrage papier', 'étiquettes froissées', 'voyant rouge', 'calibrage'],
      search_terms: {
        en: ['label printer', 'paper jam', 'printer jam'],
        fr: ['imprimante étiquettes', 'bourrage papier'],
        de: ['Etikettendrucker', 'Papierstau'],
        es: ['impresora de etiquetas', 'atasco de papel'],
      },
    }),
    fallbackTitle: ticket.title,
    fallbackDescription: ticket.description,
  });
  assert.ok(derivation.queries.length <= MAX_DERIVED_QUERIES);
  assert.equal(derivation.language_queries.length, 4);
  for (const word of ['jam', 'papierstau', 'atasco']) {
    assert.ok(derivation.queries.some((query) => query.toLocaleLowerCase().split(/\s+/).includes(word)), `a query carries ${word}`);
  }
  for (const query of derivation.language_queries) {
    const words = query.split(/\s+/);
    assert.equal(new Set(words).size, words.length, `a language query repeats no word: ${query}`);
    assert.ok(derivation.queries.includes(query), `${query} is searched despite the exact codes`);
  }
}

// A code that opens the ticket title (« R8 R1 VPN ») names the ticket, not an application: it
// prefixes no query. A name the description gives too stays one, as does a title without a code.
function testACodeOpeningTheTitleIsNoApplication() {
  const builder = new AiTicketNeedRepresentationService({} as any);
  const derive = (title: string, description: string, applications: string[]) => builder.deriveKnowledgeQueries({
    need: need({ entities: { applications, modules: [], screens: [], equipment: [], services: [] }, symptoms: ['connexion refusée'] }),
    fallbackTitle: title,
    fallbackDescription: description,
  });
  const coded = derive('R8 R1 VPN ter', 'Le VPN refuse ma connexion.', ['R8', 'R1', 'R8 R1 VPN', 'VPN']);
  for (const query of coded.queries) assert.doesNotMatch(query, /\bR[18]\b/i, `query ${query}`);
  assert.ok(coded.facet_queries.some((query) => query.startsWith('VPN ')), 'the application after the code stays one');

  const title = 'INC4521 Outlook plante';
  const deterministic = builder.buildDeterministicNeedRepresentation({ ticket: { id: '9', title, description: '' }, timeline: [] }).need;
  const fromDeterministic = builder.deriveKnowledgeQueries({ need: { ...deterministic, symptoms: ['plante'] }, fallbackTitle: title, fallbackDescription: '' });
  for (const query of fromDeterministic.facet_queries) assert.doesNotMatch(query, /INC4521/, `query ${query}`);
  assert.ok(fromDeterministic.facet_queries.some((query) => query.startsWith('Outlook ')));

  assert.ok(derive('X3 bloqué', 'Sage X3 ne répond plus depuis ce matin.', ['X3']).facet_queries.some((query) => query.startsWith('X3 ')), 'a name the description gives');
  assert.ok(derive('Outlook plante', '', ['Outlook']).facet_queries.some((query) => query.startsWith('Outlook ')), 'a title without a code');
}

// A word that only starts a sentence or links two is no application: it prefixes no query.
function testLinkingWordsAreNoApplications() {
  const builder = new AiTicketNeedRepresentationService({} as any);
  const fromModel = builder.deriveKnowledgeQueries({
    need: need({ entities: { applications: ['Depuis', 'Will', 'After', 'SAP'], modules: [], screens: [], equipment: [], services: [] } }),
    fallbackTitle: ticket.title,
    fallbackDescription: ticket.description,
  });
  for (const query of fromModel.queries) {
    assert.doesNotMatch(query, /^(Depuis|Will|After)\b/i, `query ${query}`);
  }
  assert.ok(fromModel.queries.some((query) => query.startsWith('SAP ')), 'a real application still prefixes its queries');

  const deterministic = builder.buildDeterministicNeedRepresentation({
    ticket: { id: '7', title: 'Depuis ce matin, Outlook plante', description: 'After the update. Will it work again? CheeseTrack is down too.' },
    timeline: [],
  }).need;
  assert.deepEqual(deterministic.entities.applications.sort(), ['CheeseTrack', 'Outlook'].sort());

  // A name at the head of the title stays an application; the first word of a sentence of the
  // description does not (review of 12/11).
  const applicationsOf = (title: string, description: string) => builder.buildDeterministicNeedRepresentation({
    ticket: { id: '8', title, description },
    timeline: [],
  }).need.entities.applications;
  assert.deepEqual(applicationsOf('Outlook plante', ''), ['Outlook']);
  assert.deepEqual(applicationsOf('SAP ne répond plus', 'Bonjour,\nDepuis ce matin la saisie bloque.'), ['SAP']);
  assert.deepEqual(applicationsOf('Teams', 'Impossible de rejoindre la réunion de 10 h.'), ['Teams']);
  assert.deepEqual(applicationsOf('Réunion bloquée', 'Bonjour,\nImpossible de rejoindre la réunion.\nDepuis hier Teams se ferme.'), ['Teams']);
}

// The reply synthesis gets the passages that lie past the cut of the body, within a bound.
function testSynthesisGetsThePassagesPastTheCut() {
  const service = new AiReplySynthesisService({} as any);
  const filler = 'The warehouses use Zebra printers for shipping labels. '.repeat(120);
  const jam = 'Calibration after a jam: hold FEED for two seconds until the printer measures one label.';
  const payload = service.buildPromptPayload({
    ticket,
    timeline: [],
    language: 'fr',
    knowledgeDocs: [{
      ref: 'DOC-44',
      title: 'Zebra ZT411',
      content_markdown: `${filler}\n\n${jam}\n\n${filler}`,
      passages: [jam, 'The warehouses use Zebra printers for shipping labels.', ...Array.from({ length: 6 }, (_, index) => `Other jam passage ${index} ${'x'.repeat(900)}`)],
      passages_matched: true,
      validation_status: 'selected',
    }],
    webResults: [],
  }) as any;
  const source = payload.knowledge_sources[0];
  assert.ok(source.content.length <= 3800);
  assert.ok(!source.content.includes('Calibration after a jam'), 'the useful passage is past the cut');
  assert.ok(source.matching_passages.includes(jam));
  assert.ok(!source.matching_passages.some((passage: string) => passage.startsWith('The warehouses use')), 'a passage the start already holds is not repeated');
  assert.ok(source.matching_passages.length <= MAX_SOURCE_PASSAGES);
  for (const passage of source.matching_passages) assert.ok(passage.length <= MAX_SOURCE_PASSAGE_CHARS);
}

// The frame of the internal note follows the tenant's language; the agent still recognises its notes.
function testInternalNoteFollowsTheTenantLanguage() {
  const headings: Record<TriageNoteLanguage, string> = {
    en: 'Technician brief:',
    fr: 'Note pour le technicien :',
    de: 'Hinweis für den Techniker:',
    es: 'Nota para el técnico:',
  };
  const synthesis = {
    language: 'fr', usable: true, needs_human_review: false, requester_reply: 'Ouvrez la tête d\'impression.',
    technician_brief: 'Réponse tirée de DOC-44.', used_sources: [{ kind: 'knowledge' as const, ref: 'DOC-44', url: null, title: 'Zebra ZT411' }],
    rejected_sources: [], confidence: 0.8, model: 'test', usage: null, estimated_tokens: 0, estimated_cost_eur: 0, latency_ms: 1, fallback_reason: null,
  };
  for (const [language, heading] of Object.entries(headings) as Array<[TriageNoteLanguage, string]>) {
    const escalation = buildTriageNote(ticket, [], [], [], { kind: 'escalation', reason: null }, language);
    const synthesized = renderSynthesizedTriageNote(ticket, [], synthesis, language);
    for (const note of [escalation, synthesized]) {
      assert.ok(note.includes(heading), `${language}: ${note}`);
      assert.ok(isKanapMarkedBody(note), `${language}: the agent recognises its own note`);
      for (const [other, otherHeading] of Object.entries(headings)) {
        if (other !== language) assert.ok(!note.includes(otherHeading), `${language} note carries ${otherHeading}`);
      }
    }
  }
}

async function run() {
  for (const test of [
    testACodeOpeningTheTitleIsNoApplication,
    testInterpreterPromptIsBounded,
    testFallbackResultsAreCandidatesOnly,
    testQueriesCoverTheLanguagesOfTheDocuments,
    testLinkingWordsAreNoApplications,
    testSynthesisGetsThePassagesPastTheCut,
    testInternalNoteFollowsTheTenantLanguage,
  ]) {
    await test();
    console.log(`ok - ${test.name}`);
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
