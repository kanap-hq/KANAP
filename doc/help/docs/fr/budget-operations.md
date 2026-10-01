# Administration budgétaire

L'administration budgétaire met à votre disposition un ensemble d'outils pour gérer et transformer les données budgétaires entre les années et les colonnes. Ce sont les opérations que vous utilisez pendant les cycles de planification budgétaire : préparer les chiffres de l'année suivante, verrouiller les budgets approuvés et gérer les transitions d'une année à l'autre.

## Où trouver cette page

- Chemin : **Gestion budgétaire > Administration**
- Autorisations : La plupart des opérations nécessitent `budget_ops:admin`

La page d'accueil affiche sept cartes, chacune renvoyant à un outil dédié :

| Outil | Objectif |
|-------|----------|
| **Geler / Dégeler les données** | Verrouiller les colonnes budgétaires pour empêcher les modifications |
| **Copier les colonnes budgétaires** | Copier des données entre années et colonnes avec des ajustements |
| **Copier les ventilations** | Copier les méthodes de ventilation d'une année à l'autre |
| **Réinitialiser une colonne budgétaire** | Effacer toutes les données d'une colonne spécifique |
| **Méthode de ventilation par défaut** | Définir la méthode que les postes OPEX et CAPEX suivent par défaut |
| **Fichier des lignes budgétaires** | Exporter ou importer les montants mensuels de chaque poste OPEX et CAPEX |
| **Colonnes budgétaires** | Nommer les cinq colonnes budgétaires, choisir celles qui sont affichées et la colonne par défaut |

