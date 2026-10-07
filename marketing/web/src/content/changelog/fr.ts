import type { ChangelogContent } from './types';

const content: ChangelogContent = {
  meta: {
    title: 'Changelog',
    description:
      'Changements notables de KANAP. Nouvelles fonctionnalités, améliorations et corrections au fil des livraisons. Les auto-hébergés suivent la même chronologie.',
  },
  header: {
    eyebrow: 'Changelog',
    title: 'Les nouveautés de KANAP.',
    lead:
      'Les temps forts de ce qui est livré entre chaque version. Pour le journal technique complet, suivez le dépôt GitHub.',
  },
  subscribe: {
    label: 'Restez informé',
    body: 'Les nouvelles versions sortent régulièrement. Étoilez le dépôt ou surveillez les releases sur GitHub pour rester à jour.',
    githubCta: 'Voir les releases sur GitHub',
    githubHref: 'https://github.com/kanap-hq/kanap/releases',
  },
  entries: [
    {
      date: '2026-06-26',
      title: "Personas d'agents et contexte partagé.",
      summary:
        "Les agents peuvent désormais recevoir un persona, leur mission, la façon dont ils doivent répondre et quand escalader, et ils s'appuient sur un contexte partagé à l'échelle du tenant pour que chaque agent travaille à partir du même fond de connaissances sur votre organisation.",
      sections: [
        {
          label: 'Livré',
          items: [
            "Persona par agent : mission, instructions, style de réponse et règles d'escalade",
            "Profils de contexte partagé à l'échelle du tenant, sur lesquels chaque agent peut s'appuyer",
            "Aperçu du prompt effectif, pour voir exactement ce qui est dit à un agent",
            'Une page dédiée à la gestion du contexte partagé',
          ],
        },
      ],
    },
    {
      date: '2026-06-24',
      title: 'Agents autonomes, en service sur un vrai centre de services.',
      summary:
        "Le runtime d'agents autonomes a livré sa première itération en production. Un agent traite désormais un vrai centre de services, lit chaque ticket au regard de vos données IT, rédige une réponse citant ses sources et agit selon l'autonomie que vous accordez.",
      sections: [
        {
          label: 'Livré',
          items: [
            "Runtime d'agents autonomes avec une autonomie mesurée, par agent",
            'Premier connecteur : un agent de centre de services en service, traitant de vrais tickets',
            "Réponses composées par l'IA, ancrées dans vos propres enregistrements, avec les sources citées",
            "Validation et revue tant qu'un agent gagne encore en autonomie, journal d'audit complet",
          ],
        },
      ],
    },
    {
      date: '2026-04-24',
      title: 'Nouveau site marketing.',
      summary:
        'Le site marketing a été entièrement repensé pour coller à la nouvelle esthétique de l\'app KANAP. L\'open source devient le fil conducteur, avec l\'auto-hébergement comme citoyen de première classe.',
      sections: [
        {
          label: 'Livré',
          items: [
            'Refonte visuelle complète, palette teal + neutres, dark mode obligatoire, densité façon Linear',
            'Page auto-hébergement / on-premise dédiée en exploration profonde',
            'Nouvelles pages changelog et sécurité',
            'Build statique Astro 5, URL propres, routage i18n correct',
            'Multilingue dès le départ : anglais, français, allemand, espagnol',
          ],
        },
      ],
    },
    {
      date: '2026-04-01',
      title: 'Refonte design de toute l\'app.',
      summary:
        'L\'application KANAP a été repensée autour d\'une charte « densité raffinée » : Inter 400/500 seulement, teal pour les éléments interactifs, neutre pour tout le reste, dark mode obligatoire sur chaque surface.',
      sections: [
        {
          label: 'Modifié',
          items: [
            'Design tokens unifiés sous `kanapPalette` avec modes clair + sombre',
            'Primitives PropertyRow / PropertyGroup remplacent tous les usages MUI FormControl',
            'Pages workspace (tâches, projets, demandes) suivent une mise en page de détail partagée',
            'Overrides AG Grid personnalisés protègent le texte des cellules du teal envahissant',
            'Auto-save sur toutes les éditions in-place ; validations explicites réservées aux créations et composers',
          ],
        },
      ],
    },
  ],
};

export default content;
