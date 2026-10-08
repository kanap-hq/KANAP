import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'IT landscape',
    description:
      'Document applications, interfaces, and infrastructure. Interactive architecture maps, lifecycle tracking, 3-leg middleware. Open source. Self-host free or choose hosted cloud.',
  },
  header: {
    eyebrow: 'IT landscape',
    title: 'Document your entire information system.',
    lead: 'Applications, interfaces and infrastructure in one place. Visualise your architecture with interactive maps and track lifecycles from proposal to retirement.',
  },
  sections: [
    {
      title: 'Application portfolio',
      body: 'Maintain a comprehensive inventory of your applications with per-environment instances. Track ownership, criticality, compliance status and lifecycle stage. Manage version lineage as applications evolve.',
      bullets: [
        'Logical applications with per-environment instances (prod, pre-prod, QA, dev)',
        'Version lineage tracking for evolution',
        'Lifecycle: Proposed, Active, Deprecated, Retired',
        'Ownership: IT owners, business owners, support contacts',
        'Compliance fields: data class, PII flag, residency',
      ],
      shotAlt: 'Application portfolio with lifecycle columns',
    },
    {
      title: 'Interface documentation',
      body: 'Document integrations between applications with business and technical definitions. Support for direct connections and 3-leg middleware patterns (Extract / Transform / Load). Configure per-environment bindings with endpoints and authentication.',
      bullets: [
        'Business purpose, data category, process linking',
        'Direct or via-middleware route types',
        '3-leg support: Extract, Transform, Load',
        'Per-environment, per-leg binding configuration',
        'Functional definition: business objects, use cases, identifiers',
      ],
      shotAlt: 'Interface detail with 3-leg middleware',
    },
    {
      title: 'Infrastructure registry',
      body: 'Track servers, locations and connections across your infrastructure. Support for on-premise and cloud deployments. Document network connectivity with multi-server topologies and layered routing.',
      bullets: [
        'Server registry: VMs, databases, queues, containers, functions',
        'Locations: datacenters, cloud regions, availability zones',
        'Server-to-server and multi-server mesh connections',
        'Cluster support with member grouping',
        'Operating system tracking with support dates',
      ],
      shotAlt: 'Server registry grouped by location',
    },
    {
      title: 'Interactive architecture maps',
      body: 'Two D3-powered visualisations help you understand your architecture at a glance. Filter by environment, lifecycle or specific root nodes. Export to SVG or PNG for documentation. This landscape is also the map your agents read, to know which application a problem touches, who owns it, and how critical it is.',
      bullets: [
        'Interface map: apps as nodes, interfaces as edges',
        'Connection map: servers and network connectivity',
        'Business view (hides middleware) and technical view',
        'Depth filtering: limit graph to N hops from selected nodes',
        'SVG and PNG export at 2x resolution',
      ],
      shotAlt: 'Interactive interface map with filters',
    },
  ],
  more: {
    title: 'More in IT landscape',
    items: [
      { title: 'Risk derivation', body: 'Connection risk calculated from linked interfaces. Criticality, data class, PII auto-derived.' },
      { title: 'Support contacts', body: 'Internal users and external contacts per application with roles and notes.' },
      { title: 'Cost linking', body: 'Link applications to OPEX / CAPEX items. See the true cost of your portfolio.' },
      { title: 'CSV import / export', body: 'Bulk import applications and assets. Export your inventory for analysis.' },
    ],
  },
  crossLinks: {
    label: 'Explore the platform',
    links: [
      { label: 'Agents', href: '/features/agents' },
      { label: 'Plaid, AI assistant', href: '/features/ai' },
      { label: 'Budget management', href: '/features/budget' },
      { label: 'Portfolio management', href: '/features/portfolio' },
      { label: 'Knowledge', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: 'Ready to document your information system?',
    body: 'Self-host for free, or try hosted cloud. All features on every plan.',
    primary: 'Deploy free',
    secondary: 'Try hosted cloud',
  },
};

export default content;
