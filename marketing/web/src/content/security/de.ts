import type { SecurityContent } from './types';

const content: SecurityContent = {
  meta: {
    title: 'Sicherheit',
    description:
      'Wie KANAP Ihre Daten schützt: Row-Level Security, gehashte Passwörter, verschlüsselte Secrets, RBAC, ein Sicherheits-Audit-Log, Agenten-Governance, SSO, ein transparenter Build und Open Source. Self-Hosting oder Cloud.',
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
      'Anmeldeversuche werden pro Client-Adresse begrenzt: 5 Passwortversuche und 60 Microsoft-Anmeldeanfragen pro Minute. Hinter einem Reverse Proxy folgt das Limit der tatsächlichen Adresse jeder Person',
      'Sitzungstokens werden nur in dem einen Signaturverfahren akzeptiert, mit dem KANAP sie ausstellt',
      'Plaid und MCP erzwingen dasselbe RBAC wie das UI, keine Privilegienerweiterung',
      'API-Tokens pro Nutzer gebunden, jederzeit widerrufbar',
    ],
  },
  audit: {
    title: 'Audit-Trail',
    body:
      'Jede relevante Änderung wird protokolliert, ebenso die Sicherheitsereignisse drumherum. Wer hat was wann geändert, wer hat sich angemeldet, wer ist daran gescheitert, wer hat Daten exportiert. Administratoren sehen alles in der App.',
    bullets: [
      'Zeitleiste pro Entity (Aufgaben, Projekte, Dokumente usw.)',
      'Anlegen, Ändern und Deaktivieren mit Nutzer, Zeitstempel sowie Werten vorher und nachher protokolliert',
      'Änderungen an Rollen und Berechtigungen mit Urheber sowie Werten vorher und nachher protokolliert',
      'Anmeldungen, fehlgeschlagene Anmeldungen, Abmeldungen, abgelehnte Sitzungsverlängerungen, Passwort-Resets und Microsoft-Anmeldungen mit Rechneradresse und Browser protokolliert. Passwörter und Tokens werden nie ins Protokoll geschrieben',
      'Vom Server erzeugte Exporte protokolliert, mit Angabe, wer was exportiert hat',
      'Anmelde- und Sitzungsereignisse 365 Tage aufbewahrt',
      'Administratoren durchsuchen und filtern das Audit-Log in der App und exportieren es als CSV in einem festen Format, das Werkzeuge zur Protokollsammlung unverändert lesen (bis zu 100.000 Einträge pro Datei)',
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
      'KI-Funktionen sind standardmäßig ausgeschaltet. In der Cloud erhält das integrierte Modell keine Daten, bevor der Workspace dessen Anbieter und Verarbeitungsort akzeptiert hat, die beide in der Anwendung genannt werden. Ein Administrator bestätigt sie, und ändert sich eines davon, wird erneut um Bestätigung gebeten. Sie können stattdessen Ihren eigenen Modellanbieter verwenden',
    ],
  },
  supplyChain: {
    title: 'Software-Lieferkette',
    body:
      'Was auf Ihren Servern läuft, wird aus dem öffentlichen Quellcode gebaut, und die Art des Builds wird bei jeder Änderung geprüft. Sie können nachprüfen, was ausgeliefert wird.',
    bullets: [
      'Das API-Image wird in zwei Stufen gebaut: Das laufende Image enthält die kompilierte Anwendung und ihre Produktionsabhängigkeiten, ohne Quellcode und Entwicklungswerkzeuge',
      'Container laufen mit reduzierten Rechten: Die API läuft als unprivilegierter Benutzer, und Container geben die Linux-Capabilities ab, die sie nicht brauchen, und erlangen keine neuen',
      'Der Web-Container sendet die üblichen Sicherheits-Header und gibt seine nginx-Version nicht preis',
      'Basis-Images sind auf einen festen Digest festgelegt. Updates kommen als Pull Requests, die dieselben Prüfungen durchlaufen wie jede andere Änderung',
      'Für jede veröffentlichte Version entstehen eine Komponentenliste (CycloneDX) für Backend, Frontend und Website, die Pakete des API-Images und eine Datei mit Hinweisen zu Drittanbieter-Software',
      'Die Lizenzen der Produktionsabhängigkeiten werden bei jedem Merge geprüft, und eine Abhängigkeit mit nicht akzeptierter oder fehlender Lizenz blockiert ihn',
      'CI-Actions sind auf vollständige Commit-Hashes festgelegt, und das Workflow-Token ist standardmäßig schreibgeschützt',
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
      'Self-Hosting: Beim Start warnt KANAP, wenn das Signatur-Secret kurz ist oder das Passwort des ersten Administrators noch ein Beispielwert ist',
      'Self-Hosting: Der Zustand der API- und Web-Container erscheint in der Ausgabe von docker ps, und Docker-Logs sind auf etwa 50 MB pro Container begrenzt',
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
