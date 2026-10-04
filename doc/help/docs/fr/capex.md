# CAPEX

Les postes CAPEX (dépenses d'investissement) sont vos investissements dans des actifs à long terme : achats de matériel, licences logicielles à valeur pluriannuelle, projets d'infrastructure et équipements. C'est ici que vous planifiez les budgets d'investissement, suivez les dépenses de projet et répartissez les coûts à travers votre organisation.

L'espace de travail CAPEX vous aide à gérer chaque poste d'investissement de la budgétisation initiale jusqu'à l'exécution et le reporting, le tout en un seul endroit avec des colonnes budgétaires annuelles, des méthodes de ventilation flexibles et des liens directs vers les projets, applications, contrats et contacts.

## Premiers pas

Rendez-vous dans **Gestion budgétaire > CAPEX** pour voir votre liste. Cliquez sur **Nouveau** pour créer votre premier poste.

L'espace de travail s'ouvre en mode création, avec le panneau **Propriétés** ouvert à droite. Saisissez le nom de l'investissement dans le titre en haut, remplissez les propriétés, puis cliquez sur **Créer**.

**Champs obligatoires** :

- **Titre** : Ce dans quoi vous investissez (ex. : « Nouvelle infrastructure serveur », « Licence logiciel ERP »). C'est la description du poste, affichée dans la colonne **Description** de la liste
- **Société payeuse** : Quelle société réalise l'investissement (obligatoire pour la comptabilité)
- **Compte** : Le compte du grand livre pour cette dépense d'investissement. Seuls les comptes du plan comptable de la société payeuse apparaissent
- **Devise** : Code ISO (ex. : USD, EUR). Par défaut la devise CAPEX de votre espace de travail ; modifiable par poste
- **Type d'immobilisation** : Classification des immobilisations corporelles : Matériel ou Logiciel
- **Type d'investissement** : Objectif de l'investissement (voir les options ci-dessous)
- **Priorité** : Niveau de priorité métier (voir les options ci-dessous)
- **Début d'effet** : Quand cet investissement commence (JJ/MM/AAAA)

**Optionnel mais utile** :

- **Fournisseur** : Le vendeur ou fournisseur de cet investissement. Sélectionnez-le parmi vos fournisseurs dans les données de référence
- **Centre de coûts** : Qui porte l'investissement. Voir [Centres de coûts](cost-centers.md). Lorsque la société payeuse est encore vide, choisir un centre de coûts la remplit avec la société du centre de coûts
- **Run ou build** : **Run** pour une dépense qui maintient les services existants, **Build** pour une dépense qui les crée ou les fait évoluer
- **Dimensions analytiques** : Un champ par dimension, à son nom, pour des regroupements personnalisés dans les rapports. La dimension par défaut s'affiche comme **Dimension analytique** tant qu'elle n'est pas renommée. Voir [Dimensions analytiques](analytics.md)
- **Fin de validité** : La date à laquelle cet investissement s'arrête, par exemple à la fin de la durée de vie utile de l'actif ou à l'achèvement du projet. Laissez-la vide s'il n'y a pas de fin. Après cette date, le poste est désactivé et les années suivantes ne comptent plus dans les vues budgétaires
- **Responsable IT** / **Responsable métier** : Qui est en charge
- **Description** (onglet Vue d'ensemble) : Détails libres sur l'investissement

Une fois renseignés, **Société payeuse** et **Compte** peuvent être modifiés mais pas vidés. **Fournisseur** peut être effacé à tout moment. Lorsque vous changez la société payeuse d'un poste qui a un compte, et que la nouvelle société utilise un autre plan comptable, le compte est effacé dans le même enregistrement : choisissez le nouveau compte sur le plan comptable de la nouvelle société. Le fichier CAPEX porte aussi le compte, dans la colonne `account_number`, sur le plan comptable de la société payeuse.

Une fois le poste créé, l'espace de travail déverrouille les quatre onglets : **Vue d'ensemble**, **Budget**, **Ventilations** et **Relations**.

**Conseil** : Vous pouvez créer des postes rapidement et remplir les budgets et ventilations plus tard. Commencez par l'essentiel et itérez.

---

## Types d'investissement

Les postes CAPEX doivent être classifiés par type d'investissement. Cela aide à analyser les schémas de dépenses d'investissement :

- **Remplacement** : Remplacement d'actifs existants obsolètes ou en fin de vie
- **Capacité** : Ajout de capacité pour supporter la croissance métier ou une demande accrue
- **Productivité** : Amélioration de l'efficacité ou réduction des coûts opérationnels
- **Sécurité** : Renforcement de la posture de sécurité, conformité ou atténuation des risques
- **Conformité** : Satisfaction d'exigences réglementaires ou de conformité
- **Croissance métier** : Permettre de nouveaux produits, marchés ou capacités métier
- **Autre** : Investissements ne correspondant pas aux catégories ci-dessus

**Niveaux de priorité** :

- **Obligatoire** : Doit être fait (réglementaire, infrastructure critique, sécurité)
- **Haute** : Business case solide, ROI élevé ou importance stratégique
- **Moyenne** : Précieux mais reportable si nécessaire
- **Basse** : Souhaitable, peut être reporté

---

## Travailler avec la liste CAPEX

La liste CAPEX (dans **Gestion budgétaire > CAPEX**) est votre vue principale pour parcourir, filtrer et naviguer dans les postes d'investissement.

### Colonnes par défaut

| Colonne | Ce qu'elle affiche |
|---------|-------------------|
| **Réf** | Référence du poste, par exemple CPX-12 |
| **Description** | Nom de l'investissement |
| **Fournisseur** | Le nom du fournisseur |
| **Société payeuse** | Quelle société paie ce poste |
| **Contrat** | Le nom du dernier contrat lié |
| **Compte** | Le numéro et nom du compte comptable |
| **Type d'immobilisation** | Matériel ou Logiciel |
| **Type d'investissement** | Objectif de l'investissement |
| **Priorité** | Niveau de priorité métier |
| **Ventilation** | Libellé de la méthode de ventilation de l'année en cours |
| **Budget A** et **Atterrissage prévu A** | Les montants de l'année en cours de la colonne par défaut et de la dernière colonne affichée, dans la devise de reporting. Avec les réglages standard, ce sont Budget et Atterrissage prévu. Quand la colonne par défaut est aussi la dernière affichée, une seule colonne de montant apparaît. Voir [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires) |
| **Tâche** | Titre de la tâche la plus récente liée à ce poste |

### Colonnes supplémentaires

Ces colonnes sont masquées par défaut. Affichez-les depuis le sélecteur de colonnes (menu hamburger dans l'en-tête de la grille) :

| Colonne | Ce qu'elle affiche |
|---|---|
| **Colonnes de montants** | Chaque colonne budgétaire affichée pour A-1, A, A+1 et A+2, sous les noms choisis par votre organisation. L'en-tête indique la colonne, l'année par rapport à aujourd'hui et l'année civile, par exemple **Révision A+1 (2027)**. Les montants sont dans la devise de reporting. Les colonnes masquées ne sont pas proposées |
| **Colonnes ETP** | L'ETP de chaque colonne budgétaire affichée pour A-1, A, A+1 et A+2, sous les noms choisis par votre organisation, juste après les colonnes de montants dans le sélecteur de colonnes. L'en-tête indique la colonne et l'année civile, par exemple **ETP Budget (2026)**. L'ETP d'un poste est la somme des ETP de ses lignes dans cette colonne. Voir [ETP](#etp). La cellule est vide lorsque la colonne n'a aucune ligne |
| **Devise** | Code de devise du poste |
| **Début effectif** | Date de début |
| **Fin de validité** | Date à laquelle le poste s'arrête (vide signifie sans fin) |
| **Responsable IT** / **Responsable métier** | Utilisateurs responsables |
| **Dimensions analytiques** | Une colonne par dimension activée, à son nom, avec la valeur du poste. La colonne de la dimension par défaut vient en premier (**Dimension analytique** tant qu'elle n'est pas renommée), puis les autres dimensions dans leur ordre |
| **Centre de coûts** | Le code et le nom du centre de coûts. Survolez-le pour voir son chemin complet dans l'arbre ; cliquez dessus pour ouvrir le centre de coûts |
| **Responsable budgétaire** | Le responsable budgétaire du centre de coûts du poste. Il est déduit du centre de coûts et non enregistré sur le poste : changez le responsable budgétaire d'un centre de coûts et tous ses postes suivent |
| **Run ou build** | **Run** ou **Build** |
| **Projet** | Noms des projets liés dans l'onglet Relations |
| **Notes** | Notes libres |
| **Activé** | Statut (activé ou désactivé) |
| **Créé** / **Mis à jour** | Horodatages |

### Recherche rapide

Le champ de recherche en haut porte sur la référence, la description, le fournisseur, la société payeuse, le compte, le contrat, les noms de projets, la ventilation, les responsables, les valeurs analytiques, le centre de coûts (code, nom et chemin), le responsable budgétaire, le type d'immobilisation, le type d'investissement, la priorité, les notes, la devise et le statut. Les résultats se mettent à jour en temps réel pendant la saisie, en ignorant les accents et la casse.

### Filtres de colonnes

Chaque en-tête de colonne filtrable a une icône de filtre. **Fournisseur**, **Société payeuse**, **Compte**, **Type d'immobilisation**, **Type d'investissement**, **Priorité**, **Ventilation**, **Devise**, **Responsable IT**, **Responsable métier**, chaque dimension analytique, **Centre de coûts**, **Responsable budgétaire**, **Run ou build** et **Activé** utilisent des filtres par jeu de cases à cocher avec **Tous**, **Aucun** et un bouton d'effacement. Le filtre **Activé** propose **Activé** et **Désactivé** et restreint la liste lorsque **Afficher** est réglé sur **Tous**. Cliquer sur **Effacer** dans ce filtre, ou décocher les deux valeurs, n'affiche plus rien, quel que soit le choix de **Afficher**. Plusieurs filtres se combinent avec une logique ET.

Cochez **Tous**, puis décochez les valeurs à exclure : le filtre garde tout sauf celles-ci (l'en-tête affiche par exemple **Tous sauf 3**), et une valeur créée plus tard est incluse automatiquement.

Chaque colonne de montant a un filtre numérique. Un nombre saisi dans la case sous l'en-tête garde les postes d'au moins ce montant. Ouvrez le menu du filtre pour les autres conditions : supérieur à, inférieur à, égal, différent, ou entre deux montants.

Chaque colonne ETP a un filtre numérique avec les mêmes conditions, plus vide et non vide. **Vide** garde les postes dont la colonne n'a aucune ligne.

**Début effectif**, **Fin de validité**, **Créé** et **Mis à jour** ont des filtres de date. Choisissez une date dans la case sous l'en-tête pour garder les postes à cette date, ou ouvrez le menu du filtre pour avant, après, entre, vide ou non vide.

Les colonnes texte utilisent des filtres texte, en ignorant les accents et la casse. Sur **Réf**, saisissez le numéro ou la référence complète, par exemple `12` ou `CPX-12`.

### Tri

Cliquez sur un en-tête de colonne pour trier par ordre croissant ou décroissant. Toutes les colonnes se trient, y compris chaque colonne de montant et chaque colonne ETP. Les postes sans ETP viennent en dernier dans l'ordre croissant. Les colonnes de texte se trient dans l'ordre de lecture naturel : un nom accentué se trie à côté de son équivalent sans accent (par exemple « Électricité » à côté de « Electricite »), et les minuscules passent avant les majuscules à égalité de lettres. Le tri par défaut suit la colonne par défaut de l'année en cours, du plus élevé au plus faible (**Budget A** avec les réglages standard). **Préc.** et **Suiv.** dans l'espace de travail suivent le même ordre. La liste mémorise votre dernier tri quand vous revenez.

### Ligne de totaux

La ligne épinglée en bas affiche le total de chaque colonne de montant. Les totaux respectent vos filtres et recherche actuels. Tous les montants sont convertis dans votre devise de reporting, affichée dans le titre de la page.

Chaque colonne ETP affichée montre la somme des ETP des postes. Lorsque certains postes n'ont pas d'ETP, leur nombre suit le total, par exemple « 3.50 · 12 inconnues ». Survolez-le pour lire la phrase complète : « Inconnu pour 12 lignes ». Lorsqu'aucun poste n'a d'ETP, le total est vide et seul le nombre s'affiche.

### Liens profonds

Cliquez sur n'importe quelle cellule d'une ligne pour ouvrir l'espace de travail sur l'onglet le plus pertinent pour cette colonne :

- **Description**, **Fournisseur**, **Société payeuse**, **Type d'immobilisation**, **Type d'investissement**, **Priorité** et les autres colonnes générales : Ouvre la **Vue d'ensemble**
- **Colonnes de montants** (Budget A, Atterrissage prévu A, Révision A+1, etc.) et **Colonnes ETP** : Ouvre l'onglet **Budget** sur l'année de la colonne
- **Ventilation** : Ouvre l'onglet **Ventilations** pour l'année en cours
- **Tâche** : Ouvre l'onglet **Vue d'ensemble**, où se trouve le panneau des tâches
- **Contrat** : Ouvre directement le contrat lié
- **Centre de coûts** : Ouvre l'espace de travail du centre de coûts

### Filtre de statut

Utilisez la bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la grille pour choisir le périmètre de cycle de vie (par défaut **Activés**). Choisissez **Désactivés** pour revoir les investissements archivés, ou **Tous** pour inclure les deux états. Les totaux se mettent à jour immédiatement.

### Conservation du contexte de recherche

Votre contexte de liste (ordre de tri, texte de recherche et filtres actifs) est conservé lorsque vous ouvrez un poste et restauré lorsque vous revenez à la liste. Vous pouvez ainsi consulter plusieurs postes à la suite sans perdre votre position.

Ces mêmes filtres sont aussi conservés dans l'adresse de la page : recharger la page ou partager le lien rouvre la même vue. Un lien dont les filtres ne sont plus disponibles affiche « Les filtres de ce lien ne sont plus disponibles. »

### Navigation Préc./Suiv.

Lorsque vous ouvrez un poste, l'espace de travail affiche les boutons **Préc.** et **Suiv.**. Ils parcourent la liste dans l'ordre de tri actuel, en respectant les filtres et la recherche, et enregistrent d'abord vos modifications en attente. Le compteur (ex. : « Poste 3 sur 47 ») indique votre position dans la liste filtrée.

**Conseil** : Utilisez les filtres de colonnes et la recherche rapide pour construire des vues ciblées (ex. : « Tous les investissements matériel de priorité haute »), puis naviguez poste par poste avec **Préc.**/**Suiv.** pour revoir les budgets.

---

## L'espace de travail CAPEX

Cliquez sur n'importe quelle ligne de la liste pour ouvrir l'espace de travail. Il comporte quatre parties :

- **En-tête** : la référence du poste (ex. : `CPX-7`) avec un bouton de copie, le nom de l'investissement (cliquez dessus pour renommer le poste), **Préc.** / **Suiv.**, **Envoyer le lien** et le bouton de fermeture
- **Barre de métadonnées** sous le titre : **Statut**, **Priorité**, **Responsable IT** et **Responsable métier**, modifiables sur place. Lorsque le centre de coûts du poste a un responsable budgétaire, **Responsable budgétaire** vient ensuite. Il est en lecture seule et déduit du centre de coûts, non enregistré sur le poste : survolez-le pour voir de quel centre de coûts il provient, et modifiez-le sur le centre de coûts (voir [Centres de coûts](cost-centers.md#responsable-budgetaire-sur-les-lignes-budgetaires))
- **Quatre onglets** : **Vue d'ensemble**, **Budget**, **Ventilations** et **Relations** (l'onglet Relations indique le nombre de liens du poste)
- **Panneau Propriétés** à droite : les champs principaux du poste. Ouvrez-le ou fermez-le avec le bouton des propriétés ; l'espace de travail mémorise votre choix

**Enregistrement automatique** :

- Chaque modification s'enregistre automatiquement. L'indication **Enregistrement...** / **Enregistré** apparaît dans l'en-tête
- Changer d'onglet, passer au poste précédent ou suivant, ou fermer l'espace de travail enregistre d'abord les modifications en attente. Si un enregistrement échoue, vous restez sur place et un message en donne la raison : aucune modification n'est perdue sans que vous le sachiez
- **Ctrl+S** (**Cmd+S** sur Mac) enregistre immédiatement
- Si un enregistrement ne peut pas passer tout de suite parce qu'un autre enregistrement est en cours sur la même donnée, KANAP le relance automatiquement
- Si une opération budgétaire groupée est en cours (par exemple une copie ou une réinitialisation de colonne dans l'Administration budgétaire), les modifications sont mises en attente avec le message « Une autre opération sur le budget est en cours. Réessayez quand elle sera terminée. » Réessayez une fois l'opération terminée

**Modifications simultanées** :

- Deux personnes peuvent travailler sur le même poste en même temps sans se gêner. Modifier des champs différents, des mois budgétaires différents ou des colonnes budgétaires différentes ne crée jamais de conflit, même sur le même poste au même moment
- Lorsqu'une autre personne modifie le même champ, la même colonne budgétaire ou la ventilation pendant que vous la modifiez, un bandeau affiche sa valeur et la vôtre, avec qui l'a modifiée et quand. Choisissez **Garder sa valeur** pour reprendre la sienne, ou **Appliquer la vôtre** pour garder ce que vous avez saisi. Pour une colonne budgétaire, les choix sont **Recharger la colonne** ou **Écraser** ; pour la ventilation, **Recharger la ventilation** ou **Écraser**
- Seul le champ, la colonne ou la ventilation qui a été modifié attend votre choix ; tout le reste continue à s'enregistrer normalement
- Un choix en attente est conservé quand vous changez d'onglet. Il est perdu, après un avertissement, si vous quittez le poste ou changez d'année
- Si la modification précédente est la vôtre, depuis une autre fenêtre ou un autre onglet, le bandeau le précise au lieu de nommer quelqu'un d'autre

### Vue d'ensemble

L'onglet Vue d'ensemble contient les détails de l'investissement et ses tâches.

**Ce que vous pouvez modifier** :

- **Description** : Détails libres sur l'investissement (la colonne `name` du fichier CAPEX). Le nom de l'investissement est le titre en haut

**Panneau des tâches** :

- Liste toutes les tâches liées à ce poste CAPEX, avec les colonnes **Titre**, **Statut**, **Priorité**, **Échéance** et **Actions**. Le titre du panneau indique le nombre de tâches
- Filtre **Statut** : Tous (par défaut), Actifs (non terminés) ou un statut précis. Le bouton de réinitialisation l'efface
- Cliquez sur **Ajouter une tâche** pour ouvrir une nouvelle tâche déjà liée à ce poste. Remplissez le titre, la description, la priorité, le responsable et l'échéance dans l'espace de travail de la tâche
- Utilisez l'icône d'ouverture pour aller sur une tâche, et l'icône de suppression pour la supprimer (après confirmation)
- Les tâches ont leurs propres autorisations (`tasks:member` pour créer et modifier). L'accès manager CAPEX ne donne pas à lui seul le droit de modifier les tâches ; vérifiez avec votre admin si vous ne pouvez pas créer de tâches
- Les tâches peuvent aussi être consultées et gérées depuis **Portefeuille > Tâches**, qui affiche toutes les tâches de votre organisation
- Le titre de la dernière tâche apparaît aussi dans la colonne **Tâche** de la liste (masquée par défaut)

**Panneau Propriétés** :

- **Fournisseur**, **Centre de coûts**, **Société payeuse**, **Compte** (filtré par le plan comptable de la société payeuse), **Devise** (seulement les devises autorisées dans votre espace de travail), **Type d'immobilisation**, **Type d'investissement**, un champ par dimension analytique, **Run ou build** et **Début d'effet**
- **Cycle de vie** : l'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité**. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie)
- Dates **Créé** et **Mis à jour** (lecture seule)
- La **Priorité** se règle dans le panneau Propriétés à la création du poste, puis dans la barre de métadonnées
- Saisissez du texte dans **Fournisseur**, **Société payeuse**, **Compte**, **Responsable IT**, **Responsable métier** ou un champ de dimension analytique pour rechercher par nom. Les résultats apparaissent au fur et à mesure que vous tapez, afin de trouver n'importe quelle valeur même dans une très longue liste ; une ligne sous la liste indique « Tapez pour affiner : d'autres résultats existent » lorsqu'il y a plus de résultats qu'affichés

**Centre de coûts** :

- La liste présente l'arbre des centres de coûts. Les groupes s'affichent pour vous aider à vous repérer et ne peuvent pas être choisis. Recherchez par code, nom ou nom de groupe
- Un centre de coûts désactivé est marqué **Désactivé**. Il reste sur les postes qui l'ont déjà et ne peut pas être choisi pour un autre poste
- Lorsque vous créez un poste et que la société payeuse est vide, choisir un centre de coûts remplit la société payeuse avec la société du centre de coûts : la liste **Compte** s'ouvre alors sur le plan comptable de cette société. Tant que vous n'avez pas choisi vous-même une société ou un compte, choisir un autre centre de coûts met aussi à jour la société
- Lorsque la société payeuse diffère de la société du centre de coûts, les deux sont conservées. Une indication sous le champ affiche « Ce centre de coûts appartient à » suivi du nom de la société
- Un poste enregistré via l'API avec un centre de coûts et sans société payeuse prend la société du centre de coûts. Pour les fichiers CSV, voir [Import/export CSV](#importexport-csv)

**Run ou build** : **Run**, **Build** ou **Non défini**. Utilisez-le pour répartir le budget entre le maintien des services et leur évolution.

**Dimensions analytiques** :

- Chaque dimension activée a son propre champ, au nom de la dimension, dans l'ordre des dimensions. Choisissez une valeur ou videz le champ ; la modification s'enregistre aussitôt
- Chaque champ liste les valeurs activées de sa dimension. Une valeur désactivée reste sur les postes qui l'ont déjà, et ne peut pas être choisie pour un autre poste
- Le champ ne peut pas créer de valeur : créez-la dans [Dimensions analytiques](analytics.md), ou laissez un import CSV la créer
- Si les dimensions ne peuvent pas être chargées, une ligne remplace ces champs : « Les dimensions n'ont pas pu être chargées. »

**Conseil** : Lors de la création d'un poste, un avertissement « compte obsolète » signifie que le compte sélectionné n'appartient pas au plan comptable de la société payeuse. Choisissez un autre compte pour résoudre l'avertissement. Un poste existant dont le compte est hors du plan comptable de sa société reste modifiable : le plan comptable n'est vérifié que lorsque la société ou le compte change.

---

### Budget

L'onglet Budget est l'endroit où vous saisissez les données financières par année. Il prend en charge plusieurs colonnes budgétaires et deux modes de saisie, présentés sous forme d'onglets : **Annuel** (total annuel) et **Mensuel** (ventilation sur 12 mois).

**Sélection d'année** :

- Utilisez les onglets d'année en haut pour basculer entre A-2, A-1, A (année en cours), A+1 et A+2
- Chaque année a sa propre version, sa méthode de ventilation et ses montants
- Changer d'année enregistre d'abord vos modifications en attente

**Colonnes budgétaires** (toutes les années) :

L'onglet montre les colonnes affichées par votre organisation, sous leurs noms, toujours dans le même ordre. Les colonnes standard sont :

- **Budget** : Budget d'investissement planifié initial
- **Révision** : Mise à jour budgétaire en cours d'année (ex. : après des changements de périmètre ou des re-prévisions)
- **Prévision** : Une colonne de planification complémentaire, masquée par défaut
- **Réalisé** : La dépense d'investissement réelle, telle qu'elle est enregistrée pendant l'année
- **Atterrissage prévu** : Votre meilleure estimation de la dépense d'investissement de fin d'année

Un administrateur budgétaire peut renommer les colonnes, en masquer certaines et choisir la colonne par défaut dans **Gestion budgétaire > Administration > Colonnes budgétaires** (voir [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires)). Une colonne masquée garde ses montants.

**Période d'une colonne** :

- Chaque colonne a une période à l'intérieur de l'année, par exemple d'avril à décembre
- Un mois compte lorsque la période couvre son 15. Une période qui commence le 10 avril inclut avril ; une période qui commence le 20 avril débute en mai
- Une colonne sans montant ni période reçoit une suggestion : le **Début d'effet** et la **Fin de validité** du poste, limités à l'année. Un investissement qui commence le 1er avril suggère d'avril à décembre
- Une colonne qui porte déjà des montants sans période est lue comme couvrant toute l'année : les données existantes se comportent comme avant

**Annuel ou Mensuel** :

- **Annuel** : Saisissez un total par colonne. Le total est réparti uniformément sur les mois de la période de la colonne, et les mois hors de cette période sont mis à zéro. La période s'affiche sous chaque total avant la saisie, par exemple « 9 mois, avril à décembre ». Seul le total que vous modifiez est enregistré. Les autres colonnes gardent leurs montants mensuels.
- Cliquez sur l'icône crayon à côté de la période sous un total (**Modifier la période**) pour ouvrir le panneau de répartition sur cette colonne, avec son total actuel. Si les dates du poste ne laissent aucun mois dans l'année, le total est désactivé et indique « Aucun mois de 2026 n'est compris dans les dates du poste. » Cliquez sur l'icône crayon à côté (**Choisir la période**) pour la définir vous-même.
- Cliquez sur l'icône calculatrice à côté du crayon (**Quantité et prix**) pour ouvrir le même encadré sur les lignes de cette colonne. Voir [Quantité et prix](#quantite-et-prix).
- **Mensuel** : Saisissez les montants par mois (Jan à Déc) pour chaque colonne affichée, pour un suivi fin des dépenses projet. Des sous-totaux par trimestre et un total annuel sont affichés. Seuls les mois que vous modifiez sont enregistrés.
- Les deux onglets montrent les mêmes colonnes : Prévision apparaît aussi dans **Annuel** quand elle est affichée.
- Passez d'un mode à l'autre avec les onglets **Annuel** et **Mensuel**
- Changer de mode ne modifie pas vos montants : seul l'affichage change. Annuel montre le total annuel des mois enregistrés, Mensuel montre les mois enregistrés.
- Votre choix entre **Annuel** et **Mensuel** est conservé dans votre navigateur, pour vous seul : changer de mode ne modifie pas ce que voient les autres utilisateurs qui ouvrent ce poste. Tant que vous n'avez pas choisi, une colonne s'ouvre dans le mode utilisé pour la dernière saisie de ses montants.

**Comportement du gel** :

- Si le budget d'une année est gelé (via l'Administration budgétaire), les champs passent en lecture seule et affichent un cadenas
- Chaque colonne peut être gelée indépendamment
- Vous pouvez toujours consulter les données gelées ; les administrateurs peuvent dégeler via **Gestion budgétaire > Administration > Geler / Dégeler les données**

**Répartir un montant** :

- L'encadré du panneau a deux onglets : **Répartir un montant** et **Quantité et prix**. Cette partie couvre le premier
- Le panneau de répartition est toujours visible dans l'onglet **Mensuel**. Dans l'onglet **Annuel**, il s'ouvre depuis l'icône crayon sous un total, et son bouton de fermeture le ferme
- Choisissez une **Colonne** parmi les colonnes affichées, vérifiez le **Montant**, choisissez une **Répartition** (**Linéaire** ou **4-4-5**), puis définissez les dates **Du** et **Au**. Les dates partent de la période actuelle de la colonne, et la répartition de celle de la colonne
- Le panneau s'ouvre sur la colonne par défaut. Le montant reprend le total actuel de la colonne, dans les deux onglets, et suit lorsque vous choisissez une autre colonne. Il reste vide lorsque la colonne n'a aucun montant
- **Chaque modification s'enregistre aussitôt** : le montant quand vous quittez le champ ou appuyez sur Entrée, la répartition et les dates dès que vous les modifiez. Il n'y a aucun bouton à cliquer. Un montant vide ou nul n'enregistre rien
- **Appliquer la répartition à toutes les colonnes** est un interrupteur, activé par défaut : chaque colonne qui le suit reçoit la même répartition et la même période, et chacune garde son propre total actuel. L'activer répartit aussitôt ces colonnes, et il reste activé pour vos modifications suivantes. Le désactiver ne change rien en soi : les modifications suivantes s'appliquent à la seule colonne choisie. Par défaut, toutes les colonnes le suivent. Un administrateur budgétaire choisit lesquelles dans [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires). Les colonnes gelées ne changent jamais. Survolez l'interrupteur pour voir les colonnes qui suivent et celles qui gardent leur propre période
- Une colonne qui ne suit pas l'interrupteur est répartie seule : l'interrupteur n'apparaît pas quand vous la répartissez. L'interrupteur est aussi masqué quand aucune autre colonne qui suit ne peut changer
- Pour remettre une colonne en répartition linéaire sur douze mois, choisissez **Linéaire** et réglez les dates sur le 1er janvier et le 31 décembre
- Les totaux saisis dans l'onglet **Annuel** s'appliquent toujours à leur seule colonne
- Les dates **Du** et **Au** affichent la période. Quand des mois tombent en dehors, le panneau indique lesquels seront mis à zéro (« Janvier à mars seront mis à zéro. »). Une période sur l'année entière n'affiche aucune ligne. Survolez l'icône d'information à côté du titre du panneau pour voir la règle du 15
- Avec **4-4-5**, les poids des mois qui comptent sont augmentés pour que tout le montant se répartisse sur eux
- Un avertissement non bloquant apparaît lorsque la période dépasse les dates du poste. La répartition est tout de même enregistrée
- Tant qu'une date manque ou qu'aucun mois ne compte, le panneau en indique la raison et n'enregistre rien
- Une répartition sur une colonne construite à partir de lignes garde ses lignes. Voir [Quantité et prix](#quantite-et-prix)

**Origine de chaque colonne** :

- Un court libellé indique d'où viennent les montants d'une colonne. Dans l'onglet **Mensuel**, il se trouve sous l'en-tête de colonne (survolez-le pour voir la période). Dans l'onglet **Annuel**, il se trouve à côté de la période
- **Répartition linéaire**, **Répartition 4-4-5** ou **Répartition par trimestre** : les montants proviennent d'une répartition
- **Copié depuis Budget 2025 +2 %** : les montants proviennent de **Copier les colonnes budgétaires** dans l'Administration budgétaire, avec le pourcentage affiché lorsqu'il y en a un
- **Quantité et prix · 3 lignes · 1.00 ETP** : les montants proviennent de lignes, avec leur nombre et, lorsque les lignes comptent des personnes ou des jours, l'ETP de la colonne. Cet ETP est la moyenne sur l'année. Survolez le libellé pour voir les lignes, par exemple « Chef de projet : 1 personne × 1 200 par jour, 5 jours par mois, févr. à juil. »
- **Modifié à la main** : un mois a été modifié dans la grille ou par un import de fichier budgétaire
- Une colonne sans libellé a conservé les données qu'elle avait avant l'arrivée des périodes

**Lorsqu'une autre personne modifie la même colonne** :

- Deux personnes peuvent remplir des mois ou des colonnes différents du même poste en même temps, sans conflit
- En saisie mensuelle, si une autre personne a modifié l'un des mêmes mois, ces mois attendent votre choix ; les autres mois de la colonne s'enregistrent comme vous les avez saisis
- Si une autre personne a modifié le total de la colonne, sa répartition ou ses lignes Quantité et prix pendant que vous y travailliez, toute la colonne attend : un bandeau propose **Recharger la colonne** ou **Écraser**. Les montants, le panneau de répartition et les lignes de la colonne restent en lecture seule jusqu'à votre choix
- Enregistrer recharge l'année : vous voyez toujours les derniers chiffres de chaque autre colonne ; la cellule ou la colonne que vous modifiez n'est pas perturbée

**Outils du mode mensuel** (mode Mensuel uniquement) :

- **Effacer la colonne** : l'icône à côté d'un en-tête de colonne remet à zéro tous les mois de cette colonne. Lorsque la colonne contient des montants, vous confirmez d'abord
- Utile pour saisir un échéancier de décaissement à la main, par exemple tout le montant sur un seul mois
- Effacer de cette façon compte comme une modification à la main. Pour retirer à la fois les montants et la période d'une colonne pour tous les investissements, utilisez **Réinitialiser une colonne budgétaire** dans l'Administration budgétaire

**Tendance pluriannuelle** :

- Un graphique sous le tableau montre chaque colonne affichée sur plusieurs années, Prévision comprise quand elle est affichée, et se met à jour pendant la saisie

**Comment l'utiliser** :

1. Sélectionnez l'année pour laquelle vous planifiez
2. Choisissez l'onglet **Annuel** ou **Mensuel**
3. Remplissez les colonnes pertinentes (Budget pour la planification initiale, Réalisé pour le suivi, Atterrissage prévu pour le chiffre de fin d'année)
4. Vos modifications s'enregistrent automatiquement ; l'indication **Enregistrement...** / **Enregistré** apparaît à côté des onglets d'année

**Conseil** : Pour la plupart des postes, le mode Annuel est plus rapide. Utilisez le mode Mensuel lorsque vous devez suivre le calendrier des dépenses d'un projet ou un déploiement par phases.

#### Quantité et prix

Construisez une colonne à partir de lignes au lieu de saisir ses montants. Chaque ligne se lit comme une phrase : une quantité, une unité, un prix unitaire, une fréquence, une période, et un calendrier. Par exemple, un prestataire sur un projet de build à temps plein à 400 par jour de février à octobre, et 20 ordinateurs portables à 1 200 par pièce, achetés une fois le 15 mars. Les mois de la colonne sont la somme de ses lignes.

**Ouvrir l'onglet** :

- Onglet **Annuel** : cliquez sur l'icône calculatrice à côté de la période sous un total. L'encadré s'ouvre sur **Quantité et prix** pour cette colonne
- Onglet **Mensuel** : cliquez sur **Quantité et prix** en haut de l'encadré du panneau
- Choisissez la **Colonne** en haut de l'onglet. Les colonnes gelées ne peuvent pas être choisies

**Les lignes** :

| Colonne | Ce qu'il faut saisir |
|---|---|
| **Description** | Ce que la ligne paie, par exemple « Chef de projet ». Facultative, jusqu'à 200 caractères |
| **Quantité** | Combien, dans l'unité de la ligne. Zéro ou plus, jusqu'à 3 décimales |
| **Unité** | **personnes**, **jours** ou **pièces**. L'unité détermine ce que paie le prix, sa fréquence, la façon dont le montant se répartit sur les mois, et l'ETP |
| **Prix unitaire** | Le prix d'une unité, dans la devise du poste. Jusqu'à 4 décimales. Un prix négatif est accepté, pour un avoir. Ce que paie le prix s'affiche juste après : **par jour** pour les jours, **par pièce** pour les pièces, et pour les personnes une petite liste pour choisir **par jour** ou **par mois** |
| **Fréquence** | Elle suit l'unité. Personnes au prix par jour : une case **Temps plein** et, lorsqu'elle n'est pas cochée, les **jours par mois** qu'elles consacrent au poste (plus de 0, jusqu'à 31, avec jusqu'à 3 décimales). Personnes au prix par mois : « par mois ». Jours : « sur la période ». Pièces : une liste pour choisir **par mois** ou **une fois** |
| **Du** / **Au** | La période de la ligne, à l'intérieur de l'année. Un mois compte lorsque la période couvre son 15, comme pour une répartition. Les pièces achetées une fois prennent une seule **Date** à la place et tombent dans son mois. Lorsque toutes les lignes prennent une date, l'en-tête indique **Date** |
| **Calendrier** | Affiché pour un prix par jour uniquement : les personnes au prix par jour, et les jours. Le calendrier de jours ouvrés dont les jours comptent. La liste propose les calendriers activés, plus le calendrier qu'une ligne utilise déjà s'il a été désactivé depuis, marqué « (désactivé) ». Lorsqu'il n'existe encore aucun calendrier, l'onglet indique « Aucun calendrier de jours ouvrés pour l'instant. », avec un lien **Ajouter un calendrier** pour les personnes qui peuvent créer des calendriers. Voir [Calendriers de jours ouvrés](working-day-calendars.md) |
| **Montant** | Le total de la ligne, une fois enregistrée. En lecture seule |

Lorsque l'onglet est assez large, chaque ligne tient sur une rangée. Sur un écran plus étroit, ou avec le panneau **Propriétés** ouvert sur un écran 1080p, chaque ligne occupe deux rangées alignées, avec **Description**, **Quantité**, **Unité**, **Prix unitaire** et **Montant** sur la première, et **Fréquence**, **Du** et **Au** (ou **Date**) et **Calendrier** sur la seconde ; fermez le panneau **Propriétés** pour revenir à une rangée par ligne.

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

- Utilisez **personnes** pour du personnel qui travaille sur le poste mois après mois. Au prix par jour, indiquez combien il travaille : cochez **Temps plein** pour compter chaque jour ouvré du calendrier du début à la fin de la ligne, ou saisissez les jours par mois. Par exemple, un chef de projet 5 jours par mois à 1 200 par jour de février à juillet coûte 6 000 par mois. Sur un calendrier qui compte 21 jours ouvrés en mars, ce mois compte 5 ÷ 21, soit environ 0.24 ETP. Un consultant à temps plein à 400 par jour coûte chaque mois les jours ouvrés du mois × 400, et compte 1 ETP
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
- Sur une colonne gelée, les lignes sont en lecture seule

**Sous le tableau** :

- L'ETP des lignes, lorsqu'une ligne compte des personnes ou des jours, par exemple « ETP sur la période 0.24 · Moyenne sur l'année 0.12 ». Voir [ETP](#etp). Le total de la colonne s'affiche dans la colonne elle-même
- D'où viennent les montants, lorsqu'ils ne viennent plus des lignes : l'une des phrases de la partie suivante
- Des remarques lorsqu'elles s'appliquent : « La période dépasse les dates du poste. », un calendrier désactivé depuis, par exemple « Personnel du siège est désactivé. Les lignes l'utilisent encore. », et les jours ouvrés modifiés depuis le dernier enregistrement des lignes
- **Appliquer ces lignes à toutes les colonnes** : un interrupteur pour les mêmes colonnes que celui de l'onglet de répartition, désactivé par défaut ici. L'activer écrit aussitôt les lignes dans chaque colonne qui suit, et il reste activé : chaque enregistrement suivant écrit aussi les lignes dans ces colonnes. Le désactiver ne change rien en soi

**Lorsque les montants changent autrement** : les lignes restent sur la colonne comme référence, et l'onglet indique d'où viennent désormais les montants, suivi d'un lien **Utiliser à nouveau les lignes**. Le lien enregistre les lignes telles quelles et recalcule la colonne à partir d'elles.

- Un mois saisi dans l'onglet **Mensuel** : « Les montants ont été saisis à la main. Utiliser à nouveau les lignes. »
- Une répartition : « Les montants viennent d'une répartition. Utiliser à nouveau les lignes. »
- **Copier les colonnes budgétaires** dans l'Administration budgétaire : « Les montants ont été copiés depuis Budget 2025. Utiliser à nouveau les lignes. » La copie reporte les lignes de la colonne source avec les montants. Voir [Copier une colonne calculée](budget-operations.md#copier-une-colonne-calculee)
- Les jours ouvrés d'un calendrier ont changé : « Jours ouvrés modifiés depuis le dernier calcul : mars : 20 jours, maintenant 19. » Rien ne change sur la colonne tant que vous ne cliquez pas sur **Utiliser à nouveau les lignes**
- **Réinitialiser une colonne budgétaire** dans l'Administration budgétaire retire les lignes avec les montants. Voir [Réinitialiser une colonne budgétaire](budget-operations.md#reinitialiser-une-colonne-budgetaire)
- Un fichier budgétaire change les mois d'une colonne et laisse ses lignes. Voir [Charger un budget depuis un tableur](budget-file.md)

#### ETP

L'ETP (équivalent temps plein) indique pour combien de personnes une colonne paie. Il provient des lignes : chaque mois additionne l'ETP de ses lignes (voir le tableau ci-dessus). Deux chiffres en découlent, chacun arrondi à 2 décimales :

- **Moyenne sur l'année** : la somme des douze mois divisée par 12. C'est l'ETP de la colonne, affiché dans le libellé de la colonne et dans les colonnes ETP de la liste CAPEX
- **ETP sur la période** : la somme des mois qui comptent des personnes ou des jours, divisée par le nombre de ces mois. Les pièces ne comptent pas, si bien que des licences ou un ordinateur portable ne le font jamais baisser. Il s'affiche sous les lignes tant que les montants en viennent. Après une modification à la main, une répartition ou une copie, il n'est plus affiché jusqu'à ce que vous utilisiez à nouveau les lignes

Par exemple, un consultant à temps plein de février à octobre compte 1 ETP dans chacun de ces 9 mois : 1.00 sur la période, et 9 × 1 ÷ 12 = 0.75 sur l'année. Un chef de projet 5 jours par mois de février à juillet compte environ 0.24 sur la période, et 0.12 sur l'année. Des licences sur toute l'année ou un ordinateur portable en décembre sur la même colonne ne changent aucun des deux chiffres.

- **Compté** : une colonne avec des lignes en personnes ou en jours
- **Zéro** : une colonne dont toutes les lignes sont en pièces. Son ETP vaut 0
- **Vide** : une colonne sans ligne, un poste sans version pour cette année, ou une année postérieure à la fin de validité du poste. Sa cellule ETP reste vide, car KANAP ne peut pas savoir pour combien de personnes il paie
- L'ETP reste avec les lignes. Après une modification à la main, une répartition ou une copie, la colonne garde l'ETP de ses lignes. Une copie reporte l'ETP de la colonne source

---

### Ventilations

L'onglet Ventilations répartit la dépense d'investissement entre vos sociétés et départements. Cela alimente les rapports de refacturation et aide à ventiler les coûts d'actifs.

**Sélection d'année** :

- Fonctionne comme le Budget : utilisez les onglets d'année pour basculer entre A-2, A-1, A, A+1, A+2
- Chaque année peut avoir une méthode de ventilation différente
- Le total de l'année de la colonne par défaut s'affiche à droite, par exemple **Budget, total de l'année**

**Méthodes de ventilation** :

1. **Effectif (par défaut)** : Répartit la dépense d'investissement proportionnellement à l'effectif de chaque société pour l'année sélectionnée. Les pourcentages se mettent à jour automatiquement lorsque vous modifiez les métriques des sociétés. C'est la méthode standard.

2. **Utilisateurs IT** : Répartit la dépense proportionnellement au nombre d'utilisateurs IT de chaque société pour l'année sélectionnée. Utile pour les investissements d'infrastructure IT qui évoluent avec le personnel IT.

3. **Chiffre d'affaires** : Répartit la dépense proportionnellement au chiffre d'affaires de chaque société pour l'année sélectionnée. Utile pour les plateformes ou infrastructures à l'échelle de l'entreprise.

4. **Manuel par société** : Vous sélectionnez les sociétés qui bénéficient de cet investissement. Choisissez un inducteur dans **Ventiler par** (Effectif, Utilisateurs IT ou Chiffre d'affaires) pour calculer les pourcentages entre les sociétés sélectionnées. Seules les sociétés sélectionnées entrent dans la répartition.

5. **Manuel par département** : Vous sélectionnez des paires société/département. Les pourcentages sont calculés à partir de l'effectif de chaque département. Utile lorsqu'un investissement ne bénéficie qu'à certains départements (ex. : équipement de production).

6. **Pourcentages manuels** : Vous choisissez les sociétés et saisissez vous-même chaque pourcentage. Le total doit faire 100 %.

**Méthodes par défaut et méthodes épinglées** :

- L'option **par défaut**, affichée comme *Effectif (par défaut)* tant que votre organisation n'a pas configuré une autre méthode, suit le réglage défini dans **Gestion budgétaire > Administration > Méthode de ventilation par défaut**. Chaque investissement laissé sur la valeur par défaut est recalculé lorsqu'un administrateur modifie ce réglage.
- Ce réglage peut également restreindre la valeur par défaut à une **sélection de sociétés** (par exemple l'entité qui porte le budget IT) : l'inducteur ne s'applique alors qu'à ces sociétés, et l'option affiche *Par défaut (n sociétés)*.
- **Effectif**, **Utilisateurs IT** et **Chiffre d'affaires** épinglent cette méthode sur l'investissement : une méthode épinglée continue de fonctionner même si la valeur par défaut de l'organisation change par la suite.
- Les investissements dotés d'une ventilation manuelle ne sont jamais affectés par le réglage par défaut.

**Comment fonctionnent les pourcentages** :

- Pour les **méthodes automatiques** (Effectif, Utilisateurs IT, Chiffre d'affaires) : les pourcentages sont calculés depuis les dernières métriques de vos sociétés actives. Vous ne les modifiez pas directement.
- Pour **Manuel par société** et **Manuel par département** : vous choisissez les sociétés ou départements, et le système calcule les pourcentages selon l'inducteur choisi et les métriques actuelles.
- Pour **Pourcentages manuels** : saisir un pourcentage fixe cette ligne, et les autres lignes se partagent le reste. **Répartir équitablement** donne la même part à chaque ligne ; **Réinitialiser les valeurs fixées** libère les lignes fixées.
- Les pourcentages reflètent les données en temps réel. Si vous mettez à jour l'effectif d'une société, les ventilations se recalculent.

**Consulter les ventilations** :

- Le tableau affiche la société (ou société / département), la valeur de l'inducteur, le pourcentage et le montant, avec une ligne de total
- Le pourcentage total doit être égal à 100 % ; pour les Pourcentages manuels, un avertissement s'affiche tant que ce n'est pas le cas

**Comment l'utiliser** :

1. Sélectionnez l'année
2. Choisissez une méthode de ventilation dans **Méthode**
3. Pour une méthode manuelle, utilisez **Ajouter une ligne** pour ajouter des sociétés (ou des paires société/département) et l'icône de retrait pour enlever celles qui ne bénéficient pas de cet investissement
4. Les modifications s'enregistrent automatiquement

**Problèmes courants** :

- **Métriques manquantes** : Une ou plusieurs sociétés ont un effectif, un nombre d'utilisateurs IT ou un chiffre d'affaires nul ou manquant pour l'année sélectionnée. Renseignez les métriques dans **Données de référence > Sociétés** (onglet Détails).
- **« Les pourcentages manuels doivent totaliser 100 %. »** : Ajustez les lignes, ou cliquez sur **Répartir équitablement**.

**Lorsqu'une autre personne modifie la ventilation** :

- La méthode, l'inducteur et les lignes s'enregistrent ensemble. Si une autre personne a modifié la ventilation pendant que vous la modifiiez, un bandeau propose **Recharger la ventilation** ou **Écraser**
- Changer d'année alors qu'un choix est en attente demande d'abord confirmation

**Conseil** : Utilisez Effectif pour la plupart des postes (c'est le plus simple et il se met à jour automatiquement). Réservez Manuel par société aux investissements qui ne bénéficient qu'à des entités précises (ex. : un datacenter régional). Utilisez Manuel par département pour les investissements très ciblés.

---

### Relations

L'onglet Relations lie ce poste CAPEX aux objets associés : Projets, Applications, Contrats, Contacts, Sites web pertinents et Pièces jointes. Tout ce qui se trouve dans cet onglet s'enregistre automatiquement.

**Projets** :

- Utilisez l'autocomplétion pour lier un ou plusieurs projets
- Cela aide à regrouper les dépenses d'investissement par projet dans les rapports et permet la comptabilité projet
- Les noms des projets apparaissent dans la colonne **Projet** de la liste CAPEX, et la recherche rapide les trouve
- Retirez un projet en cliquant sur le X de sa puce

**Applications** :

- Utilisez l'autocomplétion pour lier une ou plusieurs applications ou services de votre catalogue IT
- Cela aide à savoir quels postes CAPEX financent quelles applications ou quels services
- Retirez une application en cliquant sur le X de sa puce

**Contrats** :

- Utilisez l'autocomplétion pour lier un ou plusieurs contrats
- Une fois lié, le nom du contrat apparaît dans la colonne **Contrat** de la liste CAPEX pour référence rapide
- Un contrat peut aussi être lié à plusieurs postes CAPEX (relation plusieurs-à-plusieurs)
- Retirez un contrat en cliquant sur le X de sa puce

**Contacts** :

- Liez des contacts à ce poste CAPEX : choisissez un contact, puis son rôle (**Commercial**, **Technique**, **Support** ou **Autre**). Le choix du rôle ajoute le contact
- Le tableau affiche le rôle, le prénom, le nom, la fonction, l'e-mail et le mobile. Survolez le rôle pour savoir si le contact vient du fournisseur ou a été ajouté manuellement
- Retirez un contact avec l'icône de retrait

**Sites web pertinents** :

- Cliquez sur **Ajouter une URL** pour ajouter un lien (ex. : pages produit du fournisseur, documentation technique, wikis internes). Chaque lien a un **Nom** et une **URL**
- Cliquez sur la ligne d'un lien pour le modifier, ou utilisez l'icône de suppression pour le retirer

**Pièces jointes** :

- Téléversez des fichiers liés à ce poste (ex. : devis, propositions fournisseur, spécifications techniques, notes d'approbation)
- Glissez-déposez des fichiers dans la zone de pièces jointes, ou cliquez sur **Sélectionner des fichiers** pour parcourir
- Cliquez sur la puce d'un fichier pour le télécharger
- Supprimez une pièce jointe avec l'icône de suppression de sa puce (après confirmation ; nécessite l'autorisation `capex:manager`)

**Pourquoi lier ?** :

- **Projets** : Consolider les dépenses d'investissement par projet pour la comptabilité et le reporting projet
- **Applications** : Voir quelles applications ou quels services un investissement finance
- **Contrats** : Savoir quels postes d'investissement sont couverts par des contrats d'achat ou de service
- **Contacts** : Garder les coordonnées des fournisseurs et parties prenantes associées à l'investissement
- **Sites web pertinents et pièces jointes** : Centraliser toute la documentation et les références de l'investissement pour y accéder facilement

**Conseil** : Téléversez les devis fournisseur, notes d'approbation et spécifications techniques en pièces jointes. Liez les contrats pour suivre les achats. Utilisez les contacts pour associer les interlocuteurs fournisseurs à chaque poste d'investissement.

---

## Import/export CSV

**Exporter CSV** et **Importer CSV** se trouvent dans la barre d'outils de la liste CAPEX. Les deux demandent des droits d'administration sur CAPEX (`capex:admin`).

**Exporter CSV** écrit le fichier budgétaire CAPEX pour les postes affichés par la liste. **Importer CSV** relit un fichier : il est d'abord vérifié, et rien n'est écrit avant que vous cliquiez sur **Charger**.

Le fichier contient une ligne par poste, les détails du poste, ses montants en colonnes et `kanap_token`. [Charger un budget depuis un tableur](budget-file.md) décrit les colonnes, ce que signifie une cellule et les deux étapes de l'import.

## Statut et cycle de vie

Chaque poste CAPEX a un **statut** (Activé ou Désactivé) et une **Fin de validité** optionnelle qui détermine quand il apparaît dans les rapports et les listes de sélection. C'est la seule date de fin d'un poste.

**Fonctionnement** :

- **Activé** : Le poste est actif et apparaît partout (listes, rapports, ventilations)
- **Fin de validité** : La date à laquelle le poste s'arrête. Laissez-la vide s'il n'y a pas de fin. Une fois la fin de validité passée, le statut passe à **Désactivé** de lui-même dans l'heure
- Après la fin de validité :
  - Le poste n'apparaît plus dans les listes de sélection pour de nouveaux contrats ou ventilations
  - Il est exclu des rapports pour les années strictement postérieures à la fin de validité
  - Les données historiques restent intactes ; le poste apparaît toujours dans les rapports couvrant les années où il était actif

**Définir le statut** :

- À la création du poste, vous pouvez définir sa **Fin de validité** dans le panneau **Propriétés**
- Ensuite, modifiez le **Statut** dans la barre de métadonnées, ou utilisez le champ **Cycle de vie** du panneau **Propriétés** (interrupteur de statut et **Fin de validité**). Désactiver un poste sans date fixe sa fin de validité à aujourd'hui
- Vous pouvez programmer une fin de validité future (utile pour les cessions d'actifs planifiées ou les dates de fin de vie)

**Afficher les postes désactivés** :

- Par défaut, la liste CAPEX n'affiche que les postes **Activés**
- Utilisez la bascule **Afficher : Tous / Activés / Désactivés** pour changer le périmètre

**Désactiver ou supprimer** :

- **Privilégiez la désactivation** : Elle préserve l'historique, garantit la cohérence des rapports et conserve la piste d'audit
- **Supprimez uniquement si** : Le poste a été créé par erreur
- Un poste qui a des montants dans une colonne gelée ne peut pas être supprimé. Dégelez d'abord la colonne, ou fixez plutôt une date de fin de validité. Lorsque vous supprimez plusieurs postes à la fois, les autres sont supprimés, et le message nomme chaque poste refusé avec sa raison
- Supprimer un poste supprime aussi ses budgets, ventilations, tâches, sites web pertinents, pièces jointes (avec leurs fichiers) et ses liens vers des contrats. Si l'une de ses tâches a été transformée en demande, la demande est conservée : elle possède sa propre copie du titre, de la description et des pièces jointes, et seul son lien vers la tâche disparaît

**Conseil** : Utilisez la Fin de validité pour marquer les actifs entièrement amortis ou cédés, ou les projets terminés. Ne supprimez qu'en cas de véritable erreur.

---

## Autorisations

L'accès CAPEX est contrôlé par trois niveaux :

- `capex:reader` : Consulter la liste CAPEX, ouvrir les postes, voir les budgets et ventilations (lecture seule)
- `capex:manager` : Créer et modifier les postes CAPEX, mettre à jour les budgets et ventilations, téléverser les pièces jointes, gérer les liens et contacts
- `capex:admin` : Tous les droits manager plus import CSV, opérations budgétaires (gel, copie, réinitialisation) et suppression en masse

De plus :

- Les tâches ont des autorisations séparées (`tasks:member` pour créer/modifier des tâches sur les postes CAPEX)
- Les utilisateurs avec `tasks:reader` peuvent consulter les tâches mais ne peuvent pas les créer ou les modifier

Si vous ne pouvez pas effectuer une action (ex. : le bouton **Import CSV** est absent), demandez à l'administrateur de votre espace de travail de revoir les autorisations de votre rôle.

---

## Conseils

- **Commencez simple** : Créez les postes avec juste l'essentiel (description, type d'immobilisation, type d'investissement, société payeuse, compte), puis ajoutez les budgets et ventilations au fur et à mesure.
- **Utilisez la ventilation par effectif** : Pour la plupart des investissements, Effectif suffit. Réservez les ventilations manuelles aux investissements qui ne bénéficient qu'à des sociétés ou départements spécifiques.
- **Liez les contrats** : Si vous gérez les achats d'investissement via des contrats, liez-les dans l'onglet Relations pour suivre les achats.
- **Téléversez la documentation** : Utilisez les pièces jointes pour stocker les devis fournisseur, notes d'approbation et spécifications techniques avec le poste.
- **Classifiez avec précision** : Utilisez le Type d'investissement et la Priorité de manière cohérente pour permettre une analyse et une priorisation pertinentes des dépenses d'investissement.
- **Maintenez les métriques des sociétés à jour** : Les ventilations dépendent de l'effectif, des utilisateurs IT et du chiffre d'affaires des sociétés. Des métriques obsolètes causent des erreurs de ventilation.
- **Utilisez le CSV pour la configuration en masse** : Si vous migrez depuis un autre système ou avez de nombreux postes d'investissement, commencez par l'import CSV. Exportez un fichier récent, remplissez vos lignes et vérifiez-le avant de charger.
- **Désactivez, ne supprimez pas** : Préservez l'historique en désactivant les postes lorsque les actifs sont cédés ou les projets terminés.
- **Vérifiez la ligne de totaux** : Avant de finaliser les budgets d'investissement, vérifiez la ligne de totaux épinglée pour vous assurer que vos dépenses s'additionnent comme prévu.
- **Utilisez les liens profonds** : Cliquez directement sur une colonne de budget ou de ventilation dans la liste pour accéder directement à cet onglet et à cette année.
- **Suivez le calendrier des dépenses** : Pour les gros projets aux dépenses échelonnées, utilisez le mode Mensuel pour suivre les dépenses par rapport aux jalons du projet.
- **Gelez après la clôture de fin d'année** : Utilisez l'Administration budgétaire pour geler les budgets de l'année précédente une fois le réalisé finalisé, ce qui empêche les modifications accidentelles.
