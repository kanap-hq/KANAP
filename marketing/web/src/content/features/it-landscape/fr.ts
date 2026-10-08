import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Paysage IT',
    description:
      'Documentez applications, interfaces et infrastructure. Cartes d\'architecture interactives, suivi du cycle de vie, middleware 3 segments. Open source.',
  },
  header: {
    eyebrow: 'Paysage IT',
    title: 'Documentez tout votre système d\'information.',
    lead: 'Applications, interfaces et infrastructure en un seul lieu. Visualisez votre architecture via des cartes interactives et suivez les cycles de vie de la proposition au retrait.',
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
        'Suivi des OS avec dates de support',
      ],
      shotAlt: 'Registre de serveurs groupé par emplacement',
    },
    {
      title: 'Cartes d\'architecture interactives',
      body: "Deux visualisations D3 vous permettent de comprendre votre architecture d'un coup d'œil. Filtrez par environnement, cycle de vie ou nœuds racines. Export SVG ou PNG. Ce paysage est aussi la carte que lisent vos agents, pour savoir quelle application un problème touche, qui en est responsable et son degré de criticité.",
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
    title: 'Plus dans Paysage IT',
    items: [
      { title: 'Dérivation des risques', body: 'Risque de connexion calculé depuis les interfaces liées. Criticité, classe de données, PII auto-dérivés.' },
      { title: 'Contacts support', body: 'Utilisateurs internes et contacts externes par application avec rôles et notes.' },
      { title: 'Liens coûts', body: 'Liez les applications aux items OPEX / CAPEX. Voyez le vrai coût du portefeuille.' },
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
