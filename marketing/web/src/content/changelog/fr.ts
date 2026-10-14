import type { ChangelogContent } from './types';

const content: ChangelogContent = {
  meta: {
    title: 'Changelog',
    description:
      "Les notes de version de KANAP : ce que chaque version apporte à ceux qui l'utilisent. La liste technique des changements est sur GitHub.",
  },
  header: {
    eyebrow: 'Changelog',
    title: 'Les nouveautés de KANAP.',
    lead:
      'KANAP publie une version environ une fois par mois. Les notes de version ci-dessous expliquent ce que chacune apporte à vos équipes. Chaque version a aussi sa release GitHub, avec la liste complète des changements.',
  },
  empty: 'Les premières notes de version arrivent bientôt.',
  github: {
    label: 'Détails techniques',
    body: "Chaque version a sa release sur GitHub : tous les changements, les étapes de mise à jour des installations auto-hébergées et l'inventaire des composants.",
    cta: 'Suivre les releases sur GitHub',
    href: 'https://github.com/kanap-hq/KANAP/releases',
  },
};

export default content;
