import * as assert from 'node:assert/strict';
import { PRODUCT_NAME } from '../../config/product';
import { buildTriageNote, isKanapMarkedBody } from '../control-plane/agent-control/agent-control-timeline-synthesis.util';
import type { KnowledgeSearchItem, TicketLike, WebSearchResultItem } from '../control-plane/agent-control/ai-agent-control.service';

// Issue #1301: when reply synthesis fails, the fallback note must not list unvalidated web
// results under "Possible sources found". Knowledge keeps that heading. Web results, when any
// remain after the shared cap of 8, get "Web leads (not validated):" below it. A web-only note
// shows only the second heading. The rest of the note stays as it was.

const ticket: TicketLike = {
  id: '12',
  title: 'VPN access',
  status: 'open',
  priority: 'medium',
};

const knowledge: KnowledgeSearchItem = {
  id: 'doc-1',
  ref: 'DOC-1',
  title: 'VPN setup',
  validation_status: 'unvalidated',
};

const web: WebSearchResultItem = {
  title: 'VPN guide',
  url: 'https://example.test/vpn',
  description: 'A public page the interpreter never checked.',
};

const KNOWLEDGE_HEADING = 'Possible sources found (fallback mode; no article body copied):';
const WEB_HEADING = 'Web leads (not validated):';
const KNOWLEDGE_LINE = '- DOC-1 - VPN setup [unvalidated candidate]';
const WEB_LINE = '- VPN guide (https://example.test/vpn)';

function noteShell(sourceBlock: string, brief: string): string {
  return [
    '[KANAP triage proposal]',
    'Ticket #12 - VPN access',
    'Status: open',
    'Priority: medium',
    '',
    'Ticket history considered:',
    '- No ticket history entries were available.',
    '',
    sourceBlock,
    '',
    'Technician brief:',
    brief,
    '',
    'No external change has been made. This note was prepared by KANAP and requires human approval before posting.',
  ].join('\n');
}

const synthesisBrief = 'AI reply synthesis was unavailable or skipped. Review the possible sources above and complete the requester answer manually before approving.';

function testKnowledgeOnlyFallbackNoteIsUnchanged() {
  const note = buildTriageNote(ticket, [knowledge], [], []);
  assert.equal(note, noteShell([KNOWLEDGE_HEADING, KNOWLEDGE_LINE].join('\n'), synthesisBrief));
  assert.equal(note.includes(WEB_HEADING), false);
}

function testWebOnlyFallbackNoteShowsOnlyTheWebHeading() {
  const note = buildTriageNote(ticket, [], [], [web]);
  assert.equal(note, noteShell([WEB_HEADING, WEB_LINE].join('\n'), synthesisBrief));
  assert.equal(note.includes(KNOWLEDGE_HEADING), false);
  assert.equal(note.includes('No source candidate was retrieved'), false);
}

function testMixedFallbackNoteListsKnowledgeBeforeWebLeads() {
  const note = buildTriageNote(ticket, [knowledge], [], [web]);
  assert.equal(note, noteShell([
    KNOWLEDGE_HEADING,
    KNOWLEDGE_LINE,
    '',
    WEB_HEADING,
    WEB_LINE,
  ].join('\n'), synthesisBrief));
  assert.ok(note.indexOf(KNOWLEDGE_HEADING) < note.indexOf(WEB_HEADING));
  assert.ok(note.indexOf(KNOWLEDGE_LINE) < note.indexOf(WEB_HEADING));
}

function testEmptyFallbackNoteStillReportsNoCandidate() {
  const note = buildTriageNote(ticket, [], [], []);
  assert.equal(note, noteShell([
    KNOWLEDGE_HEADING,
    '- No source candidate was retrieved.',
  ].join('\n'), synthesisBrief));
  assert.equal(note.includes(WEB_HEADING), false);
}

