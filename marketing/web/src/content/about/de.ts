import type { AboutContent } from './types';

const content: AboutContent = {
  meta: {
    title: 'Über KANAP',
    description:
      'KANAP ist ein Open-Source-Projekt für IT-Governance, entwickelt von Friedrich Eva, Interim-CIO: warum es existiert, warum es Open Source ist, wie es finanziert wird.',
  },
  header: {
    eyebrow: 'Über KANAP',
    title: 'Von einem CIO für CIOs gebaut',
    lead:
      'KANAP ist ein Open-Source-Projekt aus der Praxis: aus dem Hin und Her der Budgetrunden, aus Anwendungslandkarten und Dokumentationen, die am Vorabend eines Audits fehlen, aus Abwägungen zwischen den Anforderungen der Fachbereiche.',
  },
  founder: {
    name: 'Friedrich Eva',
    role: 'Gründer',
    jobTitle: 'Interim-CIO, Gründer von KANAP',
    photoAlt: 'Friedrich Eva, Gründer von KANAP',
    paragraphs: [
      'Ich bin Interim-CIO. Mein Beruf: eine IT-Abteilung übernehmen oder neu aufbauen, sie ins Zentrum eines ERP-Programms stellen, die IT eines übernommenen Unternehmens integrieren oder einfach einen produktiven und wirksamen Übergang sicherstellen. Ich arbeite seit mehr als zwanzig Jahren in der IT, davon acht als CIO zweier international tätiger mittelständischer Unternehmen, zuerst im Handel, dann in der Industrie. Ich bin CISSP- und ISO-27001-Lead-Implementer-zertifiziert und arbeite auf Französisch, Englisch und Deutsch.',
      'In jeder dieser Positionen bin ich auf dieselben Ärgernisse gestoßen: das Budget in mehreren Excel-Dateien, ein oder zwei angefangene und selten gepflegte Anwendungslandkarten, die Projekte woanders, die Verträge verstreut zwischen Einkauf, Rechtsabteilung und IT. Und vor jeder Gremiensitzung stundenlanges Abgleichen von Hand.',
    ],
    linkedinLabel: 'Mein LinkedIn-Profil',
  },
  sections: [
    {
      title: 'Warum KANAP',
      paragraphs: [
        'Deshalb habe ich KANAP begonnen: um die zentralen Werkzeuge der IT-Governance an einem Ort zu bündeln. Zuerst das Budget, dann das Projektportfolio, die Anwendungslandkarte, die Verträge, die Dokumentation. Danach kam der Bedarf an Reporting und schließlich ein integrierter KI-Agent, der das Suchen und Zusammenfassen von Informationen erleichtert. Heute ist KANAP eine modulare Plattform für kleine und mittlere Unternehmen: Man kann ein einzelnes Modul nutzen oder mehrere, je nach Kontext und Bedarf.',
      ],
    },
    {
      title: 'Ein Labor, das in Produktion geht',
      paragraphs: [
        'KANAP ist auch mein Labor. Ich baue dort das Werkzeug, das ich mir bei jedem Antritt in einer IT-Abteilung gewünscht hätte, und teste, was KI im Alltag konkret verändert. Das gilt für die Entwicklung von KANAP selbst, die mit den Fortschritten der KI schneller wird, ebenso wie für die IT-Governance: Agenten, die unter menschlicher Kontrolle Vorschläge machen und handeln, ein MCP-Server, um die eigenen Daten aus Claude oder ChatGPT abzufragen. Jede Funktion von KANAP geht auf einen realen Bedarf aus der Praxis zurück.',
      ],
    },
    {
      title: 'Warum Open Source',
      paragraphs: [
        'Ein Governance-Werkzeug enthält das Sensibelste einer IT-Abteilung: ihre Kosten, ihre Verträge, ihre Lieferanten, die Schwachstellen ihrer Informationssysteme. Sie müssen es lesen, selbst betreiben und dürfen nie darin gefangen sein.',
        'Deshalb steht KANAP unter der Lizenz AGPL v3: Der Code ist öffentlich, Sie können ihn auf Ihren eigenen Servern installieren und anpassen, und Ihre Daten bleiben Ihre Daten. Wenn Sie den Betrieb KANAP anvertrauen, läuft die Anwendung in Deutschland auf dedizierten Servern, Ihre Daten lassen sich als CSV exportieren, und der Wechsel zurück auf Ihre eigenen Server bleibt jederzeit möglich.',
      ],
    },
    {
      title: 'Ein unabhängiges Projekt',
      paragraphs: [
        'KANAP wird von der Gesellschaft KANAP herausgegeben, einer französischen Einpersonengesellschaft (EURL) mit Sitz in Obernai im Elsass. Das Projekt wird vollständig aus meiner Tätigkeit als Interim-CIO finanziert. Das macht es unabhängig, frei von äußerem Druck und Einfluss.',
        'Als Open-Source-Software ist KANAP vollständig kostenlos. Die kostenpflichtigen Leistungen sind optional und sollen Ihnen Zeit sparen, den Einsatz absichern oder die Anwendung anpassen: Support, Hosting, Begleitung und individuelle Entwicklung. Diese Begleitung übernehme ich selbst, mit dem Blick eines CIO. <a href="/de/offer">Zum Angebot</a>',
        'In jedem Fall führt Sie die vollständige <a href="https://doc.kanap.net/de/">Online-Hilfe</a> in vier Sprachen von den ersten Schritten bis zur Expertise.',
      ],
    },
  ],
  cta: {
    title: 'KANAP testen',
    body: '14 Tage, alle Funktionen, ohne Kreditkarte.',
    primary: 'KANAP 14 Tage testen',
    secondary: 'Kontakt aufnehmen',
  },
};

export default content;
