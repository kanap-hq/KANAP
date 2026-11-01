# Administration budgétaire

L'administration budgétaire met à votre disposition un ensemble d'outils pour gérer et transformer les données budgétaires entre les années et les colonnes. Ce sont les opérations que vous utilisez pendant les cycles de planification budgétaire : préparer les chiffres de l'année suivante, verrouiller les budgets approuvés et gérer les transitions d'une année à l'autre.

## Où trouver cette page

- Chemin : **Gestion budgétaire > Administration**
- Autorisations : chaque carte s'affiche uniquement pour les utilisateurs qui peuvent l'utiliser (voir le tableau ci-dessous). **Administration** apparaît dans le menu dès que vous pouvez utiliser au moins une carte.

La page d'accueil comporte deux sections. Chaque carte renvoie à un outil dédié. Une section vide est masquée.

**Paramètres**

| Outil | Objectif |
|-------|----------|
| **Devises** | Définir les devises de reporting et par défaut, et consulter les taux de change. Voir [Paramètres de devises](currencies.md) |
| **Colonnes budgétaires** | Nommer les cinq colonnes budgétaires, choisir celles qui sont affichées et la colonne par défaut |
| **Méthode de ventilation par défaut** | Définir la méthode que les lignes OPEX et CAPEX suivent par défaut |

**Opérations**

| Outil | Objectif |
|-------|----------|
| **Geler / dégeler les données** | Verrouiller les colonnes budgétaires pour empêcher les modifications |
| **Copier les colonnes budgétaires** | Copier les montants entre années et colonnes, avec un pourcentage facultatif, et les ventilations vers une autre année |
| **Réinitialiser une colonne budgétaire** | Effacer toutes les données d'une colonne spécifique |
| **Geler les données de référence** | Verrouiller les indicateurs des sociétés et des départements pour une année. Voir [Geler les données de référence et copier les indicateurs annuels](master-data-operations.md) |
| **Copier les indicateurs annuels** | Copier les indicateurs des sociétés et des départements d'une année à l'autre. Voir [Geler les données de référence et copier les indicateurs annuels](master-data-operations.md) |

| Cartes | Qui les voit |
|---|---|
| Devises, Colonnes budgétaires, Méthode de ventilation par défaut, Geler / dégeler les données | Administration budgétaire au niveau administrateur (`budget_ops:admin`) |
| Copier les colonnes budgétaires, Réinitialiser une colonne budgétaire | Budget au niveau administrateur (`budget:admin`). Les onglets **Tout**, **OPEX** et **CAPEX** s'ouvrent tous avec ce niveau |
| Geler les données de référence, Copier les indicateurs annuels | Utilisateurs ayant accès au budget qui sont administrateurs de l'administration budgétaire, des sociétés ou des départements. Les administrateurs des sociétés et des départements agissent sur leur propre périmètre |

Le rôle intégré Administrateur budget voit toutes les cartes. Membre budget et Lecteur budget n'en voient aucune : **Administration** ne figure donc pas dans leur menu.

