import type { AgentsContent } from '../types';

const content: AgentsContent = {
  meta: {
    title: 'Autonome KI-Agenten für die IT',
    description:
      'KANAP-Agenten übernehmen wiederkehrende IT-Aufgaben, schließen anhand Ihrer eigenen IT-Daten und handeln unter einer Autonomie, die Sie kontrollieren und prüfen können. Ein Service-Desk-Konnektor ist heute live, die Runtime ist auf Erweiterung ausgelegt. Open Source, selbstgehostet.',
  },
  header: {
    eyebrow: 'Autonome Agenten für die IT',
    title: 'KI-Agenten, die Ihr Team entlasten.',
    lead: 'Ein KANAP-Agent übernimmt eine Aufgabe, liest sie gegen Ihre IT-Daten und schlägt entweder eine Aktion vor oder führt sie aus, je nachdem, wie viel Autonomie Sie ihm gegeben haben. Er bearbeitet die wiederkehrende Last, damit Ihre Leute die schwierigen Probleme bearbeiten.',
  },
  sections: [
    {
      title: 'Agenten starten beaufsichtigt und werden autonomer.',
      body: 'Jeder Agent beginnt unter Aufsicht. Er schlägt Aktionen vor, Sie prüfen sie, und KANAP verfolgt, wie oft er richtig liegt. Solange diese Bilanz hält, gewähren Sie ihm mehr Autonomie, bis er Routinearbeit selbstständig erledigt und Ihnen nur die Fälle bringt, die einen Menschen brauchen.',
      bullets: [
        'Beginnt damit, Aktionen zur Prüfung vorzuschlagen',
        'KANAP misst, wie oft er richtig liegt',
        'Sie gewähren mehr Autonomie, solange die Bilanz hält',
        'Übernimmt mit der Zeit die Routinearbeit selbstständig',
      ],
      shotAlt: 'Die Autonomie-Einstellung für einen Agenten',
    },
    {
      title: 'Er schließt anhand Ihrer realen Umgebung.',
      body: 'Ein Agent arbeitet nicht allein aus dem Ticket. Er liest die Anwendung, die ein Problem betrifft, wer sie verantwortet, wie kritisch sie ist, und die Dokumentation, die Sie dazu geschrieben haben. Dann listet er die Datensätze und Dokumente auf, die er genutzt hat, damit Sie seine Schlussfolgerung prüfen können.',
      bullets: [
        'Liest die betroffene Anwendung, ihren Eigentümer und ihre Kritikalität',
        'Zieht das zugehörige Projekt, die Kosten und die Dokumentation hinzu',
        'Antwortet aus Ihren Daten, nicht aus Vermutungen',
        'Listet die Quellen auf, aus denen er geschöpft hat',
      ],
      shotAlt: 'Ein Agentenvorschlag mit der Klassifizierung, der entworfenen Aktion und den genutzten Quellen',
    },
    {
      title: 'Eine Runtime, jedes Tool.',
      body: 'Die Entscheidung eines Agenten ist getrennt von der Art, wie er mit einem bestimmten Tool spricht. Ein Service-Desk-Konnektor erscheint zuerst und bearbeitet echte Tickets in Produktion. Dieselbe Runtime ist darauf ausgelegt, andere Systeme zu steuern, und weil der Code offen ist, können Sie einen Konnektor für das Tool schreiben, das Sie brauchen.',
      bullets: [
        'Die Schlussfolgerung bleibt vom Konnektor getrennt',
        'Ein Service-Desk-Konnektor läuft heute in Produktion',
        'Gebaut, um Monitoring, Verzeichnisdienste und mehr zu steuern',
        'Schreiben Sie Ihren eigenen Konnektor, der Code ist offen',
      ],
      shotAlt: 'Die Agenten-Einstellungen für Persona und Zielausrichtung',
    },
    {
      title: 'Ein Protokoll von allem, was er getan hat.',
      body: 'Jede Agentenaktion wird protokolliert, auf das beschränkt, was Sie erlaubt haben, durch die genutzten Quellen belegt und jederzeit stoppbar. Dieses Protokoll macht es vertretbar, einem Agenten echte Arbeit zu übergeben. Der Verlauf wird standardmäßig 30 Tage aufbewahrt und lässt sich von 7 bis 90 Tagen einstellen.',
      bullets: [
        'Jede Aktion im Aktivitätsverlauf des Agenten protokolliert',
        'Auf die Operationen beschränkt, die Sie erlauben',
        'Jede Antwort durch ihre Quellen belegt',
        'Jeden Agenten sofort pausieren',
      ],
      shotAlt: 'Die Agentenaktivität und das Audit-Protokoll',
    },
    {
      title: 'Ihres zum Betreiben und Anpassen.',
      body: 'Agenten sind Teil des Open-Source-Produkts. Betreiben Sie sie in Ihrer eigenen Installation, wo Ihre Tickets und Dokumente bleiben, abgesehen vom Text, der an den von Ihnen gewählten LLM-Anbieter geht, und verändern Sie ihre Arbeitsweise, weil Sie den vollständigen Quellcode haben. Ihr eigener LLM-Schlüssel, genau wie bei Plaid.',
      bullets: [
        'Im Open-Source-Produkt enthalten',
        'Läuft in Ihrer eigenen Installation',
        'Tickets und Dokumente bleiben bei Ihnen, außer dem, was an das LLM geht',
        'Ihr eigener LLM-Schlüssel',
      ],
      shotAlt: 'Ein Agent, der eine Aufgaben-Queue bearbeitet',
    },
  ],
  more: {
    title: 'Mehr Kontrolle, wo Sie sie brauchen',
    items: [
      {
        title: 'Ausgabenlimits',
        body: 'Setzen Sie pro Agent ein Limit für die LLM-Ausgaben, damit die Betriebskosten planbar bleiben.',
      },
      {
        title: 'Not-Pause',
        body: 'Stoppen Sie jeden Agenten sofort, einzeln oder alle zusammen, wann immer Sie eingreifen möchten.',
      },
      {
        title: 'Rollenbasierte Zugriffskontrolle',
        body: 'Legen Sie fest, wer Agenten konfigurieren, Autonomie gewähren oder prüfen darf, was ein Agent getan hat.',
      },
      {
        title: 'Performance-Kennzahlen',
        body: 'Sehen Sie, wie oft ein Agent richtig liegt und wie viel Arbeit er Ihrem Team abgenommen hat.',
      },
    ],
  },
  transparency: {
    eyebrow: 'Heute im Einsatz',
    title: 'Ein Agent in Produktion, eine Runtime, die auf Erweiterung ausgelegt ist.',
    body: 'Heute im Einsatz: ein autonomer Agent, der einen echten Service Desk in Produktion bearbeitet. Die Runtime ist auf Erweiterung ausgelegt. Wählen Sie ein Tool, schreiben Sie einen Konnektor, und derselbe Agent bearbeitet es. Wenn Sie einen brauchen, sagen Sie uns Bescheid.',
    ctaLabel: 'Konnektor anfragen',
    ctaHref: '/contact',
  },
  crossLinks: {
    label: 'So passt alles zusammen',
    links: [
      { label: 'IT-Landschaft', href: '/features/it-landscape' },
      { label: 'Wissen', href: '/features/knowledge' },
      { label: 'Self-Hosting', href: '/on-premise' },
      { label: 'Sicherheit', href: '/security' },
      { label: 'Plaid, KI-Assistent', href: '/features/ai' },
    ],
  },
  cta: {
    title: 'Setzen Sie einen Agenten auf die wiederkehrende Arbeit an.',
    body: 'Agenten sind im kostenlosen, selbstgehosteten Produkt enthalten, mit Ihrem eigenen LLM-Schlüssel. Stellen Sie KANAP selbst bereit oder sprechen Sie mit uns über Hosting und Konnektoren.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Sprechen Sie mit uns',
  },
};

export default content;
