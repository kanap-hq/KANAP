export type TicketNeedEvidenceSource =
  | 'ticket_title'
  | 'ticket_description'
  | 'ticket_note'
  | 'screenshot';

export type TicketNeedExactCodeKind =
  | 'error_code'
  | 'http_status'
  | 'sap_code'
  | 'job_name'
  | 'hostname'
  | 'document_ref'
  | 'other';

export type TicketNeedRepresentation = {
  intent: string | null;
  language: string | null;
  entities: {
    applications: string[];
    modules: string[];
    screens: string[];
    equipment: string[];
    services: string[];
  };
  symptoms: string[];
  exact_codes: Array<{
    value: string;
    kind: TicketNeedExactCodeKind;
    source: TicketNeedEvidenceSource;
  }>;
  actions_attempted: string[];
  context: {
    environment: string[];
    version: string[];
    site: string[];
    role: string[];
    os: string[];
    browser: string[];
    network: string[];
  };
  constraints: {
    positive: string[];
    negative: string[];
  };
  evidence_refs: string[];
  warnings: string[];
  confidence: number | null;
  // Search terms (symptoms, actions, objects) in each language the documents may be written in,
  // translated by the same model call; empty without a model.
  search_terms: Record<TicketNeedSearchLanguage, string[]>;
};

/** The languages of the product, those the knowledge documents may be written in. */
export const TICKET_NEED_SEARCH_LANGUAGES = ['en', 'fr', 'de', 'es'] as const;
export type TicketNeedSearchLanguage = (typeof TICKET_NEED_SEARCH_LANGUAGES)[number];

export type TicketImageEvidence = {
  attachment_ref: string;
  source: 'ticket_description' | 'ticket_note';
  verbatim_text: string[];
  error_codes: string[];
  ui_labels: string[];
  screen: string | null;
  visible_app: string | null;
  language: string | null;
  summary: string | null;
  confidence: number | null;
  warnings: string[];
};

export type KnowledgeQueryDerivation = {
  source: 'need_representation' | 'deterministic_fallback';
  queries: string[];
  exact_queries: string[];
  // One query per document language, from the translated search terms.
  language_queries: string[];
  facet_queries: string[];
  fallback_queries: string[];
  dropped_queries: Array<{
    query: string;
    reason: string;
  }>;
  warnings: string[];
};
