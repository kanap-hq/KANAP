# Lignes budgétaires

Une ligne budgétaire est un élément que votre budget IT paie, suivi d'année en année. Son **Type** indique de quelle dépense il s'agit :

- **OPEX** (dépenses opérationnelles) : coûts récurrents comme les licences logicielles, les abonnements cloud, les contrats de maintenance et les services
- **CAPEX** (dépenses d'investissement) : investissements dans des actifs à long terme comme les achats de matériel, les projets d'infrastructure et les équipements

Les deux types se trouvent dans une seule liste et s'ouvrent dans le même espace de travail, avec des colonnes budgétaires année par année, des ventilations et des liens vers les fournisseurs, contrats, applications et projets. Le type change quelques règles (comptes, dimensions, refacturation, gels). [OPEX et CAPEX](#opex-et-capex) les liste.

## Premiers pas

Rendez-vous dans **Gestion budgétaire > Lignes budgétaires** pour voir la liste. Cliquez sur **Nouvelle ligne** pour créer une ligne.

L'espace de travail s'ouvre en mode création, intitulé **Nouvelle ligne OPEX** ou **Nouvelle ligne CAPEX**, avec le panneau **Propriétés** ouvert à droite. Sa première rangée est **Type** : choisissez **OPEX** ou **CAPEX**. Il démarre sur le type sur lequel la liste est filtrée dans sa colonne **Type**, sinon sur **OPEX**. Saisissez le nom de la ligne dans le titre en haut, remplissez les propriétés, puis cliquez sur **Créer**.

**Champs obligatoires** :

- **Titre** : Ce que vous dépensez ou ce dans quoi vous investissez (ex. : « Licences Salesforce », « Nouvelle infrastructure serveur »). Il s'affiche dans la colonne **Nom du produit** de la liste
- **Société payeuse** : Quelle société paie (obligatoire pour la comptabilité)
- **Compte** : Le compte du grand livre. Seuls les comptes du plan comptable de la société payeuse apparaissent, et seulement ceux qui conviennent au type de la ligne dans [Plans comptables et gestion des comptes](chart-of-accounts.md#comptes-opex-ou-capex) : **OPEX et CAPEX**, ou **OPEX uniquement** pour une ligne OPEX et **CAPEX uniquement** pour une ligne CAPEX. Une ligne qui a déjà un compte réservé à l'autre type le conserve et reste modifiable. Choisir un tel compte sur une nouvelle ligne, ou en changeant le compte, est refusé
- **Devise** : Code ISO (ex. : USD, EUR). Par défaut la devise de votre espace de travail ; modifiable par ligne
- **Début d'effet** : Quand cette dépense commence (JJ/MM/AAAA)
- **Dimensions obligatoires** : un champ par dimension obligatoire pour le type de la ligne. Une ligne CAPEX demande au départ **PP&E type**, **Investment type** et **Priority**. Voir [Dimensions CAPEX](#dimensions-capex)

**Optionnel mais utile** :

- **Fournisseur** : À qui vous payez. Lié à vos fournisseurs dans les données de référence
- **Centre de coûts** : Qui porte la dépense. Voir [Centres de coûts](cost-centers.md). Lorsque la société payeuse est encore vide, choisir un centre de coûts la remplit avec la société du centre de coûts
- **Run ou build** : **Run** pour une dépense qui maintient les services existants, **Build** pour une dépense qui les crée ou les fait évoluer
- **Dimensions analytiques** : Un champ par dimension utilisée pour le type de la ligne, à son nom, pour des regroupements personnalisés dans les rapports (ex. : « Licenses » sur Nature). La dimension par défaut s'affiche comme **Dimension analytique** tant qu'elle n'est pas renommée. Voir [Dimensions analytiques](analytics.md)
- **Fin de validité** : La date à laquelle cette ligne s'arrête. Laissez-la vide s'il n'y a pas de fin. Après cette date, la ligne est désactivée et les années suivantes ne comptent plus dans les vues budgétaires
- **Responsable IT** / **Responsable métier** : Qui est en charge
- **Description** et **Notes** : Texte libre dans l'onglet **Vue d'ensemble**, pour les deux types

Une fois renseignés, **Société payeuse** et **Compte** peuvent être modifiés mais pas vidés. **Fournisseur** peut être effacé à tout moment.

Lorsque vous changez la société payeuse d'une ligne qui a un compte, et que la nouvelle société utilise un autre plan comptable, le compte est effacé dans le même enregistrement. **Compte** apparaît alors comme obligatoire, avec la liste sur le plan comptable de la nouvelle société. Choisissez le nouveau compte pour terminer.

Une fois la ligne créée, l'espace de travail déverrouille les quatre onglets : **Vue d'ensemble**, **Budget**, **Ventilations** et **Relations**.

**Conseil** : Vous pouvez créer des lignes rapidement et remplir les budgets et ventilations plus tard. Commencez par l'essentiel et itérez.

---

## OPEX et CAPEX

Chaque ligne a un type, affiché dans la colonne **Type** de la liste et dans la première rangée du panneau **Propriétés**. La plus grande partie de l'espace de travail fonctionne de la même façon pour les deux. Le type détermine :

- **Les comptes** : un compte peut être réglé sur **OPEX et CAPEX**, **OPEX uniquement** ou **CAPEX uniquement**. Voir [Comptes OPEX ou CAPEX](chart-of-accounts.md#comptes-opex-ou-capex)
- **Les dimensions et les valeurs** : une dimension ou une valeur peut être réservée à un seul type, et une dimension peut être obligatoire pour un type. Le panneau **Propriétés** n'affiche que les dimensions utilisées pour le type de la ligne. Voir [Dimensions OPEX ou CAPEX](analytics.md#dimensions-opex-ou-capex)
- **La refacturation** : les rapports de refacturation ne couvrent que les lignes OPEX. Voir [Rapports](reports.md)
- **Les gels** : une colonne budgétaire est gelée par année et par type. Voir [Geler / Dégeler les données](budget-operations.md#geler-degeler-les-donnees)

Le type d'une ligne se change avec **Changer le type...**. Voir [Changer le type](#changer-le-type).

### Dimensions CAPEX

Chaque espace de travail classe les lignes CAPEX sur trois dimensions analytiques :

| Dimension | Valeurs |
|---|---|
| **PP&E type** | Hardware, Software (immobilisations corporelles) |
| **Investment type** | Replacement, Capacity, Productivity, Security, Conformity, Business growth, Other |
| **Priority** | Mandatory, High, Medium, Low |

Elles sont utilisées pour les lignes CAPEX et obligatoires : une nouvelle ligne CAPEX a besoin d'une valeur sur chacune. Elles fonctionnent comme toute autre dimension : leurs champs se trouvent dans le panneau **Propriétés** avec les autres dimensions, et leurs colonnes s'affichent par défaut dans la liste. Un administrateur peut les renommer, ajouter des valeurs, changer l'ordre des valeurs, les désactiver ou les supprimer. Voir [Dimensions CAPEX](analytics.md#dimensions-capex) dans Dimensions analytiques.

---

## Références

Chaque ligne a une référence, par exemple `BL-12`, issue d'une seule série pour l'OPEX et le CAPEX. Elle s'affiche dans la colonne **Réf**, dans l'en-tête de l'espace de travail et dans l'adresse de la page (`/ops/budget/BL-12`).

Les lignes créées avant cette série unique avaient aussi un numéro `OPX-12` ou `CPX-3`. Ces numéros fonctionnent toujours :

- Un lien ou un favori vers une ancienne page OPEX ou CAPEX ouvre la ligne
- La recherche rapide de la liste trouve une ligne par son ancien numéro
- Le fichier budgétaire les lit dans `item_number`. Voir [Charger un budget depuis un tableur](budget-file.md)
- Plaid trouve une ligne par l'un ou l'autre numéro. Voir [Plaid](ai-assistant.md#mentionner-des-enregistrements-avec)

---

## Travailler avec la liste

La liste (dans **Gestion budgétaire > Lignes budgétaires**) contient les lignes OPEX et CAPEX ensemble. Son titre indique la devise de reporting, par exemple **Lignes budgétaires (EUR)**. Tous les montants de la liste sont dans cette devise.

**Colonnes par défaut** :

- **Réf** : La référence de la ligne, par exemple `BL-12` (ouvre l'onglet **Vue d'ensemble**)
- **Type** : **OPEX** ou **CAPEX**
- **Nom du produit** : Le titre de la ligne (ouvre l'onglet **Vue d'ensemble**)
- **Fournisseur** : Le nom du fournisseur
- **Société payeuse** : Quelle société paie cette ligne
- **Contrat** : Le nom du dernier contrat lié (ouvre l'espace de travail du Contrat)
- **Compte** : Le numéro et le nom du compte comptable
- **Ventilation** : Le libellé de la méthode de ventilation pour l'année en cours (ouvre l'onglet **Ventilations**)
- **Budget A** et **Atterrissage prévu A** : Les montants de l'année en cours de la colonne par défaut et de la dernière colonne affichée (ouvre l'onglet **Budget** pour cette année). Avec les réglages standard, ce sont Budget et Atterrissage prévu. Quand la colonne par défaut est aussi la dernière affichée, une seule colonne de montant apparaît. Voir [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires)
- **Dimensions obligatoires** : Une colonne par dimension activée obligatoire pour l'un ou l'autre type, à son nom : **PP&E type**, **Investment type** et **Priority** au départ
- **Tâche** : Le titre de la dernière tâche (ouvre l'onglet **Vue d'ensemble**, où se trouve le panneau des tâches)

**Colonnes supplémentaires** (masquées par défaut, activez-les via le sélecteur de colonnes) :

- **Colonnes de montants** : Chaque colonne budgétaire affichée pour A-1, A, A+1 et A+2, sous les noms choisis par votre organisation. L'en-tête indique la colonne, l'année par rapport à aujourd'hui et l'année civile, par exemple **Révision A+1 (2027)**. Les colonnes masquées ne sont pas proposées
- **Colonnes ETP** : L'ETP de chaque colonne budgétaire affichée pour A-1, A, A+1 et A+2, sous les noms choisis par votre organisation, juste après les colonnes de montants dans le sélecteur de colonnes. L'en-tête indique la colonne et l'année civile, par exemple **ETP Budget (2026)**. L'ETP d'une ligne est la somme des ETP de ses lignes de quantité et prix dans cette colonne. Voir [ETP](#etp). La cellule est vide lorsque la colonne n'a aucune ligne
- **ETP déclarés** : **Oui** lorsque la ligne déclare des ETP dans au moins une colonne budgétaire, toutes années confondues, sinon vide. Ce sont les lignes que garde le filtre **Lignes avec ETP** des rapports
- **Activé** : Statut de la ligne (activée ou désactivée)
- **Description** : La description de la ligne
- **Devise** : Code devise ISO
- **Début effectif** : Date de début
- **Fin de validité** : Date à laquelle la ligne s'arrête (vide signifie sans fin)
- **Responsable IT** / **Responsable métier** : Utilisateurs responsables
- **Dimensions analytiques** : Une colonne par dimension activée, à son nom, avec la valeur de la ligne, dans l'ordre des dimensions. La colonne de la dimension par défaut s'intitule **Dimension analytique** tant qu'elle n'est pas renommée
- **Centre de coûts** : Le code et le nom du centre de coûts. Survolez-le pour voir son chemin complet dans l'arbre ; cliquez dessus pour ouvrir le centre de coûts
- **Responsable budgétaire** : Le responsable budgétaire du centre de coûts de la ligne. Il vient du centre de coûts, et la ligne ne l'enregistre pas : changez le responsable budgétaire d'un centre de coûts et toutes ses lignes suivent
- **Run ou build** : **Run** ou **Build**
- **Projet** : Noms des projets liés dans l'onglet **Relations**
- **Notes** : Notes internes
- **Créé / Mis à jour** : Horodatages

Une disposition de colonnes que vous avez enregistrée garde son propre choix de colonnes. La disposition que vous aviez enregistrée sur l'ancienne liste OPEX est reprise sur cette liste.

**Filtrer par type** :

- La colonne **Type** a un filtre à cases à cocher avec **OPEX** et **CAPEX**. Cochez-en une pour ne voir que les lignes de ce type
- **Nouvelle ligne** démarre sur le type que garde le filtre. Avec les deux types, ou sans filtre, elle démarre sur OPEX
- Une ancienne adresse de liste OPEX ou CAPEX ouvre cette liste avec le filtre **Type** réglé, et garde le tri, la recherche et les filtres qu'elle portait

**Filtrage** :

- **Recherche rapide** : Recherche dans la référence (`BL-12`, et l'ancien `OPX-12` ou `CPX-3`), le nom du produit, la description, le fournisseur, la société payeuse, le compte, le contrat, les noms de projets, la ventilation, les responsables, les valeurs analytiques, le centre de coûts (code, nom et chemin), le responsable budgétaire, les notes, la devise et le statut. Filtre la liste en temps réel pendant la saisie, en ignorant les accents et la casse
- **Filtres de colonnes** : Cliquez sur l'icône de filtre dans n'importe quel en-tête de colonne. **Type**, **Fournisseur**, **Société payeuse**, **Compte**, **Ventilation**, **Devise**, **Responsable IT**, **Responsable métier**, chaque dimension analytique, **Centre de coûts**, **Responsable budgétaire**, **Run ou build**, **ETP déclarés** et **Activé** utilisent des filtres par jeu de cases à cocher (multi-sélection). Le filtre **ETP déclarés** propose **Oui** et **Non**. Le filtre **Activé** propose **Activé** et **Désactivé**, avec le même sens que **Afficher**, et restreint la liste lorsque **Afficher** est réglé sur **Tous**. Cliquer sur **Effacer** dans ce filtre, ou décocher les deux valeurs, n'affiche plus rien, quel que soit le choix de **Afficher**
- **Tous sauf quelques valeurs** : Cochez **Tous**, puis décochez les valeurs à exclure : le filtre garde tout sauf celles-ci (l'en-tête affiche par exemple **Tous sauf 3**), et une valeur créée plus tard est incluse automatiquement
- **Filtres de montants** : Chaque colonne de montant a un filtre numérique. Un nombre saisi dans la case sous l'en-tête garde les lignes d'au moins ce montant. Ouvrez le menu du filtre pour les autres conditions : supérieur à, inférieur à, égal, différent, ou entre deux montants
- **Filtres ETP** : Chaque colonne ETP a un filtre numérique avec les mêmes conditions, plus vide et non vide. **Vide** garde les lignes dont la colonne n'a aucune ligne de quantité et prix
- **Filtres de dates** : **Début effectif**, **Fin de validité**, **Créé** et **Mis à jour** ont des filtres de date. La case sous l'en-tête affiche le filtre en toutes lettres, avec chacune de ses conditions, par exemple « Vide ou après le 31 déc. 2024 ». Cliquez dessus pour ouvrir le menu du filtre (le, avant, après, entre, vide ou non vide), ou cliquez sur × pour retirer le filtre. **Fin de validité** accepte deux conditions reliées par ET ou OU, par exemple vide ou après une date
- **Colonnes texte** : elles utilisent des filtres texte, en ignorant les accents et la casse. Sur **Réf**, saisissez le numéro ou la référence complète, par exemple `12` ou `BL-12`
- **Périmètre par statut** : Utilisez la bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la grille (par défaut **Activés**). **Activés** liste les lignes sans fin de validité ou dont la fin de validité tombe dans l'année en cours ou plus tard : les lignes qui se terminent pendant l'année en cours restent dans **Activés** jusqu'au 31 décembre. **Désactivés** liste les lignes terminées avant le 1er janvier de l'année en cours
- **Partage d'une vue** : Votre tri, votre recherche et vos filtres sont conservés dans l'adresse de la page : recharger la page ou partager le lien rouvre la même vue. Un lien dont les filtres ne sont plus disponibles affiche « Les filtres de ce lien ne sont plus disponibles. » Lorsqu'un lien filtre une colonne masquée, par exemple une ligne de rapport qui ouvre la liste, la liste affiche cette colonne juste après le nom du produit pour cette visite. La disposition de colonnes que vous avez enregistrée ne change pas. Le choix **Afficher** est aussi conservé dans l'adresse. Une liste ouverte depuis un rapport est une vue de ce rapport : ce que vous y changez reste dans son adresse, et la liste ouverte depuis le menu garde vos propres tri, recherche et filtres

**Tri** :

- Cliquez sur un en-tête de colonne pour trier par ordre croissant ou décroissant. Toutes les colonnes se trient, y compris chaque colonne de montant et chaque colonne ETP. Les lignes sans ETP viennent en dernier dans l'ordre croissant
- Les colonnes de texte se trient dans l'ordre de lecture naturel : un nom accentué se trie à côté de son équivalent sans accent (par exemple « Électricité » à côté de « Electricite »), et les minuscules passent avant les majuscules à égalité de lettres
- Une colonne de dimension se trie dans l'ordre des valeurs de la dimension, défini dans [Dimensions analytiques](analytics.md#ordonner-les-valeurs), puis par nom. Les lignes sans valeur viennent en dernier dans l'ordre croissant
- Le tri par défaut suit la colonne par défaut de l'année en cours, du plus grand au plus petit (**Budget A** avec les réglages standard). Les boutons **Préc.** et **Suiv.** de l'espace de travail suivent le même ordre
- La liste mémorise votre dernier tri, votre recherche et vos filtres quand vous revenez

**Lignes de totaux** :

- La ligne épinglée en bas affiche **Total (12 lignes)**, avec le nombre de lignes que contient la liste, et le total de chaque colonne de montant
- Lorsque la liste contient les deux types (aucun filtre sur **Type**, ou les deux valeurs cochées), deux autres lignes s'affichent au-dessus : **Total OPEX** et **Total CAPEX**. Filtrée sur un type, la liste n'affiche que la ligne **Total**
- Un cadenas devant un total signifie que la colonne est gelée pour cette année. Sur **Total OPEX** et **Total CAPEX**, il suit le gel de ce type. Sur **Total**, il s'affiche quand la colonne est gelée pour chaque type que contient la liste. Survolez-le pour lire **Gelé**. Voir [Geler / Dégeler les données](budget-operations.md#geler-degeler-les-donnees)
- Chaque colonne ETP affichée montre la somme des ETP des lignes. Lorsque certaines lignes n'ont pas d'ETP, leur nombre suit le total, par exemple « 3.50 · 12 inconnues ». Survolez-le pour lire la phrase complète : « Inconnu pour 12 lignes ». Lorsqu'aucune ligne n'a d'ETP, le total est vide et seul le nombre s'affiche
- Les totaux respectent vos filtres et votre recherche actuels

**Liens profonds** :

- Cliquer sur n'importe quelle cellule ouvre l'espace de travail sur l'onglet le plus pertinent :
    - **Réf**, **Nom du produit**, **Fournisseur**, **Société payeuse**, **Compte**, les colonnes de dimensions et les autres colonnes générales : Ouvre l'onglet **Vue d'ensemble**
    - **Colonnes de montants** (Budget A, Atterrissage prévu A, Révision A+1, etc.) et **Colonnes ETP** : Ouvre l'onglet **Budget** pré-positionné sur l'année de la colonne
    - **Ventilation** : Ouvre l'onglet **Ventilations** pour l'année en cours
    - **Tâche** : Ouvre l'onglet **Vue d'ensemble**, où se trouve le panneau des tâches
    - **Contrat** : Ouvre directement l'espace de travail du Contrat lié
    - **Centre de coûts** : Ouvre l'espace de travail du centre de coûts

**Actions** :

- **Nouvelle ligne** : Créer une ligne (nécessite `budget:member`)
- **Importer CSV** : Charger des lignes en masse depuis un fichier budgétaire (nécessite `budget:admin`)
- **Exporter CSV** : Exporter les lignes dans un fichier budgétaire (nécessite `budget:admin`)
- **Supprimer la sélection** : Suppression en masse des lignes sélectionnées (nécessite `budget:admin` ; sélectionnez-les via les cases à cocher). Une ligne qui a des montants dans une colonne gelée ne peut pas être supprimée : les autres sont supprimées, et le message nomme chaque ligne refusée avec sa raison

**Navigation Préc./Suiv.** :

- Lorsque vous ouvrez une ligne, l'espace de travail affiche les boutons **Préc.** et **Suiv.** et un compteur, par exemple « Ligne 3 sur 47 »
- Ceux-ci naviguent dans la liste selon le tri actuel, en respectant les filtres et la recherche
- Passer à une autre ligne enregistre d'abord vos modifications en attente
- Votre contexte de liste (tri, filtres, recherche) est préservé lorsque vous fermez l'espace de travail

**Conseil** : Utilisez les filtres de colonnes et la recherche rapide pour construire des vues ciblées (ex. : « Toutes les dépenses cloud de plus de 10k », ou **CAPEX** dans **Type** avec **High** dans **Priority**), puis parcourez les lignes une à une avec **Préc.**/**Suiv.** pour revoir les budgets.

---

## L'espace de travail

Cliquez sur n'importe quelle ligne de la liste pour ouvrir l'espace de travail. Son adresse désigne la ligne par sa référence, par exemple `/ops/budget/BL-12/overview`. Il comporte quatre parties :

- **En-tête** : la référence de la ligne (ex. : `BL-12`) avec un bouton de copie, le titre de la ligne (cliquez dessus pour la renommer), **Préc.** / **Suiv.**, **Envoyer le lien**, le menu **...** (**Changer le type...**, voir [Changer le type](#changer-le-type)) et le bouton de fermeture
- **Barre de métadonnées** sous le titre : **Statut**, **Responsable IT** et **Responsable métier**, modifiables sur place. Lorsque le centre de coûts de la ligne a un responsable budgétaire, **Responsable budgétaire** vient ensuite. Il est en lecture seule. Il vient du centre de coûts, et la ligne ne l'enregistre pas : survolez-le pour voir de quel centre de coûts il provient, et modifiez-le sur le centre de coûts (voir [Centres de coûts](cost-centers.md#responsable-budgetaire-sur-les-lignes-budgetaires))
- **Quatre onglets** : **Vue d'ensemble**, **Budget**, **Ventilations** et **Relations** (l'onglet Relations indique le nombre de liens de la ligne)
- **Panneau Propriétés** à droite : les champs principaux de la ligne, en commençant par **Type**. Ouvrez-le ou fermez-le avec le bouton des propriétés ; l'espace de travail mémorise votre choix

**Enregistrement automatique** :

- Chaque modification s'enregistre automatiquement. L'indication **Enregistrement...** / **Enregistré** apparaît dans l'en-tête
- Changer d'onglet, passer à la ligne précédente ou suivante, ou fermer l'espace de travail enregistre d'abord les modifications en attente. Si un enregistrement échoue, vous restez sur place et un message en donne la raison : aucune modification n'est perdue sans que vous le sachiez
- **Ctrl+S** (**Cmd+S** sur Mac) enregistre immédiatement
- Si un enregistrement ne peut pas passer tout de suite parce qu'un autre enregistrement est en cours sur la même donnée, KANAP le relance automatiquement
- Si une opération budgétaire groupée est en cours (par exemple une copie ou une réinitialisation de colonne dans l'Administration budgétaire), les modifications sont mises en attente avec le message « Une autre opération sur le budget est en cours. Réessayez quand elle sera terminée. » Réessayez une fois l'opération terminée

**Modifications simultanées** :

- Deux personnes peuvent travailler sur la même ligne en même temps sans se gêner. Modifier des champs différents, des mois budgétaires différents ou des colonnes budgétaires différentes ne crée jamais de conflit, même sur la même ligne au même moment
- Lorsqu'une autre personne modifie le même champ, la même colonne budgétaire ou la ventilation pendant que vous la modifiez, un bandeau affiche sa valeur et la vôtre, avec qui l'a modifiée et quand. Choisissez **Garder sa valeur** pour reprendre la sienne, ou **Appliquer la vôtre** pour garder ce que vous avez saisi. Pour une colonne budgétaire, les choix sont **Recharger la colonne** ou **Écraser** ; pour la ventilation, **Recharger la ventilation** ou **Écraser**
- Seul le champ, la colonne ou la ventilation qui a été modifié attend votre choix ; tout le reste continue à s'enregistrer normalement
- Un choix en attente est conservé quand vous changez d'onglet. Il est perdu, après un avertissement, si vous quittez la ligne ou changez d'année
- Si la modification précédente est la vôtre, depuis une autre fenêtre ou un autre onglet, le bandeau le précise au lieu de nommer quelqu'un d'autre

### Vue d'ensemble

L'onglet Vue d'ensemble contient les champs de texte libre et les tâches de la ligne.

**Ce que vous pouvez modifier** :

- **Description** : Ce que couvre la ligne
- **Notes** : Notes internes libres

Lorsque la ligne en remplace une autre, ou a été remplacée à partir d'une année ultérieure après un changement de type, le haut de l'onglet relie les deux lignes : **Remplacée par** sur l'ancienne ligne, **Succède à** sur la nouvelle.

**Panneau des tâches** :

- Liste toutes les tâches liées à cette ligne, avec les colonnes **Titre**, **Statut**, **Priorité**, **Échéance** et **Actions**. Le titre du panneau indique le nombre de tâches
- Filtre **Statut** : Tous (par défaut), Actifs (non terminés), Ouvert, En cours, En attente, En test, Terminé ou Annulé. Le bouton de réinitialisation l'efface
- Cliquez sur **Ajouter une tâche** pour ouvrir une nouvelle tâche déjà liée à cette ligne. Remplissez le titre, la description, la priorité, le responsable et l'échéance dans l'espace de travail de la tâche
- Utilisez l'icône d'ouverture pour aller sur une tâche, et l'icône de suppression pour la supprimer (après confirmation)
- Les tâches ont leurs propres autorisations (`tasks:member` pour créer et modifier). L'accès Membre sur Budget ne donne pas à lui seul le droit de modifier les tâches ; vérifiez avec votre admin si vous ne pouvez pas créer de tâches
- Les tâches peuvent aussi être consultées et gérées depuis **Portefeuille > Tâches**, qui affiche toutes les tâches de votre organisation

**Panneau Propriétés** :

- **Type** : **OPEX** ou **CAPEX**. Sur une ligne existante, **Changer le type...** à côté ouvre la même fenêtre que le menu **...**
- **Fournisseur**, **Centre de coûts**, **Société payeuse**, **Compte** (filtré par le plan comptable de la société payeuse et le type de la ligne), **Devise** (seulement les devises autorisées dans votre espace de travail), un champ par dimension analytique utilisée pour le type de la ligne, **Run ou build** et **Début d'effet**
- **Cycle de vie** : l'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité**. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie)
- Dates **Créé** et **Mis à jour** (lecture seule)
- Saisissez du texte dans **Fournisseur**, **Société payeuse**, **Compte**, **Responsable IT**, **Responsable métier** ou un champ de dimension analytique pour rechercher par nom. Les résultats apparaissent au fur et à mesure que vous tapez, afin de trouver n'importe quelle valeur même dans une très longue liste ; une ligne sous la liste indique « Tapez pour affiner : d'autres résultats existent » lorsqu'il y a plus de résultats qu'affichés

**Centre de coûts** :

- La liste présente l'arbre des centres de coûts. Les groupes s'affichent pour vous aider à vous repérer et ne peuvent pas être choisis. Recherchez par code, nom ou nom de groupe
- Un centre de coûts désactivé est marqué **Désactivé**. Il reste sur les lignes qui l'ont déjà et ne peut pas être choisi pour une autre ligne
- Lorsque vous créez une ligne et que la société payeuse est vide, choisir un centre de coûts remplit la société payeuse avec la société du centre de coûts : la liste **Compte** s'ouvre alors sur le plan comptable de cette société. Tant que vous n'avez pas choisi vous-même une société ou un compte, choisir un autre centre de coûts met aussi à jour la société
- Lorsque la société payeuse diffère de la société du centre de coûts, les deux sont conservées. Une indication sous le champ affiche « Ce centre de coûts appartient à » suivi du nom de la société
- Une ligne enregistrée via l'API avec un centre de coûts et sans société payeuse prend la société du centre de coûts. Pour les fichiers CSV, voir [Import/export CSV](#importexport-csv)

**Run ou build** : **Run**, **Build** ou **Non défini**. Utilisez-le pour répartir le budget entre le maintien des services et leur évolution.

**Dimensions analytiques** :

- Chaque dimension activée utilisée pour le type de la ligne a son propre champ, au nom de la dimension, dans l'ordre des dimensions. Une dimension réservée à l'autre type n'en a pas, et la valeur qu'une ligne y porte reste masquée. Choisissez une valeur ou videz le champ ; la modification s'enregistre aussitôt
- Chaque champ liste les valeurs activées de sa dimension. Une valeur désactivée reste sur les lignes qui l'ont déjà, et ne peut pas être choisie pour une autre ligne
- Une valeur réservée à l'autre type n'est pas proposée, et son choix est refusé. Une ligne qui l'a déjà la garde et reste modifiable. Voir [Valeurs OPEX ou CAPEX](analytics.md#valeurs-opex-ou-capex)
- Le champ ne peut pas créer de valeur : créez-la dans [Dimensions analytiques](analytics.md), ou laissez un import CSV la créer
- Une dimension obligatoire est marquée d'un astérisque. Une nouvelle ligne doit avoir une valeur sur cette dimension : **Créer** s'arrête avec « Nature est obligatoire » tant que vous n'en avez pas choisi. Sur une ligne qui porte une valeur, le champ ne peut pas être vidé, seulement modifié. Une ligne sans valeur reste modifiable. Si vous modifiez une telle ligne, la quitter demande d'abord : « Nature est obligatoire. Choisissez une valeur avant de quitter. » **Rester** place le curseur dans le champ manquant. **Quitter quand même** quitte la ligne. Voir [Dimensions obligatoires](analytics.md#dimensions-obligatoires)
- Si les dimensions ne peuvent pas être chargées, une ligne remplace ces champs : « Les dimensions n'ont pas pu être chargées. »

**Conseil** : Lors de la création d'une ligne, un avertissement « Compte obsolète » signifie que le compte sélectionné n'appartient pas au plan comptable de la société payeuse. Choisissez un autre compte pour résoudre l'avertissement. Une ligne existante dont le compte est hors du plan comptable de sa société reste modifiable : le plan comptable n'est vérifié que lorsque la société ou le compte change.

---

### Budget

L'onglet Budget est l'endroit où vous saisissez les données financières par année. Il prend en charge plusieurs colonnes budgétaires et deux modes de saisie, présentés sous forme d'onglets : **Annuel** (totaux annuels) et **Mensuel** (ventilation mensuelle).

**Sélection d'année** :

- Utilisez les onglets d'année en haut pour basculer entre A-2, A-1, A (année en cours), A+1 et A+2
- Chaque année a sa propre version, son mode et ses montants
- Changer d'année enregistre d'abord vos modifications en attente

**Colonnes budgétaires** :

- L'onglet montre les colonnes affichées par votre organisation, sous leurs noms, toujours dans le même ordre. Les colonnes standard sont :
    - **Budget** : Budget annuel initial approuvé en début d'année
    - **Révision** : Mise à jour budgétaire en cours d'année (ex. : après une re-prévision ou un changement de périmètre)
    - **Prévision** : Une colonne de planification complémentaire, masquée par défaut
    - **Réalisé** : La dépense réelle, telle qu'elle est enregistrée pendant l'année
    - **Atterrissage prévu** : Votre meilleure estimation du chiffre de fin d'année
- Un administrateur budgétaire peut renommer les colonnes, en masquer certaines et choisir la colonne par défaut dans **Gestion budgétaire > Administration > Colonnes budgétaires** (voir [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires)). Une colonne masquée garde ses montants

**Période d'une colonne** :

- Chaque colonne a une période à l'intérieur de l'année, par exemple d'avril à décembre
- Un mois compte lorsque la période couvre son 15. Une période qui commence le 10 avril inclut avril ; une période qui commence le 20 avril débute en mai
- Une colonne sans montant ni période reçoit une suggestion : le **Début d'effet** et la **Fin de validité** de la ligne, limités à l'année. Une ligne qui commence le 1er avril suggère d'avril à décembre
- Une colonne qui porte déjà des montants sans période est lue comme couvrant toute l'année : les données existantes se comportent comme avant

**Annuel ou Mensuel** :

- **Annuel** : Saisissez un total par colonne. Le total est réparti uniformément sur les mois de la période de la colonne, et les mois hors de cette période sont mis à zéro. La période s'affiche sous chaque total avant la saisie, par exemple « 9 mois, avril à décembre ». Seul le total que vous modifiez est enregistré. Les autres colonnes gardent leurs montants mensuels.
- Cliquez sur l'icône crayon à côté de la période sous un total (**Modifier la période**) pour ouvrir le panneau de répartition sur cette colonne, avec son total actuel. Si les dates de la ligne ne laissent aucun mois dans l'année, le total est désactivé et indique « Aucun mois de 2026 n'est compris dans les dates de la ligne. » Cliquez sur l'icône crayon à côté (**Choisir la période**) pour la définir vous-même.
- Cliquez sur l'icône calculatrice à côté du crayon (**Quantité et prix**) pour ouvrir le même encadré sur les lignes de cette colonne. Voir [Quantité et prix](#quantite-et-prix).
- Une colonne qui suit ses lignes (ses montants ont été calculés à partir de ses lignes de Quantité et prix) a un total en lecture seule. Cliquez sur le total, ou appuyez sur Entrée dessus, pour ouvrir **Quantité et prix** sur cette colonne. Le crayon fait de même. Survolez le total pour lire « Calculé à partir de ses lignes. Ouvrez Quantité et prix pour le modifier. »
- **Mensuel** : Saisissez les montants par mois (Jan-Déc) pour chaque colonne affichée, par exemple pour suivre un plan de décaissement ou les jalons d'un projet. Des sous-totaux par trimestre et un total annuel sont affichés. Seuls les mois que vous modifiez sont enregistrés.
- Les deux onglets montrent les mêmes colonnes : Prévision apparaît aussi dans **Annuel** quand elle est affichée.
- Passez d'un mode à l'autre avec les onglets **Annuel** et **Mensuel**. Changer de mode ne modifie pas vos montants.
- Votre choix entre **Annuel** et **Mensuel** est conservé dans votre navigateur, pour vous seul : changer de mode ne modifie pas ce que voient les autres utilisateurs qui ouvrent cette ligne. Tant que vous n'avez pas choisi, une colonne s'ouvre dans le mode utilisé pour la dernière saisie de ses montants.

**Comportement du gel** :

- Si les colonnes budgétaires d'une année sont gelées pour le type de la ligne (via l'Administration budgétaire), les champs correspondants passent en lecture seule et affichent un cadenas
- Vous pouvez toujours consulter les données gelées ; les administrateurs peuvent dégeler via **Gestion budgétaire > Administration > Geler / Dégeler les données**
- Chaque colonne peut être gelée indépendamment

**Répartir un montant** :

- L'encadré du panneau a deux onglets : **Répartir un montant** et **Quantité et prix**. Cette partie couvre le premier
- Le panneau de répartition est toujours visible dans l'onglet **Mensuel**. Dans l'onglet **Annuel**, il s'ouvre depuis l'icône crayon sous un total, et son bouton de fermeture le ferme
- Choisissez une **Colonne** parmi les colonnes affichées, vérifiez le **Montant**, choisissez une **Répartition** (**Linéaire** ou **4-4-5**), puis définissez les dates **Du** et **Au**. Les dates partent de la période actuelle de la colonne, et la répartition de celle de la colonne
- Le panneau s'ouvre sur la colonne par défaut. Le montant reprend le total actuel de la colonne, dans les deux onglets, et suit lorsque vous choisissez une autre colonne. Il reste vide lorsque la colonne n'a aucun montant
- **Chaque modification s'enregistre aussitôt** : le montant quand vous quittez le champ ou appuyez sur Entrée, la répartition et les dates dès que vous les modifiez. Il n'y a aucun bouton à cliquer. Un montant vide ou nul n'enregistre rien
- **Appliquer la répartition à toutes les colonnes** est un interrupteur, activé par défaut : chaque colonne qui le suit reçoit la même répartition et la même période, et chacune garde son propre total actuel. L'activer répartit aussitôt ces colonnes, et il reste activé pour vos modifications suivantes. Le désactiver ne change rien en soi : les modifications suivantes s'appliquent à la seule colonne choisie. Par défaut, toutes les colonnes le suivent. Un administrateur budgétaire choisit lesquelles dans [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires). Les colonnes gelées ne changent jamais. Survolez l'interrupteur pour voir les colonnes qui suivent et celles qui gardent leur propre période
- Une colonne qui ne suit pas l'interrupteur est répartie seule : l'interrupteur n'apparaît pas quand vous la répartissez. L'interrupteur est aussi masqué quand aucune autre colonne qui suit ne peut changer
- Les colonnes qui suivent leurs lignes sont laissées de côté par l'interrupteur : elles gardent les montants de leurs lignes, et une phrase les nomme, par exemple « Prévision garde ses lignes. » Quand toutes les autres colonnes suivent leurs lignes, l'interrupteur n'apparaît pas
- Pour remettre une colonne en répartition linéaire sur douze mois, choisissez **Linéaire** et réglez les dates sur le 1er janvier et le 31 décembre
- Les totaux saisis dans l'onglet **Annuel** s'appliquent toujours à leur seule colonne
- Les dates **Du** et **Au** affichent la période. Quand des mois tombent en dehors, le panneau indique lesquels seront mis à zéro (« Janvier à mars seront mis à zéro. »). Une période sur l'année entière n'affiche aucune ligne. Survolez l'icône d'information à côté du titre du panneau pour voir la règle du 15
- Avec **4-4-5**, les poids des mois qui comptent sont augmentés pour que tout le montant se répartisse sur eux
- Un avertissement non bloquant apparaît lorsque la période dépasse les dates de la ligne. La répartition est tout de même enregistrée
- Tant qu'une date manque ou qu'aucun mois ne compte, le panneau en indique la raison et n'enregistre rien
- Une colonne qui suit ses lignes affiche ses valeurs actuelles dans les champs, en grisé, sous la phrase « Les montants viennent des 4 lignes de Quantité et prix. » Cliquez sur **Répartir un montant à la place** pour déverrouiller les champs de cette colonne. La phrase indique alors « Une répartition remplace les montants des lignes. Les lignes restent comme référence. » Le verrou revient quand vous changez de colonne, d'année ou d'encadré
- Une répartition sur une colonne construite à partir de lignes garde ses lignes comme référence. Voir [Quantité et prix](#quantite-et-prix)

**Origine de chaque colonne** :

- Un court libellé indique d'où viennent les montants d'une colonne. Dans l'onglet **Mensuel**, il se trouve sous l'en-tête de colonne (survolez-le pour voir la période). Dans l'onglet **Annuel**, il se trouve à côté de la période
- **Répartition linéaire**, **Répartition 4-4-5** ou **Répartition par trimestre** : les montants proviennent d'une répartition
- **Copié depuis Budget 2025 +2 %** : les montants proviennent de **Copier les colonnes budgétaires** dans l'Administration budgétaire, avec le pourcentage affiché lorsqu'il y en a un
- **Quantité et prix · 3 lignes · 1.00 ETP** : les montants proviennent de lignes, avec leur nombre et, lorsque les lignes comptent des personnes ou des jours, l'ETP de la colonne. Cet ETP est la moyenne sur l'année. Survolez le libellé pour voir les lignes, par exemple « Chef de projet : 1 personne × 1 200 par jour, 5 jours par mois, févr. à juil. »
- **Modifié à la main** : un mois a été modifié dans la grille ou par un import de fichier budgétaire
- Une colonne sans libellé a conservé les données qu'elle avait avant l'arrivée des périodes

**Lorsqu'une autre personne modifie la même colonne** :

- Deux personnes peuvent remplir des mois ou des colonnes différents de la même ligne en même temps, sans conflit
- En saisie mensuelle, si une autre personne a modifié l'un des mêmes mois, ces mois attendent votre choix ; les autres mois de la colonne s'enregistrent comme vous les avez saisis
- Si une autre personne a modifié le total de la colonne, sa répartition ou ses lignes de quantité et prix pendant que vous y travailliez, toute la colonne attend : un bandeau propose **Recharger la colonne** ou **Écraser**. Les montants, le panneau de répartition et les lignes de la colonne restent en lecture seule jusqu'à votre choix
- Enregistrer recharge l'année : vous voyez toujours les derniers chiffres de chaque autre colonne ; la cellule ou la colonne que vous modifiez n'est pas perturbée

**Outils du mode mensuel** :

- **Effacer la colonne** : l'icône à côté d'un en-tête de colonne remet à zéro tous les mois de cette colonne, par exemple avant de saisir tout le montant sur un seul mois. Lorsque la colonne contient des montants, vous confirmez d'abord. Cela compte comme une modification à la main. Pour retirer à la fois les montants et la période d'une colonne pour toutes les lignes, utilisez **Réinitialiser une colonne budgétaire** dans l'Administration budgétaire

**Tendance pluriannuelle** :

- Un graphique sous la grille montre chaque colonne affichée sur plusieurs années, Prévision comprise quand elle est affichée, et se met à jour pendant la saisie

**Comment l'utiliser** :

1. Sélectionnez l'année pour laquelle vous planifiez
2. Choisissez l'onglet **Annuel** ou **Mensuel**
3. Remplissez les colonnes pertinentes (Budget pour la planification initiale, Réalisé pour le suivi, Atterrissage prévu pour le chiffre de fin d'année)
4. Vos modifications s'enregistrent automatiquement ; l'indication **Enregistrement...** / **Enregistré** apparaît à côté des onglets d'année

**Conseil** : Pour la plupart des lignes, le mode Annuel est plus rapide. Utilisez le mode Mensuel lorsque la dépense varie nettement d'un mois à l'autre (ex. : licences saisonnières, frais de mise en place ponctuels, déploiements par étapes).

#### Quantité et prix

Construisez une colonne à partir de lignes au lieu de saisir ses montants. Chaque ligne se lit comme une phrase : une quantité, une unité, un prix unitaire, une fréquence, une période et un calendrier. Par exemple, un chef de projet 5 jours par mois à 1 200 par jour de février à juillet, et 50 licences à 12 par pièce par mois. Les mois de la colonne sont la somme de ses lignes. Les montants d'une colonne n'ont qu'une source à la fois : ses lignes, ou une répartition, un mois saisi à la main ou une copie. L'autre source reste visible comme référence, en lecture seule, avec un lien pour basculer.

**Ouvrir l'onglet** :

- Onglet **Annuel** : cliquez sur l'icône calculatrice à côté de la période sous un total. L'encadré s'ouvre sur **Quantité et prix** pour cette colonne. Sur une colonne qui suit ses lignes, le crayon et le total l'ouvrent aussi
- Onglet **Mensuel** : cliquez sur **Quantité et prix** en haut de l'encadré du panneau. Choisir une colonne qui suit ses lignes, ou en avoir une comme colonne par défaut, bascule l'encadré sur **Quantité et prix**
- Choisissez la **Colonne** en haut de l'onglet. Les colonnes gelées ne peuvent pas être choisies

**Les lignes** :

| Colonne | Ce qu'il faut saisir |
|---|---|
| **Description** | Ce que la ligne paie, par exemple « Chef de projet ». Facultative, jusqu'à 200 caractères |
| **Quantité** | Combien, dans l'unité de la ligne. Zéro ou plus, jusqu'à 3 décimales |
| **Unité** | **personnes**, **jours** ou **pièces**. L'unité détermine ce que paie le prix, sa fréquence, la façon dont le montant se répartit sur les mois, et l'ETP |
| **Prix unitaire** | Le prix d'une unité, dans la devise de la ligne budgétaire. Jusqu'à 4 décimales. Un prix négatif est accepté, pour un avoir. Ce que paie le prix s'affiche juste après : **par jour** pour les jours, **par pièce** pour les pièces, et pour les personnes une petite liste pour choisir **par jour** ou **par mois** |
| **Fréquence** | Elle suit l'unité. Personnes au prix par jour : une case **Temps plein** et, lorsqu'elle n'est pas cochée, les **jours par mois** qu'elles consacrent à la ligne budgétaire (plus de 0, jusqu'à 31, avec jusqu'à 3 décimales). Personnes au prix par mois : « par mois ». Jours : « sur la période ». Pièces : une liste pour choisir **par mois** ou **une fois** |
| **Du** / **Au** | La période de la ligne, à l'intérieur de l'année. Un mois compte lorsque la période couvre son 15, comme pour une répartition. Les pièces achetées une fois prennent une seule **Date** à la place et tombent dans son mois. Lorsque toutes les lignes prennent une date, l'en-tête indique **Date** |
| **Calendrier** | Affiché pour un prix par jour uniquement : les personnes au prix par jour, et les jours. Le calendrier de jours ouvrés dont les jours comptent. La liste propose les calendriers activés, plus le calendrier qu'une ligne utilise déjà s'il a été désactivé depuis, marqué « (désactivé) ». Lorsqu'il n'existe encore aucun calendrier, l'onglet indique « Aucun calendrier de jours ouvrés pour l'instant. », avec un lien **Ajouter un calendrier** pour les personnes qui peuvent créer des calendriers. Voir [Calendriers de jours ouvrés](working-day-calendars.md) |
| **Montant** | Le total de la ligne, une fois enregistrée. En lecture seule |

Chaque ligne a un numéro dans la marge. Quand la colonne a plusieurs lignes, les remarques sous le tableau l'utilisent, par exemple « Ligne 2 : Saisissez une quantité et un prix unitaire pour enregistrer cette ligne. »

Lorsque l'onglet est assez large, chaque ligne tient sur une rangée. Sur un panneau plus étroit, chaque ligne occupe deux rangées. La première se lit comme un calcul : **Description**, **Quantité**, **Unité**, × **Prix unitaire** et **Montant**. La seconde se lit comme une phrase : **Fréquence**, « du » une date « au » une date (ou une seule **Date**), « calendrier » et le **Calendrier**. Sur un panneau de largeur moyenne, **Fréquence** passe sur la première rangée. Fermer le panneau **Propriétés** donne plus de place aux lignes.

Cliquez sur **Ajouter une ligne** sous le tableau pour ajouter une ligne, et sur la croix au bout d'une ligne pour la supprimer. Une colonne contient jusqu'à 50 lignes.

**Unités et prix** :

| Unité | Prix | Fréquence | Montant de chaque mois de la période | ETP de chaque mois |
|---|---|---|---|---|
| **personnes** | **par jour** | **Temps plein** | Les jours ouvrés du mois dans le calendrier × quantité × prix unitaire | La quantité |
| **personnes** | **par jour** | **5 jours par mois** | 5 × quantité × prix unitaire | Quantité × 5 ÷ les jours ouvrés du mois dans le calendrier |
| **personnes** | **par mois** | par mois | Quantité × prix unitaire | La quantité |
| **jours** | **par jour** | sur la période | Quantité × prix unitaire, compté une fois et réparti uniformément sur les mois de la période | La part des jours du mois ÷ les jours ouvrés du mois dans le calendrier |
| **pièces** | **par pièce** | **par mois** | Quantité × prix unitaire | Aucun |
| **pièces** | **par pièce** | **une fois** | Quantité × prix unitaire, dans le mois de la date | Aucun |

- Utilisez **personnes** pour du personnel qui travaille sur la ligne budgétaire mois après mois. Au prix par jour, indiquez combien il travaille : cochez **Temps plein** pour compter chaque jour ouvré du calendrier du début à la fin de la ligne, ou saisissez les jours par mois. Par exemple, un chef de projet 5 jours par mois à 1 200 par jour de février à juillet coûte 6 000 par mois. Sur un calendrier qui compte 21 jours ouvrés en mars, ce mois compte 5 ÷ 21, soit environ 0.24 ETP. Un consultant à temps plein à 400 par jour coûte chaque mois les jours ouvrés du mois × 400, et compte 1 ETP
- Au prix par mois, les personnes coûtent chaque mois la quantité × le prix unitaire, par exemple 1 personne à 8 000 par mois
- Utilisez **jours** pour un nombre de jours achetés pour la période, en un seul lot. Par exemple, 30 jours à 1 200 par jour de février à juillet donnent 36 000, soit 6 000 par mois. Chaque mois porte 5 jours : dans un mois de 20 jours ouvrés, la ligne compte 0.25 ETP
- Utilisez **pièces** pour des licences, des équipements ou des abonnements. Par mois, elles comptent dans chaque mois de la période : 50 licences à 12 par pièce donnent 600 par mois. Une fois, elles prennent une seule date et tombent dans son mois : un ordinateur portable à 2 000 le 15 mars tombe en mars. Les pièces ne comptent jamais en ETP
- Chaque mois est arrondi au centime. Lorsqu'un montant est réparti sur la période, l'écart d'arrondi est reporté sur le dernier mois. Les mois hors de la période d'une ligne n'en reçoivent rien
- Changer d'unité adapte le reste de la ligne. Les personnes gardent un prix par mois lorsque vous l'avez choisi, et sont au prix par jour sinon. Les jours sont au prix par jour, sur la période. Les pièces sont au prix par pièce et achetées une fois, à la date de début de la période de la colonne. Passer des pièces de une fois à par mois leur redonne la période de la colonne

**Une nouvelle ligne** commence avec l'unité **personnes**, une quantité de 1, un prix par jour, **Temps plein** non coché avec les jours par mois à saisir, la période de la colonne (l'année entière lorsque la colonne n'en a pas) et le calendrier par défaut. Le calendrier par défaut est le calendrier standard du pays de la société payeuse, sinon le premier calendrier activé. Saisissez le prix unitaire et les jours par mois, ou cochez **Temps plein**, et la ligne s'enregistre. Sans calendrier activé, une nouvelle ligne commence avec un prix par mois.

**Enregistrement** : chaque champ s'enregistre quand vous le quittez, appuyez sur Entrée, ou choisissez une valeur ou une date. Il n'y a aucun bouton à cliquer. Chaque enregistrement envoie toutes les lignes complètes de la colonne, et les mois de la colonne suivent aussitôt. L'indication **Enregistrement...** à côté des onglets d'année s'affiche pendant ce temps.

- Une ligne est complète lorsqu'elle a une quantité, un prix unitaire, une période ou une date valide, les jours par mois ou **Temps plein** pour les personnes au prix par jour, et un calendrier pour un prix par jour. Jusque-là, elle reste à l'écran avec une indication, par exemple « Saisissez une quantité et un prix unitaire pour enregistrer cette ligne. », « Saisissez les jours par mois, ou cochez Temps plein. » ou « Choisissez un calendrier pour un prix par jour. », et les lignes enregistrées ne changent pas
- Supprimer la dernière ligne retire les lignes de la colonne, et ses montants restent tels quels. Une colonne calculée à partir de ses lignes compte alors comme des montants saisis à la main. Une colonne répartie ou copiée garde sa répartition ou sa copie
- Lorsqu'un enregistrement est refusé, la raison s'affiche en rouge sous le tableau, et ce que vous avez saisi reste en place. Par exemple, « Personnel du siège has no working days for 2027. Add them on the Working-day calendars page. » lorsqu'un calendrier personnalisé ne contient pas encore l'année
- Sur une colonne gelée, les lignes sont en lecture seule. Elles sont aussi en lecture seule tant que la colonne les garde comme référence, voir la partie suivante

**Sous le tableau** :

- L'ETP des lignes, lorsqu'une ligne compte des personnes ou des jours, par exemple « ETP sur la période 0.24 · Moyenne sur l'année 0.12 ». Voir [ETP](#etp). Le total de la colonne s'affiche dans la colonne elle-même
- D'où viennent les montants, lorsqu'ils ne viennent plus des lignes : l'une des phrases de la partie suivante
- Des remarques lorsqu'elles s'appliquent : « La période dépasse les dates de la ligne. », un calendrier désactivé depuis, par exemple « Personnel du siège est désactivé. Les lignes l'utilisent encore. », et les jours ouvrés modifiés depuis le dernier enregistrement des lignes
- **Appliquer ces lignes à toutes les colonnes** : un interrupteur pour les mêmes colonnes que celui de l'onglet de répartition, désactivé par défaut ici. L'activer écrit aussitôt les lignes dans chaque colonne qui suit, et il reste activé : chaque enregistrement suivant écrit aussi les lignes dans ces colonnes. Le désactiver ne change rien en soi

**Lorsque les montants changent autrement** : les lignes restent sur la colonne comme référence, et l'onglet indique d'où viennent désormais les montants, suivi d'un lien **Utiliser à nouveau les lignes**. Les lignes sont alors en lecture seule : vous ne pouvez ni ajouter, ni supprimer, ni modifier une ligne, et l'onglet n'affiche ni montant par ligne, ni ETP, ni **Appliquer ces lignes à toutes les colonnes**. Le lien enregistre les lignes telles quelles et recalcule la colonne à partir d'elles, et les lignes redeviennent modifiables. Pour modifier une ligne gardée comme référence, cliquez d'abord sur **Utiliser à nouveau les lignes**, puis modifiez-la.

- Un mois saisi dans l'onglet **Mensuel** : « Les montants ont été saisis à la main. Utiliser à nouveau les lignes. »
- Une répartition : « Les montants viennent d'une répartition. Utiliser à nouveau les lignes. »
- **Copier les colonnes budgétaires** dans l'Administration budgétaire : « Les montants ont été copiés depuis Budget 2025. Utiliser à nouveau les lignes. » Lorsque les montants source n'étaient pas calculés à partir de lignes, la copie reporte les lignes de la colonne source comme référence. Une colonne calculée à partir de ses lignes le reste, avec ses prix augmentés du pourcentage. Voir [Copier une colonne construite à partir de lignes](budget-operations.md#copier-une-colonne-construite-a-partir-de-lignes)
- Les jours ouvrés d'un calendrier ont changé : « Jours ouvrés modifiés depuis le dernier calcul : mars : 20 jours, maintenant 19. » Rien ne change sur la colonne tant que vous ne cliquez pas sur **Utiliser à nouveau les lignes**. Les lignes restent modifiables entre-temps
- **Réinitialiser une colonne budgétaire** dans l'Administration budgétaire retire les lignes avec les montants. Voir [Réinitialiser une colonne budgétaire](budget-operations.md#reinitialiser-une-colonne-budgetaire)
- Un fichier budgétaire change les mois d'une colonne et laisse ses lignes. Voir [Charger un budget depuis un tableur](budget-file.md)

#### ETP

L'ETP (équivalent temps plein) indique pour combien de personnes une colonne paie. Il provient des lignes de quantité et prix : chaque mois additionne l'ETP de ses lignes (voir le tableau ci-dessus). Deux chiffres en découlent, chacun arrondi à 2 décimales :

- **Moyenne sur l'année** : la somme des douze mois divisée par 12. C'est l'ETP de la colonne, affiché dans le libellé de la colonne et dans les colonnes ETP de la liste
- **ETP sur la période** : la somme des mois qui comptent des personnes ou des jours, divisée par le nombre de ces mois. Les pièces ne comptent pas, si bien que des licences ou un ordinateur portable ne le font jamais baisser. Il s'affiche sous les lignes tant que les montants en viennent. Après une modification à la main, une répartition ou une copie, il n'est plus affiché jusqu'à ce que vous utilisiez à nouveau les lignes

Par exemple, un consultant à temps plein de février à octobre compte 1 ETP dans chacun de ces 9 mois : 1.00 sur la période, et 9 × 1 ÷ 12 = 0.75 sur l'année. Un chef de projet 5 jours par mois de février à juillet compte environ 0.24 sur la période, et 0.12 sur l'année. Des licences sur toute l'année ou un ordinateur portable en décembre sur la même colonne ne changent aucun des deux chiffres.

- **Compté** : une colonne avec des lignes en personnes ou en jours
- **Zéro** : une colonne dont toutes les lignes sont en pièces. Son ETP vaut 0
- **Vide** : une colonne sans ligne, une ligne budgétaire sans version pour cette année, ou une année postérieure à la fin de validité de la ligne. Sa cellule ETP reste vide, car KANAP ne peut pas savoir pour combien de personnes elle paie
- L'ETP reste avec les lignes. Après une modification à la main, une répartition ou une copie, la colonne garde l'ETP de ses lignes. Une copie recalcule l'ETP à partir des lignes copiées, avec les calendriers de jours ouvrés de l'année de destination

---

### Ventilations

L'onglet Ventilations répartit la dépense d'une année entre vos sociétés et départements. Les ventilations des lignes OPEX alimentent les rapports de refacturation et les KPI de coût par utilisateur.

**Sélection d'année** :

- Fonctionne comme le Budget : utilisez les onglets d'année pour basculer entre A-2, A-1, A, A+1, A+2
- Chaque année peut avoir une méthode de ventilation différente
- Le total de l'année de la colonne par défaut s'affiche à droite, par exemple **Budget, total de l'année**, et le tableau montre chaque part en pourcentage et en montant, avec une ligne de total

**Méthodes de ventilation** :

| Méthode | Comment ça fonctionne |
|---|---|
| **Effectif (par défaut)** | Répartit la dépense proportionnellement à l'effectif de chaque société pour l'année sélectionnée. Aucune sélection manuelle requise : les pourcentages sont calculés automatiquement depuis les métriques des sociétés. C'est la méthode standard. |
| **Utilisateurs IT** | Répartit la dépense proportionnellement au nombre d'utilisateurs IT de chaque société pour l'année sélectionnée. |
| **Chiffre d'affaires** | Répartit la dépense proportionnellement au chiffre d'affaires de chaque société pour l'année sélectionnée. |
| **Manuel par société** | Vous sélectionnez les sociétés qui reçoivent cette dépense et choisissez un inducteur dans **Ventiler par** (Effectif, Utilisateurs IT ou Chiffre d'affaires) pour calculer les pourcentages entre les sociétés sélectionnées uniquement. |
| **Manuel par département** | Vous sélectionnez des paires société/département. Les pourcentages sont calculés à partir de l'effectif de chaque département. Utile lorsqu'une ligne ne bénéficie qu'à certains départements (ex. : un CRM utilisé par les ventes). |
| **Pourcentages manuels** | Vous choisissez les sociétés et saisissez vous-même chaque pourcentage. Le total doit faire 100 %. |

**Méthodes par défaut et méthodes épinglées** :

- L'option **par défaut**, affichée comme *Effectif (par défaut)* tant que votre organisation n'a pas configuré une autre méthode, suit le réglage défini dans **Gestion budgétaire > Administration > Méthode de ventilation par défaut**. Chaque ligne laissée sur la valeur par défaut est recalculée lorsqu'un administrateur modifie ce réglage
- Ce réglage peut également restreindre la valeur par défaut à une **sélection de sociétés** (par exemple l'entité qui porte le budget IT) : l'inducteur ne s'applique alors qu'à ces sociétés, et l'option affiche *Par défaut (n sociétés)*
- **Effectif**, **Utilisateurs IT** et **Chiffre d'affaires** épinglent cette méthode sur la ligne : une méthode épinglée continue de fonctionner même si la valeur par défaut de l'organisation change par la suite
- Les lignes dotées d'une ventilation manuelle ne sont jamais affectées par le réglage par défaut

**Comment fonctionnent les pourcentages** :

- Pour les **méthodes automatiques** (Effectif, Utilisateurs IT, Chiffre d'affaires) : les pourcentages sont calculés depuis les dernières métriques de vos sociétés actives. Vous ne les modifiez pas directement
- Pour **Manuel par société** et **Manuel par département** : vous choisissez les sociétés ou départements, et le système calcule les pourcentages selon l'inducteur choisi et les métriques actuelles
- Pour **Pourcentages manuels** : saisir un pourcentage fixe cette rangée, et les autres rangées se partagent le reste. **Répartir équitablement** donne la même part à chaque rangée ; **Réinitialiser les valeurs fixées** libère les rangées fixées
- Les pourcentages reflètent les données en temps réel. Si vous mettez à jour l'effectif d'une société, les ventilations se recalculent

**Comment l'utiliser** :

1. Sélectionnez l'année
2. Choisissez une méthode de ventilation dans **Méthode**
3. Pour une méthode manuelle, utilisez **Ajouter une ligne** pour ajouter des sociétés (ou des paires société/département) et l'icône de retrait pour en enlever une. Pour **Manuel par société**, choisissez un inducteur dans **Ventiler par**
4. Les modifications s'enregistrent automatiquement

**Problèmes courants** :

- **Métriques manquantes** : Une ou plusieurs sociétés ont un effectif, un nombre d'utilisateurs IT ou un chiffre d'affaires nul ou manquant pour l'année sélectionnée. Remplissez les métriques dans **Données de référence > Sociétés** (onglet Détails)
- **« Les pourcentages manuels doivent totaliser 100 %. »** : Ajustez les rangées, ou cliquez sur **Répartir équitablement**

**Lorsqu'une autre personne modifie la ventilation** :

- La méthode, l'inducteur et les rangées s'enregistrent ensemble. Si une autre personne a modifié la ventilation pendant que vous la modifiiez, un bandeau propose **Recharger la ventilation** ou **Écraser**
- Changer d'année alors qu'un choix est en attente demande d'abord confirmation

**Conseil** : Utilisez Effectif (par défaut) pour la plupart des lignes : c'est le plus simple et il se met à jour automatiquement. Réservez les méthodes manuelles aux dépenses qui ne bénéficient qu'à des sociétés ou départements spécifiques.

---

### Relations

L'onglet Relations lie la ligne aux objets associés : Projets, Applications, Contrats, Contacts, Sites web pertinents et Pièces jointes. Tout ce qui se trouve dans cet onglet s'enregistre automatiquement.

**Projets** :

- Utilisez l'autocomplétion pour lier un ou plusieurs projets depuis votre Portefeuille
- Cela aide à regrouper les dépenses par projet dans les rapports et permet la comptabilité projet
- Les noms des projets apparaissent dans la colonne **Projet** de la liste, et la recherche rapide les trouve
- Retirez un projet en cliquant sur le X de sa puce

**Applications** :

- Utilisez l'autocomplétion pour lier une ou plusieurs applications ou services depuis votre catalogue IT
- Cela aide à suivre quelles lignes financent quelles applications ou services
- Retirez une application en cliquant sur le X de sa puce

**Contrats** :

- Utilisez l'autocomplétion pour lier un ou plusieurs contrats
- Lorsqu'ils sont liés, le nom du contrat apparaît dans la colonne **Contrat** de la liste pour référence rapide
- Un contrat peut être lié à plusieurs lignes (relation plusieurs-à-plusieurs)
- Retirez un contrat en cliquant sur le X de sa puce

**Contacts** :

- Liez des contacts à la ligne : choisissez un contact, puis son rôle (**Commercial**, **Technique**, **Support** ou **Autre**). Le choix du rôle ajoute le contact
- Le tableau affiche le rôle, le prénom, le nom, la fonction, l'e-mail et le mobile. Survolez le rôle pour savoir si le contact vient du fournisseur ou a été ajouté manuellement
- Retirez un contact avec l'icône de retrait
- Utile pour savoir qui contacter pour les renouvellements, les incidents de support ou les négociations

**Sites web pertinents** :

- Cliquez sur **Ajouter une URL** pour ajouter un lien (ex. : portails fournisseurs, documentation, consoles d'administration, wikis internes). Chaque lien a un **Nom** et une **URL**
- Cliquez sur la rangée d'un lien pour le modifier, ou utilisez l'icône de suppression pour le retirer

**Pièces jointes** :

- Téléversez des fichiers liés à la ligne (ex. : contrats, factures, devis, cahiers des charges, notes d'approbation, spécifications techniques)
- Glissez-déposez des fichiers dans la zone de pièces jointes, ou cliquez sur **Sélectionner des fichiers** pour parcourir
- Cliquez sur la puce d'un fichier pour le télécharger
- Supprimez une pièce jointe avec l'icône de suppression de sa puce (après confirmation ; nécessite `budget:member`)

**Conseil** : Liez les contrats pour suivre les renouvellements sur plusieurs lignes. Ajoutez les URL des portails fournisseurs pour un accès rapide. Téléversez les devis et factures en pièces jointes pour garder tous les documents d'une ligne au même endroit.

---

## Import/export CSV

**Exporter CSV** et **Importer CSV** se trouvent dans la barre d'outils de la liste. Les deux demandent le niveau Admin sur Budget (`budget:admin`).

**Exporter CSV** écrit le fichier budgétaire des lignes affichées par la liste, OPEX et CAPEX ensemble, sous le nom `budget.csv`. **Importer CSV** relit un fichier : il est d'abord vérifié, et rien n'est écrit avant que vous cliquiez sur **Charger**.

Le fichier contient une rangée par ligne : sa `nature` (`opex` ou `capex`), sa référence `BL-n`, les détails de la ligne, ses montants en colonnes et `kanap_token`. Un fichier sans colonne `nature`, exporté par une version antérieure, est lu comme des lignes OPEX, ou comme des lignes CAPEX quand le filtre **Type** de la liste ne garde que CAPEX. [Charger un budget depuis un tableur](budget-file.md) décrit les colonnes, ce que signifie une cellule et les deux étapes de l'import.

---

## Statut et cycle de vie

Chaque ligne a un **statut** (Activé ou Désactivé) et une **Fin de validité** optionnelle qui détermine quand elle apparaît dans les rapports et les listes de sélection. C'est la seule date de fin d'une ligne.

**Fonctionnement** :

- **Activé** : La ligne est active et apparaît partout (listes, rapports, ventilations)
- **Fin de validité** : La date à laquelle la ligne s'arrête. Laissez-la vide s'il n'y a pas de fin. Une fois la fin de validité passée, le statut passe à **Désactivé** de lui-même dans l'heure
- Après la fin de validité :
    - La ligne n'apparaît plus dans les listes de sélection pour de nouveaux contrats ou ventilations
    - Elle est exclue des rapports pour les années strictement postérieures à la fin de validité
    - Les données historiques restent intactes ; la ligne apparaît toujours dans les rapports couvrant les années où elle était active

**Définir le statut** :

- À la création de la ligne, vous pouvez définir sa **Fin de validité** dans le panneau **Propriétés**
- Ensuite, modifiez le **Statut** dans la barre de métadonnées, ou utilisez le champ **Cycle de vie** du panneau **Propriétés** (interrupteur de statut et **Fin de validité**). Désactiver une ligne sans date fixe sa fin de validité à aujourd'hui
- Vous pouvez programmer une fin de validité future, par exemple la fin d'un contrat, une cession prévue ou la fin de la durée de vie utile d'un actif

**Afficher les lignes désactivées** :

- Par défaut, la liste n'affiche que les lignes **Activées**
- Les lignes qui se terminent pendant l'année en cours restent dans **Activés** jusqu'au 31 décembre, même lorsque leur statut indique **Désactivé**. Elles passent dans **Désactivés** le 1er janvier
- Utilisez la bascule **Afficher : Tous / Activés / Désactivés** et choisissez **Désactivés** ou **Tous** pour voir les lignes terminées une année précédente

**Désactiver ou supprimer** :

- **Privilégiez la désactivation** : Elle préserve l'historique, garantit la cohérence des rapports et conserve la piste d'audit
- **Supprimez uniquement si** : La ligne a été créée par erreur
- Une ligne qui a des montants dans une colonne gelée ne peut pas être supprimée. Dégelez d'abord la colonne, ou fixez plutôt une date de fin de validité
- Supprimer une ligne supprime aussi ses budgets, ventilations, tâches, sites web pertinents, pièces jointes (avec leurs fichiers) et ses liens vers des contrats. Si l'une de ses tâches a été transformée en demande, la demande est conservée : elle possède sa propre copie du titre, de la description et des pièces jointes, et seul son lien vers la tâche disparaît

**Conseil** : Utilisez la Fin de validité pour clore les lignes lorsque les contrats se terminent, que les services s'arrêtent, que les actifs sont cédés ou que les projets s'achèvent. Ne supprimez qu'une ligne créée par erreur.

---

## Changer le type

Une ligne OPEX qui s'avère être un investissement devient une ligne CAPEX, et une ligne CAPEX qui s'avère être une dépense de fonctionnement devient une ligne OPEX. Utilisez **Changer le type...** dans le menu **...** de l'en-tête de l'espace de travail, ou à côté de **Type** dans le panneau **Propriétés**. Il faut le niveau Membre sur Budget (`budget:member`). Les modifications pas encore enregistrées sont enregistrées avant l'ouverture de la fenêtre.

**À partir de** fixe le début du changement :

- **La première année de la ligne** (par défaut) : la ligne elle-même change de type. Elle garde sa référence `BL` et son adresse, ses budgets, ventilations, liens, pièces jointes et tâches. Son **Type** change dans la liste. Une ligne qui devient CAPEX quitte les rapports OPEX et la refacturation, et rejoint les rapports CAPEX. Une ligne qui devient OPEX fait l'inverse
- **Une année ultérieure** : cette ligne se termine le 31 décembre de l'année précédente et garde ses budgets antérieurs. Une nouvelle ligne de l'autre type, avec sa propre référence `BL`, porte le budget à partir de cette année, avec les contacts et les liens vers les applications, actifs, contrats, projets et demandes. Les pièces jointes, les sites web pertinents et les tâches restent sur cette ligne. Le haut de l'onglet **Vue d'ensemble** relie les deux lignes : **Remplacée par** sur cette ligne, **Succède à** sur la nouvelle

La fenêtre demande aussi :

- **Compte** : un compte pour le nouveau type. Lorsque le compte de la ligne est réservé à son type actuel, la ligne qui change elle-même de type le garde, sauf si vous en choisissez un autre ; une nouvelle ligne à partir d'une année ultérieure ne le reçoit que s'il convient au nouveau type
- **Dimensions** : les dimensions obligatoires pour le nouveau type, et les valeurs de la ligne réservées à son type actuel. Si la ligne change elle-même de type, vous pouvez les renseigner maintenant ou plus tard. À partir d'une année ultérieure, la nouvelle ligne a besoin des dimensions obligatoires, et les valeurs réservées au type actuel ne sont pas reprises. Les [dimensions CAPEX](#dimensions-capex) ne s'appliquent pas aux lignes OPEX : une ligne CAPEX qui devient elle-même OPEX garde leurs valeurs sans les afficher, et les affiche de nouveau si elle redevient CAPEX
- **Motif** : facultatif, conservé dans le journal d'audit de la ligne

Le changement est refusé lorsque la ligne a des montants dans une colonne gelée, des lignes OPEX ou CAPEX, sur les années qui changent. Dégelez d'abord la colonne, ou faites commencer le changement à une année ultérieure. Une année ultérieure est proposée lorsqu'elle suit la première année budgétaire de la ligne, que la ligne a un budget cette année-là ou une année suivante, commence avant le 1er janvier de cette année et est encore valide ce jour-là, et n'est pas déjà remplacée par une autre ligne. Un changement commence toujours le 1er janvier.

Un fichier budgétaire ne change jamais le type d'une ligne. Voir [Charger un budget depuis un tableur](budget-file.md).

---

## Conseils et bonnes pratiques

1. **Commencez simple** : Créez les lignes avec juste l'essentiel (titre, société payeuse, compte et dimensions obligatoires), puis ajoutez les budgets et ventilations au fur et à mesure que vous planifiez.

2. **Utilisez la méthode de ventilation par défaut** : Pour la plupart des lignes, Effectif (par défaut) suffit. Réservez les ventilations manuelles aux dépenses qui ne bénéficient qu'à des sociétés ou départements spécifiques.

3. **Liez les contrats** : Si vous gérez les dépenses via des contrats, liez-les dans l'onglet Relations. Cela facilite le suivi des renouvellements et des achats.

4. **Liez les applications** : Associez les lignes aux applications ou services qu'elles financent. Vous obtenez une correspondance claire entre coûts et applications.

5. **Téléversez la documentation** : Utilisez les Pièces jointes pour stocker les contrats fournisseurs, devis, factures, notes d'approbation et cahiers des charges.

6. **Ajoutez les liens des portails fournisseurs** : Utilisez les Sites web pertinents pour pointer vers les consoles d'administration, les portails de support et la documentation des fournisseurs.

7. **Suivez les contacts** : Ajoutez les contacts fournisseurs avec leur rôle (Commercial, Technique, Support) pour que votre équipe sache qui appeler pour chaque ligne.

8. **Exploitez les dimensions analytiques** : Donnez aux lignes une valeur sur chaque dimension (par exemple Licenses sur Nature, ou l'**Investment type** et la **Priority** d'une ligne CAPEX) pour regrouper les dépenses dans les rapports.

9. **Maintenez les métriques des sociétés à jour** : Les ventilations dépendent de l'effectif, des utilisateurs IT et du chiffre d'affaires des sociétés. Des métriques obsolètes causent des erreurs de ventilation.

10. **Utilisez le CSV pour la configuration en masse** : Si vous migrez depuis un autre système ou avez des centaines de lignes, commencez par l'import CSV. Exportez un fichier récent, remplissez vos rangées et vérifiez-le avant de charger.

11. **Désactivez au lieu de supprimer** : Préservez l'historique en désactivant les lignes lorsqu'elles ne sont plus actives. Ne supprimez qu'en cas d'erreur.

12. **Vérifiez les lignes de totaux** : Avant de finaliser les budgets, vérifiez les totaux épinglés dans la liste, par type et au global, pour vous assurer que vos dépenses s'additionnent comme prévu.

13. **Utilisez les liens profonds** : Cliquez directement sur une colonne budgétaire dans la liste pour accéder à l'onglet Budget de cette année. Cliquez sur la colonne Tâche pour accéder aux tâches de la ligne dans l'onglet Vue d'ensemble. Vous gagnez du temps de navigation.

14. **Gelez les budgets après la clôture de fin d'année** : Utilisez l'Administration budgétaire pour geler les budgets de l'année précédente une fois le réalisé finalisé, ce qui empêche les modifications accidentelles.

---

## Autorisations

L'accès aux lignes budgétaires est contrôlé par la ressource Budget, qui couvre les lignes OPEX et CAPEX de la même façon. Elle a trois niveaux :

- `budget:reader` : Consulter la liste, ouvrir les lignes, voir les budgets et ventilations (lecture seule), télécharger les pièces jointes
- `budget:member` : Créer et modifier les lignes, changer leur type, mettre à jour les budgets et ventilations, téléverser et supprimer les pièces jointes, gérer les relations, liens et contacts
- `budget:admin` : Tous les droits membre plus import et export CSV, opérations budgétaires (copier les colonnes budgétaires, copier les ventilations, réinitialiser une colonne budgétaire) et suppression en masse

Le gel des colonnes budgétaires relève de l'administration budgétaire (`budget_ops:admin`).

De plus :

- Les tâches ont des autorisations séparées (`tasks:member` pour créer et modifier des tâches sur les lignes budgétaires)
- Les utilisateurs avec `tasks:reader` peuvent consulter les tâches mais ne peuvent pas les créer ou les modifier

Si vous ne pouvez pas effectuer une action (ex. : le bouton **Importer CSV** est manquant, ou vous ne pouvez pas téléverser de pièces jointes), demandez à l'administrateur de votre espace de travail de revoir les autorisations de votre rôle.

---

## Besoin d'aide ?

- **Problèmes de CSV** : Exportez un nouveau fichier depuis la liste et vérifiez-le de nouveau. Le rapport nomme la ligne et la colonne de chaque erreur, et [Charger un budget depuis un tableur](budget-file.md) explique ce que signifie chaque cellule
- **Erreurs de ventilation** : Vérifiez que toutes les sociétés ont les métriques requises (effectif, utilisateurs IT, chiffre d'affaires) pour l'année sélectionnée
- **Avertissement de compte obsolète** : Le compte n'appartient pas au plan comptable de la société payeuse ; choisissez un autre compte
- **Boutons ou onglets manquants** : Votre rôle n'a peut-être pas le niveau d'autorisation requis (membre ou admin). Contactez l'administrateur de votre espace de travail
