import * as assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { getDefaultEmailBranding } from '../../email/email-branding';
import { buildWeeklyReviewEmail } from '../notification-templates';
import { ScheduledNotificationsService } from '../scheduled-notifications.service';

/**
 * The weekly review links each task, project and request to its page by its reference (`T-4`,
 * `PRJ-2`, `REQ-7`), in the HTML and in the text, as the notification e-mails do; a row without a
 * number keeps its uuid. The service reads each record's number in the queries it already runs.
 * Nothing is sent: the e-mail service is a fake that records the message.
 */

Logger.overrideLogger(false);

const APP = 'https://acme.example.com';
const TASK = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]).filter((href) => href.includes('/portfolio/'));
}

function textLinks(text: string): string[] {
  return [...text.matchAll(/https:\/\/acme\.example\.com\/portfolio\/[^\s)]+/g)].map((match) => match[0]);
}

function testTemplate() {
  const email = buildWeeklyReviewEmail({
    firstName: 'Ada',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    appUrl: APP,
    tasksClosed: [{ id: TASK, itemNumber: 4, title: 'Renew the licence' }],
    projectsWithChanges: [{ id: PROJECT, itemNumber: 2, name: 'Cloud move', oldStatus: 'planned', newStatus: 'in_progress' }],
    tasksClosedOnProjects: [{ id: TASK, itemNumber: 5, title: 'Plan the cutover', projectName: 'Cloud move' }],
    topTasks: [{ id: TASK, itemNumber: 6, title: 'Order the servers', priority: 'high' }],
    topProjectsAsLead: [{ id: PROJECT, itemNumber: 3, name: 'New ERP', status: 'planned' }],
    topProjectsAsContributor: [{ id: PROJECT, itemNumber: 8, name: 'Data platform', status: 'in_progress' }],
    newRequests: [{ id: REQUEST, itemNumber: 7, name: 'New laptop' }, { id: REQUEST, name: 'Without a number' }],
    locale: 'en',
  });
  assert.ok(email);
  const expected = [
    `${APP}/portfolio/tasks/T-4`,
    `${APP}/portfolio/projects/PRJ-2`,
    `${APP}/portfolio/tasks/T-5`,
    `${APP}/portfolio/tasks/T-6`,
    `${APP}/portfolio/projects/PRJ-3`,
    `${APP}/portfolio/projects/PRJ-8`,
    `${APP}/portfolio/requests/REQ-7`,
    `${APP}/portfolio/requests/${REQUEST}`,
  ];
  assert.deepEqual(hrefs(email.html), expected, 'the HTML links each record by its reference, a row without a number by its uuid');
  assert.deepEqual(textLinks(email.text), expected, 'the text links each record by its reference, a row without a number by its uuid');
  console.log('  weekly review template: every link by its reference, the uuid without a number: OK');
}

async function testService() {
  const sent: Array<{ html: string; text: string }> = [];
  const service = new ScheduledNotificationsService(
    {} as any,
    { send: async (message: { html: string; text: string }) => { sent.push(message); } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  (service as any).getTenantAppUrl = async () => APP;
  (service as any).resolveBranding = async () => getDefaultEmailBranding();
  const selects: string[] = [];
  const mg = {
    query: async (sql: string) => {
      if (/set_config/.test(sql)) return [];
      selects.push(sql);
      if (/"projectName"/.test(sql)) return [{ id: TASK, item_number: 5, title: 'Plan the cutover', projectName: 'Cloud move' }];
      if (/FROM tasks t/.test(sql) && /t\.status = 'done'/.test(sql)) return [{ id: TASK, item_number: 4, title: 'Renew the licence', named: true, related_object_type: null }];
      if (/FROM tasks t/.test(sql)) return [{ id: TASK, item_number: 6, title: 'Order the servers', named: true, related_object_type: null, dueDate: null, priority: 'high' }];
      if (/audit_log/.test(sql)) return [{ id: PROJECT, item_number: 2, name: 'Cloud move', status: 'in_progress', oldStatus: 'planned' }];
      if (/IS DISTINCT FROM \$2/.test(sql)) return [{ id: PROJECT, item_number: 8, name: 'Data platform', status: 'in_progress' }];
      if (/FROM portfolio_projects p/.test(sql)) return [{ id: PROJECT, item_number: 3, name: 'New ERP', status: 'planned' }];
      if (/FROM portfolio_requests r/.test(sql)) return [{ id: REQUEST, item_number: 7, name: 'New laptop' }];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const result = await (service as any).sendWeeklyReviewForUser({
    user_id: '44444444-4444-4444-8444-444444444444',
    tenant_id: '55555555-5555-4555-8555-555555555555',
    email: 'ada@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    timezone: 'Europe/Paris',
    locale: 'en',
  }, mg);
  assert.equal(result, 'sent');
  assert.equal(selects.length, 7, 'the seven reads of the weekly review, no read more');
  for (const sql of selects) {
    assert.match(sql, /\.item_number/, 'each read carries the record number');
    assert.match(sql, /\.tenant_id = \$1/, 'each read names its tenant');
  }
  assert.equal(sent.length, 1);
  assert.deepEqual(hrefs(sent[0].html), [
    `${APP}/portfolio/tasks/T-4`,
    `${APP}/portfolio/projects/PRJ-2`,
    `${APP}/portfolio/tasks/T-5`,
    `${APP}/portfolio/tasks/T-6`,
    `${APP}/portfolio/projects/PRJ-3`,
    `${APP}/portfolio/projects/PRJ-8`,
    `${APP}/portfolio/requests/REQ-7`,
  ], 'the service hands every record number to the template');
  console.log('  weekly review service: the numbers read with the rows reach the links: OK');
}

async function main() {
  testTemplate();
  await testService();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
