# Modèles IA

Cette page est la liste des modèles IA que votre organisation est autorisée à utiliser. Vous ajoutez un modèle une fois — son fournisseur, son adresse, sa clé, ses prix — et il ne vous reste plus ensuite qu'à l'*assigner* : à l'[assistant de chat Plaid](ai-settings.md), à un [agent IA](agents-workspace.md) en particulier, ou comme modèle par défaut de l'organisation vers lequel tout le reste se rabat. C'est aussi d'ici que viennent les montants affichés sur la page [Utilisation & coûts](ai-usage.md) : les prix que vous saisissez ici sont ceux que KANAP applique à la consommation réelle de tokens.

## Où la trouver

- Espace de travail : **Administration**
- Chemin : **Administration → Intelligence artificielle → Modèles IA**
- Route : `/admin/ai-models`
- Autorisation : `ai_settings:admin`

---

## Comment un modèle est choisi

Rien dans KANAP n'est figé sur un seul modèle. Chaque consommateur — Plaid et chaque agent — pointe soit vers un modèle précis, soit dit « utilise ce que l'organisation utilise ». La règle est courte :

1. **Le modèle assigné à ce consommateur**, s'il y en a un.
2. Sinon, **le modèle par défaut de l'organisation** — celui marqué d'une étoile sur cette page.
3. Sinon, **le modèle inclus KANAP**, une fois qu'un administrateur a confirmé son fournisseur et son lieu de traitement.

Il y a donc exactement un modèle par défaut par organisation, et tout ce que vous ne touchez jamais le suit. Changez le modèle par défaut et tous les consommateurs non assignés changent avec lui — c'est tout l'intérêt d'en avoir un.

La troisième étape n'existe que sur le service hébergé de KANAP. Sur une installation on-premise, il n'y a pas de modèle inclus : si rien n'est assigné et qu'aucun modèle par défaut n'est défini, la chaîne s'arrête simplement là. La page des paramètres Plaid signale alors qu'aucun modèle n'est configuré et le chat ne répond pas, tandis que les agents continuent de tourner mais sautent les étapes qui nécessitent un modèle — ils se replient sur leur comportement non-IA plutôt que d'échouer complètement. Enregistrer un modèle suffit à corriger cela : marquez-le d'une étoile comme modèle par défaut pour que tout le monde le reprenne d'un coup, ou assignez-le consommateur par consommateur.

Sur le service hébergé, la troisième étape a une condition. Plaid et les agents qui utiliseraient le modèle inclus attendent qu'un administrateur en confirme le fournisseur, et la page des paramètres Plaid ainsi que la page des agents l'indiquent. Un modèle que vous ajoutez n'a jamais besoin de confirmation. Voir [Confirmer le modèle inclus KANAP](ai-settings.md#confirmer-le-modele-inclus-kanap).

Vous ne pouvez pas rompre cette chaîne en faisant le ménage dans la liste : un modèle vers lequel quelque chose pointe encore ne peut de toute façon pas être archivé et, si une assignation venait malgré tout à pointer vers un modèle archivé, le consommateur se rabat sur le modèle par défaut au lieu d'échouer.

---

## Utiliser la liste

Le tableau présente tous les modèles enregistrés par votre organisation, les actifs d'abord et les archivés en dessous, par ordre alphabétique au sein de chaque groupe.

**Colonnes** :

- **Par défaut** — une étoile sur chaque ligne active. L'étoile pleine désigne le modèle par défaut de l'organisation. Cliquez sur une étoile vide pour y déplacer le défaut ; cliquez sur l'étoile pleine d'un de vos propres modèles pour l'effacer. Un seul modèle peut être le modèle par défaut : en marquer un nouveau retire l'étoile du précédent. Les modèles archivés n'ont pas d'étoile.
- **Nom** — le nom que vous avez donné au modèle, accompagné de **Archivé** s'il a été retiré. La mention **Configuration incomplète** apparaît ici lorsqu'il manque un élément obligatoire — le plus souvent un modèle qui exige une clé API et n'en a pas. Corrigez-le : un modèle incomplet ne se rabat pas discrètement sur un autre, il ne fonctionne tout simplement pas.
- **Modèle** — le fournisseur sur la première ligne, l'identifiant exact du modèle en dessous.
- **Capacités** — **Images ✓** si le modèle sait lire les images, **Texte seul** sinon. Cela vient du commutateur **Comprend les images** de l'éditeur.
- **Prix entrée / M tokens** et **Prix sortie / M tokens** — ce que vous payez par million de tokens, en euros. Un tiret (**—**) signifie qu'aucun prix n'est enregistré, ce que KANAP traite comme gratuit.
- **Utilisation** — pour un modèle que vous avez ajouté, le nombre de messages qu'il a traités ce mois civil : les messages utilisateur Plaid des conversations qui ont utilisé ce fournisseur et ce modèle, plus un décompte par exécution d'agent qui a enregistré ce modèle. **0 message ce mois-ci** signifie qu'il n'y a pas encore de trafic, pas que le modèle n'est pas le défaut. Le modèle inclus KANAP conserve son propre affichage : le volume mensuel de messages inclus avec une barre de progression, pas ce décompte.

