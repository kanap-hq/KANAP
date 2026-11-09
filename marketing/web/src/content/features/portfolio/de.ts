import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Portfolio-Management',
    description:
      'Anfrage-Scoring, automatische Roadmap-Erstellung, kapazitätsbewusste Planung, Projekt-Lifecycle-Tracking. Open Source. Self-Hosting kostenlos oder Kadratis Cloud.',
  },
  header: {
    eyebrow: 'Portfolio-Management',
    title: 'Von der Anfrage bis zur Lieferung, mit automatischer Roadmap-Planung.',
    lead: 'Steuern Sie Ihren Projekt-Funnel mit intelligentem Scoring, kapazitätsbewusster Roadmap-Erstellung und Lifecycle-Tracking. Simulieren Sie Szenarien, bevor Sie Termine zusagen.',
  },
  sections: [
    {
      title: 'Anfrage-Scoring & Bewertung',
      body: 'Bewerten Sie eingehende Anfragen mit konfigurierbaren Scoring-Kriterien. Gewichten Sie Geschäftswert, ROI, Risiko und Dringlichkeit, um eine Prioritätsbewertung zu berechnen. Unterstützung für Mandatory-Bypass-Regeln und manuelles Override mit Begründung.',
      bullets: [
        'Konfigurierbare Scoring-Kriterien mit individuellen Gewichten',
        'Standard-Kriterien: Wert, Ausrichtung, Kosten, ROI, Risiko, Dringlichkeit',
        'Umgekehrte Skalen für Kosten/Risiko (höher = niedrigerer Score)',
        'Mandatory-Bypass-Regeln für kritische Anfragen',
        'Manuelles Override mit Pflichtbegründung',
      ],
      shotAlt: 'Anfrage-Scoring-Editor mit gewichteten Kriterien',
    },
    {
      title: 'Anfrage-Lebenszyklus',
      body: 'Verfolgen Sie Anfragen von der Einreichung über die Freigabe bis zur Umwandlung in Projekte. Eingebaute Workflow-Status, Aktivitätshistorie und CAB-Entscheidungen halten alle auf dem gleichen Stand.',
      bullets: [
        'Statusfluss: In Prüfung, Kandidat, Freigegeben, Umgewandelt',
        'Alternative Pfade: Pausiert, Abgelehnt',
        'Aktivitätshistorie mit Kommentaren und Statuswechseln',
        'CAB-Entscheidung mit formaler Freigabeerfassung',
        'Ein-Klick-Umwandlung einer freigegebenen Anfrage in ein Projekt',
      ],
      shotAlt: 'Anfrage mit ihrer Aktivitäts-Timeline',
    },
    {
      title: 'Projekt-Lifecycle-Tracking',
      body: 'Steuern Sie Projekte von der Planung über die Durchführung bis zum Abschluss. Geplante vs. tatsächliche Termine, Baselines und Aufwand im Blick. Unterstützung für Standardprojekte, Fast-Track-Mandate und Legacy-Arbeit.',
      bullets: [
        'Statusfluss: Warteliste, Geplant, In Arbeit, Im Test, Erledigt',
        'Baseline-Erfassung beim Eintritt in die Durchführung',
        'Geplante vs. tatsächliche Termine für die Abweichungsanalyse',
        'Aufwandserfassung: IT- und Fachbereichs-Aufwand geschätzt vs. tatsächlich',
        'Ursprung: Standard, Fast-Track, Legacy',
      ],
      shotAlt: 'Projekt mit Baseline- und Ist-Terminen',
    },
    {
      title: 'Automatische Roadmap-Planung',
      body: 'Erzeugen Sie Lieferszenarien aus Restaufwand, Abhängigkeiten und Mitarbeiterkapazität. Sehen Sie Engpässe und Auslastung, bevor Sie Termine in laufende Projekte übernehmen. Diese Scoring- und Roadmap-Daten gehören zu dem, woraus ein Agent schließt, wenn er zugehörige Arbeit übernimmt.',
      bullets: [
        'Wochenweise, kapazitätsbewusste Planung aus echten Aufwandszuweisungen',
        'Standard-Scope: Warteliste, Geplant, In Arbeit, Im Test',
        'Optionale Neuberechnung eingeplanter Projekte oder Simulation mit eingefrorenem Plan',
        'Engpass-Sensitivitätsanalyse nach Contributor-Impact',
        'Monatliche Auslastungsansichten nach Contributor und Team',
        'Selektive, transaktionale Übernahme der generierten Plantermine',
      ],
      shotAlt: 'Generierte Roadmap mit Kapazitäts-Heatmap',
    },
  ],
  more: {
    title: 'Mehr in Portfolio',
    items: [
      { title: 'Team-Management', body: 'Fachliche und IT-Sponsoren, Leads und Mitglieder zuordnen. Externe Kontakte im Blick.' },
      { title: 'Budget-Verknüpfung', body: 'Projekte an OPEX- und CAPEX-Posten koppeln. Die tatsächlichen Portfolio-Kosten verstehen.' },
      { title: 'Abhängigkeiten', body: 'Abhängigkeiten zwischen Anfragen und Projekten tracken. Blockierende Links fließen in die Roadmap-Sequenzierung.' },
      { title: 'Portfolio-Berichte', body: 'Kapazitäts-Heatmaps, Engpassanalyse, Auslastungsanalytik.' },
    ],
  },
  crossLinks: {
    label: 'Andere Module entdecken',
    links: [
      { label: 'Agenten', href: '/features/agents' },
      { label: 'Kad, KI-Assistent', href: '/features/ai' },
      { label: 'Budget-Management', href: '/features/budget' },
      { label: 'IT-Landschaft', href: '/features/it-landscape' },
      { label: 'Wissen', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: 'Bereit, Ihren Projekt-Funnel in den Griff zu bekommen?',
    body: 'Hosten Sie kostenlos selbst oder testen Sie Kadratis Cloud. Alle Funktionen in jedem Plan.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Kadratis Cloud testen',
  },
};

export default content;
