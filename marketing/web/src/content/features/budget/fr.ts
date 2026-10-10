import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Budget IT : atterrissage, budget N+1, refacturation',
    description:
      "Budget IT open source : OPEX et CAPEX, atterrissage et budget N+1, refacturation, consolidation, coût par ETP, chaque ligne reliée à vos applications.",
  },
  header: {
    eyebrow: 'Budget IT',
    title: "Le budget IT, de l'atterrissage au budget N+1, relié à vos applications.",
    lead: "OPEX et CAPEX sur plusieurs années, atterrissage et budget N+1, refacturation aux sociétés et aux départements, effectifs et coût par ETP. Chaque ligne est reliée à ses applications, ses contrats et ses projets : on sait ce que l'on paie, et pourquoi.",
  },
  sections: [
    {
      title: "De l'atterrissage au budget N+1",
      body: "Les colonnes standard (budget, révision, réalisé, atterrissage) se renomment et se masquent selon vos usages, de N-2 à N+2, en saisie annuelle ou mensuelle. Fiabilisez l'atterrissage ligne par ligne, copiez-le vers le budget de l'année suivante, puis gelez la version validée.",
      bullets: [
        'OPEX et CAPEX dans des listes dédiées',
        'Colonnes budget, révision, réalisé et atterrissage, renommables',
        'Montants en quantité × prix, ou répartis par mois',
        'Copie de colonnes avec essai à blanc, puis copie',
        'Gel des versions : la version validée ne bouge plus',
      ],
      shotAlt: 'Liste OPEX avec les montants 2026 et la ligne de totaux',
    },
    {
      title: 'Une refacturation que chacun comprend',
      body: "Répartissez chaque ligne entre les sociétés et les départements qui en profitent, avec six méthodes de ventilation. Les pourcentages se recalculent quand les effectifs ou le chiffre d'affaires changent, et chaque ventilation reste lisible ligne par ligne.",
      bullets: [
        'Au prorata des effectifs (par défaut)',
        'Au prorata des utilisateurs IT ou du chiffre d’affaires',
        'Sélection manuelle de sociétés ou de départements',
        'Pourcentages saisis à la main',
        'Une méthode par année et par ligne',
      ],
      shotAlt: 'Ventilation d’une ligne de budget entre quatre sociétés, à l’effectif',
    },
    {
      title: 'Multi-sociétés, multi-devises, consolidation',
      body: "Chaque ligne garde sa devise, et tout se consolide dans une devise de reporting. Les taux viennent de la Banque mondiale et se figent au gel du budget. Plan de comptes et plan de consolidation : vous retrouvez vos chiffres dans la structure de la direction financière.",
      bullets: [
        'Devise de reporting unique pour tous les totaux',
        'Taux de change automatiques, figés au gel',
        'Liste des devises autorisées',
        'Plans de comptes par pays et plan de consolidation',
        'Centres de coûts et responsables budgétaires',
      ],
      shotAlt: 'Paramètres de devises : devise de reporting, devises autorisées et taux de change',
    },
    {
      title: 'Des rapports pour chaque question',
      body: "Refacturation globale et par société, tendances, plus fortes hausses et baisses, comparaison de deux versions, dimensions analytiques, comptes de consolidation, effectifs par mois et coût par ETP. Chaque ligne d'un rapport ouvre la liste filtrée correspondante, et Plaid répond aux mêmes questions en langage naturel.",
      bullets: [
        'Refacturation globale et par société',
        'Comparaison de colonnes et tendances OPEX et CAPEX',
        'Dimensions analytiques et comptes de consolidation',
        'Effectifs par mois, coût par ETP et taux journalier',
        'Export CSV et images des graphiques',
      ],
      shotAlt: 'Top 10 des postes OPEX du budget 2026, en camembert',
    },
  ],
  more: {
    title: 'Et aussi',
    items: [
      { title: 'Relié aux applications et aux projets', body: "Chaque dépense mène à ses applications, ses projets et ses fournisseurs. La fiche d'une application montre ce qu'elle coûte." },
      { title: 'Contrats et échéances', body: 'Montant annuel, reconduction tacite, préavis et date limite de résiliation calculée, liés aux lignes de budget.' },
      { title: 'Aller-retour avec le tableur', body: "Exportez les lignes, modifiez-les dans Excel ou LibreOffice, réimportez : KANAP n'écrit que les cellules qui ont changé." },
      { title: 'Données d’exemple', body: 'Un essai se remplit en une minute avec le budget de Fromage & Co, quatre sociétés fictives, pour tout voir avant de saisir le vôtre.' },
      { title: 'Effectifs et coût par ETP', body: 'Une ligne de régie en personnes ou en jours déclare ses ETP. Les rapports en tirent les effectifs mois par mois et le coût par ETP, ou le TJM, par fournisseur ou par centre de coûts.' },
      { title: 'Vos propres axes d’analyse', body: 'Créez autant de dimensions analytiques que vos questions en demandent (domaine, nature de coût, programme), chacune avec ses valeurs, pour l’OPEX, le CAPEX ou les deux. Les rapports budgétaires se filtrent dessus, et plusieurs regroupent par dimension.' },
    ],
  },
  crossLinks: {
    label: 'Explorez la plateforme',
    links: [
      { label: 'Cartographie', href: '/features/it-landscape' },
      { label: 'Portefeuille de projets', href: '/features/portfolio' },
      { label: 'Documentation', href: '/features/knowledge' },
      { label: "Plaid, l'agent IA intégré", href: '/features/ai' },
      { label: 'Agent helpdesk', href: '/features/agents' },
    ],
  },
  cta: {
    title: 'Essayez KANAP sur un budget IT complet.',
    body: "Essayez la version hébergée avec des données d'exemple, ou déployez KANAP gratuitement chez vous.",
    primary: 'Déployer gratuitement',
    secondary: "Essayer avec des données d'exemple",
  },
};

export default content;
