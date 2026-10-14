import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { decodeHtmlEntities } from '../../common/html-entities';
import { ImportGlpiTicketAiMutationOperation, ImportTicketAiMutationOperation } from '../mutation/operations/import-glpi-ticket.ai-mutation-operation';

function createContext() {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    isPlatformHost: false,
    manager: {
      query: async (sql: string) => {
        if (sql.includes('FROM tenants')) {
          return [{ slug: 'tenant-slug' }];
        }
        return [];
      },
    },
  };
}

function ok<T>(data: T) {
  return { ok: true, data, evidence: [] };
}

function extractImageTargets(html: string | null | undefined): string[] {
  const text = String(html || '');
  const seen = new Set<string>();
  const targets: string[] = [];
  const regex = /<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const target = decodeHtmlEntities(String(match[2] || ''), {
      entities: { amp: '&', quot: '"' },
      ignoreCase: true,
    }).trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      targets.push(target);
    }
  }
  return targets;
}

function ticketingRegistryFromFixture(fixture: {
  ticket?: any;
  followups?: any[];
  onProviderKey?: (providerKey: string) => void;
  readAttachment?: (target: string) => Promise<{ buffer: Buffer; mimeType: string; filename: string }>;
}) {
  const provider = {
    getTicket: async () => {
      const ticket = fixture.ticket;
      const imageTargets = extractImageTargets(ticket?.content_html);
      return ok({
        id: String(ticket.id),
        title: ticket.name,
        status: String(ticket.status ?? ''),
        priority: ticket.priority == null ? null : String(ticket.priority),
        urgency: ticket.urgency ?? null,
        type: ticket.type == null ? null : String(ticket.type),
        description: ticket.content_html,
        descriptionHtml: ticket.content_html,
        sourceUri: ticket.glpi_url,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        attachments: imageTargets.map((target) => ({
          id: null,
          kind: 'image',
          source: 'ticket_description',
          target,
          sourceUri: ticket.glpi_url,
        })),
      });
    },
    listTicketNotes: async () => ok({
      notes: (fixture.followups ?? []).map((followup) => ({
        id: String(followup.id),
        visibility: followup.is_private ? 'internal' : 'public',
        author: followup.author_label,
        body: followup.content_html,
        bodyHtml: followup.content_html,
        createdAt: followup.date,
        updatedAt: followup.date,
        attachments: (followup.image_targets ?? []).map((target: string) => ({
          id: null,
          kind: 'image',
          source: 'ticket_note',
          sourceNoteId: String(followup.id),
          target,
          sourceUri: null,
        })),
      })),
    }),
    readTicketAttachment: async (_context: unknown, input: { target: string }) => {
      const document = await fixture.readAttachment!(input.target);
      return ok({
        attachment: {
          id: null,
          kind: 'image',
          source: 'ticket_description',
          target: input.target,
          filename: document.filename,
          mimeType: document.mimeType,
          sizeBytes: document.buffer.length,
        },
        filename: document.filename,
        mimeType: document.mimeType,
        sizeBytes: document.buffer.length,
        base64Data: document.buffer.toString('base64'),
      });
    },
  };
  return {
    ticketing: async (_context: unknown, providerKey: string) => {
      fixture.onProviderKey?.(providerKey);
      return provider;
    },
  } as any;
}

