import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { AiMutationWriteToolName } from '../ai.types';
import { AddIncidentNoteAiMutationOperation } from './operations/add-incident-note.ai-mutation-operation';
import { AddTaskCommentAiMutationOperation } from './operations/add-task-comment.ai-mutation-operation';
import { ChangeIncidentStateAiMutationOperation } from './operations/change-incident-state.ai-mutation-operation';
import { CreateDocumentAiMutationOperation } from './operations/create-document.ai-mutation-operation';
import { CreateBusinessRecordAiMutationOperation } from './operations/create-business-record.ai-mutation-operation';
import { CreateMasterDataRecordAiMutationOperation } from './operations/create-master-data-record.ai-mutation-operation';
import { CreateTaskAiMutationOperation } from './operations/create-task.ai-mutation-operation';
import { DeleteRecordAiMutationOperation } from './operations/delete-record.ai-mutation-operation';
import { ImportGlpiTicketAiMutationOperation, ImportTicketAiMutationOperation } from './operations/import-glpi-ticket.ai-mutation-operation';
import { SetIncidentConfidentialityAiMutationOperation } from './operations/set-incident-confidentiality.ai-mutation-operation';
import { UpdateDocumentContentAiMutationOperation } from './operations/update-document-content.ai-mutation-operation';
import { UpdateDocumentMetadataAiMutationOperation } from './operations/update-document-metadata.ai-mutation-operation';
import { UpdateDocumentRelationsAiMutationOperation } from './operations/update-document-relations.ai-mutation-operation';
import { UpdateBusinessRecordAiMutationOperation } from './operations/update-business-record.ai-mutation-operation';
import { UpdateEntityRelationsAiMutationOperation } from './operations/update-entity-relations.ai-mutation-operation';
import { UpdateIncidentLinksAiMutationOperation } from './operations/update-incident-links.ai-mutation-operation';
import { UpdateTechnologyLinksAiMutationOperation } from './operations/update-technology-links.ai-mutation-operation';
import { UpdateTechnologyPeopleAiMutationOperation } from './operations/update-technology-people.ai-mutation-operation';
import { UpdateTechnologyWebLinksAiMutationOperation } from './operations/update-technology-web-links.ai-mutation-operation';
import { SetTechnologyVulnerabilityAlertsAiMutationOperation } from './operations/set-technology-vulnerability-alerts.ai-mutation-operation';
import { ChangeVulnerabilityStateAiMutationOperation } from './operations/change-vulnerability-state.ai-mutation-operation';
import { UpdateTechnologyVersionsAiMutationOperation } from './operations/update-technology-versions.ai-mutation-operation';
import { UpdateMasterDataRecordAiMutationOperation } from './operations/update-master-data-record.ai-mutation-operation';
import { UpdateTaskAssigneeAiMutationOperation } from './operations/update-task-assignee.ai-mutation-operation';
import { UpdateTaskFieldsAiMutationOperation } from './operations/update-task-fields.ai-mutation-operation';
import { UpdateTaskStatusAiMutationOperation } from './operations/update-task-status.ai-mutation-operation';
import { WriteFinancialPlanAiMutationOperation } from './operations/write-financial-plan.ai-mutation-operation';
import { AiMutationOperation } from './ai-mutation-operation.types';

@Injectable()
export class AiMutationOperationRegistry {
  private readonly operations = new Map<AiMutationWriteToolName, AiMutationOperation<any>>();

  constructor(
    importGlpiTicket: ImportGlpiTicketAiMutationOperation,
    createDocument: CreateDocumentAiMutationOperation,
    createTask: CreateTaskAiMutationOperation,
    createMasterDataRecord: CreateMasterDataRecordAiMutationOperation,
    createBusinessRecord: CreateBusinessRecordAiMutationOperation,
    writeFinancialPlan: WriteFinancialPlanAiMutationOperation,
    updateDocumentContent: UpdateDocumentContentAiMutationOperation,
    updateDocumentMetadata: UpdateDocumentMetadataAiMutationOperation,
    updateDocumentRelations: UpdateDocumentRelationsAiMutationOperation,
    updateMasterDataRecord: UpdateMasterDataRecordAiMutationOperation,
    updateBusinessRecord: UpdateBusinessRecordAiMutationOperation,
    updateEntityRelations: UpdateEntityRelationsAiMutationOperation,
    updateIncidentLinks: UpdateIncidentLinksAiMutationOperation,
    updateTechnologyLinks: UpdateTechnologyLinksAiMutationOperation,
    updateTechnologyVersions: UpdateTechnologyVersionsAiMutationOperation,
    updateTechnologyPeople: UpdateTechnologyPeopleAiMutationOperation,
    updateTechnologyWebLinks: UpdateTechnologyWebLinksAiMutationOperation,
    setTechnologyVulnerabilityAlerts: SetTechnologyVulnerabilityAlertsAiMutationOperation,
    changeVulnerabilityState: ChangeVulnerabilityStateAiMutationOperation,
    updateTaskFields: UpdateTaskFieldsAiMutationOperation,
    updateTaskStatus: UpdateTaskStatusAiMutationOperation,
    updateTaskAssignee: UpdateTaskAssigneeAiMutationOperation,
    addIncidentNote: AddIncidentNoteAiMutationOperation,
    changeIncidentState: ChangeIncidentStateAiMutationOperation,
    setIncidentConfidentiality: SetIncidentConfidentialityAiMutationOperation,
    addTaskComment: AddTaskCommentAiMutationOperation,
    deleteRecord: DeleteRecordAiMutationOperation,
    @Optional()
    importTicket?: ImportTicketAiMutationOperation,
  ) {
    for (const operation of [
      ...(importTicket ? [importTicket] : []),
      importGlpiTicket,
      createDocument,
      createTask,
      createMasterDataRecord,
      createBusinessRecord,
      writeFinancialPlan,
      updateDocumentContent,
      updateDocumentMetadata,
      updateDocumentRelations,
      updateMasterDataRecord,
      updateBusinessRecord,
      updateEntityRelations,
      updateIncidentLinks,
      updateTechnologyLinks,
      updateTechnologyVersions,
      updateTechnologyPeople,
      updateTechnologyWebLinks,
      setTechnologyVulnerabilityAlerts,
      changeVulnerabilityState,
      updateTaskFields,
      updateTaskStatus,
      updateTaskAssignee,
      addIncidentNote,
      changeIncidentState,
      setIncidentConfidentiality,
      addTaskComment,
      deleteRecord,
    ]) {
      this.operations.set(operation.toolName, operation);
    }
  }

  listOperations(): AiMutationOperation<any>[] {
    return Array.from(this.operations.values());
  }

  getOperation<TInput = unknown>(toolName: string): AiMutationOperation<TInput> {
    const operation = this.operations.get(toolName as AiMutationWriteToolName);
    if (!operation) {
      throw new BadRequestException('Unsupported preview type.');
    }
    return operation as AiMutationOperation<TInput>;
  }

  getOperationOrNull(toolName: string): AiMutationOperation<any> | null {
    return this.operations.get(toolName as AiMutationWriteToolName) ?? null;
  }

  isSupportedToolName(toolName: string): toolName is AiMutationWriteToolName {
    return this.operations.has(toolName as AiMutationWriteToolName);
  }

  getReversibleToolNames(): AiMutationWriteToolName[] {
    return this.listOperations()
      .filter((operation) => operation.writePreview.reversible)
      .map((operation) => operation.toolName);
  }
}
