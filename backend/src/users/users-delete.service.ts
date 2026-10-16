import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from './user.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { userAuditSnapshot } from './users.service';
import { checkIds, RecordInUseException, refusalDetails, refusalsFrom, type DeleteRefusal } from '../common/record-in-use';

@Injectable()
export class UsersDeleteService extends BaseDeleteService<User> {
  protected override readonly logger = new Logger(UsersDeleteService.name);

  constructor(
    @InjectRepository(User) repository: Repository<User>,
    audit: AuditService,
  ) {
    super(repository, null, audit, {
      entityName: 'User',
      auditTable: 'users',
      cascadeRelations: [],
    });
  }

  /** A user's name in refusals and delete reports: the full name, the e-mail only when the user has no name. */
  private getUserDisplayName(user: User): string {
    return `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email || user.id;
  }

  /** The refusal of a user's delete: one's own account (`USER_OWN_ACCOUNT`: disable it instead), or null. */
  private refusalOf(user: User, actorId: string | null): RecordInUseException | null {
    if (!actorId || actorId !== user.id) return null;
    return new RecordInUseException('USER_OWN_ACCOUNT', 'user', this.getUserDisplayName(user), [], 'You cannot delete your own account. Disable it instead if needed.');
  }

  /** The check before a delete (`POST /users/delete-check`): which of `ids` would be refused, and why. Nothing is written. */
  async deleteCheck(ids: string[], actorId: string | null, opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    const manager = opts?.manager ?? this.repository.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const rows: User[] = await manager.query(
      `SELECT id, email, first_name, last_name FROM users WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[])`,
      [wanted],
    );
    return refusalsFrom(wanted, rows, (row) => this.getUserDisplayName(row), async (row) => this.refusalOf(row, actorId));
  }

  /**
   * Delete a user by ID
   * Note: actorId is used to prevent self-deletion
   */
  async deleteUser(id: string, actorId: string | null, opts?: { manager?: EntityManager }): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const user = await repo.findOne({ where: { id } as any });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const refusal = this.refusalOf(user, actorId);
    if (refusal) throw refusal;

    try {
      // The task owner and viewer lists name users without a foreign key: the user leaves them here.
      await manager.query(
        `UPDATE tasks SET owner_ids = owner_ids - $2::text, viewer_ids = viewer_ids - $2::text
          WHERE tenant_id = $1 AND (owner_ids @> to_jsonb($2::text) OR viewer_ids @> to_jsonb($2::text))`,
        [user.tenant_id, id],
      );
      await repo.delete({ id } as any);
    } catch (error: any) {
      if (error?.code === '23503' || error?.message?.includes('foreign key constraint')) {
        const label = this.getUserDisplayName(user);
        throw new RecordInUseException(
          'RECORD_IN_USE',
          'user',
          label,
          [],
          `Cannot delete user "${label}": it is referenced by other records. Disable the user instead or remove references first.`,
        );
      }
      throw error;
    }

    await this.audit.log(
      {
        table: 'users',
        recordId: id,
        action: 'delete',
        before: userAuditSnapshot(user),
        after: null,
        userId: actorId ?? null,
      },
      { manager },
    );
  }

  /**
   * Bulk delete multiple users
   */
  async bulkDelete(ids: string[], actorId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const id of ids) {
      try {
        await withSavepoint(manager, () => this.deleteUser(id, actorId, { manager }));
        result.deleted.push(id);
      } catch (error: any) {
        let name = 'Unknown';
        try {
          const u = await withSavepoint(manager, () => repo.findOne({ where: { id } as any }));
          if (u) {
            name = this.getUserDisplayName(u);
          }
        } catch (err: any) {
          this.logger.warn(`Failed to fetch user name for error reporting: ${err?.message || 'Unknown error'}`);
        }
        result.failed.push({ id, name, reason: error?.message || 'Unknown error', ...refusalDetails(error) });
      }
    }

    return result;
  }
}
