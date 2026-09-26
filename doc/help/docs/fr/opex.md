# OPEX

Les postes OPEX (dépenses opérationnelles) sont vos coûts IT récurrents : licences logicielles, abonnements cloud, contrats de maintenance et services. C'est ici que vous planifiez les budgets, suivez le réalisé et répartissez les coûts à travers votre organisation.

L'espace de travail OPEX vous aide à gérer chaque poste de dépense de la budgétisation initiale jusqu'à l'exécution et le reporting -- le tout en un seul endroit avec des colonnes budgétaires annuelles, des méthodes de ventilation flexibles et des liens directs vers les fournisseurs, contrats, applications et projets.

## Premiers pas

Rendez-vous dans **Gestion budgétaire > OPEX** pour voir votre liste. Cliquez sur **Nouveau** pour créer votre premier poste.

L'espace de travail s'ouvre en mode création, avec le panneau **Propriétés** ouvert à droite. Saisissez le nom du produit dans le titre en haut, remplissez les propriétés, puis cliquez sur **Créer**.

**Champs obligatoires** :
  - **Nom du produit** (le titre) : Ce que vous dépensez (ex. : « Licences Salesforce », « Compute AWS »)
  - **Fournisseur** : À qui vous payez. Lié à vos données de référence Fournisseurs
  - **Société payeuse** : Quelle société paie le fournisseur (obligatoire pour la comptabilité)
  - **Compte** : Le compte du grand livre pour cette dépense. Seuls les comptes du plan comptable de la société payeuse apparaissent
  - **Devise** : Code ISO (ex. : USD, EUR). Par défaut la devise de votre espace de travail ; modifiable par poste
  - **Début d'effet** : Quand cette dépense commence (JJ/MM/AAAA)

**Optionnel mais utile** :
  - **Catégorie analytique** : Regroupement personnalisé pour le reporting (ex. : « Infrastructure », « Apps métier »). De nouvelles catégories peuvent être créées à la volée
  - **Fin de validité** : La date à laquelle cette dépense s'arrête. Laissez-la vide s'il n'y a pas de fin. Après cette date, le poste est désactivé et les années suivantes ne comptent plus dans les vues budgétaires
  - **Responsable IT** / **Responsable métier** : Qui est en charge
  - **Description** et **Notes** : Texte libre dans l'onglet Vue d'ensemble

Une fois le poste créé, l'espace de travail déverrouille les quatre onglets : **Vue d'ensemble**, **Budget**, **Ventilations** et **Relations**.

**Conseil** : Vous pouvez créer des postes rapidement et remplir les budgets et ventilations plus tard. Commencez par l'essentiel et itérez.

---

## Travailler avec la liste OPEX

La liste OPEX (dans **Gestion budgétaire > OPEX**) est votre vue principale pour parcourir, filtrer et naviguer dans les postes de dépenses.

