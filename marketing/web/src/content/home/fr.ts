import type { HomeContent } from './types';

const content: HomeContent = {
  meta: {
    title: 'Budget IT, SI et projets de la DSI, open source',
    description:
      'Budget IT, cartographie applicative, portefeuille de projets et documentation dans un seul référentiel, avec un agent IA intégré. Open source.',
  },

  hero: {
    eyebrow: 'Open source · conçue par un DSI, pour les DSI',
    title: 'Le budget, le SI et les projets de la DSI, dans un seul référentiel.',
    lead: "Le budget IT sort d'Excel et se relie à ce qui le justifie : applications, contrats, projets. Cartographie, portefeuille et documentation partagent les mêmes données, et Plaid, l'agent IA intégré, répond sur l'ensemble. Open source, gratuit en auto-hébergement.",
    primaryCta: "Essayer avec des données d'exemple",
    secondaryCta: 'Déployer gratuitement',
    trialNote: 'Essai de la version hébergée · données d’exemple chargées en une minute · AGPL v3, code source complet sur GitHub.',
  },

  layers: {
    eyebrow: 'Le budget IT',
    title: "Le budget de la DSI, sorti d'Excel.",
    intro:
      "OPEX et CAPEX sur plusieurs années, dans des colonnes que vous nommez : budget, révision, atterrissage. Chaque version se copie, se compare et se gèle. Fini les onglets recopiés et les formules cassées.",
    items: [
      {
        title: 'Atterrissage et budget N+1',
        body: "Fiabilisez l'atterrissage ligne par ligne, copiez-le vers le budget de l'année suivante, ajustez en quantité × prix, puis gelez la version validée. Les taux de change sont figés avec elle.",
      },
      {
        title: 'Refacturation et analyse',
        body: "Ventilez chaque ligne entre sociétés, départements et centres de coûts, refacturez avec des règles claires, analysez par dimension analytique et consolidez sur votre plan de comptes.",
      },
      {
        title: 'Effectifs et coût par ETP',
        body: "Déclarez les ETP sur les lignes concernées : KANAP en tire les effectifs par mois et le coût par ETP, en montant comme en taux journalier, à côté des montants.",
      },
    ],
    outro: "Et parce que chaque ligne est reliée au reste du référentiel, le budget n'est plus une liste de montants : c'est la carte de ce que la DSI fait tourner.",
  },

  pillars: {
    eyebrow: 'Tout est relié',
    title: 'Un seul référentiel au lieu d’un tableur, d’un wiki et d’un outil de projets.',
    items: [
      {
        title: 'Une ligne de budget mène à ce qui la justifie.',
        body: "Chaque dépense OPEX ou CAPEX est reliée à ses applications, ses contrats, ses fournisseurs et ses projets. On sait ce que l'on paie, et pourquoi.",
      },
      {
        title: 'Une application montre ce qu’elle coûte.',
        body: "Sa fiche réunit ses environnements, ses interfaces, ses serveurs, ses contrats et ses dépenses : de quoi décider d'une rationalisation sur des faits.",
      },
      {
        title: 'Un contrat montre ce qu’il engage.',
        body: "Montant annuel, reconduction tacite, préavis, date limite de résiliation calculée et lignes de budget liées : les renouvellements se préparent avant l'échéance, pas après.",
      },
    ],
  },

  modules: {
    eyebrow: 'Toute la gouvernance de la DSI',
    title: 'Quatre piliers, un agent IA, les mêmes données.',
    intro:
      "Chaque module est utilisable seul : commencez par le budget, ajoutez la cartographie, le portefeuille ou la documentation quand vous êtes prêt. Ils travaillent tous sur le même référentiel.",
    items: [
      {
        slug: '/features/budget',
        title: 'Budget IT',
        blurb:
          "Pour le DSI et ses partenaires finance. Budget pluriannuel, atterrissage et budget N+1, refacturation, consolidation, effectifs. Des chiffres que la direction financière peut vérifier.",
        bullets: [
          'OPEX et CAPEX, colonnes budget, révision et atterrissage',
          'Copie et gel des versions',
          'Refacturation, dimensions analytiques, consolidation',
          'Effectifs par mois et coût par ETP',
        ],
        ctaLabel: 'Découvrir le budget',
      },
      {
        slug: '/features/it-landscape',
        title: 'Cartographie',
        blurb:
          "Pour les architectes, les responsables d'application et l'infrastructure. Applications, interfaces et serveurs documentés, et des cartes qui montrent le SI d'un coup d'œil.",
        bullets: [
          'Applications et instances par environnement',
          'Interfaces, flux et middleware',
          'Serveurs et infrastructure, import depuis NetBox',
          "Cartes d'interfaces et de connexions interactives",
        ],
        ctaLabel: 'Découvrir la cartographie',
      },
      {
        slug: '/features/portfolio',
        title: 'Portefeuille de projets',
        blurb:
          'Pour les chefs de projet et les responsables IT. Scorez les demandes, construisez une feuille de route qui tient compte de la capacité, suivez les projets jusqu’à la livraison.',
        bullets: [
          'Scoring des demandes avec critères pondérés',
          'Feuille de route planifiée selon la capacité',
          'Analyse des goulots et de la charge',
          'Projets, jalons et tâches',
        ],
        ctaLabel: 'Découvrir le portefeuille',
      },
      {
        slug: '/features/knowledge',
        title: 'Documentation',
        blurb:
          "Pour toute l'équipe, et d'abord le support et l'exploitation. Procédures, décisions et notes d'architecture, relues, versionnées et reliées aux applications et aux projets qu'elles décrivent.",
        bullets: [
          'Éditeur markdown et circuit de relecture',
          'Bibliothèques, dossiers, types de documents',
          'Versions et export PDF, DOCX, ODT',
          'Liens vers applications, projets, actifs, tâches',
        ],
        ctaLabel: 'Découvrir la documentation',
      },
      {
        slug: '/features/ai',
        title: "Plaid, l'agent IA intégré",
        blurb:
          "Pour chaque rôle. Posez une question en langage naturel sur le budget, le SI ou les projets : Plaid répond à partir de tout le référentiel et prépare les modifications, que vous validez.",
        bullets: [
          'Questions en langage naturel sur tous les modules',
          'Modifications préparées en aperçu, appliquées après validation',
          'Serveur MCP en lecture seule pour vos clients IA',
          'Usage inclus dans la version hébergée, ou votre propre clé',
        ],
        ctaLabel: 'Découvrir Plaid',
      },
      {
        slug: '/features/agents',
        title: 'Agent helpdesk',
        blurb:
          "Pour les équipes de support. L'agent lit chaque ticket de votre centre de services (GLPI aujourd'hui) au regard de vos applications et de votre documentation, et propose une réponse, une note interne ou une mise à jour.",
        bullets: [
          'Raisonne sur votre référentiel réel',
          'Chaque type d’action commence sous validation',
          'Passage en automatique quand l’historique le justifie',
          'Chaque action tracée, autonomie révocable',
        ],
        ctaLabel: "Découvrir l'agent",
      },
    ],
  },

  crossCutting: {
    eyebrow: "Pensé pour l'entreprise",
    title: 'Un seul système, sous votre contrôle.',
    intro:
      "Les modules partagent les mêmes données : c'est ce qui donne à la DSI une vraie gouvernance, et ce qui permet à l'IA d'aider sans mettre votre environnement en danger.",
    items: [
      {
        title: 'Relations riches',
        body: 'Coûts reliés aux applications, applications aux contrats, projets et serveurs, documentation à tout.',
      },
      {
        title: 'Rapports et tableaux de bord',
        body: 'Rapports budgétaires prêts à l’emploi, tendances, comparaisons de versions, exports CSV et PNG.',
      },
      {
        title: 'Multi-sociétés et multi-devises',
        body: 'Plusieurs sociétés, plusieurs devises, des taux figés au gel du budget et une consolidation sur votre plan de comptes.',
      },
      {
        title: "Contrôle d'accès par rôle",
        body: 'Permissions fines par module : lecteur, contributeur, membre, administrateur.',
      },
      {
        title: "Journal d'audit complet",
        body: "Chaque changement tracé, y compris ceux faits via Plaid, avec l'avant et l'après. Les actions de l'agent ont leur propre historique.",
      },
      {
        title: 'SSO via Microsoft Entra ID',
        body: "Authentification unique pour l'entreprise : un seul identifiant pour toute l'organisation.",
      },
    ],
  },

  vision: {
    eyebrow: 'L’IA sur un référentiel complet',
    title: 'Une IA utile, parce que tout est au même endroit.',
    body: "Un assistant IA ne vaut que par les données qu'il voit. Dans KANAP, il voit le budget, les applications, les contrats, les projets et la documentation à la fois : il peut donc répondre à « pourquoi l'atterrissage dérape sur l'infrastructure ? » ou « quelles applications dépendent de ce contrat ? ».\nIl prépare les modifications, vous les validez. Rien ne change sans vous, et tout est tracé.",
  },

  cta: {
    title: 'Pilotez votre DSI sur un système qui vous appartient.',
    body: "Essayez la version hébergée avec des données d'exemple, ou déployez KANAP gratuitement chez vous. Le produit est le même, sans fonction bridée.",
    primary: "Essayer avec des données d'exemple",
    secondary: 'Déployer gratuitement',
  },
};

export default content;
