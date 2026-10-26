/**
 * The specification document of an interface, assembled from the texts of the
 * interface. Each text goes through `formatText`: the Markdown workers convert
 * legacy HTML there (integrated-document-markdown.ts); the plain-text fallback of
 * integrated-documents.service.ts keeps the texts as they are.
 *
 * The section headings and field labels follow the creating user's language
 * (`interfaceSpecificationTemplateMarkdown`, `buildInterfaceSpecificationMarkdown`).
 * English is the fallback. The library template stays the English copy: a tenant
 * has no language of its own.
 */

export type InterfaceSpecificationSource = {
  business_purpose: string | null;
  overview_notes: string | null;
  impact_of_failure: string | null;
  business_objects: unknown | null;
  main_use_cases: string | null;
  functional_rules: string | null;
  core_transformations_summary: string | null;
  error_handling_summary: string | null;
  typical_data: string | null;
  audit_logging: string | null;
  security_controls_summary: string | null;
};

function formatInterfaceSpecificationValue(value: unknown, formatText: (text: string) => string): string | null {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return null;
    }
    const allScalar = value.every((item) => (
      item == null
      || typeof item === 'string'
      || typeof item === 'number'
      || typeof item === 'boolean'
    ));
    if (!allScalar) {
      return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
    }

    const scalars = value
      .map((item) => formatInterfaceSpecificationValue(item, formatText))
      .filter((item): item is string => !!item);
    return scalars.length > 0 ? scalars.map((item) => `- ${item}`).join('\n') : null;
  }

  if (typeof value === 'object') {
    return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return formatText(normalized);
}

export type InterfaceSpecificationLanguage = 'en' | 'fr' | 'de' | 'es';

type SectionCopy = Record<InterfaceSpecificationLanguage, string>;

type SpecificationSection = {
  heading: SectionCopy;
  fields: ReadonlyArray<{
    key: keyof InterfaceSpecificationSource;
    label: SectionCopy;
  }>;
};

/**
 * The eight sections of a specification, in every interface language. A new
 * document takes the copy of the user who creates the interface.
 */
const INTERFACE_SPECIFICATION_SECTIONS: readonly SpecificationSection[] = [
  {
    heading: {
      en: 'Business Purpose & Overview',
      fr: "Objet métier et vue d'ensemble",
      de: 'Geschäftlicher Zweck und Übersicht',
      es: 'Propósito de negocio y visión general',
    },
    fields: [
      {
        key: 'business_purpose',
        label: {
          en: 'Business purpose',
          fr: 'Objet métier',
          de: 'Geschäftlicher Zweck',
          es: 'Propósito de negocio',
        },
      },
      {
        key: 'overview_notes',
        label: {
          en: 'Overview notes',
          fr: "Notes de vue d'ensemble",
          de: 'Hinweise zur Übersicht',
          es: 'Notas de la visión general',
        },
      },
    ],
  },
  {
    heading: {
      en: 'Business Objects',
      fr: 'Objets métier',
      de: 'Geschäftsobjekte',
      es: 'Objetos de negocio',
    },
    fields: [
      {
        key: 'business_objects',
        label: {
          en: 'Business objects',
          fr: 'Objets métier',
          de: 'Geschäftsobjekte',
          es: 'Objetos de negocio',
        },
      },
    ],
  },
  {
    heading: {
      en: 'Use Cases',
      fr: "Cas d'usage",
      de: 'Anwendungsfälle',
      es: 'Casos de uso',
    },
    fields: [
      {
        key: 'main_use_cases',
        label: {
          en: 'Main use cases',
          fr: "Principaux cas d'usage",
          de: 'Wichtige Anwendungsfälle',
          es: 'Casos de uso principales',
        },
      },
    ],
  },
  {
    heading: {
      en: 'Business Rules',
      fr: 'Règles métier',
      de: 'Geschäftsregeln',
      es: 'Reglas de negocio',
    },
    fields: [
      {
        key: 'functional_rules',
        label: {
          en: 'Functional rules',
          fr: 'Règles fonctionnelles',
          de: 'Funktionale Regeln',
          es: 'Reglas funcionales',
        },
      },
    ],
  },
  {
    heading: {
      en: 'Impact of Failure',
      fr: 'Impact en cas de défaillance',
      de: 'Auswirkungen eines Ausfalls',
      es: 'Impacto de un fallo',
    },
    fields: [
      {
        key: 'impact_of_failure',
        label: {
          en: 'Impact of failure',
          fr: 'Impact en cas de défaillance',
          de: 'Auswirkungen eines Ausfalls',
          es: 'Impacto de un fallo',
        },
      },
    ],
  },
  {
    heading: {
      en: 'Transformations Overview',
      fr: "Vue d'ensemble des transformations",
      de: 'Überblick über die Transformationen',
      es: 'Visión general de las transformaciones',
    },
    fields: [
      {
        key: 'core_transformations_summary',
        label: {
          en: 'Core transformations summary',
          fr: 'Résumé des transformations',
          de: 'Zusammenfassung der Transformationen',
          es: 'Resumen de las transformaciones',
        },
      },
    ],
  },
  {
    heading: {
      en: 'Error Handling',
      fr: 'Traitement des erreurs',
      de: 'Fehlerbehandlung',
      es: 'Tratamiento de errores',
    },
    fields: [
      {
        key: 'error_handling_summary',
        label: {
          en: 'Error handling',
          fr: 'Traitement des erreurs',
          de: 'Fehlerbehandlung',
          es: 'Tratamiento de errores',
        },
      },
    ],
  },
  {
    heading: {
      en: 'Data & Compliance Notes',
      fr: 'Données et notes de conformité',
      de: 'Daten und Compliance-Hinweise',
      es: 'Datos y notas de conformidad',
    },
    fields: [
      {
        key: 'typical_data',
        label: {
          en: 'Typical data',
          fr: 'Données typiques',
          de: 'Typische Daten',
          es: 'Datos habituales',
        },
      },
      {
        key: 'audit_logging',
        label: {
          en: 'Audit logging',
          fr: "Journalisation d'audit",
          de: 'Audit-Protokollierung',
          es: 'Registro de auditoría',
        },
      },
      {
        key: 'security_controls_summary',
        label: {
          en: 'Security controls summary',
          fr: 'Résumé des contrôles de sécurité',
          de: 'Zusammenfassung der Sicherheitskontrollen',
          es: 'Resumen de los controles de seguridad',
        },
      },
    ],
  },
];

