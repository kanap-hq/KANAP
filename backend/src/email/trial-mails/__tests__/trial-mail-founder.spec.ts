import * as assert from 'node:assert/strict';
import {
  DEFAULT_TRIAL_MAIL_FOUNDER_ADDRESS,
  trialMailFounder,
  trialMailFounderAddress,
} from '../trial-mail-founder';

// The address the trial e-mails come from (J+5) and send replies to (J0, the activation e-mail) is
// read from TRIAL_MAIL_FOUNDER_ADDRESS. Unset or blank, it stays the address in service at the
// switch to Kadratis; a value that cannot be an address in a header is ignored.

assert.equal(DEFAULT_TRIAL_MAIL_FOUNDER_ADDRESS, 'fried@kanap.net');

// Default value
assert.equal(trialMailFounderAddress({}), 'fried@kanap.net');
assert.equal(trialMailFounderAddress({ TRIAL_MAIL_FOUNDER_ADDRESS: '' }), 'fried@kanap.net');
assert.equal(trialMailFounderAddress({ TRIAL_MAIL_FOUNDER_ADDRESS: '   ' }), 'fried@kanap.net');
assert.equal(trialMailFounder({}), '"Friedrich (Kadratis)" <fried@kanap.net>');

// Configured value
assert.equal(
  trialMailFounderAddress({ TRIAL_MAIL_FOUNDER_ADDRESS: ' friedrich.eva@kadratis.com ' }),
  'friedrich.eva@kadratis.com',
);
assert.equal(
  trialMailFounder({ TRIAL_MAIL_FOUNDER_ADDRESS: 'friedrich.eva@kadratis.com' }),
  '"Friedrich (Kadratis)" <friedrich.eva@kadratis.com>',
);

// A value that would break the header falls back to the default
for (const bad of ['not an address', 'a@b.c, d@e.f', 'x@y.z>\r\nBcc: spy@example.test', '"Fried" <f@k.net>', 'nobody']) {
  assert.equal(trialMailFounderAddress({ TRIAL_MAIL_FOUNDER_ADDRESS: bad }), 'fried@kanap.net', bad);
}

// The process environment is read when no environment is given
const previous = process.env.TRIAL_MAIL_FOUNDER_ADDRESS;
try {
  process.env.TRIAL_MAIL_FOUNDER_ADDRESS = 'founder@example.test';
  assert.equal(trialMailFounderAddress(), 'founder@example.test');
  delete process.env.TRIAL_MAIL_FOUNDER_ADDRESS;
  assert.equal(trialMailFounderAddress(), 'fried@kanap.net');
} finally {
  if (previous === undefined) delete process.env.TRIAL_MAIL_FOUNDER_ADDRESS;
  else process.env.TRIAL_MAIL_FOUNDER_ADDRESS = previous;
}

console.log('trial-mail-founder.spec: ok');
