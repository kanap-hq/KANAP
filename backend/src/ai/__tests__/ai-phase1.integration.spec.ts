import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Application } from '../../applications/application.entity';
import { ApplicationsListService } from '../../applications/services/applications-list.service';
import { Asset } from '../../assets/asset.entity';
import { AssetsListService } from '../../assets/services/assets-list.service';
import { Company } from '../../companies/company.entity';
import { CompaniesService } from '../../companies/companies.service';
import dataSource from '../../data-source';
import { Department } from '../../departments/department.entity';
import { DepartmentsService } from '../../departments/departments.service';
import { ContractAttachment } from '../../contracts/contract-attachment.entity';
import { ContractLink } from '../../contracts/contract-link.entity';
import { ContractSpendItem } from '../../contracts/contract-spend-item.entity';
import { Contract } from '../../contracts/contract.entity';
import { ContractsService } from '../../contracts/contracts.service';
import { DocumentActivity } from '../../knowledge/document-activity.entity';
import { DocumentApplication } from '../../knowledge/document-application.entity';
import { DocumentAsset } from '../../knowledge/document-asset.entity';
import { DocumentAttachment as KnowledgeDocumentAttachment } from '../../knowledge/document-attachment.entity';
import { DocumentClassification } from '../../knowledge/document-classification.entity';
import { DocumentContributor } from '../../knowledge/document-contributor.entity';
import { DocumentEditLock } from '../../knowledge/document-edit-lock.entity';
import { DocumentFolder } from '../../knowledge/document-folder.entity';
import { DocumentLibrary } from '../../knowledge/document-library.entity';
import { DocumentProject } from '../../knowledge/document-project.entity';
import { DocumentReference } from '../../knowledge/document-reference.entity';
import { DocumentRequest } from '../../knowledge/document-request.entity';
import { DocumentTask } from '../../knowledge/document-task.entity';
import { DocumentType } from '../../knowledge/document-type.entity';
import { DocumentVersion } from '../../knowledge/document-version.entity';
import { Document } from '../../knowledge/document.entity';
import { IntegratedDocumentBinding } from '../../knowledge/integrated-document-binding.entity';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { AiPhase1RlsRepair1844200000000 } from '../../migrations/1844200000000-ai-phase1-rls-repair';
import { PortfolioRequest } from '../../portfolio/portfolio-request.entity';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { PortfolioProject } from '../../portfolio/portfolio-project.entity';
import { PortfolioProjectsListService } from '../../portfolio/services/portfolio-projects-list.service';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import { BudgetSummaryOracle } from '../../spend/__tests__/oracle/budget-summary.oracle';
import { TasksService } from '../../spend/tasks.service';
import { Supplier } from '../../suppliers/supplier.entity';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { AiAdminOverviewService } from '../ai-admin-overview.service';
import { AiEntityService } from '../ai-entity.service';
import { AiToolRegistry } from '../ai-tool.registry';
import { AiToolName } from '../ai.types';
import { AiConversationRetentionService } from '../../cleanup/ai-conversation-retention.service';
import { AiAggregateExecutor } from '../query/ai-aggregate.executor';
import { AiQueryExecutor } from '../query/ai-query.executor';
import { adaptFilters } from '../query/ai-filter.adapter';
import { getAiEntityRegistry } from '../query/registries';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Tenant } from '../../tenants/tenant.entity';
import { Location } from '../../locations/location.entity';

type SeededGraph = {
  applicationId: string;
  applicationVersion: string;
  suiteApplicationId: string;
  suiteApplicationVersion: string;
  assetId: string;
  relatedAssetId: string;
  appInstanceId: string;
  projectId: string;
  phaseId: string;
  phaseName: string;
  requestId: string;
  taskId: string;
};

type SeededKnowledge = {
  libraryId: string;
  documentTypeId: string;
  documentId: string;
};

type SeededPerson = {
  id: string;
  email: string;
  name: string;
};

type SeededAiPeople = {
  projectBusinessLead: SeededPerson;
  projectItLead: SeededPerson;
  projectContributor: SeededPerson;
  requestRequestor: SeededPerson;
  requestBusinessLead: SeededPerson;
  requestItLead: SeededPerson;
  requestContributor: SeededPerson;
  taskCreator: SeededPerson;
  applicationBusinessOwner: SeededPerson;
  applicationItOwner: SeededPerson;
};

type ScopedAiUsers = {
  actor: SeededPerson;
  teammate: SeededPerson;
  outsider: SeededPerson;
  teamId: string;
  teamName: string;
};

type SeededContextEnhancements = {
  integratedProjectDocumentId: string;
  projectComment: string;
  taskComment: string;
};

async function seedTenant(runner: any, tenantId: string, slug: string, name: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, name],
  );
}

async function seedRole(runner: any, tenantId: string, roleName: string) {
  await setCurrentTenant(runner, tenantId);
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (
       id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, false, false, now(), now())`,
    [roleId, tenantId, roleName, `${roleName} role`],
  );
  return roleId;
}

async function seedCompany(
  runner: any,
  tenantId: string,
  name: string,
) {
  await setCurrentTenant(runner, tenantId);
  const companyId = randomUUID();
  await runner.query(
    `INSERT INTO companies (
       id, tenant_id, coa_id, name, country_iso, city, address1, address2, postal_code, reg_number,
       vat_number, state, base_currency, notes, status, disabled_at, created_at, updated_at
     )
     VALUES ($1, $2, null, $3, 'FR', 'Paris', null, null, null, null, null, null, 'EUR', null, 'enabled', null, now(), now())`,
    [companyId, tenantId, name],
  );
  return companyId;
}

async function seedDepartment(
  runner: any,
  tenantId: string,
  companyId: string,
  name: string,
) {
  await setCurrentTenant(runner, tenantId);
  const departmentId = randomUUID();
  await runner.query(
    `INSERT INTO departments (
       id, tenant_id, company_id, name, description, status, disabled_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 'enabled', null, now(), now())`,
    [departmentId, tenantId, companyId, name, `${name} department`],
  );
  return departmentId;
}

async function seedSupplier(
  runner: any,
  tenantId: string,
  name: string,
  erpSupplierId: string,
) {
  await setCurrentTenant(runner, tenantId);
  const supplierId = randomUUID();
  await runner.query(
    `INSERT INTO suppliers (
       id, tenant_id, name, erp_supplier_id, notes, status, disabled_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 'enabled', null, now(), now())`,
    [supplierId, tenantId, name, erpSupplierId, `${name} notes`],
  );
  return supplierId;
}

async function seedContract(
  runner: any,
  tenantId: string,
  opts: {
    companyId: string;
    supplierId: string;
    name: string;
    startDate: string;
    durationMonths: number;
    autoRenewal: boolean;
    noticePeriodMonths: number;
    yearlyAmount: number;
    currency?: string;
    billingFrequency?: string;
  },
) {
  await setCurrentTenant(runner, tenantId);
  const contractId = randomUUID();
  await runner.query(
    `INSERT INTO contracts (
       id, tenant_id, name, status, disabled_at, company_id, supplier_id, owner_user_id,
       start_date, duration_months, auto_renewal, notice_period_months, yearly_amount_at_signature,
       currency, billing_frequency, notes, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'enabled', null, $4, $5, null,
       $6, $7, $8, $9, $10, $11, $12, $13, now(), now()
     )`,
    [
      contractId,
      tenantId,
      opts.name,
      opts.companyId,
      opts.supplierId,
      opts.startDate,
      opts.durationMonths,
      opts.autoRenewal,
      opts.noticePeriodMonths,
      opts.yearlyAmount,
      opts.currency ?? 'EUR',
      opts.billingFrequency ?? 'annual',
      `${opts.name} notes`,
    ],
  );
  return contractId;
}

async function seedUser(
  runner: any,
  tenantId: string,
  userId: string,
  email: string,
  roleId: string,
  opts?: {
    firstName?: string;
    lastName?: string;
    companyId?: string | null;
    departmentId?: string | null;
    jobTitle?: string | null;
    locale?: string | null;
    status?: string | null;
  },
) {
  await setCurrentTenant(runner, tenantId);
  await runner.query(
    `INSERT INTO users (
       id, tenant_id, company_id, department_id, first_name, last_name, email, job_title, locale, role_id, status, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())`,
    [
      userId,
      tenantId,
      opts?.companyId ?? null,
      opts?.departmentId ?? null,
      opts?.firstName || null,
      opts?.lastName || null,
      email,
      opts?.jobTitle ?? null,
      opts?.locale ?? null,
      roleId,
      opts?.status ?? 'enabled',
    ],
  );
}

async function seedAiPeopleAssignments(
  runner: any,
  tenantId: string,
  graph: SeededGraph,
  tag: string,
): Promise<SeededAiPeople> {
  const roleId = await seedRole(runner, tenantId, `AI People ${tag}`);

  const createPerson = async (slug: string, firstName: string, lastName: string): Promise<SeededPerson> => {
    const id = randomUUID();
    const email = `${slug}-${tag}-${tenantId.slice(0, 8)}@example.com`;
    await seedUser(runner, tenantId, id, email, roleId, { firstName, lastName });
    return { id, email, name: `${firstName} ${lastName}` };
  };

  const people: SeededAiPeople = {
    projectBusinessLead: await createPerson('project-biz', 'Paula', `ProjectBiz${tag}`),
    projectItLead: await createPerson('project-it', 'Peter', `ProjectIt${tag}`),
    projectContributor: await createPerson('project-contrib', 'Casey', `ProjectContrib${tag}`),
    requestRequestor: await createPerson('requestor', 'Ronan', `Requestor${tag}`),
    requestBusinessLead: await createPerson('request-biz', 'Rita', `RequestBiz${tag}`),
    requestItLead: await createPerson('request-it', 'Iris', `RequestIt${tag}`),
    requestContributor: await createPerson('request-contrib', 'Remy', `RequestContrib${tag}`),
    taskCreator: await createPerson('task-creator', 'Taylor', `TaskCreator${tag}`),
    applicationBusinessOwner: await createPerson('app-biz-owner', 'Bianca', `AppBizOwner${tag}`),
    applicationItOwner: await createPerson('app-owner', 'Aiden', `AppOwner${tag}`),
  };

  await setCurrentTenant(runner, tenantId);
  await runner.query(
    `UPDATE portfolio_projects
     SET business_lead_id = $1,
         it_lead_id = $2
     WHERE id = $3
       AND tenant_id = $4`,
    [people.projectBusinessLead.id, people.projectItLead.id, graph.projectId, tenantId],
  );
  await runner.query(
    `INSERT INTO portfolio_project_team (id, tenant_id, project_id, user_id, role, created_at)
     VALUES ($1, $2, $3, $4, 'business_team', now())`,
    [randomUUID(), tenantId, graph.projectId, people.projectContributor.id],
  );

  await runner.query(
    `UPDATE portfolio_requests
     SET requestor_id = $1,
         business_lead_id = $2,
         it_lead_id = $3
     WHERE id = $4
       AND tenant_id = $5`,
    [people.requestRequestor.id, people.requestBusinessLead.id, people.requestItLead.id, graph.requestId, tenantId],
  );
  await runner.query(
    `INSERT INTO portfolio_request_team (id, tenant_id, request_id, user_id, role, created_at)
     VALUES ($1, $2, $3, $4, 'it_team', now())`,
    [randomUUID(), tenantId, graph.requestId, people.requestContributor.id],
  );

  await runner.query(
    `UPDATE tasks
     SET creator_id = $1
     WHERE id = $2
       AND tenant_id = $3`,
    [people.taskCreator.id, graph.taskId, tenantId],
  );

  await runner.query(
    `INSERT INTO application_owners (id, tenant_id, application_id, user_id, owner_type, created_at)
     VALUES ($1, $2, $3, $4, 'business', now())`,
    [randomUUID(), tenantId, graph.applicationId, people.applicationBusinessOwner.id],
  );

  await runner.query(
    `INSERT INTO application_owners (id, tenant_id, application_id, user_id, owner_type, created_at)
     VALUES ($1, $2, $3, $4, 'it', now())`,
    [randomUUID(), tenantId, graph.applicationId, people.applicationItOwner.id],
  );

  return people;
}

async function seedAiScopeUsers(
  runner: any,
  tenantId: string,
  graphs: {
    mePrimary: SeededGraph;
    meSecondary: SeededGraph;
    teamOnly: SeededGraph;
    outsider: SeededGraph;
  },
  tag: string,
): Promise<ScopedAiUsers> {
  const roleId = await seedRole(runner, tenantId, `AI Scope ${tag}`);

  const createPerson = async (slug: string, firstName: string, lastName: string): Promise<SeededPerson> => {
    const id = randomUUID();
    const email = `${slug}-${tag}-${tenantId.slice(0, 8)}@example.com`;
    await seedUser(runner, tenantId, id, email, roleId, { firstName, lastName });
    return { id, email, name: `${firstName} ${lastName}` };
  };

  const users: ScopedAiUsers = {
    actor: await createPerson('actor', 'Avery', `Actor${tag}`),
    teammate: await createPerson('teammate', 'Taylor', `Teammate${tag}`),
    outsider: await createPerson('outsider', 'Olivia', `Outsider${tag}`),
    teamId: randomUUID(),
    teamName: `AI Scope Team ${tag}`,
  };

  await setCurrentTenant(runner, tenantId);
  await runner.query(
    `INSERT INTO portfolio_teams (
       id, tenant_id, name, description, is_active, display_order, is_system, parent_id, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, true, 0, false, null, now(), now())`,
    [users.teamId, tenantId, users.teamName, `AI scope team ${tag}`],
  );

  for (const user of [users.actor, users.teammate]) {
    await runner.query(
      `INSERT INTO portfolio_team_member_configs (
         id, tenant_id, user_id, areas_of_expertise, skills, project_availability, notes, team_id, item_number, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, '[]'::jsonb, '[]'::jsonb, 5, null, $4,
         COALESCE((SELECT MAX(item_number) FROM portfolio_team_member_configs WHERE tenant_id = $2), 0) + 1,
         now(), now()
       )`,
      [randomUUID(), tenantId, user.id, users.teamId],
    );
  }

  await runner.query(
    `UPDATE portfolio_projects
     SET business_lead_id = $1,
         priority_score = 30
     WHERE id = $2
       AND tenant_id = $3`,
    [users.actor.id, graphs.mePrimary.projectId, tenantId],
  );
  await runner.query(
    `UPDATE portfolio_projects
     SET it_lead_id = $1,
         priority_score = 80
     WHERE id = $2
       AND tenant_id = $3`,
    [users.actor.id, graphs.meSecondary.projectId, tenantId],
  );
  await runner.query(
    `UPDATE portfolio_projects
     SET business_lead_id = $1,
         priority_score = 95
     WHERE id = $2
       AND tenant_id = $3`,
    [users.teammate.id, graphs.teamOnly.projectId, tenantId],
  );
  await runner.query(
    `UPDATE portfolio_projects
     SET business_lead_id = $1,
         priority_score = 60
     WHERE id = $2
       AND tenant_id = $3`,
    [users.outsider.id, graphs.outsider.projectId, tenantId],
  );

  await runner.query(
    `UPDATE portfolio_requests
     SET requestor_id = $1,
         priority_score = 25
     WHERE id = $2
       AND tenant_id = $3`,
    [users.actor.id, graphs.mePrimary.requestId, tenantId],
  );
  await runner.query(
    `UPDATE portfolio_requests
     SET business_lead_id = $1,
         priority_score = 70
     WHERE id = $2
       AND tenant_id = $3`,
    [users.actor.id, graphs.meSecondary.requestId, tenantId],
  );
  await runner.query(
    `UPDATE portfolio_requests
     SET requestor_id = $1,
         priority_score = 90
     WHERE id = $2
       AND tenant_id = $3`,
    [users.teammate.id, graphs.teamOnly.requestId, tenantId],
  );
  await runner.query(
    `UPDATE portfolio_requests
     SET requestor_id = $1,
         priority_score = 50
     WHERE id = $2
       AND tenant_id = $3`,
    [users.outsider.id, graphs.outsider.requestId, tenantId],
  );

  await runner.query(
    `UPDATE tasks
     SET assignee_user_id = $1
     WHERE id = $2
       AND tenant_id = $3`,
    [users.actor.id, graphs.mePrimary.taskId, tenantId],
  );
  await runner.query(
    `UPDATE tasks
     SET assignee_user_id = $1
     WHERE id = $2
       AND tenant_id = $3`,
    [users.actor.id, graphs.meSecondary.taskId, tenantId],
  );
  await runner.query(
    `UPDATE tasks
     SET assignee_user_id = $1
     WHERE id = $2
       AND tenant_id = $3`,
    [users.teammate.id, graphs.teamOnly.taskId, tenantId],
  );
  await runner.query(
    `UPDATE tasks
     SET assignee_user_id = $1
     WHERE id = $2
       AND tenant_id = $3`,
    [users.outsider.id, graphs.outsider.taskId, tenantId],
  );

  return users;
}

async function setCurrentTenant(runner: any, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function getRlsState(runner: any, table: string) {
  const rows = await runner.query(
    `SELECT c.relrowsecurity AS enabled,
            c.relforcerowsecurity AS forced
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = $1`,
    [table],
  );
  return rows[0] ?? { enabled: false, forced: false };
}

async function hasTenantIsolationPolicy(runner: any, table: string) {
  const rows = await runner.query(
    `SELECT 1
     FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = $1
       AND policyname = $2`,
    [table, `${table}_tenant_isolation`],
  );
  return rows.length === 1;
}

async function seedApplicationAssetGraph(
  runner: any,
  tenantId: string,
  tag: string,
  opts?: {
    applicationName?: string;
    assetName?: string;
    requestName?: string;
    projectName?: string;
    taskTitle?: string;
  },
): Promise<SeededGraph> {
  await setCurrentTenant(runner, tenantId);

  const ids: SeededGraph = {
    applicationId: randomUUID(),
    applicationVersion: `2026.${tag}.1`,
    suiteApplicationId: randomUUID(),
    suiteApplicationVersion: `2026.${tag}.0`,
    assetId: randomUUID(),
    relatedAssetId: randomUUID(),
    appInstanceId: randomUUID(),
    projectId: randomUUID(),
    phaseId: randomUUID(),
    phaseName: `Execution ${tag}`,
    requestId: randomUUID(),
    taskId: randomUUID(),
  };

  await runner.query(
    `INSERT INTO applications (
       id, tenant_id, name, category, description, criticality, data_class,
       hosting_model, version, users_mode, users_year, environment, lifecycle, status,
       created_at, updated_at
     )
     VALUES
       ($1, $2, $3, 'line_of_business', $4, 'high', 'internal', 'saas', $5, 'manual', 250, 'prod', 'active', 'enabled', now(), now()),
       ($6, $2, $7, 'line_of_business', $8, 'medium', 'internal', 'saas', $9, 'manual', 120, 'prod', 'active', 'enabled', now(), now())`,
    [
      ids.applicationId,
      tenantId,
      opts?.applicationName ?? `Shared Boundary Application ${tag}`,
      `Primary application ${tag}`,
      ids.applicationVersion,
      ids.suiteApplicationId,
      `Suite Application ${tag}`,
      `Suite application ${tag}`,
      ids.suiteApplicationVersion,
    ],
  );

  await runner.query(
    `INSERT INTO assets (
       id, tenant_id, name, kind, provider, environment, hostname, fqdn, status, notes, created_at, updated_at
     )
     VALUES
       ($1, $2, $3, 'vm', 'aws', 'prod', $4, $5, 'active', $6, now(), now()),
       ($7, $2, $8, 'vm', 'aws', 'prod', $9, $10, 'active', $11, now(), now())`,
    [
      ids.assetId,
      tenantId,
      opts?.assetName ?? `Shared Boundary Asset ${tag}`,
      `asset-${tag}`,
      `asset-${tag}.example.com`,
      `Primary asset ${tag}`,
      ids.relatedAssetId,
      `Related Asset ${tag}`,
      `asset-related-${tag}`,
      `asset-related-${tag}.example.com`,
      `Related asset ${tag}`,
    ],
  );

  await runner.query(
    `INSERT INTO app_instances (
       id, tenant_id, application_id, environment, lifecycle, sso_enabled, mfa_supported,
       status, base_url, notes, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'prod', 'active', true, true, 'enabled', $4, $5, now(), now())`,
    [
      ids.appInstanceId,
      tenantId,
      ids.applicationId,
      `https://app-${tag}.example.com`,
      `Primary instance ${tag}`,
    ],
  );

  await runner.query(
    `INSERT INTO app_asset_assignments (
       tenant_id, app_instance_id, asset_id, role, notes, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'primary', $4, now(), now())`,
    [tenantId, ids.appInstanceId, ids.assetId, `Primary assignment ${tag}`],
  );

  await runner.query(
    `INSERT INTO portfolio_projects (
       id, tenant_id, item_number, name, origin, status, execution_progress, planned_end, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'fast_track', 'planned', 25, DATE '2026-12-31', now(), now())`,
    [
      ids.projectId,
      tenantId,
      Number(tag.replace(/\D/g, '').slice(0, 4) || '9301'),
      opts?.projectName ?? `Shared Boundary Project ${tag}`,
    ],
  );

  await runner.query(
    `INSERT INTO portfolio_project_phases (
       id, tenant_id, project_id, name, sequence, planned_start, planned_end, status, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 0, DATE '2026-01-15', DATE '2026-06-30', 'in_progress', now(), now())`,
    [ids.phaseId, tenantId, ids.projectId, ids.phaseName],
  );

  await runner.query(
    `INSERT INTO tasks (
       id, tenant_id, item_number, title, description, status, related_object_type, related_object_id, phase_id,
       labels, owner_ids, viewer_ids, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, 'open', 'project', $6, $7,
       '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now()
     )`,
    [
      ids.taskId,
      tenantId,
      Number(tag.replace(/\D/g, '').slice(0, 4) || '9101'),
      opts?.taskTitle ?? `Shared Boundary Task ${tag}`,
      `Shared boundary task ${tag}`,
      ids.projectId,
      ids.phaseId,
    ],
  );

  await runner.query(
    `INSERT INTO portfolio_requests (
       id, tenant_id, item_number, name, status, current_situation, expected_benefits,
       origin_task_id, criteria_values, feasibility_review, priority_override, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, 'pending_review', $5, $6, $7,
       '{}'::jsonb, '{}'::jsonb, false, now(), now()
     )`,
    [
      ids.requestId,
      tenantId,
      Number(tag.replace(/\D/g, '').slice(0, 4) || '9201'),
      opts?.requestName ?? `Shared Boundary Request ${tag}`,
      `Current situation ${tag}`,
      `Expected benefits ${tag}`,
      ids.taskId,
    ],
  );

  await runner.query(
    `INSERT INTO application_projects (tenant_id, application_id, project_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, ids.applicationId, ids.projectId],
  );
  await runner.query(
    `INSERT INTO asset_projects (tenant_id, asset_id, project_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, ids.assetId, ids.projectId],
  );
  await runner.query(
    `INSERT INTO portfolio_request_applications (tenant_id, request_id, application_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, ids.requestId, ids.applicationId],
  );
  await runner.query(
    `INSERT INTO portfolio_request_assets (tenant_id, request_id, asset_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, ids.requestId, ids.assetId],
  );
  await runner.query(
    `INSERT INTO application_suites (tenant_id, application_id, suite_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, ids.applicationId, ids.suiteApplicationId],
  );
  await runner.query(
    `INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type, notes, created_at)
     VALUES ($1, $2, $3, 'depends_on', $4, now())`,
    [tenantId, ids.assetId, ids.relatedAssetId, `Asset relation ${tag}`],
  );

  return ids;
}

async function seedKnowledgeGraph(
  runner: any,
  tenantId: string,
  graph: SeededGraph,
  tag: string,
  opts?: {
    documentTitle?: string;
    documentSummary?: string;
  },
): Promise<SeededKnowledge> {
  await setCurrentTenant(runner, tenantId);

  const knowledge: SeededKnowledge = {
    libraryId: randomUUID(),
    documentTypeId: randomUUID(),
    documentId: randomUUID(),
  };

  await runner.query(
    `INSERT INTO document_libraries (
       id, tenant_id, name, slug, is_system, display_order, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, false, 0, now(), now())`,
    [knowledge.libraryId, tenantId, `Knowledge ${tag}`, `knowledge-${tag}`],
  );

  await runner.query(
    `INSERT INTO document_types (
       id, tenant_id, name, description, template_content, is_active, is_system, is_default, system_key, display_order, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, null, true, false, false, null, 0, now(), now())`,
    [knowledge.documentTypeId, tenantId, `Runbook ${tag}`, `Runbook ${tag}`],
  );

  await runner.query(
    `INSERT INTO documents (
       id, tenant_id, item_number, title, summary, content_markdown, content_plain,
       library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, 'published', 1, 0, now(), now()
     )`,
    [
      knowledge.documentId,
      tenantId,
      Number(tag.replace(/\D/g, '').slice(0, 4) || '7101'),
      opts?.documentTitle ?? `Shared Boundary Knowledge ${tag}`,
      opts?.documentSummary ?? `Knowledge summary ${tag}`,
      `# ${opts?.documentTitle ?? `Shared Boundary Knowledge ${tag}`}`,
      `${opts?.documentTitle ?? `Shared Boundary Knowledge ${tag}`} ${opts?.documentSummary ?? `Knowledge summary ${tag}`}`,
      knowledge.libraryId,
      knowledge.documentTypeId,
    ],
  );

  await runner.query(
    `INSERT INTO document_applications (tenant_id, document_id, application_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, knowledge.documentId, graph.applicationId],
  );
  await runner.query(
    `INSERT INTO document_assets (tenant_id, document_id, asset_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, knowledge.documentId, graph.assetId],
  );
  await runner.query(
    `INSERT INTO document_projects (tenant_id, document_id, project_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, knowledge.documentId, graph.projectId],
  );
  await runner.query(
    `INSERT INTO document_requests (tenant_id, document_id, request_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, knowledge.documentId, graph.requestId],
  );
  await runner.query(
    `INSERT INTO document_tasks (tenant_id, document_id, task_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, knowledge.documentId, graph.taskId],
  );

  return knowledge;
}

async function seedIntegratedKnowledgeDocument(
  runner: any,
  tenantId: string,
  graph: SeededGraph,
  knowledge: SeededKnowledge,
  tag: string,
  sourceEntityType: 'projects' | 'requests',
) {
  await setCurrentTenant(runner, tenantId);

  const documentId = randomUUID();
  const baseNumber = Number(tag.replace(/\D/g, '').slice(0, 4) || '7401');
  const itemNumber = sourceEntityType === 'projects' ? baseNumber + 1000 : baseNumber + 2000;
  const title = sourceEntityType === 'projects'
    ? `Integrated Project Purpose ${tag}`
    : `Integrated Request Purpose ${tag}`;
  const summary = sourceEntityType === 'projects'
    ? `Integrated project document ${tag}`
    : `Integrated request document ${tag}`;
  const sourceEntityId = sourceEntityType === 'projects' ? graph.projectId : graph.requestId;

  await runner.query(
    `INSERT INTO documents (
       id, tenant_id, item_number, title, summary, content_markdown, content_plain,
       library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, 'published', 1, 0, now(), now()
     )`,
    [
      documentId,
      tenantId,
      itemNumber,
      title,
      summary,
      `# ${title}`,
      `${title} ${summary}`,
      knowledge.libraryId,
      knowledge.documentTypeId,
    ],
  );

  await runner.query(
    `INSERT INTO integrated_document_bindings (
       id, tenant_id, source_entity_type, source_entity_id, slot_key,
       document_id, hidden_from_entity_knowledge, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'purpose', $5, true, now(), now())`,
    [randomUUID(), tenantId, sourceEntityType, sourceEntityId, documentId],
  );

  return { documentId };
}

