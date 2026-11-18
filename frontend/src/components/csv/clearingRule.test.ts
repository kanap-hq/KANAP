import { describe, expect, it } from 'vitest';
import { importFollowsClearingRule } from './clearingRule';

// D21 of 26.11.9: the imports that read a blank cell as "keep" and `-` as "clear" (lot I4, then I6).
describe('importFollowsClearingRule', () => {
  it.each(['/applications', '/assets', '/tasks', '/incidents', '/portfolio/projects', '/portfolio/requests', '/users', '/suppliers', '/users/', '/applications?x=1'])(
    'follows the rule for %s',
    (endpoint) => expect(importFollowsClearingRule(endpoint)).toBe(true),
  );

  it.each(['/data-access', '/admin/coa-templates/0b0e6f3c-2a54-4c1b-9d55-6f4b1e7a9c10', '/users/bulk', '/portfolio', '/applications/42'])(
    'does not for %s',
    (endpoint) => expect(importFollowsClearingRule(endpoint)).toBe(false),
  );
});
