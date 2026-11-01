import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { codedForbidden } from '../auth/module-right-required';
import { EntityManager } from 'typeorm';
import { normalizeMarkdownRichText } from '../common/markdown-worker';
import {
  buildKnowledgeWorkflowApprovedEmail,
  buildKnowledgeWorkflowCancelledEmail,
  buildKnowledgeWorkflowChangesRequestedEmail,
  buildKnowledgeWorkflowRequestedEmail,
} from '../notifications/notification-templates';
import { DocumentContributor } from './document-contributor.entity';
import { DocumentEditLock } from './document-edit-lock.entity';
import { DocumentWorkflowParticipant } from './document-workflow-participant.entity';
import { DocumentWorkflow } from './document-workflow.entity';
import { Document } from './document.entity';
import { KnowledgeService } from './knowledge.service';

type DocumentWorkflowStage = 'reviewer' | 'approver';
type DocumentWorkflowStatus = 'pending_review' | 'pending_approval' | 'changes_requested' | 'approved' | 'cancelled';

type WorkflowMutationOptions = {
  manager?: EntityManager;
};

function dedupeStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

@Injectable()
export class KnowledgeWorkflowService {
  constructor(private readonly knowledge: KnowledgeService) {}

  private getManager(opts?: WorkflowMutationOptions): EntityManager {
    return this.knowledge.getManager(opts);
  }

  private async getPendingWorkflowParticipantOrThrow(
    workflowId: string,
    userId: string,
    stage: DocumentWorkflowStage,
    manager: EntityManager,
  ): Promise<DocumentWorkflowParticipant> {
    const participant = await manager.getRepository(DocumentWorkflowParticipant).findOne({
      where: {
        workflow_id: workflowId,
        user_id: userId,
        stage,
      } as any,
    });
    if (!participant) {
      throw new HttpException('You are not assigned to the active workflow stage', 403);
    }
    if (participant.decision !== 'pending') {
      throw new BadRequestException('You have already acted on this workflow stage');
    }
    return participant;
  }

  private async assertWorkflowCancellationAllowed(
    documentId: string,
    workflowId: string,
    currentStage: DocumentWorkflowStage | null,
    userId: string,
    manager: EntityManager,
  ): Promise<void> {
    const knowledgeLevel = await this.knowledge.getKnowledgeLevelForUser(manager, userId);
    if (this.knowledge.hasPermissionLevel(knowledgeLevel || undefined, 'admin')) {
      return;
    }

    const [ownerRows, requesterRows, participantRows] = await Promise.all([
      manager.query<Array<{ present: number }>>(
        `SELECT 1 AS present
         FROM document_contributors
         WHERE document_id = $1
           AND user_id = $2
           AND role = 'owner'
         LIMIT 1`,
        [documentId, userId],
      ),
      manager.query<Array<{ present: number }>>(
        `SELECT 1 AS present
         FROM document_workflows
         WHERE id = $1
           AND requested_by = $2
         LIMIT 1`,
        [workflowId, userId],
      ),
      currentStage
        ? manager.query<Array<{ present: number }>>(
            `SELECT 1 AS present
             FROM document_workflow_participants
             WHERE workflow_id = $1
               AND user_id = $2
               AND stage = $3
               AND decision = 'pending'
             LIMIT 1`,
            [workflowId, userId, currentStage],
          )
        : Promise.resolve([] as Array<{ present: number }>),
    ]);

    if (ownerRows.length > 0 || requesterRows.length > 0 || participantRows.length > 0) {
      return;
    }

    throw codedForbidden('WORKFLOW_CANCEL_NOT_ALLOWED', 'You are not allowed to cancel this review workflow');
  }

  private async finalizeWorkflowApproved(
    document: Document,
    workflow: DocumentWorkflow,
    actedByUserId: string,
    appBaseUrl: string | null | undefined,
    manager: EntityManager,
  ): Promise<void> {
    workflow.status = 'approved';
    workflow.completed_at = new Date();
    await manager.getRepository(DocumentWorkflow).save(workflow);

    document.status = 'published';
    document.published_at = new Date();
    document.last_reviewed_at = new Date();
    document.updated_by = actedByUserId;
    document.updated_at = new Date();
    await manager.getRepository(Document).save(document);
    await this.knowledge.ensureCurrentVersionSnapshot(document, 'Workflow approved', actedByUserId, manager);

    await this.knowledge.createSystemActivity(
      document.id,
      actedByUserId,
      'decision',
      'Workflow approved and document published',
      manager,
      { status: ['in_review', 'published'] },
    );

    const documentUrl = this.knowledge.buildKnowledgeDocumentUrl(appBaseUrl, document.item_number);
    const recipients = await this.knowledge.getDocumentNotificationRecipients(
      manager,
      document.id,
      [workflow.requested_by, actedByUserId],
    );
    await this.knowledge.sendWorkflowEmail(recipients, (locale) => buildKnowledgeWorkflowApprovedEmail({
      documentRef: `DOC-${document.item_number}`,
      documentTitle: document.title,
      documentUrl,
      locale,
    }));
  }

