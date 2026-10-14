import * as assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { stripBase64Images } from '../../ai/ai-chat-orchestrator.service';
import { selectAiContextProfile } from '../../ai/ai-context-profile';
import { normalizeKnowledgeText } from '../../ai/control-plane/agent-control/agent-control-knowledge.util';
import { normalizeKnowledgeReplyText } from '../../ai/control-plane/agent-control/agent-control-timeline-synthesis.util';
import { isExampleRecipient, maskEmailAddresses } from '../../email/email.service';
import { extractInlineImageUrls } from '../content-image-urls';

// Texts read on the main thread of the API (contents, chat messages, tickets,
// recipients) take well under 50 ms at 200 KB, whatever they hold, and give the
// same results as before on ordinary texts.

const KB = 1024;

function fill(unit: string, size = 200 * KB): string {
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

function assertFast(name: string, units: string[], work: (text: string) => unknown): void {
  for (const unit of units) {
    const text = fill(unit);
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now();
      work(text);
      best = Math.min(best, performance.now() - start);
    }
    assert.ok(best < 50, `${name} on ${JSON.stringify(unit)} x 200 KB took ${best.toFixed(1)} ms`);
  }
}

function run() {
  // Inline images of a saved content.
  assert.deepEqual(
    extractInlineImageUrls('![a](/api/x/inline/1.png) ![b](<https://e.com/inline/2.png> "t") ![c](/other.png) <img src="/api/inline/3.png">'),
    ['/api/inline/3.png', '/api/x/inline/1.png', 'https://e.com/inline/2.png'],
  );
  assertFast('extractInlineImageUrls', ['![', '![a](', '![a](a ', '![a](/inline "', ' src="a'], extractInlineImageUrls);

  // Chat messages and assistant texts.
  assert.equal(
    stripBase64Images('a ![x](data:image/png;base64,QQ==) b <img alt="y" src="data:image/png;base64,QQ=="> c'),
    'a [image removed] b [image removed] c',
  );
  assertFast('stripBase64Images', ['![', '![a](data:image/', '<img src="data:image/a;base64,a" ', '<img '], stripBase64Images);
  // A word of a rule, then its second word further on the same line.
  assert.equal(selectAiContextProfile('latest postgres version').name, 'web');
  assert.equal(selectAiContextProfile('latest postgres\nversion').name, selectAiContextProfile('latest postgres').name);
  assertFast('selectAiContextProfile', [
    'latest ', 'demain ', 'add ', 'find ', 'quel ', 'ne veux ', 'deja ', 'only ', 'encore ', 'qu\'a ', 'latest\n',
  ], selectAiContextProfile);

  // Tickets and knowledge texts of the agents.
  assert.equal(
    normalizeKnowledgeReplyText('<p>Hello <b>you</b></p><ul><li>one</li></ul>\n---\nSee [the doc](https://e.com) ![shot](a.png)  \n'),
    'Hello you\n\n- one\n\nSee the doc [image: shot]',
  );
  assertFast('normalizeKnowledgeReplyText', ['<', '<li', '![', '[', '[a](', '\n', ' ', ' \n---', '---a\n'], normalizeKnowledgeReplyText);
  assertFast('normalizeKnowledgeText', ['<', '<br'], normalizeKnowledgeText);

  // Recipients and log lines.
  assert.equal(maskEmailAddresses('to Ann <ann@acme.com>, bob@acme.com'), 'to Ann <[address]>, [address]');
  assert.equal(isExampleRecipient('Demo <demo@fromage-co.example>'), true);
  assertFast('maskEmailAddresses', ['a', 'a@', '@'], maskEmailAddresses);
  assertFast('isExampleRecipient', ['a', 'a@'], isExampleRecipient);
}

run();
console.log('main-thread-text-timing.spec OK');
