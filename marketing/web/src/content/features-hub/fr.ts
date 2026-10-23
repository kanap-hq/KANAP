import type { FeaturesHubContent } from '../features/types';

const content: FeaturesHubContent = {
  meta: {
    title: 'Comment les DSI utilisent vraiment KANAP',
    description:
      "Six scénarios vécus par celles et ceux qui font tourner l'IT au quotidien, du DSI au support jusqu'au responsable des opérations IT. Voyez comment les modules se combinent, et comment les agents prennent désormais en charge la charge répétitive.",
  },
  header: {
    eyebrow: 'Par rôle',
    title: 'Comment les DSI utilisent vraiment KANAP.',
    lead: "Six scénarios issus de ceux qui font tourner l'IT au quotidien. Ils s'appuient sur un seul référentiel, le travaillent via Plaid en langage naturel, et confient désormais les parties répétitives à un agent. Voyez comment les modules se combinent, au-delà de ce que chacun fait séparément.",
  },
  modulesUsedLabel: 'Modules combinés',
  personas: [
    {
      role: 'DSI / directeur IT',
      headline: 'Défendez le budget IT en comité de direction.',
      body:
        "Votre directeur financier demande pourquoi les coûts IT ont augmenté de 12 %. Vous arrivez avec les chiffres : un rapport de refacturation par société et département, OPEX et CAPEX côte à côte, par dimension analytique, la tendance pluriannuelle. Chaque ligne remonte à un contrat ou un projet. Pas de gymnastique Excel, pas de « je vous reviens ».",
      outcome: 'Arrivez à la revue de budget avec les réponses.',
      modules: [
        { slug: 'budget', label: 'Budget' },
        { slug: 'it-landscape', label: 'Cartographie IT' },
      ],
      shotAlt: 'Top 10 des lignes OPEX du budget 2026, en camembert',
    },
    {
      role: "Architecte d'entreprise",
      headline: 'Planifiez une migration sans mauvaises surprises.',
      body:
        "Vous retirez le CRM historique. Avant d'engager des dates, il faut savoir ce qui en dépend : quelles interfaces, quelles applications en aval, quels projets l'utilisent déjà. La carte des interfaces montre le graphe de dépendances d'un coup d'œil. Votre plan de migration liste chaque propriétaire d'interface à contacter, chaque projet à mettre dans la boucle. La connaissance attache les décisions aux applications qu'elles décrivent. Votre successeur saura pourquoi.",
      outcome: 'Migrez les yeux ouverts plutôt que les doigts croisés.',
      modules: [
        { slug: 'it-landscape', label: 'Cartographie IT' },
        { slug: 'knowledge', label: 'Connaissance' },
        { slug: 'portfolio', label: 'Portefeuille' },
      ],
      shotAlt: 'Carte des interfaces montrant les dépendances du CRM en cours de retrait',
    },
    {
      role: 'PMO / chef de projet IT',
      headline: 'Faites la planification trimestrielle avec des chiffres de capacité.',
      body:
        "Vingt demandes entrantes, huit équipes, un trimestre. Scorez chaque demande sur des critères pondérés, puis générez une feuille de route consciente de la capacité. Les goulots sont visibles avant l'engagement. Les dates ne sont pas du vœu pieux. C'est de l'arithmétique. En comité de pilotage, vous expliquez pourquoi ce projet tombe en T3 et non en T1 : la capacité de l'équipe plateforme.",
      outcome: 'Engagez-vous sur des dates que vous pouvez vraiment défendre.',
      modules: [
        { slug: 'portfolio', label: 'Portefeuille' },
        { slug: 'budget', label: 'Budget' },
      ],
      shotAlt: 'Feuille de route consciente de la capacité avec heatmap des goulots',
    },
    {
      role: 'Opérations IT / support',
      headline: 'Trouvez la cause racine en secondes, pas en heures.',
      body:
        "La gestion de commandes en production est lente. Vous demandez à Plaid : « Quelles applications consomment l'API order-management ? » Cinq secondes plus tard, une liste. « Lesquelles ont été mises à jour cette semaine ? » Une seule. « Qui en est responsable ? » Email et Teams. Du symptôme au responsable sans ouvrir cinq outils. Les tickets de premier niveau qui reviennent chaque semaine partent maintenant à un agent, pour que votre équipe ne prenne en charge que ce qui exige une personne.",
      outcome: "Résolvez les incidents depuis un seul endroit, pendant qu'un agent traite les tickets répétitifs.",
      modules: [
        { slug: 'it-landscape', label: 'Cartographie IT' },
        { slug: 'knowledge', label: 'Connaissance' },
        { slug: 'ai', label: 'Plaid' },
        { slug: 'agents', label: 'Agents' },
      ],
      shotAlt: "Plaid répondant à une enquête d'incident avec des résultats structurés",
    },
    {
      role: 'Lead IT / responsable infrastructure',
      headline: "Identifiez ce qu'il faut arrêter, renouveler, consolider.",
      body:
        "Combien de SaaS payons-nous ? Lesquels se chevauchent ? Qui est le propriétaire quand il faut renégocier ? Chaque application porte sa ligne OPEX, son contrat, sa date de renouvellement, sa classification de données. Triez par coût, par chevauchement, par usage. Discutez avec la finance, les faits sous les yeux.",
      outcome: "Arrêtez de renouveler ce que personne n'utilise.",
      modules: [
        { slug: 'it-landscape', label: 'Cartographie IT' },
        { slug: 'budget', label: 'Budget' },
        { slug: 'knowledge', label: 'Connaissance' },
      ],
      shotAlt: "Portefeuille d'applications trié par coût OPEX avec dates de renouvellement",
    },
    {
      role: 'Responsable des opérations IT',
      headline: 'Confiez les tickets répétitifs à un agent.',
      body:
        "Votre file de premier niveau est pleine des mêmes demandes chaque semaine : réinitialisations d'accès, incidents récurrents, tri de routine. Un agent prend chacune en charge, la lit au regard de vos données IT, et propose ou exécute la correction selon l'autonomie que vous définissez. Il travaille supervisé au début et gagne en indépendance à mesure que son bilan tient. Vos équipes cessent de passer leurs journées sur la charge répétitive.",
      outcome: "Votre équipe consacre son temps aux problèmes difficiles pendant que l'agent traite les tâches de routine.",
      modules: [
        { slug: 'agents', label: 'Agents' },
        { slug: 'it-landscape', label: 'Cartographie IT' },
        { slug: 'knowledge', label: 'Connaissance' },
      ],
      shotAlt: 'Un agent traitant une file de tickets de premier niveau',
    },
  ],
  cta: {
    title: 'Prêt à voir votre rôle sur la plateforme ?',
    body:
      'Auto-hébergez gratuitement, ou essayez le cloud hébergé.\nToutes les fonctionnalités sur chaque plan, cloud comme auto-hébergement.',
    primary: 'Déployer gratuitement',
    secondary: 'Essayer le cloud hébergé',
  },
};

export default content;
