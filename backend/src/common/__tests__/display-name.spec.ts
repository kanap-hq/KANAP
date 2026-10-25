import * as assert from 'node:assert/strict';
import { displayName } from '../display-name';
import { buildShareEmail } from '../../notifications/notification-templates';

// A user created by provisioning or SSO can have both names null. The old
// template literal stringifies that as "null null", which is not empty, so
// the "Someone" fallback never applied.

function testNullEmptyAndPartialNames() {
  assert.equal(displayName(null, 'Someone'), 'Someone');
  assert.equal(displayName(undefined, 'Someone'), 'Someone');
  assert.equal(displayName({ first_name: null, last_name: null }, 'Someone'), 'Someone');
  assert.equal(displayName({ first_name: '', last_name: '   ' }, 'Someone'), 'Someone');
  assert.equal(displayName({ first_name: undefined, last_name: undefined }), '');
  assert.equal(displayName({ first_name: 'Ada', last_name: null }), 'Ada');
  assert.equal(displayName({ first_name: null, last_name: 'Lovelace' }), 'Lovelace');
  assert.equal(displayName({ first_name: '  Ada ', last_name: ' Lovelace  ' }), 'Ada Lovelace');
  assert.equal(displayName({ first_name: 'Ada', last_name: 'Lovelace' }, 'Someone'), 'Ada Lovelace');
}

/** String(null) is "null", the same coercion a template literal applies to a null name. */
function unguardedName(row: { first_name: string | null; last_name: string | null }): string {
  return [String(row.first_name), String(row.last_name)].join(' ').trim() || 'Someone';
}

function testShareEmailDropsNullNull() {
  const nameless = { first_name: null, last_name: null };
  const beforeName = unguardedName(nameless);
  const afterName = displayName(nameless, 'Someone');
  assert.equal(beforeName, 'null null');
  assert.equal(afterName, 'Someone');

  const email = (senderName: string) => buildShareEmail({
    itemType: 'document',
    itemName: 'Roadmap',
    itemUrl: 'https://acme.example/knowledge/documents/doc-1',
    senderName,
    locale: 'en',
  });
  const before = email(beforeName);
  const after = email(afterName);

  assert.match(before.subject, /null null shared Document "Roadmap" with you/);
  assert.match(before.html, /<strong>null null<\/strong> shared the document <strong>Roadmap<\/strong> with you\./);
  assert.match(before.text, /null null shared Document "Roadmap" with you\./);

  assert.equal(after.subject, 'Someone shared Document "Roadmap" with you');
  assert.match(after.html, /<strong>Someone<\/strong> shared the document <strong>Roadmap<\/strong> with you\./);
  assert.match(after.text, /Someone shared Document "Roadmap" with you\./);
  assert.equal(after.html.includes('null null'), false);
  assert.equal(after.text.includes('null null'), false);
}

function run() {
  testNullEmptyAndPartialNames();
  testShareEmailDropsNullNull();
}

void run();
