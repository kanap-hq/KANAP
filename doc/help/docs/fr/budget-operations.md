# Administration budgétaire

L'administration budgétaire met à votre disposition un ensemble d'outils pour gérer et transformer les données budgétaires entre les années et les colonnes. Ce sont les opérations que vous utilisez pendant les cycles de planification budgétaire -- préparer les chiffres de l'année suivante, verrouiller les budgets approuvés et gérer les transitions d'une année à l'autre.

## Où trouver cette page

- Chemin : **Gestion budgétaire > Administration**
- Autorisations : La plupart des opérations nécessitent `budget_ops:admin`

La page d'accueil affiche six cartes, chacune renvoyant à un outil dédié :

| Outil | Objectif |
|-------|----------|
| **Geler / Dégeler les données** | Verrouiller les colonnes budgétaires pour empêcher les modifications |
| **Copier les colonnes budgétaires** | Copier des données entre années et colonnes avec des ajustements |
| **Copier les ventilations** | Copier les méthodes de ventilation d'une année à l'autre |
| **Réinitialiser une colonne budgétaire** | Effacer toutes les données d'une colonne spécifique |
| **Méthode de ventilation par défaut** | Définir la méthode que les postes OPEX et CAPEX suivent par défaut |
| **Fichier des lignes budgétaires** | Exporter ou importer les montants mensuels de chaque poste OPEX et CAPEX |

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
3. **Sélectionnez les colonnes** pour chaque périmètre : Budget, Révision, Prévision, Réalisé, Atterrissage prévu (les cinq sont sélectionnées par défaut)
4. Cliquez sur **Geler les données** pour verrouiller, ou **Dégeler les données** pour déverrouiller

### Ce que fait le gel

- Empêche les modifications des colonnes gelées dans les espaces de travail OPEX et CAPEX
- Bloque les imports CSV vers les colonnes gelées
- Bloque les opérations de copie et de réinitialisation ciblant les colonnes gelées
- N'affecte **pas** l'accès en lecture -- les données restent visibles

### Statut actuel

Sous les contrôles, deux cartes affichent l'état de gel en temps réel pour chaque colonne en OPEX et CAPEX. Chaque colonne affiche soit **Gelé** (en rouge) soit **Modifiable**.

### Autorisations

Sans `budget_ops:admin`, vous pouvez toujours voir le statut de gel, mais les contrôles sont désactivés. Une bannière d'information explique ce qui est nécessaire.

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
| **Colonne source** | Budget, Révision, Réalisé ou Atterrissage prévu |
| **Année destination** | Année vers laquelle copier (même plage) |
| **Colonne destination** | Budget, Révision, Réalisé ou Atterrissage prévu |
| **Augmentation en pourcentage** | Ajustement appliqué à chaque mois copié (ex. : `3` = +3 %). Par défaut 0. Accepte les décimales et les valeurs négatives. |
| **Écraser les données existantes** | Bascule. Désactivé : les postes qui ont déjà une valeur dans la destination sont ignorés. Activé : toutes les valeurs destination sont remplacées. |

### Processus en deux étapes : Simulation, puis Copie

1. Cliquez sur **Simulation** pour générer un aperçu sans modifier aucune donnée
2. Examinez la grille d'aperçu, qui affiche :
   - Nom du **Poste** (les postes marqués **Ignoré** conservent leur valeur actuelle)
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
- Sans pourcentage, les montants sont copiés à l'identique, au centime près
- Avec un pourcentage, chaque mois est arrondi à l'unité. Le total annuel est le total source auquel on applique le pourcentage, arrondi à l'unité. Le petit écart est reporté sur le dernier mois qui porte un montant. Par exemple, 12 000 répartis d'avril à décembre (1 333,33 par mois et 1 333,36 en décembre) copiés avec +2 % donnent 1 360 par mois et 12 240 pour l'année
- La période de la colonne suit la copie : avril à décembre 2026 devient avril à décembre 2027. Une période qui se termine le 29 février se termine le 28 février dans une année non bissextile
- Une source sans période donne une période couvrant toute l'année
- Dans l'onglet Budget, la colonne de destination affiche « Copié depuis Budget 2026 +2 % »
- La copie d'une colonne sur elle-même (même année et même colonne) est refusée
- La copie se fait en tout ou rien : si un poste échoue, rien n'est enregistré

### Protection des colonnes gelées

Si la colonne destination est gelée, **Simulation** et **Copier les données** sont tous deux désactivés. Une bannière d'erreur vous invite à dégeler d'abord.

