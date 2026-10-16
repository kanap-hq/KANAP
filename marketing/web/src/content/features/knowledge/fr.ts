import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Gestion de la connaissance',
    description:
      'Éditeur markdown avec bibliothèques, dossiers, workflows de revue, historique des versions et export PDF / DOCX / ODT. Liens profonds vers apps, projets, actifs, tâches. Open source.',
  },
  header: {
    eyebrow: 'Connaissance',
    title: 'Votre documentation IT, connectée à tout.',
    lead: 'Gouvernance documentaire markdown avec bibliothèques structurées, workflows de revue et intégration profonde avec vos applications, actifs, projets et tâches.',
  },
  sections: [
    {
      title: 'Éditeur markdown avec gouvernance',
      body: 'Rédigez et maintenez votre documentation IT avec un éditeur markdown riche. Verrous d\'édition contre les modifications concurrentes, sauvegarde automatique. Images inline et support markdown complet.',
      bullets: [
        'Éditeur markdown riche avec aperçu live',
        'Verrous d\'édition contre les modifications concurrentes',
        'Autosave avec option de sauvegarde manuelle',
        'Images inline',
        'Markdown complet : titres, listes, tableaux, code',
      ],
      shotAlt: 'Éditeur markdown avec indicateur de verrou',
    },
    {
      title: 'Bibliothèques, dossiers & types de documents',
      body: 'Organisez votre documentation en bibliothèques, naviguez par dossier, classez par type. Gabarits pour démarrer rapidement avec une structure prédéfinie.',
      bullets: [
        'Bibliothèques multiples par domaine de connaissance',
        'Hiérarchie de dossiers pour l\'organisation logique',
        'Types de documents pour la classification et la gouvernance',
        'Gabarits groupés par type',
        'Navigation, recherche et filtrage transverses',
      ],
      shotAlt: 'Arborescence de bibliothèque avec dossiers et types',
    },
    {
      title: 'Workflows de revue et d\'approbation',
      body: 'Affectez propriétaires, auteurs, relecteurs, approbateurs. Soumettez pour revue, recueillez les décisions, suivez le statut. Édition bloquée pendant la revue.',
      bullets: [
        'Rôles propriétaire, auteur, relecteur, approbateur',
        'Soumission pour revue en un clic',
        'Notes de décision des relecteurs et approbateurs',
        'Édition bloquée pendant la revue active',
        'Historique et suivi du statut d\'approbation',
      ],
      shotAlt: 'Panneau de revue avec puces de statut',
    },
    {
      title: 'Documentation connectée',
      body: "Liez les documents aux applications, actifs, projets, demandes et tâches. Accès aux documents managés depuis d'autres workspaces. Distinction lié / apparenté pour une traçabilité fine. La base de connaissances est aussi ce que citent vos agents : la source dont un agent se sert, et ce vers quoi il pointe lorsqu'il répond.",
      bullets: [
        'Relations avec applications, actifs, projets, demandes, tâches',
        'Documents managés accessibles depuis d\'autres workspaces',
        'Distinction lié / apparenté',
        'Navigation bidirectionnelle entre documents et entités',
        "Journal d'audit complet des changements de relations",
      ],
      shotAlt: 'Document avec panneau latéral d\'entités liées',
    },
  ],
  more: {
    title: 'Plus dans Connaissance',
    items: [
      { title: 'Historique des versions', body: 'Chaque sauvegarde crée une version. Parcourez et restaurez toute version antérieure.' },
      { title: 'Export', body: 'Export PDF, DOCX et ODT. Partagez la documentation hors KANAP.' },
      { title: 'Gabarits', body: 'Démarreurs réutilisables groupés par type. Lancement rapide.' },
      { title: 'Import', body: 'Import depuis Word et PDF. Faites entrer votre documentation existante en un clic.' },
    ],
  },
  crossLinks: {
    label: 'Explorez la plateforme',
    links: [
      { label: 'Agents', href: '/features/agents' },
      { label: 'Plaid, Assistant IA', href: '/features/ai' },
      { label: 'Gestion du budget', href: '/features/budget' },
      { label: 'Paysage IT', href: '/features/it-landscape' },
      { label: 'Gestion de portefeuille', href: '/features/portfolio' },
    ],
  },
  cta: {
    title: 'Prêt à gouverner votre documentation IT ?',
    body: 'Auto-hébergez gratuitement, ou essayez le cloud hébergé.',
    primary: 'Déployer gratuitement',
    secondary: 'Essayer le cloud hébergé',
  },
};

export default content;
