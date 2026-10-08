import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'IT-Landschaft',
    description:
      'Dokumentieren Sie Anwendungen, Schnittstellen und Infrastruktur. Interaktive Architekturkarten, Lifecycle-Tracking, 3-Leg-Middleware. Open Source. Self-Hosting kostenlos oder Hosted Cloud.',
  },
  header: {
    eyebrow: 'IT-Landschaft',
    title: 'Dokumentieren Sie Ihr gesamtes Informationssystem.',
    lead: 'Anwendungen, Schnittstellen und Infrastruktur an einem Ort. Visualisieren Sie Ihre Architektur mit interaktiven Karten und verfolgen Sie den Lebenszyklus vom Vorschlag bis zur Abschaltung.',
  },
  sections: [
    {
      title: 'Anwendungsportfolio',
      body: 'Pflegen Sie ein vollständiges Inventar Ihrer Anwendungen mit Instanzen pro Umgebung. Verfolgen Sie Eigentümerschaft, Kritikalität, Compliance-Status und Lebenszyklusphase. Versionslineage im Blick, während sich Anwendungen weiterentwickeln.',
      bullets: [
        'Logische Anwendungen mit Instanzen pro Umgebung (Prod, Pre-Prod, QA, Dev)',
        'Versions-Lineage für die Entwicklung',
        'Lebenszyklus: Vorgeschlagen, Aktiv, Veraltet, Abgeschaltet',
        'Eigentümerschaft: IT-Owner, Fachbereichs-Owner, Support-Kontakte',
        'Compliance-Felder: Datenklasse, PII-Kennzeichen, Residency',
      ],
      shotAlt: 'Anwendungsportfolio mit Lifecycle-Spalten',
    },
    {
      title: 'Schnittstellendokumentation',
      body: 'Dokumentieren Sie Integrationen zwischen Anwendungen mit fachlicher und technischer Definition. Unterstützung für Direktverbindungen und 3-Leg-Middleware-Muster (Extract / Transform / Load). Bindings pro Umgebung mit Endpoints und Authentifizierung konfigurieren.',
      bullets: [
        'Fachlicher Zweck, Datenkategorie, Prozessverknüpfung',
        'Route-Typen: direkt oder via Middleware',
        '3-Leg-Unterstützung: Extract, Transform, Load',
        'Binding-Konfiguration pro Umgebung und pro Leg',
        'Funktionale Definition: Geschäftsobjekte, Use Cases, Identifier',
      ],
      shotAlt: 'Schnittstellendetail mit 3-Leg-Middleware',
    },
    {
      title: 'Infrastruktur-Register',
      body: 'Verfolgen Sie Server, Standorte und Verbindungen über Ihre Infrastruktur hinweg. Unterstützung für On-Premise- und Cloud-Deployments. Dokumentieren Sie die Netzwerkkonnektivität mit Multi-Server-Topologien und geschichtetem Routing.',
      bullets: [
        'Server-Register: VMs, Datenbanken, Queues, Container, Functions',
        'Standorte: Rechenzentren, Cloud-Regionen, Availability Zones',
        'Server-zu-Server- und Multi-Server-Mesh-Verbindungen',
        'Cluster-Unterstützung mit Mitglieder-Gruppierung',
        'Betriebssystem-Tracking mit Supportfristen',
      ],
      shotAlt: 'Server-Register nach Standort gruppiert',
    },
    {
      title: 'Interaktive Architekturkarten',
      body: 'Zwei D3-basierte Visualisierungen helfen beim schnellen Verständnis Ihrer Architektur. Filtern Sie nach Umgebung, Lebenszyklus oder bestimmten Root-Knoten. Export als SVG oder PNG für die Dokumentation. Diese Landschaft ist auch die Karte, die Ihre Agenten lesen, um zu wissen, welche Anwendung ein Problem betrifft, wer sie verantwortet und wie kritisch sie ist.',
      bullets: [
        'Schnittstellenkarte: Apps als Knoten, Interfaces als Kanten',
        'Verbindungskarte: Server und Netzwerkkonnektivität',
        'Fachliche Sicht (blendet Middleware aus) und technische Sicht',
        'Tiefenfilter: Graph auf N Hops ab ausgewählten Knoten begrenzen',
        'SVG- und PNG-Export in 2x-Auflösung',
      ],
      shotAlt: 'Interaktive Schnittstellenkarte mit Filtern',
    },
  ],
  more: {
    title: 'Mehr in IT-Landschaft',
    items: [
      { title: 'Risikoableitung', body: 'Verbindungsrisiko automatisch aus verknüpften Schnittstellen abgeleitet. Kritikalität, Datenklasse, PII werden mitgezogen.' },
      { title: 'Support-Kontakte', body: 'Interne Nutzer und externe Kontakte pro Anwendung, mit Rollen und Notizen.' },
      { title: 'Kostenverknüpfung', body: 'Anwendungen an OPEX- und CAPEX-Posten knüpfen. Sehen Sie die echten Portfoliokosten.' },
      { title: 'CSV-Import/-Export', body: 'Anwendungen und Assets in Masse importieren. Inventar für Analysen exportieren.' },
    ],
  },
  crossLinks: {
    label: 'Andere Module entdecken',
    links: [
      { label: 'Agenten', href: '/features/agents' },
      { label: 'Plaid, KI-Assistent', href: '/features/ai' },
      { label: 'Budget-Management', href: '/features/budget' },
      { label: 'Portfolio-Management', href: '/features/portfolio' },
      { label: 'Wissen', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: 'Bereit, Ihr Informationssystem zu dokumentieren?',
    body: 'Hosten Sie kostenlos selbst oder testen Sie Hosted Cloud. Alle Funktionen in jedem Plan.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Hosted Cloud testen',
  },
};

export default content;
