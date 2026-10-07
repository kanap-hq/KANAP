import type { FaqContent } from './types';

const content: FaqContent = {
  meta: {
    title: 'FAQ',
    description:
      'Häufige Fragen zu KANAP: Preise, Lizenz, Self-Hosting, Hosted Cloud, Plaid, Agenten, Support und Abrechnung.',
  },
  header: {
    eyebrow: 'FAQ',
    title: 'Häufige Fragen.',
    lead:
      'Alles, was Sie über KANAP wissen müssen, Lizenz, Preise, Hosting, Plaid und Agenten. Wenn Sie Ihre Antwort nicht finden, schreiben Sie uns.',
  },
  groups: [
    {
      label: 'Lizenz & Open Source',
      items: [
        {
          q: 'Unter welcher Lizenz steht KANAP?',
          a: 'KANAP steht unter der <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener" target="_blank">AGPL v3</a>, einer weithin anerkannten Open-Source-Lizenz, die von der OSI genehmigt ist. Sie können die Software frei nutzen, ändern und weitergeben. Die Copyleft-Klausel der AGPL stellt sicher, dass jeder, der eine modifizierte Version als Service betreibt, seine Änderungen teilen muss. Das schützt die Community und hält KANAP wirklich offen.',
        },
        {
          q: 'Darf ich KANAP kommerziell nutzen?',
          a: 'Ja. Interne Nutzung, kommerzielle Nutzung, externes SaaS, alles erlaubt. Die Copyleft-Regelung verpflichtet Sie nur dann zum Teilen Ihrer Änderungen, wenn Sie eine modifizierte Version als Netzwerk-Service betreiben. Rein interne Nutzung löst keine Verpflichtung aus.',
        },
        {
          q: 'Kann ich zu KANAP beitragen?',
          a: 'Ja, gerne. Der vollständige Quellcode liegt auf <a href="https://github.com/kanap-hq/kanap" rel="noopener" target="_blank">GitHub</a>. Issues, Pull Requests und Diskussionen sind willkommen. Siehe CONTRIBUTING.md für die Richtlinien.',
        },
      ],
    },
    {
      label: 'Cloud & Testversion',
      items: [
        {
          q: 'Wie funktioniert die kostenlose Testversion?',
          a: 'Hosted KANAP beginnt mit einem 14-tägigen kostenlosen Test. Keine Kreditkarte erforderlich. Voller Zugriff auf alle Funktionen, plus eine kostenlose 60-minütige Aktivierungssitzung pro Unternehmen, wenn sie während der Testphase gebucht wird.',
        },
        {
          q: 'Was passiert nach meiner Testphase?',
          a: 'Nach Ihrem 14-tägigen Test müssen Sie einen kostenpflichtigen Plan wählen, um fortzufahren. Ihr Tenant bleibt weitere 30 Tage mit eingeschränktem Zugriff verfügbar. Nach Ablauf dieser 30 Tage wird Ihr Tenant gelöscht.',
        },
        {
          q: 'Was ist die kostenlose Aktivierungssitzung?',
          a: 'Jeder Test enthält eine kostenlose 60-minütige Aktivierungssitzung pro Unternehmen. Nach der Buchung schreiben wir Ihnen per E-Mail, um den Call zu vereinbaren. Die Sitzung ist ein Videocall, der sich auf die ersten Werte-Meilensteine entlang Ihrer Hauptziele konzentriert.',
        },
        {
          q: 'Was ist der Unterschied zwischen Cloud und Self-Hosting?',
          a: 'Cloud-Hosting heißt, wir betreiben alles für Sie: Hosting, Updates, Backups, Infrastruktur und prioritären Support. Self-Hosting heißt, Sie betreiben KANAP auf eigenen Servern. Das komplette Produkt ist kostenlos selbst hostbar; für prioritäre Hilfe können Sie Self-Hosted Support hinzubuchen.',
        },
      ],
    },
    {
      label: 'Self-Hosting & Support',
      items: [
        {
          q: 'Was ist Self-Hosted Support?',
          a: 'Self-Hosted Support ist ein professionelles Support-Add-on für selbstgehostete Installationen. Es enthält prioritären E-Mail-Support, Installations- und Upgrade-Troubleshooting sowie einen reduzierten Beratungstarif (900 € pro Tag statt 1.150 €). Preis: 2.490 €/Jahr.',
        },
        {
          q: 'Wie funktioniert der prioritäre Support?',
          a: 'Für zahlende Abonnenten: Schreiben Sie uns eine E-Mail bei operativen Problemen. Wir streben eine Reaktion innerhalb von 24 Stunden an und lösen Ihr Problem. Best-Effort, kein SLA, aber echte Menschen, die jede Nachricht lesen und beantworten.',
        },
      ],
    },
    {
      label: 'Abrechnung',
      items: [
        {
          q: 'Kann ich per Rechnung zahlen?',
          a: 'Rechnungszahlung (Überweisung) ist für jährliche Abonnements über 1.000 € für EUR-Kunden verfügbar. Heute heißt das: Self-Hosted Support und Hosted KANAP im Jahresabo. Rechnungen sind NET30.',
        },
        {
          q: 'Kann ich zwischen Self-Hosting und Hosted Cloud wechseln?',
          a: 'Ja. KANAP ist in beiden Modi dasselbe Produkt. Kontaktieren Sie uns, wenn Sie von Self-Hosting zu Hosted Cloud wechseln möchten oder einen Export benötigen, um die Plattform selbst zu betreiben.',
        },
        {
          q: 'Kann ich mein Abonnement kündigen?',
          a: 'Selbstverständlich. Kündigen Sie jederzeit im Billing Center, Ihr Abonnement bleibt bis zum Ende der aktuellen Abrechnungsperiode aktiv, keine Nachfragen.',
        },
      ],
    },
    {
      label: 'Plaid (KI-Assistent)',
      items: [
        {
          q: 'Was ist der Unterschied zwischen den inkludierten Plaid-Nachrichten und Bring Your Own Key?',
          a: 'Hosted KANAP enthält eine großzügige Zahl an Plaid-Nachrichten, betrieben mit einem Mid-Range-Modell, das wir sorgfältig ausgewählt und mit KANAP getestet haben. Für noch leistungsfähigere Antworten können Sie über Bring Your Own Key State-of-the-Art-Modelle von OpenAI, Anthropic oder jedem kompatiblen Anbieter anbinden. BYOK gibt Ihnen zudem die volle Kontrolle über die Datenverarbeitung, und entfernt jede Nachrichten-Grenze.',
        },
        {
          q: 'Wie kann ich Plaid steuern?',
          a: 'Auf Plattformebene kann Plaid vollständig deaktiviert, im Lesemodus oder im Lese-Schreib-Modus (mit Vorschau und Bestätigung für alle Änderungen) aktiviert werden. Websuche und MCP lassen sich separat aktivieren oder deaktivieren. Auf Benutzerebene steuern Sie über rollenbasierte Berechtigungen, wer welche Plaid-Funktion nutzt. RBAC wird immer durchgesetzt, Plaid sieht nie mehr, als der Nutzer sehen darf.',
        },
      ],
    },
    {
      label: 'Agenten (KI-Automatisierung)',
      items: [
        {
          q: 'Sind die Agenten autonom?',
          a: 'Ja, von Grund auf. Ein Agent startet beaufsichtigt: Er schlägt Aktionen vor, und Sie prüfen sie. Während KANAP misst, wie oft er richtig liegt, gewähren Sie ihm mehr Autonomie, bis er Routinearbeit selbstständig erledigt und nur das eskaliert, was einen Menschen braucht. Sie entscheiden, wie weit das geht.',
        },
        {
          q: 'Wie steuere ich, was ein Agent tun darf?',
          a: 'Sie legen die Autonomiestufe jedes Agenten fest und beschränken ihn auf die Operationen, die Sie erlauben. Agenten handeln nur über definierte Operationen, ohne direkten Datenbank- oder Shell-Zugriff. Jede Aktion wird protokolliert, Sie können jeden Agenten sofort pausieren, und Sie können begrenzen, was ein Agent für das LLM ausgibt.',
        },
        {
          q: 'Kann ich einem Agenten echte Arbeit anvertrauen?',
          a: 'Genau dafür sind die Kontrollen da. Ein Agent schließt anhand Ihrer eigenen IT-Daten, statt zu raten, nennt die genutzten Quellen und protokolliert jede Aktion im selben Audit-Trail wie der Rest von KANAP. Er gewinnt Autonomie, indem er sich an realen Aufgaben beweist, und Sie können ihn jederzeit stoppen.',
        },
        {
          q: 'Mit welchen Tools arbeiten Agenten heute?',
          a: 'Heute ein Service Desk. Ein autonomer Agent bearbeitet einen echten Service Desk in Produktion, und genau das beweist das Modell. Die Runtime ist darauf ausgelegt, andere Systeme zu steuern, Monitoring, Virtualisierung, Verzeichnisdienste und mehr, jeweils hinter einem Konnektor.',
        },
        {
          q: 'Kann ich meinen eigenen Agenten oder Konnektor schreiben?',
          a: 'Ja. Der Code ist offen, und die Schlussfolgerung eines Agenten ist getrennt von der Art, wie er mit einem bestimmten Tool spricht. Sie können einen Konnektor für das System schreiben, das Sie brauchen, oder die Arbeitsweise eines Agenten verändern, weil Sie den vollständigen Quellcode haben. Wenn Sie lieber möchten, dass wir einen Konnektor bauen, kontaktieren Sie uns.',
        },
        {
          q: 'Sind Agenten in der kostenlosen Open-Source-Version enthalten?',
          a: 'Ja. Agenten sind Teil des Open-Source-Produkts unter AGPL v3, ohne KI-Feature-Gate. Sie bringen Ihren eigenen LLM-Schlüssel mit, dasselbe Modell wie bei Plaid. Hosten Sie die komplette Plattform kostenlos selbst, Agenten inklusive.',
        },
        {
          q: 'Was kostet der Betrieb von Agenten?',
          a: 'Agenten nutzen ein LLM, also bringen Sie Ihren eigenen Schlüssel mit und zahlen Ihren Anbieter für das, was sie verbrauchen. KANAP selbst ist kostenlos selbst hostbar. Mit einem Ausgabenlimit pro Agent halten Sie die Kosten planbar.',
        },
        {
          q: 'Bleiben Agentenaktionen auf meinen eigenen Servern?',
          a: 'Bei einer selbstgehosteten Installation ja. Die Schlussfolgerungen und Aktionen der Agenten laufen in Ihrer eigenen Installation, und Ihre Tickets und Dokumente verlassen sie nie. Der einzige externe Aufruf geht an den LLM-Anbieter, den Sie wählen.',
        },
      ],
    },
  ],
  cta: {
    title: 'Noch Fragen?',
    body: 'Schreiben Sie uns, wir lesen jede Nachricht.',
    primary: 'Kontakt aufnehmen',
    secondary: 'Testversion starten',
  },
};

export default content;
