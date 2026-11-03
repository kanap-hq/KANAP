import { EntityManager } from 'typeorm';
import { deleteStorageObjects } from '../admin/tenants/tenant-data-purge';
import { StorageService } from '../common/storage/storage.service';

export type AiConversationPurgeResult = {
  messages: number;
  storagePaths: string[];
};

function toCount(value: unknown): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Deletes the given conversations of one tenant, and returns the storage keys
 * of their attachments. The caller removes those files after its transaction
 * commits.
 *
 * Order: messages, then the action-request preview link, then the conversation.
 * An action request reaches its conversation twice, through conversation_id and
 * through preview_id (the previews CASCADE with the conversation); both foreign
 * keys SET NULL. Unlink the second path first so the DELETE does not depend on
 * the order PostgreSQL fires the FK triggers (trigger-name order, which
 * differs between a migrated and a pg_restore'd database). Attachment rows
 * follow the conversation (ON DELETE CASCADE). Their files are not removed
 * here.
 */
export async function purgeAiConversations(
  manager: EntityManager,
  tenantId: string,
  conversationIds: readonly string[],
): Promise<AiConversationPurgeResult> {
  if (conversationIds.length === 0) {
    return { messages: 0, storagePaths: [] };
  }

  const attachmentRows: Array<{ storage_path: string | null }> = await manager.query(
    `
    SELECT storage_path
    FROM ai_message_attachments
    WHERE tenant_id = $1
      AND conversation_id = ANY($2::uuid[])
    `,
    [tenantId, conversationIds],
  );
  const storagePaths = [...new Set(
    attachmentRows
      .map((row) => row.storage_path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0),
  )];

  const messageCountRows: Array<{ count: string }> = await manager.query(
    `
    SELECT COUNT(*)::bigint AS count
    FROM ai_messages
    WHERE tenant_id = $1
      AND conversation_id = ANY($2::uuid[])
    `,
    [tenantId, conversationIds],
  );

  await manager.query(
    `
    DELETE FROM ai_messages
    WHERE tenant_id = $1
      AND conversation_id = ANY($2::uuid[])
    `,
    [tenantId, conversationIds],
  );
  await manager.query(
    `
    UPDATE ai_action_requests
    SET preview_id = NULL
    WHERE tenant_id = $1
      AND preview_id IN (
        SELECT id FROM ai_mutation_previews WHERE tenant_id = $1 AND conversation_id = ANY($2::uuid[])
      )
    `,
    [tenantId, conversationIds],
  );
  await manager.query(
    `
    DELETE FROM ai_conversations
    WHERE tenant_id = $1
      AND id = ANY($2::uuid[])
    `,
    [tenantId, conversationIds],
  );

  return {
    messages: toCount(messageCountRows[0]?.count),
    storagePaths,
  };
}

/**
 * Deletes stored attachment files after the rows that named them are committed.
 * A failure is logged and does not throw: the conversation is already gone.
 */
export async function deleteAiConversationFiles(
  storage: StorageService | undefined,
  paths: readonly string[],
  context: string,
): Promise<{ deleted: number; failed: number }> {
  if (!storage || paths.length === 0) return { deleted: 0, failed: 0 };
  return deleteStorageObjects(storage, paths, context);
}
