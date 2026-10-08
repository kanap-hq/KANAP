import type { OfferContent } from './types';

const content: OfferContent = {
  meta: {
    title: 'Tarifs',
    description:
      'Gratuit et open source. Auto-hébergement sans limite, support si vous en avez besoin, ou KANAP hébergé. Toutes les fonctionnalités sur tous les plans, agents inclus. AGPL v3.',
  },

  header: {
    eyebrow: 'Tarifs simples et transparents',
    title: 'Gratuit et open source.\nAuto-hébergez, ou laissez-nous la gérer.',
    lead: 'Toutes les fonctionnalités sur chaque plan. Aucune option verrouillée, aucune taxe par siège, aucun enfermement. Vous payez uniquement l\'exploitation et le support que vous ne voulez pas assurer vous-même.',
  },

  selfHosted: {
    eyebrow: 'Choisissez votre chemin',
    title: 'Même produit.\nTrois façons de l\'exécuter.',
    intro:
      'Démarrez avec la plateforme open source complète. Ajoutez le support de production quand la souveraineté compte, ou choisissez KANAP hébergé si vous voulez nous confier l\'exploitation.',
    plans: [
      {
        name: 'Auto-hébergement',
        badge: 'Open source · gratuit à vie',
        target: 'Utilisateurs illimités · workspaces illimités',
        price: '0 €',
        period: '',
        features: [
          'Toutes les fonctionnalités, sans plafond',
          "Plaid et agents inclus, sans verrou fonctionnel sur l'IA",
          'Apportez votre propre clé LLM pour Plaid et les agents',
          'Vos données restent sur votre infrastructure',
          'Déploiement Docker Compose en quelques minutes',
          'Open source sous licence AGPL v3',
          'Support communautaire via GitHub issues',
        ],
        ctaLabel: 'Déployer depuis GitHub',
        ctaHref: 'https://github.com/kanap-hq/kanap',
        ctaVariant: 'primary',
        note: "Plaid et les agents utilisent un LLM, vous apportez donc votre propre clé et payez votre fournisseur pour l'usage. Plafonnez la dépense par agent pour garder un coût de fonctionnement prévisible.",
      },
      {
        name: 'Support auto-hébergé',
        badge: 'On-prem avec support de production',
        target: 'Utilisateurs illimités · workspaces illimités',
        price: '2 490 €',
        period: '/an',
        subPrice: 'Facturation annuelle',
        features: [
          'Tout ce qui est inclus en auto-hébergement',
          'Vos données restent sur votre infrastructure',
          'Support email prioritaire',
          'Assistance installation et mises à jour',
          'Ligne directe avec l\'équipe pour les incidents de production',
          'Session de cadrage 60 min avec un expert KANAP',
          'Conseil à 900 € la journée au lieu de 1 150 €',
        ],
        ctaLabel: 'Souscrire',
        ctaHref: '#support-invoice',
        ctaVariant: 'primary',
      },
    ],
  },

  openSourceBanner: {
    title: 'Véritablement open source, AGPL v3',
    body:
      'Tout le code source de KANAP est sur GitHub. Lisez-le, auditez-le, étendez-le, contribuez. L\'AGPL v3 garantit que le code reste ouvert, pour tout le monde. Pas de fork propriétaire, pas d\'enfermement.',
    linkLabel: 'Lire la licence',
    linkHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },

  cloud: {
    eyebrow: 'Hébergement cloud · si vous préférez nous confier l\'exploitation',
    title: 'La même plateforme, opérée par nous.',
    intro:
      'KANAP hébergé, c\'est la même plateforme open source, opérée par nous : hébergement, mises à jour, sauvegardes, support prioritaire et session de cadrage de 60 min. Essai 14 jours, sans carte.',
    plans: [
      {
        name: 'KANAP hébergé',
        badge: 'Entièrement managé',
        target: 'Utilisateurs illimités · workspaces illimités',
        price: '249 €',
        period: '/mois',
        subPrice: 'ou 2 490 €/an (2 mois offerts)',
        features: [
          'Tout ce qui est inclus en auto-hébergement',
          'Nous hébergeons, mettons à jour et sauvegardons KANAP pour vous',
          'Hébergement UE pour les équipes européennes',
          '2 500 messages Plaid/mois inclus, ou votre propre clé en illimité',
          'Agents inclus, sur les messages inclus ou avec votre propre clé LLM',
          'Session de cadrage 60 min avec un expert KANAP',
          'Support email prioritaire',
          'Conseil à 900 € la journée au lieu de 1 150 €',
        ],
        ctaLabel: 'Essai gratuit',
        ctaHref: '/trial/start',
        ctaVariant: 'primary',
      },
    ],
  },

  howToChoose: {
    title: 'Comment choisir',
    intro: 'Choisissez selon qui opère la plateforme. Toutes les fonctionnalités produit sont dans chaque plan.',
    items: [
      {
        title: 'Auto-hébergement · gratuit',
        body: 'Vous avez les ressources IT et voulez le contrôle complet. Le meilleur rapport, sans contrepartie. Support communautaire.',
      },
      {
        title: 'Auto-hébergement · avec support',
        body: 'Vous avez besoin du mode auto-hébergé pour la souveraineté, la conformité ou la confidentialité, mais vous voulez un support de production et une ligne directe en cas de problème.',
      },
      {
        title: 'Hébergement cloud',
        body: 'Vous voulez le chemin le plus court vers la valeur sans opérer l\'infrastructure. Même produit, opéré par KANAP.',
      },
    ],
  },

  services: {
    title: 'Aide experte, quand vous en voulez',
    intro: 'KANAP est conçu pour une adoption autonome. Si vous voulez aller plus vite, les offres payantes incluent le support prioritaire et un tarif de conseil réduit.',
    support: {
      title: 'Support prioritaire',
      subtitle: 'Inclus avec tout plan payant',
      body: 'On maintient le service opérationnel. De vrais humains, des délais raisonnables, pas de théâtre SLA.',
      items: [
        'Bugs, erreurs, incidents, problèmes d\'accès',
        'Aide à l\'installation auto-hébergée',
        'Questions « est-ce le comportement attendu ? »',
        'Clarifications rapides',
      ],
    },
    consulting: {
      title: 'Conseil',
      subtitle: 'Payant · facturé à la journée',
      body: 'Aide optionnelle pour tirer plus de valeur de KANAP : appels programmés, travail approfondi, advisory. Tarif : 1 150 € la journée, 900 € pour les clients sous contrat de support ou d\'hébergement, hors TVA.',
      items: [
        'Installation, configuration, onboarding, formation',
        'Conception de workflows et bonnes pratiques',
        'Advisory CIO sur votre modèle de gouvernance IT',
        'Tout ce qui nécessite un appel programmé',
      ],
    },
  },

  pilot: {
    title: 'Pilote accompagné',
    subtitle: '2 900 € forfait · hors TVA',
    body: 'Un engagement qui lance votre équipe sur KANAP : nous l\'installons avec vous, importons vos données, formons vos équipes et laissons votre premier agent au travail.',
    items: [
      'Installation sur vos serveurs, ou mise en place hébergée',
      'Nous vous aidons à importer vos premières données clés',
      'Formation et onboarding de votre équipe',
      'Votre premier agent configuré',
    ],
    ctaLabel: 'Parlez-nous',
    ctaHref: '/contact',
    note: 'Nous le cadrons ensemble lors d\'un appel de 30 minutes.',
  },

  supportInvoice: {
    title: 'Demander votre facture',
    eyebrow: 'Support auto-hébergé',
    body:
      'Nous créerons votre facture annuelle de Support auto-hébergé et l’enverrons à votre email de facturation. Après paiement, vous accédez aux services de support professionnel.',
    companyLabel: 'Nom de l’entreprise',
    contactLabel: 'Nom du contact',
    billingEmailLabel: 'Email de facturation',
    countryLabel: 'Pays',
    optionalSummary: 'Informations de facturation optionnelles',
    vatLabel: 'N° TVA',
    address1Label: 'Adresse ligne 1',
    address2Label: 'Adresse ligne 2',
    cityLabel: 'Ville',
    postalCodeLabel: 'Code postal',
    captchaLabel: 'Vérification de sécurité',
    submitLabel: 'Demander la facture',
    submittingLabel: 'Préparation de la demande de facture...',
    successWithLink: 'Demande de facture envoyée. Nous l’avons envoyée à votre email de facturation.',
    successLinkLabel: 'Ouvrir la facture',
    successNoLink: 'Demande de facture envoyée. Vérifiez votre email de facturation.',
    errorGeneric: 'Impossible d’envoyer la demande de facture. Réessayez ou contactez support@kanap.net.',
    errorRequired: 'Veuillez remplir tous les champs obligatoires.',
    closeLabel: 'Fermer le formulaire',
  },

  faqTeaser: {
    title: 'Questions fréquentes',
    body: 'Licence, auto-hébergement, cloud, Plaid, support et facturation. Toutes nos réponses.',
    ctaLabel: 'Lire la FAQ',
  },

  cta: {
    title: 'Prêt à démarrer ?',
    body:
      'Déployez KANAP vous-même gratuitement, ou essayez la version hébergée si vous voulez nous confier l\'exploitation.',
    primary: 'Déployer gratuitement',
    secondary: 'Essayer le cloud hébergé',
  },
};

export default content;
