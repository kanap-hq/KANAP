export interface CriterionValue {
  id?: string;
  label: string;
  triggers_mandatory_bypass: boolean;
}

export interface Criterion {
  id: string;
  name: string;
  enabled: boolean;
  inverted: boolean;
  weight: number;
  display_order: number;
  values: CriterionValue[];
}

export interface Settings {
  mandatory_bypass_enabled: boolean;
}

export interface Skill {
  id: string;
  category: string;
  name: string;
  enabled: boolean;
  display_order: number;
}

export interface PhaseTemplateItem {
  id?: string;
  name: string;
  has_milestone: boolean;
  milestone_name: string | null;
}

export interface PhaseTemplate {
  id: string;
  name: string;
  is_system: boolean;
  sequence: number;
  items: PhaseTemplateItem[];
}

export interface PortfolioTeam {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  is_system: boolean;
  parent_id: string | null;
  member_count: number;
}

export interface EmploymentType {
  id: string;
  name: string;
  is_active: boolean;
  display_order: number;
  is_system: boolean;
  usage_count: number;
}

export interface PortfolioSource {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  is_system: boolean;
}

export interface PortfolioTaskType {
  id: string;
  name: string;
  /** The shipped type it started as, null for a tenant's own type. */
  code?: string | null;
  description: string | null;
  is_active: boolean;
  display_order: number;
  is_system: boolean;
}

export interface PortfolioStream {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
}

export interface PortfolioCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  is_system: boolean;
  streams: PortfolioStream[];
}