**Actions de ligne** (modèles actifs uniquement) :

- **Modifier** — ouvre la boîte de dialogue d'édition.
- **Archiver** — retire le modèle du service. Le bouton est désactivé tant que quelque chose l'utilise encore, et l'infobulle le dit : *Ce modèle est encore assigné et ne peut pas être archivé*.

Les lignes archivées sont grisées et n'offrent qu'une seule action, **Restaurer**. Archiver n'est délibérément pas supprimer : l'utilisation passée reste attribuée au modèle sur la page [Utilisation & coûts](ai-usage.md), et un modèle restauré revient avec son fournisseur, sa clé, ses prix et ses capacités intacts — mais il n'est plus le modèle par défaut et n'est plus assigné à quoi que ce soit, de sorte que vous le réassignez délibérément. Un modèle archivé ne peut être ni modifié, ni désigné comme modèle par défaut, ni assigné tant que vous ne l'avez pas restauré.

### Le modèle inclus KANAP

Sur le service hébergé, la première ligne du tableau est toujours **Modèle inclus KANAP** — *Opéré par KANAP, inclus dans votre abonnement*. Elle se comporte différemment des modèles que vous ajoutez, et c'est voulu :

- Il coûte `0,00 €` dans les deux colonnes de prix. Il fait partie de votre abonnement, ce n'est pas quelque chose qui vous est facturé au token.
- Il est **multimodal** — il lit les captures d'écran des tickets — et vous ne pouvez pas changer cela.
- Dans la colonne **Utilisation**, il affiche vos **messages inclus ce mois-ci** avec une barre de progression, pour que vous voyiez ce qu'il reste du volume mensuel. Un message correspond à une question posée à Plaid, à une requête d'un assistant externe connecté via MCP, ou à un ticket examiné par un agent — les trois puisent dans le même volume. Cette barre est le quota du modèle inclus ; ce n'est pas le même chiffre que les décomptes de messages des modèles que vous ajoutez.
- Il affiche une étoile pleine dans la colonne **Par défaut** dès qu'aucun de vos propres modèles actifs n'est marqué d'une étoile — c'est le repli « rien n'est configuré » rendu visible. Cliquez sur son étoile vide pour effacer votre défaut actuel et y revenir. Vous ne pouvez toujours ni le modifier ni l'archiver.
- Il n'a pas d'actions de modification ni d'archivage : celles-ci appartiennent aux modèles que vous ajoutez. Il est simplement toujours là.
- Plaid et les agents ne l'utilisent qu'après la confirmation, par un administrateur, du fournisseur et du lieu de traitement des données, sur la page [Paramètres Plaid](ai-settings.md#confirmer-le-modele-inclus-kanap). Les modèles que vous ajoutez ne sont pas soumis à cette étape.

Sur une installation on-premise, cette ligne n'apparaît pas du tout.

---

## Ajouter ou modifier un modèle

**Nouveau modèle** ouvre l'éditeur ; le crayon de n'importe quelle ligne active le rouvre pour une entrée existante. Les champs :

- **Nom** — la façon dont le modèle apparaît partout où vous l'assignez : dans le sélecteur de Plaid et dans la liste **Modèle IA** de chaque agent. Choisissez quelque chose que vous reconnaîtrez dans une liste déroulante dans six mois (*Claude production*, *Mistral local*), pas l'identifiant brut du modèle. Notez que le tableau **Coût par modèle** de la page [Utilisation & coûts](ai-usage.md) n'utilise *pas* ce nom : il liste l'identifiant réellement appelé, par exemple `anthropic:claude-sonnet-5`.
- **Fournisseur** — qui sert le modèle. Ce choix détermine lesquels des champs suivants s'appliquent.
- **Modèle** — l'identifiant exact du modèle, tel que le fournisseur l'écrit (par exemple `claude-sonnet-5`). Ce n'est pas un nom d'affichage ; une faute de frappe ici se traduit par un appel en échec, pas par une erreur de validation.
- **Adresse du serveur** — uniquement pour les fournisseurs que vous hébergez ou que vous voulez pointer vers une adresse précise. Lorsque KANAP tourne dans Docker et que le modèle tourne sur la même machine hôte, adressez l'hôte plutôt que `localhost`.
- **Clé API** — l'identifiant fourni par votre fournisseur. Elle est stockée chiffrée et n'est plus jamais affichée : lorsque vous rouvrez un modèle existant, le champ affiche un masque (`••••••••`) avec l'indication *Laissez vide pour conserver la clé actuelle*, vous n'y saisissez donc quelque chose que pour remplacer la clé. Si aucun secret de chiffrement n'est configuré sur l'instance, un avertissement en haut de la page explique que les clés ne peuvent pas être enregistrées du tout.

**Capacités** :

- **Comprend les images** — désactivez-le pour un modèle texte seul. L'explication se trouve dans l'infobulle d'information à côté de **Capacités** : les captures d'écran jointes aux tickets sont alors *ignorées* au lieu d'être envoyées, et c'est bien ce que vous voulez — un modèle texte seul qui reçoit une image provoque un appel en échec au lieu de faire un travail utile. Laissez-le activé pour un modèle capable de vision, et vos agents de tri utiliseront les captures d'écran des tickets comme preuves.

**Coût d'entrée** et **Coût de sortie** — l'infobulle d'information à côté de chaque libellé explique *Prix par million de tokens, tel qu'affiché sur la page tarifs de votre fournisseur* :

- Recopiez les deux nombres directement depuis la page tarifs de votre fournisseur. Ils sont généralement différents, et KANAP les applique séparément.
- **Laissez les deux champs vides ou à 0 pour un modèle local ou auto-hébergé.** Un modèle sans prix ne coûte rien, ce qui correspond à la réalité d'un modèle qui tourne sur votre propre matériel. Choisir un fournisseur Ollama pré-remplit les deux prix à 0 pour exactement cette raison.
- Les coûts des agents sont valorisés au fil du travail puis conservés : modifier un prix change donc ce que coûtent les agents **à partir de maintenant** et laisse les chiffres passés inchangés. Le coût de Plaid est calculé autrement — voir [Utilisation & coûts](ai-usage.md) — et un changement de prix, lui, déplace bien ses chiffres historiques.

**Délai d'attente** — combien de temps attendre ce modèle, en secondes, avant d'abandonner. L'explication se trouve dans l'infobulle d'information à côté du libellé : laissez le champ vide pour utiliser la limite standard. Les modèles locaux ont souvent besoin de plus de temps, d'où un réglage par modèle plutôt que par installation. Pour faire de ce modèle le modèle par défaut de l'organisation, marquez-le d'une étoile dans la colonne **Par défaut** de la liste après l'enregistrement — ce choix n'est pas dans l'éditeur.

**Tester la connexion** apparaît une fois le modèle enregistré. Ce bouton effectue un tout petit appel avec les paramètres tels qu'ils sont enregistrés et renvoie soit *Connexion réussie* avec le temps d'aller-retour, soit le message d'erreur du fournisseur lui-même. Il prouve que le fournisseur, l'identifiant du modèle, l'adresse et la clé fonctionnent ensemble — il ne vérifie ni vos prix, ni le commutateur des images, ni le réglage du temps de réponse. Lancez-le après avoir ajouté un modèle et après chaque rotation de clé : une clé erronée reste sinon invisible jusqu'à ce qu'un vrai travail échoue, et elle échoue en silence (une réponse de chat en erreur, ou un agent qui saute une étape et poursuit).

**Créer** / **Enregistrer** restent désactivés tant que le nom et l'identifiant du modèle ne sont pas renseignés et que les prix et le temps de réponse ne sont pas des nombres valides. Les noms doivent être uniques au sein de votre organisation.

---

## Conseils

- **Définissez un modèle par défaut avant d'assigner quoi que ce soit.** Avec un modèle marqué d'une étoile, chaque nouvel agent et Plaid lui-même fonctionnent immédiatement, et vous disposez d'un seul endroit où changer de modèle plus tard.
- **Nommez les modèles par rôle, pas par version.** *Modèle de tri* survit au passage d'une version de modèle à la suivante ; *Claude Sonnet 4.5* devient un mensonge le jour où vous le modifiez.
- **Enregistrez deux fois le même fournisseur quand les usages diffèrent.** Un modèle texte seul bon marché pour le tri à gros volume et un modèle vision pour les tickets riches en captures d'écran est une configuration normale — c'est précisément pour cela que l'assignation se fait par agent.
- **Saisissez les bons prix, ou laissez-les vides.** Ce ne sont pas des décorations : ils alimentent les montants de la page [Utilisation & coûts](ai-usage.md) et les plafonds **Coût par exécution** de chaque agent. Un modèle à 0 n'atteint jamais un plafond de coût : sur un modèle gratuit, les plafonds de tokens sont votre seule protection.
- **Vérifiez le bouton d'archivage avant de retirer un modèle.** Il reste désactivé tant que Plaid ou un agent est *épinglé* à ce modèle (et non simplement rabattu dessus comme défaut). Déplacez d'abord ces épingles.
- **Testez après chaque rotation de clé.** Le test de connexion est gratuit et instantané ; découvrir une clé périmée à travers une exécution d'agent en échec ne l'est ni l'un, ni l'autre.
