import * as assert from 'node:assert/strict';
import { withTargetPage } from '../ai-mutation-preview.service';

// A card names the existing record it changes with the address of its page (`page_url`), by its
// reference where its page opens by it: Kad links it in the message that announces the change,
// as the message after the approval does. A record still to create has no page yet.

const ID = '11111111-1111-4111-8111-111111111111';

function run() {
  assert.deepEqual(
    withTargetPage({ entity_type: 'applications', entity_id: ID, ref: 'APP-32', title: 'Figma' }),
    { entity_type: 'applications', entity_id: ID, ref: 'APP-32', title: 'Figma', page_url: '/it/applications/APP-32' },
  );
  assert.equal(withTargetPage({ entity_type: 'tasks', entity_id: ID, ref: 'T-4', title: 'Renew' }).page_url, '/portfolio/tasks/T-4');
  assert.equal(withTargetPage({ entity_type: 'locations', entity_id: ID, ref: 'LOC-2', title: 'Lyon' }).page_url, '/it/locations/LOC-2');
  assert.equal(withTargetPage({ entity_type: 'applications', entity_id: null, ref: null, title: 'New' }).page_url, undefined, 'a creation has no page');
  assert.equal(withTargetPage({ entity_type: 'unknown_family', entity_id: ID, ref: 'X-1', title: 'X' }).page_url, undefined, 'a family without a page');
  console.log('ai-preview-target-page.spec: ok');
}

run();