Les colonnes budgétaires sont Budget, Révision, Prévision, Réalisé et Atterrissage prévu. Ce sont les noms standard. Votre organisation peut les renommer, en masquer certaines et choisir une colonne par défaut dans [Colonnes budgétaires](#colonnes-budgetaires). Chaque page ci-dessous affiche les noms choisis par votre organisation.

---

## Geler / Dégeler les données

Verrouillez les colonnes budgétaires pour qu'elles ne puissent être ni modifiées, ni importées, ni altérées de quelque manière que ce soit. Le gel protège les chiffres approuvés contre les modifications accidentelles.

### Quand l'utiliser

- Après l'approbation du budget annuel
- Lors de la clôture d'une période fiscale
- Pour protéger le réalisé contre toute modification

### Comment ça fonctionne

1. **Sélectionnez une année** dans le menu déroulant (plage : année en cours moins un à année en cours plus quatre)
2. **Sélectionnez les périmètres** : cochez **OPEX**, **CAPEX** ou les deux
3. **Sélectionnez les colonnes** pour chaque périmètre. La liste propose les cinq colonnes. Les colonnes masquées portent la mention **Masquée**. Toutes les colonnes sont sélectionnées par défaut : geler une année gèle donc chaque colonne, masquées comprises. Décochez une colonne pour l'exclure
4. Cliquez sur **Geler les données** pour verrouiller, ou **Dégeler les données** pour déverrouiller. Les deux boutons restent désactivés tant qu'un périmètre sélectionné n'a aucune colonne cochée

### Ce que fait le gel

- Empêche les modifications des colonnes gelées dans les espaces de travail OPEX et CAPEX
- Bloque les imports CSV vers les colonnes gelées
- Bloque les opérations de copie et de réinitialisation ciblant les colonnes gelées
- N'affecte **pas** l'accès en lecture : les données restent visibles
- S'applique aussi aux colonnes masquées. Une colonne gelée reste gelée quand elle est masquée, et les imports vers elle restent refusés

### Geler la colonne par défaut fige les taux de change

Geler la [colonne par défaut](#colonnes-budgetaires) pour une année fige aussi les taux de change de cette année pour le périmètre que vous gelez. KANAP actualise les taux de l'année, puis conserve le dernier jeu de taux pour chaque montant OPEX ou CAPEX de cette année. Les rapports convertissent ensuite ces montants avec les mêmes taux, même quand des taux plus récents arrivent. Dégeler la colonne par défaut les libère.

Geler une autre colonne ne touche pas aux taux. Changer ensuite de colonne par défaut ne fige ni ne libère rien à lui seul : les taux suivent le prochain gel ou dégel de la nouvelle colonne par défaut.

### Statut actuel

Sous les contrôles, deux cartes affichent l'état de gel en temps réel des cinq colonnes en OPEX et CAPEX. Chaque colonne affiche soit **Gelé** (en rouge) soit **Modifiable**. Les colonnes masquées portent la mention **Masquée**.

### Autorisations

Sans `budget_ops:admin`, vous pouvez toujours voir le statut de gel, mais les contrôles sont désactivés. Une bannière indique « Seuls les administrateurs budgétaires peuvent modifier cette page. »

---

## Copier les colonnes budgétaires

Copiez les données budgétaires d'une année et colonne vers une autre, avec un ajustement en pourcentage optionnel. C'est l'outil principal pour alimenter le budget de l'année suivante à partir de l'année en cours.

Le sélecteur **OPEX** / **CAPEX** en haut de la page choisit les postes sur lesquels la copie s'applique. OPEX est sélectionné par défaut si vous pouvez consulter les postes OPEX, sinon CAPEX.

Nécessite les droits d'administration sur les OPEX, ou sur les CAPEX pour les postes CAPEX.

### Quand l'utiliser

- Préparer le budget de l'année suivante à partir de l'année en cours
- Créer une révision à partir du budget approuvé
- Reporter des projections avec un facteur d'inflation

### Champs

| Champ | Description |
|-------|-------------|
| **Année source** | Année à copier (plage : année en cours moins un à année en cours plus cinq) |
| **Colonne source** | Toute colonne affichée, Prévision comprise quand elle est affichée. Démarre sur la colonne par défaut |
| **Année destination** | Année vers laquelle copier (même plage) |
| **Colonne destination** | Toute colonne affichée. Démarre sur la colonne par défaut |
| **Augmentation en pourcentage** | Ajustement appliqué à chaque mois copié (ex. : `3` = +3 %). Par défaut 0. Accepte les décimales et les valeurs négatives. Un pourcentage de -100 % ou moins est refusé. |
| **Écraser les données existantes** | Bascule. Désactivé : les postes qui ont déjà une valeur dans la destination sont ignorés. Activé : toutes les valeurs destination sont remplacées. |

La page s'ouvre avec la colonne par défaut de l'année en cours comme source et la colonne par défaut de l'année suivante comme destination. Les colonnes masquées ne sont pas proposées.

### Processus en deux étapes : Simulation, puis Copie

1. Cliquez sur **Simulation** pour générer un aperçu sans modifier aucune donnée
2. Examinez la grille d'aperçu, qui affiche :
   - Nom du **Poste** (les postes marqués **Ignoré** conservent leur valeur actuelle ; les postes marqués **Au prorata** commencent ou se terminent pendant l'année de destination et ne reçoivent que les mois de leur période de validité)
   - **Valeur source** (de l'année/colonne source)
   - **Valeur destination actuelle**
   - **Valeur d'aperçu** (ce que la destination deviendra après la copie)
3. Lorsque vous êtes satisfait, cliquez sur **Copier les données** pour appliquer

Le bouton **Copier les données** n'est activé qu'après une simulation réussie.

### Statistiques récapitulatives

Sous la grille, une barre de statistiques affiche :

- **Total des postes** dans le jeu de données
- **Postes à traiter** (non ignorés)
- **Total source** (somme des valeurs sources)
- **Total destination actuel**
- **Total de l'aperçu** (affiché après la simulation)

### Comportement de l'écrasement

| Écraser | La destination a des données | Résultat |
|---------|------------------------------|----------|
| Désactivé | Oui | Ignoré |
| Désactivé | Non (zéro) | Copié |
| Activé | Oui | Remplacé |
| Activé | Non (zéro) | Copié |

### Comment les montants sont copiés

- La copie conserve la répartition mensuelle. Chacun des douze mois est copié vers le même mois de la destination : une colonne répartie d'avril à décembre reste répartie d'avril à décembre
- Seuls les postes valides l'année de destination sont copiés. Un poste compte pour les mois dont le 15 tombe entre son **Début d'effet** et sa **Fin de validité**. Un poste sans aucun de ces mois est exclu, car l'onglet Budget ne l'affiche pas non plus
- Un poste valide une partie de l'année de destination ne reçoit que ces mois. Les autres mois gardent leur montant, et la période est ramenée aux dates du poste. Par exemple, une source sur douze mois copiée vers un poste qui se termine le 30 juin donne janvier à juin
- Sans pourcentage, les montants sont copiés à l'identique, au centime près
- Avec un pourcentage, chaque mois est arrondi à l'unité, et le total annuel reste le total source auquel on applique le pourcentage, arrondi à l'unité. Les unités laissées par l'arrondi vont aux mois qui ont perdu les plus grandes fractions, le mois le plus tardif d'abord en cas d'égalité. Aucun mois ne change de signe. Par exemple, 12 000 répartis d'avril à décembre (1 333,33 par mois et 1 333,36 en décembre) copiés avec +2 % donnent 1 360 par mois et 12 240 pour l'année
- La période de la colonne suit la copie : avril à décembre 2026 devient avril à décembre 2027. Une période qui se termine le 29 février se termine le 28 février dans une année non bissextile
- Une source sans période donne une période couvrant toute l'année
- Dans l'onglet Budget, la colonne de destination affiche « Copié depuis Budget 2026 +2 % »
- La copie d'une colonne sur elle-même (même année et même colonne) est refusée
- La copie se fait en tout ou rien : si un poste échoue, rien n'est enregistré

### Copier une colonne calculée

Une colonne peut être construite à partir de lignes, chacune étant une quantité multipliée par un prix unitaire. Voir [Quantité et prix](opex.md#quantite-et-prix).

- La copie reporte les lignes de la colonne source sur la destination, avec leur description, leur quantité, leur unité, leur prix unitaire, leur fréquence (temps plein ou jours par mois pour les personnes, par mois ou une fois pour les pièces) et leur calendrier. Leurs périodes passent à l'année de destination, comme la période de la colonne : mars à décembre 2026 devient mars à décembre 2027, et une ligne qui se termine le 29 février se termine le 28 février dans une année qui n'en a pas. Une pièce achetée une fois le 15 mars 2026 est achetée le 15 mars 2027
- La copie reporte aussi l'ETP de la colonne source
- Les mois sont copiés comme pour toute autre colonne. Le pourcentage d'augmentation s'applique uniquement aux montants copiés. Les lignes gardent leurs prix unitaires
- Une copie depuis une colonne sans ligne laisse la destination sans ligne, et son ETP devient vide
- Dans l'onglet Budget, la colonne de destination affiche « Copié depuis Budget 2026 », et son onglet **Quantité et prix** indique « Les montants ont été copiés depuis Budget 2026. Utiliser à nouveau les lignes. »
- Pour planifier l'année de destination à ses propres prix, ouvrez l'onglet Budget du poste et modifiez les prix unitaires dans l'onglet **Quantité et prix** : chaque modification recalcule la colonne à partir des lignes. Pour garder les prix, cliquez sur **Utiliser à nouveau les lignes**. Une ligne au prix par jour a besoin d'un calendrier qui contient l'année de destination : un calendrier standard la contient toujours, un calendrier personnalisé peut ne pas la contenir, par exemple « Personnel du siège has no working days for 2027. Add them on the Working-day calendars page. »

### Protection des colonnes gelées

Si la colonne destination est gelée, **Simulation** et **Copier les données** sont tous deux désactivés. Une bannière d'erreur vous invite à dégeler d'abord.

---

## Copier les ventilations

Copiez les méthodes et pourcentages de ventilation d'une année à l'autre. Cela vous évite de ressaisir les configurations de refacturation lors de la mise en place d'une nouvelle année fiscale.

La bascule **OPEX** / **CAPEX** en haut choisit les postes copiés. Seuls les postes valides l'année de destination sont copiés, avec la même règle que **Copier les colonnes budgétaires**. La copie se fait en bloc : si un poste échoue, rien n'est copié.

Nécessite les droits d'administration sur OPEX, ou sur CAPEX pour les postes CAPEX.

### Quand l'utiliser

- Préparer le budget de l'année suivante avec les mêmes ventilations de coûts
- Reporter les configurations de refacturation
- Mettre en place une nouvelle année fiscale

### Champs

| Champ | Description |
|-------|-------------|
| **Année source** | Année à partir de laquelle copier les ventilations (plage : année en cours moins un à année en cours plus cinq) |
| **Année destination** | Année vers laquelle copier les ventilations (même plage). Doit différer de l'année source. |
| **Écraser les données existantes** | Bascule. Désactivé : les postes qui ont déjà des ventilations dans la destination sont ignorés. |

### Processus en deux étapes : Simulation, puis Copie

1. Cliquez sur **Simulation** pour voir un aperçu
2. La grille d'aperçu affiche chaque poste OPEX ou CAPEX avec :
   - Nom du **Poste**
   - **Action** : ce qui va se passer (Sera copié, Ignoré – pas d'année source, Ignoré – pas de ventilations dans la source, Ignoré – la destination contient des données, Erreur)
   - Méthode et libellé **Source**
   - Méthode et libellé **Destination** actuels
   - **Résultat après copie** : ce à quoi ressemblera la destination
3. Cliquez sur **Copier les données** pour appliquer

### Validation

- Les années source et destination doivent être différentes. Si elles sont identiques, une bannière d'avertissement apparaît et les deux boutons sont désactivés.
- Changer un filtre efface l'aperçu, nécessitant une nouvelle simulation.

### Résumé

Après une simulation, une bannière affiche le nombre de postes prêts à être copiés, ignorés et en erreur. Si des postes ont été ignorés parce que la destination a déjà des ventilations, un avertissement séparé suggère d'activer l'écrasement.

---

## Réinitialiser une colonne budgétaire

Effacez toutes les données d'une colonne budgétaire spécifique pour une année donnée. C'est une opération destructive : utilisez-la lorsque vous devez repartir de zéro.

Le sélecteur **OPEX** / **CAPEX** en haut de la page choisit les postes à effacer. La réinitialisation met à zéro les douze mois de la colonne et retire sa période, ainsi que ses lignes lorsque la colonne était construite à partir de la quantité et du prix. Dans l'onglet Budget, la colonne reçoit alors une nouvelle suggestion à partir des dates du poste. La réinitialisation couvre tous les postes, y compris ceux dont la fin de validité est passée. Elle se fait en tout ou rien : si un poste échoue, rien n'est effacé.

Nécessite les droits d'administration sur les OPEX, ou sur les CAPEX pour les postes CAPEX.

Une colonne dont les postes ne portent aucun montant peut quand même être réinitialisée : la réinitialisation retire alors seulement les périodes de répartition, et la confirmation l'indique.

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

Tant que vous n'avez pas choisi de colonne, une ligne remplace la grille : « Choisissez une colonne pour voir les montants qu'elle contient. » Une fois la colonne choisie, une grille montre chaque poste OPEX ou CAPEX et sa valeur actuelle dans cette colonne. Les montants qui seront effacés apparaissent en graisse moyenne ; les valeurs vides sont atténuées. Sous la grille, trois statistiques apparaissent :

- **Total des postes**
- **Postes avec un total non nul**
- **Valeur totale actuelle**

### Confirmation

Cliquer sur **Effacer la colonne** ouvre une boîte de dialogue de confirmation qui affiche :

- La colonne et l'année en cours de réinitialisation
- Le nombre de postes affectés
- La valeur totale en cours de suppression
- Un avertissement clair que cette action ne peut pas être annulée

Vous devez cliquer sur **Effacer la colonne** dans la boîte de dialogue pour continuer, ou **Annuler** pour abandonner.

### Dispositifs de sécurité

- Le bouton **Effacer la colonne** reste disponible lorsqu'aucun poste ne porte de montant, afin de pouvoir retirer les périodes de répartition
- Aucune colonne n'est présélectionnée : vous choisissez toujours la colonne à effacer
- Les colonnes gelées ne peuvent pas être réinitialisées. Dégelez-les d'abord
- La boîte de dialogue de confirmation nécessite un acquittement explicite

---

## Méthode de ventilation par défaut

Définissez la méthode que les postes OPEX et les investissements CAPEX suivent lorsqu'ils restent sur la ventilation par défaut. Le réglage s'applique par exercice : chaque année résout sa propre valeur par défaut, ce qui vous permet de modifier la base d'une année sans toucher aux autres.

### Quand l'utiliser

- Votre modèle de refacturation n'est pas basé sur l'effectif (par exemple piloté par le chiffre d'affaires)
- Le budget IT est porté par une seule entité et ne doit pas être réparti entre toutes les filiales
- Vous souhaitez que les nouveaux postes suivent une base partagée sans les modifier un par un
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
- La page affiche la répartition obtenue, ce qui vous permet de vérifier l'effet avant de vous y appuyer
- Une seule société sélectionnée prend toujours **100 %**, sans valeur d'inducteur requise
- À partir de deux sociétés, chaque société sélectionnée doit disposer d'une valeur pour l'inducteur choisi. Une société sans valeur est rejetée à l'enregistrement. Corrigez d'abord les métriques de la société dans **Données de référence > Sociétés**
- Une société désactivée pour l'année ne peut pas être sélectionnée : les sociétés désactivées sont exclues des ventilations de cette année

### Ce que cela affecte

- Chaque poste OPEX et investissement CAPEX dont la méthode de ventilation est **par défaut**, affiché comme *Effectif (par défaut)* (ou *Par défaut (n sociétés)*) dans l'onglet Ventilations jusqu'à ce qu'une valeur par défaut soit définie pour l'organisation
- Les postes qui utilisent une méthode explicite (Effectif, Utilisateurs IT ou Chiffre d'affaires épinglés sur le poste) ou une ventilation manuelle conservent leur propre réglage
- Les montants ventilés sont recalculés lors du prochain affichage des ventilations. Les montants budgétaires eux-mêmes ne sont jamais modifiés

### Méthode standard

Tant qu'une organisation n'a pas configuré de valeur par défaut, le standard s'applique : **Effectif** sur toutes les sociétés actives pour l'année. La page indique toujours si l'année utilise la méthode standard ou une valeur par défaut configurée, ainsi que la méthode standard en vigueur.

### Modifier la valeur par défaut après coup

La valeur par défaut est résolue à chaque affichage des ventilations : la modifier recalcule tous les postes restés sur la valeur par défaut. Si une société incluse dans la sélection perd ensuite sa valeur d'inducteur ou est désactivée, les postes concernés affichent une erreur au lieu d'une répartition rééquilibrée en silence. La page vous signale les problèmes liés à la sélection en cours.

### Autorisations

Sans `budget_ops:admin`, vous pouvez consulter le réglage actuel mais pas le modifier.

---

## Fichier des lignes budgétaires

Exportez ou importez les montants mensuels de chaque poste OPEX et CAPEX dans un seul fichier, avec une ligne par poste, année et colonne.

### Quand l'utiliser

- Charger des budgets mensuels préparés dans un tableur
- Importer le réalisé mensuel depuis votre système comptable
- Relire ou archiver toutes les colonnes, y compris la Prévision

### Export

1. Choisissez une année, ou conservez **Toutes les années**
2. Cliquez sur **Exporter**, puis sur **Exporter les données**

Le fichier liste chaque poste OPEX et CAPEX que vous pouvez consulter, pour chaque année qui porte des montants. Chaque poste et chaque année reçoivent cinq lignes, une par colonne budgétaire dans l'ordre fixe (Budget, Révision, Prévision, Réalisé, Atterrissage prévu sous leurs noms standard). Les colonnes sans montant et les colonnes masquées sont incluses aussi.

Sous l'introduction, la page indique quel nom technique du fichier correspond à chacune de vos colonnes, par exemple « `planned` pour Budget ». Les mêmes noms techniques apparaissent sous **Dans les fichiers** sur la page [Colonnes budgétaires](#colonnes-budgetaires). Lorsque le fichier couvre une seule année, ou seulement les OPEX ou seulement les CAPEX en raison de vos autorisations, son nom se termine par `partial`.

Un fichier peut être importé jusqu'à 10 Mo. Pour un budget plus volumineux, exportez et importez une année à la fois : un export limité à une année produit un fichier plus petit.

### Colonnes

Le fichier utilise le point-virgule `;` comme séparateur et l'encodage UTF-8.

| Colonne | Contenu |
|---------|---------|
| `item_type` | `opex` ou `capex` |
| `item_number` | Le numéro du poste, par exemple `7`. À l'import, la référence fonctionne aussi (`OPX-7`, `CPX-7`) |
| `year` | Quatre chiffres |
| `measure` | La colonne, par son nom technique, quel que soit le nom choisi par votre organisation : `planned` (colonne 1, nom standard Budget), `committed` (colonne 2, Révision), `forecast` (colonne 3, Prévision), `actual` (colonne 4, Réalisé), `expected_landing` (colonne 5, Atterrissage prévu). À l'import, `budget`, `revision`, `follow_up` et `landing` fonctionnent aussi |
| `period_start`, `period_end` | La période de la colonne au format `YYYY-MM-DD`, à l'intérieur de l'année de la ligne. À l'import, deux valeurs vides signifient toute l'année |
| `jan` à `dec` | Les douze montants mensuels, avec un point comme séparateur décimal. À l'import, la virgule et les espaces sont aussi acceptés |
| `method` | La façon dont la colonne a été produite : `spread`, `copied`, `manual` ou `computed` (construite à partir de la quantité et du prix). À titre d'information uniquement, ignorée à l'import |

### Règles d'import

1. Cliquez sur **Importer**, choisissez le fichier et lancez la **Vérification préalable**
2. Examinez le rapport, puis cliquez sur **Charger**

- Tout le fichier est vérifié avant le moindre enregistrement. Si une ligne contient une erreur, rien n'est enregistré et le rapport liste les erreurs par numéro de ligne
- Chaque ligne remplace les douze mois de son poste, de son année et de sa colonne. Les postes, années et colonnes absents du fichier ne sont pas modifiés
- Les douze mois sont obligatoires. Saisissez `0` pour un mois sans montant
- Une ligne identique à ce qui est enregistré n'est pas modifiée, y compris la façon dont la colonne a été produite. Réimporter un export ne change rien
- Une ligne dont les montants changent marque la colonne comme **Modifié à la main**, avec la période du fichier. Une colonne construite à partir de la quantité et du prix garde ses lignes, et son onglet Budget propose de les utiliser à nouveau. Voir [Quantité et prix](opex.md#quantite-et-prix)
- Le fichier ne contient que des montants. Les lignes d'une colonne se gèrent dans l'onglet Budget
- Une ligne qui ne change que la période met à jour la période et conserve le reste
- Les lignes Réalisé suivent les mêmes règles, ce qui permet d'importer le réalisé mensuel
- Une ligne modifiée sur une colonne gelée est refusée. Une ligne identique sur une colonne gelée est acceptée
- Les lignes d'une colonne masquée sont importées comme les autres. Masquer une colonne ne bloque jamais ses imports, et une colonne masquée gelée refuse toujours les lignes modifiées
- Les lignes en double (même poste, même année et même colonne), les numéros de poste inconnus et les postes d'un type que vous ne pouvez pas administrer sont des erreurs
- L'import nécessite les droits d'administration sur les OPEX ou sur les CAPEX. L'export nécessite l'accès en lecture à l'un des deux

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
| **Dans les fichiers** | La ligne sous chaque nom. Elle donne le nom technique de la colonne dans le fichier des lignes budgétaires et ses imports, par exemple `planned` pour la colonne 1. Il ne change jamais quand vous renommez une colonne |
| **Affichée** | Indique si la colonne apparaît à l'écran. Au moins une colonne doit rester affichée |
| **Suit la répartition et les lignes** | Indique si la colonne reprend ce qui est appliqué à toutes les colonnes dans l'onglet Budget : la répartition et la période d'un montant réparti (**Appliquer la répartition à toutes les colonnes**), et les lignes quantité et prix (**Appliquer ces lignes à toutes les colonnes**). Une colonne qui ne suit pas garde les siens : quand vous la répartissez ou modifiez ses lignes, elle change seule |
| **Par défaut** | La colonne que les rapports présélectionnent et qui trie les listes et la vue d'ensemble. La geler fige les taux de change de l'année. La colonne par défaut doit être affichée |

Les en-têtes **Suit la répartition et les lignes** et **Par défaut** portent une icône d'information. Survolez-la, ou placez-y le focus du clavier, pour lire la même explication sur la page.

Par défaut, Budget, Révision, Réalisé et Atterrissage prévu sont affichées et Prévision est masquée, toutes les colonnes suivent les interrupteurs de l'onglet Budget, et Budget est la colonne par défaut.

### Ce que changent les réglages

- **Les colonnes masquées** disparaissent des listes, du sélecteur de colonnes, de l'onglet Budget, des sélecteurs des rapports, des pages de copie et de réinitialisation et de la vue d'ensemble. Elles gardent leurs montants : masquer une colonne n'efface jamais de données, et l'afficher de nouveau fait revenir les montants. Les colonnes masquées acceptent toujours les imports par le fichier des lignes budgétaires, et les gels s'appliquent toujours à elles. La page de gel liste aussi les colonnes masquées, avec la mention **Masquée** : geler une année les gèle donc avec les autres
- **La colonne par défaut** est présélectionnée dans chaque rapport. Elle trie les listes OPEX et CAPEX, leur navigation précédent et suivant, et les tuiles **Top postes** et **Plus fortes hausses** de la vue d'ensemble. Les listes l'affichent pour l'année en cours, à côté de la dernière colonne affichée. C'est aussi le montant de référence de l'onglet Ventilations et la colonne sur laquelle s'ouvre le panneau de répartition. La geler pour une année fige les taux de change de cette année (voir [Geler la colonne par défaut fige les taux de change](#geler-la-colonne-par-defaut-fige-les-taux-de-change))
- **Suit la répartition et les lignes** décide quelles colonnes bougent ensemble quand une répartition est appliquée à toutes les colonnes, et quelles colonnes reçoivent les lignes quand **Appliquer ces lignes à toutes les colonnes** est activé. Les colonnes gelées ne changent jamais, quel que soit ce réglage

### Enregistrement

Cliquez sur **Enregistrer** pour appliquer vos modifications. Le bouton reste désactivé tant que rien n'a changé ou qu'un nom n'est pas valide. **Réinitialiser** annule les modifications pas encore enregistrées. Les erreurs sont expliquées sous le champ ou sous le tableau, par exemple « Au moins une colonne doit rester affichée. » ou « La colonne par défaut doit être affichée : choisissez d'abord une autre colonne par défaut. » Pour masquer la colonne par défaut actuelle, choisissez d'abord une autre colonne par défaut. Les deux modifications peuvent être enregistrées ensemble.

### Autorisations

Modifier les réglages nécessite les droits admin sur l'administration budgétaire (`budget_ops:admin`). Les autres utilisateurs peuvent ouvrir la page et voir les réglages, en lecture seule, sous la bannière « Seuls les administrateurs budgétaires peuvent modifier cette page. »

Si les réglages ne peuvent pas être chargés, la page affiche une seule ligne, « Les réglages des colonnes n'ont pas pu être chargés. », et aucun contrôle.

---

## Exemple de flux : Cycle budgétaire annuel

Voici une séquence typique utilisant ces outils, avec les noms de colonnes standard et Budget comme colonne par défaut :

### 1. Fin de l'année N

1. Geler le réalisé de l'année N (protéger les données historiques)
2. Copier le Budget N vers le Budget N+1 (avec un pourcentage d'augmentation pour l'inflation)
3. Copier les ventilations N vers N+1

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

- **Toujours simuler d'abord** : La copie des colonnes budgétaires et la copie des ventilations supportent toutes deux une simulation. Utilisez-la à chaque fois pour vérifier le résultat avant de valider.
- **Geler après approbation** : Verrouiller les colonnes après approbation maintient votre piste d'audit et prévient les modifications accidentelles.
- **Utilisez les ajustements en pourcentage** : Lors de la copie entre années, appliquez un facteur d'inflation ou de croissance pour ne pas avoir à ajuster chaque ligne manuellement.
- **Vérifiez le statut de gel avant les opérations en masse** : Les colonnes gelées bloquent les opérations de copie et de réinitialisation. Si un bouton est grisé, vérifiez d'abord la page de gel.
- **Définissez la valeur par défaut de l'année avant de saisir les budgets** : Si votre base de ventilation n'est pas l'effectif, configurez-la d'abord dans Méthode de ventilation par défaut, afin que les postes soient créés sur la bonne base plutôt que d'être recalculés après coup.
- **Réinitialisez avec prudence** : La réinitialisation de colonne est irréversible. Vérifiez bien l'année et la colonne avant de confirmer.