function testFallbackSourceCapKeepsKnowledgeAheadOfWebLeads() {
  const articles = Array.from({ length: 8 }, (_, index): KnowledgeSearchItem => ({
    id: `doc-${index + 1}`,
    ref: `DOC-${index + 1}`,
    title: `Article ${index + 1}`,
  }));
  const full = buildTriageNote(ticket, articles, [], [web]);
  assert.equal(full.includes(WEB_HEADING), false);
  assert.equal(full.includes(web.url), false);
  assert.equal(full.includes('- DOC-8 - Article 8'), true);
  assert.equal(full.includes('- DOC-1 - Article 1'), true);

  const roomForOneWeb = buildTriageNote(
    ticket,
    articles.slice(0, 7),
    [],
    [web, { title: 'Second page', url: 'https://example.test/two', description: 'dropped' }],
  );
  assert.equal(roomForOneWeb.includes(WEB_HEADING), true);
  assert.equal(roomForOneWeb.includes(WEB_LINE), true);
  assert.doesNotMatch(roomForOneWeb, /example\.test\/two/);
  assert.ok(roomForOneWeb.indexOf(KNOWLEDGE_HEADING) < roomForOneWeb.indexOf(WEB_HEADING));
}

function testAdministrativeAndEscalationNotesDoNotGainTheWebHeading() {
  const administrative = buildTriageNote(ticket, [knowledge], [], [web], {
    kind: 'administrative_reply',
    reason: 'Waiting on the requester.',
  });
  assert.equal(administrative.includes('Candidate sources reviewed (not used by the administrative reply; no article body copied):'), true);
  assert.equal(administrative.includes(KNOWLEDGE_LINE), true);
  assert.equal(administrative.includes(WEB_LINE), true);
  assert.equal(administrative.includes(WEB_HEADING), false);
  assert.equal(administrative.includes(KNOWLEDGE_HEADING), false);
  assert.equal(administrative.includes('Waiting on the requester.'), true);
  assert.equal(administrative.includes('AI reply synthesis was unavailable or skipped'), false);

  const escalation = buildTriageNote(ticket, [knowledge], [], [web], {
    kind: 'escalation',
    reason: 'Needs a person.',
  });
  assert.equal(escalation.includes('Needs a person.'), true);
  assert.equal(escalation.includes(KNOWLEDGE_HEADING), false);
  assert.equal(escalation.includes(WEB_HEADING), false);
  assert.equal(escalation.includes(KNOWLEDGE_LINE), false);
  assert.equal(escalation.includes(WEB_LINE), false);
}

testKnowledgeOnlyFallbackNoteIsUnchanged();
testWebOnlyFallbackNoteShowsOnlyTheWebHeading();
testMixedFallbackNoteListsKnowledgeBeforeWebLeads();
testEmptyFallbackNoteStillReportsNoCandidate();
testFallbackSourceCapKeepsKnowledgeAheadOfWebLeads();
testAdministrativeAndEscalationNotesDoNotGainTheWebHeading();

// A ticket keeps the note the agent wrote there. A body written with the current product name and
// one written with the legacy literals (before the name became a constant) are both the agent's.
function testAgentMarksOfCurrentAndLegacyNotesAreRecognised() {
  const current = buildTriageNote(ticket, [knowledge], []);
  assert.equal(current.startsWith(`[${PRODUCT_NAME} triage proposal]`), true);
  assert.equal(isKanapMarkedBody(current), true);
  assert.equal(isKanapMarkedBody(`[${PRODUCT_NAME.toUpperCase()} TRIAGE PROPOSAL]\nSee above.`), true);
  assert.equal(isKanapMarkedBody(`Done. This note was prepared by ${PRODUCT_NAME} and requires human approval before posting.`), true);
  assert.equal(isKanapMarkedBody('[KANAP triage proposal]\nPrior internal note.'), true);
  assert.equal(isKanapMarkedBody('No external change has been made. This note was prepared by KANAP and requires human approval.'), true);
  assert.equal(isKanapMarkedBody('The VPN works again, thanks.'), false);
}

testAgentMarksOfCurrentAndLegacyNotesAreRecognised();
