import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from './user.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { userAuditSnapshot } from './users.service';

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

  /**
   * Get display name for a user
   */
  private getUserDisplayName(user: User): string {
    return user.email || `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.id;
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

    if (actorId && actorId === id) {
      throw new ConflictException('You cannot delete your own account. Disable it instead if needed.');
    }

    try {
      await repo.delete({ id } as any);
    } catch (error: any) {
      if (error?.code === '23503' || error?.message?.includes('foreign key constraint')) {
        const label = this.getUserDisplayName(user);
        throw new ConflictException(
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
        result.failed.push({ id, name, reason: error?.message || 'Unknown error' });
      }
    }

    return result;
  }
}
