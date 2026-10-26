import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Plaid, Assistant IA pour la gouvernance IT',
    description:
      "Interrogez Plaid sur vos données IT. Créez des documents, mettez à jour des tâches, ajoutez KANAP à Claude en un clic. Usage inclus sur le cloud hébergé. Open source.",
  },
  header: {
    eyebrow: 'Plaid · Assistant IA',
    title: 'Posez à KANAP toutes vos questions sur votre IT.',
    lead: "Plaid répond sur votre budget, vos applications, vos projets et votre documentation, et effectue des changements quand vous le demandez. Chaque écriture vous est montrée avant son exécution. Utilisez-le dans KANAP, ou ajoutez KANAP à Claude avec son adresse et un clic.",
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
      shotAlt: "Plaid répond en tableau : les contrats à décider sous 90 jours et les applications qu'ils couvrent",
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
      shotAlt: 'Plaid prépare deux changements sur une tâche, en aperçu, avec Approuver et Refuser',
    },
    {
      title: 'Ajoutez KANAP à Claude en un clic',
      body: "Collez votre adresse KANAP dans Claude comme connecteur personnalisé, connectez-vous, cliquez sur Autoriser. Claude répond alors à partir de votre budget, de vos applications, de vos projets et de vos documents. Aucune clé à créer ni à copier. Cela fonctionne dans Claude, Claude Desktop et Claude Code.",
      bullets: [
        'Chaque personne se connecte avec son propre compte KANAP',
        "En lecture seule, dans la limite des droits de cette personne",
        "Chaque utilisateur voit ses applications connectées et les déconnecte en un clic",
        'Les clés API restent disponibles pour les scripts et les autres clients MCP',
      ],
      shotAlt: 'Claude répond à partir des données de KANAP : FTE externes et TJM moyen par fournisseur, en graphiques',
    },
    {
      title: 'Contrôle et conformité totaux',
      body: 'Plaid respecte vos règles. Chaque action est régie par les permissions utilisateur. Les administrateurs gardent le contrôle total sur ce que Plaid peut ou ne peut pas faire.',
      bullets: [
        'Respect total des permissions utilisateur sur chaque requête',
        "Connexions et clés MCP limitées aux droits de chaque utilisateur, révocables à tout moment",
        'Recherche web activable ou désactivable indépendamment',
        'Aperçu et confirmation de toutes les écritures',
        'Accès en lecture seule via les rôles pour des déploiements prudents',
      ],
      shotAlt: 'Réglages de Plaid : chat et MCP activés, modèle inclus et lieu de traitement confirmés, consommation du mois',
    },
  ],
  more: {
    title: 'Ce que vous pouvez demander à Plaid',
    items: [
      { title: '« Où en est le projet Atlas ? »', body: 'Plaid récupère le projet, ses tâches, sa timeline, son équipe, et fournit un brief de statut avec bloqueurs et jalons à venir.' },
      { title: '« Liste les applications AWS sans propriétaire »', body: 'Requête structurée sur votre cartographie IT. Résultats filtrés et triés depuis des données live.' },
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
      { label: 'Cartographie IT', href: '/features/it-landscape' },
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
