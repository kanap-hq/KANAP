import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Gestion de portefeuille',
    description:
      'Scoring des demandes, génération automatique de feuille de route, planification selon la capacité, suivi du cycle de vie projet. Open source.',
  },
  header: {
    eyebrow: 'Gestion de portefeuille',
    title: 'De la demande à la livraison, avec une feuille de route automatique.',
    lead: 'Pilotez votre pipeline projet avec du scoring intelligent, une génération de feuille de route qui tient compte de la capacité et un suivi du cycle de vie. Simulez avant d\'engager des dates.',
  },
  sections: [
    {
      title: 'Scoring et évaluation des demandes',
      body: 'Évaluez les demandes entrantes avec des critères de scoring paramétrables. Pondérez valeur métier, ROI, risque et urgence pour calculer une priorité. Règles de contournement obligatoires et override manuel avec justification.',
      bullets: [
        'Critères de scoring paramétrables avec pondération',
        'Critères par défaut : valeur, alignement, coûts, ROI, risque, urgence',
        'Échelles inversées pour coût/risque (plus haut = moins prioritaire)',
        'Règles de contournement pour les demandes critiques',
        'Override manuel avec justification obligatoire',
      ],
      shotAlt: 'Éditeur de scoring avec critères pondérés',
    },
    {
      title: 'Cycle de vie des demandes',
      body: 'Suivez les demandes de la soumission initiale à l\'approbation et la conversion en projet. Workflow intégré, historique d\'activité, enregistrement des décisions CAB : tout le monde est aligné.',
      bullets: [
        'Flux : En attente, Candidate, Approuvée, Convertie',
        'Chemins alternatifs : En attente, Rejetée',
        'Historique d\'activité avec commentaires et changements de statut',
        'Décisions CAB enregistrées formellement',
        'Conversion en un clic d\'une demande approuvée en projet',
      ],
      shotAlt: 'Workspace de demande avec chronologie d\'activité',
    },
    {
      title: 'Suivi du cycle de vie projet',
      body: 'Pilotez les projets de la planification à la livraison. Dates prévues vs réelles, baselines, effort. Projets standard, mandats fast-track, legacy, tout supporté.',
      bullets: [
        'Flux : File d\'attente, Planifié, En cours, En test, Terminé',
        'Capture de baseline à l\'entrée en exécution',
        'Dates prévues vs réelles pour l\'analyse d\'écart',
        'Suivi d\'effort : estimé vs réel, IT et métier',
        'Origine : standard, fast-track, legacy',
      ],
      shotAlt: 'Workspace projet avec baseline vs dates réelles',
    },
    {
      title: 'Planification automatique de la feuille de route',
      body: "Générez des scénarios de livraison à partir de l'effort restant, des dépendances et de la capacité des contributeurs. Goulots et occupation visibles avant application aux projets. Ces données de scoring et de feuille de route font partie de ce sur quoi un agent raisonne lorsqu'il prend en charge un travail associé.",
      bullets: [
        'Planification hebdomadaire tenant compte de la capacité réelle',
        'Périmètre : file d\'attente, planifiés, en cours, en test',
        'Recalcul optionnel des projets planifiés ou simulation plan figé',
        'Analyse de sensibilité par contributeur',
        'Vues d\'occupation mensuelles par contributeur et équipe',
        'Application sélective et transactionnelle des dates générées',
      ],
      shotAlt: 'Feuille de route générée avec heatmap de capacité',
    },
  ],
  more: {
    title: 'Plus dans Portefeuille',
    items: [
      { title: 'Gestion d\'équipe', body: 'Affectez sponsors, leads, membres métier et IT. Contacts externes suivis.' },
      { title: 'Liens budgétaires', body: 'Liez les projets aux items OPEX et CAPEX. Comprenez le vrai coût du portefeuille.' },
      { title: 'Dépendances', body: 'Suivi des dépendances de demandes et projets. Les liens bloquants alimentent le séquencement.' },
      { title: 'Rapports portefeuille', body: 'Heatmaps de capacité, analyse de goulots, analytics d\'occupation.' },
    ],
  },
  crossLinks: {
    label: 'Explorez la plateforme',
    links: [
      { label: 'Agents', href: '/features/agents' },
      { label: 'Plaid, Assistant IA', href: '/features/ai' },
      { label: 'Gestion du budget', href: '/features/budget' },
      { label: 'Cartographie IT', href: '/features/it-landscape' },
      { label: 'Connaissance', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: 'Prêt à maîtriser votre pipeline projet ?',
    body: 'Auto-hébergez gratuitement, ou essayez le cloud hébergé.',
    primary: 'Déployer gratuitement',
    secondary: 'Essayer le cloud hébergé',
  },
};

export default content;
