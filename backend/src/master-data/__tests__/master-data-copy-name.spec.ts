import * as assert from 'node:assert/strict';
import { departmentCopyName } from '../master-data-operations.service';

/** A department the copy cannot name is null, so the screen words it. Never an English fallback. */
assert.equal(departmentCopyName(undefined), null);
assert.equal(departmentCopyName(null), null);
assert.equal(departmentCopyName({ name: '  ' }), null);
assert.equal(departmentCopyName({ name: 'Finance' }), 'Finance');
assert.equal(departmentCopyName({ name: 'Finance', company: { name: 'Fromage' } }), 'Finance (Fromage)');
assert.equal(departmentCopyName({ name: 'Finance', company: { name: '  ' } }), 'Finance');
assert.equal(departmentCopyName({ name: ' Finance ', company: { name: ' Fromage ' } }), 'Finance (Fromage)');

console.log('master-data-copy-name.spec: ok');
