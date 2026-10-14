/**
 * The specification document of an interface, assembled from the texts of the
 * interface. Each text goes through `formatText`: the Markdown workers convert
 * legacy HTML there (integrated-document-markdown.ts); the plain-text fallback of
 * integrated-documents.service.ts keeps the texts as they are.
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

export function buildInterfaceSpecificationMarkdown(
  row: InterfaceSpecificationSource,
  formatText: (text: string) => string,
): string {
  const sections: Array<{
    heading: string;
    fields: Array<{ label: string; value: unknown }>;
  }> = [
    {
      heading: 'Business Purpose & Overview',
      fields: [
        { label: 'Business purpose', value: row.business_purpose },
        { label: 'Overview notes', value: row.overview_notes },
      ],
    },
    {
      heading: 'Business Objects',
      fields: [{ label: 'Business objects', value: row.business_objects }],
    },
    {
      heading: 'Use Cases',
      fields: [{ label: 'Main use cases', value: row.main_use_cases }],
    },
    {
      heading: 'Business Rules',
      fields: [{ label: 'Functional rules', value: row.functional_rules }],
    },
    {
      heading: 'Impact of Failure',
      fields: [{ label: 'Impact of failure', value: row.impact_of_failure }],
    },
    {
      heading: 'Transformations Overview',
      fields: [{ label: 'Core transformations summary', value: row.core_transformations_summary }],
    },
    {
      heading: 'Error Handling',
      fields: [{ label: 'Error handling', value: row.error_handling_summary }],
    },
    {
      heading: 'Data & Compliance Notes',
      fields: [
        { label: 'Typical data', value: row.typical_data },
        { label: 'Audit logging', value: row.audit_logging },
        { label: 'Security controls summary', value: row.security_controls_summary },
      ],
    },
  ];

  return sections.map((section) => {
    const fieldBlocks = section.fields.flatMap((field) => {
      const rendered = formatInterfaceSpecificationValue(field.value, formatText);
      if (!rendered) {
        return [];
      }
      return [`### ${field.label}`, '', rendered];
    });

    return [
      `## ${section.heading}`,
      '',
      ...fieldBlocks,
    ].join('\n').trimEnd();
  }).join('\n\n');
}
