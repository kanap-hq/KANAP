import type { GlpiTestFailureCode } from './glpi-errors';
export type GlpiConnectionOverrides = {
  glpi_url?: string | null;
  glpi_user_token?: string | null;
  glpi_app_token?: string | null;
};

export type GlpiSession = {
  baseUrl: string;
  sessionToken: string;
  appToken: string | null;
  // GLPI users_id of the account owning the user token (the "agent" identity).
  // Resolved from getFullSession; null when it could not be determined.
  agentUserId?: number | null;
};

export type GlpiTicket = {
  id: number;
  name: string | null;
  content_html: string | null;
  status: string | null;
  priority: number | null;
  urgency: string | null;
  type: number | null;
  entity_id?: number | null;
  category_id?: number | null;
  date?: string | null;
  updated_date?: string | null;
  glpi_url: string;
  image_targets: string[];
};

export type GlpiTicketListScope =
  | {
      mode?: 'new_tickets_only';
      createdAfter: string;
      maxResults: number;
      statusValues?: string[];
      entityId?: number | null;
      categoryId?: number | null;
      // Recursive selection: full allowed id sets (root + descendants). When present,
      // the GLPI criteria push down 'under' and post-fetch revalidation checks
      // membership instead of exact-id equality.
      entityIds?: number[] | null;
      categoryIds?: number[] | null;
    }
  | {
      // All currently-open tickets (status 1-4), bounded by per-cycle caps and an
      // optional last-changed (date_mod) window. Oldest-changed first.
      mode: 'all_open';
      maxResults: number;
      statusValues?: string[];
      entityId?: number | null;
      categoryId?: number | null;
      entityIds?: number[] | null;
      categoryIds?: number[] | null;
      lastChangedBefore?: string | null;
      lastChangedAfter?: string | null;
    };

export type GlpiReferenceItem = {
  id: number;
  name: string | null;
  completename: string | null;
  parent_id?: number | null;
};

export type GlpiTicketFollowup = {
  id: number;
  content_html: string | null;
  author_id?: number | null;
  author_label: string | null;
  editor_id?: number | null;
  date: string | null;
  updated_date?: string | null;
  is_private: boolean;
  image_targets: string[];
};

export type GlpiTicketUserAssociation = {
  id: number;
  user_id: number;
  user_label: string | null;
  role: 'requester' | 'assigned' | 'observer' | 'unknown';
};

export type GlpiTicketGroupAssociation = {
  id: number;
  group_id: number;
  group_label: string | null;
  role: 'requester' | 'assigned' | 'observer' | 'unknown';
};

// A GLPI group a ticket can be assigned to (Group.is_assign = 1).
export type GlpiAssignableGroup = {
  id: number;
  name: string | null;
  completename: string | null;
};

export type GlpiCategory = GlpiAssignableGroup & { parentId: number | null };

// A GLPI user a ticket can be assigned to: an active member of at least one assignable
// group. `label` is the display name GLPI would render (realname firstname, else name).
export type GlpiTechnician = {
  id: number;
  name: string | null;
  label: string;
};

export type GlpiTicketFollowupWriteResult = {
  id: number;
  ticket_id: number;
  is_private: boolean;
  content_html: string | null;
};

export type GlpiTicketUpdateFields = {
  itilcategories_id?: number;
  type?: number;
  priority?: number;
  urgency?: number;
  status?: number;
};

export type GlpiTicketUpdateResult = {
  ticket_id: number;
  updated_fields: string[];
};

export type GlpiDocument = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
};

export type GlpiTestResult = {
  ok: boolean;
  /** On a failure, the cause the card translates (`errors:<code>`); `message` is the English fallback. */
  code?: GlpiTestFailureCode;
  message: string;
  latency_ms: number | null;
  /** When the test ran, and whether it was kept on the saved settings. */
  tested_at: string;
  persisted: boolean;
};
