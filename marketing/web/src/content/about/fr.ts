import type { AboutContent } from './types';

const content: AboutContent = {
  meta: {
    title: 'À propos',
    description:
      "KANAP est un projet open source de gouvernance IT construit par Friedrich Eva, DSI de transition : pourquoi il existe, pourquoi il est open source, comment il est financé.",
  },
  header: {
    eyebrow: 'À propos',
    title: 'Construit par un DSI pour les DSI',
    lead:
      "KANAP est un projet open source né sur le terrain : celui des allers-retours budgétaires, des cartographies et documentations manquantes à la veille d'un audit, ou des arbitrages à faire entre les demandes du métier.",
  },
  founder: {
    name: 'Friedrich Eva',
    role: 'fondateur',
    jobTitle: 'DSI de transition, fondateur de KANAP',
    photoAlt: 'Friedrich Eva, fondateur de KANAP',
    paragraphs: [
      "Je suis DSI de transition. Mon métier : reprendre ou reconstruire une DSI, la placer au cœur d'un programme ERP, intégrer le système d'information d'une société rachetée, ou simplement assurer une transition productive et efficace. J'ai passé plus de vingt ans dans l'informatique, dont huit comme DSI de deux ETI internationales, dans la distribution puis dans l'industrie. Je suis certifié CISSP et ISO 27001 Lead Implementer, et je travaille en français, en anglais et en allemand.",
    ],
    linkedinLabel: 'Mon profil LinkedIn',
  },
  sections: [
    {
      title: 'Pourquoi KANAP',
      paragraphs: [
        "J'ai souvent retrouvé les mêmes irritants : le budget dans plusieurs fichiers Excel, un ou plusieurs débuts de cartographie applicative, rarement maintenus, les projets ailleurs, les contrats éparpillés aux achats, au juridique et à la DSI. Et avant chaque comité, des heures à tout réconcilier à la main.",
        "J'ai donc commencé KANAP pour réunir au même endroit les outils vitaux de la gouvernance d'une DSI. D'abord le budget, puis le portefeuille de projets, la cartographie des applications, les contrats, la documentation. Sont ensuite venus les besoins de reporting, et finalement, un agent IA intégré qui facilite la recherche et la synthèse des informations. Aujourd'hui, KANAP est une plateforme modulaire pour PME et ETI : on peut n'en utiliser qu'un module ou plusieurs, selon le contexte et les besoins.",
      ],
    },
    {
      title: 'Un labo qui passe en prod',
      paragraphs: [
        "KANAP est aussi mon laboratoire. J'y construis l'outil que j'aurais voulu trouver en arrivant dans chaque DSI, et j'y teste ce que l'IA change concrètement au quotidien. C'est vrai pour le développement de KANAP lui-même, qui s'accélère avec les progrès de l'IA, comme pour la gouvernance d'une DSI : des agents qui proposent et agissent sous contrôle humain, un serveur MCP pour interroger ses données depuis Claude ou ChatGPT. Chaque fonction proposée par KANAP part d'un besoin réel, rencontré sur le terrain.",
      ],
    },
    {
      title: 'Pourquoi open source',
      paragraphs: [
        "Un outil de gouvernance contient ce qu'une DSI a de plus sensible : ses coûts, ses contrats, ses fournisseurs, les fragilités de son système d'information. Vous devez pouvoir le lire, l'héberger chez vous et ne jamais en être prisonnier.",
        "KANAP est donc publié sous licence AGPL v3 : le code est public, vous pouvez l'installer sur vos propres serveurs, le modifier, et vos données restent les vôtres. Si vous confiez le run à KANAP, l'application est hébergée en Allemagne sur des serveurs dédiés, vos données sont exportables en CSV et il reste toujours possible de revenir sur vos propres serveurs.",
      ],
    },
    {
      title: 'Un projet indépendant',
      paragraphs: [
        "KANAP est édité par la société KANAP, une EURL créée à Obernai, en Alsace. Le projet est développé en fonds propres, en parallèle de mon activité de DSI. Il reste ainsi entièrement indépendant.",
        "Open source, le logiciel est entièrement gratuit. Les services payants sont optionnels et visent à vous faire gagner du temps, sécuriser l'utilisation ou adapter l'application : support, hébergement, accompagnement et développement spécifique. Cet accompagnement, je vous l'apporte avec mon regard de DSI. <a href=\"/fr/offer\">Voir l'offre</a>",
        "Dans tous les cas, l'<a href=\"https://doc.kanap.net/fr/\">aide en ligne</a> complète, en quatre langues, vous guide, des premiers pas jusqu'à l'expertise.",
      ],
    },
  ],
  cta: {
    title: 'Essayer KANAP',
    body: '14 jours, toutes les fonctionnalités, sans carte bancaire.',
    primary: 'Essayer KANAP 14 jours',
    secondary: 'Nous contacter',
  },
};

export default content;