**Colonnes par défaut** :
  - **Nom du produit** : Le nom du poste (ouvre l'onglet Vue d'ensemble)
  - **Fournisseur** : Le nom du fournisseur
  - **Société payeuse** : Quelle société paie ce poste
  - **Contrat** : Le nom du dernier contrat lié (ouvre l'espace de travail du Contrat)
  - **Compte** : Le numéro et nom du compte comptable
  - **Ventilation** : Le libellé de la méthode de ventilation pour l'année en cours (ouvre l'onglet Ventilations)
  - **Budget A** : Montant du budget de l'année en cours (ouvre l'onglet Budget pour cette année)
  - **Atterrissage prévu A** : Montant de l'atterrissage prévu de l'année en cours (ouvre l'onglet Budget pour cette année)
  - **Tâche** : Le titre de la dernière tâche (ouvre l'onglet Vue d'ensemble, où se trouve le panneau des tâches)

**Colonnes supplémentaires** (masquées par défaut, activez via le sélecteur de colonnes) :
  - **Budget A-1 / Atterrissage prévu A-1** : Chiffres de l'année précédente
  - **Révision A / Réalisé A** : Montants de révision et de réalisé de l'année en cours
  - **Budget A+1 / Révision A+1** : Chiffres de l'année suivante
  - **Budget A+2** : Budget à deux ans
  - **Activé** : Statut du poste (activé ou désactivé)
  - **Description** : Description du poste
  - **Devise** : Code devise ISO
  - **Début effectif** : Date de début
  - **Fin de validité** : Date à laquelle le poste s'arrête (vide signifie sans fin)
  - **Responsable IT / Responsable métier** : Utilisateurs responsables
  - **Analytique** : Nom de la catégorie analytique
  - **ID Projet** : Identifiant du projet lié
  - **Notes** : Notes internes
  - **Créé / Mis à jour** : Horodatages

**Filtrage** :
  - **Recherche rapide** : Recherche dans nom du produit, fournisseur, description et autres champs texte. Filtre la liste en temps réel
  - **Filtres de colonnes** : Cliquez sur l'icône de filtre dans n'importe quel en-tête de colonne. **Société payeuse**, **Compte**, **Ventilation**, **Devise**, **Responsable IT**, **Responsable métier** et **Analytique** utilisent des filtres par jeu de cases à cocher (multi-sélection). Les autres colonnes utilisent des filtres texte ou numériques
  - **Périmètre par statut** : Utilisez la bascule **Afficher : Activé / Désactivé / Tous** au-dessus de la grille (par défaut **Activé**)

**Tri** :
  - Cliquez sur un en-tête de colonne pour trier croissant/décroissant
  - Le tri par défaut est par **Budget A** décroissant
  - La liste mémorise votre dernier tri, recherche et filtres quand vous revenez

**Ligne de totaux** :
  - La ligne épinglée en bas affiche les totaux pour toutes les colonnes budgétaires
  - Les totaux respectent vos filtres et recherche actuels

**Liens profonds** :
  - Cliquer sur n'importe quelle cellule ouvre l'espace de travail sur l'onglet le plus pertinent :
    - **Nom du produit**, **Fournisseur**, **Société payeuse**, **Compte** et autres colonnes générales : Ouvre l'onglet **Vue d'ensemble**
    - **Colonnes budgétaires** (Budget A, Atterrissage prévu A, Budget A-1, etc.) : Ouvre l'onglet **Budget** pré-positionné sur cette année
    - **Ventilation** : Ouvre l'onglet **Ventilations** pour l'année en cours
    - **Tâche** : Ouvre l'onglet **Vue d'ensemble**, où se trouve le panneau des tâches
    - **Contrat** : Ouvre directement l'espace de travail du Contrat lié (pas l'espace de travail OPEX)

**Actions** :
  - **Nouveau** : Créer un nouveau poste OPEX (nécessite `opex:manager`)
  - **Import CSV** : Charger en masse depuis un CSV (nécessite `opex:admin`)
  - **Export CSV** : Exporter en CSV (nécessite `opex:admin`)
  - **Supprimer la sélection** : Suppression en masse des postes sélectionnés (nécessite `opex:admin` ; sélectionnez via les cases à cocher)

**Navigation Préc./Suiv.** :
  - Lorsque vous ouvrez un poste, l'espace de travail affiche les boutons **Préc.** et **Suiv.**
  - Ceux-ci naviguent dans la liste selon le tri actuel, respectant les filtres et la recherche
  - Passer à un autre poste enregistre d'abord vos modifications en attente
  - Votre contexte de liste (tri, filtres, recherche) est préservé lorsque vous fermez l'espace de travail

**Conseil** : Utilisez les filtres de colonnes + la recherche rapide pour construire des vues focalisées (ex. : « Toutes les dépenses cloud de plus de 10k »), puis naviguez poste par poste avec Préc./Suiv. pour revoir les budgets.

---

## L'espace de travail OPEX

Cliquez sur n'importe quelle ligne de la liste pour ouvrir l'espace de travail. Il comporte quatre parties :

  - **En-tête** : la référence du poste (ex. : `OPX-12`) avec un bouton de copie, le nom du produit (cliquez dessus pour renommer le poste), **Préc.** / **Suiv.**, **Envoyer le lien** et le bouton de fermeture
  - **Barre de métadonnées** sous le titre : **Statut**, **Responsable IT** et **Responsable métier**, modifiables sur place
  - **Quatre onglets** : **Vue d'ensemble**, **Budget**, **Ventilations** et **Relations** (l'onglet Relations indique le nombre de liens du poste)
  - **Panneau Propriétés** à droite : les champs principaux du poste. Ouvrez-le ou fermez-le avec le bouton des propriétés ; l'espace de travail mémorise votre choix

**Enregistrement automatique** :
  - Chaque modification s'enregistre automatiquement. L'indication **Enregistrement...** / **Enregistré** apparaît dans l'en-tête
  - Changer d'onglet, passer au poste précédent ou suivant, ou fermer l'espace de travail enregistre d'abord les modifications en attente. Si un enregistrement échoue, vous restez sur place et un message en donne la raison : aucune modification n'est perdue sans que vous le sachiez
  - **Ctrl+S** (**Cmd+S** sur Mac) enregistre immédiatement

