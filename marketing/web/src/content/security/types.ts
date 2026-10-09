export interface SecurityPillar {
  title: string;
  body: string;
}

export interface SecurityContent {
  meta: { title: string; description: string };
  header: {
    eyebrow: string;
    title: string;
    lead: string;
  };
  overview: {
    title: string;
    intro: string;
    pillars: SecurityPillar[];
  };
  tenancy: {
    title: string;
    body: string;
    bullets: string[];
  };
  dataProtection: {
    title: string;
    body: string;
    bullets: string[];
  };
  access: {
    title: string;
    body: string;
    bullets: string[];
  };
  audit: {
    title: string;
    body: string;
    bullets: string[];
  };
  /**
   * Agent governance section. Optional so locale files written before the
   * agentic refonte still type-check; rendered after the audit section when
   * present (EN-first, fr/de/es add it in the translation pass).
   */
  agentGovernance?: {
    title: string;
    body: string;
    bullets: string[];
  };
  /** Build and release practices: images, base image pins, component inventory, license check, CI. */
  supplyChain: {
    title: string;
    body: string;
    bullets: string[];
  };
  deployment: {
    title: string;
    body: string;
    bullets: string[];
  };
  disclosure: {
    title: string;
    body: string;
    emailLabel: string;
    email: string;
  };
  cta: {
    title: string;
    body: string;
    primary: string;
    secondary: string;
  };
}