async function testPrepareCreatePreviewMapsTicketFieldsAndUsesCurrentUserAsRequestor() {
  const operation = new ImportGlpiTicketAiMutationOperation(
    {
      resolveCurrentUser: async () => ({
        id: 'user-1',
        email: 'requestor@example.com',
        label: 'Requestor User',
      }),
      resolveCreateTarget: async () => ({
        mode: 'standalone',
        type: null,
        id: null,
        ref: null,
        label: 'Standalone',
      }),
      resolveUserReference: async () => ({
        id: 'user-2',
        email: 'assignee@example.com',
        label: 'Assigned User',
      }),
      resolveTaskType: async () => {
        throw new BadRequestException('Task type "Task" is not available.');
      },
    } as any,
    {} as any,
    {} as any,
    {} as any,
    ticketingRegistryFromFixture({
      ticket: {
        id: 4523,
        name: 'VPN access broken',
        content_html: '<p>User cannot connect.</p><p><img src="front/document.send.php?docid=19" /></p>',
        status: 'Assigned',
        priority: 4,
        urgency: '5',
        type: 2,
        glpi_url: 'https://glpi.internal/helpdesk/front/ticket.form.php?id=4523',
      },
      followups: [],
    } as any),
    {
      assertBusinessPermission: async () => undefined,
    } as any,
  );

  const prepared = await operation.prepareCreatePreview(createContext() as any, {
    ticket_id: 4523,
    relation_type: 'standalone',
    assignee: 'Assigned User',
  });

  assert.equal(prepared.targetEntityType, 'tasks');
  assert.equal(prepared.mutationInput.title, 'VPN access broken');
  assert.equal(prepared.mutationInput.requestor_user_id, 'user-1');
  assert.equal(prepared.mutationInput.requestor_label, 'Requestor User');
  assert.equal(prepared.mutationInput.assignee_user_id, 'user-2');
  assert.equal(prepared.mutationInput.priority_level, 'high');
  assert.equal(prepared.mutationInput.task_type_id, null);
  assert.deepEqual(prepared.mutationInput.glpi_image_targets, ['front/document.send.php?docid=19']);
  assert.match(String(prepared.mutationInput.description || ''), /Source: GLPI Ticket #4523/);
  assert.match(String(prepared.mutationInput.description || ''), /GLPI URL: https:\/\/glpi\.internal\/helpdesk\/front\/ticket\.form\.php\?id=4523/);
}

async function testImportTicketPrepareRequiresExplicitProviderKeyAndStoresGenericMetadata() {
  let providerKeySeen: string | null = null;
  const operation = new ImportTicketAiMutationOperation(
    {
      resolveCurrentUser: async () => ({
        id: 'user-1',
        email: 'requestor@example.com',
        label: 'Requestor User',
      }),
      resolveCreateTarget: async () => ({
        mode: 'standalone',
        type: null,
        id: null,
        ref: null,
        label: 'Standalone',
      }),
      resolveTaskType: async () => null,
    } as any,
    {} as any,
    {} as any,
    {} as any,
    ticketingRegistryFromFixture({
      onProviderKey: (providerKey: string) => {
        providerKeySeen = providerKey;
      },
      ticket: {
        id: 'ABC-4523',
        name: 'VPN access broken',
        content_html: '<p>User cannot connect.</p>',
        status: 'open',
        priority: 'high',
        type: 'request',
        glpi_url: 'https://tickets.example.test/tickets/ABC-4523',
      },
      followups: [],
    } as any),
    {
      assertBusinessPermission: async () => undefined,
    } as any,
  );

  const prepared = await operation.prepareCreatePreview(createContext() as any, {
    provider_key: 'mock-ticketing',
    ticket_id: 'ABC-4523',
    relation_type: 'standalone',
  });
  const presentation = operation.presentPreview({
    id: 'preview-1',
    status: 'pending',
    tool_name: 'import_ticket',
    target_entity_id: null,
    current_values: prepared.currentValues,
    mutation_input: prepared.mutationInput,
  } as any);

  assert.equal(providerKeySeen, 'mock-ticketing');
  assert.equal(prepared.mutationInput.ticket_provider_key, 'mock-ticketing');
  assert.equal(prepared.mutationInput.ticket_id, 'ABC-4523');
  assert.equal(prepared.currentValues?.ticket_provider_key, 'mock-ticketing');
  assert.match(String(prepared.mutationInput.description || ''), /Provider: mock-ticketing/);
  assert.match(presentation.summary, /ticket #ABC-4523 from provider mock-ticketing/);
}

async function testImportTicketExecuteRequiresStoredProviderBeforeCreatingTask() {
  let createCalls = 0;
  const operation = new ImportTicketAiMutationOperation(
    {
      resolveStoredCreateTarget: async () => ({
        mode: 'standalone',
        type: null,
        id: null,
        ref: null,
        label: 'Standalone',
      }),
    } as any,
    {
      createForTarget: async () => {
        createCalls += 1;
        return {
          id: 'task-1',
          item_number: 44,
          title: 'VPN access broken',
          description: 'User cannot connect.',
        };
      },
    } as any,
    {} as any,
    {} as any,
    {
      ticketing: async () => {
        throw new Error('Provider lookup should not run without stored provider identity.');
      },
    } as any,
    {
      assertBusinessPermission: async () => undefined,
    } as any,
  );

  const preview = {
    id: 'preview-1',
    tenant_id: 'tenant-1',
    conversation_id: 'conv-1',
    user_id: 'user-1',
    tool_name: 'import_ticket',
    target_entity_type: 'tasks',
    target_entity_id: null,
    mutation_input: {
      relation_type: 'standalone',
      relation_id: null,
      title: 'VPN access broken',
      description: 'User cannot connect.',
      assignee_user_id: null,
      priority_level: 'high',
      task_type_id: null,
      ticket_id: 'ABC-4523',
    },
    current_values: {},
  };

  await assert.rejects(
    () => operation.executePreview(createContext() as any, preview as any),
    /ticket_provider_key is required/,
  );
  assert.equal(createCalls, 0);
  assert.equal(preview.target_entity_id, null);
}

async function testPrepareCreatePreviewFallsBackToUrgencyWhenPriorityIsMissing() {
  const operation = new ImportGlpiTicketAiMutationOperation(
    {
      resolveCurrentUser: async () => ({
        id: 'user-1',
        email: 'requestor@example.com',
        label: 'Requestor User',
      }),
      resolveCreateTarget: async () => ({
        mode: 'standalone',
        type: null,
        id: null,
        ref: null,
        label: 'Standalone',
      }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    ticketingRegistryFromFixture({
      ticket: {
        id: 5000,
        name: 'Urgent ticket',
        content_html: '<p>Urgent ticket</p>',
        status: 'Assigned',
        priority: null,
        urgency: '5',
        type: 1,
        glpi_url: 'https://glpi.internal/helpdesk/front/ticket.form.php?id=5000',
      },
      followups: [],
    } as any),
    {
      assertBusinessPermission: async () => undefined,
    } as any,
  );

  const prepared = await operation.prepareCreatePreview(createContext() as any, {
    ticket_id: 5000,
    relation_type: 'standalone',
  });

  assert.equal(prepared.mutationInput.priority_level, 'blocker');
}

async function testPrepareCreatePreviewConvertsEscapedHtmlContent() {
  const operation = new ImportGlpiTicketAiMutationOperation(
    {
      resolveCurrentUser: async () => ({
        id: 'user-1',
        email: 'requestor@example.com',
        label: 'Requestor User',
      }),
      resolveCreateTarget: async () => ({
        mode: 'standalone',
        type: null,
        id: null,
        ref: null,
        label: 'Standalone',
      }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    ticketingRegistryFromFixture({
      ticket: {
        id: 59925,
        name: 'Création demandeurs dans la COA',
        content_html: '&lt;div&gt;&lt;h1&gt;Donn&#233;es du formulaire&lt;/h1&gt;'
          + '&lt;div&gt;&lt;b&gt;Titre : &lt;/b&gt;Cr&#233;ation demandeurs dans la COA&lt;/div&gt;'
          + '&lt;p&gt;&lt;img src=&quot;/front/document.send.php?docid=41260&amp;itemtype=Ticket&amp;items_id=59925&quot; /&gt;&lt;/p&gt;'
          + '&lt;/div&gt;',
        status: '2',
        priority: 4,
        urgency: '5',
        type: 1,
        glpi_url: 'https://glpi.internal/helpdesk/front/ticket.form.php?id=59925',
      },
      followups: [],
    } as any),
    {
      assertBusinessPermission: async () => undefined,
    } as any,
  );

  const prepared = await operation.prepareCreatePreview(createContext() as any, {
    ticket_id: 59925,
    relation_type: 'standalone',
  });

  assert.match(String(prepared.mutationInput.description || ''), /# Données du formulaire/i);
  assert.doesNotMatch(String(prepared.mutationInput.description || ''), /<div>|&lt;div&gt;/i);
  assert.deepEqual(prepared.mutationInput.glpi_image_targets, ['/front/document.send.php?docid=41260&itemtype=Ticket&items_id=59925']);
}

async function testPrepareCreatePreviewQueuesPublicFollowupsAndSkipsPrivateFollowups() {
  const operation = new ImportGlpiTicketAiMutationOperation(
    {
      resolveCurrentUser: async () => ({
        id: 'user-1',
        email: 'requestor@example.com',
        label: 'Requestor User',
      }),
      resolveCreateTarget: async () => ({
        mode: 'standalone',
        type: null,
        id: null,
        ref: null,
        label: 'Standalone',
      }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    ticketingRegistryFromFixture({
      ticket: {
        id: 4523,
        name: 'VPN access broken',
        content_html: '<p>User cannot connect.</p>',
        status: 'Assigned',
        priority: 4,
        urgency: '5',
        type: 2,
        glpi_url: 'https://glpi.internal/helpdesk/front/ticket.form.php?id=4523',
      },
      followups: [
        {
          id: 101,
          content_html: '<p>Public update</p><p><img src="/front/document.send.php?docid=88" /></p>',
          author_label: 'Alice Technician',
          date: '2026-01-04 10:00:00',
          is_private: false,
          image_targets: ['/front/document.send.php?docid=88'],
        },
        {
          id: 102,
          content_html: '<p>Private update</p>',
          author_label: 'Manager',
          date: '2026-01-05 10:00:00',
          is_private: true,
          image_targets: [],
        },
      ],
    } as any),
    {
      assertBusinessPermission: async () => undefined,
    } as any,
  );

  const prepared = await operation.prepareCreatePreview(createContext() as any, {
    ticket_id: 4523,
    relation_type: 'standalone',
  });

  assert.equal(prepared.mutationInput.glpi_followup_public_count, 1);
  assert.equal(prepared.mutationInput.glpi_followup_private_skipped_count, 1);
  assert.equal(prepared.mutationInput.glpi_followup_image_total_count, 1);
  assert.equal((prepared.mutationInput.glpi_followups as any[]).length, 1);
  assert.equal((prepared.mutationInput.glpi_followups as any[])[0].id, '101');
}

async function testExecutePreviewImportsInlineImagesBestEffort() {
  const uploads: any[] = [];
  const taskCreates: any[] = [];
  const taskUpdates: any[] = [];
  const attachmentReads: string[] = [];

  const operation = new ImportGlpiTicketAiMutationOperation(
    {
      resolveStoredCreateTarget: async () => ({
        mode: 'standalone',
        type: null,
        id: null,
        ref: null,
        label: 'Standalone',
      }),
    } as any,
    {
      createForTarget: async (...args: any[]) => {
        taskCreates.push(args);
        return {
          id: 'task-1',
          item_number: 44,
          title: 'VPN access broken',
          description: '![one](front/document.send.php?docid=19)\n\n![two](front/document.send.php?docid=20)',
        };
      },
      updateById: async (...args: any[]) => {
        taskUpdates.push(args);
      },
    } as any,
    {
      uploadAttachment: async (...args: any[]) => {
        uploads.push(args);
        return { id: `attachment-${uploads.length}` };
      },
    } as any,
    {} as any,
    ticketingRegistryFromFixture({
      readAttachment: async (target: string) => {
        attachmentReads.push(target);
        if (target.includes('docid=20')) {
          throw new BadRequestException('image not found');
        }
        return {
          buffer: Buffer.from('fake-image'),
          mimeType: 'image/png',
          filename: 'vpn.png',
        };
      },
    } as any),
    {
      assertBusinessPermission: async () => undefined,
    } as any,
  );

  const preview = {
    id: 'preview-1',
    tenant_id: 'tenant-1',
    conversation_id: 'conv-1',
    user_id: 'user-1',
    tool_name: 'import_glpi_ticket',
    target_entity_type: 'tasks',
    target_entity_id: null,
    mutation_input: {
      relation_type: 'standalone',
      relation_id: null,
      title: 'VPN access broken',
      description: '![one](front/document.send.php?docid=19)\n\n![two](front/document.send.php?docid=20)',
      assignee_user_id: null,
      priority_level: 'high',
      task_type_id: null,
      glpi_image_targets: [
        'front/document.send.php?docid=19',
        'front/document.send.php?docid=20',
      ],
    },
    current_values: {},
  };

  await operation.executePreview(createContext() as any, preview as any);

  const currentValues = preview.current_values as Record<string, any>;
  assert.equal(preview.target_entity_id, 'task-1');
  assert.equal(currentValues.target_ref, 'T-44');
  assert.equal(currentValues.glpi_image_total_count, 2);
  assert.equal(currentValues.glpi_image_imported_count, 1);
  assert.equal(Array.isArray(currentValues.glpi_image_warnings), true);
  assert.equal(currentValues.glpi_image_warnings.length, 1);
  assert.equal(uploads.length, 1);
  assert.deepEqual(attachmentReads, [
    'front/document.send.php?docid=19',
    'front/document.send.php?docid=20',
  ]);
  assert.deepEqual(taskCreates[0][2]?.audit, {
    source: 'ai_chat',
    sourceRef: 'preview-1',
  });
  assert.equal(taskUpdates.length, 1);
  assert.deepEqual(taskUpdates[0][3]?.audit, {
    source: 'ai_chat',
    sourceRef: 'preview-1',
  });
  assert.match(String(taskUpdates[0][1]?.description || ''), /\/api\/tasks\/attachments\/tenant-slug\/attachment-1\/inline/);
}

async function testExecutePreviewImportsFollowupsAsNativeCommentsWithInlineImages() {
  const uploads: any[] = [];
  const comments: any[] = [];
  const attachmentReads: string[] = [];

  const operation = new ImportGlpiTicketAiMutationOperation(
    {
      resolveStoredCreateTarget: async () => ({
        mode: 'standalone',
        type: null,
        id: null,
        ref: null,
        label: 'Standalone',
      }),
    } as any,
    {
      createForTarget: async () => ({
        id: 'task-1',
        item_number: 44,
        title: 'VPN access broken',
        description: 'User cannot connect.',
      }),
    } as any,
    {
      uploadAttachment: async (...args: any[]) => {
        uploads.push(args);
        return { id: `attachment-${uploads.length}` };
      },
    } as any,
    {
      createImportedComment: async (...args: any[]) => {
        comments.push(args);
        return { id: `comment-${comments.length}` };
      },
      create: async () => {
        throw new Error('Standard comment creation should not be used for GLPI imports.');
      },
    } as any,
    ticketingRegistryFromFixture({
      readAttachment: async (target: string) => {
        attachmentReads.push(target);
        if (target.includes('docid=89')) {
          throw new BadRequestException('image not found');
        }
        return {
          buffer: Buffer.from('fake-image'),
          mimeType: 'image/png',
          filename: 'followup.png',
        };
      },
    } as any),
    {
      assertBusinessPermission: async () => undefined,
    } as any,
  );

  const preview = {
    id: 'preview-1',
    tenant_id: 'tenant-1',
    conversation_id: 'conv-1',
    user_id: 'user-1',
    tool_name: 'import_glpi_ticket',
    target_entity_type: 'tasks',
    target_entity_id: null,
    mutation_input: {
      relation_type: 'standalone',
      relation_id: null,
      title: 'VPN access broken',
      description: 'User cannot connect.',
      assignee_user_id: null,
      priority_level: 'high',
      task_type_id: null,
      glpi_ticket_id: 4523,
      glpi_image_targets: [],
      glpi_followup_private_skipped_count: 1,
      glpi_followups: [
        {
          id: 101,
          content_html: '<p>Public update</p><p><img src="/front/document.send.php?docid=88" /></p><p><img src="/front/document.send.php?docid=89" /></p>',
          author_label: 'Alice Technician',
          date: '2026-01-04 10:00:00',
          is_private: false,
          image_targets: ['/front/document.send.php?docid=88', '/front/document.send.php?docid=89'],
        },
      ],
    },
    current_values: {},
  };

  await operation.executePreview(createContext() as any, preview as any);

  const currentValues = preview.current_values as Record<string, any>;
  assert.equal(comments.length, 1);
  assert.equal(comments[0][0], 'task-1');
  assert.equal(comments[0][2], 'tenant-1');
  assert.equal(comments[0][3], 'user-1');
  assert.equal(comments[0][1].context, 'glpi_import');
  assert.equal(comments[0][1].created_at instanceof Date, true);
  assert.match(String(comments[0][1].content || ''), /Source: GLPI Ticket #4523 followup #101/);
  assert.match(String(comments[0][1].content || ''), /Author: Alice Technician/);
  assert.match(String(comments[0][1].content || ''), /\/api\/tasks\/attachments\/tenant-slug\/attachment-1\/inline/);
  assert.equal(uploads.length, 1);
  assert.deepEqual(attachmentReads, [
    '/front/document.send.php?docid=88',
    '/front/document.send.php?docid=89',
  ]);
  assert.equal(uploads[0][3]?.sourceField, 'content');
  assert.equal(currentValues.glpi_followup_public_count, 1);
  assert.equal(currentValues.glpi_followup_imported_count, 1);
  assert.equal(currentValues.glpi_followup_private_skipped_count, 1);
  assert.equal(currentValues.glpi_followup_image_total_count, 2);
  assert.equal(currentValues.glpi_followup_image_imported_count, 1);
  assert.equal(currentValues.glpi_image_warnings.length, 1);
}

async function run() {
  await testPrepareCreatePreviewMapsTicketFieldsAndUsesCurrentUserAsRequestor();
  await testImportTicketPrepareRequiresExplicitProviderKeyAndStoresGenericMetadata();
  await testImportTicketExecuteRequiresStoredProviderBeforeCreatingTask();
  await testPrepareCreatePreviewFallsBackToUrgencyWhenPriorityIsMissing();
  await testPrepareCreatePreviewConvertsEscapedHtmlContent();
  await testPrepareCreatePreviewQueuesPublicFollowupsAndSkipsPrivateFollowups();
  await testExecutePreviewImportsInlineImagesBestEffort();
  await testExecutePreviewImportsFollowupsAsNativeCommentsWithInlineImages();
}

void run();
