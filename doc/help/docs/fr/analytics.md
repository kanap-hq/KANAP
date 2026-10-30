# Dimensions analytiques

Les dimensions analytiques classent votre budget IT pour le reporting, en dehors de votre structure comptable. Vous choisissez vos propres façons de lire le budget, comme la nature de la dépense ou le programme qu'elle sert, sans retravailler les sociétés, les départements, les comptes ou les centres de coûts.

## Dimensions et valeurs

Une **dimension** est une façon de classer les lignes budgétaires, par exemple **Nature de coût** ou **Domaine IT**. Ses **valeurs** sont les choix qu'elle propose, par exemple **Matériel**, **Logiciel** et **Services externes** pour Nature de coût.

- Chaque dimension a sa propre liste de valeurs.
- Chaque ligne OPEX et CAPEX peut porter une valeur par dimension. Une ligne peut être **Logiciel** sur Nature de coût et **Application** sur Domaine IT en même temps.
- Une ligne peut aussi n'avoir aucune valeur sur une dimension. Les rapports affichent ces lignes comme « Non affecté ».
- Une dimension marquée **Obligatoire** demande une valeur sur chaque nouvelle ligne. Voir [Dimensions obligatoires](#dimensions-obligatoires).

Par exemple :

```
Nature de coût        Domaine IT
  Matériel              Calcul
  Logiciel              Application
  Services externes     Poste de travail
```

### La dimension par défaut

Chaque espace de travail a une dimension par défaut. Dans un nouvel espace de travail, c'est la **Nature de coût**. Sans nom, elle s'affiche comme **Dimension analytique**, dans la langue de chaque personne. Si votre espace de travail avait déjà des valeurs analytiques, elles appartiennent à cette dimension et chaque ligne conserve sa valeur.

La dimension par défaut a un rôle particulier :

- Elle s'applique toujours aux lignes OPEX et CAPEX : son champ **Utilisé pour** est verrouillé. Voir [Dimensions OPEX ou CAPEX](#dimensions-opex-ou-capex).
- Elle ne peut être ni désactivée ni supprimée. Son espace de travail n'a pas de bouton **Supprimer**, et une ligne sous **Cycle de vie** en donne la raison : « Cette dimension ne peut être ni désactivée ni supprimée : les anciens fichiers et les questions posées à l'IA l'utilisent. »
- Les questions posées à Plaid sur la catégorie analytique l'utilisent. Voir [Dimensions analytiques dans Plaid](#dimensions-analytiques-dans-plaid). Dans un fichier budgétaire, chaque dimension a sa propre colonne, dimension par défaut incluse : voir [Charger un budget depuis un tableur](budget-file.md).
- Elle reste la dimension par défaut quand vous la renommez, changez son code ou la déplacez dans l'ordre des dimensions.
- Son libellé est réservé : aucune autre dimension ne peut s'appeler « Dimension analytique », dans aucune des langues de l'application.

### Dimensions recommandées

Un nouvel espace de travail démarre avec quatre dimensions recommandées et leurs valeurs, dans la langue de l'espace de travail. Elles sont activées, utilisées pour les lignes OPEX et CAPEX, et aucune n'est obligatoire :

| Dimension | Code | Valeurs, dans l'ordre |
|---|---|---|
| **Nature de coût** | `default` | Matériel, Logiciel, Main-d'œuvre interne, Main-d'œuvre externe, Services externes, Locaux et énergie, Télécoms, Autres |
| **Domaine IT** | `it_tower` | Data center, Calcul, Stockage, Réseau, Plateforme, Impression, Poste de travail, Application, Support et exploitation, Sécurité et conformité, Pilotage IT |
| **Motif** | `purpose` | Remplacement, Capacité, Productivité, Sécurité, Conformité, Croissance, Autre |
| **Priorité** | `priority` | Obligatoire, Haute, Moyenne, Basse |

- La nature de coût est la dimension par défaut. Les natures de coût et les domaines IT suivent le modèle TBM (Technology Business Management).
- Chaque dimension et chaque valeur a une description, pour que l'équipe classe les lignes de la même façon.
- La langue est celle de l'espace de travail : la langue du navigateur au démarrage de l'essai, ou la langue réglée pour une installation sur vos propres serveurs. Une réinitialisation de l'espace de travail les recrée dans cette langue.
- Elles fonctionnent comme toute autre dimension. Vous pouvez les renommer, renommer leurs valeurs, ajouter des valeurs, changer l'ordre, en rendre une obligatoire, les désactiver ou les supprimer.

**Les ajouter à un espace de travail existant** : cliquez sur **Dimensions recommandées** dans la barre de sélection (nécessite `analytics:admin`). La boîte de dialogue **Ajouter les dimensions recommandées** liste les quatre dimensions, plus **Récurrence** (Récurrent ou Ponctuel), chacune avec une courte description.

- Les dimensions qui manquent à l'espace de travail sont cochées au départ, sauf **Récurrence**. Une dimension déjà présente est grisée et marquée **Déjà présente**, avec son nom dans l'espace de travail, par exemple **Déjà présente (Investment type)** : une ancienne dimension **Investment type** tient lieu de motif.
- **Langue des noms** part de votre langue d'écran.
- Cliquez sur **Ajouter**. Un message liste ce qui a été créé, par exemple « 3 dimensions ajoutées : Nature de coût, Domaine IT, Motif. »
- La nature de coût va sur la dimension par défaut lorsque celle-ci n'a ni nom ni valeur. Sinon, elle est créée comme une nouvelle dimension, avec le code `cost_pool`.
- Quand une autre dimension porte déjà le nom, la nouvelle reçoit un numéro, par exemple **Priorité (2)**.
- Le [journal d'audit](admin.md#journal-daudit) enregistre chaque dimension et chaque valeur créées.

**Les espaces de travail créés avant les dimensions recommandées** gardent trois dimensions qui classent les lignes CAPEX, utilisées pour **CAPEX uniquement**, obligatoires et activées : **PP&E type** (`ppe_type` : Hardware, Software), **Investment type** (`investment_type` : Replacement, Capacity, Productivity, Security, Conformity, Business growth, Other) et **Priority** (`priority` : Mandatory, High, Medium, Low). Leurs noms et leurs valeurs sont en anglais. Elles fonctionnent comme toute autre dimension.

Le code d'une dimension donne son nom à sa colonne dans le fichier budgétaire, par exemple `analytics:it_tower`. Si vous changez un code, un fichier exporté avant le changement porte encore l'ancien nom de colonne et il est refusé avec « Unknown dimension ». Exportez un nouveau fichier. Voir [Charger un budget depuis un tableur](budget-file.md).

---

## Premiers pas

Naviguez vers **Données de référence > Dimensions analytiques** (dans la section **Finance**).

1. **Passez en revue les dimensions recommandées** : un nouvel espace de travail a déjà **Nature de coût**, **Domaine IT**, **Motif** et **Priorité**, avec leurs valeurs. Sélectionnez-en une dans la barre de sélection pour voir ses valeurs. Renommez une valeur, ajoutez-en une ou désactivez celles dont vous n'avez pas besoin. Un espace de travail plus ancien peut les ajouter avec **Dimensions recommandées**. Voir [Dimensions recommandées](#dimensions-recommandees).
2. **Nommez la dimension par défaut** si elle affiche encore « Dimension analytique » : sélectionnez-la dans la barre de sélection, cliquez sur **Modifier**, puis saisissez un nom dans son espace de travail.
3. **Ajoutez une dimension** lorsque vous avez besoin d'une autre façon de lire le budget : cliquez sur **Nouveau** dans la barre de sélection, puis ajoutez ses valeurs avec **Nouvelle valeur**.

**Astuce** : commencez avec quelques dimensions et 5 à 10 valeurs chacune. Un nommage cohérent rend les listes plus faciles à parcourir.

---

## La page Dimensions analytiques

### Le sélecteur de dimension

Sous le titre, une bande grise affiche vos dimensions dans l'ordre, avec un bouton carré par dimension. Elle ressemble au sélecteur des plans comptables et fonctionne de la même façon. Une dimension désactivée est marquée **Désactivé**. Une dimension réservée à un seul type de ligne est marquée **OPEX uniquement** ou **CAPEX uniquement**. Chaque bouton affiche le nom complet de sa dimension. Avec beaucoup de dimensions, les boutons passent sur plusieurs rangées, et les actions restent à droite de la première rangée. Sur un écran étroit, les actions passent sur une rangée à part.

- Cliquez sur un bouton pour lister les valeurs de cette dimension. Le bouton sélectionné est plein. L'adresse de la page conserve votre choix : un lien enregistré en favori s'ouvre sur la même dimension. Sans choix, la page s'ouvre sur la dimension par défaut.
- À droite de la bande, **Modifier** ouvre l'espace de travail de la dimension sélectionnée. Si vous pouvez seulement consulter les dimensions, le bouton affiche **Ouvrir**.
- **Nouveau**, à côté, crée une dimension (nécessite `analytics:member`).
- **Dimensions recommandées** ajoute les dimensions recommandées qui manquent à l'espace de travail (nécessite `analytics:admin`). Voir [Dimensions recommandées](#dimensions-recommandees).
- **Réordonner** définit l'ordre des dimensions (nécessite `analytics:member`). Le bouton est désactivé tant qu'il n'y a qu'une seule dimension. Voir [Ordonner les dimensions](#ordonner-les-dimensions).

Avec une seule dimension, la bande affiche un bouton et les valeurs.

### Liste des valeurs

La liste affiche les valeurs de la dimension sélectionnée, dans l'ordre de la dimension. Voir [Ordonner les valeurs](#ordonner-les-valeurs).

**Colonnes** :

| Colonne | Ce qu'elle affiche |
|---|---|
| **Ordre** | La position de la valeur dans sa dimension. Les valeurs désactivées ont aussi une position : les numéros peuvent donc sauter quand la liste les masque |
| **Nom** | Le nom de la valeur |
| **Description** | Ce que couvre la valeur |
| **Statut** | **Activé** ou **Désactivé** |
| **Utilisé pour** | **OPEX et CAPEX**, **OPEX uniquement** ou **CAPEX uniquement**. Voir [Valeurs OPEX ou CAPEX](#valeurs-opex-ou-capex) |
| **Mis à jour** | Date et heure de la dernière modification |

Cliquez sur n'importe quelle cellule pour ouvrir l'espace de travail de la valeur.

**Filtres** :

- **Recherche rapide** : recherche dans le nom et la description
- **Filtre de statut** : le filtre de la colonne **Statut** reprend le choix de **Afficher** (**Tous**, **Activés** ou **Désactivés**) : changer l'un change l'autre
- **Filtre Utilisé pour** : un filtre par cases à cocher sur la colonne **Utilisé pour**
- **Portée du statut** : le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la liste. Par défaut, la liste affiche les valeurs activées

**Actions** :

- **Nouvelle valeur** : créer une valeur dans la dimension sélectionnée (nécessite `analytics:member`). Tant que la dimension sélectionnée est désactivée, le bouton est désactivé et son info-bulle indique « Activez cette dimension pour ajouter des valeurs. »
- **Réordonner** : définir l'ordre des valeurs de la dimension sélectionnée (nécessite `analytics:member`). Le bouton est désactivé tant que la dimension a moins de deux valeurs. Voir [Ordonner les valeurs](#ordonner-les-valeurs)
- **Importer** : charger des valeurs depuis un fichier (nécessite `analytics:admin`)
- **Exporter** : télécharger les valeurs que la liste affiche, ou les valeurs de toutes les dimensions (nécessite `analytics:admin`)
- **Supprimer la sélection** : supprimer les valeurs sélectionnées (nécessite `analytics:admin`). Lorsque certaines sont utilisées par des lignes budgétaires, la confirmation indique combien de lignes les perdent, par exemple « 2 valeurs sélectionnées sont utilisées : elles sont retirées de 5 lignes budgétaires. Ces données ne peuvent pas être récupérées. », et le bouton devient **Supprimer quand même**

---

## Dimensions

### Créer une dimension

Cliquez sur **Nouveau** dans la barre de sélection, remplissez les champs, puis cliquez sur **Créer**. L'espace de travail de la nouvelle dimension s'ouvre. Une nouvelle dimension est activée.

- Le **Nom** est obligatoire.
- Le **Code** est proposé à partir du nom : en minuscules, sans accents, les espaces remplacés par `-`. Vous pouvez le modifier avant de créer la dimension.
- **Utilisé pour** démarre sur **OPEX et CAPEX**. Voir [Dimensions OPEX ou CAPEX](#dimensions-opex-ou-capex).
- **Obligatoire** démarre désactivé. Voir [Dimensions obligatoires](#dimensions-obligatoires).
- La **Description** est facultative.

Une nouvelle dimension se place en dernier dans l'ordre des dimensions. Revenez ensuite à la page pour ajouter ses valeurs.

### L'espace de travail de la dimension

Ouvrez-le avec **Modifier** (**Ouvrir** si vous pouvez seulement consulter) dans la barre de sélection, la dimension étant sélectionnée. Le bouton **Historique** de l'en-tête ouvre l'historique de la dimension dans un panneau latéral. Voir [Historique des fiches](record-history.md).

- **En-tête** : le nom de la dimension. Cliquez dessus pour renommer la dimension. **Précédent** / **Suivant** parcourent les dimensions dans leur ordre, et le bouton de fermeture ramène à la page sur cette dimension
- **Zone principale** : une ligne d'utilisation, puis la **Description**. La ligne d'utilisation donne le nombre de valeurs et de lignes budgétaires qui portent l'une d'elles, OPEX et CAPEX ensemble, par exemple « 12 valeurs · Utilisée par 29 lignes ». **Utilisée par 29 lignes** est un lien : il ouvre ces lignes dans la liste des lignes budgétaires, dans un nouvel onglet, lignes activées et désactivées comprises. Une dimension qu'aucune ligne n'utilise indique « Pas encore utilisée », et une dimension sans valeur « Aucune valeur pour le moment. » Tant que la dimension est désactivée, le compte s'affiche sans lien
- **Panneau Propriétés** à droite : **Nom**, **Code**, **Utilisé pour**, **Obligatoire**, **Valeurs ouvertes** et **Cycle de vie**

**Enregistrement automatique** : chaque modification s'enregistre d'elle-même. Il n'y a pas de bouton Enregistrer. Les champs texte s'enregistrent quand vous les quittez (dans **Nom** et **Code**, appuyez sur Entrée pour enregistrer aussitôt) ; l'interrupteur **Obligatoire** et le cycle de vie s'enregistrent dès que vous les modifiez. Lorsqu'une modification est refusée, la raison s'affiche sous le champ concerné, par exemple un code en double sous **Code**. Un nom refusé dans l'en-tête s'affiche en haut de la page.

### Champs de la dimension

| Champ | Ce qu'il faut saisir |
|---|---|
| **Nom** | Jusqu'à 200 caractères. Les noms sont uniques sans tenir compte de la casse. Obligatoire, sauf sur la dimension par défaut : laissez-le vide pour afficher « Dimension analytique » dans la langue de chaque personne. Le libellé de la dimension par défaut est réservé dans toutes les langues de l'application (« Analytics dimension », « Dimension analytique », « Analysedimension », « Dimensión analítica »), sans tenir compte de la casse : une autre dimension qui porte l'un de ces noms est refusée avec « This name is reserved for the default dimension. » |
| **Code** | De 1 à 40 caractères : lettres minuscules, chiffres, `-` ou `_`, en commençant par une lettre ou un chiffre. Chaque code est unique. Le code nomme la colonne de la dimension dans les fichiers OPEX et CAPEX : le modifier change donc le nom de cette colonne. Les lignes budgétaires conservent leurs valeurs quand le code change |
| **Description** | À quoi sert la dimension, pour que vos collègues classent les lignes de la même façon |
| **Utilisé pour** | **OPEX et CAPEX**, **OPEX uniquement** ou **CAPEX uniquement**. Indique quelles lignes budgétaires peuvent avoir une valeur sur cette dimension. Voir [Dimensions OPEX ou CAPEX](#dimensions-opex-ou-capex). Verrouillé sur la dimension par défaut, avec une ligne en dessous : « La dimension par défaut s'applique aux lignes OPEX et CAPEX. » |
| **Obligatoire** | Un interrupteur. Activé, il impose une valeur sur cette dimension à chaque nouvelle ligne des types pour lesquels la dimension est utilisée, et une ligne qui porte une valeur ne peut plus la perdre. Voir [Dimensions obligatoires](#dimensions-obligatoires). La dimension par défaut peut aussi être obligatoire |
| **Valeurs ouvertes** | Un interrupteur, éteint par défaut. Allumé, il permet à toute personne qui peut modifier une ligne d'ajouter une valeur, depuis la ligne ou le fichier budget. Voir [Valeurs ouvertes](#open-values) |
| **Cycle de vie** | L'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité**. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie). Verrouillé sur la dimension par défaut, avec une ligne en dessous : « Cette dimension ne peut être ni désactivée ni supprimée : les anciens fichiers et les questions posées à l'IA l'utilisent. » |

### Ordonner les dimensions

Les dimensions ont un ordre, que vous définissez. KANAP les présente dans cet ordre :

- dans la barre de sélection de cette page
- dans le panneau **Propriétés** des lignes OPEX et CAPEX
- dans les colonnes de la liste des lignes budgétaires
- dans les colonnes du fichier budgétaire
- dans les filtres des rapports et le sélecteur de dimension du rapport
- dans les dimensions que liste Plaid

Une nouvelle dimension se place en dernier.

Pour changer l'ordre :

1. Cliquez sur **Réordonner** dans la barre de sélection. La boîte de dialogue liste toutes les dimensions, y compris les dimensions désactivées et celles réservées à un type de ligne, chacune avec ses mentions (**Par défaut**, **Désactivée**, **OPEX uniquement**, **CAPEX uniquement**).
2. Faites glisser les dimensions à leur place, avec la souris ou au clavier. Les touches sont les mêmes que pour les valeurs : voir [Ordonner les valeurs](#ordonner-les-valeurs).
3. Cliquez sur **Enregistrer**. **Annuler** laisse l'ordre tel qu'il était.

Le nouvel ordre s'affiche aussitôt. Le [Journal d'audit](admin.md#journal-daudit) enregistre une modification pour chaque dimension déplacée, avec sa position avant et après.

### Dimensions OPEX ou CAPEX

Le champ **Utilisé pour** indique à quelles lignes budgétaires la dimension s'applique :

| Valeur | Signification |
|--------|---------------|
| **OPEX et CAPEX** | Les lignes OPEX et CAPEX peuvent toutes deux avoir une valeur sur la dimension. C'est le choix par défaut |
| **OPEX uniquement** | Seules les lignes OPEX peuvent avoir une valeur |
| **CAPEX uniquement** | Seules les lignes CAPEX peuvent avoir une valeur |

Les écrans OPEX affichent les dimensions utilisées pour les lignes OPEX, et les écrans CAPEX celles utilisées pour les lignes CAPEX. Cela concerne le panneau **Propriétés** de la ligne, les colonnes, les filtres et la recherche rapide des listes, les sélecteurs et les filtres de dimension des rapports (ils suivent le choix **OPEX** / **CAPEX** du rapport) et Plaid. Le fichier budgétaire a une colonne pour chaque dimension activée, et chaque ligne ne prend de valeurs que sur les dimensions de son type de ligne.

Une ligne garde la valeur qu'elle a déjà sur une dimension qui ne s'applique plus à son type de ligne. La valeur est masquée partout et réapparaît si vous rouvrez la dimension à ce type de ligne. Lorsque votre choix masque des valeurs, une note s'affiche sous le champ, par exemple « 8 lignes CAPEX ont une valeur pour cette dimension. Elles la gardent, masquée tant que la dimension est réservée aux lignes OPEX. »

Donner à une ligne une valeur sur une dimension qui ne s'applique pas à elle est refusé, dans l'application, dans un fichier budgétaire et par l'API. Dans l'application et par l'API, renvoyer la valeur que la ligne porte déjà ne change rien. Dans un fichier budgétaire, laissez cette cellule vide : l'export le fait.

Une même valeur peut aussi être réservée à un seul type de ligne. Les deux réglages agissent à des niveaux différents. Par exemple, la dimension **Nature de coût** est utilisée pour **OPEX et CAPEX**, et sa valeur **Main-d'œuvre interne** est réservée à **OPEX uniquement** :

- Le réglage de la dimension décide si le champ existe pour un type de ligne. Quand le champ disparaît, les valeurs que portent les lignes sont masquées.
- Le réglage de la valeur filtre les choix. Le champ reste, les lignes CAPEX ne proposent plus **Main-d'œuvre interne**, et une ligne CAPEX qui l'a déjà le garde, l'affiche et reste modifiable. Voir [Valeurs OPEX ou CAPEX](#valeurs-opex-ou-capex).

Les deux réglages doivent concorder. Une dimension ne peut pas être réglée sur un seul type de ligne tant que certaines de ses valeurs sont réservées à l'autre type : KANAP refuse et nomme les valeurs (trois au plus, puis « and N more »), par exemple « 2 values of this dimension are for CAPEX lines only (Matériel, Logiciel). Set them to OPEX and CAPEX first. »

### Dimensions obligatoires

Activez **Obligatoire** lorsque chaque ligne budgétaire doit être classée sur une dimension. KANAP contrôle alors les lignes des types pour lesquels la dimension est utilisée :

- **Une nouvelle ligne doit avoir une valeur sur la dimension.** Cela vaut pour toutes les façons de créer une ligne : les écrans OPEX et CAPEX, un fichier budgétaire, Plaid et l'API. Sans valeur, la ligne n'est pas créée, avec le message « The Nature de coût dimension is required. Choose a value. »
- **Une ligne qui porte une valeur ne peut pas la perdre.** Vous pouvez choisir une autre valeur. Le champ ne peut pas être vidé.
- **Une ligne créée avant l'activation du réglage continue de fonctionner.** Si elle n'a pas de valeur sur la dimension, elle reste modifiable et vous pouvez y enregistrer d'autres modifications. Son champ est marqué comme obligatoire. Sur les écrans OPEX et CAPEX, quitter une telle ligne après l'avoir modifiée vous demande d'abord de choisir une valeur, avec **Rester** et **Quitter quand même**. L'ouvrir sans rien modifier ne demande jamais rien.

Le réglage n'est contrôlé que tant que la dimension est activée. Une dimension désactivée garde son réglage, et une ligne sous l'interrupteur indique « Pas de contrôle tant que la dimension est désactivée. » Une dimension utilisée pour un seul type de ligne n'est contrôlée que sur ce type : une dimension **OPEX uniquement** et obligatoire n'impose rien aux lignes CAPEX.

Tant que le réglage est activé, des lignes sous l'interrupteur vous aident à compléter les lignes existantes :

- **Lignes sans valeur** : par exemple « 117 lignes OPEX et 15 lignes CAPEX n'ont pas de valeur. » Chaque type de ligne a son propre lien, **Afficher les lignes OPEX** et **Afficher les lignes CAPEX** (**Afficher ces lignes** lorsqu'un seul type est concerné). Le lien ouvre les lignes dans leur liste, dans un nouvel onglet, lignes activées et désactivées comprises.
- **Aucune valeur à choisir** : lorsqu'un type de ligne pour lequel la dimension est utilisée n'a aucune valeur activée utilisable, un avertissement le signale, par exemple « Aucune valeur activée n'est utilisable sur les lignes CAPEX. Aucune nouvelle ligne CAPEX ne peut être créée. » Ajoutez une valeur pour ce type de ligne, ou activez-en une. Voir [Valeurs OPEX ou CAPEX](#valeurs-opex-ou-capex).

### Valeurs ouvertes { #open-values }

Une dimension dont l'interrupteur **Valeurs ouvertes** est allumé reçoit de nouvelles valeurs depuis les lignes elles-mêmes : une référence budgétaire, un code projet, un numéro de commande. Dans le champ d'une ligne, taper un nom qui n'existe pas propose **Ajouter « … »**, qui crée la valeur. Le fichier budget la crée de la même façon. Toute personne qui peut modifier la ligne le fait, y compris les personnes dont l'[accès aux données](data-access.md) est limité.

Sur une dimension dont l'interrupteur est éteint, les valeurs se créent sur cette page, et le fichier budget ne crée les valeurs inconnues que pour les personnes qui ont accès à toutes les données. L'interrupteur est affiché aux personnes qui peuvent modifier les dimensions et qui ont accès à toutes les données.

### Supprimer une dimension

Le bouton **Supprimer** (icône corbeille) de l'en-tête supprime la dimension avec ses valeurs (nécessite `analytics:admin`) :

- Une dimension sans valeur demande d'abord (« Cette action est irréversible. »), puis **Supprimer**.
- Une dimension dont aucune ligne n'utilise les valeurs demande d'abord, par exemple « Supprimer Récurrence ? » avec « Ses 2 valeurs sont supprimées aussi. », puis **Supprimer**.
- Une dimension utilisée par des lignes budgétaires demande d'abord, avec le nombre de lignes : « Ses 3 valeurs sont supprimées, et elle est retirée de 6 lignes budgétaires. Ces données ne peuvent pas être récupérées. » Cliquez sur **Supprimer quand même** pour continuer. Les lignes perdent leur valeur sur cette dimension, et leur historique enregistre le changement.

La dimension par défaut n'a pas de bouton **Supprimer** : elle ne peut pas être supprimée. Le [journal d'audit](admin.md#journal-daudit) enregistre la dimension supprimée avec ses nombres de valeurs et de lignes, chaque valeur supprimée, et chaque ligne qui a perdu une valeur.

Pour conserver plutôt les valeurs sur les lignes, désactivez la dimension.

---

## Valeurs

### Créer une valeur

Cliquez sur **Nouvelle valeur**. Le champ **Dimension** commence sur la dimension sélectionnée sur la page et ne propose que les dimensions activées. Saisissez le **Nom**, et une **Description** si vous le souhaitez. **Utilisé pour** commence sur **OPEX et CAPEX** : changez-le si la valeur ne convient qu'à un type de ligne. Cliquez ensuite sur **Créer**. L'espace de travail de la nouvelle valeur s'ouvre. Une nouvelle valeur est activée.

### L'espace de travail de la valeur

- **En-tête** : le nom de la valeur. Cliquez dessus pour renommer la valeur. **Précédent** / **Suivant** parcourent les valeurs de la même dimension, dans l'ordre et avec les filtres actuels de la liste. Le bouton de fermeture ramène à la liste
- **Zone principale** : une ligne d'utilisation, puis la **Description**. La ligne d'utilisation compte les lignes budgétaires qui portent la valeur, OPEX et CAPEX ensemble, par exemple « Utilisée par 4 lignes ». C'est un lien qui ouvre ces lignes dans la liste des lignes budgétaires, dans un nouvel onglet. Une valeur qu'aucune ligne n'utilise indique « Pas encore utilisée ». Tant que la dimension est désactivée, le compte s'affiche sans lien
- **Panneau Propriétés** à droite : **Dimension** (en lecture seule), **Utilisé pour** et **Cycle de vie**

Le bouton **Historique** de l'en-tête ouvre l'historique de la valeur dans un panneau latéral. Voir [Historique des fiches](record-history.md).

Les modifications s'enregistrent d'elles-mêmes, comme dans l'espace de travail de la dimension. Un nom refusé dans l'en-tête s'affiche en haut de la page.

### Règles des valeurs

- **Une liste par dimension** : les noms sont uniques au sein d'une dimension, sans tenir compte de la casse. Deux dimensions peuvent chacune avoir une valeur appelée « Other ». Un doublon est refusé, par exemple « A value named Logiciel already exists in Nature de coût. »
- **Une valeur reste dans sa dimension** : la dimension est fixée à la création de la valeur et ne peut pas changer. Pour déplacer une valeur, créez-la dans l'autre dimension, modifiez les lignes, puis supprimez l'ancienne valeur.
- **Renommer conserve les lignes** : les lignes pointent vers la valeur elle-même, le nouveau nom s'affiche donc aussitôt dans les listes et les rapports.
- **Supprimer** : le bouton **Supprimer** (icône corbeille) de l'en-tête supprime une valeur qu'aucune ligne n'utilise après une confirmation (« Cette action est irréversible. », puis **Supprimer** ; nécessite `analytics:admin`). Lorsque des lignes budgétaires utilisent la valeur, il demande d'abord : « Elle est retirée de 4 lignes budgétaires. Ces données ne peuvent pas être récupérées. » Cliquez sur **Supprimer quand même** pour continuer, ou désactivez plutôt la valeur pour la garder sur les lignes.

### Ordonner les valeurs

Les valeurs d'une dimension ont un ordre, que vous définissez. KANAP propose les valeurs dans cet ordre partout où vous les choisissez ou filtrez sur elles :

- les champs de valeur des lignes OPEX et CAPEX (quand vous tapez dans un champ, les meilleures correspondances viennent en premier)
- les filtres à cases à cocher de la dimension dans la liste des lignes budgétaires
- les filtres de dimension des rapports et la liste **Exclure des valeurs** du rapport Dimensions analytiques
- l'export des valeurs
- les valeurs que liste Plaid

Trier la liste des lignes budgétaires sur la colonne d'une dimension suit aussi cet ordre, puis le nom de la valeur. Les lignes sans valeur viennent en dernier dans l'ordre croissant. Les lignes des rapports gardent leur propre ordre, par montant.

Au départ, les valeurs sont dans l'ordre alphabétique. Une nouvelle valeur se place en dernier dans sa dimension.

Pour changer l'ordre :

1. Sélectionnez la dimension sur la page et cliquez sur **Réordonner**. La boîte de dialogue liste toutes les valeurs de la dimension, y compris les valeurs désactivées et celles réservées à un type de ligne, chacune avec sa mention (**Désactivée**, **OPEX uniquement**, **CAPEX uniquement**).
2. Faites glisser les valeurs à leur place avec la souris. Au clavier, placez-vous sur une valeur, appuyez sur Espace ou Entrée pour la saisir, déplacez-la avec les flèches, puis appuyez sur Espace ou Entrée pour la déposer. Échap la remet à sa place.
3. Cliquez sur **Enregistrer**. **Annuler** laisse l'ordre tel qu'il était.

Le nouvel ordre s'affiche aussitôt dans les listes et les filtres. Le [Journal d'audit](admin.md#journal-daudit) enregistre la modification sur la dimension, avec l'ordre avant et après.

### Valeurs OPEX ou CAPEX

Le champ **Utilisé pour** d'une valeur indique quelles lignes budgétaires peuvent l'utiliser :

| Valeur | Signification |
|--------|---------------|
| **OPEX et CAPEX** | Les lignes OPEX et CAPEX peuvent utiliser la valeur. C'est le choix par défaut |
| **OPEX uniquement** | Seules les lignes OPEX peuvent utiliser la valeur |
| **CAPEX uniquement** | Seules les lignes CAPEX peuvent utiliser la valeur |

Le champ d'une ligne OPEX propose les valeurs pour OPEX et celles pour les deux. Le champ d'une ligne CAPEX fait de même pour CAPEX. Une ligne qui porte déjà une valeur de l'autre type la garde, l'affiche et reste modifiable, comme pour une valeur désactivée. Choisir une telle valeur pour une autre ligne, ou en changeant la valeur d'une ligne, est refusé : dans l'application, dans un fichier budgétaire, par l'API et dans Plaid.

- Lorsque la dimension est utilisée pour un seul type de ligne, le type qu'elle exclut n'est pas disponible dans le champ, avec une ligne comme « La dimension Domaine IT est réservée aux lignes OPEX. » **OPEX et CAPEX** et le type propre à la dimension restent sélectionnables. Une valeur ne peut pas être réservée au type de ligne que sa dimension exclut.
- Lorsque des lignes de l'autre type portent la valeur, une ligne s'affiche sous le champ, par exemple « 4 lignes CAPEX ont cette valeur. Elles la gardent, mais les nouvelles lignes CAPEX ne peuvent pas la choisir. » Cliquez sur **Afficher ces lignes** pour les ouvrir dans la liste, dans un nouvel onglet. La ligne reste tant que le conflit existe.
- Le rapport Dimensions analytiques propose, dans sa liste **Exclure des valeurs**, les valeurs du type choisi. Voir [Rapports](reports.md#dimensions-analytiques).

---

## Statut et cycle de vie

Les dimensions et les valeurs ont chacune un statut (**Activé** ou **Désactivé**) et une **Fin de validité** facultative. Ils permettent de retirer une dimension ou une valeur sans la supprimer.

- **Fin de validité** : la date à laquelle elle s'arrête. Laissez-la vide pour qu'elle reste active. Vous pouvez aussi programmer une date future.
- Passer à **Désactivé** fixe la fin de validité à maintenant : la désactivation est immédiate. Tant qu'une date future est fixée, l'interrupteur affiche **Actif jusqu'au** et cette date. Repasser à **Activé** efface la date.
- Une fois la fin de validité passée, le statut passe à **Désactivé** de lui-même dans l'heure.

**Une valeur désactivée** :

- Ne peut pas être choisie pour une ligne, dans l'application, dans un fichier importé ou via Plaid.
- Reste sur les lignes qui l'ont déjà et continue de compter dans les rapports. Dans la liste du champ, elle est marquée **Désactivé**.

**Une dimension désactivée** :

- N'est pas contrôlée lorsqu'elle est **Obligatoire** : des lignes peuvent être créées sans valeur sur elle. Elle garde le réglage pour le jour où vous la réactivez.
- Disparaît des formulaires des lignes, de la liste des lignes budgétaires, des filtres des rapports, du sélecteur de dimension du rapport, des exports OPEX et CAPEX et de Plaid. Seule la page Dimensions analytiques l'affiche, marquée **Désactivé**.
- Conserve ses valeurs sur les lignes. Réactivez la dimension et elles s'affichent de nouveau.
- Ne reçoit plus de nouvelles valeurs. **Nouvelle valeur** est désactivé tant que la dimension est sélectionnée, et les fichiers importés ne peuvent ni ajouter ni modifier ses valeurs.

La dimension par défaut ne peut pas être désactivée.

**Préférez la désactivation à la suppression** : désactiver garde les rapports cohérents tout en gardant les listes propres.

---

## Valeurs sur les lignes budgétaires

Dans le panneau **Propriétés** d'une ligne OPEX ou CAPEX, et lorsque vous en créez une, chaque dimension activée utilisée pour ce type de ligne a son propre champ, au nom de la dimension, dans l'ordre des dimensions. La dimension par défaut s'affiche comme **Dimension analytique** tant que vous ne la renommez pas.

- Choisissez une valeur, ou videz le champ pour laisser la ligne sans valeur sur cette dimension. La modification s'enregistre aussitôt.
- Le champ d'une dimension obligatoire est marqué d'un astérisque. Une nouvelle ligne ne peut pas être créée sans valeur sur cette dimension, avec le message « Nature de coût est obligatoire ». Sur une ligne qui porte une valeur, le champ n'a pas de bouton d'effacement : vous pouvez seulement choisir une autre valeur. Voir [Dimensions obligatoires](#dimensions-obligatoires).
- Le champ liste les valeurs activées de sa dimension utilisées pour ce type de ligne. Une valeur désactivée, ou une valeur réservée à l'autre type de ligne, reste affichée sur les lignes qui l'ont. Voir [Valeurs OPEX ou CAPEX](#valeurs-opex-ou-capex).
- Sur une dimension à [valeurs ouvertes](#open-values), le champ propose **Ajouter « … »** pour un nom qui n'existe pas. Sur les autres dimensions, le champ ne peut pas créer de valeur : créez les valeurs sur la page Dimensions analytiques, ou laissez le fichier budget les créer.
- Une valeur s'applique à toute la ligne, sur toutes les années.
- Si les dimensions ne peuvent pas être chargées, une ligne remplace ces champs : « Les dimensions n'ont pas pu être chargées. »

La liste des lignes budgétaires a une colonne par dimension activée, avec un filtre par cases à cocher. La colonne d'une dimension obligatoire pour les lignes OPEX ou CAPEX s'affiche par défaut, et les autres colonnes sont masquées. Une disposition de colonnes que vous avez enregistrée garde son propre choix. Voir [Lignes budgétaires](budget-lines.md).

---

## Rapports

Le rapport **Dimensions analytiques** (sous **Rapports**) montre comment le budget de vos lignes OPEX ou CAPEX se répartit entre les valeurs d'une dimension. Voir [Rapports](reports.md#dimensions-analytiques) pour la description complète.

- **Type de ligne** : OPEX ou CAPEX
- **Dimension** : la dimension sur laquelle le rapport regroupe. Elle s'affiche lorsque vous avez au moins deux dimensions activées, et commence sur la dimension par défaut
- **Plage d'années** : une seule année (graphique en secteurs ou en barres) ou plusieurs années (graphique en courbe)
- **Métrique** : toute colonne budgétaire affichée par votre organisation, sous son nom. Démarre sur la colonne par défaut
- **Exclure des valeurs** : écarter certaines valeurs pour vous concentrer sur les autres. La liste propose les valeurs utilisées pour le type de ligne choisi, plus celles que portent les lignes

Les sept rapports budgétaires peuvent aussi être restreints à une valeur d'une dimension, avec un filtre par dimension. Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](reports.md#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques).

---

## Dimensions analytiques dans Plaid

- Plaid peut filtrer et regrouper les lignes OPEX sur chaque dimension activée utilisée pour les lignes OPEX, et les lignes CAPEX sur chaque dimension activée utilisée pour les lignes CAPEX.
- Une question sur la catégorie analytique utilise la dimension par défaut, quels que soient son nom ou son ordre.
- La recherche de Plaid et les mentions `@` du chat trouvent une ligne budgétaire par le nom d'une valeur qu'elle porte sur une dimension affichée pour son type, avec ou sans accents.
- Plaid peut définir, modifier ou effacer la valeur d'une ligne sur n'importe quelle dimension lorsqu'il crée ou met à jour une ligne budgétaire. Demandez par exemple : « Mets la Nature de coût de BL-12 sur Logiciel ». Plaid trouve la valeur par son nom dans cette dimension et affiche dans l'aperçu la dimension et la valeur, avant et après. Rien ne change tant que vous n'avez pas approuvé.
- Plaid applique les mêmes règles que l'application : uniquement les dimensions activées utilisées pour le type de la ligne, uniquement les valeurs activées utilisées pour le type de la ligne, et une ligne conserve une valeur qu'elle porte déjà.
- Quand Plaid crée une ligne, il lui faut une valeur sur chaque dimension obligatoire du type de la ligne. Dans un espace de travail créé avant les dimensions recommandées, une ligne CAPEX demande **PP&E type**, **Investment type** et **Priority**.
- Plaid sait quelles dimensions sont obligatoires. Une nouvelle ligne doit avoir une valeur sur chacune d'elles, et Plaid ne peut pas effacer la valeur d'une dimension obligatoire. Plaid refuse une demande qui enfreint la règle et en donne la raison, par exemple « Nature de coût is required for spend item creation. »
- Plaid peut aussi créer une valeur dans la dimension que vous nommez. Sans dimension, la valeur est créée dans la dimension par défaut.
- Avec le droit de lecture sur l'analytique, Plaid lit aussi les réglages de chaque dimension, son nombre de valeurs et les lignes qui l'utilisent. Demandez par exemple : « Quelles dimensions sont obligatoires ? »

---

## Import/export CSV

L'export écrit un fichier CSV ou un classeur Excel (`.xlsx`) : choisissez sous **Format** dans la fenêtre. L'import lit l'un ou l'autre. Voir [Fichiers CSV et Excel](csv-files.md).

Chargez ou mettez à jour les valeurs de toutes les dimensions depuis un seul fichier. Les dimensions se créent sur la page.

Pour renseigner des valeurs sur les lignes budgétaires depuis un fichier, utilisez le fichier budgétaire. Une colonne `analytics:<code>` y porte chaque dimension activée, dimension par défaut incluse. Voir [Charger un budget depuis un tableur](budget-file.md).

**Export** : cliquez sur **Exporter**, puis sur **Exporter les données**. Le fichier liste les valeurs de toutes les dimensions, activées ou désactivées, dimension par dimension, les valeurs de chaque dimension dans son ordre. Le fichier n'a pas de colonne d'ordre. Pour un fichier vide avec les seuls en-têtes, utilisez **Télécharger le modèle** dans la boîte de dialogue d'import.

**Structure du CSV** :

- En-têtes : `axis_code`, `name`, `description`, `status`, `disabled_at`, `applies_to`
- L'export écrit le séparateur de la langue de l'écran. Voir [Fichiers CSV et Excel](csv-files.md) pour l'encodage, le séparateur, les formes de dates et les deux étapes d'import

| Colonne | Contenu |
|---|---|
| `axis_code` | Le code de la dimension de la valeur, sans tenir compte de la casse. Vide signifie la dimension par défaut |
| `name` | Obligatoire. Le nom de la valeur |
| `description` | Texte libre |
| `status` | `enabled` ou `disabled`. Vide signifie `enabled` pour une nouvelle valeur et conserve le statut enregistré lors d'une mise à jour |
| `disabled_at` | La fin de validité : une date (`2026-12-31`) ou une date et une heure complètes. L'export écrit la date seule. Réimportée, cette date conserve la fin de validité enregistrée. Vide s'il n'y a pas de fin. Lors d'une mise à jour, un `status` vide et un `disabled_at` vide conservent les valeurs enregistrées. `enabled` avec une date vide efface la fin de validité. `disabled` avec une date vide conserve une date déjà passée, et sinon termine la valeur aujourd'hui |
| `applies_to` | Le réglage **Utilisé pour**, toujours la dernière colonne. `opex`, `capex`, ou vide pour **OPEX et CAPEX**. Un fichier sans cette colonne laisse les réglages tels quels. Une cellule vide règle sur **OPEX et CAPEX** |

Seule la colonne `name` est obligatoire. Lorsque la colonne `description`, `status`, `disabled_at` ou `applies_to` manque, les valeurs existantes conservent ce qui est enregistré, et les nouvelles valeurs sont activées, sans description. Un fichier sans `axis_code` place toutes les lignes dans la dimension par défaut.

**Import** :

1. Cliquez sur **Importer** sur la page
2. Choisissez votre fichier
3. Cliquez sur **Vérification préalable**. Le rapport donne le nombre de lignes, les valeurs à créer et à mettre à jour, et les lignes qui ne changent rien
4. Si la vérification préalable est sans erreur, cliquez sur **Charger**

**Fonctionnement de l'import** :

- **Le fichier entier est vérifié avant toute écriture.** Un fichier comportant une erreur ne charge rien : corrigez les lignes et relancez la vérification préalable. Chaque erreur désigne sa ligne par le numéro de ligne du fichier tel qu'un éditeur de texte l'affiche, lignes vides et cellules sur plusieurs lignes comprises.
- **Rapprochement par dimension et par nom** : une ligne dont le nom existe dans sa dimension met à jour cette valeur ; toute autre ligne en crée une. Chaque cellule remplace la valeur enregistrée : une `description` vide l'efface donc. Un nom écrit avec une autre casse trouve la valeur enregistrée et ne la renomme pas. Pour renommer une valeur, renommez-la sur la page.
- **Lignes inchangées** : une ligne identique à la valeur enregistrée ne change rien. Exporter puis importer le même fichier signale toutes les lignes comme inchangées.
- **Dimensions désactivées** : une ligne d'une dimension désactivée est acceptée si elle ne change rien. Un fichier exporté s'importe donc tel quel. Une ligne qui créerait ou modifierait une valeur dans cette dimension est refusée.
- **Les valeurs absentes du fichier** restent telles quelles. L'import ne supprime jamais rien.
- **Ordre** : les valeurs existantes gardent leur place. Les nouvelles valeurs se placent en dernier dans leur dimension, dans l'ordre du fichier. Pour changer l'ordre, utilisez **Réordonner** sur la page.

**Erreurs courantes** :

- **« Unknown dimension '...'. »** : la cellule `axis_code` ne correspond à aucune dimension. Vérifiez le code dans l'espace de travail de la dimension, ou créez d'abord la dimension.
- **« The ... dimension is disabled. Enable it or leave it out. »** : une ligne crée ou modifie une valeur dans une dimension désactivée. Activez la dimension, ou retirez la ligne.
- **« ... is already on row N. »** : deux lignes portent le même nom pour la même dimension. Gardez-en une.
- **« Invalid status '...'. Use 'enabled' or 'disabled'. »** : corrigez la cellule `status`.
- **« Invalid applies_to '...'. Use 'opex', 'capex' or leave it empty. »** : corrigez la cellule `applies_to`.
- **« The ... dimension is for OPEX lines only. »** (ou CAPEX) : la ligne réserve une valeur au type de ligne que sa dimension exclut. Corrigez la cellule `applies_to`, ou changez le réglage **Utilisé pour** de la dimension.
- **« Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again. »** : la ligne est activée avec une date déjà passée. Un fichier exporté avant cette date indique encore `enabled` : exportez à nouveau, ou corrigez la cellule.
- **« Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed. »** : la ligne est désactivée avec une date encore à venir. Corrigez la cellule `status` ou `disabled_at`.
- **« En-tête : Colonnes manquantes : ... »** ou **« En-tête : Colonnes inconnues : ... »** : téléchargez un nouveau modèle.

---

## Permissions

| Niveau | Ce qu'il permet |
|---|---|
| `analytics:reader` | Consulter la page Dimensions analytiques et ouvrir les dimensions et les valeurs |
| `analytics:member` | Créer des dimensions et des valeurs, les modifier et définir l'ordre des dimensions et des valeurs |
| `analytics:admin` | Tout ce qui précède, plus l'import et l'export, les dimensions recommandées, et la suppression |

Le rôle intégré Administrateur budget est admin, Membre budget est member et Lecteur budget est reader. Toute personne qui peut consulter les lignes budgétaires (Budget) ou les rapports voit les dimensions et leurs valeurs sur les lignes budgétaires, dans les listes et dans les rapports, sans accès à cette page.

---

## Astuces

- **Restez simple** : quelques dimensions de 5 à 10 valeurs larges chacune en révèlent généralement plus que des dizaines de valeurs détaillées.
- **Une question par dimension** : chaque dimension doit répondre à une seule question sur la dépense, comme « de quel type de dépense s'agit-il ? » ou « quel programme sert-elle ? ».
- **Documentez avec des descriptions** : une courte description aide beaucoup à un usage cohérent entre les équipes.
- **Laissez des vides quand il le faut** : « Non affecté » est un état valide. Évitez les valeurs fourre-tout vagues créées seulement pour combler le vide.
- **Désactivez plutôt que supprimer** : retirer une valeur garde les rapports exacts.
- **Utilisez les rapports pour affiner** : lancez le rapport Dimensions analytiques de temps en temps. Si une valeur capte trop ou trop peu de dépenses, scindez-la ou fusionnez-la.

---

## Questions fréquentes

**Une ligne peut-elle avoir plusieurs valeurs analytiques ?**
Oui, une par dimension. Une ligne peut être **Logiciel** sur Nature de coût et **Application** sur Domaine IT. Au sein d'une dimension, une ligne a une valeur ou aucune.

**Les dimensions analytiques affectent-elles les ventilations ou la comptabilité ?**
Non. Elles servent uniquement au reporting et n'ont aucun impact sur les ventilations de coûts ou la comptabilité formelle.

**Combien de valeurs dois-je créer ?**
Commencez avec 5 à 10 par dimension. Au-delà de 20, la dimension essaie généralement de répondre à trop de questions : scindez-la en deux dimensions.

**Quelle est la différence entre dimensions analytiques, départements et centres de coûts ?**
Les **départements** sont des unités organisationnelles formelles avec des clés de ventilation précises. Les **centres de coûts** indiquent qui porte la dépense et en répond. Les **dimensions analytiques** sont des classifications libres et facultatives pour le reporting, sans ventilation ni responsabilité associées.

**Pourquoi certaines lignes affichent-elles « Non affecté » ?**
Dans le rapport Dimensions analytiques, les lignes sans valeur sur la dimension choisie apparaissent comme « Non affecté ». C'est attendu : les valeurs sont facultatives, sauf si la dimension est obligatoire. Même dans ce cas, des lignes créées avant l'activation du réglage peuvent ne pas avoir de valeur. L'espace de travail de la dimension les compte et donne un lien vers elles.

**Que deviennent les lignes quand je renomme une valeur ou une dimension ?**
Rien ne change sur les lignes. Les listes et les rapports affichent aussitôt le nouveau nom.