Les colonnes budgétaires sont Budget, Révision, Prévision, Réalisé et Atterrissage prévu. Ce sont les noms standard. Votre organisation peut les renommer, en masquer certaines et choisir une colonne par défaut dans [Colonnes budgétaires](#colonnes-budgetaires). Chaque page ci-dessous affiche les noms choisis par votre organisation.

Tant qu'une de ces opérations est en cours, les lignes budgétaires ne peuvent pas être enregistrés : une modification affiche le message « Une autre opération sur le budget est en cours. Réessayez quand elle sera terminée. » jusqu'à la fin de l'opération.

---

## Geler / dégeler les données

Verrouillez les colonnes budgétaires pour qu'elles ne puissent être ni modifiées, ni importées, ni altérées de quelque manière que ce soit. Le gel protège les chiffres approuvés contre les modifications accidentelles.

### Quand l'utiliser

- Après l'approbation du budget annuel
- Lors de la clôture d'une période fiscale
- Pour protéger le réalisé contre toute modification

### Comment ça fonctionne

La page affiche une année à la fois. Choisissez-la avec les onglets d'année en haut, de l'année dernière à quatre ans plus tard.

Sous les onglets, un tableau a une ligne par colonne budgétaire et une colonne par type, **OPEX** et **CAPEX**. Les colonnes masquées y figurent aussi, avec la mention **Masquée**. Chaque cellule affiche l'état de cette colonne pour ce type, **Ouvert** ou **Gelé**, avec un cadenas :

- Cliquez sur une cellule pour la basculer. Un clic gèle ou dégèle cette colonne pour ce type
- L'action en bout de ligne agit sur les deux types à la fois. Elle affiche **Geler les deux** tant que l'une des deux cellules est ouverte, et gèle celle qui est ouverte. Une fois les deux gelées, elle affiche **Dégeler les deux**
- Une cellule reste désactivée pendant l'enregistrement de son changement. Les onglets d'année attendent la fin de chaque changement

Sans le niveau Admin sur l'administration budgétaire, la page affiche les états en lecture seule, avec le message « Vous devez disposer des droits d'administrateur budgétaire pour utiliser cette page. »

### Ce que fait le gel

- Empêche les modifications des colonnes gelées dans l'espace de travail des lignes de ce type. Les champs affichent un cadenas
- Bloque les imports vers les colonnes gelées
- Bloque les opérations de copie et de réinitialisation ciblant les colonnes gelées
- Refuse de supprimer une ligne, ou de changer son type, tant qu'elle a des montants dans une colonne gelée des années concernées
- N'affecte **pas** l'accès en lecture : les données restent visibles
- S'applique aussi aux colonnes masquées. Une colonne gelée reste gelée quand elle est masquée, et les imports vers elle restent refusés

### Cadenas dans la liste

La ligne **Total** unique de [la liste des lignes budgétaires](budget-lines.md#travailler-avec-la-liste) affiche un cadenas devant le total d'une colonne gelée. Il suit le gel de chaque type que contient la liste. Si la liste est filtrée sur un type, le cadenas s'affiche quand ce type est gelé. Si elle contient les deux types, il s'affiche quand la colonne est gelée pour les deux. Survolez l'icône pour lire **Gelé**.

### Geler la colonne par défaut fige les taux de change

Geler la [colonne par défaut](#colonnes-budgetaires) pour une année fige aussi les taux de change de cette année pour le type que vous gelez. KANAP actualise les taux de l'année, puis conserve le dernier jeu de taux pour chaque montant OPEX ou CAPEX de cette année. Les rapports convertissent ensuite ces montants avec les mêmes taux, même quand des taux plus récents arrivent. Si la devise de reporting change ensuite, ces montants gardent les taux du gel, puis sont convertis dans la nouvelle devise de reporting au taux de l'ancienne pour la même année. Sans ce taux, ils sont exclus des totaux et signalés comme tout taux manquant. Voir [Années gelées](currencies.md#annees-gelees). Dégeler la colonne par défaut les libère.

Geler une autre colonne ne touche pas aux taux. Changer ensuite de colonne par défaut ne fige ni ne libère rien à lui seul : les taux suivent le prochain gel ou dégel de la nouvelle colonne par défaut. **Geler les deux** ne gèle que la cellule ouverte : un type dont la colonne par défaut est déjà gelée garde les taux qu'il a figés.

### Autorisations

Geler et dégeler nécessitent `budget_ops:admin`. La carte est masquée pour les autres utilisateurs.

---

## Copier les colonnes budgétaires

Copiez les montants d'une colonne vers une autre année ou une autre colonne, avec un pourcentage facultatif, et les ventilations d'une année vers une autre année. C'est l'outil principal pour alimenter le budget de l'année suivante à partir de l'année en cours.

Les onglets **Tout** / **OPEX** / **CAPEX** en haut de la page choisissent les lignes budgétaires sur lesquelles la copie s'applique. **Tout**, l'onglet par défaut, copie ensemble les lignes OPEX et CAPEX.

Nécessite le niveau Admin sur Budget (`budget:admin`).

### Quand l'utiliser

- Préparer le budget de l'année suivante, montants et ventilations, à partir de l'année en cours
- Créer une révision à partir du budget approuvé
- Reporter des projections avec un facteur d'inflation

### Champs

| Champ | Description |
|-------|-------------|
| **Année source** | Année à copier (plage : année en cours moins un à année en cours plus cinq). Démarre sur l'année en cours |
| **Année de destination** | Année vers laquelle copier (même plage). Démarre sur l'année suivante |
| **À copier** | **Montants**, **Ventilations**, ou les deux. **Ventilations** est proposé lorsque les deux années diffèrent, et coché au départ. Survolez chaque case pour lire ce qu'elle copie |
| **Colonne source** | Avec **Montants** : toute colonne affichée, Prévision comprise quand elle est affichée. Démarre sur la colonne par défaut |
| **Colonne de destination** | Avec **Montants** : toute colonne affichée. Démarre sur la colonne par défaut |
| **Augmentation en pourcentage** | Avec **Montants** : ajustement appliqué à chaque mois copié (ex. : `3` = +3 %). Pour une colonne calculée à partir de ses lignes, il augmente à la place le prix unitaire de chaque ligne. Voir [Copier une colonne construite à partir de lignes](#copier-une-colonne-construite-a-partir-de-lignes). Par défaut 0. Accepte les décimales et les valeurs négatives. Un pourcentage de -100 % ou moins est refusé |
| **Écraser les données existantes** | Un interrupteur pour les deux parties. Désactivé : une colonne de destination qui porte déjà des montants les garde, et une ventilation saisie à la main dans l'année de destination est gardée. Activé : les deux sont remplacées |

Les colonnes masquées ne sont pas proposées. Lorsque rien n'est coché sous **À copier**, la page indique « Choisissez quoi copier : les montants, les ventilations ou les deux. »

### Deux étapes : Aperçu, puis Copier

1. Cliquez sur **Aperçu** pour voir ce que la copie fait sur chaque ligne, sans modifier aucune donnée
2. Relisez le tableau, une ligne par ligne budgétaire :
   - **Ligne** : le nom de la ligne, un lien qui l'ouvre dans un nouvel onglet pour que l'aperçu reste en place. Les lignes marquées **Au prorata** commencent ou finissent pendant l'année de destination et ne reçoivent que les mois de leur validité. Les lignes marquées **Calendrier** changent de calendrier (voir plus bas)
   - **Type de ligne** : **OPEX** ou **CAPEX**, dans l'onglet **Tout**
   - Pour les montants : la colonne source, la colonne de destination actuelle, la colonne de destination après la copie, et le statut des montants
   - Pour les ventilations : la ventilation source, la ventilation de destination actuelle, la ventilation après la copie, et le statut des ventilations
3. Lorsque le résultat vous convient, cliquez sur **Copier** pour l'appliquer

**Copier** n'est activé qu'après un aperçu. Modifier un champ efface l'aperçu : relancez-le. Après la copie, le tableau reste affiché sous le titre **Résultat**, avec ce que chaque ligne a fait.

**Exporter le tableau** (icône de téléchargement) télécharge l'aperçu des champs à l'écran dans un fichier CSV ou Excel, une ligne par ligne budgétaire, avec les colonnes et les statuts du tableau. Après la copie, l'export est désactivé : le tableau montre alors ce que la copie a fait, ce qu'un aperçu ne décrit plus. Les montants du fichier gardent leurs centimes.

Chaque partie a son propre statut sur chaque ligne :

| Statut | Signification |
|---|---|
| **À copier** / **Copié** | La partie est copiée, ou l'a été |
| **Remplace Effectif** / **A remplacé Effectif** | La ventilation de l'année de destination suit une autre méthode, que la ventilation copiée remplace |
| **Non valide en 2027** | La ligne n'est pas valide l'année de destination. Elle est exclue |
| **Ignoré : rien en 2026** | La ligne n'a pas de budget l'année source |
| **Ignoré : la colonne source est vide** | La colonne source n'a aucun montant |
| **Ignoré : la destination a des montants** | La colonne de destination a déjà des montants, et **Écraser les données existantes** est désactivé |
| **Ignoré : aucune ventilation saisie en 2026** | La ligne n'a aucune ventilation à copier l'année source |
| **Ignoré : 2027 a une ventilation saisie à la main** | L'année de destination a une ventilation saisie à la main, et **Écraser les données existantes** est désactivé |
| **Erreur** | Les règles de ventilation de la ligne refusent la copie, avec la raison. **Copier** reste désactivé tant qu'une ligne est en erreur |

### Résumé

Au-dessus du tableau, une bannière résume l'aperçu, par exemple « 136 lignes dans l'aperçu. 6 lignes non valides en 2027 sont laissées de côté. Montants : 120 à copier, 10 ignorés. Ventilations : 124 à copier, 6 ignorées. » Le nombre de lignes est celui du tableau. Les lignes non valides l'année de destination y figurent, et les comptes des montants et des ventilations les laissent de côté. Après la copie, elle indique « Copie terminée. » avec les mêmes comptes.

Des avertissements s'affichent lorsqu'ils s'appliquent :

- Les lignes dont la colonne de destination a déjà un montant, et qui seront ignorées sans **Écraser les données existantes**
- Les lignes qui gardent une ventilation saisie à la main dans l'année de destination, sans **Écraser les données existantes**
- Les lignes dont la méthode de ventilation change dans l'année de destination. Sans **Écraser les données existantes**, la copie ne garde que les ventilations saisies à la main : une ligne qui suit une méthode, sans répartition saisie à la main, prend la méthode de l'année source
- Les lignes laissées en ventilation par défaut, lorsque le défaut de l'année de destination diffère de celui de l'année source. Les lignes copiées continuent de suivre le défaut de leur propre année. Configurez-le dans [Méthode de ventilation par défaut](#methode-de-ventilation-par-defaut) si la base doit rester identique

Sous le tableau, les totaux indiquent le nombre de lignes, les montants à copier, le total source, le total actuel de destination et le total après la copie, et les ventilations à copier.

### Comment les montants sont copiés

- Cette partie décrit les colonnes dont les montants sont saisis, répartis ou copiés, ainsi que les mois des lignes de référence. Une colonne calculée à partir de ses lignes suit [ses propres règles](#copier-une-colonne-construite-a-partir-de-lignes)
- La copie conserve la répartition mensuelle. Chacun des douze mois est copié vers le même mois de la destination : une colonne répartie d'avril à décembre reste répartie d'avril à décembre
- Seules les lignes budgétaires valides l'année de destination sont copiées. Une ligne compte pour les mois dont le 15 tombe entre son **Début d'effet** et sa **Fin de validité**. Une ligne sans aucun de ces mois est exclue, car l'onglet Budget ne l'affiche pas non plus
- Une ligne valide une partie de l'année de destination ne reçoit que ces mois. Les autres mois gardent leur montant, et la période est ramenée aux dates de la ligne. Par exemple, une source sur douze mois copiée vers une ligne qui se termine le 30 juin donne janvier à juin
- Sans pourcentage, les montants sont copiés à l'identique, au centime près
- Avec un pourcentage, chaque mois est arrondi à l'unité, et le total annuel reste le total source auquel on applique le pourcentage, arrondi à l'unité. Les unités laissées par l'arrondi vont aux mois qui ont perdu les plus grandes fractions, le mois le plus tardif d'abord en cas d'égalité. Aucun mois ne change de signe. Par exemple, 12 000 répartis d'avril à décembre (1 333,33 par mois et 1 333,36 en décembre) copiés avec +2 % donnent 1 360 par mois et 12 240 pour l'année
- La période de la colonne suit la copie : avril à décembre 2026 devient avril à décembre 2027. Une période qui se termine le 29 février se termine le 28 février dans une année non bissextile
- Une source sans période donne une période couvrant toute l'année
- Dans l'onglet Budget, la colonne de destination affiche « Copié depuis Budget 2026 +2 % »
- La copie d'une colonne sur elle-même (même année et même colonne) est refusée
- La copie se fait en tout ou rien : si une ligne échoue, rien n'est enregistré, ni montants ni ventilations

### Copier une colonne construite à partir de lignes

Une colonne peut être construite à partir de lignes, chacune étant une quantité multipliée par un prix unitaire. Voir [Quantité et prix](budget-lines.md#quantite-et-prix). La copie traite une telle colonne de l'une des deux façons suivantes.

**Les montants sont calculés à partir des lignes.** La colonne reste calculée à partir de ses lignes dans la destination.

- Le pourcentage d'augmentation relève le prix unitaire de chaque ligne, arrondi à 4 décimales. Les quantités ne changent pas
- Les mois sont recalculés à partir des lignes avec les calendriers de jours ouvrés de l'année de destination. Le total copié peut différer légèrement du total source auquel on applique le pourcentage, car le nombre de jours ouvrés change d'une année à l'autre
- Les lignes passent à l'année de destination avec leur description, leur quantité, leur unité, leur fréquence et leur calendrier. Leurs périodes suivent la période de la colonne : mars à décembre 2026 devient mars à décembre 2027, et une ligne qui se termine le 29 février se termine le 28 février dans une année qui n'en a pas. Une pièce achetée une fois le 15 mars 2026 est achetée le 15 mars 2027. L'ETP est recalculé à partir des lignes
- Une ligne conservée seulement pour une partie de l'année de destination, à cause de la validité de la ligne budgétaire, est ramenée à cette période. Une ligne qui n'a plus aucun mois est supprimée
- La colonne affiche ses lignes comme d'habitude dans l'onglet Budget. Elle n'a pas de mention « Copié depuis »

**Les lignes ne sont qu'une référence.** C'est le cas lorsque les montants source ont été saisis à la main, répartis ou copiés.

- Le pourcentage d'augmentation s'applique aux mois, comme pour toute autre colonne. Les prix unitaires des lignes ne changent pas
- Les lignes passent à l'année de destination avec leur description, leur quantité, leur unité, leur fréquence et leur calendrier, et leurs périodes suivent la période de la colonne. Une ligne conservée seulement pour une partie de l'année de destination, à cause de la validité de la ligne budgétaire, est ramenée à cette période, et une ligne qui n'a plus aucun mois est supprimée
- L'ETP est recalculé à partir des lignes copiées avec les calendriers de jours ouvrés de l'année de destination
- Dans l'onglet Budget, la colonne de destination affiche « Copié depuis Budget 2026 », et son éditeur indique, par exemple, « 4 lignes gardées en référence (48 000). Utiliser à nouveau les lignes. »
- Les lignes copiées sont une référence en lecture seule. Cliquez sur **Utiliser à nouveau les lignes** pour calculer la colonne à partir d'elles, à leurs prix actuels. Pour planifier l'année de destination à ses propres prix, modifiez ensuite les prix unitaires : chaque modification recalcule la colonne

Une copie depuis une colonne sans ligne laisse la destination sans ligne, et son ETP devient vide.

#### Calendriers sans jours pour l'année de destination

Une ligne au prix par jour a besoin d'un calendrier qui contient l'année de destination. Lorsque le calendrier d'une ligne n'a aucun jour ouvré pour cette année, la copie utilise à la place le calendrier standard de la société payeuse de la ligne budgétaire, celui du pays de la société. C'est le calendrier créé avec la société. Cela vaut pour une colonne construite à partir de lignes et pour une colonne dont les lignes ne sont qu'une référence. S'il n'en existe pas, la ligne budgétaire est copiée de la façon habituelle : mois multipliés par le pourcentage. Les lignes sont conservées telles quelles comme référence, et l'ETP reste celui de la colonne source.

L'aperçu signale ces lignes budgétaires par une note **Calendrier**, avec une infobulle pour chaque ligne, et affiche un avertissement au-dessus du tableau. L'aperçu signale aussi une ligne budgétaire pour laquelle il n'existe aucun calendrier de remplacement. Pour copier malgré tout, cochez **Copier quand même avec ces changements de calendrier**. La meilleure solution est d'ajouter les jours de l'année dans la page **Calendriers de jours ouvrés**, puis de relancer l'aperçu.

Un calendrier désactivé reste utilisé. L'aperçu le signale et ne demande aucune confirmation.

### Copier les ventilations

**Ventilations** copie la méthode de ventilation de chaque ligne de l'année source vers l'année de destination, avec la répartition saisie à la main (les sociétés ou départements choisis, les pourcentages saisis). Seules les lignes valides l'année de destination sont copiées, avec la même règle que pour les montants.

- Une ligne laissée en ventilation par défaut reste sur le défaut : l'année de destination, elle suit le défaut de cette année
- Sans **Écraser les données existantes**, une ligne garde la ventilation saisie à la main dans l'année de destination. Une ligne dont l'année de destination suit une méthode sans répartition saisie à la main reçoit la ventilation source, et l'aperçu indique quelle méthode elle remplace, par exemple « Remplace Effectif »
- Avec **Écraser les données existantes**, chaque ventilation copiée remplace celle de la destination

### Protection des colonnes gelées

Lorsque la copie comprend les montants et que la colonne de destination est gelée, **Aperçu** et **Copier** sont désactivés et une bannière d'erreur vous invite à dégeler d'abord. Dans l'onglet **Tout**, lorsque la colonne n'est gelée que pour un type, la bannière le nomme, par exemple « La colonne Budget de 2027 est gelée en CAPEX. Dégelez-la, ou copiez seulement l'autre type. » Les ventilations seules ne dépendent pas des gels.

---

## Réinitialiser une colonne budgétaire

Effacez toutes les données d'une colonne budgétaire spécifique pour une année donnée. C'est une opération destructive : utilisez-la lorsque vous devez repartir de zéro.

Les onglets **Tout** / **OPEX** / **CAPEX** en haut de la page choisissent les lignes budgétaires à effacer. **Tout**, l'onglet par défaut, efface ensemble les lignes OPEX et CAPEX. La réinitialisation met à zéro les douze mois de la colonne et retire sa période, ainsi que ses lignes lorsque la colonne était construite à partir de la quantité et du prix. Dans l'onglet Budget, la colonne reçoit alors une nouvelle suggestion à partir des dates de la ligne budgétaire. La réinitialisation couvre toutes les lignes budgétaires, y compris celles dont la fin de validité est passée. Elle se fait en tout ou rien : si une ligne budgétaire échoue, rien n'est effacé.

Nécessite le niveau Admin sur Budget (`budget:admin`).

Une colonne dont les lignes budgétaires ne portent aucun montant peut quand même être réinitialisée : la réinitialisation retire alors seulement les périodes de répartition, et la confirmation l'indique.

### Quand l'utiliser

- Repartir de zéro avec la planification budgétaire
- Corriger des erreurs de saisie en masse
- Nettoyer des données de test

### Champs

| Champ | Description |
|-------|-------------|
| **Année** | L'année fiscale à nettoyer (plage : année en cours moins un à année en cours plus cinq) |
| **Colonne budgétaire** | Toute colonne affichée, Prévision comprise quand elle est affichée. Aucune colonne n'est présélectionnée : le champ indique **Choisir une colonne** et **Effacer la colonne** reste désactivé tant que vous n'en avez pas choisi une |

### Aperçu

Tant que vous n'avez pas choisi de colonne, une ligne remplace la grille : « Choisissez une colonne pour voir les montants qu'elle contient. » Une fois la colonne choisie, une grille montre chaque ligne du type choisi et sa valeur actuelle dans cette colonne. Le nom de la ligne l'ouvre dans un nouvel onglet, et dans l'onglet **Tout** une colonne **Type de ligne** indique **OPEX** ou **CAPEX**. Les montants qui seront effacés apparaissent en graisse moyenne ; les valeurs vides sont atténuées. Sous la grille, trois statistiques apparaissent :

- **Total des lignes**
- **Lignes avec un total non nul**
- **Valeur totale actuelle**

**Exporter le tableau** (icône de téléchargement) télécharge la grille dans un fichier CSV ou Excel : les lignes budgétaires du type choisi et leur valeur actuelle dans la colonne choisie.

### Confirmation

Cliquer sur **Effacer la colonne** ouvre une boîte de dialogue de confirmation qui affiche :

- La colonne et l'année en cours de réinitialisation
- Le nombre de lignes budgétaires affectées
- La valeur totale en cours de suppression
- Un avertissement clair que cette action ne peut pas être annulée

Vous devez cliquer sur **Effacer la colonne** dans la boîte de dialogue pour continuer, ou **Annuler** pour abandonner.

### Dispositifs de sécurité

- Le bouton **Effacer la colonne** reste disponible lorsqu'aucune ligne ne porte de montant, afin de pouvoir retirer les périodes de répartition
- Aucune colonne n'est présélectionnée : vous choisissez toujours la colonne à effacer
- Les colonnes gelées ne peuvent pas être réinitialisées. Dégelez-les d'abord. Dans l'onglet **Tout**, lorsque la colonne n'est gelée que pour un type, le message le nomme, par exemple « La colonne Budget de 2026 est gelée en CAPEX. Dégelez-la avant d'effacer les données, ou effacez seulement l'autre type. »
- La boîte de dialogue de confirmation nécessite un acquittement explicite

---

## Méthode de ventilation par défaut

Définissez la méthode que les lignes OPEX et CAPEX suivent lorsqu'elles restent sur la ventilation par défaut. Le réglage s'applique par exercice : chaque année résout sa propre valeur par défaut, ce qui vous permet de modifier la base d'une année sans toucher aux autres.

### Quand l'utiliser

- Votre modèle de refacturation n'est pas basé sur l'effectif (par exemple piloté par le chiffre d'affaires)
- Le budget IT est porté par une seule entité et ne doit pas être réparti entre toutes les filiales
- Vous souhaitez que les nouvelles lignes suivent une base partagée sans les modifier une par une
- Vous préparez un exercice dont la base de ventilation diffère de la précédente

### Champs

| Champ | Description |
|-------|-------------|
| **Exercice** | L'année à laquelle le réglage s'applique (plage : année en cours moins un à année en cours plus cinq) |
| **Sociétés** | **Toutes les sociétés actives** (par défaut) : le coût est réparti sur toutes les sociétés actives pour l'année. **Sociétés sélectionnées** : la ventilation est restreinte aux sociétés que vous choisissez |
| **Méthode par défaut** | L'inducteur qui pondère les sociétés : Effectif, Utilisateurs IT ou Chiffre d'affaires |

### Comment ça fonctionne

1. **Sélectionnez une année**
2. **Choisissez le périmètre de sociétés** : *Toutes les sociétés actives*, ou *Sociétés sélectionnées* puis les sociétés elles-mêmes
3. **Choisissez l'inducteur** qui pondère les sociétés (Effectif, Utilisateurs IT ou Chiffre d'affaires)
4. Chaque modification est enregistrée immédiatement, il n'y a pas de bouton Enregistrer
5. Pour revenir au standard, cliquez sur **Revenir à la méthode standard** (affiché uniquement tant qu'une valeur par défaut personnalisée est configurée)

### Sociétés sélectionnées

- L'inducteur s'applique uniquement aux sociétés sélectionnées : leurs pourcentages sont calculés à partir de leur propre effectif, de leurs utilisateurs IT ou de leur chiffre d'affaires pour l'année
- La page affiche la répartition obtenue, ce qui vous permet de vérifier l'effet avant de vous y appuyer. La colonne **Inducteur** affiche la valeur de chaque société. Un chiffre d'affaires s'affiche avec la devise de base de la société, par exemple **35 M USD**, et la répartition l'utilise converti dans la devise de reporting, comme dans l'[onglet Ventilations](budget-lines.md#ventilations). Quand une devise n'a pas de taux pour l'année, les sociétés dans cette devise sont écartées de la répartition : elles ne reçoivent aucune part, les autres sociétés sélectionnées se partagent 100 %, et un avertissement au-dessus de la répartition nomme chaque société écartée
- Une seule société sélectionnée prend toujours **100 %**, sans valeur d'inducteur requise
- À partir de deux sociétés, chaque société sélectionnée doit disposer d'une valeur pour l'inducteur choisi. Une société sans valeur est rejetée à l'enregistrement. Corrigez d'abord les métriques de la société dans **Données de référence > Sociétés**
- Une société désactivée pour l'année ne peut pas être sélectionnée : les sociétés désactivées sont exclues des ventilations de cette année

### Ce que cela affecte

- Chaque ligne OPEX ou CAPEX dont la méthode de ventilation est **par défaut**, affichée comme *Effectif (par défaut)* (ou *Par défaut (n sociétés)*) dans l'onglet Ventilations jusqu'à ce qu'une valeur par défaut soit définie pour l'organisation
- Les lignes budgétaires qui utilisent une méthode explicite (Effectif, Utilisateurs IT ou Chiffre d'affaires épinglés sur la ligne) ou une ventilation manuelle conservent leur propre réglage
- Les montants ventilés sont recalculés lors du prochain affichage des ventilations. Les montants budgétaires eux-mêmes ne sont jamais modifiés

### Méthode standard

Tant qu'une organisation n'a pas configuré de valeur par défaut, le standard s'applique : **Effectif** sur toutes les sociétés actives pour l'année. La page indique toujours si l'année utilise la méthode standard ou une valeur par défaut configurée, ainsi que la méthode standard en vigueur.

### Modifier la valeur par défaut après coup

La valeur par défaut est résolue à chaque affichage des ventilations : la modifier recalcule toutes les lignes restées sur la valeur par défaut. Si une société incluse dans la sélection perd ensuite sa valeur d'inducteur ou est désactivée, les lignes budgétaires concernées affichent une erreur au lieu d'une répartition rééquilibrée en silence. La page vous signale les problèmes liés à la sélection en cours.

### Autorisations

Modifier la méthode par défaut nécessite `budget_ops:admin`. La carte est masquée pour les autres utilisateurs.

---

## Colonnes budgétaires

Nommez les cinq colonnes budgétaires, choisissez celles que tout le monde voit et celle dont partent les rapports et les listes. Le réglage s'applique à toute l'organisation, pour les OPEX comme pour les CAPEX.

### Quand l'utiliser

- Vos tours budgétaires ont leurs propres noms, par exemple A0, A1, A2 et Réel
- Votre organisation n'utilise pas toutes les colonnes et veut un écran plus léger
- Les rapports et les listes doivent partir d'une autre colonne que Budget

### Le tableau

Une ligne par colonne, toujours dans le même ordre, de la colonne 1 à la colonne 5. Les noms standard sont Budget, Révision, Prévision, Réalisé et Atterrissage prévu.

| Champ | Description |
|-------|-------------|
| **Colonne** | La position, de 1 à 5. Les colonnes ne peuvent pas être réordonnées |
| **Nom** | Le nom que tout le monde voit dans les listes, l'onglet Budget, les rapports, la vue d'ensemble et l'administration budgétaire. Laissez-le vide pour utiliser le nom standard, affiché en indication. 40 caractères au plus, sans caractère de contrôle ni caractère invisible. Chaque nom doit différer de ceux des autres colonnes, y compris du nom standard d'une colonne que vous n'avez pas renommée, majuscules comprises |
| **Dans les fichiers** | La ligne sous chaque nom. Elle donne le nom technique de la colonne dans le fichier budgétaire et ses imports, par exemple `budget` pour la colonne 1. Il ne change jamais quand vous renommez une colonne. Voir [Charger un budget depuis un tableur](budget-file.md) |
| **Affichée** | Indique si la colonne apparaît à l'écran. Au moins une colonne doit rester affichée |
| **Suit la répartition et les lignes** | Indique si la colonne est cochée au départ dans **Utiliser aussi pour d'autres colonnes…** de l'onglet Budget, qui donne à d'autres colonnes la période et la répartition d'un montant, ou les lignes de quantité et prix. Vous pouvez toujours cocher ou décocher chaque colonne à cet endroit |
| **Par défaut** | La colonne que les rapports présélectionnent et qui trie les listes et la vue d'ensemble. La geler fige les taux de change de l'année. La colonne par défaut doit être affichée |

Les en-têtes **Suit la répartition et les lignes** et **Par défaut** portent une icône d'information. Survolez-la, ou placez-y le focus du clavier, pour lire la même explication sur la page.

Par défaut, Budget, Révision, Réalisé et Atterrissage prévu sont affichées et Prévision est masquée, toutes les colonnes suivent la répartition et les lignes, et Budget est la colonne par défaut.

### Ce que changent les réglages

- **Les colonnes masquées** disparaissent des listes, du sélecteur de colonnes, de l'onglet Budget, des sélecteurs des rapports, des pages de copie et de réinitialisation et de la vue d'ensemble. Elles gardent leurs montants : masquer une colonne n'efface jamais de données, et l'afficher de nouveau fait revenir les montants. Les colonnes masquées acceptent toujours les imports par le fichier budgétaire, et les gels s'appliquent toujours à elles. La page de gel liste aussi les colonnes masquées, avec la mention **Masquée** : vous pouvez les geler comme les autres
- **La colonne par défaut** est présélectionnée dans chaque rapport. Elle trie la liste des lignes budgétaires et sa navigation précédent et suivant. La tuile **Top lignes**, classée par **Montant** ou par **Hausse**, et les tuiles **Mon budget** et **Par centre de coûts** de la vue d'ensemble l'utilisent. La liste l'affiche pour l'année en cours, à côté de la dernière colonne affichée. C'est aussi le montant de référence de l'onglet Ventilations et la colonne de départ de la ligne **Écart avec** de l'onglet Budget. La geler pour une année fige les taux de change de cette année (voir [Geler la colonne par défaut fige les taux de change](#geler-la-colonne-par-defaut-fige-les-taux-de-change))
- **Suit la répartition et les lignes** décide quelles colonnes sont cochées au départ lorsque vous utilisez **Utiliser aussi pour d'autres colonnes…** dans l'onglet Budget. Les colonnes gelées ne sont jamais proposées, quel que soit ce réglage

### Enregistrement

Cliquez sur **Enregistrer** pour appliquer vos modifications. Le bouton reste désactivé tant que rien n'a changé ou qu'un nom n'est pas valide. **Réinitialiser** annule les modifications pas encore enregistrées. Les erreurs sont expliquées sous le champ ou sous le tableau, par exemple « Au moins une colonne doit rester affichée. » ou « La colonne par défaut doit être affichée : choisissez d'abord une autre colonne par défaut. » Pour masquer la colonne par défaut actuelle, choisissez d'abord une autre colonne par défaut. Les deux modifications peuvent être enregistrées ensemble.

### Autorisations

Modifier les réglages nécessite les droits admin sur l'administration budgétaire (`budget_ops:admin`). La carte est masquée pour les autres utilisateurs.

Si les réglages ne peuvent pas être chargés, la page affiche une seule ligne, « Les réglages des colonnes n'ont pas pu être chargés. », et aucun contrôle.

---

## Exemple de flux : Cycle budgétaire annuel

Voici une séquence typique utilisant ces outils, avec les noms de colonnes standard et Budget comme colonne par défaut :

### 1. Fin de l'année N

1. Geler le réalisé de l'année N (protéger les données historiques)
2. Copier le Budget N vers le Budget N+1, avec les ventilations (une seule exécution de **Copier les colonnes budgétaires**, avec un pourcentage d'augmentation pour l'inflation)

### 2. Pendant la planification budgétaire (N+1)

1. Les équipes modifient la colonne Budget N+1
2. Le directeur financier examine et approuve

### 3. Approbation du budget

1. Geler le Budget N+1 (verrouiller le budget approuvé et figer les taux de change de l'année)
2. Copier le Budget N+1 vers la Révision N+1 (point de départ pour le suivi en cours d'année)

### 4. Révision de milieu d'année

1. Les équipes mettent à jour la Révision N+1 avec les changements de prévisions
2. Une fois finalisé, geler la Révision N+1

---

## Conseils

- **Toujours faire un aperçu d'abord** : **Copier les colonnes budgétaires** montre ce qu'il fait sur chaque ligne avant la copie. Vérifiez-le à chaque fois avant de valider.
- **Geler après approbation** : Verrouiller les colonnes après approbation maintient votre piste d'audit et prévient les modifications accidentelles.
- **Utilisez les ajustements en pourcentage** : Lors de la copie entre années, appliquez un facteur d'inflation ou de croissance pour ne pas avoir à ajuster chaque ligne manuellement.
- **Vérifiez le statut de gel avant les opérations en masse** : Les colonnes gelées bloquent les opérations de copie et de réinitialisation. Si un bouton est grisé, vérifiez d'abord la page de gel.
- **Définissez la valeur par défaut de l'année avant de saisir les budgets** : Si votre base de ventilation n'est pas l'effectif, configurez-la d'abord dans Méthode de ventilation par défaut, afin que les lignes budgétaires soient créées sur la bonne base plutôt que d'être recalculées après coup.
- **Réinitialisez avec prudence** : La réinitialisation de colonne est irréversible. Vérifiez bien l'année et la colonne avant de confirmer.