---

## Copier les ventilations

Copiez les méthodes et pourcentages de ventilation d'une année à l'autre pour tous les postes OPEX. Cela vous évite de ressaisir les configurations de refacturation lors de la mise en place d'une nouvelle année fiscale.

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
2. La grille d'aperçu affiche chaque poste OPEX avec :
   - Nom du **Produit**
   - **Action** -- ce qui va se passer (Sera copié, Ignoré -- pas d'année source, Ignoré -- pas de ventilations dans la source, Ignoré -- la destination a des données, Erreur)
   - Méthode et libellé **Source**
   - Méthode et libellé **Destination** actuels
   - **Résultat après copie** -- ce à quoi ressemblera la destination
3. Cliquez sur **Copier les données** pour appliquer

### Validation

- Les années source et destination doivent être différentes. Si elles sont identiques, une bannière d'avertissement apparaît et les deux boutons sont désactivés.
- Changer un filtre efface l'aperçu, nécessitant une nouvelle simulation.

### Résumé

Après une simulation, une bannière affiche le nombre de postes prêts à être copiés, ignorés et en erreur. Si des postes ont été ignorés parce que la destination a déjà des ventilations, un avertissement séparé suggère d'activer l'écrasement.

---

## Réinitialiser une colonne budgétaire

Effacez toutes les données d'une colonne budgétaire spécifique pour une année donnée. C'est une opération destructive : utilisez-la lorsque vous devez repartir de zéro.

Le sélecteur **OPEX** / **CAPEX** en haut de la page choisit les postes à effacer. La réinitialisation met à zéro les douze mois de la colonne et retire sa période. Dans l'onglet Budget, la colonne reçoit alors une nouvelle suggestion à partir des dates du poste. La réinitialisation se fait en tout ou rien : si un poste échoue, rien n'est effacé.

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
| **Colonne budgétaire** | Budget, Révision, Réalisé ou Atterrissage prévu |

### Aperçu

La page charge une grille montrant chaque poste OPEX ou CAPEX et sa valeur actuelle dans la colonne sélectionnée. Les montants qui seront effacés apparaissent en graisse moyenne ; les valeurs vides sont atténuées. Sous la grille, trois statistiques apparaissent :

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
- Les colonnes gelées ne peuvent pas être réinitialisées -- dégélez d'abord
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
2. **Choisissez le périmètre de sociétés** -- *Toutes les sociétés actives*, ou *Sociétés sélectionnées* puis les sociétés elles-mêmes
3. **Choisissez l'inducteur** qui pondère les sociétés (Effectif, Utilisateurs IT ou Chiffre d'affaires)
4. Chaque modification est enregistrée immédiatement, il n'y a pas de bouton Enregistrer
5. Pour revenir au standard, cliquez sur **Revenir à la méthode standard** (affiché uniquement tant qu'une valeur par défaut personnalisée est configurée)

### Sociétés sélectionnées

- L'inducteur s'applique uniquement aux sociétés sélectionnées : leurs pourcentages sont calculés à partir de leur propre effectif, de leurs utilisateurs IT ou de leur chiffre d'affaires pour l'année
- La page affiche la répartition obtenue, ce qui vous permet de vérifier l'effet avant de vous y appuyer
- Une seule société sélectionnée prend toujours **100 %**, sans valeur d'inducteur requise
- À partir de deux sociétés, chaque société sélectionnée doit disposer d'une valeur pour l'inducteur choisi. Une société sans valeur est rejetée à l'enregistrement -- corrigez d'abord les métriques de la société dans **Données de référence > Sociétés**
- Une société désactivée pour l'année ne peut pas être sélectionnée : les sociétés désactivées sont exclues des ventilations de cette année

### Ce que cela affecte

- Chaque poste OPEX et investissement CAPEX dont la méthode de ventilation est **par défaut** -- affiché comme *Effectif (par défaut)* (ou *Par défaut (n sociétés)*) dans l'onglet Ventilations jusqu'à ce qu'une valeur par défaut soit définie pour l'organisation
- Les postes qui utilisent une méthode explicite (Effectif, Utilisateurs IT ou Chiffre d'affaires épinglés sur le poste) ou une ventilation manuelle conservent leur propre réglage
- Les montants ventilés sont recalculés lors du prochain affichage des ventilations. Les montants budgétaires eux-mêmes ne sont jamais modifiés

### Méthode standard

Tant qu'une organisation n'a pas configuré de valeur par défaut, le standard s'applique : **Effectif** sur toutes les sociétés actives pour l'année. La page indique toujours si l'année utilise la méthode standard ou une valeur par défaut configurée, ainsi que la méthode standard en vigueur.

### Modifier la valeur par défaut après coup

La valeur par défaut est résolue à chaque affichage des ventilations : la modifier recalcule tous les postes restés sur la valeur par défaut. Si une société incluse dans la sélection perd ensuite sa valeur d'inducteur ou est désactivée, les postes concernés affichent une erreur au lieu d'une répartition rééquilibrée en silence -- la page vous signale les problèmes liés à la sélection en cours.

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

Le fichier liste chaque poste OPEX et CAPEX que vous pouvez consulter, pour chaque année qui porte des montants. Chaque poste et chaque année reçoivent cinq lignes, dans cet ordre : Budget, Révision, Prévision, Réalisé, Atterrissage prévu. Les colonnes sans montant sont incluses aussi. Lorsque le fichier couvre une seule année, ou seulement les OPEX ou seulement les CAPEX en raison de vos autorisations, son nom se termine par `partial`.

Un fichier peut être importé jusqu'à 10 Mo. Pour un budget plus volumineux, exportez et importez une année à la fois : un export limité à une année produit un fichier plus petit.

### Colonnes

Le fichier utilise le point-virgule `;` comme séparateur et l'encodage UTF-8.

| Colonne | Contenu |
|---------|---------|
| `item_type` | `opex` ou `capex` |
| `item_number` | Le numéro du poste, par exemple `7`. À l'import, la référence fonctionne aussi (`OPX-7`, `CPX-7`) |
| `year` | Quatre chiffres |
| `measure` | La colonne : `planned` (Budget), `committed` (Révision), `forecast` (Prévision), `actual` (Réalisé), `expected_landing` (Atterrissage prévu). À l'import, `budget`, `revision`, `follow_up` et `landing` fonctionnent aussi |
| `period_start`, `period_end` | La période de la colonne au format `YYYY-MM-DD`, à l'intérieur de l'année de la ligne. À l'import, deux valeurs vides signifient toute l'année |
| `jan` à `dec` | Les douze montants mensuels, avec un point comme séparateur décimal. À l'import, la virgule et les espaces sont aussi acceptés |
| `method` | La façon dont la colonne a été produite : `spread`, `copied` ou `manual`. À titre d'information uniquement, ignorée à l'import |

### Règles d'import

1. Cliquez sur **Importer**, choisissez le fichier et lancez la **Vérification préalable**
2. Examinez le rapport, puis cliquez sur **Charger**

- Tout le fichier est vérifié avant le moindre enregistrement. Si une ligne contient une erreur, rien n'est enregistré et le rapport liste les erreurs par numéro de ligne
- Chaque ligne remplace les douze mois de son poste, de son année et de sa colonne. Les postes, années et colonnes absents du fichier ne sont pas modifiés
- Les douze mois sont obligatoires. Saisissez `0` pour un mois sans montant
- Une ligne identique à ce qui est enregistré n'est pas modifiée, y compris la façon dont la colonne a été produite. Réimporter un export ne change rien
- Une ligne dont les montants changent marque la colonne comme **Modifié à la main**, avec la période du fichier
- Une ligne qui ne change que la période met à jour la période et conserve le reste
- Les lignes Réalisé suivent les mêmes règles, ce qui permet d'importer le réalisé mensuel
- Une ligne modifiée sur une colonne gelée est refusée. Une ligne identique sur une colonne gelée est acceptée
- Les lignes en double (même poste, même année et même colonne), les numéros de poste inconnus et les postes d'un type que vous ne pouvez pas administrer sont des erreurs
- L'import nécessite les droits d'administration sur les OPEX ou sur les CAPEX. L'export nécessite l'accès en lecture à l'un des deux

---

## Exemple de flux : Cycle budgétaire annuel

Voici une séquence typique utilisant ces outils :

### 1. Fin de l'année N

1. Geler le réalisé de l'année N (protéger les données historiques)
2. Copier le Budget N vers le Budget N+1 (avec un pourcentage d'augmentation pour l'inflation)
3. Copier les ventilations N vers N+1

### 2. Pendant la planification budgétaire (N+1)

1. Les équipes modifient la colonne Budget N+1
2. Le directeur financier examine et approuve

### 3. Approbation du budget

1. Geler le Budget N+1 (verrouiller le budget approuvé)
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
