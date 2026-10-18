export interface AboutSection {
  title: string;
  /** Paragraphs as trusted inline HTML (links only). */
  paragraphs: string[];
}

export interface AboutContent {
  meta: { title: string; description: string };
  header: {
    eyebrow: string;
    title: string;
    lead: string;
  };
  founder: {
    name: string;
    role: string;
    /** Job title for the Person JSON-LD. */
    jobTitle: string;
    photoAlt: string;
    paragraphs: string[];
    linkedinLabel: string;
  };
  sections: AboutSection[];
  cta: {
    title: string;
    body: string;
    primary: string;
    secondary: string;
  };
}
