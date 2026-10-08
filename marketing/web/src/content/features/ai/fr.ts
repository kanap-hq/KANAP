import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Plaid, Assistant IA pour la gouvernance IT',
    description:
      "Interrogez Plaid sur vos données IT. Créez des documents, mettez à jour des tâches, connectez n'importe quel outil IA via MCP. Usage inclus sur le cloud hébergé. Open source.",
  },
  header: {
    eyebrow: 'Plaid · Assistant IA',
    title: 'Posez à KANAP toutes vos questions sur votre IT.',
    lead: "Plaid répond sur votre budget, vos applications, vos projets et votre documentation, et effectue des changements quand vous le demandez. Chaque écriture vous est montrée avant son exécution. Utilisez-le dans KANAP, ou connectez-le à vos propres outils IA via MCP.",
  },
  sections: [
    {
      title: 'Cherchez et interrogez tout',
      body: 'Posez à Plaid des questions sur vos applications, serveurs, contrats, items de budget, projets, tâches, documents. Réponses instantanées avec des données structurées, pas des résumés flous.',
      bullets: [
        'Recherche transverse sur toutes les entités',
        'Requêtes structurées avec filtres et tris',
        'Agrégations et statistiques',
        'Recherche plein texte dans la base de connaissances',
      ],
      shotAlt: 'Plaid répondant à une requête transverse',
    },
    {
      title: "Passez à l'action avec aperçu",
      body: "Plaid écrit autant qu'il lit. Il peut créer et mettre à jour du contenu pour vous, et chaque écriture est prévisualisée avant son application.",
      bullets: [
        'Création et édition de documents en markdown',
        'Rédaction de briefs et de résumés projet',
        'Mise à jour de tâches : statut, affectataires, commentaires',
        'Aperçu des changements avant application',
      ],
      shotAlt: 'Plaid montrant un aperçu de mises à jour de tâches',
    },
    {
      title: "MCP, utilisez KANAP depuis n'importe quel outil IA",
      body: 'KANAP expose un serveur MCP (Model Context Protocol) complet. Connectez Claude Desktop, Cursor, Windsurf ou tout client compatible, et interrogez vos données de gouvernance IT sans quitter votre flux.',
      bullets: [
        'Protocole MCP standard, compatible avec tout client',
        'Authentification par clé API avec scoping granulaire',
        'Les mêmes requêtes en lecture que le chat intégré (MCP est en lecture seule)',
        'Conservez vos flux IA existants, ajoutez le contexte KANAP',
      ],
      shotAlt: 'Configuration MCP avec scoping de clé API',
    },
    {
      title: 'Contrôle et conformité totaux',
      body: 'Plaid respecte vos règles. Chaque action est régie par les permissions utilisateur. Les administrateurs gardent le contrôle total sur ce que Plaid peut ou ne peut pas faire.',
      bullets: [
        'Respect total des permissions utilisateur sur chaque requête',
        'Clés API sécurisées avec scoping MCP granulaire',
        'Recherche web activable ou désactivable indépendamment',
        'Aperçu et confirmation de toutes les écritures',
        'Accès en lecture seule via les rôles pour des déploiements prudents',
      ],
      shotAlt: 'Contrôles admin Plaid avec matrice de permissions',
    },
  ],
  more: {
    title: 'Ce que vous pouvez demander à Plaid',
    items: [
      { title: '« Où en est le projet Atlas ? »', body: 'Plaid récupère le projet, ses tâches, sa timeline, son équipe, et fournit un brief de statut avec bloqueurs et jalons à venir.' },
      { title: '« Liste les applications AWS sans propriétaire »', body: 'Requête structurée sur votre paysage IT. Résultats filtrés et triés depuis des données live.' },
      { title: "« Rédige une politique de sécurité d'accès distant »", body: 'Plaid crée un nouveau document dans votre base, avec métadonnées et contenu markdown corrects.' },
      { title: '« Quels contrats expirent dans 90 jours ? »', body: 'Réponse instantanée avec noms de fournisseurs, montants et dates de renouvellement.' },
    ],
  },
  crossLinks: {
    label: 'Explorez la plateforme',
    links: [
      { label: 'Agents, pour le travail qui tourne tout seul', href: '/features/agents' },
      { label: 'Sécurité', href: '/security' },
      { label: 'Gestion du budget', href: '/features/budget' },
      { label: 'Paysage IT', href: '/features/it-landscape' },
      { label: 'Gestion de portefeuille', href: '/features/portfolio' },
      { label: 'Connaissance', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: "La gouvernance IT augmentée par l'IA commence ici.",
    body: 'Plaid est inclus dans chaque workspace KANAP, avec un usage généreux sur le cloud hébergé. Auto-hébergement gratuit, ou cloud hébergé.',
    primary: 'Déployer gratuitement',
    secondary: 'Essayer le cloud hébergé',
  },
};

export default content;