  async requestWorkflowReview(
    idOrRef: string,
    body: any,
    userId: string,
    appBaseUrl: string | null | undefined,
    opts?: WorkflowMutationOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.knowledge.resolveDocumentId(idOrRef, manager);
    await this.knowledge.assertDocumentWritable(documentId, manager, userId);
    const document = await manager.getRepository(Document).findOne({ where: { id: documentId } as any });
    if (!document) throw new NotFoundException('Document not found');
    await this.knowledge.assertIntegratedDocumentWorkflowRequestAllowed(documentId, manager);

    const incomingRevision = Number(body?.revision);
    if (!Number.isFinite(incomingRevision)) {
      throw new BadRequestException('revision is required');
    }
    if (incomingRevision !== Number(document.revision)) {
      throw new ConflictException('Document revision conflict');
    }

    const activeWorkflow = await this.knowledge.getActiveWorkflow(documentId, manager);
    if (activeWorkflow) {
      throw new BadRequestException('A review workflow is already active for this document');
    }

    if (document.status === 'archived' || document.status === 'obsolete') {
      throw new BadRequestException('Archived or obsolete documents cannot be sent to review');
    }

    await this.knowledge.assertDocumentUnlockedForUser(documentId, userId, manager);

    const contributors = await manager.getRepository(DocumentContributor).find({
      where: { document_id: documentId } as any,
      order: { created_at: 'ASC' },
    });
    const reviewerIds = dedupeStrings(contributors.filter((row) => row.role === 'reviewer').map((row) => row.user_id));
    const approverIds = dedupeStrings(contributors.filter((row) => row.role === 'validator').map((row) => row.user_id));

    if (!reviewerIds.length && !approverIds.length) {
      throw new BadRequestException('Assign at least one reviewer or approver before requesting review');
    }

    await this.knowledge.ensureCurrentVersionSnapshot(document, 'Review requested', userId, manager);

    const workflowStatus: DocumentWorkflowStatus = reviewerIds.length ? 'pending_review' : 'pending_approval';
    const workflow = manager.getRepository(DocumentWorkflow).create({
      document_id: documentId,
      status: workflowStatus,
      requested_revision: Number(document.revision || 0),
      requested_by: userId,
      completed_at: null,
    });
    const savedWorkflow = await manager.getRepository(DocumentWorkflow).save(workflow);

    for (const reviewerId of reviewerIds) {
      await manager.getRepository(DocumentWorkflowParticipant).save(
        manager.getRepository(DocumentWorkflowParticipant).create({
          workflow_id: savedWorkflow.id,
          user_id: reviewerId,
          stage: 'reviewer',
          decision: 'pending',
        }),
      );
    }
    for (const approverId of approverIds) {
      await manager.getRepository(DocumentWorkflowParticipant).save(
        manager.getRepository(DocumentWorkflowParticipant).create({
          workflow_id: savedWorkflow.id,
          user_id: approverId,
          stage: 'approver',
          decision: 'pending',
        }),
      );
    }

    const previousStatus = document.status;
    document.status = 'in_review';
    document.updated_by = userId;
    document.updated_at = new Date();
    await manager.getRepository(Document).save(document);
    await manager.getRepository(DocumentEditLock).delete({ document_id: documentId } as any);

    await this.knowledge.createSystemActivity(
      documentId,
      userId,
      'change',
      workflowStatus === 'pending_review' ? 'Review requested' : 'Approval requested',
      manager,
      { status: [previousStatus, 'in_review'] },
    );

    const documentUrl = this.knowledge.buildKnowledgeDocumentUrl(appBaseUrl, document.item_number);
    const requesterName = await this.knowledge.getUserDisplayName(userId, manager);
    const stage = workflowStatus === 'pending_review' ? 'reviewer' : 'approver';
    const recipients = await this.knowledge.getWorkflowParticipantEmails(manager, savedWorkflow.id, stage);
    await this.knowledge.sendWorkflowEmail(recipients, (locale) => buildKnowledgeWorkflowRequestedEmail({
      documentRef: `DOC-${document.item_number}`,
      documentTitle: document.title,
      documentUrl,
      requesterName,
      stage: stage === 'reviewer' ? 'review' : 'approval',
      locale,
    }));

    return this.knowledge.get(documentId, { manager, userId });
  }