function specificationLanguage(language: string | null | undefined): InterfaceSpecificationLanguage {
  return language === 'fr' || language === 'de' || language === 'es' ? language : 'en';
}

/** The eight H2 headings of one language, each followed by a blank line. The library template is the English copy. */
export function interfaceSpecificationTemplateMarkdown(language?: string | null): string {
  const lang = specificationLanguage(language);
  return INTERFACE_SPECIFICATION_SECTIONS
    .flatMap((section) => [`## ${section.heading[lang]}`, ''])
    .join('\n');
}

/** Headings of one language, in order. Tests and the library template share this list. */
export function interfaceSpecificationHeadings(language?: string | null): string[] {
  const lang = specificationLanguage(language);
  return INTERFACE_SPECIFICATION_SECTIONS.map((section) => section.heading[lang]);
}

/**
 * The language of a specification that still opens on a shipped first heading.
 * Verification rebuilds the body in that language. A document someone rewrote
 * (a different first heading) has no system language.
 */
export function interfaceSpecificationLanguageOf(markdown: string | null | undefined): InterfaceSpecificationLanguage | null {
  const first = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('## '));
  if (!first) return null;
  const heading = first.slice(3).trim();
  const languages: InterfaceSpecificationLanguage[] = ['en', 'fr', 'de', 'es'];
  return languages.find((language) => INTERFACE_SPECIFICATION_SECTIONS[0].heading[language] === heading) ?? null;
}

export function buildInterfaceSpecificationMarkdown(
  row: InterfaceSpecificationSource,
  formatText: (text: string) => string,
  language?: string | null,
): string {
  const lang = specificationLanguage(language);
  return INTERFACE_SPECIFICATION_SECTIONS.map((section) => {
    const fieldBlocks = section.fields.flatMap((field) => {
      const rendered = formatInterfaceSpecificationValue(row[field.key], formatText);
      if (!rendered) {
        return [];
      }
      return [`### ${field.label[lang]}`, '', rendered];
    });

    return [
      `## ${section.heading[lang]}`,
      '',
      ...fieldBlocks,
    ].join('\n').trimEnd();
  }).join('\n\n');
}
