import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ShareItemDto, SHARE_MAX_RECIPIENTS, SHARE_MESSAGE_MAX_LENGTH } from '../dto/share-item.dto';
import { shareRecipientsOf } from '../share-recipients';
import { shareLinkRateLimitKey } from '../share-rate-limit';
import { RATE_LIMITS } from '../../common/rate-limit';
import { UserRateLimitGuard } from '../../common/rate-limit.guard';
import { PermissionGuard } from '../../auth/permission.guard';

/**
 * "Send link" (every object's `POST .../:id/share`): bounded recipient lists and message, one
 * total recipient limit in the service, and a per-user rate limit declared on every share route.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const emails = (count: number, prefix = 'person') => Array.from({ length: count }, (_, i) => `${prefix}${i}@example.com`);

function errorsOf(body: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(ShareItemDto, body)).map((error) => error.property);
}

function testDtoBounds() {
  assert.equal(SHARE_MAX_RECIPIENTS, 20);
  assert.deepEqual(errorsOf({ recipient_emails: emails(20) }), [], '20 addresses are accepted');
  assert.deepEqual(errorsOf({ recipient_emails: emails(21) }), ['recipient_emails'], '21 addresses are refused');
  assert.deepEqual(
    errorsOf({ recipient_user_ids: Array.from({ length: 20 }, (_, i) => uuid(i)) }),
    [],
    '20 user ids are accepted',
  );
  assert.deepEqual(
    errorsOf({ recipient_user_ids: Array.from({ length: 21 }, (_, i) => uuid(i)) }),
    ['recipient_user_ids'],
    '21 user ids are refused',
  );
  assert.deepEqual(errorsOf({ recipient_user_ids: ['not-an-id'] }), ['recipient_user_ids'], 'user ids are UUIDs');
  assert.deepEqual(errorsOf({ recipient_emails: ['a@example.com'], message: 'x'.repeat(SHARE_MESSAGE_MAX_LENGTH) }), []);
  assert.deepEqual(
    errorsOf({ recipient_emails: ['a@example.com'], message: 'x'.repeat(SHARE_MESSAGE_MAX_LENGTH + 1) }),
    ['message'],
    'a message past the length limit is refused',
  );
}

function refusal(fn: () => unknown): any {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof BadRequestException, `expected a 400, got ${String(error)}`);
    return error.getResponse();
  }
  assert.fail('expected a 400');
}

function testTotalRecipientLimit() {
  // People and addresses count together, each list without duplicates.
  const ids = Array.from({ length: 12 }, (_, i) => uuid(i));
  assert.equal(refusal(() => shareRecipientsOf({ recipient_user_ids: ids, recipient_emails: emails(9) })).code, 'SHARE_TOO_MANY_RECIPIENTS');
  const accepted = shareRecipientsOf({ recipient_user_ids: [...ids, ids[0].toUpperCase()], recipient_emails: [...emails(8), 'PERSON0@example.com'] });
  assert.deepEqual(accepted.userIds, ids, 'duplicate ids collapse');
  assert.deepEqual(accepted.rawEmails, emails(8), 'duplicate addresses collapse, case ignored');
  // At least one recipient.
  refusal(() => shareRecipientsOf({}));
  refusal(() => shareRecipientsOf(undefined));
}

/** Every controller module of `src/`, from the source tree (ts-node) or the compiled one. */
function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...controllerFiles(full));
    else if (/\.controller\.(ts|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function testEveryShareRouteIsRateLimited() {
  const srcRoot = path.resolve(__dirname, '..', '..');
  const routes: string[] = [];
  for (const file of controllerFiles(srcRoot)) {
    const exported = require(file) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (typeof value !== 'function') continue;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, value);
      if (controllerPath === undefined) continue;
      const proto = (value as any).prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const routePaths = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, handler) ?? []);
        const paramTypes: unknown[] = Reflect.getMetadata('design:paramtypes', proto, name) ?? [];
        const isShareRoute = routePaths.some((p) => /(^|\/)share$/.test(p)) || paramTypes.includes(ShareItemDto);
        if (!isShareRoute) continue;
        const label: string = `${(value as any).name}.${name} (${controllerPath}/${routePaths.join(',')})`;
        routes.push(label);
        const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
        assert.ok(guards.includes(UserRateLimitGuard), `${label} counts per user`);
        assert.ok(guards.includes(PermissionGuard), `${label} checks the permission`);
        assert.ok(
          guards.indexOf(PermissionGuard) < guards.indexOf(UserRateLimitGuard),
          `${label} checks the permission before counting the request`,
        );
        assert.equal(Reflect.getMetadata('THROTTLER:LIMITdefault', handler), RATE_LIMITS.shareLink.limit, `${label} limit`);
        assert.equal(Reflect.getMetadata('THROTTLER:TTLdefault', handler), RATE_LIMITS.shareLink.ttl, `${label} window`);
        assert.equal(
          Reflect.getMetadata('THROTTLER:KEY_GENERATORdefault', handler),
          shareLinkRateLimitKey,
          `${label} shares the one "Send link" budget`,
        );
      }
    }
  }
  assert.ok(routes.length >= 12, `expected the 12 share routes at least, found ${routes.length}: ${routes.join('; ')}`);
  assert.deepEqual(RATE_LIMITS.shareLink, { limit: 30, ttl: 60 * 60_000 });
}

function testOneBudgetPerUser() {
  const route = (handler: string) => ({ getClass: () => ({ name: 'X' }), getHandler: () => ({ name: handler }) }) as any;
  const a = shareLinkRateLimitKey(route('shareContract'), 'user:t1:u1', 'default');
  assert.equal(a, shareLinkRateLimitKey(route('shareAsset'), 'user:t1:u1', 'default'), 'one budget across objects');
  assert.notEqual(a, shareLinkRateLimitKey(route('shareContract'), 'user:t1:u2', 'default'), 'one budget per user');
}

function run() {
  testDtoBounds();
  testTotalRecipientLimit();
  testOneBudgetPerUser();
  testEveryShareRouteIsRateLimited();
  console.log('share-limits.spec: all assertions passed');
}

run();
