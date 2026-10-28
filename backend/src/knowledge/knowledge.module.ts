import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CommonModule } from '../common/common.module';
import { StorageModule } from '../common/storage/storage.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { DocumentActivity } from './document-activity.entity';
import { DocumentApplication } from './document-application.entity';
import { DocumentAsset } from './document-asset.entity';
import { DocumentAttachment } from './document-attachment.entity';
import { DocumentClassification } from './document-classification.entity';
import { DocumentContributor } from './document-contributor.entity';
import { DocumentEditLock } from './document-edit-lock.entity';
import { DocumentFolder } from './document-folder.entity';
import { DocumentIncident } from './document-incident.entity';
import { IntegratedDocumentBinding } from './integrated-document-binding.entity';
import { IntegratedDocumentsService } from './integrated-documents.service';
import { IntegratedDocumentSlotSetting } from './integrated-document-slot-setting.entity';
import { DocumentLibrary } from './document-library.entity';
import { DocumentLibraryMember } from './document-library-member.entity';
import { DocumentProject } from './document-project.entity';
import { DocumentReference } from './document-reference.entity';
import { DocumentRequest } from './document-request.entity';
import { DocumentTask } from './document-task.entity';
import { DocumentType } from './document-type.entity';
import { DocumentVersion } from './document-version.entity';
import { DocumentWorkflowParticipant } from './document-workflow-participant.entity';
import { DocumentWorkflow } from './document-workflow.entity';
import { Document } from './document.entity';
import { KnowledgeController } from './knowledge.controller';
import { DocumentFoldersController } from './document-folders.controller';
import { DocumentLibrariesController } from './document-libraries.controller';
import { KnowledgeRelationsService } from './knowledge-relations.service';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeWorkflowService } from './knowledge-workflow.service';
import { DocumentTypesController } from './document-types.controller';
import { InlineImageResolverService } from './inline-image-resolver.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      DocumentFolder,
      IntegratedDocumentBinding,
      IntegratedDocumentSlotSetting,
      DocumentLibrary,
      DocumentLibraryMember,
      DocumentType,
      DocumentVersion,
      DocumentEditLock,
      DocumentAttachment,
      DocumentActivity,
      DocumentContributor,
      DocumentClassification,
      DocumentReference,
      DocumentApplication,
      DocumentAsset,
      DocumentIncident,
      DocumentProject,
      DocumentRequest,
      DocumentTask,
      DocumentWorkflow,
      DocumentWorkflowParticipant,
    ]),
    AuditModule,
    CommonModule,
    StorageModule,
    EmailModule,
    NotificationsModule,
    PermissionsModule,
    forwardRef(() => UsersModule),
  ],
  controllers: [
    KnowledgeController,
    DocumentFoldersController,
    DocumentLibrariesController,
    DocumentTypesController,
  ],
  providers: [
    KnowledgeService,
    KnowledgeRelationsService,
    KnowledgeWorkflowService,
    IntegratedDocumentsService,
    InlineImageResolverService,
  ],
  exports: [
    KnowledgeService,
    KnowledgeRelationsService,
    KnowledgeWorkflowService,
    IntegratedDocumentsService,
    InlineImageResolverService,
    TypeOrmModule,
  ],
})
export class KnowledgeModule {}
