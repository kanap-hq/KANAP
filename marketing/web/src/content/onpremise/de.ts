import type { OnPremContent } from './types';

const content: OnPremContent = {
  meta: {
    title: 'KANAP selbst hosten, die bevorzugte Option',
    description:
      'Betreiben Sie KANAP auf Ihrer eigenen Infrastruktur, unter AGPL v3. Komplette Plattform inklusive KI-Agenten, unbegrenzte Nutzer, Ihre Daten verlassen nie Ihre Umgebung. Deployment in Minuten mit Docker Compose.',
  },

  header: {
    eyebrow: 'Self-Hosting · bevorzugte Option',
    title: 'Betreiben Sie KANAP selbst.\nJede Schicht unter Kontrolle.',
    lead: 'Open Source unter AGPL v3. Auf Ihre Infrastruktur deployen, Ihre Daten behalten, im eigenen Takt aktualisieren. Die komplette Plattform, unbegrenzte Nutzer, alle Funktionen, zu Ihren Bedingungen.',
    primaryCta: 'Von GitHub bereitstellen',
    primaryHref: 'https://github.com/kanap-hq/kanap',
    secondaryCta: 'Installationsdoku lesen',
    secondaryHref: 'https://doc.kanap.net/on-premise/',
  },

  why: {
    eyebrow: 'Warum selbst hosten',
    title: 'Kontrolle, Compliance und keine Haken.',
    intro:
      'Self-Hosting ist keine abgespeckte Variante. Es ist die komplette Plattform mit vollem Funktionsumfang, kostenlos. Das sind die Gründe, aus denen Teams sich zuerst dafür entscheiden.',
    pillars: [
      {
        title: 'Ihre Daten bleiben zu Hause',
        body: 'Budgets, Lieferantenverträge, IT-Landschaft, alles. Auf Ihren Servern, in Ihrem Netz. Kein Dritt-Datenverarbeiter, dem Sie Ihre Governance-Daten anvertrauen müssen. Auch die Schlussfolgerungen und Aktionen der Agenten laufen dort, was zählt, wenn ein Prüfer fragt.',
      },
      {
        title: 'Keine Platzsteuer',
        body: 'Unbegrenzte Nutzer, unbegrenzte Workspaces, Plaid und Agenten mit Ihrem eigenen LLM-Schlüssel. Rollout an die gesamte Abteilung ohne Preislisten-Tabelle.',
      },
      {
        title: 'Compliance-ready',
        body: 'Row-Level Security isoliert Tenants. Argon2-Passworthashing. TLS überall. Ihre VPC, Ihre Backups, Ihr SOC.',
      },
      {
        title: 'Quellcode prüfbar',
        body: 'AGPL v3 heißt offener Code. Security-Team liest ihn, Architekten erweitern ihn, CISO schläft besser.',
      },
      {
        title: 'Air-Gap-freundlich',
        body: 'Docker-Compose-Deployment läuft in eingeschränkten Netzen. Eigenständige Images, keine zwingenden ausgehenden Aufrufe für Kernfunktionen.',
      },
      {
        title: 'Ihr Takt',
        body: 'Version pinnen, Minor-Release testen, im Change-Fenster migrieren. Keine erzwungenen Updates, keine Überraschungs-Downtime.',
      },
    ],
  },

  license: {
    title: 'AGPL v3: Offenheit ohne Kompromisse',
    body:
      'KANAP steht unter der GNU Affero General Public License v3. Alle klassischen Open-Source-Freiheiten: nutzen, lesen, ändern, verteilen. Die Copyleft-Klausel sorgt dafür, dass jeder, der eine modifizierte Version als Service betreibt, seine Änderungen teilt, so bleibt das Projekt wirklich offen.',
    bullets: [
      'Kommerzielle, interne oder externe Nutzung, keine Lizenzgebühren, keine Platzbegrenzung',
      'Lesen und prüfen des kompletten Quellcodes, nichts versteckt',
      'Anpassen und erweitern, der Code gehört Ihnen',
      'Beitragen, Ihre Verbesserungen kommen der Community zugute',
    ],
    linkLabel: 'AGPL v3 Lizenz lesen',
    linkHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },

  deploy: {
    eyebrow: 'In Minuten installiert',
    title: 'Ein Prompt.\nFünfzehn Minuten.',
    intro:
      "Ein KI-Coding-Agent liest unsere Dokumentation, installiert alle Abhängigkeiten und konfiguriert den gesamten Stack (Docker, PostgreSQL 16, MinIO, nginx, Let's Encrypt) auf einem frischen Ubuntu-Server. Sie fügen einen Prompt ein, bestätigen die Schritte und melden sich an.",
    steps: [
      {
        title: 'Frischen Server vorbereiten',
        body: "Ein frisch bereitgestellter Ubuntu 24.04 LTS Host mit sudo-Zugriff, ein DNS-A-Record, der Ihren Hostnamen darauf zeigt, und ausgehender Internetzugang für Pakete und Let's Encrypt. Installieren Sie Ihren KI-Coding-Agenten auf dem Server (Claude Code, Codex oder ähnliches).",
      },
      {
        title: 'Temporär passwortloses sudo aktivieren',
        body: 'Damit der Agent bei jedem Schritt nicht nach Ihrem Passwort fragt. Am Ende wird das wieder entfernt.',
        code: 'echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/90-install-nopasswd',
      },
      {
        title: 'Den Install-Prompt einfügen',
        body: 'Öffnen Sie Ihren Agenten und fügen Sie die Prompt-Vorlage aus der Doku ein, tragen Sie dann Hostname, Admin-E-Mail und (optional) Ihren E-Mail-Transport (Resend oder SMTP) ein. Der Agent liest die verlinkten Installationsseiten, installiert Docker, PostgreSQL 16 mit den nötigen Erweiterungen, MinIO, nginx und certbot, klont KANAP nach /opt/kanap, generiert starke Zugangsdaten, baut die Images und startet die Container. Er richtet auch TLS und automatische Erneuerung ein. Vor jedem Befehl fragt der Agent zur Bestätigung.',
      },
      {
        title: 'Anmelden und absichern',
        body: 'Melden Sie sich unter Ihrem Hostnamen mit den generierten Admin-Daten an, ändern Sie das Passwort und entfernen Sie den temporären passwortlosen sudo-Eintrag. Fertig. Das vollständige Installationsprotokoll wird unter ~/kanap-install.md gespeichert.',
      },
    ],
    docsCtaLabel: 'Anleitung zur KI-unterstützten Installation',
    docsHref: 'https://doc.kanap.net/on-premise/installation-ai/',
    manualOption: {
      label: 'Lieber die volle Kontrolle?',
      title: 'Manuelle Installation: Ihr Stack, Ihre Regeln.',
      body: 'Bringen Sie Ihr eigenes PostgreSQL, Ihren S3-kompatiblen Speicher und Ihren Reverse-Proxy mit. Betreiben Sie es auf jedem Docker-fähigen Linux. Setzen Sie KANAP in die Architektur, die Sie bereits betreiben, mit der Konfiguration, die zu Ihrer Umgebung passt. Gleiche Plattform, gleicher Code, jede Entscheidung in Ihrer Hand.',
      ctaLabel: 'Anleitung zur manuellen Installation',
      ctaHref: 'https://doc.kanap.net/on-premise/installation/',
    },
  },

  requirements: {
    title: 'Was Sie brauchen',
    intro: 'Bescheidene Anforderungen für eine Plattform, die die gesamte IT steuert.',
    items: [
      { label: 'OS', value: 'Beliebiges Linux mit Docker (Ubuntu 22+, Debian 12+, RHEL 9+ empfohlen)' },
      { label: 'CPU', value: '2 vCPU minimum · 4+ empfohlen für 50+ Nutzer' },
      { label: 'RAM', value: '4 GB minimum · 8 GB empfohlen' },
      { label: 'Speicher', value: '20 GB für die Plattform + Datenzuwachs' },
      { label: 'Datenbank', value: 'PostgreSQL 15+ (im Compose enthalten oder extern)' },
      { label: 'Netzwerk', value: 'HTTPS-Terminator Ihrer Wahl, nginx, Traefik, Cloud-LB' },
      { label: 'Ausgehend (optional)', value: 'World-Bank-FX-API für Live-Kurse · LLM-Provider für Plaid' },
    ],
  },

  operations: {
    title: 'KANAP betreiben',
    intro: 'Gebaut, um wie jeder andere interne Dienst zu laufen.',
    items: [
      {
        title: 'Updates nach Plan',
        body: 'Version-Tag pinnen, Release in Pre-Prod testen, im Change-Fenster anwenden. Migrations laufen beim Boot, idempotent.',
      },
      {
        title: 'Backups sind ein Postgres-Dump',
        body: 'Standard-Tooling. pg_dump in Ihre bestehende Backup-Pipeline einbauen. Dateien sind klein und separat snapshotbar.',
      },
      {
        title: 'Observability, die Sie schon haben',
        body: 'Container liefern strukturierte Logs und Health-Endpoints. Richten Sie Ihren bestehenden Stack darauf aus (Prometheus, Loki, Datadog, was Sie schon haben).',
      },
      {
        title: 'Branding inklusive',
        body: 'Logo hochladen, Primärfarbe setzen. Die Admin-Branding-Seite funktioniert in Self-Hosting wie in Cloud.',
      },
      {
        title: 'SSO über Entra ID',
        body: 'Enterprise-SSO ist Teil der Plattform, kein Upsell. Konfiguration über die Admin-Konsole.',
      },
      {
        title: 'Plaid und Agenten nach Ihren Regeln',
        body: 'Ihr eigener LLM-Schlüssel für Plaid und Ihre Agenten, OpenAI, Anthropic, Ollama oder ein beliebiger OpenAI-kompatibler Endpoint. Die Schlussfolgerungen und Aktionen der Agenten laufen in Ihrer eigenen Installation, und das Einzige, was sie verlässt, ist der Prompt, den Sie an den von Ihnen gewählten Anbieter senden.',
      },
    ],
  },

  support: {
    title: 'Prioritäre Hilfe gewünscht?',
    body:
      'Der Self-Hosted-Support-Plan bringt prioritären E-Mail-Support, Installationshilfe, Plaid-BYOK-Freischaltung und 20 % Rabatt auf Beratung, ohne das Betriebsmodell zu ändern.',
    bullets: [
      'Prioritärer E-Mail-Support (echte Menschen, Best-Effort-Reaktion)',
      'Hilfe bei Installation und Upgrades',
      '20 % Rabatt auf alle Beratungsleistungen',
      '2.490 €/Jahr, jährliche Abrechnung',
    ],
    ctaLabel: 'Preise ansehen',
    ctaHref: '/offer',
  },

  cta: {
    title: 'Bereit für Self-Hosting?',
    body: 'Repo klonen und Stack in unter zehn Minuten starten. Kein Konto nötig, kein Countdown, nur Open Source.',
    primary: 'Von GitHub bereitstellen',
    secondary: 'Sprechen Sie mit uns',
  },
};

export default content;
