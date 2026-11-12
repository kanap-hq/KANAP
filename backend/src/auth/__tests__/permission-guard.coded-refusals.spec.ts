import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../permission.guard';
import { RequireLevel } from '../require-level.decorator';
import { SubscriptionStatus } from '../../billing/subscription.entity';

// Every refusal of PermissionGuard carries a translatable `code`, as the module-right refusal
// does, so the screen shows it in the person's language (`errors:<code>`):
// - an account whose roles grant nothing: `NO_ACCESS`;
// - a write while billing is configured and the tenant has no subscription in good standing:
//   `SUBSCRIPTION_FROZEN` (no tenant, no subscription, a cancelled one, an overdue payment past its
//   grace) or `TRIAL_EXPIRED` (a trial whose end has passed).
// Reads, and a tenant whose subscription is active or whose trial runs, go through.

class TestController {
  @RequireLevel('budget', 'member')
  memberRoute() {
    return undefined;
  }
}

const USER = { id: 'u-1', status: 'enabled', role_id: 'r-1', role: { role_name: 'Budget team' } };
const DAY = 86400000;

function guardFor(permissions: Array<[string, string]>, subscription: unknown = null): PermissionGuard {
  const manager = {
    getRepository: () => ({ find: async () => [], findOne: async () => subscription }),
  };
  return new PermissionGuard(
    new Reflector(),
    { findById: async () => USER } as any,
    { listForRoles: async () => new Map(permissions) } as any,
    { manager } as any,
    { isConfigured: () => true } as any,
  );
}

function context(method: string, tenant: { id: string } | null = { id: 't-1' }): ExecutionContext {
  const req = { user: { sub: 'u-1' }, method, tenant };
  return {
    getHandler: () => (TestController.prototype as any).memberRoute,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

async function refusedWith(run: () => Promise<unknown>, code: string, message: string, label: string) {
  const error = await run().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof ForbiddenException, `${label}: 403`);
  assert.deepEqual(error.getResponse(), { statusCode: 403, error: 'Forbidden', code, message }, label);
}

async function run() {
  const member: Array<[string, string]> = [['budget', 'member']];

  await refusedWith(() => guardFor([]).canActivate(context('GET')), 'NO_ACCESS',
    'This account has not been granted access yet.', 'no right at all');

  await refusedWith(() => guardFor(member).canActivate(context('POST', null)), 'SUBSCRIPTION_FROZEN',
    'No active subscription found.', 'a write with no tenant');
  await refusedWith(() => guardFor(member, null).canActivate(context('POST')), 'SUBSCRIPTION_FROZEN',
    'No active subscription found.', 'a write with no subscription');
  await refusedWith(() => guardFor(member, { status: SubscriptionStatus.CANCELED }).canActivate(context('PATCH')),
    'SUBSCRIPTION_FROZEN', 'Your subscription is not active.', 'a write on a cancelled subscription');
  await refusedWith(
    () => guardFor(member, { status: SubscriptionStatus.TRIALING, trial_end: new Date(Date.now() - DAY) }).canActivate(context('POST')),
    'TRIAL_EXPIRED', 'Your trial has expired. Please choose a plan to continue.', 'a write after the trial');

  // Reads, an active subscription and a running trial go through.
  assert.equal(await guardFor(member, null).canActivate(context('GET')), true, 'a read with no subscription');
  assert.equal(await guardFor(member, { status: SubscriptionStatus.ACTIVE }).canActivate(context('POST')), true, 'active');
  assert.equal(
    await guardFor(member, { status: SubscriptionStatus.TRIALING, trial_end: new Date(Date.now() + DAY) }).canActivate(context('POST')),
    true,
    'a running trial',
  );
  console.log('permission-guard.coded-refusals.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
