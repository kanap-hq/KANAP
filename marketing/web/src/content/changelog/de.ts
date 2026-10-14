import type { ChangelogContent } from './types';

const content: ChangelogContent = {
  meta: {
    title: 'Changelog',
    description:
      'Versionshinweise zu KANAP: was jede Version den Menschen bringt, die damit arbeiten. Die technische Liste der Änderungen steht auf GitHub.',
  },
  header: {
    eyebrow: 'Changelog',
    title: 'Was ist neu in KANAP.',
    lead:
      'KANAP veröffentlicht etwa einmal im Monat eine Version. Die Versionshinweise unten erklären, was jede Version Ihrem Team bringt. Zu jeder Version gibt es außerdem ein GitHub-Release mit der vollständigen Liste der Änderungen.',
  },
  empty: 'Die ersten Versionshinweise folgen in Kürze.',
  github: {
    label: 'Technische Details',
    body: 'Jede Version hat ein GitHub-Release mit allen Änderungen, den Update-Schritten für selbst gehostete Installationen und dem Komponenteninventar.',
    cta: 'Releases auf GitHub beobachten',
    href: 'https://github.com/kanap-hq/KANAP/releases',
  },
};

export default content;