  async approveWorkflow(
    idOrRef: string,
    body: any,
    userId: string,
    appBaseUrl: string | null | undefined,
    opts?: WorkflowMutationOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.knowledge.resolveDocumentId(idOrRef, manager);
    await this.knowledge.assertDocumentReadable(documentId, manager, userId);
    const document = await manager.getRepository(Document).findOne({ where: { id: documentId } as any });
    if (!document) throw new NotFoundException('Document not found');

    const workflowView = await this.knowledge.getActiveWorkflow(documentId, manager);
    if (!workflowView) {
      throw new BadRequestException('No active workflow exists for this document');
    }

    const currentStage = workflowView.current_stage;
    if (!currentStage) {
      throw new BadRequestException('The active workflow is not awaiting a decision');
    }

    const workflow = await manager.getRepository(DocumentWorkflow).findOne({ where: { id: workflowView.id } as any });
    if (!workflow) throw new NotFoundException('Workflow not found');

    const participant = await this.getPendingWorkflowParticipantOrThrow(workflow.id, userId, currentStage, manager);
    const comment = await normalizeMarkdownRichText(body?.comment, { fieldName: 'comment' }) || null;

    participant.decision = 'approved';
    participant.comment = comment;
    participant.acted_at = new Date();
    await manager.getRepository(DocumentWorkflowParticipant).save(participant);

    await this.knowledge.createSystemActivity(
      document.id,
      userId,
      'decision',
      `Approved as ${currentStage}${comment ? `: ${comment}` : ''}`,
      manager,
    );

    const pendingRows = await manager.query<Array<{ count: number }>>(
      `SELECT count(*)::int AS count
       FROM document_workflow_participants
       WHERE workflow_id = $1
         AND stage = $2
         AND decision = 'pending'`,
      [workflow.id, currentStage],
    );
    const pendingCount = Number(pendingRows[0]?.count || 0);
    if (pendingCount > 0) {
      return this.knowledge.get(documentId, { manager, userId });
    }

    if (currentStage === 'reviewer') {
      const approverRows = await manager.query<Array<{ count: number }>>(
        `SELECT count(*)::int AS count
         FROM document_workflow_participants
         WHERE workflow_id = $1
           AND stage = 'approver'`,
        [workflow.id],
      );
      const approverCount = Number(approverRows[0]?.count || 0);
      if (approverCount > 0) {
        workflow.status = 'pending_approval';
        await manager.getRepository(DocumentWorkflow).save(workflow);
        await this.knowledge.createSystemActivity(
          document.id,
          userId,
          'change',
          'Review stage completed. Approval requested.',
          manager,
        );

        const documentUrl = this.knowledge.buildKnowledgeDocumentUrl(appBaseUrl, document.item_number);
        const actorName = await this.knowledge.getUserDisplayName(userId, manager);
        const recipients = await this.knowledge.getWorkflowParticipantEmails(manager, workflow.id, 'approver');
        await this.knowledge.sendWorkflowEmail(recipients, (locale) => buildKnowledgeWorkflowRequestedEmail({
          documentRef: `DOC-${document.item_number}`,
          documentTitle: document.title,
          documentUrl,
          requesterName: actorName,
          stage: 'approval',
          locale,
        }));
        return this.knowledge.get(documentId, { manager, userId });
      }
    }

    await this.finalizeWorkflowApproved(document, workflow, userId, appBaseUrl, manager);
    return this.knowledge.get(documentId, { manager, userId });
  }

