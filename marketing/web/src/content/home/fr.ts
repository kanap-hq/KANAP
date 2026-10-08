import type { HomeContent } from './types';

const content: HomeContent = {
  meta: {
    title: 'Des agents IA open source pour votre DSI',
    description:
      "Des agents IA ancrés dans l'image complète de votre IT : applications, infrastructure, budgets, projets et documentation. Open source sous AGPL v3. Auto-hébergement gratuit, ou choisissez KANAP hébergé.",
  },

  hero: {
    eyebrow: 'Open source · auto-hébergée · conçue pour être étendue',
    title: 'Des agents IA qui prennent en charge votre travail répétitif.',
    lead: "KANAP détient l'image complète de votre DSI, des applications et serveurs jusqu'aux budgets et projets. Plaid permet à chacun d'y travailler en langage naturel, et des agents agissent désormais sur ce référentiel pour décharger votre équipe du travail répétitif.\nAuto-hébergez-la gratuitement, ou laissez-nous l'opérer pour vous.",
    primaryCta: 'Déployer gratuitement',
    secondaryCta: 'Essayer le cloud hébergé',
    trialNote: 'AGPL v3 · code source complet sur GitHub · installation Docker · aucun paywall fonctionnel.',
  },

  pillars: {
    eyebrow: 'Pourquoi KANAP',
    title: 'Ce qui distingue KANAP.',
    items: [
      {
        title: 'Toute la DSI dans un seul système.',
        body: "Applications, infrastructure, budgets, projets et documentation vivent dans un seul référentiel au lieu de dix outils déconnectés.",
      },
      {
        title: 'Des agents qui déchargent votre équipe.',
        body: "Des agents autonomes absorbent la charge répétitive et gagnent en indépendance à mesure qu'ils font leurs preuves sur des tâches réelles.",
      },
      {
        title: "Open source, auto-hébergée, à vous de l'étendre.",
        body: "Code source complet sous AGPL v3. Faites-la tourner sur vos propres serveurs, conservez chaque fonctionnalité et écrivez vos propres agents et connecteurs.",
      },
    ],
  },

  layers: {
    eyebrow: "Comment tout s'articule",
    title: 'Une plateforme complète pour la DSI.',
    intro:
      "KANAP est construite en trois couches qui travaillent sur la même information, de sorte que chacune rend les autres plus utiles.",
    items: [
      {
        title: 'Le référentiel',
        body: "KANAP détient l'image complète de votre DSI : applications et infrastructure, budgets, projets et documentation. Un seul endroit au lieu de dix outils.",
      },
      {
        title: "L'interaction",
        body: "Plaid permet à chacun dans votre équipe de travailler avec le référentiel en langage naturel, de poser des questions et d'effectuer des changements sans avoir à apprendre où se trouve chaque chose.",
      },
      {
        title: "L'action",
        body: "Les agents agissent sur le même référentiel, prennent en charge le travail répétitif et l'exécutent selon l'autonomie que vous leur accordez.",
      },
    ],
    outro: "Chaque partie est utile en elle-même, et l'ensemble se renforce mutuellement.",
  },

  modules: {
    eyebrow: 'Boîte à outils IT complète',
    title: 'Pensée pour chaque rôle IT.',
    intro:
      "KANAP couvre le territoire essentiel dont toute DSI a besoin pour fonctionner, de la première ligne de budget à la dernière application retirée, avec Plaid pour tout parcourir en langage naturel et des agents qui prennent en charge la charge répétitive. Chaque module est pleinement utilisable seul, vous pouvez donc commencer là où ça fait le plus mal et ajouter le reste quand vous serez prêt.",
    items: [
      {
        slug: '/features/budget',
        title: 'Gestion du budget',
        blurb:
          'Pour les DSI et leurs partenaires finance. Planification pluriannuelle, allocations intelligentes, refacturation prête pour la direction. Défendez le budget IT avec des chiffres que votre directeur financier validera.',
        bullets: [
          'Planification budgétaire pluriannuelle',
          "Six méthodes d'allocation",
          'Multi-devises avec taux Banque mondiale',
          'Rapports de refacturation exécutifs',
        ],
        ctaLabel: 'En savoir plus',
      },
      {
        slug: '/features/it-landscape',
        title: 'Paysage IT',
        blurb:
          "Pour les architectes, responsables d'application et équipes infrastructure. Documentez applications, interfaces et serveurs. Visualisez le SI d'un coup d'œil, planifiez les changements avec leurs dépendances sous les yeux.",
        bullets: [
          'Portefeuille applicatif avec instances par environnement',
          'Documentation des interfaces avec middleware 3 segments',
          'Registre des serveurs et infrastructures',
          "Cartes d'interfaces et de connexions interactives",
        ],
        ctaLabel: 'En savoir plus',
      },
      {
        slug: '/features/portfolio',
        title: 'Gestion de portefeuille',
        blurb:
          'Pour les chefs de projet et les leads IT. Scorez la demande, simulez des feuilles de route qui tiennent compte de la capacité, engagez des dates sans croiser les doigts.',
        bullets: [
          'Scoring des demandes avec critères pondérés',
          'Planification automatique de la feuille de route',
          "Analyse des goulots et de l'occupation",
          'Suivi du cycle de vie projet',
        ],
        ctaLabel: 'En savoir plus',
      },
      {
        slug: '/features/knowledge',
        title: 'Connaissance',
        blurb:
          "Pour tout le monde, et particulièrement le support et les opérations. Éditeur markdown, bibliothèques, flux de revue. Runbooks, décisions et notes d'architecture connectés aux applications et projets qu'ils décrivent.",
        bullets: [
          'Éditeur markdown avec flux de revue',
          'Bibliothèques, dossiers, types de documents',
          'Historique des versions et export PDF, DOCX, ODT',
          'Liens directs vers applications, projets, actifs, tâches',
        ],
        ctaLabel: 'En savoir plus',
      },
      {
        slug: '/features/ai',
        title: 'Plaid, Assistant IA',
        blurb:
          "Pour chaque rôle, pas seulement les passionnés d'IA. Posez vos questions en langage naturel ; obtenez des réponses structurées sur tous les modules. Le chemin le plus court entre une question IT et la donnée qui y répond.",
        bullets: [
          'Requêtes en langage naturel sur tous les modules',
          'Actions sur documents et tâches avec aperçu',
          'Serveur MCP pour Claude, Cursor, Windsurf…',
          'Utilisation incluse sur le cloud hébergé, ou clé perso',
        ],
        ctaLabel: 'En savoir plus',
      },
      {
        slug: '/features/agents',
        title: 'Agents',
        blurb:
          "Pour les équipes submergées par les tickets répétitifs. Un agent lit chaque tâche au regard de vos données IT et, soit propose une action, soit l'exécute, selon l'autonomie que vous définissez. Un connecteur de centre de services tourne en production aujourd'hui, et le runtime est conçu pour être étendu.",
        bullets: [
          'Raisonne sur votre référentiel IT réel',
          'Démarre supervisé, gagne en autonomie',
          'Chaque action enregistrée, autonomie que vous pouvez retirer',
          'Runtime ouvert, écrivez votre propre connecteur',
        ],
        ctaLabel: 'En savoir plus',
      },
    ],
  },

  crossCutting: {
    eyebrow: "Pensé pour l'entreprise",
    title: 'Un seul système connecté, sous votre contrôle.',
    intro:
      "Les modules travaillent à partir des mêmes données, ce qui donne à une DSI une véritable gouvernance. C'est aussi ce qui permet à un agent d'agir sans mettre votre environnement en danger.",
    items: [
      {
        title: 'Reporting & tableaux de bord',
        body: 'Tableaux de bord orientés direction, analyses de tendance, exports CSV et PNG.',
      },
      {
        title: "Contrôle d'accès par rôle",
        body: 'Permissions fines par module. Niveaux lecteur, contributeur, membre, administrateur.',
      },
      {
        title: 'Relations riches',
        body: 'Liez les coûts aux applications, les applications aux projets, les projets aux budgets, la connaissance à tout.',
      },
      {
        title: "Journal d'audit complet",
        body: "Chaque changement tracé, y compris ceux faits via Plaid. Les actions des agents ont leur propre historique d'activité. Sachez qui a changé quoi, quand, avec l'historique complet avant et après.",
      },
      {
        title: 'Gestion unifiée des tâches',
        body: 'Affectez des tâches aux OPEX, CAPEX, contrats, projets. Une seule pile de tâches à travers la plateforme.',
      },
      {
        title: 'SSO via Microsoft Entra ID',
        body: "Authentification unique pour l'entreprise. Un seul identifiant pour toute l'organisation.",
      },
    ],
  },

  vision: {
    eyebrow: 'Là où cela mène',
    title: "Vers une DSI augmentée par l'IA.",
    body: "La direction prise est celle d'une DSI où les agents portent discrètement la charge répétitive pour que votre équipe consacre son temps au travail qui exige un vrai jugement, le tout fonctionnant sur un logiciel que vous possédez et que vous pouvez lire de bout en bout.",
  },

  cta: {
    title: 'Pilotez votre DSI sur un système qui vous appartient.',
    body: "Déployez KANAP vous-même gratuitement, ou confiez-nous l'hébergement. Le produit et chaque fonctionnalité sont identiques, agents compris.",
    primary: 'Déployer gratuitement',
    secondary: 'Essayer le cloud hébergé',
  },
};

export default content;