### Vue d'ensemble

L'onglet Vue d'ensemble contient les champs de texte libre et les tâches du poste.

**Ce que vous pouvez modifier** :
  - **Description** : Ce que couvre la dépense
  - **Notes** : Notes internes libres

**Panneau des tâches** :
  - Liste toutes les tâches liées à ce poste OPEX, avec les colonnes **Titre**, **Statut**, **Priorité**, **Échéance** et **Actions**. Le titre du panneau indique le nombre de tâches
  - Filtre **Statut** : Tous (par défaut), Actifs (non terminés), Ouvert, En cours, En attente, En test, Terminé ou Annulé. Le bouton de réinitialisation l'efface
  - Cliquez sur **Ajouter une tâche** pour ouvrir une nouvelle tâche déjà liée à ce poste. Remplissez le titre, la description, la priorité, le responsable et l'échéance dans l'espace de travail de la tâche
  - Utilisez l'icône d'ouverture pour aller sur une tâche, et l'icône de suppression pour la supprimer (après confirmation)
  - Les tâches ont leurs propres autorisations (`tasks:member` pour créer et modifier). L'accès manager OPEX ne donne pas à lui seul le droit de modifier les tâches ; vérifiez avec votre admin si vous ne pouvez pas créer de tâches
  - Les tâches peuvent aussi être consultées et gérées depuis **Portefeuille > Tâches**, qui affiche toutes les tâches de votre organisation

**Panneau Propriétés** :
  - **Fournisseur**, **Société payeuse**, **Compte** (filtré par le plan comptable de la société payeuse), **Devise** (seulement les devises autorisées dans votre espace de travail), **Catégorie analytique** et **Début d'effet**
  - **Cycle de vie** : l'interrupteur **Activé** et la date de **Fin de validité**. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie)
  - Dates **Créé** et **Mis à jour** (lecture seule)

**Conseil** : Lors de la création d'un poste, un avertissement « Compte obsolète » signifie que le compte sélectionné n'appartient pas au plan comptable de la société payeuse. Choisissez un autre compte pour résoudre l'avertissement.

---

### Budget

L'onglet Budget est l'endroit où vous saisissez les données financières par année. Il prend en charge plusieurs colonnes budgétaires et deux modes de saisie, présentés sous forme d'onglets : **Annuel** (totaux annuels) et **Mensuel** (ventilation mensuelle).

**Sélection d'année** :
  - Utilisez les onglets d'année en haut pour basculer entre A-2, A-1, A (année en cours), A+1 et A+2
  - Chaque année a sa propre version, son mode et ses montants
  - Changer d'année enregistre d'abord vos modifications en attente

**Colonnes budgétaires** :
  - **Budget** : Budget annuel initial approuvé en début d'année
  - **Révision** : Mise à jour budgétaire en cours d'année (ex. : après une re-prévision)
  - **Réalisé** : Dépense réelle attendue (votre meilleure estimation au fil de l'année)
  - **Atterrissage prévu** : Dépense réelle finale après la clôture de fin d'année

**Période d'une colonne** :
  - Budget, Révision, Prévision et Atterrissage prévu ont chacun une période à l'intérieur de l'année, par exemple d'avril à décembre
  - Un mois compte lorsque la période couvre son 15. Une période qui commence le 10 avril inclut avril ; une période qui commence le 20 avril débute en mai
  - Une colonne sans montant ni période reçoit une suggestion : le **Début d'effet** et la **Fin de validité** du poste, limités à l'année. Un poste qui commence le 1er avril suggère d'avril à décembre
  - Une colonne qui porte déjà des montants sans période est lue comme couvrant toute l'année : les données existantes se comportent comme avant
  - Le Réalisé couvre toujours toute l'année

**Annuel ou Mensuel** :
  - **Annuel** : Saisissez un total par colonne. Le total est réparti uniformément sur les mois de la période de la colonne, et les mois hors de cette période sont mis à zéro. La période s'affiche sous chaque total avant la saisie, par exemple « 9 mois, avril à décembre ». Seul le total que vous modifiez est enregistré. Les autres colonnes gardent leurs montants mensuels.
  - Cliquez sur **Modifier la période** sous un total pour ouvrir le panneau de répartition sur cette colonne, avec son total actuel. Si les dates du poste ne laissent aucun mois dans l'année, le total est désactivé et indique « Aucun mois de 2026 n'est compris dans les dates du poste. » Cliquez sur **Choisir la période** pour la définir vous-même.
  - **Mensuel** : Saisissez les montants par mois (Jan-Déc) pour chaque colonne, plus une colonne **Prévision** pour la planification complémentaire. Des sous-totaux par trimestre et un total annuel sont affichés. Seuls les mois que vous modifiez sont enregistrés.
  - Passez d'un mode à l'autre avec les onglets **Annuel** et **Mensuel**. Changer de mode ne modifie pas vos montants.

**Comportement du gel** :
  - Si les colonnes budgétaires d'une année sont gelées (via l'Administration budgétaire), les champs correspondants passent en lecture seule et affichent un cadenas
  - Vous pouvez toujours consulter les données gelées ; les administrateurs peuvent dégeler via **Gestion budgétaire > Administration > Geler/Dégeler**
  - Chaque colonne peut être gelée indépendamment (Budget, Révision, Prévision, Réalisé, Atterrissage prévu)