  async requestWorkflowChanges(
    idOrRef: string,
    body: any,
    userId: string,
    appBaseUrl: string | null | undefined,
    opts?: WorkflowMutationOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.knowledge.resolveDocumentId(idOrRef, manager);
    await this.knowledge.assertDocumentReadable(documentId, manager, userId);
    const document = await manager.getRepository(Document).findOne({ where: { id: documentId } as any });
    if (!document) throw new NotFoundException('Document not found');

    const workflowView = await this.knowledge.getActiveWorkflow(documentId, manager);
    if (!workflowView) {
      throw new BadRequestException('No active workflow exists for this document');
    }

    const currentStage = workflowView.current_stage;
    if (!currentStage) {
      throw new BadRequestException('The active workflow is not awaiting a decision');
    }

    const comment = await normalizeMarkdownRichText(body?.comment, { fieldName: 'comment' }) || '';
    if (!comment.trim()) {
      throw new BadRequestException('A comment is required when requesting changes');
    }

    const workflow = await manager.getRepository(DocumentWorkflow).findOne({ where: { id: workflowView.id } as any });
    if (!workflow) throw new NotFoundException('Workflow not found');

    const participant = await this.getPendingWorkflowParticipantOrThrow(workflow.id, userId, currentStage, manager);
    participant.decision = 'changes_requested';
    participant.comment = comment;
    participant.acted_at = new Date();
    await manager.getRepository(DocumentWorkflowParticipant).save(participant);

    workflow.status = 'changes_requested';
    workflow.completed_at = new Date();
    await manager.getRepository(DocumentWorkflow).save(workflow);

    document.status = 'draft';
    document.updated_by = userId;
    document.updated_at = new Date();
    await manager.getRepository(Document).save(document);
    await manager.getRepository(DocumentEditLock).delete({ document_id: documentId } as any);

    await this.knowledge.createSystemActivity(
      document.id,
      userId,
      'decision',
      `Changes requested by ${currentStage}: ${comment}`,
      manager,
      { status: ['in_review', 'draft'] },
    );

    const documentUrl = this.knowledge.buildKnowledgeDocumentUrl(appBaseUrl, document.item_number);
    const actorName = await this.knowledge.getUserDisplayName(userId, manager);
    const recipients = await this.knowledge.getDocumentNotificationRecipients(
      manager,
      document.id,
      [workflow.requested_by],
    );
    await this.knowledge.sendWorkflowEmail(recipients, (locale) => buildKnowledgeWorkflowChangesRequestedEmail({
      documentRef: `DOC-${document.item_number}`,
      documentTitle: document.title,
      documentUrl,
      actorName,
      comment,
      locale,
    }));

    return this.knowledge.get(documentId, { manager, userId });
  }

  async cancelWorkflowReview(
    idOrRef: string,
    userId: string,
    appBaseUrl: string | null | undefined,
    opts?: WorkflowMutationOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.knowledge.resolveDocumentId(idOrRef, manager);
    await this.knowledge.assertDocumentReadable(documentId, manager, userId);
    const document = await manager.getRepository(Document).findOne({ where: { id: documentId } as any });
    if (!document) throw new NotFoundException('Document not found');

    const workflowView = await this.knowledge.getActiveWorkflow(documentId, manager);
    if (!workflowView) {
      throw new BadRequestException('No active workflow exists for this document');
    }

    const workflow = await manager.getRepository(DocumentWorkflow).findOne({ where: { id: workflowView.id } as any });
    if (!workflow) throw new NotFoundException('Workflow not found');

    await this.assertWorkflowCancellationAllowed(
      documentId,
      workflow.id,
      workflowView.current_stage || null,
      userId,
      manager,
    );

    workflow.status = 'cancelled';
    workflow.completed_at = new Date();
    await manager.getRepository(DocumentWorkflow).save(workflow);

    document.status = 'draft';
    document.updated_by = userId;
    document.updated_at = new Date();
    await manager.getRepository(Document).save(document);
    await manager.getRepository(DocumentEditLock).delete({ document_id: documentId } as any);

    await this.knowledge.createSystemActivity(
      document.id,
      userId,
      'change',
      'Review cancelled',
      manager,
      { status: ['in_review', 'draft'] },
    );

    const participantEmails = await manager.query<Array<{ email: string; locale: string | null }>>(
      `SELECT DISTINCT u.email, u.locale
       FROM document_workflow_participants p
       JOIN users u ON u.id = p.user_id AND u.tenant_id = p.tenant_id
       WHERE p.workflow_id = $1
         AND coalesce(u.status, '') = 'enabled'
         AND coalesce(u.email, '') <> ''`,
      [workflow.id],
    );
    const recipients = new Map<string, { email: string; locale: string | null }>();
    for (const recipient of await this.knowledge.getDocumentNotificationRecipients(manager, document.id, [workflow.requested_by, userId])) {
      recipients.set(recipient.email, recipient);
    }
    for (const row of participantEmails) {
      const email = String(row.email || '').trim();
      if (email && !recipients.has(email)) {
        recipients.set(email, { email, locale: row.locale ?? null });
      }
    }

    const documentUrl = this.knowledge.buildKnowledgeDocumentUrl(appBaseUrl, document.item_number);
    const actorName = await this.knowledge.getUserDisplayName(userId, manager);
    await this.knowledge.sendWorkflowEmail(Array.from(recipients.values()), (locale) => buildKnowledgeWorkflowCancelledEmail({
      documentRef: `DOC-${document.item_number}`,
      documentTitle: document.title,
      documentUrl,
      actorName,
      locale,
    }));

    return this.knowledge.get(documentId, { manager, userId });
  }
}
