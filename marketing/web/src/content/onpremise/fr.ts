import type { OnPremContent } from './types';

const content: OnPremContent = {
  meta: {
    title: 'Auto-héberger KANAP, l\'approche prioritaire',
    description:
      'Exécutez KANAP sur votre infrastructure, sous AGPL v3. Plateforme complète incluant les agents IA, utilisateurs illimités, et vous décidez où vont vos données. Déploiement en quelques minutes avec Docker Compose.',
  },

  header: {
    eyebrow: 'Auto-hébergement · approche prioritaire',
    title: 'Hébergez KANAP vous-même.\nMaîtrisez chaque couche.',
    lead: 'Open source sous AGPL v3. Déployez sur votre infrastructure, gardez vos données, mettez à jour à votre rythme. La plateforme complète, utilisateurs illimités, toutes les fonctionnalités, selon vos conditions.',
    primaryCta: 'Déployer depuis GitHub',
    primaryHref: 'https://github.com/kanap-hq/kanap',
    secondaryCta: 'Lire la doc d\'installation',
    secondaryHref: 'https://doc.kanap.net/on-premise/',
  },

  why: {
    eyebrow: 'Pourquoi s\'auto-héberger',
    title: 'Contrôle, conformité, aucune contrepartie.',
    intro:
      'S\'auto-héberger KANAP n\'est pas un palier dégradé. C\'est la plateforme complète, avec toutes les fonctionnalités, gratuitement. Voici les raisons pour lesquelles les équipes la choisissent en premier.',
    pillars: [
      {
        title: 'Vos données restent à la maison',
        body: "Budgets, contrats fournisseurs, paysage IT, tout. Sur vos serveurs, dans votre réseau. Aucun sous-traitant à qui confier vos données de gouvernance, hormis les services que vous choisissez de connecter, comme un fournisseur de modèle IA ou un relais email. Le moteur des agents et leurs actions s'y exécutent aussi, ce qui compte quand un auditeur pose la question.",
      },
      {
        title: 'Prêt pour la conformité',
        body: 'Row-level security isole les tenants. Hash de mot de passe Argon2. Un journal d\'audit des connexions et des exports que votre collecteur de journaux lit en CSV. HTTPS avec des certificats que vous maîtrisez. Votre VPC, vos sauvegardes, votre SOC.',
      },
      {
        title: 'Compatible air-gap',
        body: 'Déploiement Docker Compose en réseau restreint. Vous construisez les images depuis le code source public, et une fois construites, elles ne font aucun appel sortant obligatoire pour les fonctions centrales.',
      },
      {
        title: 'Votre cadence',
        body: 'Épinglez la version que vous exécutez, testez une mise à jour, migrez selon votre calendrier de changements. Aucune mise à jour forcée, aucune coupure surprise.',
      },
    ],
  },

  license: {
    title: 'AGPL v3 : l\'ouverture sans compromis',
    body:
      'KANAP est publiée sous licence GNU Affero General Public License v3. Toutes les libertés open source classiques : l\'utiliser, la lire, la modifier, la distribuer. Le copyleft garantit que quiconque exécute une version modifiée en tant que service doit partager ses changements, c\'est ainsi que le projet reste réellement ouvert.',
    bullets: [
      'Usage commercial, interne ou externe, aucune redevance, aucun décompte de sièges',
      'Lecture et audit du code complet, rien de caché',
      'Modification et extension, le code vous appartient',
      'Contribution, vos améliorations profitent à toute la communauté',
    ],
    linkLabel: 'Lire la licence AGPL v3',
    linkHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },

  deploy: {
    eyebrow: 'Installation en quelques minutes',
    title: 'Une seule invite.\nQuinze minutes.',
    intro:
      "Un agent IA de codage lit notre documentation, installe toutes les dépendances et configure toute la pile (Docker, PostgreSQL 16, MinIO, nginx, Let's Encrypt) sur un serveur Ubuntu vierge. Vous collez une invite, vous validez chaque étape, vous vous connectez.",
    steps: [
      {
        title: 'Préparer un serveur vierge',
        body: 'Un serveur Ubuntu 24.04 LTS fraîchement provisionné avec accès sudo, un enregistrement DNS A pointant votre nom de domaine vers ce serveur, et un accès Internet sortant pour les paquets et Let\'s Encrypt. Installez votre agent IA de codage sur le serveur (Claude Code, Codex, ou équivalent).',
      },
      {
        title: 'Activer temporairement sudo sans mot de passe',
        body: 'Pour que l\'agent ne vous demande pas votre mot de passe à chaque étape. Vous reviendrez en arrière à la fin.',
        code: 'echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/90-install-nopasswd',
      },
      {
        title: 'Coller l\'invite d\'installation',
        body: "Ouvrez votre agent et collez le modèle d'invite depuis notre documentation, renseignez votre nom de domaine, votre email admin et (en option) votre transport email (Resend ou SMTP). L'agent lit les pages d'installation référencées, installe Docker, PostgreSQL 16 avec les extensions requises, MinIO, nginx et certbot, clone KANAP dans /opt/kanap, génère des identifiants robustes, construit les images et démarre les conteneurs. Il configure aussi TLS et son renouvellement automatique. L'agent demande votre confirmation avant chaque commande.",
      },
      {
        title: 'Se connecter et durcir',
        body: 'Connectez-vous à votre nom de domaine avec les identifiants admin générés, changez le mot de passe, puis retirez l\'entrée sudo sans mot de passe temporaire. Terminé. Le journal d\'installation complet est sauvegardé dans ~/kanap-install.md.',
      },
    ],
    docsCtaLabel: 'Guide d\'installation assistée par IA',
    docsHref: 'https://doc.kanap.net/on-premise/installation-ai/',
    manualOption: {
      label: 'Vous préférez tout maîtriser ?',
      title: 'Installation manuelle : votre stack, à votre main.',
      body: 'Apportez votre PostgreSQL, votre stockage compatible S3 et votre reverse proxy. Hébergez-la sur n\'importe quel Linux compatible Docker. Intégrez KANAP dans l\'architecture que vous opérez déjà, avec la configuration qui correspond à votre environnement. Même plateforme, même code, chaque décision entre vos mains.',
      ctaLabel: 'Guide d\'installation manuelle',
      ctaHref: 'https://doc.kanap.net/on-premise/installation/',
    },
  },

  requirements: {
    title: 'Ce qu\'il vous faut',
    intro: 'Exigences modestes pour une plateforme qui pilote toute la DSI.',
    items: [
      { label: 'OS', value: 'Tout Linux avec Docker (Ubuntu 22+, Debian 12+, RHEL 9+ recommandés)' },
      { label: 'CPU', value: '2 vCPU minimum · 4+ recommandés pour 50+ utilisateurs' },
      { label: 'RAM', value: '6 Go minimum · 8 Go recommandés' },
      { label: 'Stockage', value: '20 Go pour la plateforme + la croissance de vos données, plus un stockage objet compatible S3' },
      { label: 'Base de données', value: 'PostgreSQL 16+ avec citext, pgcrypto et uuid-ossp (à fournir)' },
      { label: 'Réseau', value: 'Terminateur HTTPS de votre choix, nginx, Traefik, LB cloud' },
      { label: 'Sortant (optionnel)', value: 'API de taux de change (World Bank, exchangerate-api.com) · fournisseur LLM pour Plaid et les agents · Microsoft Entra pour le SSO · Resend ou votre relais SMTP pour l\'email · fournisseur de recherche web, si activé' },
    ],
  },

  operations: {
    title: 'Opérer KANAP',
    intro: 'Conçue pour s\'opérer comme n\'importe quel service interne.',
    items: [
      {
        title: 'Mises à jour à votre rythme',
        body: 'Épinglez la version que vous exécutez, testez la mise à jour en pré-prod, appliquez-la dans votre fenêtre de changement. Migrations au boot, idempotentes par conception.',
      },
      {
        title: 'Des sauvegardes avec vos propres outils',
        body: 'PostgreSQL et stockage de fichiers standard. Sauvegardez-les avec le pipeline que vous exploitez déjà.',
      },
      {
        title: 'L\'observabilité que vous avez déjà',
        body: 'Les conteneurs écrivent leurs logs sur stdout (plafonnés à environ 50 Mo chacun) et affichent leur santé dans docker ps. L\'API expose un endpoint de santé. Pointez votre stack existant dessus (Prometheus, Loki, Datadog, ce que vous avez déjà).',
      },
      {
        title: 'Branding inclus',
        body: 'Téléchargez votre logo, réglez votre couleur primaire. La page admin de branding fonctionne en auto-hébergé comme en cloud.',
      },
      {
        title: 'SSO via Entra ID',
        body: "Le SSO entreprise fait partie de la plateforme. Ajoutez l'enregistrement d'application Entra à la configuration, puis connectez-le depuis la console admin.",
      },
      {
        title: 'Plaid et agents, à votre façon',
        body: "Apportez votre propre clé LLM pour Plaid comme pour vos agents, OpenAI, Anthropic, Ollama, ou tout endpoint compatible OpenAI. Le moteur des agents et leurs actions s'exécutent au sein de votre propre déploiement. Le seul contenu qui en sort est ce que vous envoyez au fournisseur que vous avez choisi, plus de courtes requêtes de recherche web si vous activez la recherche web.",
      },
    ],
  },

  support: {
    title: 'Besoin d\'aide prioritaire ?',
    body:
      'Le plan Support auto-hébergé ajoute le support email prioritaire, l\'aide à l\'installation et 20 % de remise sur le conseil, sans changer votre mode de déploiement.',
    bullets: [
      'Support email prioritaire (de vrais humains, réponse meilleur effort)',
      'Aide à l\'installation et aux mises à niveau',
      '20 % de remise sur tous les services de conseil',
      '2 490 €/an, facturation annuelle',
    ],
    ctaLabel: 'Voir les tarifs',
    ctaHref: '/offer',
  },

  cta: {
    title: 'Prêt à auto-héberger ?',
    body: 'Clonez le dépôt et lancez la pile en moins de dix minutes. Pas de compte requis, pas de compte à rebours, juste de l\'open source.',
    primary: 'Déployer depuis GitHub',
    secondary: 'Nous contacter',
  },
};

export default content;