**Répartir un montant** :
  - Le panneau de répartition est toujours visible dans l'onglet **Mensuel**. Dans l'onglet **Annuel**, il s'ouvre depuis **Modifier la période**
  - Choisissez une colonne (Budget, Révision, Prévision, Atterrissage prévu ou Réalisé), saisissez un montant annuel, choisissez **Linéaire** ou **4-4-5**, puis définissez les dates **Du** et **Au**. Les dates partent de la période actuelle de la colonne
  - Avant d'appliquer, le panneau affiche les mois qui comptent (« 9 mois, avril à décembre ») et les mois qui seront mis à zéro (« Janvier à mars seront mis à zéro. »)
  - Avec **4-4-5**, les poids des mois qui comptent sont augmentés pour que tout le montant se répartisse sur eux
  - Un avertissement non bloquant apparaît lorsque la période dépasse les dates du poste. Vous pouvez tout de même appliquer
  - **Appliquer** reste désactivé tant qu'une date manque ou qu'aucun mois ne compte. Rien n'est enregistré avant que vous cliquiez sur **Appliquer**
  - Depuis l'onglet **Mensuel**, Appliquer remplit la grille. Depuis l'onglet **Annuel**, vous restez dans la vue Annuel
  - Pour le Réalisé, les dates servent uniquement à cette répartition. Le Réalisé ne conserve aucune période

**Origine de chaque colonne** :
  - Un court libellé indique d'où viennent les montants d'une colonne. Dans l'onglet **Mensuel**, il se trouve sous l'en-tête de colonne (survolez-le pour voir la période). Dans l'onglet **Annuel**, il se trouve à côté de la période
  - **Répartition linéaire**, **Répartition 4-4-5** ou **Répartition par trimestre** : les montants proviennent d'une répartition
  - **Copié depuis Budget 2025 +2 %** : les montants proviennent de **Copier les colonnes budgétaires** dans l'Administration budgétaire, avec le pourcentage affiché lorsqu'il y en a un
  - **Modifié à la main** : un mois a été modifié dans la grille ou par un import du fichier des lignes budgétaires
  - Une colonne sans libellé a conservé les données qu'elle avait avant l'arrivée des périodes

**Outils du mode mensuel** :
  - **Effacer la colonne** : l'icône à côté d'un en-tête de colonne remet à zéro tous les mois de cette colonne, par exemple avant de saisir tout le montant sur un seul mois. Cela compte comme une modification à la main. Pour retirer à la fois les montants et la période d'une colonne pour tous les postes, utilisez **Réinitialiser une colonne budgétaire** dans l'Administration budgétaire

**Tendance pluriannuelle** :
  - Un graphique sous la grille montre les colonnes budgétaires du poste sur plusieurs années et se met à jour pendant la saisie

