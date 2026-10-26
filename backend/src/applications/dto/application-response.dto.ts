import { PaginatedResponse } from '../../common/types/responses';

/**
 * Base application response interface.
 */
export interface ApplicationResponse {
  id: string;
  tenant_id: string;
  name: string;
  sequential_id: string | null;
  supplier_id: string | null;
  category: string;
  description: string | null;
  editor: string | null;
  retired_date: Date | string | null;
  version: string | null;
  end_of_support_date: Date | string | null;
  go_live_date: Date | string | null;
  predecessor_id: string | null;
  lifecycle: string;
  environment: string;
  criticality: string | null;
  cyber_criticality: string | null;
  recovery_wave: string | null;
  rto_minutes: number | null;
  rpo_minutes: number | null;
  classification_justification: string | null;
  classification_revision: number;
  classification_review: import('../services/application-classification').ClassificationReview | null;
  classification_review_state?: string;
  classification_reviewed_at?: string | null;
  data_class: string | null;
  hosting_model: string;
  external_facing: boolean;
  is_suite: boolean;
  last_dr_test: Date | string | null;
  sso_enabled: boolean;
  mfa_supported: boolean;
  etl_enabled: boolean;
  access_methods: string[];
  contains_pii: boolean;
  licensing: string | null;
  notes: string | null;
  support_notes: string | null;
  users_mode: string;
  users_year: number;
  users_override: number | null;
  status: string;
  disabled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Application owner info.
 */
export interface ApplicationOwnerResponse {
  id: string;
  application_id: string;
  user_id: string;
  owner_type: 'business' | 'it';
}

/**
 * Application company assignment.
 */
export interface ApplicationCompanyResponse {
  id: string;
  application_id: string;
  company_id: string;
}

/**
 * Application department assignment.
 */
export interface ApplicationDepartmentResponse {
  id: string;
  application_id: string;
  department_id: string;
}

/**
 * Application link.
 * Note: The entity uses 'description' field, not 'label'.
 */
export interface ApplicationLinkResponse {
  id: string;
  tenant_id: string;
  application_id: string;
  description: string | null;
  url: string;
  created_at: Date | string;
}

/**
 * Application attachment metadata.
 */
export interface ApplicationAttachmentResponse {
  id: string;
  tenant_id: string;
  application_id: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string | null;
  size: number;
  storage_path: string;
  uploaded_at: Date | string;
}

/**
 * Application data residency entry.
 */
export interface ApplicationDataResidencyResponse {
  id: string;
  application_id: string;
  country_iso: string;
}

/**
 * Application support contact.
 */
export interface ApplicationSupportContactResponse {
  id: string;
  contact_id: string;
  role: string | null;
  contact?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
  };
}

/**
 * Application instance summary.
 */
export interface ApplicationInstanceResponse {
  id: string;
  application_id: string;
  environment: string;
  lifecycle: string;
  status: string;
  base_url: string | null;
  region: string | null;
  zone: string | null;
  notes: string | null;
  sso_enabled: boolean;
  mfa_supported: boolean;
  disabled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Extended application response with related data (used by get endpoint).
 */
export interface ApplicationDetailResponse extends ApplicationResponse {
  owners: ApplicationOwnerResponse[];
  companies: ApplicationCompanyResponse[];
  departments: ApplicationDepartmentResponse[];
  links: ApplicationLinkResponse[];
  attachments: ApplicationAttachmentResponse[];
  data_residency: ApplicationDataResidencyResponse[];
  derived_total_users: number;
  support_contacts?: ApplicationSupportContactResponse[];
  instances?: ApplicationInstanceResponse[];
  deployments?: ApplicationInstanceResponse[];
}

/**
 * Application list item with optional expansions.
 */
export interface ApplicationListItemResponse extends ApplicationResponse {
  derived_total_users: number;
  /** Supplier name (when include=supplier) */
  supplier_name?: string | null;
  /** Business owner names (when include=owners) */
  owners_business?: string[];
  /** IT owner names (when include=owners) */
  owners_it?: string[];
  /** Data residency countries (when include=residency) */
  data_residency?: string[];
  /** Related spend item count (when include=counts) */
  spend_count?: number;
  /** First spend item name (when include=counts) */
  spend_first_name?: string | null;
  /** Related CAPEX item count (when include=counts) */
  capex_count?: number;
  /** First CAPEX item description (when include=counts) */
  capex_first_description?: string | null;
  /** Related contracts count (when include=counts) */
  contracts_count?: number;
  /** First contract name (when include=counts) */
  contracts_first_name?: string | null;
  /** Parent suites count (when include=structure) */
  suites_count?: number;
  /** First suite name (when include=structure) */
  first_suite_name?: string | null;
  /** Reference of that first suite, for its link (when include=structure) */
  first_suite_ref?: string | null;
  /** Component apps count (when include=structure) */
  components_count?: number;
  /** First component name (when include=structure) */
  first_component_name?: string | null;
  /** App instances (when include=instances) */
  instances?: ApplicationInstanceResponse[];
  /** Application deployments (when include=deployments) */
  deployments?: ApplicationInstanceResponse[];
}

/**
 * Paginated list of applications.
 */
export type PaginatedApplicationsResponse = PaginatedResponse<ApplicationListItemResponse>;

/**
 * Application map summary (used for interface/connection maps).
 */
export interface ApplicationMapSummaryResponse {
  id: string;
  name: string;
  description: string | null;
  editor: string | null;
  criticality: string | null;
  cyber_criticality: string | null;
  recovery_wave: string | null;
  rto_minutes: number | null;
  rpo_minutes: number | null;
  classification_justification: string | null;
  classification_revision: number;
  classification_review: import('../services/application-classification').ClassificationReview | null;
  classification_review_state?: string;
  classification_reviewed_at?: string | null;
  assigned_servers: Array<{
    id: string;
    name: string;
    is_cluster: boolean;
    environment: string;
    /** True on a server that gets the row through its clusters (`via_clusters`). */
    inherited: boolean;
    via_clusters: Array<{ id: string; name: string }>;
  }>;
  business_owners: Array<{
    owner_type: string;
    user_id: string;
    name: string;
    email: string | null;
  }>;
  it_owners: Array<{
    owner_type: string;
    user_id: string;
    name: string;
    email: string | null;
  }>;
  support_contacts: ApplicationSupportContactResponse[];
}

/**
 * Version lineage response.
 */
export interface VersionLineageResponse {
  predecessors: Array<{
    id: string;
    name: string;
    version: string | null;
    lifecycle: string;
  }>;
  successors: Array<{
    id: string;
    name: string;
    version: string | null;
    lifecycle: string;
  }>;
}

/**
 * Bulk operation result response.
 */
export interface BulkOperationResponse {
  ok: boolean;
  added?: number;
  removed?: number;
}

/**
 * Delete operation result response.
 */
export interface DeleteOperationResponse {
  ok: boolean;
}

/**
 * Total users response.
 */
export interface TotalUsersResponse {
  total: number;
  year: number;
}

/**
 * Bulk delete result for applications.
 */
export interface ApplicationsBulkDeleteResult {
  deleted: string[];
  failed: Array<{ id: string; name: string; reason: string }>;
}

/**
 * Applications with server assignments (for Connection Map filtering).
 */
export interface ApplicationWithServerAssignments {
  id: string;
  name: string;
  lifecycle: string;
  environments: string[];
}

/**
 * CSV import result.
 */
export interface CsvImportResult {
  ok: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  processed?: number;
  errors: Array<{ row: number; message: string }>;
}