async function seedContextEnhancements(
  runner: any,
  tenantId: string,
  graph: SeededGraph,
  knowledge: SeededKnowledge,
  people: SeededAiPeople,
  tag: string,
): Promise<SeededContextEnhancements> {
  await setCurrentTenant(runner, tenantId);

  const integratedProject = await seedIntegratedKnowledgeDocument(
    runner,
    tenantId,
    graph,
    knowledge,
    tag,
    'projects',
  );

  const projectComment = `Project activity update ${tag}`;
  const taskComment = `Task activity update ${tag}`;

  await runner.query(
    `INSERT INTO portfolio_activities (
       id, tenant_id, project_id, author_id, type, content, changed_fields, created_at, updated_at
     )
     VALUES
       ($1, $2, $3, $4, 'comment', $5, null, now() - interval '2 hour', now() - interval '2 hour'),
       ($6, $2, $3, $7, 'change', null, $8::jsonb, now() - interval '1 hour', now() - interval '1 hour')`,
    [
      randomUUID(),
      tenantId,
      graph.projectId,
      people.projectContributor.id,
      projectComment,
      randomUUID(),
      people.projectBusinessLead.id,
      JSON.stringify({ status: ['planned', 'in_progress'] }),
    ],
  );

  await runner.query(
    `INSERT INTO portfolio_activities (
       id, tenant_id, task_id, author_id, type, content, changed_fields, created_at, updated_at
     )
     VALUES
       ($1, $2, $3, $4, 'comment', $5, null, now() - interval '30 minute', now() - interval '30 minute'),
       ($6, $2, $3, $7, 'change', null, $8::jsonb, now() - interval '10 minute', now() - interval '10 minute')`,
    [
      randomUUID(),
      tenantId,
      graph.taskId,
      people.taskCreator.id,
      taskComment,
      randomUUID(),
      people.projectItLead.id,
      JSON.stringify({ status: ['open', 'in_progress'] }),
    ],
  );

  return {
    integratedProjectDocumentId: integratedProject.documentId,
    projectComment,
    taskComment,
  };
}