**Comment l'utiliser** :
  1. Sélectionnez l'année pour laquelle vous planifiez
  2. Choisissez l'onglet **Annuel** ou **Mensuel**
  3. Remplissez les colonnes pertinentes (Budget pour la planification initiale, Réalisé pour le suivi, Atterrissage prévu pour le chiffre de fin d'année)
  4. Vos modifications s'enregistrent automatiquement ; l'indication **Enregistrement...** / **Enregistré** apparaît à côté des onglets d'année

**Conseil** : Pour la plupart des postes, le mode Annuel est plus rapide. Utilisez le mode Mensuel lorsque la dépense varie significativement par mois (ex. : licences saisonnières, frais de mise en place ponctuels).

---

### Ventilations

L'onglet Ventilations répartit la dépense entre vos sociétés et départements. Cela alimente les rapports de refacturation et les KPI de coût par utilisateur.

**Sélection d'année** :
  - Fonctionne comme le Budget : utilisez les onglets d'année pour basculer entre A-2, A-1, A, A+1, A+2
  - Chaque année peut avoir une méthode de ventilation différente
  - Le **Budget de l'année** sélectionnée s'affiche à droite, et le tableau montre chaque part en pourcentage et en montant

**Méthodes de ventilation** :

| Méthode | Comment ça fonctionne |
|---|---|
| **Effectif (par défaut)** | Répartit la dépense proportionnellement à l'effectif de chaque société pour l'année sélectionnée. Aucune sélection manuelle requise -- les pourcentages sont calculés automatiquement depuis les métriques des sociétés. C'est la méthode standard. |
| **Utilisateurs IT** | Répartit la dépense proportionnellement au nombre d'utilisateurs IT de chaque société pour l'année sélectionnée. |
| **Chiffre d'affaires** | Répartit la dépense proportionnellement au chiffre d'affaires de chaque société pour l'année sélectionnée. |
| **Manuel par société** | Vous sélectionnez les sociétés qui reçoivent cette dépense et choisissez un inducteur dans **Ventiler par** (Effectif, Utilisateurs IT ou Chiffre d'affaires) pour calculer les pourcentages entre les sociétés sélectionnées uniquement. |
| **Manuel par département** | Vous sélectionnez des paires société/département. Les pourcentages sont calculés à partir de l'effectif de chaque département. Utile lorsqu'un poste ne bénéficie qu'à certains départements (ex. : un CRM utilisé par les ventes). |
| **Pourcentages manuels** | Vous choisissez les sociétés et saisissez vous-même chaque pourcentage. Le total doit faire 100 %. |

**Méthodes par défaut et méthodes épinglées** :
  - L'option **par défaut** -- affichée comme *Effectif (par défaut)* tant que votre organisation n'a pas configuré une autre méthode -- suit le réglage défini dans **Gestion budgétaire > Administration > Méthode de ventilation par défaut**. Chaque poste laissé sur la valeur par défaut est recalculé lorsqu'un administrateur modifie ce réglage
  - Ce réglage peut également restreindre la valeur par défaut à une **sélection de sociétés** (par exemple l'entité qui porte le budget IT) : l'inducteur ne s'applique alors qu'à ces sociétés, et l'option affiche *Par défaut (n sociétés)*
  - **Effectif**, **Utilisateurs IT** et **Chiffre d'affaires** épinglent cette méthode sur le poste : une méthode épinglée continue de fonctionner même si la valeur par défaut de l'organisation change par la suite
  - Les postes dotés d'une ventilation manuelle ne sont jamais affectés par le réglage par défaut

**Comment fonctionnent les pourcentages** :
  - Pour les **méthodes automatiques** (Effectif, Utilisateurs IT, Chiffre d'affaires) : les pourcentages sont calculés depuis les dernières métriques de vos sociétés actives. Vous ne les modifiez pas directement
  - Pour **Manuel par société** et **Manuel par département** : vous choisissez les sociétés ou départements, et le système calcule les pourcentages selon l'inducteur choisi et les métriques actuelles
  - Pour **Pourcentages manuels** : saisir un pourcentage fixe cette ligne, et les autres lignes se partagent le reste. **Répartir équitablement** donne la même part à chaque ligne ; **Réinitialiser les valeurs fixées** libère les lignes fixées
  - Les pourcentages reflètent les données en temps réel. Si vous mettez à jour l'effectif d'une société, les ventilations se recalculent

**Comment l'utiliser** :
  1. Sélectionnez l'année
  2. Choisissez une méthode de ventilation dans **Méthode**
  3. Pour une méthode manuelle, utilisez **Ajouter une ligne** pour ajouter des sociétés (ou des paires société/département) et l'icône de retrait pour en enlever une. Pour **Manuel par société**, choisissez un inducteur dans **Ventiler par**
  4. Les modifications s'enregistrent automatiquement

**Problèmes courants** :
  - **Métriques manquantes** : Une ou plusieurs sociétés ont un effectif, un nombre d'utilisateurs IT ou un chiffre d'affaires nul ou manquant pour l'année sélectionnée. Remplissez les métriques dans **Données de référence > Sociétés** (onglet Détails)
  - **« Les pourcentages manuels doivent totaliser 100 %. »** : Ajustez les lignes, ou cliquez sur **Répartir équitablement**

**Conseil** : Utilisez Effectif (par défaut) pour la plupart des postes -- c'est le plus simple et il se met à jour automatiquement. Réservez les méthodes manuelles aux dépenses qui ne bénéficient qu'à des sociétés ou départements spécifiques.

---

### Relations

L'onglet Relations lie ce poste OPEX aux objets associés : Projets, Applications, Contrats, Contacts, Sites web pertinents et Pièces jointes. Tout ce qui se trouve dans cet onglet s'enregistre automatiquement.

**Projets** :
  - Utilisez l'autocomplétion pour lier un ou plusieurs projets depuis votre Portefeuille
  - Cela aide à regrouper les dépenses par projet dans les rapports et permet la comptabilité projet
  - Retirez un projet en cliquant sur le X de sa puce

**Applications** :
  - Utilisez l'autocomplétion pour lier une ou plusieurs applications ou services depuis votre catalogue IT
  - Cela aide à suivre quels postes OPEX financent quelles applications ou services

**Contrats** :
  - Utilisez l'autocomplétion pour lier un ou plusieurs contrats
  - Lorsqu'ils sont liés, le nom du contrat apparaît dans la colonne **Contrat** de la liste OPEX pour référence rapide
  - Un contrat peut être lié à plusieurs postes OPEX (relation plusieurs-à-plusieurs)
  - Retirez un contrat en cliquant sur le X de sa puce

**Contacts** :
  - Liez des contacts à ce poste : choisissez un contact, puis son rôle (**Commercial**, **Technique**, **Support** ou **Autre**). Le choix du rôle ajoute le contact
  - Le tableau affiche le rôle, le prénom, le nom, la fonction, l'e-mail et le mobile. Survolez le rôle pour savoir si le contact vient du fournisseur ou a été ajouté manuellement
  - Retirez un contact avec l'icône de retrait
  - Utile pour savoir qui contacter pour les renouvellements, les incidents de support ou les négociations

**Sites web pertinents** :
  - Cliquez sur **Ajouter une URL** pour ajouter un lien (ex. : portails fournisseurs, documentation, consoles d'administration, wikis internes). Chaque lien a un **Nom** et une **URL**
  - Cliquez sur la ligne d'un lien pour le modifier, ou utilisez l'icône de suppression pour le retirer

**Pièces jointes** :
  - Téléversez des fichiers liés à ce poste (ex. : contrats, factures, devis, cahiers des charges, spécifications techniques)
  - Glissez-déposez des fichiers dans la zone de pièces jointes, ou cliquez sur **Sélectionner des fichiers** pour parcourir
  - Cliquez sur la puce d'un fichier pour le télécharger
  - Supprimez une pièce jointe avec l'icône de suppression de sa puce (après confirmation ; nécessite `opex:manager`)

**Conseil** : Liez les contrats pour suivre les renouvellements à travers plusieurs postes OPEX. Ajoutez les URL de portails fournisseurs pour un accès rapide. Téléversez les devis et factures en pièces jointes pour centraliser toute la documentation liée aux dépenses.

---

## Import/export CSV

Vous pouvez charger en masse les postes OPEX via CSV pour accélérer la configuration initiale ou la synchronisation avec des systèmes externes.

**Export** :
  1. Cliquez sur **Export CSV** dans la liste OPEX
  2. Choisissez :
     - **Modèle** : En-têtes uniquement (utilisez-le pour créer un CSV vierge à remplir)
     - **Données** : Tous les postes OPEX actuels avec les budgets pour A-1, A et A+1

**Structure du CSV** :
  - Séparateur : point-virgule `;` (pas de virgule)
  - Encodage : UTF-8 (enregistrez au format « CSV UTF-8 » dans Excel)
  - En-têtes : `product_name;description;supplier_name;company_name;account_number;currency;effective_start;status;disabled_at;owner_it_email;owner_business_email;analytics_category;notes;y_minus1_budget;y_minus1_landing;y_budget;y_follow_up;y_landing;y_revision;y_plus1_budget;y_plus1_revision`
  - `disabled_at` est la fin de validité : la date à laquelle le poste s'arrête. Indiquez une date (`2026-12-31`) ou une date avec heure. Laissez vide s'il n'y a pas de fin
  - Les anciens fichiers avec une colonne `effective_end` s'importent toujours : sa date alimente la fin de validité lorsque `disabled_at` est vide

**Import** :
  1. Cliquez sur **Import CSV** dans la liste OPEX
  2. Téléversez votre fichier CSV (glisser-déposer ou sélecteur de fichiers)
  3. Cliquez sur **Vérification** pour valider :
     - Les en-têtes correspondent exactement
     - Les fournisseurs, comptes et utilisateurs existent dans votre espace de travail
     - Les champs obligatoires (product_name, currency, effective_start, paying_company) sont présents
     - Aucune combinaison product_name + fournisseur en double
  4. Examinez le rapport de vérification (il affiche les totaux et jusqu'à 5 exemples d'erreurs)
  5. Si tout est correct, cliquez sur **Charger** pour importer

**Remarques importantes** :
  - **Clé unique** : Les postes OPEX sont identifiés par `(product_name, supplier_name)`. Si une combinaison existe déjà, elle est **ignorée** (pas de mise à jour)
  - **Insertion uniquement** : L'importateur ne crée que de nouveaux postes ; il ne met pas à jour les existants. Utilisez l'interface pour modifier les postes existants
  - **Références** : `supplier_name` doit correspondre à un Fournisseur par nom (insensible à la casse). `account_number` doit correspondre à un Compte. `owner_it_email` et `owner_business_email` doivent correspondre à des utilisateurs actifs par e-mail
  - **Catégorie analytique** : Si la catégorie n'existe pas, elle est créée automatiquement pendant l'import
  - **Budgets** : Les colonnes budgétaires alimentent les versions A-1, A et A+1. Les montants sont répartis uniformément sur 12 mois (mode Annuel) et la période de la colonne devient l'année entière. Une cellule vide laisse la colonne telle quelle ; `0` l'efface
  - **Montants mensuels** : pour charger ou relire les montants mois par mois, avec la période de chaque colonne, utilisez le **Fichier des lignes budgétaires** dans l'Administration budgétaire

**Erreurs courantes** :
  - **« Fournisseur introuvable »** : Créez d'abord le fournisseur dans **Données de référence > Fournisseurs**, puis relancez l'import
  - **« Compte introuvable »** : Ajoutez le compte dans **Données de référence > Plans comptables**, puis relancez l'import
  - **« Devise invalide »** : Utilisez des codes ISO à 3 lettres (USD, EUR, GBP) autorisés dans les paramètres de devise de votre espace de travail
  - **« En-têtes non conformes »** : Téléchargez un modèle récent ; les en-têtes doivent correspondre exactement (ordre compris)

**Conseil** : Commencez par l'export du modèle, remplissez quelques lignes et lancez une vérification pour détecter les erreurs tôt. Corrigez les erreurs dans le CSV et téléversez-le à nouveau jusqu'à ce que la vérification passe, puis chargez.

---

## Statut et cycle de vie

Chaque poste OPEX a un **statut** (Activé ou Désactivé) et une **Fin de validité** optionnelle qui détermine quand il apparaît dans les rapports et les listes de sélection. C'est la seule date de fin d'un poste.

**Fonctionnement** :
  - **Activé** : Le poste est actif et apparaît partout (listes, rapports, ventilations)
  - **Fin de validité** : La date à laquelle le poste s'arrête. Laissez-la vide s'il n'y a pas de fin
  - Après la fin de validité :
    - Le poste n'apparaît plus dans les listes de sélection pour de nouveaux contrats ou ventilations
    - Il est exclu des rapports pour les années strictement postérieures à la fin de validité
    - Les données historiques restent intactes ; le poste apparaît toujours dans les rapports couvrant les années où il était actif

**Définir le statut** :
  - À la création du poste, vous pouvez définir sa **Fin de validité** dans le panneau **Propriétés**
  - Ensuite, modifiez le **Statut** dans la barre de métadonnées, ou utilisez le champ **Cycle de vie** du panneau **Propriétés** (interrupteur **Activé** et **Fin de validité**). Désactiver un poste sans date fixe sa fin de validité à aujourd'hui
  - Vous pouvez programmer une fin de validité future (utile pour les postes dont le contrat arrive à échéance)

**Afficher les postes désactivés** :
  - Par défaut, la liste OPEX n'affiche que les postes **Activés**
  - Utilisez la bascule **Afficher : Désactivé** ou **Afficher : Tous** pour voir les postes désactivés

**Désactiver ou supprimer** :
  - **Privilégiez la désactivation** : Elle préserve l'historique, garantit la cohérence des rapports et conserve la piste d'audit
  - **Supprimez uniquement si** : Le poste a été créé par erreur et n'a ni budget, ni ventilation, ni tâche
  - La suppression est protégée : vous ne pouvez pas supprimer un poste référencé par des contrats ou des tâches, ou qui a des données budgétaires

**Conseil** : Utilisez la Fin de validité pour clore les postes OPEX lorsque les contrats se terminent ou que les services sont arrêtés. Ne supprimez qu'en cas de véritable erreur.

---

## Conseils et bonnes pratiques

1. **Commencez simple** : Créez les postes avec juste l'essentiel (nom du produit, fournisseur, société payeuse, compte), puis ajoutez les budgets et ventilations au fur et à mesure que vous planifiez.

2. **Utilisez la méthode de ventilation par défaut** : Pour la plupart des postes, Effectif (Par défaut) suffit. Réservez les ventilations manuelles aux dépenses qui ne bénéficient qu'à des sociétés ou départements spécifiques.

3. **Liez les contrats** : Si vous gérez les dépenses via des contrats, liez-les dans l'onglet Relations. Cela facilite le suivi des renouvellements.

4. **Liez les applications** : Associez les postes OPEX aux applications ou services qu'ils financent. Vous obtenez une correspondance claire entre coûts et applications.

5. **Téléversez la documentation** : Utilisez les Pièces jointes pour stocker les contrats fournisseurs, devis, factures et cahiers des charges.

6. **Ajoutez les liens des portails fournisseurs** : Utilisez les Sites web pertinents pour pointer vers les consoles d'administration, les portails de support et la documentation des fournisseurs.

7. **Suivez les contacts** : Ajoutez les contacts fournisseurs avec leur rôle (Commercial, Technique, Support) pour que votre équipe sache qui appeler pour chaque poste de dépense.

8. **Exploitez les catégories analytiques** : Classez les postes par catégorie (Infrastructure, Apps métier, Sécurité) pour regrouper les dépenses dans les rapports.

9. **Maintenez les métriques des sociétés à jour** : Les ventilations dépendent de l'effectif, des utilisateurs IT et du chiffre d'affaires des sociétés. Des métriques obsolètes causent des erreurs de ventilation.

10. **Utilisez le CSV pour la configuration en masse** : Si vous migrez depuis un autre système ou avez des centaines de postes, commencez par l'import CSV. Exportez un modèle, remplissez-le et lancez la vérification avant de charger.

11. **Désactivez, ne supprimez pas** : Préservez l'historique en désactivant les postes lorsqu'ils ne sont plus actifs. Ne supprimez qu'en cas d'erreur.

12. **Vérifiez la ligne de totaux** : Avant de finaliser les budgets, vérifiez la ligne de totaux épinglée dans la liste pour vous assurer que vos dépenses s'additionnent comme prévu.

13. **Utilisez les liens profonds** : Cliquez directement sur une colonne budgétaire dans la liste pour accéder à l'onglet Budget de cette année. Cliquez sur la colonne Tâche pour accéder aux tâches du poste dans l'onglet Vue d'ensemble. Vous gagnez du temps de navigation.

14. **Gelez les budgets après la clôture de fin d'année** : Utilisez l'Administration budgétaire pour geler les budgets de l'année précédente une fois le réalisé finalisé, ce qui empêche les modifications accidentelles.

---

## Autorisations

L'accès OPEX est contrôlé par trois niveaux :

- `opex:reader` -- Consulter la liste OPEX, ouvrir les postes, voir les budgets et ventilations (lecture seule), télécharger les pièces jointes
- `opex:manager` -- Créer et modifier les postes OPEX, mettre à jour les budgets et ventilations, téléverser et supprimer les pièces jointes, gérer les relations et liens
- `opex:admin` -- Tous les droits manager plus import/export CSV, opérations budgétaires (gel, copie, réinitialisation) et suppression en masse

De plus :
- Les tâches ont des autorisations séparées (`tasks:member` pour créer/modifier des tâches sur les postes OPEX)
- Les utilisateurs avec `tasks:reader` peuvent consulter les tâches mais ne peuvent pas les créer ou les modifier

Si vous ne pouvez pas effectuer une action (ex. : le bouton **Import CSV** est manquant, impossible de téléverser des pièces jointes), demandez à l'administrateur de votre espace de travail de revoir les autorisations de votre rôle.

---

## Besoin d'aide ?

- **Problèmes de CSV** : Téléchargez un modèle récent, vérifiez l'encodage UTF-8 et lancez la vérification pour voir le détail des erreurs
- **Erreurs de ventilation** : Vérifiez que toutes les sociétés ont les métriques requises (effectif, utilisateurs IT, chiffre d'affaires) pour l'année sélectionnée
- **Avertissement de compte obsolète** : Le compte n'appartient pas au plan comptable de la société payeuse ; choisissez un autre compte
- **Boutons ou onglets manquants** : Votre rôle n'a peut-être pas le niveau d'autorisation requis (manager ou admin). Contactez l'administrateur de votre espace de travail
