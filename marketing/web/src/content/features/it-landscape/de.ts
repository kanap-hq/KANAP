import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'IT-Landschaft',
    description:
      'Anwendungen, Technologien, Schnittstellen und Server in einem Repository. Schwachstellen und Supportende bis zur Fachanwendung. Open Source.',
  },
  header: {
    eyebrow: 'IT-Landschaft',
    title: 'Dokumentieren Sie Ihr gesamtes Informationssystem.',
    lead: 'Anwendungen, Technologien, Schnittstellen und Infrastruktur an einem Ort. Verfolgen Sie Supportende und Schwachstellen bis zur Fachanwendung und visualisieren Sie Ihre Architektur auf interaktiven Karten.',
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
        'Wenn dieser Server ausfällt: betroffene Anwendungen, Cluster und Prozesse',
      ],
      shotAlt: 'Server-Register nach Standort gruppiert',
    },
    {
      title: 'Technologien und Supportende',
      body: 'Technologien verbinden Ihre Anwendungen mit Ihren Servern: Datenbanken, Middleware, Betriebssysteme, Verzeichnisdienste, Cloud-Dienste. Jede trägt ihre Versionen und deren Supportende, vom Katalog aktuell gehalten.',
      bullets: [
        'Katalog mit 192 Produkten, eine Technologie mit einem Klick angelegt',
        'Supportdaten von endoflife.date und den Herstellern, mit Quelle',
        'Das Betriebssystem jedes Servers, mit seiner Version',
        'Bericht Supportende: was ausläuft und was davon betroffen ist',
        'Verknüpfungen mit Servern und Anwendungen, per CSV importierbar',
      ],
      shotAlt: 'Technologie-Datensatz mit Versionen und deren Supportende',
    },
    {
      title: 'Schwachstellen',
      body: 'KANAP gleicht veröffentlichte Schwachstellen mit Ihren Technologien ab, Version für Version, und zeigt die betroffenen Server und Fachanwendungen. Ausgenutzte Schwachstellen stehen oben.',
      bullets: [
        'Zwei Quellen alle 6 Stunden: die NVD und die Herstellereinträge auf CVE.org',
        'Ausnutzungssignale: Kataloge von CISA und Europäischer Union, EPSS-Wert',
        'In den Listen und Datensätzen der Server und Anwendungen und im Dashboard',
        'Zu bearbeiten, behoben, nicht betroffen: mit Notiz und Audit-Log',
        'E-Mail an die IT-Verantwortlichen bei schweren oder ausgenutzten Schwachstellen',
      ],
      shotAlt: 'Seite Schwachstellen, ausgenutzte Schwachstellen zuerst',
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
      { title: 'Administrationszonen', body: 'Wer was administriert, nach dem Tier-Modell. Lücken in der Trennung zwischen Zonen werden gemeldet.' },
      { title: 'Kostenverknüpfung', body: 'Anwendungen, Server und Technologien mit Budgetzeilen und Verträgen verknüpfen. Sehen Sie die echten Portfoliokosten.' },
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
