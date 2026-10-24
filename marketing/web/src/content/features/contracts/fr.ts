import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Gestion des contrats IT : échéances, reconductions, budget',
    description:
      'Gestion des contrats IT open source : date limite de résiliation calculée, décision de renouvellement avant chaque échéance, engagement comparé au budget, registre de conformité.',
  },
  header: {
    eyebrow: 'Contrats',
    title: 'Ne ratez plus une date de résiliation.',
    lead: 'Saisissez la date de début, la durée et le préavis : KANAP calcule chaque terme et le dernier jour pour résilier. Le responsable a une décision à prendre avant ce jour, et le contrat reste relié à ses lignes budgétaires, ses applications et ses actifs.',
  },
  sections: [
    {
      title: 'Les contrats à décider, en premier',
      body: "La liste s'ouvre sur la prochaine échéance. Un filtre rapide montre les contrats dont la fenêtre de résiliation se ferme dans le délai de décision, quatre-vingt-dix jours par défaut. Chaque ligne dit où en est le contrat : à décider, reconduit jusqu'à une date, fin sans reconduction ou échu.",
      bullets: [
        'Triée par prochaine échéance, avec le nombre de jours restants',
        'Filtres rapides : à décider, sans ligne budgétaire, sous-budgétés',
        "Engagé, budget et écart de l'année, dans votre devise de reporting",
        'Fournisseur, société contractante, responsable, facturation',
        'Import et export CSV',
      ],
      shotAlt: "Liste des contrats triée par prochaine échéance, avec l'état, l'engagé, le budget et l'écart",
    },
    {
      title: 'Les échéances calculées pour vous',
      body: "Rien n'est saisi deux fois. À partir du début, de la durée et du préavis, la fiche du contrat dessine les termes passés, le terme en cours et le suivant, avec aujourd'hui et la date limite de résiliation sur la même ligne.",
      bullets: [
        'Termes, reconductions et date limite de résiliation calculés, jamais stockés',
        'Reconduction tacite activée ou non, avec sa propre confirmation',
        'Fin de validité pour un contrat qui s’arrête définitivement',
        'Notes et tâches de suivi sur le contrat',
        "Rappels par e-mail au responsable 30, 14, 7 et 1 jours avant l'échéance",
      ],
      shotAlt: 'Contrat de maintenance SAP avec ses termes sur une frise et la date limite de résiliation',
    },
    {
      title: "Une décision avant l'échéance",
      body: "Quand la fenêtre de décision s'ouvre, KANAP crée une tâche pour le responsable du contrat. Sur la fiche, trois réponses : renouveler, renégocier ou résilier. Avant de confirmer une résiliation, KANAP montre ce qu'elle change : la date de fin permise par le préavis, l'engagement de l'année et de la suivante, les applications et les actifs qui perdent le contrat.",
      bullets: [
        'Fenêtre de décision réglable, 90 jours par défaut',
        "Une tâche pour le responsable, avec l'e-mail d'affectation habituel",
        'Renouveler, renégocier ou résilier, avec une justification libre',
        'Les conséquences affichées avant de confirmer',
        "Une décision peut être annulée jusqu'à l'échéance",
      ],
      shotAlt: "Résiliation d'un contrat avec ses conséquences sur l'engagement et les applications",
    },
    {
      title: "L'engagement face au budget",
      body: "Un contrat engage de l'argent ; le budget le prévoit. L'onglet Budget liste les lignes OPEX et CAPEX reliées au contrat et les compare, année par année, à ce que le contrat engage. Vous voyez tout de suite si le contrat est couvert, sous-budgété ou pas budgété du tout.",
      bullets: [
        'Lignes budgétaires liées, montants par année et par colonne',
        "Engagement proratisé sur les mois couverts par chaque terme",
        'Couverture année par année : couvert, sous-budgété, aucune ligne budgétée, budget supérieur au contrat',
        'Contrats en devises converties à vos taux',
        'Visible seulement des personnes qui lisent le budget',
      ],
      shotAlt: "Onglet Budget du contrat SAP : lignes liées, engagement et couverture année par année",
    },
  ],
  more: {
    title: 'Plus dans Contrats',
    items: [
      { title: 'Registre de conformité', body: "Cinq clauses à suivre (accord de sous-traitance RGPD, localisation des données, réversibilité, plan de sortie, droit d'audit), attendues selon les applications que couvre le contrat. Un registre que vous tenez, pas une certification." },
      { title: 'Relations et contacts', body: 'Applications, actifs et technologies couverts par le contrat, contacts du fournisseur avec leur rôle, liens et fichiers joints.' },
      { title: 'Plaid et MCP', body: 'Demandez à Plaid quels contrats sont à décider dans les 90 prochains jours. Les mêmes données sont ouvertes à vos propres clients IA par le serveur MCP en lecture seule.' },
      { title: 'Droits', body: 'Les lecteurs consultent, les membres créent et décident, les administrateurs importent, exportent et suppriment. Les montants du budget suivent les droits du budget.' },
    ],
  },
  crossLinks: {
    label: 'Explorez la plateforme',
    links: [
      { label: 'Budget IT', href: '/features/budget' },
      { label: 'Cartographie IT', href: '/features/it-landscape' },
      { label: 'Incidents', href: '/features/incidents' },
      { label: "Plaid, l'agent IA intégré", href: '/features/ai' },
      { label: 'Portefeuille de projets', href: '/features/portfolio' },
    ],
  },
  cta: {
    title: 'Prêt à sortir vos contrats du tableur ?',
    body: 'Auto-hébergez gratuitement, ou essayez le cloud hébergé.',
    primary: 'Déployer gratuitement',
    secondary: 'Essayer le cloud hébergé',
  },
};

export default content;
