import type { SecurityContent } from './types';

const content: SecurityContent = {
  meta: {
    title: 'Sicherheit',
    description:
      'Wie KANAP Ihre Daten schützt: Row-Level Security, gehashte Passwörter, verschlüsselte Secrets, RBAC, Audit-Trail, Agenten-Governance, SSO und Open-Source-Transparenz. Self-Hosting oder Cloud.',
  },
  header: {
    eyebrow: 'Sicherheit',
    title: 'Sicherheit, die Ihre Daten respektiert.',
    lead:
      'Governance-taugliche Kontrollen vom ersten Tag an. Dieselbe Plattform läuft in unserer Cloud und auf Ihren eigenen Servern, mit derselben Isolation, Zugriffskontrolle, Auditierbarkeit und Governance darüber, was Agenten tun dürfen.',
  },
  overview: {
    title: 'Prinzipien',
    intro:
      'KANAP ist für IT-Abteilungen konzipiert, die mit sensiblen Daten arbeiten. Wir behandeln Ihre Daten so, wie wir es uns von unseren IT-Anbietern wünschen, transparent, isoliert und bei Bedarf greifbar.',
    pillars: [
      {
        title: 'Transparent by default',
        body: 'Der komplette Quellcode liegt auf GitHub unter AGPL v3. Ihr Security-Team liest ihn, prüft ihn oder forkt ihn. Nichts versteckt sich hinter proprietären Binaries.',
      },
      {
        title: 'Isoliert by design',
        body: 'Row-Level Security in der Datenbank selbst erzwingt die Tenant-Isolation bei jeder Abfrage, die die Anwendung ausführt.',
      },
      {
        title: 'Immer exportierbar',
        body: 'Ihre Daten gehören Ihnen. CSV-Export auf den wichtigsten Listen, Dokumentexport nach PDF, DOCX und ODT. Keine Extraktions-Gebühr.',
      },
    ],
  },
  tenancy: {
    title: 'Tenant-Isolation',
    body:
      'KANAP ist auf Datenbankebene multi-tenant. Jede Zeile in jeder geteilten Tabelle trägt eine `tenant_id`, und PostgreSQL Row-Level-Security-Policies erzwingen den Filter bei jedem Lese- und Schreibzugriff. Die Policy ist Teil des Datenbankschemas und gilt damit für jede Abfrage der Anwendung.',
    bullets: [
      'PostgreSQL-RLS-Policies auf jeder Tabelle mit Tenant-Daten, alle erzwungen (FORCE)',
      '`tenant_id`-Filter auf Datenbankebene erzwungen, nicht nur in der App',
      'Der aktuelle Tenant wird zu Beginn jeder Datenbanktransaktion gesetzt, und die Policies lesen ihn',
      'Die Datenbankrolle der Anwendung hat weder Superuser- noch Bypass-Rechte, sonst startet die Anwendung nicht',
      'Eine Tabelle mit Tenant-Daten ohne Isolations-Policy lässt die CI-Tests fehlschlagen',
      'Tenant-Isolationstests bei jedem CI-Lauf',
    ],
  },
  dataProtection: {
    title: 'Datenschutz',
    body:
      'Standardpraktiken, konsequent angewandt. Starkes Passwort-Hashing, verschlüsselte Secrets, gehashte Tokens und HTTPS bei jeder Cloud-Verbindung.',
    bullets: [
      'Cloud: HTTPS für jede Verbindung zwischen Nutzern und Plattform, mit Weiterleitung von HTTP auf HTTPS und Cloudflare, das TLS vor unseren Servern beendet. Self-Hosting: Sie beenden TLS mit Ihren eigenen Zertifikaten',
      'Argon2id-Passwort-Hashing (64 MiB Speicherkosten) mit Salts pro Nutzer',
      'Secrets über Environment, nicht im Code',
      'Ihre eigenen KI-Provider-Schlüssel und Integrationszugangsdaten (GLPI, Netbox) im Ruhezustand mit AES-256-GCM verschlüsselt',
      'MCP-Tokens und Refresh-Tokens der Sitzung werden gehasht gespeichert und sind widerrufbar',
      'Zugriffstoken im Browser nur im Arbeitsspeicher, Refresh-Token in einem HttpOnly-Cookie',
    ],
  },
  access: {
    title: 'Zugriffskontrolle',
    body:
      'Feinkörnige Berechtigungen pro Modul, pro Rolle. Jedes Feature-Gate und jede Entity-Abfrage respektiert dieselbe RBAC-Matrix, auch Plaid und MCP.',
    bullets: [
      'Stufen Leser, Mitwirkender, Mitglied und Admin pro Modul',
      'Workspace-Admin-Rolle getrennt von Modul-Admins',
      'SSO über Microsoft Entra ID (OIDC) in Cloud und Self-Hosting',
      'Lokale Passwort-Authentifizierung mit Argon2 + optionale Passwort-Reset-Flows',
      'Plaid und MCP erzwingen dasselbe RBAC wie das UI, keine Privilegienerweiterung',
      'API-Tokens pro Nutzer gebunden, jederzeit widerrufbar',
    ],
  },
  audit: {
    title: 'Audit-Trail',
    body:
      'Jede relevante Änderung wird protokolliert. Wer hat was geändert, wann, mit Werten vorher und nachher. Aktivität in der App sichtbar.',
    bullets: [
      'Zeitleiste pro Entity (Aufgaben, Projekte, Dokumente usw.)',
      'Anlegen, Ändern und Deaktivieren mit Nutzer, Zeitstempel sowie Werten vorher und nachher protokolliert',
      'Administratoren durchsuchen und filtern das Audit-Log in der App',
      'Änderungen über Plaid werden im selben Trail protokolliert, mit ihrer Herkunft. Agenten führen einen eigenen Aktivitätsverlauf, mit den Quellen, die jeder Agent genutzt hat',
    ],
  },
  agentGovernance: {
    title: 'Agenten-Governance',
    body:
      'Agenten handeln unter denselben Kontrollen wie alles andere, plus Grenzen, die für autonome Arbeit gelten. Jede Agentenaktion wird protokolliert und auf das beschränkt, was Sie erlaubt haben, und Sie können einen Agenten jederzeit stoppen. Jeder Agent startet mit allen Aktionsarten unter Ihrer Freigabe. Sie entscheiden, wann eine Aktionsart automatisch läuft, und die Bilanz des Agenten (geprüfte Vorschläge, Akzeptanzquote, Aktivitätstage) steht neben dieser Entscheidung.',
    bullets: [
      'Agenten handeln nur über definierte Operationen, ohne direkten Datenbank- oder Shell-Zugriff',
      'Jeder Agent auf die Operationen beschränkt, die Sie erlauben. Wer Agenten konfigurieren oder deren Arbeit prüfen darf, folgt denselben Rollen wie der Rest der Anwendung',
      'Jede Agentenaktion im Aktivitätsverlauf des Agenten protokolliert, standardmäßig 30 Tage aufbewahrt und von 7 bis 90 Tagen einstellbar',
      'Antworten tragen die Quellen, die der Agent genutzt hat, sodass eine Entscheidung geprüft werden kann',
      'Jeden Agenten sofort pausieren, einzeln oder alle zusammen',
      'Ausgabenlimits pro Agent halten die Betriebskosten begrenzt',
      'KI-Funktionen sind standardmäßig ausgeschaltet. In der Cloud erhält das integrierte Modell keine Daten, bevor der Workspace dessen Anbieter und Verarbeitungsort akzeptiert hat, die beide in der Anwendung genannt werden. Ein Administrator bestätigt sie, und ändert sich eines davon, wird erneut um Bestätigung gebeten. Workspaces, die den Assistenten oder einen Agenten vor Einführung dieser Bestätigung eingeschaltet hatten, gelten als mit dem aktuellen Anbieter einverstanden. Sie können stattdessen Ihren eigenen Modellanbieter verwenden',
    ],
  },
  deployment: {
    title: 'Deployment & Betrieb',
    body:
      'Cloud-Deployments laufen auf Linux-Hosts in Deutschland, innerhalb der Europäischen Union, mit Cloudflare davor. Self-Hosted-Deployments laufen dort, wo Sie wollen. Beide haben dasselbe Sicherheitsmodell.',
    bullets: [
      'Cloud-Hosting bei der Hetzner Online GmbH in Nürnberg, Deutschland (EU), mit Cloudflare davor für CDN, TLS-Terminierung und Schutz',
      'Self-Hosting: Der vollständige Quellcode ist öffentlich, und Sie bauen und betreiben ihn selbst mit Docker Compose',
      'Self-Hosting: keine zwingenden ausgehenden Aufrufe für Kernfunktionen, KANAP kann also ohne Internetzugang laufen',
      'Self-Hosting: Sie entscheiden, wo es läuft und wie es gesichert wird',
      'Self-Hosting: KI-Funktionen nutzen nur den Modellanbieter, den Ihr Administrator konfiguriert',
    ],
  },
  disclosure: {
    title: 'Responsible Disclosure',
    body:
      'Wenn Sie ein Sicherheitsproblem finden, wollen wir davon erfahren. Melden Sie es privat, am besten über das private Schwachstellen-Reporting von GitHub oder per E-Mail. Geben Sie uns ein angemessenes Zeitfenster zur Behebung, und wir nennen Sie im Advisory, es sei denn, Sie bleiben lieber anonym.',
    emailLabel: 'security@kanap.net',
    email: 'security@kanap.net',
  },
  cta: {
    title: 'Fragen zur Sicherheit?',
    body: 'Wir teilen gerne Architektur-Details, besprechen ein Threat Model mit Ihrem Security-Team.',
    primary: 'Sprechen Sie mit uns',
    secondary: 'Selbst hosten und den Code prüfen',
  },
};

export default content;
