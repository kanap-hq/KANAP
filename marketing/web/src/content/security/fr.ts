import type { SecurityContent } from './types';

const content: SecurityContent = {
  meta: {
    title: 'Sécurité',
    description:
      "Comment KANAP protège vos données : row-level security, mots de passe hachés, secrets chiffrés, RBAC, journal d'audit, gouvernance des agents, SSO et transparence open source. Auto-hébergé ou cloud.",
  },
  header: {
    eyebrow: 'Sécurité',
    title: 'Une sécurité qui respecte vos données.',
    lead:
      "Contrôles de niveau gouvernance dès le premier jour. La même plateforme tourne sur notre cloud et sur vos serveurs, avec la même isolation, le même contrôle d'accès, la même auditabilité et la même gouvernance sur ce que les agents ont le droit de faire.",
  },
  overview: {
    title: 'Principes',
    intro:
      "KANAP est conçu pour les DSI qui manipulent des données sensibles. Nous traitons vos données comme nous voulons que nos fournisseurs IT traitent les nôtres, transparentes, isolées, à portée de main quand il le faut.",
    pillars: [
      {
        title: 'Transparent par défaut',
        body: "Tout le code source est sur GitHub sous AGPL v3. Votre équipe sécurité le lit, l'audite ou le fork. Rien n'est caché derrière des binaires propriétaires.",
      },
      {
        title: 'Isolé par conception',
        body: "La row-level security de la base de données elle-même impose l'isolation des tenants à chaque requête que l'application exécute.",
      },
      {
        title: 'Toujours exportable',
        body: "Vos données sont à vous. Export CSV sur les listes principales, export documents en PDF, DOCX et ODT. Aucune taxe d'extraction.",
      },
    ],
  },
  tenancy: {
    title: 'Isolation des tenants',
    body:
      "KANAP est multi-tenant au niveau base de données. Chaque ligne de chaque table partagée porte un `tenant_id`, et les policies PostgreSQL Row-Level Security appliquent le filtre sur chaque lecture et écriture. La policy fait partie du schéma de la base de données : elle s'applique à chaque requête de l'application.",
    bullets: [
      'Policies PostgreSQL RLS sur chaque table qui contient des données de tenant, toutes forcées',
      "Filtrage `tenant_id` imposé au niveau base de données, pas juste dans l'app",
      'Le tenant courant est posé au début de chaque transaction de base de données, et les policies le lisent',
      "Le rôle de base de données de l'application n'a ni droit superutilisateur ni droit de contournement, et l'application refuse de démarrer sinon",
      "Une table de données de tenant sans sa policy d'isolation fait échouer les tests de CI",
      "Tests d'isolation des tenants à chaque exécution CI",
    ],
  },
  dataProtection: {
    title: 'Protection des données',
    body:
      'Pratiques standards, appliquées rigoureusement. Hachage robuste des mots de passe, secrets chiffrés, jetons hachés et HTTPS sur chaque connexion au cloud.',
    bullets: [
      "Cloud : HTTPS pour chaque connexion entre les utilisateurs et la plateforme, avec redirection de HTTP vers HTTPS et Cloudflare qui termine TLS devant nos serveurs. Auto-hébergement : vous terminez TLS avec vos propres certificats",
      'Hachage Argon2id des mots de passe (64 Mio de mémoire) avec sels par utilisateur',
      "Secrets stockés via l'environnement, jamais dans le code",
      "Vos propres clés de fournisseur IA et identifiants d'intégration (GLPI, Netbox) chiffrés au repos en AES-256-GCM",
      "Jetons MCP et jetons de rafraîchissement de session stockés hachés, et révocables",
      "Jeton d'accès conservé en mémoire dans le navigateur, jeton de rafraîchissement dans un cookie HttpOnly",
    ],
  },
  access: {
    title: "Contrôle d'accès",
    body:
      "Permissions fines par module, par rôle. Chaque feature gate et chaque requête d'entité respecte la même matrice RBAC, y compris Plaid et MCP.",
    bullets: [
      'Niveaux lecteur, contributeur, membre et administrateur par module',
      'Rôle admin workspace distinct des admins de module',
      'SSO via Microsoft Entra ID (OIDC) en cloud et auto-hébergé',
      'Authentification locale par mot de passe avec Argon2 + flux optionnel de réinitialisation',
      "Plaid et MCP appliquent le même RBAC que l'UI, pas d'escalade de privilèges",
      'Tokens API limités aux utilisateurs individuels, révocables à tout moment',
    ],
  },
  audit: {
    title: "Journal d'audit",
    body:
      "Chaque modification significative est enregistrée. Qui a changé quoi, quand, avec les valeurs avant et après. Activité visible dans l'app.",
    bullets: [
      "Chronologie d'activité par entité (tâches, projets, documents, etc.)",
      "Créations, modifications et désactivations enregistrées avec l'utilisateur, l'horodatage et les valeurs avant et après",
      "Les administrateurs consultent et filtrent le journal d'audit dans l'app",
      "Les modifications faites via Plaid sont enregistrées dans le même journal, avec leur origine. Les agents ont leur propre historique d'activité, avec les sources utilisées par chaque agent",
    ],
  },
  agentGovernance: {
    title: 'Gouvernance des agents',
    body:
      "Les agents agissent sous les mêmes contrôles que tout le reste, plus des limites propres au travail autonome. Chaque action d'agent est enregistrée et limitée à ce que vous avez autorisé, et vous pouvez arrêter un agent à tout moment. Chaque agent démarre avec tous ses types d'action soumis à votre approbation. Vous décidez quand un type passe en automatique, avec le bilan de l'agent (propositions examinées, taux d'acceptation, jours d'activité) affiché à côté du choix.",
    bullets: [
      "Les agents n'agissent qu'à travers des opérations définies, sans accès direct à la base de données ni au shell",
      "Chaque agent limité aux opérations que vous autorisez. Qui peut configurer les agents ou examiner leur travail suit les mêmes rôles que le reste de l'application",
      "Chaque action d'agent enregistrée dans l'historique d'activité de l'agent, conservé 30 jours par défaut et réglable de 7 à 90 jours",
      "Les réponses portent les sources utilisées par l'agent, pour qu'une décision puisse être vérifiée",
      "Mettez n'importe quel agent en pause immédiatement, un par un ou tous à la fois",
      'Des plafonds de dépense par agent maintiennent le coût de fonctionnement borné',
      "Les fonctions d'IA sont désactivées par défaut. Dans le cloud, le modèle intégré ne reçoit aucune donnée tant que le workspace n'a pas accepté son fournisseur et son lieu de traitement, tous deux indiqués dans l'application. Un administrateur les confirme, et une nouvelle confirmation est demandée si l'un des deux change. Vous pouvez utiliser votre propre fournisseur de modèle à la place",
    ],
  },
  deployment: {
    title: 'Déploiement et exploitation',
    body:
      "Les déploiements cloud tournent sur des hôtes Linux en Allemagne, dans l'Union européenne, avec Cloudflare en frontal. Les déploiements auto-hébergés tournent où vous décidez. Les deux embarquent le même modèle de sécurité.",
    bullets: [
      "Hébergement cloud chez Hetzner Online GmbH à Nuremberg, en Allemagne (UE), avec Cloudflare en frontal pour le CDN, la terminaison TLS et la protection",
      "Auto-hébergement : le code source complet est public, et vous le construisez et l'exécutez vous-même avec Docker Compose",
      "Auto-hébergement : aucun appel sortant obligatoire pour les fonctions de base, KANAP peut donc tourner sans accès internet",
      "Auto-hébergement : vous choisissez où il tourne et comment il est sauvegardé",
      "Auto-hébergement : les fonctions d'IA n'utilisent que le fournisseur de modèle configuré par votre administrateur",
    ],
  },
  disclosure: {
    title: 'Divulgation responsable',
    body:
      "Si vous trouvez un problème de sécurité, nous voulons le savoir. Signalez-le en privé, de préférence via le signalement privé de vulnérabilités de GitHub, ou par email. Laissez-nous un délai raisonnable pour corriger, et nous vous créditerons dans l'avis sauf si vous préférez rester anonyme.",
    emailLabel: 'security@kanap.net',
    email: 'security@kanap.net',
  },
  cta: {
    title: 'Des questions sur la sécurité ?',
    body: "Nous partageons volontiers les détails d'architecture et passons en revue un modèle de menaces avec votre équipe sécurité.",
    primary: 'Parlons-en',
    secondary: 'Auto-hébergez et auditez le code',
  },
};

export default content;
