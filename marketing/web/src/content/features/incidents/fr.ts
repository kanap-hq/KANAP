import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: "Registre des incidents : revue, journal, preuves d'audit",
    description:
      "Registre des incidents open source pour la DSI : incidents numérotés, revue rédigée, journal que personne ne peut modifier, faits de notification RGPD et NIS2, liens vers les applications et les serveurs.",
  },
  header: {
    eyebrow: 'Incidents',
    title: 'Gardez une trace détaillée de vos incidents majeurs.',
    lead: "KANAP garde la mémoire des incidents qui comptent : ce qui s'est passé, ce que ça a touché, pourquoi, et ce que vous avez changé. Chacun a un numéro, une revue et un journal, et reste relié aux applications et aux serveurs concernés.",
  },
  sections: [
    {
      title: 'Le registre des incidents',
      body: "Chaque incident reçoit une référence permanente, INC-12, et la numérotation n'a jamais de trou : un incident annulé garde son numéro. Gravité, catégorie, responsable et dates suffisent pour commencer ; le reste vient quand vous en savez plus. Un incident passé se saisit avec ses vraies dates.",
      bullets: [
        'Quatre niveaux de gravité, catégories paramétrables',
        "Ouvert, en cours, résolu, clôturé : le statut n'avance que vers l'avant",
        'Rouvrir ou annuler un incident avec une raison obligatoire, réservé aux administrateurs du registre',
        'Recherche dans les titres, les descriptions, les applications et les serveurs liés',
        "Durée calculée une fois l'incident résolu",
      ],
      shotAlt: 'Registre des incidents avec gravité, statut, dates de détection et de résolution',
    },
    {
      title: "La revue, rédigée là où vit l'incident",
      body: "Chaque incident a sa revue : un document riche, créé depuis un modèle en cinq parties (description détaillée, impact, cause racine, actions correctives, enseignements) dans la langue de la personne qui l'écrit. Chaque enregistrement crée une version, et la revue est figée à la clôture de l'incident.",
      bullets: [
        'Modèle modifiable par vos administrateurs de la documentation',
        'Titres, listes, tableaux et images collées',
        'Versionnée, rangée dans la documentation avec sa propre référence',
        'Les droits sur les incidents suffisent pour la rédiger',
        'Le journal enregistre chaque changement, et aucune entrée ne se modifie ni ne se supprime',
      ],
      shotAlt: 'Incident clôturé avec sa description et sa revue : résumé, impact, cause racine, actions',
    },
    {
      title: "Des preuves pour l'auditeur",
      body: "Des données personnelles ont-elles été touchées ? Fallait-il notifier l'autorité, et quand l'a-t-on fait ? Qui a été informé ? L'incident enregistre ces faits avec leurs dates, et les garde : un incident qui porte des faits réglementaires ne peut pas être supprimé.",
      bullets: [
        'Données personnelles concernées, notification aux autorités requise, notifié le, parties informées',
        "Rapport PDF d'un incident, dans la langue de l'écran",
        'La clôture verrouille tout : champs, revue, journal, liens et fichiers',
        'Incidents confidentiels visibles des seuls administrateurs du registre, du déclarant et du responsable',
        "Les faits que l'article 33(5) du RGPD et NIS2 demandent de documenter",
      ],
      shotAlt: "Incident avec données personnelles concernées et autorité notifiée le 11 juillet",
    },
    {
      title: 'Relié à votre système d’information',
      body: "Reliez un incident aux serveurs, aux applications et aux technologies qu'il a touchés. Chacun affiche alors ses incidents, en lecture seule, sur sa propre fiche. Les actions de suivi deviennent des tâches qui portent la référence de l'incident, et les documents et les pièces jointes restent avec lui.",
      bullets: [
        'Actifs, applications et technologies, avec des suggestions tirées de ce qui est déjà lié',
        'Les incidents affichés sur la fiche de chaque application, serveur et technologie',
        "Tâches de suivi créées depuis l'incident",
        'Documents de la base de connaissances et pièces jointes',
        'Les liens suivent les droits de lecture de chacun',
      ],
      shotAlt: "Relations d'un incident : trois serveurs, deux applications SAP et VMware ESXi",
    },
  ],
  more: {
    title: 'Et encore',
    items: [
      { title: 'Import et export CSV', body: "Reprenez vos incidents passés depuis un tableur, revues comprises, et exportez tout le registre." },
      { title: 'Plaid et MCP', body: "Demandez à Plaid combien d'incidents majeurs ont été ouverts cette année, ou la fiche complète de l'un d'eux, journal et revue compris. Les incidents confidentiels restent exclus. Les mêmes données sont ouvertes à vos clients IA par le serveur MCP en lecture seule." },
      { title: 'Notes antidatées', body: "Les notes du journal portent l'heure de l'événement. L'heure de leur enregistrement est gardée à part et ne se modifie pas." },
      { title: 'Droits', body: 'Les lecteurs consultent, les contributeurs créent et rédigent, les administrateurs du registre rouvrent, annulent, suppriment et lèvent une restriction.' },
    ],
  },
  crossLinks: {
    label: 'Explorez la plateforme',
    links: [
      { label: 'Cartographie IT', href: '/features/it-landscape' },
      { label: 'Contrats', href: '/features/contracts' },
      { label: 'Documentation', href: '/features/knowledge' },
      { label: "Plaid, l'agent IA intégré", href: '/features/ai' },
      { label: 'Agent helpdesk', href: '/features/agents' },
    ],
  },
  cta: {
    title: 'Prêt à déployer un registre des incidents riche et auditable ?',
    body: 'Auto-hébergez gratuitement, ou essayez le cloud hébergé.',
    primary: 'Déployer gratuitement',
    secondary: 'Essayer le cloud hébergé',
  },
};

export default content;
