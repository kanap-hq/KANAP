import * as assert from 'node:assert/strict';
import { stripBase64Images } from '../../ai/ai-chat-orchestrator.service';
import { selectAiContextProfile } from '../../ai/ai-context-profile';
import { normalizeKnowledgeText } from '../../ai/control-plane/agent-control/agent-control-knowledge.util';
import { normalizeKnowledgeReplyText } from '../../ai/control-plane/agent-control/agent-control-timeline-synthesis.util';
import { isExampleRecipient, maskEmailAddresses } from '../../email/email.service';
import { extractInlineImageUrls } from '../content-image-urls';

// Texts read on the main thread of the API (contents, chat messages, tickets,
// recipients) are scanned in linear time, whatever they hold, and give the
// same results as before on ordinary texts. A scan that backtracks grows with
// the square of the text: 64 times longer for a text 8 times longer, where a
// linear one takes about 8 times longer. The growth is measured, not a time:
// a time depends on the machine and on what else runs on it (a shared CI runner
// took 56 ms for a linear scan of 200 KB). It is the CPU time of this thread,
// which leaves out the time other processes hold the CPU.

const KB = 1024;

function fill(unit: string, size = 200 * KB): string {
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

/** The lower of `current` and the CPU time of one run, in milliseconds. */
function best(work: (text: string) => unknown, text: string, current: number): number {
  const start = process.threadCpuUsage();
  work(text);
  const { user, system } = process.threadCpuUsage(start);
  return Math.min(current, (user + system) / 1000);
}

function assertFast(name: string, units: string[], work: (text: string) => unknown): void {
  for (const unit of units) {
    const small = fill(unit, 25 * KB);
    const large = fill(unit);
    work(small);
    let bestSmall = Number.POSITIVE_INFINITY;
    let bestLarge = Number.POSITIVE_INFINITY;
    // Interleaved, so that a busy moment slows both sizes; the best run of each is kept.
    for (let run = 0; run < 5; run += 1) {
      bestSmall = best(work, small, bestSmall);
      bestLarge = best(work, large, bestLarge);
    }
    const growth = bestLarge / Math.max(bestSmall, 0.01);
    assert.ok(
      bestLarge < 10 || growth < 20,
      `${name} on ${JSON.stringify(unit)}: ${bestSmall.toFixed(2)} ms at 25 KB, ${bestLarge.toFixed(1)} ms at 200 KB (x${growth.toFixed(1)} for a text 8 times longer)`,
    );
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
