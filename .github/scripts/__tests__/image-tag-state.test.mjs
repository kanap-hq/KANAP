// node --test .github/scripts/__tests__/image-tag-state.test.mjs
//
// The choice release-images.yml makes for an image tag: build it, reuse it, or refuse it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tagState } from '../image-tag-state.mjs';

const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'1'.repeat(64)}`;
const index = (annotations) => ({
  status: 0,
  stdout: JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', digest: DIGEST, annotations }),
  stderr: '',
});
const published = (revision, version) => index({
  'org.opencontainers.image.revision': revision,
  'org.opencontainers.image.version': version,
  'org.opencontainers.image.title': 'kanap-api',
});

test('builds a tag that does not exist yet', () => {
  for (const stderr of ['ERROR: ghcr.io/kanap-hq/kanap-api:26.11.1: not found', 'manifest unknown', 'name unknown: repository name not known']) {
    assert.deepEqual(tagState({ status: 1, stdout: '', stderr }, SHA, '26.11.1').state, 'free', stderr);
  }
  const denied = tagState({ status: 1, stdout: '', stderr: 'unexpected status from HEAD request: 403 Forbidden' }, SHA, '26.11.1');
  assert.equal(denied.state, 'free');
  assert.match(denied.reason, /the push decides/);
});

test('reuses a tag the same commit published for the same version, with its digest', () => {
  assert.deepEqual(tagState(published(SHA, '26.11.1'), SHA, '26.11.1'), {
    state: 'same', digest: DIGEST, reason: `already published by ${SHA}: reused, not built again`,
  });
});

test('refuses a tag published from another commit or for another version', () => {
  const other = tagState(published('b'.repeat(40), '26.11.1'), SHA, '26.11.1');
  assert.equal(other.state, 'other');
  assert.match(other.reason, /already published from revision b{40}, version 26\.11\.1 .*never rewritten/);
  assert.equal(tagState(published(SHA, '26.11.2'), SHA, '26.11.1').state, 'other');
  assert.equal(tagState(index({}), SHA, '26.11.1').state, 'other', 'no annotation: not ours');
  assert.equal(tagState(index(undefined), SHA, '26.11.1').state, 'other');
});

test('fails closed on an answer it cannot read', () => {
  assert.equal(tagState({ status: 1, stdout: '', stderr: 'dial tcp: i/o timeout' }, SHA, '26.11.1').state, 'error');
  assert.equal(tagState({ status: 0, stdout: 'not json', stderr: '' }, SHA, '26.11.1').state, 'error');
  assert.equal(tagState({ status: 0, stdout: '{"annotations":{}}', stderr: '' }, SHA, '26.11.1').state, 'error');
  assert.equal(tagState(null, SHA, '26.11.1').state, 'error');
});
