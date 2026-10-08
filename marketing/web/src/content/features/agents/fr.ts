import type { AgentsContent } from '../types';

const content: AgentsContent = {
  meta: {
    title: "Des agents IA autonomes pour l'IT",
    description:
      "Les agents KANAP prennent en charge les tâches IT répétitives, raisonnent sur vos propres données IT et agissent selon une autonomie que vous contrôlez et pouvez auditer. Un connecteur de centre de services en service aujourd'hui, le runtime conçu pour être étendu. Open source, auto-hébergé.",
  },
  header: {
    eyebrow: "Des agents autonomes pour l'IT",
    title: 'Des agents IA qui déchargent votre équipe.',
    lead: "Un agent KANAP prend une tâche en charge, la lit au regard de vos données IT et, soit propose une action, soit l'exécute, selon le niveau d'autonomie que vous lui avez accordé. Il traite la charge répétitive pour que vos équipes traitent les problèmes difficiles.",
  },
  sections: [
    {
      title: 'Les agents démarrent supervisés et gagnent en autonomie.',
      body: "Chaque agent débute sous supervision. Il propose des actions, vous les passez en revue, et KANAP suit la fréquence à laquelle il voit juste. À mesure que ce bilan tient, vous lui accordez plus d'autonomie, jusqu'à ce qu'il traite le travail courant seul et ne vous remonte que les cas qui exigent une personne.",
      bullets: [
        'Commence par proposer des actions pour votre revue',
        'KANAP mesure la fréquence à laquelle il voit juste',
        "Vous accordez plus d'autonomie à mesure que le bilan tient",
        "S'installe dans le traitement autonome du travail courant",
      ],
      shotAlt: "Le réglage d'autonomie d'un agent",
    },
    {
      title: 'Il raisonne sur votre environnement réel.',
      body: "Un agent ne travaille pas à partir du seul ticket. Il lit l'application qu'un problème affecte, qui en est responsable, son degré de criticité et la documentation que vous avez rédigée à son sujet. Puis il liste les enregistrements et documents qu'il a utilisés, pour que vous puissiez vérifier son raisonnement.",
      bullets: [
        "Lit l'application affectée, son responsable et sa criticité",
        'Rassemble le projet, le coût et la documentation associés',
        'Répond à partir de vos données, pas de suppositions',
        "Liste les sources dont il s'est servi",
      ],
      shotAlt: "Une proposition d'agent montrant la classification, l'action rédigée et les sources utilisées",
    },
    {
      title: "Un seul runtime, n'importe quel outil.",
      body: "La décision que prend un agent est tenue séparée de la façon dont il dialogue avec un outil donné. Un connecteur de centre de services arrive en premier, traitant de vrais tickets en production. Le même runtime est conçu pour piloter d'autres systèmes et, le code étant ouvert, vous pouvez écrire un connecteur pour l'outil dont vous avez besoin.",
      bullets: [
        'Le raisonnement est tenu séparé du connecteur',
        "Un connecteur de centre de services tourne en production aujourd'hui",
        'Conçu pour piloter supervision, annuaires et plus encore',
        'Écrivez votre propre connecteur, le code est ouvert',
      ],
      shotAlt: "Les réglages de l'agent : persona et ciblage",
    },
    {
      title: "Une trace de tout ce qu'il a fait.",
      body: "Chaque action d'agent est enregistrée, limitée à ce que vous avez autorisé, étayée par les sources utilisées et interruptible à tout moment. C'est cette trace qui rend défendable le fait de confier un vrai travail à un agent. L'historique est conservé 30 jours par défaut, et vous pouvez le régler de 7 à 90 jours.",
      bullets: [
        "Chaque action enregistrée dans l'historique d'activité de l'agent",
        'Limitée aux opérations que vous autorisez',
        'Chaque réponse étayée par ses sources',
        "Mettez n'importe quel agent en pause immédiatement",
      ],
      shotAlt: "L'activité de l'agent et le journal d'audit",
    },
    {
      title: "À vous de l'exécuter et de le modifier.",
      body: "Les agents font partie du produit open source. Exécutez-les au sein de votre propre déploiement, là où vos tickets et documents restent, hors du texte envoyé au fournisseur LLM que vous choisissez, et modifiez leur fonctionnement puisque vous disposez de tout le code source. Apportez votre propre clé LLM, comme avec Plaid.",
      bullets: [
        'Inclus dans le produit open source',
        "S'exécute au sein de votre propre déploiement",
        'Tickets et documents restent chez vous, hors ce qui part au LLM',
        'Apportez votre propre clé LLM',
      ],
      shotAlt: 'Un agent traitant une file de tâches',
    },
  ],
  more: {
    title: 'Plus de contrôle là où vous en avez besoin',
    items: [
      {
        title: 'Plafonds de dépense',
        body: "Fixez une limite par agent sur ce qu'il peut dépenser pour le LLM, afin que le coût de fonctionnement reste prévisible.",
      },
      {
        title: "Pause d'urgence",
        body: "Arrêtez n'importe quel agent immédiatement, un par un ou tous à la fois, dès que vous voulez intervenir.",
      },
      {
        title: "Contrôle d'accès par rôle",
        body: "Décidez qui peut configurer les agents, accorder de l'autonomie ou passer en revue ce qu'un agent a fait.",
      },
      {
        title: 'Indicateurs de performance',
        body: "Visualisez la fréquence à laquelle un agent voit juste, et le volume de travail qu'il a retiré à votre équipe.",
      },
    ],
  },
  transparency: {
    eyebrow: "En service aujourd'hui",
    title: 'Un agent en production, un runtime conçu pour être étendu.',
    body: "En service aujourd'hui : un agent autonome qui traite un vrai centre de services en production. Le runtime est conçu pour être étendu. Choisissez un outil, écrivez un connecteur, et le même agent le traite. Si vous avez besoin qu'on en construise un, dites-le-nous.",
    ctaLabel: 'Demander un connecteur',
    ctaHref: '/contact',
  },
  crossLinks: {
    label: "Voyez comment tout s'articule",
    links: [
      { label: 'Paysage IT', href: '/features/it-landscape' },
      { label: 'Connaissance', href: '/features/knowledge' },
      { label: 'Auto-hébergement', href: '/on-premise' },
      { label: 'Sécurité', href: '/security' },
      { label: 'Plaid, Assistant IA', href: '/features/ai' },
    ],
  },
  cta: {
    title: 'Mettez un agent sur le travail répétitif.',
    body: "Les agents sont dans le produit gratuit et auto-hébergé, avec votre propre clé LLM. Déployez KANAP vous-même, ou parlez-nous d'hébergement et de connecteurs.",
    primary: 'Déployer gratuitement',
    secondary: 'Nous contacter',
  },
};

export default content;
