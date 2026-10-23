import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Cartographie IT',
    description:
      'Applications, technologies, interfaces et serveurs en un référentiel. Vulnérabilités et fins de support jusqu\'à l\'application métier. Open source.',
  },
  header: {
    eyebrow: 'Cartographie IT',
    title: 'Documentez tout votre système d\'information.',
    lead: 'Applications, technologies, interfaces et infrastructure en un seul lieu. Suivez les fins de support et les vulnérabilités jusqu\'à l\'application métier, et visualisez votre architecture sur des cartes interactives.',
  },
  sections: [
    {
      title: 'Portefeuille applicatif',
      body: 'Maintenez un inventaire complet de vos applications avec des instances par environnement. Propriété, criticité, conformité et cycle de vie suivis. Lignée de versions maintenue.',
      bullets: [
        'Applications logiques avec instances par environnement (prod, pré-prod, recette, dev)',
        'Suivi de la lignée des versions',
        'Cycle de vie : proposé, actif, déprécié, retiré',
        'Propriété : propriétaires IT et métier, contacts support',
        'Conformité : classe de données, PII, résidence',
      ],
      shotAlt: 'Portefeuille applicatif avec colonnes de cycle de vie',
    },
    {
      title: 'Documentation des interfaces',
      body: 'Documentez les intégrations entre applications avec des définitions métier et techniques. Support des connexions directes et des patterns middleware 3 segments (Extract / Transform / Load). Bindings par environnement avec endpoints et authentification.',
      bullets: [
        'Objectif métier, catégorie de données, processus lié',
        'Routes directes ou via middleware',
        'Support 3 segments : Extract, Transform, Load',
        'Configuration des bindings par environnement et par segment',
        'Définition fonctionnelle : objets métier, cas d\'usage, identifiants',
      ],
      shotAlt: 'Détail d\'interface avec middleware 3 segments',
    },
    {
      title: 'Registre d\'infrastructure',
      body: 'Suivez serveurs, emplacements et connexions. Déploiements on-premise et cloud. Documentez la connectivité réseau avec topologies multi-serveurs et routage par couches.',
      bullets: [
        'Registre de serveurs : VMs, bases, files, conteneurs, fonctions',
        'Emplacements : datacenters, régions cloud, zones de disponibilité',
        'Connexions serveur-à-serveur et mesh multi-serveurs',
        'Support clusters avec groupement de membres',
        'Si ce serveur tombe : applications, clusters et processus touchés',
      ],
      shotAlt: 'Registre de serveurs groupé par emplacement',
    },
    {
      title: 'Technologies et fins de support',
      body: 'Les technologies relient vos applications à vos serveurs : bases de données, middleware, systèmes d\'exploitation, annuaires, services cloud. Chacune porte ses versions et leurs dates de fin de support, tenues à jour par le catalogue.',
      bullets: [
        'Catalogue de 192 produits, une technologie créée en un clic',
        'Dates de support suivies sur endoflife.date et chez les éditeurs, avec leur source',
        'Le système d\'exploitation de chaque serveur, avec sa version',
        'Rapport Fins de support : ce qui arrive à échéance et ce que cela touche',
        'Liens avec les serveurs et les applications, importables en CSV',
      ],
      shotAlt: 'Fiche d\'une technologie avec ses versions et leurs dates de fin de support',
    },
    {
      title: 'Vulnérabilités',
      body: 'KANAP rapproche les vulnérabilités publiées de vos technologies, version par version, et montre les serveurs et les applications métier qu\'elles touchent. Les failles exploitées passent en tête.',
      bullets: [
        'Deux sources toutes les 6 heures : la NVD et les fiches des éditeurs sur CVE.org',
        'Signaux d\'exploitation : catalogues de la CISA et de l\'Union européenne, score EPSS',
        'Sur les listes et les fiches des serveurs et des applications, et au tableau de bord',
        'À traiter, traitée, non concernée : avec une note et le journal d\'audit',
        'E-mail aux responsables IT pour les failles graves ou exploitées',
      ],
      shotAlt: 'Page Vulnérabilités, les failles exploitées en tête',
    },
    {
      title: 'Cartes d\'architecture interactives',
      body: "Deux visualisations D3 vous permettent de comprendre votre architecture d'un coup d'œil. Filtrez par environnement, cycle de vie ou nœuds racines. Export SVG ou PNG. Cette cartographie est aussi ce que lisent vos agents, pour savoir quelle application un problème touche, qui en est responsable et son degré de criticité.",
      bullets: [
        'Carte des interfaces : applications comme nœuds, interfaces comme arêtes',
        'Carte des connexions : serveurs et connectivité réseau',
        'Vue métier (sans middleware) et vue technique',
        'Filtrage par profondeur : limiter le graphe à N sauts',
        'Export SVG et PNG en 2x',
      ],
      shotAlt: 'Carte d\'interfaces interactive avec filtres',
    },
  ],
  more: {
    title: 'Plus dans Cartographie IT',
    items: [
      { title: 'Dérivation des risques', body: 'Risque de connexion calculé depuis les interfaces liées. Criticité, classe de données, PII auto-dérivés.' },
      { title: 'Zones d\'administration', body: 'Qui administre quoi, selon le modèle en tiers. Les écarts de cloisonnement entre zones sont signalés.' },
      { title: 'Liens coûts', body: 'Liez applications, serveurs et technologies aux lignes budgétaires et aux contrats. Voyez le vrai coût du portefeuille.' },
      { title: 'Import / export CSV', body: 'Import en masse d\'applications et d\'actifs. Export de l\'inventaire pour analyse.' },
    ],
  },
  crossLinks: {
    label: 'Explorez la plateforme',
    links: [
      { label: 'Agents', href: '/features/agents' },
      { label: 'Plaid, Assistant IA', href: '/features/ai' },
      { label: 'Gestion du budget', href: '/features/budget' },
      { label: 'Gestion de portefeuille', href: '/features/portfolio' },
      { label: 'Connaissance', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: 'Prêt à documenter votre SI ?',
    body: 'Auto-hébergez gratuitement, ou essayez le cloud hébergé.',
    primary: 'Déployer gratuitement',
    secondary: 'Essayer le cloud hébergé',
  },
};

export default content;
