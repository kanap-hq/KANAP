import type { FaqContent } from './types';

const content: FaqContent = {
  meta: {
    title: 'FAQ',
    description:
      "Questions fréquentes sur les tarifs, la licence, l'auto-hébergement, le cloud hébergé, Kad, les agents, le support et la facturation Kadratis.",
  },
  header: {
    eyebrow: 'FAQ',
    title: 'Questions fréquentes.',
    lead:
      'Tout ce que vous devez savoir sur Kadratis, licence, tarifs, hébergement, Kad et les agents. Si vous ne trouvez pas votre réponse, écrivez-nous.',
  },
  groups: [
    {
      label: 'Licence et open source',
      items: [
        {
          q: 'Sous quelle licence est Kadratis ?',
          a: 'Kadratis est publié sous licence <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener" target="_blank">AGPL v3</a>, une licence open source largement reconnue et approuvée par l\'OSI. Vous pouvez librement utiliser, modifier et distribuer le logiciel. La clause copyleft de l\'AGPL garantit que quiconque exécute une version modifiée en tant que service doit partager ses changements. Cela protège la communauté et maintient Kadratis réellement ouvert.',
        },
        {
          q: 'Puis-je utiliser Kadratis commercialement ?',
          a: 'Oui. Usage interne, commercial, SaaS externe, tout est permis. La clause copyleft n\'oblige à partager vos modifications que si vous exécutez une version modifiée comme service réseau. Un usage purement interne ne déclenche aucune obligation.',
        },
        {
          q: 'Puis-je contribuer à Kadratis ?',
          a: 'Oui, avec plaisir. Tout le code source est sur <a href="https://github.com/kanap-hq/kanap" rel="noopener" target="_blank">GitHub</a>. Issues, pull requests et discussions sont les bienvenues. Consultez CONTRIBUTING.md pour les conventions.',
        },
      ],
    },
    {
      label: 'Cloud et essai',
      items: [
        {
          q: 'Comment fonctionne l\'essai gratuit ?',
          a: "Kadratis Cloud commence par un essai gratuit de 14 jours, sans carte bancaire, avec toutes les fonctionnalités. Vous démarrez avec des données d'exemple ou avec un espace vide ; trois parcours guidés vous font découvrir le budget, la cartographie et les projets, et Kad peut vous aider à importer vos données. Vous pouvez aussi planifier depuis votre espace un appel découverte de trente minutes.",
        },
        {
          q: 'Que se passe-t-il à la fin de mon essai ?',
          a: "À la fin de l'essai, votre espace de travail passe en lecture seule : vos données restent consultables et exportables pendant trente jours. Un abonnement souscrit depuis la page Facturation de l'espace le réactive, avec tout ce que vous avez saisi. Sans abonnement, l'espace est supprimé définitivement, avec toutes ses données, trente jours après la fin de l'essai.",
        },
        {
          q: "Qu'est-ce que l'appel découverte ?",
          a: "Un appel de trente minutes en visioconférence, gratuit et sans engagement, à planifier quand vous le voulez depuis votre espace d'essai. Nous regardons votre situation, vos objectifs et ce que Kadratis peut y apporter.",
        },
        {
          q: 'Quelle est la différence entre cloud et auto-hébergé ?',
          a: 'L\'hébergement cloud signifie que nous opérons tout pour vous : hébergement, mises à jour, sauvegardes, infrastructure et support prioritaire. L\'auto-hébergement signifie que vous exécutez Kadratis sur vos propres serveurs. Le produit complet est gratuit à auto-héberger ; vous pouvez acheter le Support auto-hébergé si vous voulez une aide prioritaire tout en gardant le contrôle de votre infrastructure.',
        },
      ],
    },
    {
      label: 'Auto-hébergement et support',
      items: [
        {
          q: 'Qu\'est-ce que le Support auto-hébergé ?',
          a: 'Le Support auto-hébergé est un module de support professionnel pour les installations auto-hébergées. Il inclut le support email prioritaire, l\'aide au diagnostic pour l\'installation et les mises à niveau, et un tarif de conseil réduit (900 € la journée au lieu de 1 150 €). Tarifé à 2 490 €/an.',
        },
        {
          q: 'Comment fonctionne le support prioritaire ?',
          a: 'Pour les abonnés payants, écrivez-nous à support@kadratis.com pour tout problème opérationnel. Nous visons une réponse sous 24h et la résolution de votre problème. C\'est en meilleur effort, sans SLA, mais nous sommes de vrais humains qui lisent et répondent à chaque message.',
        },
      ],
    },
    {
      label: 'Facturation',
      items: [
        {
          q: 'Puis-je payer par facture ?',
          a: 'Le paiement par facture (virement bancaire) est disponible pour les abonnements annuels au-dessus de 1 000 € pour les clients EUR. Aujourd\'hui cela concerne le Support auto-hébergé et Kadratis Cloud en annuel. Les factures sont à NET30.',
        },
        {
          q: 'Puis-je passer de l\'auto-hébergement au cloud hébergé ?',
          a: 'Oui. Kadratis est le même produit dans les deux modes. Contactez-nous si vous voulez passer de l\'auto-hébergement au cloud hébergé, ou si vous avez besoin d\'un export pour opérer la plateforme vous-même.',
        },
        {
          q: 'Puis-je annuler mon abonnement ?',
          a: "Bien sûr. Annulez à tout moment depuis la page Facturation de votre espace : votre abonnement reste actif jusqu'à la fin de la période de facturation en cours, sans questions.",
        },
      ],
    },
    {
      label: 'Kad (assistant IA)',
      items: [
        {
          q: 'Quelle est la différence entre les messages Kad inclus et Bring Your Own Key ?',
          a: 'Kadratis Cloud inclut 1 500 messages Kad par mois, avec un modèle que nous avons choisi et testé avec Kadratis. Pour des réponses encore plus performantes, l\'option Bring Your Own Key vous permet de connecter les modèles de pointe d\'OpenAI, Anthropic ou de tout fournisseur compatible. BYOK vous laisse aussi choisir le fournisseur qui traite vos requêtes, et supprime toute limite de messages.',
        },
        {
          q: 'Comment puis-je contrôler Kad ?',
          a: 'Au niveau de l\'espace de travail, un administrateur active ou désactive Kad, et la recherche web et MCP s\'activent ou se désactivent séparément. Au niveau utilisateur, les permissions par rôle décident qui peut utiliser Kad et quels modules il peut lire. Faire une modification demande le niveau membre sur Kad et sur le module, et chaque modification est présentée en aperçu que l\'utilisateur confirme. L\'accès MCP est en lecture seule. Le RBAC est toujours appliqué, Kad ne voit jamais plus que ce qui est permis à l\'utilisateur.',
        },
        {
          q: 'Comment connecter Claude ou un autre assistant IA à Kadratis ?',
          a: 'Par le serveur MCP de Kadratis, en lecture seule, de deux façons. Claude, Claude Desktop et Claude Code se connectent sans clé : collez votre adresse Kadratis comme connecteur personnalisé, connectez-vous avec votre compte Kadratis et cliquez sur Autoriser. Chaque personne lit alors avec ses propres droits. Les autres assistants, comme Cursor ou vos scripts, utilisent une clé API créée par un administrateur. Sur une installation auto-hébergée, la connexion sans clé depuis Claude et Claude Desktop demande que Kadratis soit joignable depuis Internet en HTTPS. Claude Code et les clés API fonctionnent aussi sur un réseau interne.',
        },
      ],
    },
    {
      label: 'Agents (automatisation IA)',
      items: [
        {
          q: 'Les agents sont-ils autonomes ?',
          a: "Oui, par conception. Un agent démarre supervisé : il propose des actions et vous les passez en revue. À mesure que Kadratis mesure la fréquence à laquelle il voit juste, vous lui accordez plus d'autonomie, jusqu'à ce qu'il traite le travail courant seul et ne remonte que ce qui exige une personne. Vous décidez jusqu'où cela va.",
        },
        {
          q: "Comment contrôler ce qu'un agent peut faire ?",
          a: "Vous définissez le niveau d'autonomie de chaque agent et le limitez aux opérations que vous autorisez. Les agents n'agissent qu'à travers des opérations définies, sans accès direct à la base de données ni au shell. Chaque action est enregistrée, vous pouvez mettre n'importe quel agent en pause immédiatement, et vous pouvez plafonner ce qu'un agent dépense pour le LLM.",
        },
        {
          q: 'Puis-je confier un vrai travail à un agent ?',
          a: "C'est précisément le rôle des contrôles. Un agent raisonne sur vos propres données IT plutôt que de deviner, cite les sources qu'il a utilisées et enregistre chaque action dans son historique d'activité. Il gagne en autonomie en faisant ses preuves sur des tâches réelles, et vous pouvez l'arrêter à tout moment.",
        },
        {
          q: "Avec quels outils les agents travaillent-ils aujourd'hui ?",
          a: "Aujourd'hui, un centre de services. Un agent autonome traite un vrai centre de services en production, ce qui valide le modèle. Le runtime est conçu pour piloter d'autres systèmes, supervision, virtualisation, annuaires et plus encore, chacun derrière un connecteur.",
        },
        {
          q: 'Puis-je écrire mon propre agent ou connecteur ?',
          a: "Oui. Le code est ouvert, et le raisonnement d'un agent est tenu séparé de la façon dont il dialogue avec un outil donné. Vous pouvez écrire un connecteur pour le système dont vous avez besoin, ou modifier le fonctionnement d'un agent, puisque vous disposez de tout le code source. Si vous préférez que nous construisions un connecteur, contactez-nous.",
        },
        {
          q: 'Les agents sont-ils inclus dans la version open source gratuite ?',
          a: "Oui. Les agents font partie du produit open source sous AGPL v3, sans verrou fonctionnel sur l'IA. Vous apportez votre propre clé LLM, comme avec Kad. Auto-hébergez toute la plateforme gratuitement, agents compris.",
        },
        {
          q: "Combien coûte l'exécution des agents ?",
          a: "Les agents utilisent un LLM, vous apportez donc votre propre clé et payez votre fournisseur pour ce qu'ils consomment. Kadratis en lui-même est gratuit à auto-héberger. Vous gardez le coût prévisible avec un plafond de dépense par agent.",
        },
        {
          q: 'Les actions des agents restent-elles sur mes propres serveurs ?',
          a: "Sur un déploiement auto-hébergé, oui. Le moteur des agents et leurs actions se déroulent au sein de votre propre déploiement. Le seul contenu de tickets et de documents qui en sort est ce que l'agent envoie au fournisseur LLM que vous choisissez, et rien si vous faites tourner le modèle sur vos propres serveurs. Si vous activez la recherche web, de courtes requêtes partent vers le fournisseur de recherche, sans les références d'éléments, les identifiants ni les adresses e-mail.",
        },
      ],
    },
  ],
  cta: {
    title: 'Encore des questions ?',
    body: 'Écrivez-nous, nous lisons chaque message.',
    primary: 'Nous contacter',
    secondary: 'Essai gratuit',
  },
};

export default content;
