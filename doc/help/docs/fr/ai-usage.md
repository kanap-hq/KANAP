# Utilisation & coûts

Cette page répond aux deux questions qu'un administrateur se pose régulièrement : *à quel point utilisons-nous l'IA ?* et *combien cela nous coûte-t-il ?* Elle couvre l'ensemble de l'organisation (l'[assistant de chat Plaid](ai-assistant.md) et tous les [agents IA](agents-overview.md) réunis), avec des coûts valorisés à partir des prix réels que vous avez saisis sur la page [Modèles IA](ai-models.md). Les chiffres de conversations et de tokens se trouvaient auparavant en bas de la page des paramètres Plaid ; ils vivent désormais ici, à côté de l'argent.

## Où la trouver

- Espace de travail : **Administration**
- Chemin : **Administration → Intelligence artificielle → Utilisation & coûts**
- Route : `/admin/ai-usage`
- Autorisation : `ai_settings:admin`

Tout est en lecture seule sur cette page : c'est un rapport, pas un ensemble de commandes. Deux fenêtres temporelles reviennent d'un bout à l'autre : **Mois en cours** (depuis le 1er) et **30 derniers jours** (fenêtre glissante). Elles coïncident rarement, et les deux sont utiles : le mois pour les budgets, la fenêtre glissante pour repérer un changement de rythme.

---

## Coûts

Trois cartes en haut de page :

- **Total ce mois-ci** : les agents plus Plaid, avec le chiffre des 30 derniers jours en dessous.
- **Agents ce mois-ci** : ce que le parc d'agents a réellement coûté, avec le chiffre des 30 derniers jours en dessous.
- **Plaid ce mois-ci** : ce qu'a coûté l'assistant de chat. À la place d'un chiffre à 30 jours, sa légende porte les mentions décrites plus bas.

Les coûts sont affichés en euros au centime près, et à quatre décimales lorsque le montant est inférieur au centime : au début, ou avec un modèle bon marché, un vrai total peut tout à fait valoir `0,0034 €`.

**Les coûts des agents sont mesurés.** Chaque appel de modèle effectué par un agent enregistre ses tokens en entrée et en sortie, valorisés sur-le-champ aux tarifs du modèle que cet agent utilisait, et le résultat est conservé. Les tokens lus depuis le cache du fournisseur ou écrits dans ce cache suivent la règle ci-dessous, la même que pour Plaid. C'est pour cela que les prix de la page [Modèles IA](ai-models.md) comptent, qu'un modèle enregistré sans prix ne contribue à rien ici, et que modifier un prix plus tard ne réécrit pas ce que les agents ont déjà coûté. (Lorsqu'un fournisseur ne renvoie pas ses propres décomptes de tokens, KANAP les estime à partir de la taille de l'échange : une petite partie du chiffre peut donc être approximative.)

**Les coûts de Plaid sont mesurés eux aussi.** Chaque réponse de Plaid enregistre le modèle qui l'a produite, les prix de ce modèle à ce moment-là et ce que la réponse a coûté. Basculer Plaid sur un autre modèle en cours de mois ou corriger un prix plus tard ne modifie pas les réponses déjà enregistrées.

Les coûts des agents et de Plaid tiennent compte du cache de prompts du fournisseur, avec une seule règle. Un token relu depuis le cache coûte le **Coût de lecture en cache** du modèle quand il est renseigné. Sinon, il coûte 0,1 fois le prix d'entrée chez Anthropic et le plein prix d'entrée chez les autres fournisseurs : le chiffre est alors un plafond. Un token écrit dans le cache coûte 1,25 fois le prix d'entrée chez Anthropic, et le prix d'entrée ailleurs.

Les réponses enregistrées avant que KANAP ne conserve leur coût sont valorisées aux tarifs du modèle assigné à Plaid aujourd'hui. Quand le mois en contient, la carte indique *En partie estimé aux tarifs du modèle actuellement assigné*. Quand le chiffre est nul parce que le modèle assigné n'a aucun prix (entrée, sortie ou lecture en cache), elle indique *Le modèle assigné est sans coût*. Sinon, la carte n'affiche aucune mention.

Le **Modèle inclus KANAP** coûte 0 € par construction : il fait partie de votre abonnement. Une organisation qui fonctionne entièrement sur le modèle inclus ne verra que des zéros ici, et devrait plutôt surveiller le volume de messages inclus sur la page [Modèles IA](ai-models.md).

### Coût par agent et Coût par modèle

Chaque tableau apparaît en dessous dès qu'il a une ligne à afficher, avec une colonne **Mois en cours** et une colonne **30 derniers jours**. Quand seul Plaid a servi, seul **Coût par modèle** apparaît.

- **Coût par agent** : une ligne par agent, pour voir lequel coûte cher. À rapprocher du plafond **Coût par exécution (EUR)** de l'agent, dans son [onglet Paramètres](agents-workspace.md), si un chiffre vous paraît anormal.
- **Coût par modèle** : les dépenses des agents et de Plaid ensemble, découpées par modèle et triées en plaçant d'abord le plus coûteux sur 30 jours. Les lignes sont les identifiants de fournisseur et de modèle réellement appelés (`anthropic:claude-sonnet-5`, `ollama:mistral`), et non les noms lisibles que vous leur avez donnés sur la page [Modèles IA](ai-models.md). Quand les agents et Plaid utilisent le même modèle, ils partagent une ligne. Le modèle inclus KANAP y figure à 0. Une ligne intitulée **Modèle inconnu** correspond à une activité d'agent ancienne, enregistrée avant que l'attribution du modèle appel par appel n'existe.

**Coût par agent** ne porte que sur les exécutions d'agents. **Coût par modèle** laisse de côté les réponses de Plaid enregistrées avant que KANAP ne conserve leur coût : son total peut donc être inférieur à celui des cartes du haut.

---

## Conversations

Quatre cartes sans intitulé s'intercalent entre les tableaux de coûts et le tableau des tokens, toutes consacrées à l'assistant de chat :

- **Toutes les conversations** : toutes les conversations actuellement stockées. Si vous définissez une durée de **Conservation des conversations (jours)** sur la page [Paramètres Plaid](ai-settings.md), les conversations finissent par être purgées et cessent d'être comptées ici.
- **Conversations actives (7j)** et **Conversations actives (30j)** : les conversations mises à jour au cours des 7 ou 30 derniers jours.
- **Utilisateurs actifs (30j)** : le nombre de personnes distinctes ayant réellement utilisé le chat au cours des 30 derniers jours. Le chiffre d'adoption le plus honnête de la page.

---

## Utilisation des tokens

Un tableau, deux lignes (**Mois en cours** et **30 derniers jours**), avec **Tokens en entrée**, **Tokens en sortie**, **Tokens totaux** et **Messages utilisateur** (le nombre de questions posées dans la fenêtre).

**Ce tableau concerne le chat, pas les agents.** Ce sont les tokens de l'assistant Plaid : le nombre de tokens en entrée inclut ceux servis depuis le cache du fournisseur. La consommation des agents n'est pas comptée ici : elle apparaît dans **Coût par agent** et dans **Messages des agents** plus bas. Cela vaut la peine d'être gardé en tête lorsque vous fonctionnez sur le modèle inclus ou sur un modèle local, où le coût est toujours nul alors que la consommation, elle, ne l'est pas.

---

## Messages des agents (ce mois-ci)

Une carte par agent, du plus actif au moins actif. **Tous les agents** donne le total cumulé des tickets examinés ce mois-ci, puis chaque agent affiche son propre décompte, avec son chiffre des 30 derniers jours en légende. Tous vos agents figurent ici, y compris ceux qui n'ont encore rien fait : une carte restée à 0 mérite elle aussi qu'on s'y arrête. Les agents archivés sont exclus.

C'est la vue à l'échelle de l'organisation de ce que l'espace de chaque agent montre individuellement. Lisez-la en parallèle de **Coût par agent** : un agent avec beaucoup de messages et peu de coût tourne sur un modèle gratuit ou bon marché ; un agent avec peu de messages et un coût élevé fait un travail coûteux par ticket et mérite un coup d'œil.

---

## Conseils

- **Comparez les deux fenêtres, pas seulement les totaux.** *Mois en cours* paraît minuscule le 3 du mois ; c'est le chiffre glissant sur 30 jours à côté qui vous dit si quelque chose a réellement changé.
- **Des prix en entrée, des coûts en sortie.** Ces chiffres ne valent que ce que valent les prix de la page [Modèles IA](ai-models.md). Si un coût paraît anormalement bas, vérifiez que le modèle a bien des prix : un modèle sans aucun prix se lit comme gratuit.
- **Attendez-vous à un écart avec la facture de votre fournisseur.** Les chiffres utilisent les prix que vous avez saisis sur la page [Modèles IA](ai-models.md). Pour un modèle sans **Coût de lecture en cache**, les fournisseurs autres qu'Anthropic comptent les tokens en cache au plein prix d'entrée.
- **Utilisez Coût par modèle quand vous pesez un changement.** Il montre ce que chaque modèle vous coûte réellement sur vos agents et sur Plaid, et c'est ce nombre-là qu'il faut comparer avant de basculer du travail sur un modèle moins cher.
- **Un coût nul ne veut pas dire une consommation nulle.** Sur le modèle inclus ou sur un modèle local, tous les montants restent à 0 €. **Messages des agents** est l'endroit où se voit la charge des agents, et le tableau des tokens celui où se voit la charge du chat.
