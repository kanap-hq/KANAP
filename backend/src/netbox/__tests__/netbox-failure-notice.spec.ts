import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { duplicateNameException } from '../../common/duplicate-name';
import { objectFailureNotice } from '../netbox-sync.service';

// The notice of one object the synchronisation could not save. A refusal that
// reads plainly is passed through: a validation error (400) and a name another
// record already has (409 `duplicate`). Anything else points at the server log.

const duplicate = objectFailureNotice(duplicateNameException('Another location already has this name.'));
assert.equal(duplicate.code, 'validation_failed');
assert.deepEqual(duplicate.params, { detail: 'Another location already has this name.' });

const invalid = objectFailureNotice(new BadRequestException('A host name can use only letters.'));
assert.equal(invalid.code, 'validation_failed');

assert.equal(objectFailureNotice(new ConflictException('Locked')).code, 'save_failed');
assert.equal(objectFailureNotice(new Error('boom')).code, 'save_failed');

console.log('netbox-failure-notice.spec: ok');
