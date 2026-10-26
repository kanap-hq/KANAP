import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { duplicateNameException } from '../../common/duplicate-name';
import { assetBadRequest, assetConflict } from '../../assets/asset-rules';
import { isDuplicateIpRejection, objectFailureNotice } from '../netbox-sync.service';

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

// The asset services refuse a name or an FQDN another asset holds with their own
// codes: the notice says why the row was not created.
const nameTaken = objectFailureNotice(assetConflict('asset_name_taken', 'An asset already has this name: AST-3', { name: 'srv1', ref: 'AST-3' }));
assert.equal(nameTaken.code, 'validation_failed');
assert.deepEqual(nameTaken.params, { detail: 'An asset already has this name: AST-3' });
const fqdnTaken = objectFailureNotice(assetConflict('asset_fqdn_taken', 'An asset already has this FQDN: AST-4', { fqdn: 'srv1.example.com', ref: 'AST-4' }));
assert.equal(fqdnTaken.code, 'validation_failed');
assert.deepEqual(fqdnTaken.params, { detail: 'An asset already has this FQDN: AST-4' });
assert.equal(objectFailureNotice(assetConflict('something_else', 'Locked')).code, 'save_failed');

// Only an address another asset holds is an IP conflict (the row is then written
// without it). A malformed address is a refusal of its own.
assert.equal(isDuplicateIpRejection(assetBadRequest('asset_ip_taken', 'IP address "10.0.0.1" is already used', { value: '10.0.0.1' })), true);
assert.equal(isDuplicateIpRejection(assetBadRequest('asset_ip_invalid', '"10.0.0.999" is not a valid IP address.', { value: '10.0.0.999' })), false);
assert.equal(isDuplicateIpRejection(new BadRequestException('Invalid IP address type "x"')), false);
assert.equal(objectFailureNotice(assetBadRequest('asset_ip_invalid', '"10.0.0.999" is not a valid IP address.')).code, 'validation_failed');

console.log('netbox-failure-notice.spec: ok');