async function insertCrossTenantLeakShapes(
  runner: any,
  tenantA: string,
  tenantB: string,
  graphA: SeededGraph,
  graphB: SeededGraph,
) {
  await setCurrentTenant(runner, tenantB);

  const bridgeInstanceId = randomUUID();
  await runner.query(
    `INSERT INTO app_instances (
       id, tenant_id, application_id, environment, lifecycle, sso_enabled, mfa_supported,
       status, base_url, notes, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'qa', 'active', false, false, 'enabled', $4, $5, now(), now())`,
    [
      bridgeInstanceId,
      tenantB,
      graphA.applicationId,
      'https://bridge-tenant-b.example.com',
      'Bridge instance from tenant B into tenant A application',
    ],
  );

  await runner.query(
    `INSERT INTO application_projects (tenant_id, application_id, project_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantB, graphA.applicationId, graphB.projectId],
  );
  await runner.query(
    `INSERT INTO application_suites (tenant_id, application_id, suite_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantB, graphA.applicationId, graphB.suiteApplicationId],
  );
  await runner.query(
    `INSERT INTO portfolio_request_applications (tenant_id, request_id, application_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantB, graphB.requestId, graphA.applicationId],
  );
  await runner.query(
    `INSERT INTO app_asset_assignments (
       tenant_id, app_instance_id, asset_id, role, notes, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'primary', 'Cross-tenant bridge to tenant B asset', now(), now())`,
    [tenantB, bridgeInstanceId, graphB.assetId],
  );

  await runner.query(
    `INSERT INTO app_asset_assignments (
       tenant_id, app_instance_id, asset_id, role, notes, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'secondary', 'Cross-tenant bridge to tenant A asset', now(), now())`,
    [tenantB, graphB.appInstanceId, graphA.assetId],
  );
  await runner.query(
    `INSERT INTO asset_projects (tenant_id, asset_id, project_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantB, graphA.assetId, graphB.projectId],
  );
  await runner.query(
    `INSERT INTO portfolio_request_assets (tenant_id, request_id, asset_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantB, graphB.requestId, graphA.assetId],
  );
  await runner.query(
    `INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type, notes, created_at)
     VALUES ($1, $2, $3, 'depends_on', 'Cross-tenant relation into tenant B asset', now())`,
    [tenantB, graphA.assetId, graphB.relatedAssetId],
  );
}

async function seedLifecycleProbeApplications(
  runner: any,
  tenantId: string,
  prefix: string,
) {
  await setCurrentTenant(runner, tenantId);

  const activeId = randomUUID();
  const retiredId = randomUUID();

  await runner.query(
    `INSERT INTO applications (
       id, tenant_id, name, category, description, criticality, data_class,
       hosting_model, users_mode, users_year, environment, lifecycle, status,
       disabled_at, created_at, updated_at
     )
     VALUES
       ($1, $2, $3, 'line_of_business', $4, 'high', 'internal', 'saas', 'manual', 25, 'prod', 'active', 'enabled', null, now(), now()),
       ($5, $2, $6, 'line_of_business', $7, 'medium', 'internal', 'saas', 'manual', 10, 'prod', 'retired', 'disabled', now() - interval '1 day', now(), now())`,
    [
      activeId,
      tenantId,
      `${prefix} Active`,
      `${prefix} active description`,
      retiredId,
      `${prefix} Retired`,
      `${prefix} retired description`,
    ],
  );

  return { activeId, retiredId };
}

async function disableRls(runner: any, tables: string[]) {
  for (const table of tables) {
    await runner.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
    await runner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  }
}

function getRelatedIdsByRelation(context: any, relation: string) {
  const group = context.related.find((entry: any) => entry.relation === relation);
  return group ? group.items.map((item: any) => item.id).sort() : [];
}

function getPersonName(value: any): string | null {
  if (!value || typeof value !== 'object') return null;
  return typeof value.name === 'string' ? value.name : null;
}

function getPersonNames(value: any): string[] {
  return Array.isArray(value)
    ? value.map((item: any) => getPersonName(item)).filter((item: string | null): item is string => !!item).sort()
    : [];
}

function getMetadataObjectNames(value: any): string[] {
  return Array.isArray(value)
    ? value
      .map((item: any) => (item && typeof item === 'object' && typeof item.name === 'string' ? item.name : null))
      .filter((item: string | null): item is string => !!item)
      .sort()
    : [];
}

function getMetadataObjectName(value: any): string | null {
  return value && typeof value === 'object' && typeof value.name === 'string'
    ? value.name
    : null;
}

async function resolveDocumentId(manager: any, idOrRef: string): Promise<string | null> {
  const raw = String(idOrRef || '').trim();
  if (/^[0-9a-f-]{36}$/i.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(?:DOC-)?(\d+)$/i);
  if (!match) {
    return null;
  }

  const rows = await manager.query(
    `SELECT id
     FROM documents
     WHERE item_number = $1
     LIMIT 1`,
    [Number(match[1])],
  );
  return rows[0]?.id ?? null;
}

function createKnowledgeToolAdapter(manager: any) {
  return {
    async listReadableLibraryIdsForUser() {
      return null;
    },
    async search(query: any, opts?: { manager?: any }) {
      const activeManager = opts?.manager ?? manager;
      const term = String(query?.q || '').trim();
      const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
      const like = `%${term}%`;
      const rows = await activeManager.query(
        `SELECT d.id,
                d.item_number,
                d.title,
                d.summary,
                d.status,
                d.updated_at,
                d.library_id,
                dl.name AS library_name
         FROM documents d
         LEFT JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
         WHERE d.title ILIKE $1
            OR COALESCE(d.summary, '') ILIKE $1
            OR COALESCE(d.content_plain, '') ILIKE $1
         ORDER BY d.updated_at DESC, d.title ASC
         LIMIT $2`,
        [like, limit],
      );

      return {
        items: rows.map((row: any) => ({
          ...row,
          item_ref: `DOC-${row.item_number}`,
          snippet: row.summary ?? null,
        })),
        total: rows.length,
      };
    },

    async get(idOrRef: string, opts?: { manager?: any }) {
      const activeManager = opts?.manager ?? manager;
      const id = await resolveDocumentId(activeManager, idOrRef);
      if (!id) {
        return null;
      }

      const rows = await activeManager.query(
        `SELECT d.id,
                d.item_number,
                d.title,
                d.summary,
                d.status,
                d.content_markdown,
                d.updated_at,
                d.library_id,
                dl.name AS library_name,
                dl.slug AS library_slug,
                d.folder_id,
                f.name AS folder_name,
                d.document_type_id,
                dt.name AS document_type_name
         FROM documents d
         LEFT JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
         LEFT JOIN document_folders f ON f.id = d.folder_id AND f.tenant_id = d.tenant_id
         LEFT JOIN document_types dt ON dt.id = d.document_type_id AND dt.tenant_id = d.tenant_id
         WHERE d.id = $1
         LIMIT 1`,
        [id],
      );
      if (!rows.length) {
        return null;
      }

      const document = rows[0];
      const [
        applicationRows,
        assetRows,
        projectRows,
        requestRows,
        taskRows,
      ] = await Promise.all([
        activeManager.query(
          `SELECT da.application_id, a.name
           FROM document_applications da
           JOIN applications a ON a.id = da.application_id AND a.tenant_id = da.tenant_id
           WHERE da.document_id = $1
           ORDER BY da.created_at ASC`,
          [id],
        ),
        activeManager.query(
          `SELECT da.asset_id, a.name
           FROM document_assets da
           JOIN assets a ON a.id = da.asset_id AND a.tenant_id = da.tenant_id
           WHERE da.document_id = $1
           ORDER BY da.created_at ASC`,
          [id],
        ),
        activeManager.query(
          `SELECT dp.project_id, p.name, p.item_number
           FROM document_projects dp
           JOIN portfolio_projects p ON p.id = dp.project_id AND p.tenant_id = dp.tenant_id
           WHERE dp.document_id = $1
           ORDER BY dp.created_at ASC`,
          [id],
        ),
        activeManager.query(
          `SELECT dr.request_id, r.name, r.item_number
           FROM document_requests dr
           JOIN portfolio_requests r ON r.id = dr.request_id AND r.tenant_id = dr.tenant_id
           WHERE dr.document_id = $1
           ORDER BY dr.created_at ASC`,
          [id],
        ),
        activeManager.query(
          `SELECT dt.task_id, t.title, t.item_number
           FROM document_tasks dt
           JOIN tasks t ON t.id = dt.task_id AND t.tenant_id = dt.tenant_id
           WHERE dt.document_id = $1
           ORDER BY dt.created_at ASC`,
          [id],
        ),
      ]);

      return {
        ...document,
        item_ref: `DOC-${document.item_number}`,
        contributors: [],
        relations: {
          applications: applicationRows.map((row: any) => ({ id: row.application_id, name: row.name })),
          assets: assetRows.map((row: any) => ({ id: row.asset_id, name: row.name })),
          projects: projectRows.map((row: any) => ({ id: row.project_id, name: row.item_number ? `PRJ-${row.item_number} - ${row.name}` : row.name })),
          requests: requestRows.map((row: any) => ({ id: row.request_id, name: row.item_number ? `REQ-${row.item_number} - ${row.name}` : row.name })),
          tasks: taskRows.map((row: any) => ({ id: row.task_id, name: row.item_number ? `T-${row.item_number} - ${row.title || 'Untitled task'}` : (row.title || 'Untitled task') })),
        },
      };
    },

    async getKnowledgeContextForEntity() {
      return {
        access: 'granted',
        total: 0,
        groups: [],
      };
    },

    async list(query: any, opts?: { manager?: any; tenantId?: string }) {
      const activeManager = opts?.manager ?? manager;
      const tenantId = String(opts?.tenantId || '').trim() || null;
      const term = String(query?.q || '').trim();
      const like = term ? `%${term}%` : null;
      const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
      const offset = Math.max(Number(query?.offset) || 0, 0);
      const rows = await activeManager.query(
        `SELECT d.id,
                d.item_number,
                d.title,
                d.summary,
                d.status,
                d.updated_at,
                dl.name AS library_name,
                f.name AS folder_name,
                dt.name AS document_type_name,
                (
                  SELECT COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, c.user_id::text)
                  FROM document_contributors c
                  LEFT JOIN users u ON u.id = c.user_id AND u.tenant_id = d.tenant_id
                  WHERE c.document_id = d.id
                    AND c.tenant_id = d.tenant_id
                    AND c.role = 'owner'
                    AND c.is_primary = true
                  LIMIT 1
                ) AS primary_owner_name
         FROM documents d
         LEFT JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
         LEFT JOIN document_folders f ON f.id = d.folder_id AND f.tenant_id = d.tenant_id
         LEFT JOIN document_types dt ON dt.id = d.document_type_id AND dt.tenant_id = d.tenant_id
         WHERE d.tenant_id = COALESCE($1, app_current_tenant())
           AND (
             $2::text IS NULL
             OR d.title ILIKE $2
             OR COALESCE(d.summary, '') ILIKE $2
             OR COALESCE(d.content_plain, '') ILIKE $2
           )
         ORDER BY d.updated_at DESC, d.title ASC
         LIMIT $3 OFFSET $4`,
        [tenantId, like, limit, offset],
      );

      return {
        items: rows.map((row: any) => ({
          ...row,
          item_ref: `DOC-${row.item_number}`,
        })),
        total: rows.length,
      };
    },

    async listIds(query: any, opts?: { manager?: any; tenantId?: string }) {
      const result = await this.list(query, opts);
      return {
        ids: result.items.map((item: any) => item.id),
        total: result.total,
      };
    },

    async listFilterValues(query: any, opts?: { manager?: any; tenantId?: string }) {
      const activeManager = opts?.manager ?? manager;
      const tenantId = String(opts?.tenantId || '').trim() || null;
      const fields = String(query?.fields || query?.field || '').split(',').map((f) => f.trim()).filter(Boolean);
      const result: Record<string, Array<string | null>> = {};

      for (const field of fields) {
        if (field === 'status') {
          const rows = await activeManager.query(
            `SELECT DISTINCT d.status AS value
             FROM documents d
             WHERE d.tenant_id = COALESCE($1, app_current_tenant())
             ORDER BY 1`,
            [tenantId],
          );
          result[field] = rows.map((row: any) => row.value);
          continue;
        }
        if (field === 'library_name') {
          const rows = await activeManager.query(
            `SELECT DISTINCT dl.name AS value
             FROM documents d
             LEFT JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
             WHERE d.tenant_id = COALESCE($1, app_current_tenant())
             ORDER BY 1`,
            [tenantId],
          );
          result[field] = rows.map((row: any) => row.value);
          continue;
        }
        result[field] = [];
      }

      return result;
    },
  };
}

function createAiQueryHarness(manager: any) {
  const knowledge = createKnowledgeToolAdapter(manager);
  const tasks = new TasksService(dataSource);
  const projects = new PortfolioProjectsListService(manager.getRepository(PortfolioProject));
  const requests = new PortfolioRequestsService(
    manager.getRepository(PortfolioRequest),
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const applications = new ApplicationsListService(manager.getRepository(Application));
  const assets = new AssetsListService(manager.getRepository(Asset));
  const spendItems = {} as any;
  const contracts = {} as any;
  const companies = {} as any;
  const suppliers = {} as any;
  const departments = {} as any;
  const locations = {} as any;
  const users = new UsersService(
    manager.getRepository(User),
    manager.getRepository(Company),
    manager.getRepository(Department),
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const queryExecutor = new AiQueryExecutor(
    tasks as any,
    projects as any,
    requests as any,
    applications as any,
    assets as any,
    spendItems,
    contracts,
    companies,
    suppliers,
    departments,
    knowledge as any,
    locations as any,
    users as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const aggregateExecutor = new AiAggregateExecutor(
    tasks as any,
    projects as any,
    requests as any,
    applications as any,
    assets as any,
    spendItems,
    contracts,
    companies,
    suppliers,
    departments,
    knowledge as any,
    locations as any,
    users as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  return { knowledge, queryExecutor, aggregateExecutor };
}

function createKnowledgeService(manager: any) {
  return new KnowledgeService(
    manager.getRepository(Document),
    manager.getRepository(DocumentFolder),
    manager.getRepository(IntegratedDocumentBinding),
    manager.getRepository(DocumentLibrary),
    manager.getRepository(DocumentType),
    manager.getRepository(DocumentVersion),
    manager.getRepository(DocumentEditLock),
    manager.getRepository(KnowledgeDocumentAttachment),
    manager.getRepository(DocumentActivity),
    manager.getRepository(DocumentContributor),
    manager.getRepository(DocumentClassification),
    manager.getRepository(DocumentReference),
    manager.getRepository(DocumentApplication),
    manager.getRepository(DocumentAsset),
    manager.getRepository(DocumentProject),
    manager.getRepository(DocumentRequest),
    manager.getRepository(DocumentTask),
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    dataSource,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

function createPermissivePolicyStub() {
  return {
    assertSurfaceAccess: async () => undefined,
    listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
    canReadKnowledge: async () => true,
    assertKnowledgeReadAccess: async () => undefined,
    assertEntityTypeReadAccess: async () => undefined,
  } as any;
}

function assertNoTenantLeak(
  toolName: string,
  caseLabel: string,
  result: unknown,
  forbiddenIds: string[],
) {
  const serialized = JSON.stringify(result);
  for (const id of forbiddenIds) {
    assert.equal(
      serialized.includes(id),
      false,
      `${toolName}/${caseLabel} leaked tenant-B id ${id}`,
    );
  }
}

function buildToolIsolationCases(
  toolName: AiToolName,
  fixtures: {
    graphA: SeededGraph;
    graphB: SeededGraph;
    knowledgeA: SeededKnowledge;
    peopleA: SeededAiPeople;
  },
) {
  switch (toolName) {
    case 'get_application_classification_catalog':
      return [{
        label: 'tenant-classification-catalog',
        input: {},
        assertResult: (result: any) => {
          assert.equal(result.durationUnit, 'minutes');
          assert.deepEqual(result.cyberCriticalityLevels, [{
            code: 'custom_cyber', label: 'Tenant A cyber', description: 'Tenant A definition', rank: 7,
          }]);
          assert.equal(result.businessMtdPresets, undefined);
          assert.match(result.businessPolicy, /chosen directly/);
        },
      }];
    case 'search_all':
      return [
        {
          label: 'search-all',
          input: {
            query: 'Shared Boundary',
            entity_types: ['applications', 'assets', 'projects', 'requests', 'tasks', 'documents'],
            limit: 20,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.truncated, false);
            assert.deepEqual(result.failed_entity_types, []);
            assert.equal(
              result.items.some((item: any) => item.id === fixtures.graphA.applicationId),
              true,
            );
            assert.equal(
              result.items.some((item: any) => item.id === fixtures.graphA.assetId),
              true,
            );
            assert.equal(
              result.items.some((item: any) => item.id === fixtures.graphA.projectId),
              true,
            );
            assert.equal(
              result.items.some((item: any) => item.id === fixtures.graphA.requestId),
              true,
            );
            assert.equal(
              result.items.some((item: any) => item.id === fixtures.graphA.taskId),
              true,
            );
            assert.equal(
              result.items.some((item: any) => item.id === fixtures.knowledgeA.documentId),
              true,
            );
          },
        },
        {
          label: 'projects-business-lead',
          input: {
            query: fixtures.peopleA.projectBusinessLead.name,
            entity_types: ['projects'],
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.projectId]);
            assert.equal(result.items[0].metadata.business_lead, fixtures.peopleA.projectBusinessLead.name);
          },
        },
        {
          label: 'projects-contributors',
          input: {
            query: fixtures.peopleA.projectContributor.name,
            entity_types: ['projects'],
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.projectId]);
            assert.equal(String(result.items[0].metadata.contributors).includes(fixtures.peopleA.projectContributor.name), true);
          },
        },
        {
          label: 'requests-business-lead',
          input: {
            query: fixtures.peopleA.requestBusinessLead.name,
            entity_types: ['requests'],
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.requestId]);
            assert.equal(result.items[0].metadata.business_lead, fixtures.peopleA.requestBusinessLead.name);
          },
        },
        {
          label: 'requests-contributors',
          input: {
            query: fixtures.peopleA.requestContributor.name,
            entity_types: ['requests'],
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.requestId]);
            assert.equal(String(result.items[0].metadata.contributors).includes(fixtures.peopleA.requestContributor.name), true);
          },
        },
        {
          label: 'tasks-creator',
          input: {
            query: fixtures.peopleA.taskCreator.name,
            entity_types: ['tasks'],
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.taskId]);
            assert.equal(result.items[0].metadata.creator, fixtures.peopleA.taskCreator.name);
          },
        },
        {
          label: 'applications-business-owner',
          input: {
            query: fixtures.peopleA.applicationBusinessOwner.name,
            entity_types: ['applications'],
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.applicationId]);
            assert.equal(String(result.items[0].metadata.business_owner).includes(fixtures.peopleA.applicationBusinessOwner.name), true);
            assert.equal(result.items[0].metadata.version, fixtures.graphA.applicationVersion);
          },
        },
        {
          label: 'applications-it-owner',
          input: {
            query: fixtures.peopleA.applicationItOwner.name,
            entity_types: ['applications'],
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.applicationId]);
            assert.equal(String(result.items[0].metadata.it_owner).includes(fixtures.peopleA.applicationItOwner.name), true);
            assert.equal(result.items[0].metadata.version, fixtures.graphA.applicationVersion);
          },
        },
      ];

    case 'get_entity_context':
      return [
        {
          label: 'applications',
          input: { entity_type: 'applications', entity_id: fixtures.graphA.applicationId },
          assertResult: (result: any) => {
            assert.equal(result.total, 1);
            assert.equal(result.returned, 1);
            assert.equal(result.truncated, false);
            assert.equal(result.complete, true);
            assert.equal(result.entity.id, fixtures.graphA.applicationId);
            assert.deepEqual(getRelatedIdsByRelation(result, 'linked_requests'), [fixtures.graphA.requestId]);
            assert.deepEqual(getRelatedIdsByRelation(result, 'linked_projects'), [fixtures.graphA.projectId]);
            assert.deepEqual(getPersonNames(result.entity.metadata.it_owners), [fixtures.peopleA.applicationItOwner.name]);
            assert.equal(result.entity.metadata.version, fixtures.graphA.applicationVersion);
          },
        },
        {
          label: 'assets',
          input: { entity_type: 'assets', entity_id: fixtures.graphA.assetId },
          assertResult: (result: any) => {
            assert.equal(result.total, 1);
            assert.equal(result.returned, 1);
            assert.equal(result.truncated, false);
            assert.equal(result.complete, true);
            assert.equal(result.entity.id, fixtures.graphA.assetId);
            assert.deepEqual(getRelatedIdsByRelation(result, 'linked_applications'), [fixtures.graphA.applicationId]);
            assert.deepEqual(getRelatedIdsByRelation(result, 'linked_projects'), [fixtures.graphA.projectId]);
          },
        },
        {
          label: 'projects',
          input: { entity_type: 'projects', entity_id: fixtures.graphA.projectId },
          assertResult: (result: any) => {
            assert.equal(result.total, 1);
            assert.equal(result.returned, 1);
            assert.equal(result.truncated, false);
            assert.equal(result.complete, true);
            assert.equal(result.entity.id, fixtures.graphA.projectId);
            assert.deepEqual(getRelatedIdsByRelation(result, 'linked_applications'), [fixtures.graphA.applicationId]);
            assert.deepEqual(getRelatedIdsByRelation(result, 'linked_assets'), [fixtures.graphA.assetId]);
            assert.equal(getPersonName(result.entity.metadata.business_lead), fixtures.peopleA.projectBusinessLead.name);
            assert.equal(getPersonName(result.entity.metadata.it_lead), fixtures.peopleA.projectItLead.name);
            assert.deepEqual(getPersonNames(result.entity.metadata.contributors), [fixtures.peopleA.projectContributor.name]);
            assert.equal(getMetadataObjectNames(result.entity.metadata.phases).includes(fixtures.graphA.phaseName), true);
          },
        },
        {
          label: 'requests',
          input: { entity_type: 'requests', entity_id: fixtures.graphA.requestId },
          assertResult: (result: any) => {
            assert.equal(result.total, 1);
            assert.equal(result.returned, 1);
            assert.equal(result.truncated, false);
            assert.equal(result.complete, true);
            assert.equal(result.entity.id, fixtures.graphA.requestId);
            assert.deepEqual(getRelatedIdsByRelation(result, 'linked_applications'), [fixtures.graphA.applicationId]);
            assert.deepEqual(getRelatedIdsByRelation(result, 'linked_assets'), [fixtures.graphA.assetId]);
            assert.equal(getPersonName(result.entity.metadata.requestor), fixtures.peopleA.requestRequestor.name);
            assert.equal(getPersonName(result.entity.metadata.business_lead), fixtures.peopleA.requestBusinessLead.name);
            assert.equal(getPersonName(result.entity.metadata.it_lead), fixtures.peopleA.requestItLead.name);
            assert.deepEqual(getPersonNames(result.entity.metadata.contributors), [fixtures.peopleA.requestContributor.name]);
          },
        },
        {
          label: 'tasks',
          input: { entity_type: 'tasks', entity_id: fixtures.graphA.taskId },
          assertResult: (result: any) => {
            assert.equal(result.total, 1);
            assert.equal(result.returned, 1);
            assert.equal(result.truncated, false);
            assert.equal(result.complete, true);
            assert.equal(result.entity.id, fixtures.graphA.taskId);
            assert.deepEqual(getRelatedIdsByRelation(result, 'related_project'), [fixtures.graphA.projectId]);
            assert.deepEqual(getRelatedIdsByRelation(result, 'converted_request'), [fixtures.graphA.requestId]);
            assert.equal(getPersonName(result.entity.metadata.creator), fixtures.peopleA.taskCreator.name);
            assert.equal(getMetadataObjectName(result.entity.metadata.phase), fixtures.graphA.phaseName);
          },
        },
      ];

    case 'get_entity_detail':
      return [
        {
          label: 'tasks-detail',
          input: { entity_type: 'tasks', entity_id: fixtures.graphA.taskId },
          assertResult: (result: any) => {
            assert.equal(result.total, 1);
            assert.equal(result.returned, 1);
            assert.equal(result.truncated, false);
            assert.equal(result.complete, true);
            assert.equal(result.entity.id, fixtures.graphA.taskId);
            assert.equal(result.data.id, fixtures.graphA.taskId);
            assert.equal(result.data.tenant_id, undefined);
          },
        },
      ];

    case 'get_entity_comments':
      return [
        {
          label: 'projects-comments',
          input: {
            entity_type: 'projects',
            entity_id: fixtures.graphA.projectId,
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.entity.id, fixtures.graphA.projectId);
            assert.equal(result.entity.ref, 'PRJ-5101');
            assert.equal(Array.isArray(result.items), true);
          },
        },
        {
          label: 'tasks-comments',
          input: {
            entity_type: 'tasks',
            entity_id: fixtures.graphA.taskId,
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.entity.id, fixtures.graphA.taskId);
            assert.equal(result.entity.ref, 'T-5101');
            assert.equal(Array.isArray(result.items), true);
          },
        },
      ];

    case 'query_entities':
      return [
        {
          label: 'tasks-status',
          input: {
            entity_type: 'tasks',
            q: 'Shared Boundary Task',
            filters: { status: ['open'] },
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.filters_applied, ['status']);
            assert.deepEqual(result.filters_ignored, []);
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.taskId]);
          },
        },
        {
          label: 'projects-date',
          input: {
            entity_type: 'projects',
            filters: {
              planned_end: { op: 'before', value: '2027-01-01' },
            },
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.filters_applied, ['planned_end']);
            assert.equal(
              result.items.some((item: any) => item.id === fixtures.graphA.projectId),
              true,
            );
          },
        },
        {
          label: 'projects-execution-progress',
          input: {
            entity_type: 'projects',
            filters: {
              execution_progress: { op: 'gte', value: 1 },
            },
            sort: { field: 'execution_progress', direction: 'desc' },
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.filters_applied, ['execution_progress']);
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.projectId]);
            assert.equal(result.items[0].metadata.execution_progress, 25);
          },
        },
        {
          label: 'projects-business-lead',
          input: {
            entity_type: 'projects',
            filters: { business_lead: [fixtures.peopleA.projectBusinessLead.name] },
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.filters_applied, ['business_lead']);
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.projectId]);
            assert.equal(result.items[0].metadata.business_lead, fixtures.peopleA.projectBusinessLead.name);
          },
        },
        {
          label: 'requests-business-lead',
          input: {
            entity_type: 'requests',
            filters: { business_lead: [fixtures.peopleA.requestBusinessLead.name] },
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.filters_applied, ['business_lead']);
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.requestId]);
            assert.equal(result.items[0].metadata.business_lead, fixtures.peopleA.requestBusinessLead.name);
          },
        },
        {
          label: 'requests-contributors',
          input: {
            entity_type: 'requests',
            filters: { contributors: fixtures.peopleA.requestContributor.name },
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.filters_applied, ['contributors']);
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.requestId]);
            assert.equal(String(result.items[0].metadata.contributors).includes(fixtures.peopleA.requestContributor.name), true);
          },
        },
        {
          label: 'tasks-creator',
          input: {
            entity_type: 'tasks',
            filters: { creator: [fixtures.peopleA.taskCreator.name] },
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.filters_applied, ['creator']);
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.taskId]);
            assert.equal(result.items[0].metadata.creator, fixtures.peopleA.taskCreator.name);
          },
        },
        {
          label: 'tasks-phase',
          input: {
            entity_type: 'tasks',
            filters: { phase: [fixtures.graphA.phaseName] },
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.filters_applied, ['phase']);
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.taskId]);
            assert.equal(result.items[0].metadata.phase, fixtures.graphA.phaseName);
          },
        },
        {
          label: 'applications-business-owner',
          input: {
            entity_type: 'applications',
            filters: { business_owner: [fixtures.peopleA.applicationBusinessOwner.name] },
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.filters_applied, ['business_owner']);
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.applicationId]);
            assert.equal(String(result.items[0].metadata.business_owner).includes(fixtures.peopleA.applicationBusinessOwner.name), true);
          },
        },
        {
          label: 'applications-it-owner',
          input: {
            entity_type: 'applications',
            filters: { it_owner: fixtures.peopleA.applicationItOwner.name },
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.filters_applied, ['it_owner']);
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.applicationId]);
            assert.equal(String(result.items[0].metadata.it_owner).includes(fixtures.peopleA.applicationItOwner.name), true);
            assert.equal(result.items[0].metadata.version, fixtures.graphA.applicationVersion);
            assert.equal(result.items[0].metadata.environment, 'prod');
            assert.equal(result.items[0].metadata.environments, 'prod');
            assert.equal(result.items[0].metadata.hosting_model, 'saas');
            assert.equal(result.items[0].metadata.users_mode, 'manual');
          },
        },
        {
          label: 'assets-expanded-metadata',
          input: {
            entity_type: 'assets',
            q: 'Shared Boundary Asset',
            limit: 10,
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.deepEqual(result.items.map((item: any) => item.id), [fixtures.graphA.assetId]);
            assert.equal(result.items[0].metadata.provider, 'aws');
            assert.equal(result.items[0].metadata.environment, 'prod');
            assert.match(String(result.items[0].metadata.hostname), /^asset-/);
            assert.match(String(result.items[0].metadata.fqdn), /^asset-.*\.example\.com$/);
          },
        },
      ];

    case 'aggregate_entities':
      return [
        {
          label: 'tasks-by-status',
          input: {
            entity_type: 'tasks',
            group_by: 'status',
            q: 'Shared Boundary Task',
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.equal(result.returned, 1);
            assert.equal(result.truncated, false);
            assert.deepEqual(result.groups, [{ key: 'open', count: 1 }]);
            assert.deepEqual(result.filters_applied, []);
            assert.deepEqual(result.filters_ignored, []);
          },
        },
        {
          label: 'tasks-by-phase',
          input: {
            entity_type: 'tasks',
            group_by: 'phase',
            q: 'Shared Boundary Task',
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.equal(result.returned, 1);
            assert.equal(result.truncated, false);
            assert.deepEqual(result.groups, [{ key: fixtures.graphA.phaseName, count: 1 }]);
          },
        },
        {
          label: 'projects-max-execution-progress',
          input: {
            entity_type: 'projects',
            group_by: 'status',
            metric: 'execution_progress',
            function: 'max',
            q: 'Shared Boundary Project',
          },
          assertResult: (result: any) => {
            assert.equal(result.complete, true);
            assert.equal(result.total, 1);
            assert.equal(result.returned, 1);
            assert.equal(result.truncated, false);
            assert.equal(result.metric, 'execution_progress');
            assert.equal(result.function, 'max');
            assert.deepEqual(result.groups, [{ key: 'planned', value: 25 }]);
          },
        },
      ];

    case 'get_filter_values':
      return [
        {
          label: 'applications-values',
          input: {
            entity_type: 'applications',
            fields: ['status', 'lifecycle', 'business_owner', 'it_owner', 'environment', 'environments', 'hosting_model', 'data_class', 'users_mode'],
          },
          assertResult: (result: any) => {
            assert.equal(result.total, 9);
            assert.equal(result.returned, 9);
            assert.equal(result.truncated, false);
            assert.equal(result.complete, true);
            assert.equal(result.values.status.includes('enabled'), true);
            assert.equal(result.values.lifecycle.includes('active'), true);
            assert.equal(result.values.business_owner.includes(fixtures.peopleA.applicationBusinessOwner.name), true);
            assert.equal(result.values.it_owner.includes(fixtures.peopleA.applicationItOwner.name), true);
            assert.equal(result.values.environment.includes('prod'), true);
            assert.equal(result.values.environments.includes('prod'), true);
            assert.equal(result.values.hosting_model.includes('saas'), true);
            assert.equal(result.values.data_class.includes('internal'), true);
            assert.equal(result.values.users_mode.includes('manual'), true);
            assert.deepEqual(result.fields_ignored, []);
          },
        },
        {
          label: 'projects-people-values',
          input: {
            entity_type: 'projects',
            fields: ['business_lead', 'it_lead', 'contributors'],
          },
          assertResult: (result: any) => {
            assert.equal(result.total, 3);
            assert.equal(result.returned, 3);
            assert.equal(result.truncated, false);
            assert.equal(result.complete, true);
            assert.equal(result.values.business_lead.includes(fixtures.peopleA.projectBusinessLead.name), true);
            assert.equal(result.values.it_lead.includes(fixtures.peopleA.projectItLead.name), true);
            assert.equal(result.values.contributors.includes(fixtures.peopleA.projectContributor.name), true);
            assert.deepEqual(result.fields_ignored, []);
          },
        },
        {
          label: 'requests-people-values',
          input: {
            entity_type: 'requests',
            fields: ['business_lead', 'it_lead', 'contributors'],
          },
          assertResult: (result: any) => {
            assert.equal(result.total, 3);
            assert.equal(result.returned, 3);
            assert.equal(result.truncated, false);
            assert.equal(result.complete, true);
            assert.equal(result.values.business_lead.includes(fixtures.peopleA.requestBusinessLead.name), true);
            assert.equal(result.values.it_lead.includes(fixtures.peopleA.requestItLead.name), true);
            assert.equal(result.values.contributors.includes(fixtures.peopleA.requestContributor.name), true);
            assert.deepEqual(result.fields_ignored, []);
          },
        },
        {
          label: 'tasks-creator-values',
          input: {
            entity_type: 'tasks',
            fields: ['creator', 'phase'],
          },
          assertResult: (result: any) => {
            assert.equal(result.total, 2);
            assert.equal(result.returned, 2);
            assert.equal(result.truncated, false);
            assert.equal(result.complete, true);
            assert.equal(result.values.creator.includes(fixtures.peopleA.taskCreator.name), true);
            assert.equal(result.values.phase.includes(fixtures.graphA.phaseName), true);
            assert.deepEqual(result.fields_ignored, []);
          },
        },
      ];

    case 'describe_entity_filters':
      return [
        {
          label: 'tasks-filter-contract',
          input: {
            entity_type: 'tasks',
          },
          assertResult: (result: any) => {
            assert.equal(result.entity_type, 'tasks');
            assert.equal(result.complete, true);
            assert.equal(result.truncated, false);
            assert.equal(result.fields.some((field: any) => field.field === 'assignee'), true);
            assert.equal(
              result.fields.find((field: any) => field.field === 'assignee').aliases.includes('assignee_id'),
              true,
            );
          },
        },
      ];

    case 'search_knowledge':
      return [{
        label: 'search-knowledge',
        input: {
          query: 'Shared Boundary Knowledge',
          limit: 10,
        },
        assertResult: (result: any) => {
          assert.equal(result.complete, false);
          assert.deepEqual(
            result.items.map((item: any) => item.id),
            [fixtures.knowledgeA.documentId],
          );
        },
      }];

    case 'get_document':
      return [{
        label: 'get-document',
        input: {
          document_id: 'DOC-5101',
        },
        assertResult: (result: any) => {
          assert.equal(result.total, 1);
          assert.equal(result.returned, 1);
          assert.equal(result.truncated, false);
          assert.equal(result.complete, true);
          assert.equal(result.id, fixtures.knowledgeA.documentId);
          assert.deepEqual(result.relations.applications.map((item: any) => item.id), [fixtures.graphA.applicationId]);
          assert.deepEqual(result.relations.assets.map((item: any) => item.id), [fixtures.graphA.assetId]);
          assert.deepEqual(result.relations.projects.map((item: any) => item.id), [fixtures.graphA.projectId]);
          assert.deepEqual(result.relations.requests.map((item: any) => item.id), [fixtures.graphA.requestId]);
          assert.deepEqual(result.relations.tasks.map((item: any) => item.id), [fixtures.graphA.taskId]);
        },
      }];

    case 'web_search':
      return [];

    case 'import_glpi_ticket':
    case 'import_ticket':
    case 'create_task':
    case 'create_master_data_record':
    case 'create_business_record':
    case 'write_financial_plan':
    case 'update_master_data_record':
    case 'update_business_record':
    case 'update_entity_relations':
    case 'update_task_fields':
    case 'update_task_status':
    case 'update_task_assignee':
    case 'update_task_assignees':
    case 'add_task_comment':
    case 'create_document':
    case 'update_document_content':
    case 'update_document_metadata':
    case 'update_document_relations':
    case 'prepare_mutation_plan':
    case 'undo_preview':
      return [];

    default: {
      const exhaustive: never = toolName;
      throw new Error(`Unhandled AI tool isolation case: ${exhaustive}`);
    }
  }
}

async function testAiPhase1RepairMigrationReassertsCriticalRls() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tables = [
    'assets',
    'app_instances',
    'app_asset_assignments',
    'application_projects',
    'asset_projects',
    'portfolio_request_applications',
    'portfolio_request_assets',
  ];

  try {
    for (const table of tables) {
      await runner.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`);
      await runner.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
      await runner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }

    const migration = new AiPhase1RlsRepair1844200000000();
    await migration.up(runner);

    for (const table of tables) {
      const state = await getRlsState(runner, table);
      assert.equal(state.enabled, true, `${table} should have RLS enabled`);
      assert.equal(state.forced, true, `${table} should have RLS forced`);
      assert.equal(await hasTenantIsolationPolicy(runner, table), true, `${table} should have a tenant isolation policy`);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiEntityServicePhase1TenantDefenseInDepth() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  try {
    await seedTenant(runner, tenantA, `ai-phase1-a-${tenantA.slice(0, 8)}`, 'AI Phase 1 Tenant A');
    await seedTenant(runner, tenantB, `ai-phase1-b-${tenantB.slice(0, 8)}`, 'AI Phase 1 Tenant B');

    const graphA = await seedApplicationAssetGraph(runner, tenantA, '3101', {
      applicationName: 'Shared Boundary Application',
      assetName: 'Shared Boundary Asset',
      requestName: 'Tenant A Request',
      projectName: 'Tenant A Project',
    });
    const graphB = await seedApplicationAssetGraph(runner, tenantB, '4101', {
      applicationName: 'Shared Boundary Application',
      assetName: 'Shared Boundary Asset',
      requestName: 'Tenant B Request',
      projectName: 'Tenant B Project',
    });

    const knowledgeA = await seedKnowledgeGraph(runner, tenantA, graphA, '3101', {
      documentTitle: 'Tenant A Knowledge',
      documentSummary: 'Tenant A knowledge summary',
    });
    const knowledgeB = await seedKnowledgeGraph(runner, tenantB, graphB, '4101', {
      documentTitle: 'Tenant B Knowledge',
      documentSummary: 'Tenant B knowledge summary',
    });
    const peopleA = await seedAiPeopleAssignments(runner, tenantA, graphA, '3101');
    const peopleB = await seedAiPeopleAssignments(runner, tenantB, graphB, '4101');
    const enhancementsA = await seedContextEnhancements(runner, tenantA, graphA, knowledgeA, peopleA, '3101');
    const enhancementsB = await seedContextEnhancements(runner, tenantB, graphB, knowledgeB, peopleB, '4101');

    await disableRls(runner, [
      'applications',
      'assets',
      'app_instances',
      'app_asset_assignments',
      'portfolio_projects',
      'portfolio_requests',
      'application_suites',
      'asset_relations',
      'application_projects',
      'asset_projects',
      'portfolio_request_applications',
      'portfolio_request_assets',
      'tasks',
      'portfolio_project_phases',
      'portfolio_activities',
      'documents',
      'integrated_document_bindings',
    ]);

    await insertCrossTenantLeakShapes(runner, tenantA, tenantB, graphA, graphB);

    await setCurrentTenant(runner, tenantB);
    await runner.query(
      `UPDATE integrated_document_bindings
       SET source_entity_id = $1,
           updated_at = now()
       WHERE document_id = $2
         AND tenant_id = $3`,
      [graphA.projectId, enhancementsB.integratedProjectDocumentId, tenantB],
    );
    await runner.query(
      `INSERT INTO portfolio_activities (
         id, tenant_id, project_id, author_id, type, content, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, 'comment', $5, now(), now())`,
      [randomUUID(), tenantB, graphA.projectId, peopleB.projectContributor.id, `Tenant B project comment 4101`],
    );
    await runner.query(
      `INSERT INTO portfolio_activities (
         id, tenant_id, task_id, author_id, type, content, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, 'comment', $5, now(), now())`,
      [randomUUID(), tenantB, graphA.taskId, peopleB.taskCreator.id, `Tenant B task comment 4101`],
    );

    const entityService = new AiEntityService(
      {
        search: async () => ({ items: [], total: 0 }),
        listReadableLibraryIdsForUser: async () => null,
        getKnowledgeContextForEntity: async () => ({
          access: 'granted',
          total: 0,
          groups: [],
        }),
      } as any,
      {
        listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
        canReadKnowledge: async () => true,
        assertEntityTypeReadAccess: async () => undefined,
      } as any,
    );
    const entityServiceWithoutKnowledge = new AiEntityService(
      {
        search: async () => ({ items: [], total: 0 }),
        listReadableLibraryIdsForUser: async () => null,
        getKnowledgeContextForEntity: async () => ({
          access: 'granted',
          total: 0,
          groups: [],
        }),
      } as any,
      {
        listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
        canReadKnowledge: async () => false,
        assertEntityTypeReadAccess: async () => undefined,
      } as any,
    );

    await setCurrentTenant(runner, tenantA);
    const tenantAContext = {
      tenantId: tenantA,
      userId: randomUUID(),
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    const applicationSearch = await entityService.searchAll(tenantAContext, {
      query: 'Shared Boundary Application',
      entity_types: ['applications'],
      limit: 10,
    });
    assert.deepEqual(applicationSearch.items.map((item: any) => item.id), [graphA.applicationId]);
    assert.equal(applicationSearch.items[0].metadata.version, graphA.applicationVersion);

    const assetSearch = await entityService.searchAll(tenantAContext, {
      query: 'Shared Boundary Asset',
      entity_types: ['assets'],
      limit: 10,
    });
    assert.deepEqual(assetSearch.items.map((item: any) => item.id), [graphA.assetId]);

    const applicationContext = await entityService.getEntityContext(tenantAContext, {
      entity_type: 'applications',
      entity_id: graphA.applicationId,
    });
    assert.equal(applicationContext.total, 1);
    assert.equal(applicationContext.returned, 1);
    assert.equal(applicationContext.truncated, false);
    assert.equal(applicationContext.complete, true);
    assert.equal(applicationContext.entity.id, graphA.applicationId);
    assert.deepEqual(getRelatedIdsByRelation(applicationContext, 'linked_requests'), [graphA.requestId]);
    assert.deepEqual(getRelatedIdsByRelation(applicationContext, 'linked_projects'), [graphA.projectId]);
    assert.deepEqual(getRelatedIdsByRelation(applicationContext, 'related_applications'), [graphA.suiteApplicationId]);
    assert.deepEqual(getRelatedIdsByRelation(applicationContext, 'linked_assets'), [graphA.assetId]);
    assert.equal(applicationContext.entity.metadata.version, graphA.applicationVersion);
    assert.equal(
      applicationContext.related.some((group: any) => group.items.some((item: any) =>
        [graphB.requestId, graphB.projectId, graphB.suiteApplicationId, graphB.assetId].includes(item.id))),
      false,
    );

    const assetContext = await entityService.getEntityContext(tenantAContext, {
      entity_type: 'assets',
      entity_id: graphA.assetId,
    });
    assert.equal(assetContext.total, 1);
    assert.equal(assetContext.returned, 1);
    assert.equal(assetContext.truncated, false);
    assert.equal(assetContext.complete, true);
    assert.equal(assetContext.entity.id, graphA.assetId);
    assert.deepEqual(getRelatedIdsByRelation(assetContext, 'linked_requests'), [graphA.requestId]);
    assert.deepEqual(getRelatedIdsByRelation(assetContext, 'linked_projects'), [graphA.projectId]);
    assert.deepEqual(getRelatedIdsByRelation(assetContext, 'related_assets'), [graphA.relatedAssetId]);
    assert.deepEqual(getRelatedIdsByRelation(assetContext, 'linked_applications'), [graphA.applicationId]);
    assert.equal(
      assetContext.related.some((group: any) => group.items.some((item: any) =>
        [graphB.requestId, graphB.projectId, graphB.relatedAssetId, graphB.applicationId].includes(item.id))),
      false,
    );

    const projectContext = await entityService.getEntityContext(tenantAContext, {
      entity_type: 'projects',
      entity_id: graphA.projectId,
    });
    assert.equal(projectContext.total, 1);
    assert.equal(projectContext.returned, 1);
    assert.equal(projectContext.truncated, false);
    assert.equal(projectContext.complete, true);
    assert.equal(projectContext.entity.id, graphA.projectId);
    assert.equal(getMetadataObjectNames(projectContext.entity.metadata.phases).includes(graphA.phaseName), true);
    assert.deepEqual(getRelatedIdsByRelation(projectContext, 'project_tasks'), [graphA.taskId]);
    assert.deepEqual(getRelatedIdsByRelation(projectContext, 'integrated_documents'), [enhancementsA.integratedProjectDocumentId]);
    assert.equal(
      Array.isArray(projectContext.entity.metadata.recent_activity)
      && projectContext.entity.metadata.recent_activity.some((item: any) => item.content === enhancementsA.projectComment),
      true,
    );
    assert.equal(
      Array.isArray(projectContext.entity.metadata.recent_activity)
      && projectContext.entity.metadata.recent_activity.some((item: any) => String(item.author || '').includes('4101')),
      false,
    );
    assert.equal(
      getRelatedIdsByRelation(projectContext, 'integrated_documents').includes(enhancementsB.integratedProjectDocumentId),
      false,
    );
    const projectContextWithoutKnowledge = await entityServiceWithoutKnowledge.getEntityContext(tenantAContext, {
      entity_type: 'projects',
      entity_id: graphA.projectId,
    });
    assert.deepEqual(getRelatedIdsByRelation(projectContextWithoutKnowledge, 'integrated_documents'), []);

    const taskContext = await entityService.getEntityContext(tenantAContext, {
      entity_type: 'tasks',
      entity_id: graphA.taskId,
    });
    assert.equal(taskContext.total, 1);
    assert.equal(taskContext.returned, 1);
    assert.equal(taskContext.truncated, false);
    assert.equal(taskContext.complete, true);
    assert.equal(taskContext.entity.id, graphA.taskId);
    assert.equal(getMetadataObjectName(taskContext.entity.metadata.phase), graphA.phaseName);
    assert.equal(
      Array.isArray(taskContext.entity.metadata.recent_activity)
      && taskContext.entity.metadata.recent_activity.some((item: any) => item.content === enhancementsA.taskComment),
      true,
    );
    assert.equal(
      Array.isArray(taskContext.entity.metadata.recent_activity)
      && taskContext.entity.metadata.recent_activity.some((item: any) => String(item.author || '').includes('4101')),
      false,
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiToolRegistryIsolationCoverageTracksRegisteredTools() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  try {
    await seedTenant(runner, tenantA, `ai-tools-a-${tenantA.slice(0, 8)}`, 'AI Tools Tenant A');
    await seedTenant(runner, tenantB, `ai-tools-b-${tenantB.slice(0, 8)}`, 'AI Tools Tenant B');
    for (const [tenantId, label, rank] of [[tenantA, 'Tenant A', 7], [tenantB, 'Tenant B', 99]] as const) {
      await runner.query(`UPDATE tenants SET metadata = $2::jsonb WHERE id = $1`, [tenantId, JSON.stringify({
        it_ops: { cyber_criticality_levels: [{
          code: 'custom_cyber', label: `${label} cyber`, description: `${label} definition`, rank,
        }] },
      })]);
    }

    const graphA = await seedApplicationAssetGraph(runner, tenantA, '5101', {
      applicationName: 'Shared Boundary Application',
      assetName: 'Shared Boundary Asset',
      requestName: 'Shared Boundary Request',
      projectName: 'Shared Boundary Project',
      taskTitle: 'Shared Boundary Task',
    });
    const graphB = await seedApplicationAssetGraph(runner, tenantB, '6101', {
      applicationName: 'Shared Boundary Application',
      assetName: 'Shared Boundary Asset',
      requestName: 'Shared Boundary Request',
      projectName: 'Shared Boundary Project',
      taskTitle: 'Shared Boundary Task',
    });
    const peopleA = await seedAiPeopleAssignments(runner, tenantA, graphA, '5101');
    await seedAiPeopleAssignments(runner, tenantB, graphB, '6101');

    const knowledgeA = await seedKnowledgeGraph(runner, tenantA, graphA, '5101', {
      documentTitle: 'Shared Boundary Knowledge',
      documentSummary: 'Tenant A knowledge summary',
    });
    const knowledgeB = await seedKnowledgeGraph(runner, tenantB, graphB, '6101', {
      documentTitle: 'Shared Boundary Knowledge',
      documentSummary: 'Tenant B knowledge summary',
    });

    const policy = createPermissivePolicyStub();
    const { knowledge, queryExecutor, aggregateExecutor } = createAiQueryHarness(runner.manager);
    const entityService = new AiEntityService(knowledge as any, policy);
    const registry = new AiToolRegistry(
      entityService,
      knowledge as any,
      policy,
      queryExecutor,
      aggregateExecutor,
      {
        find: async () => ({ web_search_enabled: false }),
      } as any,
      {
        search: async () => [],
      } as any,
      {} as any,
      {
        listOperations: () => [],
        getOperationOrNull: () => null,
      } as any,
      new ItOpsSettingsService(
        runner.manager.getRepository(Tenant),
        runner.manager.getRepository(Location),
        {} as any,
      ),
    );

    const tenantAContext = {
      tenantId: tenantA,
      userId: 'ai-tool-admin',
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    const forbiddenIds = [
      graphB.applicationId,
      graphB.suiteApplicationId,
      graphB.assetId,
      graphB.relatedAssetId,
      graphB.appInstanceId,
      graphB.projectId,
      graphB.requestId,
      graphB.taskId,
      knowledgeB.libraryId,
      knowledgeB.documentTypeId,
      knowledgeB.documentId,
    ];

    for (const tool of registry.listRegisteredTools()) {
      assert.equal(tool.surfaces.includes('chat'), true, `${tool.name} should be callable on chat for coverage`);
      for (const testCase of buildToolIsolationCases(tool.name, { graphA, graphB, knowledgeA, peopleA })) {
        await setCurrentTenant(runner, tenantA);
        const result = await registry.execute(tenantAContext, tool.name, testCase.input);
        assertNoTenantLeak(tool.name, testCase.label, result, forbiddenIds);
        testCase.assertResult(result);
      }
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiEntityCommentsReturnsPaginatedCommentFeedsAndStaysTenantScoped() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  try {
    await seedTenant(runner, tenantA, `ai-comments-a-${tenantA.slice(0, 8)}`, 'AI Comments Tenant A');
    await seedTenant(runner, tenantB, `ai-comments-b-${tenantB.slice(0, 8)}`, 'AI Comments Tenant B');

    const graphA = await seedApplicationAssetGraph(runner, tenantA, '7101', {
      applicationName: 'Comments Probe Application',
      projectName: 'Comments Probe Project',
      requestName: 'Comments Probe Request',
      taskTitle: 'Comments Probe Task',
    });
    const graphB = await seedApplicationAssetGraph(runner, tenantB, '8101', {
      applicationName: 'Comments Probe Application',
      projectName: 'Comments Probe Project',
      requestName: 'Comments Probe Request',
      taskTitle: 'Comments Probe Task',
    });
    const peopleA = await seedAiPeopleAssignments(runner, tenantA, graphA, '7101');
    const peopleB = await seedAiPeopleAssignments(runner, tenantB, graphB, '8101');

    const projectComments = [
      'Newest project comment',
      'Middle project comment',
      'Oldest project comment',
    ];
    const taskComments = [
      'Newest task comment',
      'Older task comment',
    ];

    await setCurrentTenant(runner, tenantA);
    await runner.query(
      `INSERT INTO portfolio_activities (
         id, tenant_id, project_id, author_id, type, content, changed_fields, created_at, updated_at
       )
       VALUES
         ($1, $2, $3, $4, 'comment', $5, null, now() - interval '5 minute', now() - interval '5 minute'),
         ($6, $2, $3, $7, 'comment', $8, null, now() - interval '15 minute', now() - interval '15 minute'),
         ($9, $2, $3, $10, 'comment', $11, null, now() - interval '25 minute', now() - interval '25 minute'),
         ($12, $2, $3, $13, 'change', null, $14::jsonb, now() - interval '2 minute', now() - interval '2 minute')`,
      [
        randomUUID(),
        tenantA,
        graphA.projectId,
        peopleA.projectContributor.id,
        projectComments[0],
        randomUUID(),
        peopleA.projectBusinessLead.id,
        projectComments[1],
        randomUUID(),
        peopleA.projectItLead.id,
        projectComments[2],
        randomUUID(),
        peopleA.projectBusinessLead.id,
        JSON.stringify({ status: ['planned', 'in_progress'] }),
      ],
    );
    await runner.query(
      `INSERT INTO portfolio_activities (
         id, tenant_id, task_id, author_id, type, content, changed_fields, created_at, updated_at
       )
       VALUES
         ($1, $2, $3, $4, 'comment', $5, null, now() - interval '3 minute', now() - interval '3 minute'),
         ($6, $2, $3, $7, 'comment', $8, null, now() - interval '12 minute', now() - interval '12 minute'),
         ($9, $2, $3, $10, 'change', null, $11::jsonb, now() - interval '1 minute', now() - interval '1 minute')`,
      [
        randomUUID(),
        tenantA,
        graphA.taskId,
        peopleA.taskCreator.id,
        taskComments[0],
        randomUUID(),
        peopleA.projectItLead.id,
        taskComments[1],
        randomUUID(),
        peopleA.projectBusinessLead.id,
        JSON.stringify({ status: ['open', 'in_progress'] }),
      ],
    );

    await setCurrentTenant(runner, tenantB);
    await runner.query(
      `INSERT INTO portfolio_activities (
         id, tenant_id, project_id, author_id, type, content, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, 'comment', $5, now(), now())`,
      [randomUUID(), tenantB, graphA.projectId, peopleB.projectContributor.id, 'Tenant B leaked project comment 8101'],
    );
    await runner.query(
      `INSERT INTO portfolio_activities (
         id, tenant_id, task_id, author_id, type, content, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, 'comment', $5, now(), now())`,
      [randomUUID(), tenantB, graphA.taskId, peopleB.taskCreator.id, 'Tenant B leaked task comment 8101'],
    );

    const entityService = new AiEntityService(
      {} as any,
      {
        canReadKnowledge: async () => true,
        assertEntityTypeReadAccess: async () => undefined,
      } as any,
    );

    await setCurrentTenant(runner, tenantA);
    const tenantAContext = {
      tenantId: tenantA,
      userId: 'ai-comments-admin',
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    const firstProjectPage = await entityService.getEntityComments(tenantAContext, {
      entity_type: 'projects',
      entity_id: 'PRJ-7101',
      offset: 0,
      limit: 2,
    });
    assert.equal(firstProjectPage.entity.ref, 'PRJ-7101');
    assert.equal(firstProjectPage.total, 3);
    assert.equal(firstProjectPage.returned, 2);
    assert.equal(firstProjectPage.truncated, true);
    assert.equal(firstProjectPage.complete, false);
    assert.deepEqual(firstProjectPage.items.map((item) => item.content), projectComments.slice(0, 2));
    assert.equal(firstProjectPage.items.some((item) => String(item.author || '').includes('8101')), false);

    const secondProjectPage = await entityService.getEntityComments(tenantAContext, {
      entity_type: 'projects',
      entity_id: graphA.projectId,
      offset: 2,
      limit: 2,
    });
    assert.equal(secondProjectPage.total, 3);
    assert.equal(secondProjectPage.returned, 1);
    assert.equal(secondProjectPage.truncated, false);
    assert.equal(secondProjectPage.complete, false);
    assert.deepEqual(secondProjectPage.items.map((item) => item.content), [projectComments[2]]);

    const taskFeed = await entityService.getEntityComments(tenantAContext, {
      entity_type: 'tasks',
      entity_id: 'T-7101',
      offset: 0,
      limit: 10,
    });
    assert.equal(taskFeed.entity.ref, 'T-7101');
    assert.equal(taskFeed.total, 2);
    assert.equal(taskFeed.complete, true);
    assert.deepEqual(taskFeed.items.map((item) => item.content), taskComments);
    assert.equal(taskFeed.items.some((item) => String(item.author || '').includes('8101')), false);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiEntityContextMarksRecentActivityAsTruncatedWhenCapped() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantId = randomUUID();

  try {
    await seedTenant(runner, tenantId, `ai-context-cap-${tenantId.slice(0, 8)}`, 'AI Context Cap Tenant');
    const graph = await seedApplicationAssetGraph(runner, tenantId, '9101', {
      applicationName: 'Context Cap Application',
      projectName: 'Context Cap Project',
      requestName: 'Context Cap Request',
      taskTitle: 'Context Cap Task',
    });
    const people = await seedAiPeopleAssignments(runner, tenantId, graph, '9101');

    await setCurrentTenant(runner, tenantId);
    for (let offset = 0; offset < 25; offset += 1) {
      await runner.query(
        `INSERT INTO portfolio_activities (
           id, tenant_id, project_id, author_id, type, content, changed_fields, created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, 'comment', $5, null,
           now() - ($6::int * interval '1 minute'),
           now() - ($6::int * interval '1 minute')
         )`,
        [
          randomUUID(),
          tenantId,
          graph.projectId,
          people.projectContributor.id,
          `Project context activity ${offset}`,
          offset,
        ],
      );
    }

    const entityService = new AiEntityService(
      {
        search: async () => ({ items: [], total: 0 }),
        listReadableLibraryIdsForUser: async () => null,
        getKnowledgeContextForEntity: async () => ({
          access: 'granted',
          total: 0,
          groups: [],
        }),
      } as any,
      {
        listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
        canReadKnowledge: async () => true,
        assertEntityTypeReadAccess: async () => undefined,
      } as any,
    );

    const context = {
      tenantId,
      userId: randomUUID(),
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    const projectContext = await entityService.getEntityContext(context, {
      entity_type: 'projects',
      entity_id: graph.projectId,
    });

    assert.equal(projectContext.total, 1);
    assert.equal(projectContext.returned, 1);
    assert.equal(projectContext.truncated, true);
    assert.equal(projectContext.complete, false);
    assert.equal(projectContext.entity.metadata.recent_activity_total, 25);
    assert.equal(projectContext.entity.metadata.recent_activity_returned, 20);
    assert.equal(projectContext.entity.metadata.recent_activity_truncated, true);
    assert.equal(Array.isArray(projectContext.entity.metadata.recent_activity), true);
    assert.equal((projectContext.entity.metadata.recent_activity as any[]).length, 20);
    assert.equal((projectContext.entity.metadata.recent_activity as any[])[0]?.content, 'Project context activity 0');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiQueryLayerToolsHandleInactiveApplicationsAndStayTenantScoped() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  try {
    await seedTenant(runner, tenantA, `ai-query-a-${tenantA.slice(0, 8)}`, 'AI Query Tenant A');
    await seedTenant(runner, tenantB, `ai-query-b-${tenantB.slice(0, 8)}`, 'AI Query Tenant B');

    const tenantAApps = await seedLifecycleProbeApplications(runner, tenantA, 'Lifecycle Probe');
    const tenantBApps = await seedLifecycleProbeApplications(runner, tenantB, 'Lifecycle Probe');

    const policy = createPermissivePolicyStub();
    const { knowledge, queryExecutor, aggregateExecutor } = createAiQueryHarness(runner.manager);
    const entityService = new AiEntityService(knowledge as any, policy);
    const registry = new AiToolRegistry(
      entityService,
      knowledge as any,
      policy,
      queryExecutor,
      aggregateExecutor,
      {
        find: async () => ({ web_search_enabled: false }),
      } as any,
      {
        search: async () => [],
      } as any,
      {} as any,
      {
        listOperations: () => [],
        getOperationOrNull: () => null,
      } as any,
    );

    await setCurrentTenant(runner, tenantA);
    const tenantAContext = {
      tenantId: tenantA,
      userId: 'ai-query-admin',
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    const queryResult = await registry.execute(tenantAContext, 'query_entities', {
      entity_type: 'applications',
      q: 'Lifecycle Probe',
      limit: 10,
    }) as any;
    assert.equal(queryResult.total, 2);
    assert.deepEqual(
      queryResult.items.map((item: any) => item.id).sort(),
      [tenantAApps.activeId, tenantAApps.retiredId].sort(),
    );
    assertNoTenantLeak('query_entities', 'applications-include-inactive', queryResult, [tenantBApps.activeId, tenantBApps.retiredId]);

    const aggregateResult = await registry.execute(tenantAContext, 'aggregate_entities', {
      entity_type: 'applications',
      group_by: 'lifecycle',
      q: 'Lifecycle Probe',
    }) as any;
    assert.equal(aggregateResult.total, 2);
    assert.equal(aggregateResult.returned, 2);
    assert.equal(aggregateResult.truncated, false);
    assert.equal(aggregateResult.complete, true);
    assert.deepEqual(aggregateResult.groups, [
      { key: 'active', count: 1 },
      { key: 'retired', count: 1 },
    ]);
    assertNoTenantLeak('aggregate_entities', 'applications-include-inactive', aggregateResult, [tenantBApps.activeId, tenantBApps.retiredId]);

    const filterValuesResult = await registry.execute(tenantAContext, 'get_filter_values', {
      entity_type: 'applications',
      fields: ['status', 'lifecycle'],
    }) as any;
    assert.equal(filterValuesResult.total, 2);
    assert.equal(filterValuesResult.returned, 2);
    assert.equal(filterValuesResult.truncated, false);
    assert.equal(filterValuesResult.complete, true);
    assert.equal(filterValuesResult.values.status.includes('enabled'), true);
    assert.equal(filterValuesResult.values.status.includes('disabled'), true);
    assert.equal(filterValuesResult.values.lifecycle.includes('active'), true);
    assert.equal(filterValuesResult.values.lifecycle.includes('retired'), true);
    assert.deepEqual(filterValuesResult.fields_ignored, []);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiQueryLayerExplicitTenantPlumbingStaysIsolatedAcrossFamilies() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  try {
    await seedTenant(runner, tenantA, `ai-plumbing-a-${tenantA.slice(0, 8)}`, 'AI Plumbing Tenant A');
    await seedTenant(runner, tenantB, `ai-plumbing-b-${tenantB.slice(0, 8)}`, 'AI Plumbing Tenant B');

    const graphA = await seedApplicationAssetGraph(runner, tenantA, '8201', {
      applicationName: 'Shared Boundary Application',
      projectName: 'Shared Boundary Project',
      requestName: 'Shared Boundary Request',
      taskTitle: 'Shared Boundary Task',
    });
    const graphB = await seedApplicationAssetGraph(runner, tenantB, '8202', {
      applicationName: 'Shared Boundary Application',
      projectName: 'Shared Boundary Project',
      requestName: 'Shared Boundary Request',
      taskTitle: 'Shared Boundary Task',
    });
    const knowledgeA = await seedKnowledgeGraph(runner, tenantA, graphA, '8201', {
      documentTitle: 'Shared Boundary Knowledge',
      documentSummary: 'Tenant A knowledge summary',
    });
    await seedKnowledgeGraph(runner, tenantB, graphB, '8202', {
      documentTitle: 'Shared Boundary Knowledge',
      documentSummary: 'Tenant B knowledge summary',
    });

    const taskCompanyA = randomUUID();
    const taskCompanyB = randomUUID();
    await setCurrentTenant(runner, tenantA);
    await runner.query(
      `INSERT INTO companies (
         id, tenant_id, coa_id, name, country_iso, city, address1, address2, postal_code, reg_number,
         vat_number, state, base_currency, notes, status, disabled_at, created_at, updated_at
       )
       VALUES ($1, $2, null, $3, 'US', 'Tenant A City', null, null, null, null, null, null, 'USD', null, 'enabled', null, now(), now())`,
      [taskCompanyA, tenantA, 'Tenant A Task Company'],
    );
    await setCurrentTenant(runner, tenantB);
    await runner.query(
      `INSERT INTO companies (
         id, tenant_id, coa_id, name, country_iso, city, address1, address2, postal_code, reg_number,
         vat_number, state, base_currency, notes, status, disabled_at, created_at, updated_at
       )
       VALUES ($1, $2, null, $3, 'US', 'Tenant B City', null, null, null, null, null, null, 'USD', null, 'enabled', null, now(), now())`,
      [taskCompanyB, tenantB, 'Tenant B Task Company'],
    );

    await setCurrentTenant(runner, tenantA);
    await runner.query(
      `UPDATE applications
       SET status = 'enabled'
       WHERE tenant_id = $1`,
      [tenantA],
    );
    await runner.query(
      `UPDATE portfolio_projects
       SET status = 'planned'
       WHERE tenant_id = $1`,
      [tenantA],
    );
    await runner.query(
      `UPDATE portfolio_requests
       SET status = 'pending_review'
       WHERE tenant_id = $1`,
      [tenantA],
    );
    await runner.query(
      `UPDATE tasks
       SET status = 'open'
       WHERE tenant_id = $1`,
      [tenantA],
    );
    await runner.query(
      `UPDATE tasks
       SET company_id = $2
       WHERE tenant_id = $1`,
      [tenantA, taskCompanyA],
    );
    await runner.query(
      `INSERT INTO tasks (
         id, tenant_id, item_number, title, description, status, related_object_type, related_object_id, phase_id,
         labels, owner_ids, viewer_ids, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, 'Cross Tenant Phase Probe', 'Should not expose tenant B phase names', 'open', 'project', $4, $5,
         '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now()
       )`,
      [randomUUID(), tenantA, 98201, graphA.projectId, graphB.phaseId],
    );
    await setCurrentTenant(runner, tenantB);
    await runner.query(
      `UPDATE applications
       SET status = 'disabled'
       WHERE tenant_id = $1`,
      [tenantB],
    );
    await runner.query(
      `UPDATE portfolio_projects
       SET status = 'done'
       WHERE tenant_id = $1`,
      [tenantB],
    );
    await runner.query(
      `UPDATE portfolio_requests
       SET status = 'converted'
       WHERE tenant_id = $1`,
      [tenantB],
    );
    await runner.query(
      `UPDATE tasks
       SET status = 'done'
       WHERE tenant_id = $1`,
      [tenantB],
    );
    await runner.query(
      `UPDATE tasks
       SET company_id = $2
       WHERE tenant_id = $1`,
      [tenantB, taskCompanyB],
    );
    await setCurrentTenant(runner, tenantA);
    await runner.query(
      `UPDATE documents
       SET status = 'published'
       WHERE tenant_id = $1`,
      [tenantA],
    );
    await setCurrentTenant(runner, tenantB);
    await runner.query(
      `UPDATE documents
       SET status = 'archived'
       WHERE tenant_id = $1`,
      [tenantB],
    );

    await disableRls(runner, [
      'applications',
      'portfolio_projects',
      'portfolio_requests',
      'tasks',
      'portfolio_project_phases',
      'documents',
    ]);

    await setCurrentTenant(runner, tenantA);
    const policy = createPermissivePolicyStub();
    const { knowledge, queryExecutor, aggregateExecutor } = createAiQueryHarness(runner.manager);
    const entityService = new AiEntityService(knowledge as any, policy);
    const registry = new AiToolRegistry(
      entityService,
      knowledge as any,
      policy,
      queryExecutor,
      aggregateExecutor,
      {
        find: async () => ({ web_search_enabled: false }),
      } as any,
      {
        search: async () => [],
      } as any,
      {} as any,
      {
        listOperations: () => [],
        getOperationOrNull: () => null,
      } as any,
    );

    const tenantAContext = {
      tenantId: tenantA,
      userId: randomUUID(),
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    const cases = [
      {
        entityType: 'applications' as const,
        query: 'Shared Boundary Application',
        expectedId: graphA.applicationId,
        expectedStatus: 'enabled',
        forbiddenStatus: 'disabled',
      },
      {
        entityType: 'projects' as const,
        query: 'Shared Boundary Project',
        expectedId: graphA.projectId,
        expectedStatus: 'planned',
        forbiddenStatus: 'done',
      },
      {
        entityType: 'requests' as const,
        query: 'Shared Boundary Request',
        expectedId: graphA.requestId,
        expectedStatus: 'pending_review',
        forbiddenStatus: 'converted',
      },
      {
        entityType: 'tasks' as const,
        query: 'Shared Boundary Task',
        expectedId: graphA.taskId,
        expectedStatus: 'open',
        forbiddenStatus: 'done',
        filterField: 'company',
        expectedFilterValue: 'Tenant A Task Company',
        forbiddenFilterValue: 'Tenant B Task Company',
      },
      {
        entityType: 'tasks' as const,
        query: 'Shared Boundary Task',
        expectedId: graphA.taskId,
        expectedStatus: graphA.phaseName,
        forbiddenStatus: graphB.phaseName,
        filterField: 'phase',
        expectedFilterValue: graphA.phaseName,
        forbiddenFilterValue: graphB.phaseName,
        filters: { phase: [graphA.phaseName] },
        groupBy: 'phase',
      },
      {
        entityType: 'documents' as const,
        query: 'Shared Boundary Knowledge',
        aggregateQuery: '',
        expectedId: knowledgeA.documentId,
        expectedStatus: 'published',
        forbiddenStatus: 'archived',
        filterField: 'library',
        expectedFilterValue: 'Knowledge 8201',
        forbiddenFilterValue: 'Knowledge 8202',
      },
    ];

    for (const testCase of cases) {
      const queryResult = await registry.execute(tenantAContext, 'query_entities', {
        entity_type: testCase.entityType,
        q: testCase.query,
        filters: testCase.filters,
        limit: 20,
      }) as any;
      assert.equal(queryResult.total, 1, `${testCase.entityType} query should only return tenant A rows`);
      assert.deepEqual(queryResult.items.map((item: any) => item.id), [testCase.expectedId]);

      const aggregateResult = await registry.execute(tenantAContext, 'aggregate_entities', {
        entity_type: testCase.entityType,
        group_by: testCase.groupBy || 'status',
        q: testCase.aggregateQuery ?? testCase.query,
        filters: testCase.filters,
      }) as any;
      assert.equal(aggregateResult.total, 1, `${testCase.entityType} aggregate should only count tenant A rows`);
      assert.equal(
        aggregateResult.groups.some((group: any) => group.key === testCase.expectedStatus && group.count === 1),
        true,
        `${testCase.entityType} aggregate should include tenant A status only`,
      );
      assert.equal(
        aggregateResult.groups.some((group: any) => group.key === testCase.forbiddenStatus),
        false,
        `${testCase.entityType} aggregate should not include tenant B status`,
      );

      const filterValuesResult = await registry.execute(tenantAContext, 'get_filter_values', {
        entity_type: testCase.entityType,
        fields: [testCase.filterField || 'status'],
      }) as any;
      const filterValues = Array.isArray(filterValuesResult.values?.[testCase.filterField || 'status'])
        ? filterValuesResult.values[testCase.filterField || 'status']
        : [];
      const expectedFilterValue = testCase.expectedFilterValue ?? testCase.expectedStatus;
      const forbiddenFilterValue = testCase.forbiddenFilterValue ?? testCase.forbiddenStatus;
      assert.equal(filterValues.includes(expectedFilterValue), true, `${testCase.entityType} filter values should include tenant A value`);
      assert.equal(filterValues.includes(forbiddenFilterValue), false, `${testCase.entityType} filter values should not include tenant B value`);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiQueryLayerSupportsFirstPersonScopesAndPrioritySorting() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantId = randomUUID();

  try {
    await seedTenant(runner, tenantId, `ai-scope-${tenantId.slice(0, 8)}`, 'AI Scope Tenant');

    const mePrimary = await seedApplicationAssetGraph(runner, tenantId, '7101', {
      projectName: 'Scope Me Project Low',
      requestName: 'Scope Me Request Low',
      taskTitle: 'Scope Me Task Low',
    });
    const meSecondary = await seedApplicationAssetGraph(runner, tenantId, '7102', {
      projectName: 'Scope Me Project High',
      requestName: 'Scope Me Request High',
      taskTitle: 'Scope Me Task High',
    });
    const teamOnly = await seedApplicationAssetGraph(runner, tenantId, '7103', {
      projectName: 'Scope Team Project',
      requestName: 'Scope Team Request',
      taskTitle: 'Scope Team Task',
    });
    const outsider = await seedApplicationAssetGraph(runner, tenantId, '7104', {
      projectName: 'Scope Outsider Project',
      requestName: 'Scope Outsider Request',
      taskTitle: 'Scope Outsider Task',
    });
    const scopedUsers = await seedAiScopeUsers(
      runner,
      tenantId,
      { mePrimary, meSecondary, teamOnly, outsider },
      '7101',
    );

    const policy = createPermissivePolicyStub();
    const { knowledge, queryExecutor, aggregateExecutor } = createAiQueryHarness(runner.manager);
    const entityService = new AiEntityService(knowledge as any, policy);
    const registry = new AiToolRegistry(
      entityService,
      knowledge as any,
      policy,
      queryExecutor,
      aggregateExecutor,
      {
        find: async () => ({ web_search_enabled: false }),
      } as any,
      {
        search: async () => [],
      } as any,
      {} as any,
      {
        listOperations: () => [],
        getOperationOrNull: () => null,
      } as any,
    );

    await setCurrentTenant(runner, tenantId);
    const actorContext = {
      tenantId,
      userId: scopedUsers.actor.id,
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    const meProjects = await registry.execute(actorContext, 'query_entities', {
      entity_type: 'projects',
      scope: 'me',
      q: 'Scope Me Project',
      sort: { field: 'priority_score', direction: 'desc' },
      limit: 10,
    }) as any;
    assert.equal(meProjects.total, 2);
    assert.deepEqual(
      meProjects.items.map((item: any) => item.id),
      [meSecondary.projectId, mePrimary.projectId],
    );
    assert.deepEqual(
      meProjects.items.map((item: any) => item.metadata.priority_score),
      [80, 30],
    );
    assert.deepEqual(meProjects.scope, { requested: 'me', resolved: true });

    const meProjectPrioritySum = await registry.execute(actorContext, 'aggregate_entities', {
      entity_type: 'projects',
      scope: 'me',
      group_by: 'status',
      metric: 'priority_score',
      function: 'sum',
      q: 'Scope Me Project',
    }) as any;
    assert.equal(meProjectPrioritySum.total, 2);
    assert.equal(meProjectPrioritySum.metric, 'priority_score');
    assert.equal(meProjectPrioritySum.function, 'sum');
    assert.deepEqual(meProjectPrioritySum.groups, [
      { key: 'planned', value: 110 },
    ]);
    assert.deepEqual(meProjectPrioritySum.scope, { requested: 'me', resolved: true });

    await assert.rejects(
      () => registry.execute(actorContext, 'aggregate_entities', {
        entity_type: 'projects',
        scope: 'me',
        group_by: 'status',
        function: 'sum',
        q: 'Scope Me Project',
      }),
      /metric is required/i,
    );

    const meRequests = await registry.execute(actorContext, 'query_entities', {
      entity_type: 'requests',
      scope: 'me',
      q: 'Scope Me Request',
      sort: { field: 'priority_score', direction: 'desc' },
      limit: 10,
    }) as any;
    assert.equal(meRequests.total, 2);
    assert.deepEqual(
      meRequests.items.map((item: any) => item.id),
      [meSecondary.requestId, mePrimary.requestId],
    );
    assert.deepEqual(
      meRequests.items.map((item: any) => item.metadata.priority_score),
      [70, 25],
    );
    assert.deepEqual(meRequests.scope, { requested: 'me', resolved: true });

    const meTasks = await registry.execute(actorContext, 'query_entities', {
      entity_type: 'tasks',
      scope: 'me',
      q: 'Scope Me Task',
      sort: { field: 'label', direction: 'asc' },
      limit: 10,
    }) as any;
    assert.equal(meTasks.total, 2);
    assert.deepEqual(
      meTasks.items.map((item: any) => item.id),
      [meSecondary.taskId, mePrimary.taskId],
    );
    assert.deepEqual(meTasks.scope, { requested: 'me', resolved: true });

    const teamProjects = await registry.execute(actorContext, 'query_entities', {
      entity_type: 'projects',
      scope: 'my_team',
      q: 'Scope',
      sort: { field: 'priority_score', direction: 'desc' },
      limit: 10,
    }) as any;
    assert.equal(teamProjects.total, 3);
    assert.deepEqual(
      teamProjects.items.map((item: any) => item.id),
      [teamOnly.projectId, meSecondary.projectId, mePrimary.projectId],
    );
    assert.deepEqual(teamProjects.scope, {
      requested: 'my_team',
      resolved: true,
      team_name: scopedUsers.teamName,
    });
    assert.equal(
      teamProjects.items.some((item: any) => item.id === outsider.projectId),
      false,
    );

    const teamTaskAggregate = await registry.execute(actorContext, 'aggregate_entities', {
      entity_type: 'tasks',
      scope: 'my_team',
      group_by: 'assignee',
      q: 'Scope',
    }) as any;
    assert.equal(teamTaskAggregate.total, 3);
    assert.deepEqual(teamTaskAggregate.groups, [
      { key: scopedUsers.actor.name, count: 2 },
      { key: scopedUsers.teammate.name, count: 1 },
    ]);
    assert.deepEqual(teamTaskAggregate.scope, {
      requested: 'my_team',
      resolved: true,
      team_name: scopedUsers.teamName,
    });

    const outsiderContext = {
      ...actorContext,
      userId: scopedUsers.outsider.id,
    };
    const unresolvedTeamScope = await registry.execute(outsiderContext, 'query_entities', {
      entity_type: 'projects',
      scope: 'my_team',
      q: 'Scope',
      limit: 10,
    }) as any;
    assert.equal(unresolvedTeamScope.total, 0);
    assert.equal(unresolvedTeamScope.complete, false);
    assert.deepEqual(unresolvedTeamScope.scope, {
      requested: 'my_team',
      resolved: false,
      team_name: null,
    });
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testKnowledgeServiceSupportsLinkedDocumentFiltersAcrossLegacyAndIntegratedBindings() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantId = randomUUID();
  const tenantUser = randomUUID();
  const tag = '8601';

  try {
    await seedTenant(runner, tenantId, 'ai-doc-links', 'AI Doc Links');
    const roleId = await seedRole(runner, tenantId, 'AI Knowledge');
    await seedUser(runner, tenantId, tenantUser, 'knowledge-user@example.com', roleId, {
      firstName: 'Kira',
      lastName: 'Knowledge',
    });

    const graph = await seedApplicationAssetGraph(runner, tenantId, tag);
    const knowledge = await seedKnowledgeGraph(runner, tenantId, graph, tag);
    const integratedProject = await seedIntegratedKnowledgeDocument(
      runner,
      tenantId,
      graph,
      knowledge,
      tag,
      'projects',
    );
    const integratedRequest = await seedIntegratedKnowledgeDocument(
      runner,
      tenantId,
      graph,
      knowledge,
      tag,
      'requests',
    );

    const service = createKnowledgeService(runner.manager);
    await setCurrentTenant(runner, tenantId);

    const linkedProjectResult = await service.list(
      {
        limit: 20,
        filters: {
          linked_project: {
            filterType: 'text',
            type: 'contains',
            filter: `PRJ-${tag}`,
          },
        },
      },
      { manager: runner.manager, tenantId },
    );
    assert.deepEqual(
      linkedProjectResult.items.map((item: any) => item.id).sort(),
      [knowledge.documentId, integratedProject.documentId].sort(),
    );

    const linkedRequestResult = await service.list(
      {
        limit: 20,
        filters: {
          linked_request: {
            filterType: 'text',
            type: 'contains',
            filter: `REQ-${tag}`,
          },
        },
      },
      { manager: runner.manager, tenantId },
    );
    assert.deepEqual(
      linkedRequestResult.items.map((item: any) => item.id).sort(),
      [knowledge.documentId, integratedRequest.documentId].sort(),
    );

    const linkedTaskResult = await service.list(
      {
        limit: 20,
        filters: {
          linked_task: {
            filterType: 'text',
            type: 'contains',
            filter: `T-${tag}`,
          },
        },
      },
      { manager: runner.manager, tenantId },
    );
    assert.deepEqual(
      linkedTaskResult.items.map((item: any) => item.id),
      [knowledge.documentId],
    );

    const linkedApplicationResult = await service.list(
      {
        limit: 20,
        filters: {
          linked_application: {
            filterType: 'text',
            type: 'contains',
            filter: 'Shared Boundary Application',
          },
        },
      },
      { manager: runner.manager, tenantId },
    );
    assert.deepEqual(
      linkedApplicationResult.items.map((item: any) => item.id),
      [knowledge.documentId],
    );

    const linkedProjectIds = await service.listIds(
      {
        limit: 20,
        filters: {
          linked_project: {
            filterType: 'text',
            type: 'contains',
            filter: `PRJ-${tag}`,
          },
        },
      },
      { manager: runner.manager, tenantId },
    );
    assert.deepEqual(
      linkedProjectIds.ids.sort(),
      [knowledge.documentId, integratedProject.documentId].sort(),
    );
    assert.equal(linkedProjectIds.total, 2);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiUsersEntitySupportsContributorReadsAndTenantIsolation() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  try {
    await seedTenant(runner, tenantA, `ai-users-a-${tenantA.slice(0, 8)}`, 'AI Users Tenant A');
    await seedTenant(runner, tenantB, `ai-users-b-${tenantB.slice(0, 8)}`, 'AI Users Tenant B');

    const roleA = await seedRole(runner, tenantA, 'Portfolio Contributor');
    const roleB = await seedRole(runner, tenantB, 'Portfolio Contributor');
    const companyA = await seedCompany(runner, tenantA, 'Tenant A Holdings');
    const companyB = await seedCompany(runner, tenantB, 'Tenant B Holdings');
    const departmentA = await seedDepartment(runner, tenantA, companyA, 'Portfolio Office');
    const departmentB = await seedDepartment(runner, tenantB, companyB, 'Security Office');

    const configuredA = randomUUID();
    const plainA = randomUUID();
    const configuredB = randomUUID();
    const teamA = randomUUID();
    const teamB = randomUUID();
    const teamAName = 'Strategy Team';
    const teamBName = 'Leakage Team';

    await seedUser(runner, tenantA, configuredA, 'alex.analyst.a@example.com', roleA, {
      firstName: 'Alex',
      lastName: 'Analyst',
      companyId: companyA,
      departmentId: departmentA,
      jobTitle: 'Senior Portfolio Analyst',
      locale: 'fr',
    });
    await seedUser(runner, tenantA, plainA, 'sam.support.a@example.com', roleA, {
      firstName: 'Sam',
      lastName: 'Support',
      companyId: companyA,
      departmentId: departmentA,
      jobTitle: 'Support Manager',
      locale: 'en',
    });
    await seedUser(runner, tenantB, configuredB, 'alex.analyst.b@example.com', roleB, {
      firstName: 'Alex',
      lastName: 'Analyst',
      companyId: companyB,
      departmentId: departmentB,
      jobTitle: 'Security Analyst',
      locale: 'de',
    });

    await setCurrentTenant(runner, tenantA);
    await runner.query(
      `INSERT INTO portfolio_teams (
         id, tenant_id, name, description, is_active, display_order, is_system, parent_id, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'Tenant A user team', true, 0, false, null, now(), now())`,
      [teamA, tenantA, teamAName],
    );
    await runner.query(
      `INSERT INTO portfolio_team_member_configs (
         id, tenant_id, user_id, areas_of_expertise, skills, project_availability, notes, team_id, item_number, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, 3.5, null, $5,
         COALESCE((SELECT MAX(item_number) FROM portfolio_team_member_configs WHERE tenant_id = $2), 0) + 1,
         now(), now())`,
      [randomUUID(), tenantA, configuredA, JSON.stringify(['ERP', 'Finance']), teamA],
    );

    await setCurrentTenant(runner, tenantB);
    await runner.query(
      `INSERT INTO portfolio_teams (
         id, tenant_id, name, description, is_active, display_order, is_system, parent_id, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'Tenant B user team', true, 0, false, null, now(), now())`,
      [teamB, tenantB, teamBName],
    );
    await runner.query(
      `INSERT INTO portfolio_team_member_configs (
         id, tenant_id, user_id, areas_of_expertise, skills, project_availability, notes, team_id, item_number, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, 4.5, null, $5,
         COALESCE((SELECT MAX(item_number) FROM portfolio_team_member_configs WHERE tenant_id = $2), 0) + 1,
         now(), now())`,
      [randomUUID(), tenantB, configuredB, JSON.stringify(['Leakage']), teamB],
    );

    await disableRls(runner, [
      'users',
      'roles',
      'companies',
      'departments',
      'portfolio_team_member_configs',
      'portfolio_teams',
    ]);

    const policy = createPermissivePolicyStub();
    const { knowledge, queryExecutor, aggregateExecutor } = createAiQueryHarness(runner.manager);
    const entityService = new AiEntityService(knowledge as any, policy);
    const registry = new AiToolRegistry(
      entityService,
      knowledge as any,
      policy,
      queryExecutor,
      aggregateExecutor,
      {
        find: async () => ({ web_search_enabled: false }),
      } as any,
      {
        search: async () => [],
      } as any,
      {} as any,
      {
        listOperations: () => [],
        getOperationOrNull: () => null,
      } as any,
    );

    await setCurrentTenant(runner, tenantA);
    const tenantAContext = {
      tenantId: tenantA,
      userId: configuredA,
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    const searchAllResult = await registry.execute(tenantAContext, 'search_all', {
      query: 'Alex Analyst',
      entity_types: ['users'],
      limit: 10,
    }) as any;
    assert.equal(searchAllResult.total, 1);
    assert.deepEqual(searchAllResult.items.map((item: any) => item.id), [configuredA]);
    assert.equal(searchAllResult.items[0].metadata.email, 'alex.analyst.a@example.com');
    assert.equal(searchAllResult.items[0].metadata.team, teamAName);
    assert.equal(searchAllResult.items[0].metadata.project_availability, 3.5);
    assert.equal(String(searchAllResult.items[0].metadata.areas_of_expertise).includes('ERP'), true);
    assert.equal(
      searchAllResult.items.some((item: any) => item.id === configuredB),
      false,
    );

    const queryAllUsers = await registry.execute(tenantAContext, 'query_entities', {
      entity_type: 'users',
      q: '@example.com',
      sort: { field: 'email', direction: 'asc' },
      limit: 10,
    }) as any;
    assert.equal(queryAllUsers.total, 2);
    assert.deepEqual(
      queryAllUsers.items.map((item: any) => item.id),
      [configuredA, plainA],
    );
    assert.equal(
      queryAllUsers.items.some((item: any) => item.id === configuredB),
      false,
    );

    const configuredUsers = await registry.execute(tenantAContext, 'query_entities', {
      entity_type: 'users',
      filters: {
        contributor_profile: ['configured'],
        team: [teamAName],
        areas_of_expertise: 'ERP',
      },
      sort: { field: 'email', direction: 'asc' },
      limit: 10,
    }) as any;
    assert.equal(configuredUsers.total, 1);
    assert.deepEqual(configuredUsers.filters_applied, ['contributor_profile', 'team', 'areas_of_expertise']);
    assert.deepEqual(configuredUsers.items.map((item: any) => item.id), [configuredA]);
    assert.equal(configuredUsers.items[0].metadata.email, 'alex.analyst.a@example.com');
    assert.equal(configuredUsers.items[0].metadata.company, 'Tenant A Holdings');
    assert.equal(configuredUsers.items[0].metadata.department, 'Portfolio Office');
    assert.equal(configuredUsers.items[0].metadata.primary_role, 'Portfolio Contributor');
    assert.equal(configuredUsers.items[0].metadata.locale, 'fr');
    assert.equal(configuredUsers.items[0].metadata.team, teamAName);
    assert.equal(configuredUsers.items[0].metadata.contributor_profile, 'configured');
    assert.equal(configuredUsers.items[0].metadata.project_availability, 3.5);
    assert.equal(String(configuredUsers.items[0].metadata.areas_of_expertise).includes('Finance'), true);

    const contributorBreakdown = await registry.execute(tenantAContext, 'aggregate_entities', {
      entity_type: 'users',
      group_by: 'contributor_profile',
      q: '@example.com',
    }) as any;
    assert.equal(contributorBreakdown.total, 2);
    assert.equal(contributorBreakdown.returned, 2);
    assert.equal(contributorBreakdown.truncated, false);
    assert.equal(contributorBreakdown.complete, true);
    assert.deepEqual(contributorBreakdown.groups, [
      { key: 'configured', count: 1 },
      { key: 'not_configured', count: 1 },
    ]);

    const teamAvailability = await registry.execute(tenantAContext, 'aggregate_entities', {
      entity_type: 'users',
      group_by: 'team',
      metric: 'project_availability',
      function: 'avg',
      filters: {
        contributor_profile: ['configured'],
      },
    }) as any;
    assert.equal(teamAvailability.total, 1);
    assert.equal(teamAvailability.returned, 1);
    assert.equal(teamAvailability.truncated, false);
    assert.equal(teamAvailability.complete, true);
    assert.equal(teamAvailability.metric, 'project_availability');
    assert.equal(teamAvailability.function, 'avg');
    assert.deepEqual(teamAvailability.groups, [
      { key: teamAName, value: 3.5 },
    ]);

    const filterValues = await registry.execute(tenantAContext, 'get_filter_values', {
      entity_type: 'users',
      fields: ['company', 'department', 'primary_role', 'team', 'locale', 'areas_of_expertise', 'contributor_profile'],
    }) as any;
    assert.equal(filterValues.total, 7);
    assert.equal(filterValues.returned, 7);
    assert.equal(filterValues.truncated, false);
    assert.equal(filterValues.complete, true);
    assert.deepEqual(filterValues.fields_ignored, []);
    assert.equal(filterValues.values.company.includes('Tenant A Holdings'), true);
    assert.equal(filterValues.values.company.includes('Tenant B Holdings'), false);
    assert.equal(filterValues.values.department.includes('Portfolio Office'), true);
    assert.equal(filterValues.values.department.includes('Security Office'), false);
    assert.equal(filterValues.values.primary_role.includes('Portfolio Contributor'), true);
    assert.equal(filterValues.values.team.includes(teamAName), true);
    assert.equal(filterValues.values.team.includes(teamBName), false);
    assert.equal(filterValues.values.locale.includes('fr'), true);
    assert.equal(filterValues.values.locale.includes('de'), false);
    assert.equal(filterValues.values.areas_of_expertise.includes('ERP'), true);
    assert.equal(filterValues.values.areas_of_expertise.includes('Leakage'), false);
    assert.deepEqual(filterValues.values.contributor_profile, ['configured', 'not_configured']);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiQueryExecutorClosesRemainingMilestone1aGapFields() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantId = randomUUID();
  try {
    await seedTenant(runner, tenantId, 'ai-gap-fix', 'AI Gap Fix Tenant');
    const companyId = await seedCompany(runner, tenantId, 'Tenant A Holdings');
    const otherCompanyId = await seedCompany(runner, tenantId, 'Tenant B Holdings');
    await runner.query(`UPDATE companies SET state = 'Ile-de-France' WHERE id = $1`, [companyId]);
    await runner.query(`UPDATE companies SET country_iso = 'DE', city = 'Berlin', state = 'Berlin' WHERE id = $1`, [otherCompanyId]);
    const metricYear = new Date().getFullYear();
    await runner.query(
      `INSERT INTO company_metrics (
         id, tenant_id, company_id, fiscal_year, headcount, it_users, turnover, is_frozen, frozen_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, 42, 21, 123.456, false, null, now(), now())`,
      [randomUUID(), tenantId, companyId, metricYear],
    );
    const departmentId = await seedDepartment(runner, tenantId, companyId, 'Digital Workplace');
    await runner.query(
      `INSERT INTO department_metrics (
         id, tenant_id, department_id, fiscal_year, headcount, is_frozen, frozen_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, 11, false, null, now(), now())`,
      [randomUUID(), tenantId, departmentId, metricYear],
    );

    const supplierId = await seedSupplier(runner, tenantId, 'ERP Vendor', 'SUP-001');
    const otherSupplierId = await seedSupplier(runner, tenantId, 'Legacy Vendor', 'SUP-999');

    const matchingContractId = await seedContract(runner, tenantId, {
      companyId,
      supplierId,
      name: 'ERP Renewal',
      startDate: '2026-01-01',
      durationMonths: 6,
      autoRenewal: true,
      noticePeriodMonths: 1,
      yearlyAmount: 1200,
    });
    await seedContract(runner, tenantId, {
      companyId: otherCompanyId,
      supplierId: otherSupplierId,
      name: 'Legacy Support',
      startDate: '2026-08-01',
      durationMonths: 18,
      autoRenewal: false,
      noticePeriodMonths: 3,
      yearlyAmount: 900,
    });

    await setCurrentTenant(runner, tenantId);

    const companiesService = new CompaniesService(
      runner.manager.getRepository(Company),
      {} as any,
      {} as any,
    );
    const suppliersService = new SuppliersService(
      runner.manager.getRepository(Supplier),
      {} as any,
    );
    const departmentsService = new DepartmentsService(
      runner.manager.getRepository(Department),
      runner.manager.getRepository(Company),
      {} as any,
    );
    const contractsService = new ContractsService(
      runner.manager.getRepository(Contract),
      runner.manager.getRepository(ContractSpendItem),
      runner.manager.getRepository(ContractLink),
      runner.manager.getRepository(ContractAttachment),
      {} as any,
      {} as any,
      {} as any,
      { syncFromSupplier: async () => undefined } as any,
      { notifyStatusChange: () => undefined } as any,
    );

    const queryExecutor = new AiQueryExecutor(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      contractsService as any,
      companiesService as any,
      suppliersService as any,
      departmentsService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const context = {
      tenantId,
      userId: 'ai-gap-fix-user',
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    const companyValues = await queryExecutor.executeFilterValues(context, {
      entity_type: 'companies',
      fields: ['country', 'country_iso', 'state'],
    });
    assert.equal(companyValues.fields_ignored.length, 0);
    assert.equal(companyValues.values.country.includes('FR'), true);
    assert.equal(companyValues.values.country_iso.includes('FR'), true);
    assert.equal(companyValues.values.state.includes('Ile-de-France'), true);

    const supplierValues = await queryExecutor.executeFilterValues(context, {
      entity_type: 'suppliers',
      fields: ['erp_supplier_id'],
    });
    assert.equal(supplierValues.fields_ignored.length, 0);
    assert.equal(supplierValues.values.erp_supplier_id.includes('SUP-001'), true);

    const contractValues = await queryExecutor.executeFilterValues(context, {
      entity_type: 'contracts',
      fields: ['supplier', 'company', 'currency'],
    });
    assert.equal(contractValues.fields_ignored.length, 0);
    assert.equal(contractValues.values.supplier.includes('ERP Vendor'), true);
    assert.equal(contractValues.values.company.includes('Tenant A Holdings'), true);
    assert.equal(contractValues.values.currency.includes('EUR'), true);

    const contractResult = await queryExecutor.execute(context, {
      entity_type: 'contracts',
      filters: {
        supplier: ['ERP Vendor'],
        company: ['Tenant A Holdings'],
        auto_renewal: ['true'],
        end_date: { op: 'before', value: '2026-07-15' },
      },
      sort: { field: 'end_date', direction: 'asc' },
      limit: 10,
    });
    assert.equal(contractResult.total, 1);
    assert.deepEqual(contractResult.items.map((item: any) => item.id), [matchingContractId]);
    assert.ok(contractResult.items[0].metadata, 'the contract summary must carry metadata');
    assert.equal(contractResult.items[0].metadata.supplier, 'ERP Vendor');
    assert.equal(contractResult.items[0].metadata.company, 'Tenant A Holdings');
    assert.equal(contractResult.items[0].metadata.auto_renewal, true);
    assert.equal(contractResult.items[0].metadata.duration_months, 6);
    assert.equal(contractResult.items[0].metadata.notice_period_months, 1);
    assert.equal(contractResult.items[0].metadata.yearly_amount_at_signature, 1200);
    assert.equal(contractResult.items[0].metadata.end_date, '2026-06-30');

    const companyResult = await queryExecutor.execute(context, {
      entity_type: 'companies',
      filters: {
        country_iso: ['FR'],
        state: ['Ile-de-France'],
      },
      sort: { field: 'country_iso', direction: 'asc' },
      limit: 10,
    });
    assert.equal(companyResult.total, 1);
    assert.deepEqual(companyResult.items.map((item: any) => item.id), [companyId]);
    assert.ok(companyResult.items[0].metadata, 'the company summary must carry metadata');
    assert.equal(companyResult.items[0].metadata.country_iso, 'FR');
    assert.equal(companyResult.items[0].metadata.state, 'Ile-de-France');
    assert.equal(companyResult.items[0].metadata.metrics_year, metricYear);
    assert.equal(companyResult.items[0].metadata.headcount, 42);
    assert.equal(companyResult.items[0].metadata.it_users, 21);
    assert.equal(companyResult.items[0].metadata.turnover, 123.456);

    const companyMetricResult = await queryExecutor.execute(context, {
      entity_type: 'companies',
      filters: {
        headcount_year: { op: 'gte', value: 40 },
      },
      sort: { field: 'headcount_year', direction: 'desc' },
      year: metricYear,
      limit: 10,
    });
    assert.equal(companyMetricResult.filters_ignored.length, 0);
    assert.equal(companyMetricResult.total, 1);
    assert.deepEqual(companyMetricResult.items.map((item: any) => item.id), [companyId]);
    assert.ok(companyMetricResult.items[0].metadata, 'the company summary must carry metadata');
    assert.equal(companyMetricResult.items[0].metadata.headcount, 42);

    const companyDetail = await queryExecutor.executeDetail(context, {
      entity_type: 'companies',
      entity_id: companyId,
      year: metricYear,
    });
    assert.equal(companyDetail.entity.metadata?.headcount, 42);
    assert.equal((companyDetail.data.selected_metrics as any).headcount, 42);
    assert.equal((companyDetail.data.metrics as any[]).some((metric) => metric.fiscal_year === metricYear && metric.headcount === 42), true);

    const departmentMetricResult = await queryExecutor.execute(context, {
      entity_type: 'departments',
      filters: {
        headcount_year: { op: 'gte', value: 10 },
      },
      sort: { field: 'headcount_year', direction: 'desc' },
      year: metricYear,
      limit: 10,
    });
    assert.equal(departmentMetricResult.filters_ignored.length, 0);
    assert.equal(departmentMetricResult.total, 1);
    assert.deepEqual(departmentMetricResult.items.map((item: any) => item.id), [departmentId]);
    assert.ok(departmentMetricResult.items[0].metadata, 'the department summary must carry metadata');
    assert.equal(departmentMetricResult.items[0].metadata.headcount, 11);
    assert.equal(departmentMetricResult.items[0].metadata.metrics_year, metricYear);

    const departmentDetail = await queryExecutor.executeDetail(context, {
      entity_type: 'departments',
      entity_id: departmentId,
      year: metricYear,
    });
    assert.equal(departmentDetail.entity.metadata?.headcount, 11);
    assert.equal((departmentDetail.data.selected_metrics as any).headcount, 11);
    assert.equal((departmentDetail.data.metrics as any[]).some((metric) => metric.fiscal_year === metricYear && metric.headcount === 11), true);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiQueryExecutorSpendItemsExposeRelativeYearlyTotals() {
  const anchorYear = new Date().getFullYear();
  const summaryCalls: any[] = [];
  const spendItems = {
    summary: async (query: any) => {
      summaryCalls.push(query);
      return {
        items: [{
          id: 'spend-1',
          product_name: 'AI Budget Line',
          description: 'Testing yearly totals',
          status: 'enabled',
          updated_at: '2026-03-27T09:00:00.000Z',
          supplier_name: 'Budget Supplier',
          currency: 'EUR',
          project_name: 'Infrastructure Refresh',
          project_stream_name: 'Infrastructure',
          project_category_name: 'Run',
          disabled_at: new Date('2031-06-30T12:00:00.000Z'),
          versions: {
            [`y${anchorYear - 2}`]: { year: anchorYear - 2, reporting: { budget: 10, revision: 9, follow_up: 8, landing: 7 } },
            yMinus1: { year: anchorYear - 1, reporting: { budget: 20, revision: 19, follow_up: 18, landing: 17 } },
            y: { year: anchorYear, reporting: { budget: 30, revision: 29, follow_up: 28, landing: 27 } },
            yPlus1: { year: anchorYear + 1, reporting: { budget: 40, revision: 39, follow_up: 38, landing: 37 } },
            [`y${anchorYear + 2}`]: { year: anchorYear + 2, reporting: { budget: 50, revision: 49, follow_up: 48, landing: 47 } },
          },
        }],
        total: 1,
        page: 1,
        limit: 10,
      };
    },
    summaryFilterValues: async () => ({}),
  };

  const executor = new AiQueryExecutor(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    spendItems as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const result = await executor.execute(
    {
      tenantId: 'tenant-ai',
      userId: 'user-ai',
      isPlatformHost: false,
      surface: 'chat',
      authMethod: 'jwt',
      // The registry is resolved for the tenant: a tenant without analytics dimensions.
      manager: { query: async () => [] } as any,
    },
    {
      entity_type: 'spend_items',
      limit: 10,
    },
  );

  assert.equal(summaryCalls.length, 1);
  assert.equal(
    summaryCalls[0].years,
    [anchorYear - 2, anchorYear - 1, anchorYear, anchorYear + 1, anchorYear + 2].join(','),
  );
  assert.equal(result.total, 1);
  assert.ok(result.items[0].metadata, 'the spend item summary must carry metadata');
  assert.equal(result.items[0].metadata.budget_anchor_year, anchorYear);
  assert.equal(result.items[0].metadata.project_name, 'Infrastructure Refresh');
  assert.equal(result.items[0].metadata.project_stream, 'Infrastructure');
  assert.equal(result.items[0].metadata.project_category, 'Run');
  assert.equal(result.items[0].metadata.end_of_validity, '2031-06-30T12:00:00.000Z', 'the end of validity is exposed');
  assert.equal(Object.prototype.hasOwnProperty.call(result.items[0].metadata, 'effective_end'), false, 'no separate effective end any more');
  assert.equal(result.items[0].metadata.y_minus2_budget, 10);
  assert.equal(result.items[0].metadata.y_minus1_budget, 20);
  assert.equal(result.items[0].metadata.y_budget, 30);
  assert.equal(result.items[0].metadata.y_review, 29);
  assert.equal(result.items[0].metadata.y_actual, 28);
  assert.equal(result.items[0].metadata.y_landing, 27);
  assert.equal(result.items[0].metadata.y_plus1_budget, 40);
  assert.equal(result.items[0].metadata.y_plus2_budget, 50);
  assert.deepEqual(
    (result.items[0].metadata.yearly_totals as any[]).map((entry: any) => entry.label),
    ['Y-2', 'Y-1', 'Y', 'Y+1', 'Y+2'],
  );
}

/**
 * The list filters on built rows, as the OPEX list engine applies them: its
 * oracle (the in-memory engine it replaced, with the decided rules), which
 * needs no database for set, number and date models.
 */
function applySummaryFilters(rows: any[], filters: Record<string, any>): any[] {
  const oracle = new BudgetSummaryOracle(SUMMARY_SCOPES.opex, {} as any, {} as any, 'tenant-ai', (text) => text.toLowerCase());
  return oracle.applyFilters(rows, filters);
}

function spendSummaryDateRows() {
  return [
    {
      id: 'spend-1',
      disabled_at: new Date('2026-06-30T12:00:00.000Z'),
      project_stream_name: 'Infrastructure',
      versions: {
        yMinus2: { reporting: { budget: 10, revision: 0, follow_up: 0, landing: 0 } },
        yPlus2: { reporting: { budget: 50, revision: 0, follow_up: 0, landing: 0 } },
      },
    },
    {
      id: 'spend-2',
      disabled_at: new Date('2026-08-15T12:00:00.000Z'),
      project_stream_name: 'Security',
      versions: {
        yMinus2: { reporting: { budget: 5, revision: 0, follow_up: 0, landing: 0 } },
        yPlus2: { reporting: { budget: 20, revision: 0, follow_up: 0, landing: 0 } },
      },
    },
  ] as any;
}

async function testSpendSummaryFiltersSupportRelativeYearMetricsAndDates() {
  // effective_end is the deprecated alias of end_of_validity: both reach the grid's disabled_at.
  const adapted = adaptFilters(getAiEntityRegistry('spend_items'), {
    effective_end: { op: 'before', value: '2026-07-01' },
  });
  assert.deepEqual(adapted.applied, ['effective_end']);
  assert.deepEqual(adapted.filters, { disabled_at: { filterType: 'date', type: 'lessThan', dateFrom: '2026-07-01' } });

  const filtered = applySummaryFilters(spendSummaryDateRows(), {
    project_stream_name: { filterType: 'set', values: ['Infrastructure'] },
    yMinus2Budget: { filterType: 'number', type: 'greaterThanOrEqual', filter: 10 },
    yPlus2Budget: { filterType: 'number', type: 'inRange', filter: 40, filterTo: 60 },
    ...adapted.filters,
  });

  assert.deepEqual(filtered.map((row: any) => row.id), ['spend-1']);
}

async function testSpendAndCapexEndOfValidityQueryField() {
  for (const entityType of ['spend_items', 'capex_items'] as const) {
    const registry = getAiEntityRegistry(entityType);
    assert.equal(registry.fields.end_of_validity.grid, 'disabled_at', `${entityType}: end_of_validity reads disabled_at`);
    assert.equal(registry.fields.end_of_validity.type, 'date');
    assert.match(registry.fields.effective_end.description, /^Deprecated alias of end_of_validity\./);
    assert.equal(registry.sortFields.end_of_validity, 'disabled_at', `${entityType}: sortable on the end of validity`);
    assert.equal(registry.sortFields.effective_end, 'disabled_at', `${entityType}: the alias sorts the same column`);

    const adapted = adaptFilters(registry, { end_of_validity: { op: 'after', value: '2026-07-01' } });
    assert.deepEqual(adapted.applied, ['end_of_validity']);
    assert.deepEqual(adapted.filters, { disabled_at: { filterType: 'date', type: 'greaterThan', dateFrom: '2026-07-01' } });
  }

  const filtered = applySummaryFilters(
    spendSummaryDateRows(),
    adaptFilters(getAiEntityRegistry('spend_items'), { end_of_validity: { op: 'after', value: '2026-07-01' } }).filters,
  );
  assert.deepEqual(filtered.map((row: any) => row.id), ['spend-2']);
}

async function testAiAggregateExecutorSpendItemsSupportsSummaryMetricsAndProjectStreams() {
  const calls: Array<{ query: any; spec: any }> = [];
  const executor = new AiAggregateExecutor(
    {} as any, // tasks
    {} as any, // projects
    {} as any, // requests
    {} as any, // applications
    {} as any, // assets
    {
      // The OPEX list engine's aggregate (lot 2B, PR D): the executor sends the list state and the spec, and maps the groups.
      summaryAggregate: async (query: any, spec: any) => {
        calls.push({ query, spec });
        return {
          groups: [
            { keys: ['Infrastructure'], count: 2, values: { value: 75 }, unknown: {} },
            { keys: ['Security'], count: 1, values: { value: 25 }, unknown: {} },
          ],
          others: null,
          total: { keys: [], count: 3, values: { value: 100 }, unknown: {} },
          groupCount: 2,
          reportingCurrency: 'EUR',
        };
      },
    } as any,
    {} as any, // contracts
    {} as any, // companies
    {} as any, // suppliers
    {} as any, // departments
    {} as any, // knowledge
    {} as any, // locations
    {} as any, // users
    {} as any, // accounts
    {} as any, // chartOfAccounts
    {} as any, // analyticsCategories
    {} as any, // businessProcesses
    {} as any, // capexItems
    {} as any, // contacts
    {} as any, // interfaces
    {} as any, // connections
    {} as any, // incidents
  );

  const result = await executor.execute(
    {
      tenantId: 'tenant-ai',
      userId: 'user-ai',
      isPlatformHost: false,
      surface: 'chat',
      authMethod: 'jwt',
      // The registry is resolved for the tenant: a tenant without analytics dimensions.
      manager: { query: async () => [] } as any,
    },
    {
      entity_type: 'spend_items',
      group_by: 'project_stream',
      metric: 'y_budget',
      function: 'sum',
    },
  );

  assert.equal(result.total, 3);
  assert.equal(result.metric, 'y_budget');
  assert.equal(result.function, 'sum');
  assert.deepEqual(result.groups, [
    { key: 'Infrastructure', value: 75 },
    { key: 'Security', value: 25 },
  ]);
  assert.equal(result.complete, true);
  assert.deepEqual(calls, [{
    query: { q: undefined, filters: {}, includeDisabled: true },
    spec: {
      groupBy: ['project_stream_name'],
      measures: [{ id: 'value', fn: 'sum', field: 'yBudget' }],
      order: [{ by: 'measure', id: 'value', dir: 'DESC', nulls: 'LAST' }],
    },
  }], 'one aggregate of the list state: every status, grouped by the stream, the Y budget summed');
}

async function testAiAdminOverviewAggregatesUsageAndIsTenantScoped() {
  const now = new Date();
  const previousMonthUsageAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 0, 0, 0, 0));
  const previousMonthUsageIncludedInLast30Days = previousMonthUsageAt.getTime() >= now.getTime() - (30 * 24 * 60 * 60 * 1000);
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const tenantAUser1 = randomUUID();
  const tenantAUser2 = randomUUID();
  const tenantBUser = randomUUID();
  const tenantAConversation1 = randomUUID();
  const tenantAConversation2 = randomUUID();
  const tenantAConversation3 = randomUUID();
  const tenantBConversation = randomUUID();

  try {
    await seedTenant(runner, tenantA, `ai-overview-a-${tenantA.slice(0, 8)}`, 'AI Overview Tenant A');
    await seedTenant(runner, tenantB, `ai-overview-b-${tenantB.slice(0, 8)}`, 'AI Overview Tenant B');
    const tenantARoleId = await seedRole(runner, tenantA, 'AI Overview Member');
    const tenantBRoleId = await seedRole(runner, tenantB, 'AI Overview Member');
    await seedUser(runner, tenantA, tenantAUser1, `overview-a1-${tenantA.slice(0, 8)}@example.com`, tenantARoleId);
    await seedUser(runner, tenantA, tenantAUser2, `overview-a2-${tenantA.slice(0, 8)}@example.com`, tenantARoleId);
    await seedUser(runner, tenantB, tenantBUser, `overview-b-${tenantB.slice(0, 8)}@example.com`, tenantBRoleId);

    await setCurrentTenant(runner, tenantA);
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, created_at, updated_at)
       VALUES
         ($1, $2, $3, 'Recent AI work', 'openai', 'gpt-4o-mini', now() - interval '1 day', now() - interval '1 day'),
         ($4, $2, $5, 'Second recent AI work', 'anthropic', 'claude-sonnet-4-20250514', now() - interval '3 days', now() - interval '3 days'),
         ($6, $2, $3, 'Older AI work', 'openai', 'gpt-4o-mini', now() - interval '40 days', now() - interval '40 days')`,
      [
        tenantAConversation1,
        tenantA,
        tenantAUser1,
        tenantAConversation2,
        tenantAUser2,
        tenantAConversation3,
      ],
    );
    // message_count counts only user-sent messages (the included-volume unit);
    // assistant and tool rows contribute tokens but never messages.
    await runner.query(
      `INSERT INTO ai_messages (conversation_id, tenant_id, user_id, role, content, usage_json, created_at)
       VALUES
         ($1, $2, $3, 'user', 'First question', NULL, date_trunc('month', now()) + interval '23 hours'),
         ($1, $2, $3, 'assistant', 'Current month usage', '{"input_tokens":10,"output_tokens":20}'::jsonb, date_trunc('month', now()) + interval '1 day'),
         ($1, $2, $3, 'user', 'Second question', NULL, date_trunc('month', now()) + interval '2 days' - interval '1 hour'),
         ($1, $2, $3, 'assistant', 'Null usage should count as zero', NULL, date_trunc('month', now()) + interval '2 days'),
         ($1, $2, $3, 'tool', 'Tool result rows are not messages', NULL, date_trunc('month', now()) + interval '2 days' + interval '1 hour'),
         ($4, $2, $5, 'assistant', 'Recent usage outside current month', '{"input_tokens":4,"output_tokens":6}'::jsonb, date_trunc('month', now()) - interval '1 day')`,
      [
        tenantAConversation1,
        tenantA,
        tenantAUser1,
        tenantAConversation2,
        tenantAUser2,
      ],
    );

    await setCurrentTenant(runner, tenantB);
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, created_at, updated_at)
       VALUES ($1, $2, $3, 'Other tenant activity', 'openai', 'gpt-4o', '2026-03-21T09:00:00.000Z', '2026-03-21T09:00:00.000Z')`,
      [tenantBConversation, tenantB, tenantBUser],
    );
    await runner.query(
      `INSERT INTO ai_messages (conversation_id, tenant_id, user_id, role, content, usage_json, created_at)
       VALUES ($1, $2, $3, 'assistant', 'Tenant B usage must not leak', '{"input_tokens":999,"output_tokens":888}'::jsonb, '2026-03-21T09:01:00.000Z')`,
      [tenantBConversation, tenantB, tenantBUser],
    );

    await setCurrentTenant(runner, tenantA);
    const service = new AiAdminOverviewService({ tryResolve: async () => null } as any);
    const overview = await service.getOverview(tenantA, runner.manager);

    assert.equal(overview.totals.conversations_all, 3);
    assert.equal(overview.totals.conversations_7d, 2);
    assert.equal(overview.totals.conversations_30d, 2);
    assert.equal(overview.totals.active_users_30d, 2);
    assert.equal(overview.usage.current_month.input_tokens, 10);
    assert.equal(overview.usage.current_month.output_tokens, 20);
    assert.equal(overview.usage.current_month.total_tokens, 30);
    assert.equal(overview.usage.current_month.message_count, 2);
    assert.equal(overview.usage.last_30_days.input_tokens, previousMonthUsageIncludedInLast30Days ? 14 : 10);
    assert.equal(overview.usage.last_30_days.output_tokens, previousMonthUsageIncludedInLast30Days ? 26 : 20);
    assert.equal(overview.usage.last_30_days.total_tokens, previousMonthUsageIncludedInLast30Days ? 40 : 30);
    // Both user messages sit in the current month; the previous-month row is an
    // assistant message, so it never counts regardless of the 30-day boundary.
    assert.equal(overview.usage.last_30_days.message_count, 2);
    assert.equal(overview.recent_activity.length, 3);
    assert.equal(overview.recent_activity[0].conversation_id, tenantAConversation1);
    assert.equal(
      overview.recent_activity.some((item) => item.conversation_id === tenantBConversation),
      false,
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiConversationRetentionArchivesAndPurgesOldConversations() {
  const previousGrace = process.env.AI_RETENTION_PURGE_GRACE_DAYS;
  process.env.AI_RETENTION_PURGE_GRACE_DAYS = '30';

  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const tenantAUser = randomUUID();
  const tenantBUser = randomUUID();
  const archiveConversationId = randomUUID();
  const purgeConversationId = randomUUID();
  const freshConversationId = randomUUID();
  const tenantBConversationId = randomUUID();

  try {
    await seedTenant(runner, tenantA, `ai-retention-a-${tenantA.slice(0, 8)}`, 'AI Retention Tenant A');
    await seedTenant(runner, tenantB, `ai-retention-b-${tenantB.slice(0, 8)}`, 'AI Retention Tenant B');
    const tenantARoleId = await seedRole(runner, tenantA, 'AI Administrator');
    const tenantBRoleId = await seedRole(runner, tenantB, 'Member');
    await seedUser(runner, tenantA, tenantAUser, `retention-a-${tenantA.slice(0, 8)}@example.com`, tenantARoleId);
    await seedUser(runner, tenantB, tenantBUser, `retention-b-${tenantB.slice(0, 8)}@example.com`, tenantBRoleId);

    await setCurrentTenant(runner, tenantA);
    await runner.query(
      `INSERT INTO ai_settings (
         tenant_id, chat_enabled, mcp_enabled, conversation_retention_days, created_at, updated_at
       )
       VALUES ($1, false, false, 7, now(), now())`,
      [tenantA],
    );
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, created_at, updated_at, archived_at)
       VALUES
         ($1, $2, $3, 'Archive candidate', 'openai', 'gpt-4o-mini', now() - interval '10 days', now() - interval '10 days', NULL),
         ($4, $2, $3, 'Purge candidate', 'openai', 'gpt-4o-mini', now() - interval '60 days', now() - interval '60 days', now() - interval '40 days'),
         ($5, $2, $3, 'Fresh conversation', 'openai', 'gpt-4o-mini', now() - interval '1 day', now() - interval '1 day', NULL)`,
      [archiveConversationId, tenantA, tenantAUser, purgeConversationId, freshConversationId],
    );
    await runner.query(
      `INSERT INTO ai_messages (conversation_id, tenant_id, user_id, role, content, usage_json, created_at)
       VALUES
         ($1, $2, $3, 'assistant', 'Archive me', '{"input_tokens":5,"output_tokens":7}'::jsonb, now() - interval '9 days'),
         ($4, $2, $3, 'assistant', 'Purge me', '{"input_tokens":8,"output_tokens":11}'::jsonb, now() - interval '59 days'),
         ($5, $2, $3, 'assistant', 'Stay fresh', '{"input_tokens":1,"output_tokens":2}'::jsonb, now() - interval '1 day')`,
      [archiveConversationId, tenantA, tenantAUser, purgeConversationId, freshConversationId],
    );

    await setCurrentTenant(runner, tenantB);
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, created_at, updated_at, archived_at)
       VALUES ($1, $2, $3, 'Tenant B old conversation', 'anthropic', 'claude-sonnet-4-20250514', now() - interval '60 days', now() - interval '60 days', NULL)`,
      [tenantBConversationId, tenantB, tenantBUser],
    );

    const service = new AiConversationRetentionService(
      dataSource,
      { register: () => undefined } as any,
    );
    const summary = await service.run({ manager: runner.manager });

    assert.equal(summary.tenantsProcessed, 1);
    assert.ok(summary.archived >= 1);
    assert.equal(summary.purged_conversations, 1);
    assert.equal(summary.purged_messages, 1);
    assert.deepEqual(summary.errors, []);

    await setCurrentTenant(runner, tenantA);
    const archiveRows = await runner.query(
      `SELECT archived_at
       FROM ai_conversations
       WHERE id = $1`,
      [archiveConversationId],
    );
    assert.equal(archiveRows.length, 1);
    assert.equal(archiveRows[0].archived_at == null, false);

    const archiveMessageRows = await runner.query(
      `SELECT count(*)::int AS count
       FROM ai_messages
       WHERE conversation_id = $1`,
      [archiveConversationId],
    );
    assert.equal(Number(archiveMessageRows[0].count), 1);

    const purgeConversationRows = await runner.query(
      `SELECT id
       FROM ai_conversations
       WHERE id = $1`,
      [purgeConversationId],
    );
    assert.equal(purgeConversationRows.length, 0);

    const purgeMessageRows = await runner.query(
      `SELECT id
       FROM ai_messages
       WHERE conversation_id = $1`,
      [purgeConversationId],
    );
    assert.equal(purgeMessageRows.length, 0);

    const freshRows = await runner.query(
      `SELECT archived_at
       FROM ai_conversations
       WHERE id = $1`,
      [freshConversationId],
    );
    assert.equal(freshRows.length, 1);
    assert.equal(freshRows[0].archived_at, null);

    await setCurrentTenant(runner, tenantB);
    const tenantBRows = await runner.query(
      `SELECT archived_at
       FROM ai_conversations
       WHERE id = $1`,
      [tenantBConversationId],
    );
    assert.equal(tenantBRows.length, 1);
    assert.equal(tenantBRows[0].archived_at, null);
  } finally {
    process.env.AI_RETENTION_PURGE_GRACE_DAYS = previousGrace;
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  await dataSource.initialize();
  try {
    await testAiPhase1RepairMigrationReassertsCriticalRls();
    await testAiEntityServicePhase1TenantDefenseInDepth();
    await testAiEntityContextMarksRecentActivityAsTruncatedWhenCapped();
    await testAiEntityCommentsReturnsPaginatedCommentFeedsAndStaysTenantScoped();
    await testAiQueryLayerToolsHandleInactiveApplicationsAndStayTenantScoped();
    await testAiQueryLayerExplicitTenantPlumbingStaysIsolatedAcrossFamilies();
    await testAiQueryLayerSupportsFirstPersonScopesAndPrioritySorting();
    await testKnowledgeServiceSupportsLinkedDocumentFiltersAcrossLegacyAndIntegratedBindings();
    await testAiUsersEntitySupportsContributorReadsAndTenantIsolation();
    await testAiQueryExecutorClosesRemainingMilestone1aGapFields();
    await testAiQueryExecutorSpendItemsExposeRelativeYearlyTotals();
    await testSpendSummaryFiltersSupportRelativeYearMetricsAndDates();
    await testSpendAndCapexEndOfValidityQueryField();
    await testAiAggregateExecutorSpendItemsSupportsSummaryMetricsAndProjectStreams();
    await testAiAdminOverviewAggregatesUsageAndIsTenantScoped();
    await testAiConversationRetentionArchivesAndPurgesOldConversations();
    await testAiToolRegistryIsolationCoverageTracksRegisteredTools();
  } finally {
    await dataSource.destroy();
  }
}

void run();
