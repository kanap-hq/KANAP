import * as assert from 'node:assert/strict';
import { z } from 'zod';
import { legacyFlattenError } from '../zod-error';
import { CreateApplicationSchema } from '../../applications/dto/create-application.dto';
import { RoadmapGenerateSchema } from '../../portfolio/dto/roadmap.dto';
import { parseCreateIncident } from '../../incidents/dto/create-incident.dto';

/**
 * The API kept the Zod 3 sentences and the bounded collections that make Zod 4's array size
 * check run before the elements (GHSA-mrhx-c7xc-m3w5). These assertions lock both.
 */

function badRequestMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error: any) {
    assert.equal(error.getStatus(), 400);
    return error.getResponse().message;
  }
  throw new Error('the call did not throw');
}

async function run() {
  // A 200 000-element array is refused once, not once per element.
  const application = CreateApplicationSchema.safeParse({
    name: 'Oversized',
    access_methods: new Array(200_000).fill(123),
  });
  assert.equal(application.success, false);
  assert.equal(application.error!.issues.length, 1);
  assert.equal(application.error!.issues[0].code, 'too_big');

  const roadmap = RoadmapGenerateSchema.safeParse({
    startDate: '2026-01-05',
    scenario: { projectOverrides: new Array(200_000).fill({}) },
  });
  assert.equal(roadmap.success, false);
  assert.equal(roadmap.error!.issues.length, 1);
  assert.equal(roadmap.error!.issues[0].code, 'too_big');

  // The 400 sentences of the incident routes are the ones Zod 3 produced.
  assert.equal(badRequestMessage(() => parseCreateIncident({ severity: 'minor' })), 'title: Required');
  assert.equal(
    badRequestMessage(() => parseCreateIncident({ title: 'Outage', severity: 'minor', reporter_user_id: 'nope' })),
    'reporter_user_id: Invalid uuid',
  );
  assert.equal(
    badRequestMessage(() => parseCreateIncident({ title: 'Outage', severity: 'bogus' })),
    "severity: Invalid enum value. Expected 'critical' | 'major' | 'minor' | 'low', received 'bogus'",
  );
  assert.equal(
    badRequestMessage(() => parseCreateIncident({ title: 'Outage', severity: 'minor', confidential: 'yes' })),
    'confidential: Expected boolean, received string',
  );

  // The flatten() shape and its messages are unchanged for the AI tool refusals.
  const parsed = z.object({ title: z.string(), confidential: z.boolean() }).safeParse({ confidential: 'yes' });
  assert.equal(parsed.success, false);
  assert.deepEqual(legacyFlattenError(parsed.error!), {
    formErrors: [],
    fieldErrors: { title: ['Required'], confidential: ['Expected boolean, received string'] },
  });

  console.log('zod-compat.spec: all assertions passed');
}

run().catch((error) => { console.error(error); process.exit(1); });
