import type { AboutContent } from './types';

const content: AboutContent = {
  meta: {
    title: 'Über Kadratis',
    description:
      'Kadratis ist ein Open-Source-Projekt für IT-Governance, entwickelt von Friedrich Eva, Interim-CIO: warum es existiert, warum es Open Source ist, wie es finanziert wird.',
  },
  header: {
    eyebrow: 'Über Kadratis',
    title: 'Von einem CIO für CIOs gebaut',
    lead:
      'Kadratis ist ein Open-Source-Projekt aus der Praxis: aus dem Hin und Her der Budgetrunden, aus Anwendungslandkarten und Dokumentationen, die am Vorabend eines Audits fehlen, aus Abwägungen zwischen den Anforderungen der Fachbereiche.',
  },
  founder: {
    name: 'Friedrich Eva',
    role: 'Gründer',
    jobTitle: 'Interim-CIO, Gründer von Kadratis',
    photoAlt: 'Friedrich Eva, Gründer von Kadratis',
    paragraphs: [
      'Ich bin Interim-CIO. Mein Beruf: eine IT-Abteilung übernehmen oder neu aufbauen, sie ins Zentrum eines ERP-Programms stellen, die IT eines übernommenen Unternehmens integrieren oder einfach einen produktiven und wirksamen Übergang sicherstellen. Ich arbeite seit mehr als zwanzig Jahren in der IT, davon acht als CIO zweier international tätiger mittelständischer Unternehmen, zuerst im Handel, dann in der Industrie. Ich bin CISSP- und ISO-27001-Lead-Implementer-zertifiziert und arbeite auf Französisch, Englisch und Deutsch.',
    ],
    linkedinLabel: 'Mein LinkedIn-Profil',
  },
  sections: [
    {
      title: 'Warum Kadratis',
      paragraphs: [
        'Ich bin oft auf dieselben Ärgernisse gestoßen: das Budget in mehreren Excel-Dateien, ein oder zwei angefangene und selten gepflegte Anwendungslandkarten, die Projekte woanders, die Verträge verstreut zwischen Einkauf, Rechtsabteilung und IT. Und vor jeder Gremiensitzung stundenlanges Abgleichen von Hand.',
        'Deshalb habe ich Kadratis begonnen: um die zentralen Werkzeuge der IT-Governance an einem Ort zu bündeln. Zuerst das Budget, dann das Projektportfolio, die Anwendungslandkarte, die Verträge, die Dokumentation. Danach kam der Bedarf an Reporting und schließlich ein integrierter KI-Agent, der das Suchen und Zusammenfassen von Informationen erleichtert. Heute ist Kadratis eine modulare Plattform für kleine und mittlere Unternehmen: Man kann ein einzelnes Modul nutzen oder mehrere, je nach Kontext und Bedarf.',
      ],
    },
    {
      title: 'Ein Labor, das in Produktion geht',
      paragraphs: [
        'Kadratis ist auch mein Labor. Ich baue dort das Werkzeug, das ich mir bei jedem Antritt in einer IT-Abteilung gewünscht hätte, und teste, was KI im Alltag konkret verändert. Das gilt für die Entwicklung von Kadratis selbst, die mit den Fortschritten der KI schneller wird, ebenso wie für die IT-Governance: Agenten, die unter menschlicher Kontrolle Vorschläge machen und handeln, ein MCP-Server, um die eigenen Daten aus Claude oder ChatGPT abzufragen. Jede Funktion von Kadratis geht auf einen realen Bedarf aus der Praxis zurück.',
      ],
    },
    {
      title: 'Warum Open Source',
      paragraphs: [
        'Ein Governance-Werkzeug enthält das Sensibelste einer IT-Abteilung: ihre Kosten, ihre Verträge, ihre Lieferanten, die Schwachstellen ihrer Informationssysteme. Sie müssen es lesen, selbst betreiben und dürfen nie darin gefangen sein.',
        'Deshalb steht Kadratis unter der Lizenz AGPL v3: Der Code ist öffentlich, Sie können ihn auf Ihren eigenen Servern installieren und anpassen, und Ihre Daten bleiben Ihre Daten. Wenn Sie den Betrieb Kadratis anvertrauen, läuft die Anwendung in Deutschland auf dedizierten Servern, Ihre Daten lassen sich als CSV exportieren, und der Wechsel zurück auf Ihre eigenen Server bleibt jederzeit möglich.',
      ],
    },
    {
      title: 'Ein unabhängiges Projekt',
      paragraphs: [
        'Kadratis wird von der Gesellschaft KANAP herausgegeben, einer französischen Gesellschaft mit beschränkter Haftung (SARL) mit Sitz in Obernai im Elsass. Das Projekt wird aus eigenen Mitteln entwickelt, parallel zu meiner Tätigkeit als CIO. So bleibt es vollständig unabhängig.',
        'Als Open-Source-Software ist Kadratis vollständig kostenlos. Die kostenpflichtigen Leistungen sind optional und sollen Ihnen Zeit sparen, den Einsatz absichern oder die Anwendung anpassen: Support, Hosting, Begleitung und individuelle Entwicklung. Diese Begleitung biete ich Ihnen selbst, mit dem Blick eines CIO. <a href="/de/offer">Zum Angebot</a>',
        'In jedem Fall führt Sie die vollständige <a href="https://doc.kadratis.com/de/">Online-Hilfe</a> in vier Sprachen von den ersten Schritten bis zur Expertise.',
      ],
    },
  ],
  cta: {
    title: 'Kadratis testen',
    body: '14 Tage, alle Funktionen, ohne Kreditkarte.',
    primary: 'Kadratis 14 Tage testen',
    secondary: 'Kontakt aufnehmen',
  },
};

export default content;
