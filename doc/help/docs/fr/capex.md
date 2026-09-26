# CAPEX

Les postes CAPEX (dépenses d'investissement) sont vos investissements dans des actifs à long terme : achats de matériel, licences logicielles à valeur pluriannuelle, projets d'infrastructure et équipements. C'est ici que vous planifiez les budgets d'investissement, suivez les dépenses de projet et répartissez les coûts à travers votre organisation.

L'espace de travail CAPEX vous aide à gérer chaque poste d'investissement de la budgétisation initiale jusqu'à l'exécution et le reporting -- le tout en un seul endroit avec des colonnes budgétaires annuelles, des méthodes de ventilation flexibles et des liens directs vers les projets, contrats et contacts.

## Premiers pas

Rendez-vous dans **Gestion budgétaire > CAPEX** pour voir votre liste. Cliquez sur **Nouveau** pour créer votre premier poste.

L'espace de travail s'ouvre en mode création, avec le panneau **Propriétés** ouvert à droite. Saisissez le nom de l'investissement dans le titre en haut, remplissez les propriétés, puis cliquez sur **Créer**.

**Champs obligatoires** :

- **Titre** : Ce dans quoi vous investissez (ex. : « Nouvelle infrastructure serveur », « Licence logiciel ERP »). C'est la description du poste, affichée dans la colonne **Description** de la liste
- **Société payeuse** : Quelle société réalise l'investissement (obligatoire pour la comptabilité)
- **Devise** : Code ISO (ex. : USD, EUR). Par défaut la devise CAPEX de votre espace de travail ; modifiable par poste
- **Type d'immobilisation** : Classification des immobilisations corporelles -- Matériel ou Logiciel
- **Type d'investissement** : Objectif de l'investissement (voir les options ci-dessous)
- **Priorité** : Niveau de priorité métier (voir les options ci-dessous)
- **Début d'effet** : Quand cet investissement commence (JJ/MM/AAAA)

**Fortement recommandé** :

- **Compte** : Le compte du grand livre pour cette dépense d'investissement. Seuls les comptes du plan comptable de la société payeuse apparaissent
- **Fournisseur** : Le vendeur ou fournisseur de cet investissement. Sélectionnez-le dans vos données de référence fournisseurs

**Optionnel mais utile** :

- **Catégorie analytique** : Regroupement personnalisé pour le reporting
- **Fin de validité** : La date à laquelle cet investissement s'arrête, par exemple à la fin de la durée de vie utile de l'actif ou à l'achèvement du projet. Laissez-la vide s'il n'y a pas de fin. Après cette date, le poste est désactivé et les années suivantes ne comptent plus dans les vues budgétaires
- **Responsable IT** / **Responsable métier** : Qui est en charge
- **Description** (onglet Vue d'ensemble) : Détails libres sur l'investissement

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
| **Description** | Nom de l'investissement |
| **Société** | Société payeuse |
| **Type d'immobilisation** | Matériel ou Logiciel |
| **Type d'investissement** | Objectif de l'investissement |
| **Priorité** | Niveau de priorité métier |
| **Ventilation A** | Libellé de la méthode de ventilation de l'année en cours |
| **Budget A** | Budget d'investissement planifié de l'année en cours (devise de reporting) |
| **Atterrissage prévu A** | Dépense d'investissement réelle finale de l'année en cours (devise de reporting) |
| **Budget A+1** | Budget d'investissement planifié de l'année suivante (devise de reporting) |

### Colonnes supplémentaires

Ces colonnes sont masquées par défaut. Affichez-les depuis le sélecteur de colonnes (menu hamburger dans l'en-tête de la grille) :

| Colonne | Ce qu'elle affiche |
|---|---|
| **Ventilation A+1** | Libellé de la méthode de ventilation de l'année suivante |
| **Atterrissage prévu A-1** | Dépense d'investissement réelle finale de l'année précédente |
| **Devise** | Code de devise du poste |
| **Début** | Date de début d'effet |
| **Fin de validité** | Date à laquelle le poste s'arrête (vide signifie sans fin) |
| **Notes** | Notes libres |
| **Tâche** | Titre de la tâche la plus récente liée à ce poste |
| **Activé** | Statut (activé ou désactivé) |

### Recherche rapide

Le champ de recherche en haut porte sur la description, les notes, le type d'immobilisation, le type d'investissement, la priorité, la devise et le statut. Les résultats se mettent à jour en temps réel pendant la saisie.

### Filtres de colonnes

Chaque en-tête de colonne filtrable a une icône de filtre. **Société**, **Type d'immobilisation**, **Type d'investissement**, **Priorité** et **Devise** utilisent des filtres par jeu de cases à cocher avec **Tous**, **Aucun** et un bouton d'effacement. Plusieurs filtres se combinent avec une logique ET.

### Tri

Cliquez sur un en-tête de colonne pour trier par ordre croissant ou décroissant. La liste mémorise votre dernier tri quand vous revenez.

### Ligne de totaux

La ligne épinglée en bas affiche les totaux pour toutes les colonnes budgétaires. Les totaux respectent vos filtres et recherche actuels. Tous les montants sont convertis dans votre devise de reporting, affichée dans le titre de la page (ex. : « CAPEX (EUR) »).

### Liens profonds

Cliquez sur n'importe quelle cellule d'une ligne pour ouvrir l'espace de travail sur l'onglet le plus pertinent pour cette colonne :

- **Description**, **Société**, **Type d'immobilisation**, **Type d'investissement**, **Priorité** : Ouvre la **Vue d'ensemble**
- **Budget A**, **Atterrissage prévu A** : Ouvre l'onglet **Budget** pour l'année en cours
- **Atterrissage prévu A-1** : Ouvre l'onglet **Budget** pour l'année précédente
- **Budget A+1** : Ouvre l'onglet **Budget** pour l'année suivante
- **Ventilation A** : Ouvre l'onglet **Ventilations** pour l'année en cours
- **Ventilation A+1** : Ouvre l'onglet **Ventilations** pour l'année suivante
- **Tâche** : Ouvre l'onglet **Vue d'ensemble**, où se trouve le panneau des tâches

### Filtre de statut

Utilisez la bascule **Afficher : Activé / Désactivé / Tous** au-dessus de la grille pour choisir le périmètre de cycle de vie (par défaut **Activé**). Choisissez **Désactivé** pour revoir les investissements archivés, ou **Tous** pour inclure les deux états. Les totaux se mettent à jour immédiatement.

### Conservation du contexte de recherche

Votre contexte de liste (ordre de tri, texte de recherche et filtres actifs) est conservé lorsque vous ouvrez un poste et restauré lorsque vous revenez à la liste. Vous pouvez ainsi consulter plusieurs postes à la suite sans perdre votre position.

### Navigation Préc./Suiv.

Lorsque vous ouvrez un poste, l'espace de travail affiche les boutons **Préc.** et **Suiv.**. Ils parcourent la liste dans l'ordre de tri actuel, en respectant les filtres et la recherche, et enregistrent d'abord vos modifications en attente. Le compteur (ex. : « Poste 3 sur 47 ») indique votre position dans la liste filtrée.

**Conseil** : Utilisez les filtres de colonnes et la recherche rapide pour construire des vues ciblées (ex. : « Tous les investissements matériel de priorité haute »), puis naviguez poste par poste avec **Préc.**/**Suiv.** pour revoir les budgets.

---

## L'espace de travail CAPEX

Cliquez sur n'importe quelle ligne de la liste pour ouvrir l'espace de travail. Il comporte quatre parties :

- **En-tête** : la référence du poste (ex. : `CPX-7`) avec un bouton de copie, le nom de l'investissement (cliquez dessus pour renommer le poste), **Préc.** / **Suiv.**, **Envoyer le lien** et le bouton de fermeture
- **Barre de métadonnées** sous le titre : **Statut**, **Priorité**, **Responsable IT** et **Responsable métier**, modifiables sur place
- **Quatre onglets** : **Vue d'ensemble**, **Budget**, **Ventilations** et **Relations** (l'onglet Relations indique le nombre de liens du poste)
- **Panneau Propriétés** à droite : les champs principaux du poste. Ouvrez-le ou fermez-le avec le bouton des propriétés ; l'espace de travail mémorise votre choix

**Enregistrement automatique** :

- Chaque modification s'enregistre automatiquement. L'indication **Enregistrement...** / **Enregistré** apparaît dans l'en-tête
- Changer d'onglet, passer au poste précédent ou suivant, ou fermer l'espace de travail enregistre d'abord les modifications en attente. Si un enregistrement échoue, vous restez sur place et un message en donne la raison : aucune modification n'est perdue sans que vous le sachiez
- **Ctrl+S** (**Cmd+S** sur Mac) enregistre immédiatement

### Vue d'ensemble

L'onglet Vue d'ensemble contient les détails de l'investissement et ses tâches.

**Ce que vous pouvez modifier** :

- **Description** : Détails libres sur l'investissement (exportés sous `notes` dans le CSV). Le nom de l'investissement est le titre en haut

**Panneau des tâches** :

- Liste toutes les tâches liées à ce poste CAPEX, avec les colonnes **Titre**, **Statut**, **Priorité**, **Échéance** et **Actions**. Le titre du panneau indique le nombre de tâches
- Filtre **Statut** : Tous (par défaut), Actifs (non terminés) ou un statut précis. Le bouton de réinitialisation l'efface
- Cliquez sur **Ajouter une tâche** pour ouvrir une nouvelle tâche déjà liée à ce poste. Remplissez le titre, la description, la priorité, le responsable et l'échéance dans l'espace de travail de la tâche
- Utilisez l'icône d'ouverture pour aller sur une tâche, et l'icône de suppression pour la supprimer (après confirmation)
- Les tâches ont leurs propres autorisations (`tasks:member` pour créer et modifier). L'accès manager CAPEX ne donne pas à lui seul le droit de modifier les tâches ; vérifiez avec votre admin si vous ne pouvez pas créer de tâches
- Les tâches peuvent aussi être consultées et gérées depuis **Portefeuille > Tâches**, qui affiche toutes les tâches de votre organisation
- Le titre de la dernière tâche apparaît aussi dans la colonne **Tâche** de la liste (masquée par défaut)

**Panneau Propriétés** :

- **Fournisseur**, **Société payeuse**, **Compte** (filtré par le plan comptable de la société payeuse), **Devise** (seulement les devises autorisées dans votre espace de travail), **Type d'immobilisation**, **Type d'investissement**, **Catégorie analytique** et **Début d'effet**
- **Cycle de vie** : l'interrupteur **Activé** et la date de **Fin de validité**. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie)
- Dates **Créé** et **Mis à jour** (lecture seule)
- La **Priorité** se règle dans le panneau Propriétés à la création du poste, puis dans la barre de métadonnées

**Conseil** : Lors de la création d'un poste, un avertissement « compte obsolète » signifie que le compte sélectionné n'appartient pas au plan comptable de la société payeuse. Choisissez un autre compte pour résoudre l'avertissement.

---

### Budget

L'onglet Budget est l'endroit où vous saisissez les données financières par année. Il prend en charge plusieurs colonnes budgétaires et deux modes de saisie, présentés sous forme d'onglets : **Annuel** (total annuel) et **Mensuel** (ventilation sur 12 mois).

**Sélection d'année** :

- Utilisez les onglets d'année en haut pour basculer entre A-2, A-1, A (année en cours), A+1 et A+2
- Chaque année a sa propre version, sa méthode de ventilation et ses montants
- Changer d'année enregistre d'abord vos modifications en attente

**Colonnes budgétaires** (toutes les années) :

- **Budget** : Budget d'investissement planifié initial
- **Révision** : Mise à jour budgétaire en cours d'année (ex. : après des changements de périmètre ou des re-prévisions)
- **Réalisé** : Dépense réelle attendue (votre meilleure estimation au fil de l'année)
- **Atterrissage prévu** : Dépense d'investissement réelle finale après la clôture de fin d'année

**Période d'une colonne** :

- Budget, Révision, Prévision et Atterrissage prévu ont chacun une période à l'intérieur de l'année, par exemple d'avril à décembre
- Un mois compte lorsque la période couvre son 15. Une période qui commence le 10 avril inclut avril ; une période qui commence le 20 avril débute en mai
- Une colonne sans montant ni période reçoit une suggestion : le **Début d'effet** et la **Fin de validité** du poste, limités à l'année. Un investissement qui commence le 1er avril suggère d'avril à décembre
- Une colonne qui porte déjà des montants sans période est lue comme couvrant toute l'année : les données existantes se comportent comme avant
- Le Réalisé couvre toujours toute l'année

**Annuel ou Mensuel** :

- **Annuel** : Saisissez un total par colonne. Le total est réparti uniformément sur les mois de la période de la colonne, et les mois hors de cette période sont mis à zéro. La période s'affiche sous chaque total avant la saisie, par exemple « 9 mois, avril à décembre ». Seul le total que vous modifiez est enregistré. Les autres colonnes gardent leurs montants mensuels.
- Cliquez sur **Modifier la période** sous un total pour ouvrir le panneau de répartition sur cette colonne, avec son total actuel. Si les dates du poste ne laissent aucun mois dans l'année, le total est désactivé et indique « Aucun mois de 2026 n'est compris dans les dates du poste. » Cliquez sur **Choisir la période** pour la définir vous-même.
- **Mensuel** : Saisissez les montants par mois (Jan à Déc) pour un suivi fin des dépenses projet, plus une colonne **Prévision**. Des sous-totaux par trimestre et un total annuel sont affichés. Seuls les mois que vous modifiez sont enregistrés.
- Passez d'un mode à l'autre avec les onglets **Annuel** et **Mensuel**
- Changer de mode ne modifie pas vos montants : seul l'affichage change. Annuel montre le total annuel des mois enregistrés, Mensuel montre les mois enregistrés.

**Comportement du gel** :

- Si le budget d'une année est gelé (via l'Administration budgétaire), les champs passent en lecture seule et affichent un cadenas
- Chaque colonne peut être gelée indépendamment (Budget, Révision, Prévision, Réalisé, Atterrissage prévu)
- Vous pouvez toujours consulter les données gelées ; les administrateurs peuvent dégeler via **Gestion budgétaire > Administration > Geler/Dégeler**

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

**Outils du mode mensuel** (mode Mensuel uniquement) :

- **Effacer la colonne** : l'icône à côté d'un en-tête de colonne remet à zéro tous les mois de cette colonne
- Utile pour saisir un échéancier de décaissement à la main, par exemple tout le montant sur un seul mois
- Effacer de cette façon compte comme une modification à la main. Pour retirer à la fois les montants et la période d'une colonne pour tous les investissements, utilisez **Réinitialiser une colonne budgétaire** dans l'Administration budgétaire

**Tendance pluriannuelle** :

- Un graphique sous le tableau montre les colonnes budgétaires du poste sur plusieurs années et se met à jour pendant la saisie

**Comment l'utiliser** :

1. Sélectionnez l'année pour laquelle vous planifiez
2. Choisissez l'onglet **Annuel** ou **Mensuel**
3. Remplissez les colonnes pertinentes (Budget pour la planification initiale, Réalisé pour le suivi, Atterrissage prévu pour le chiffre de fin d'année)
4. Vos modifications s'enregistrent automatiquement ; l'indication **Enregistrement...** / **Enregistré** apparaît à côté des onglets d'année

**Conseil** : Pour la plupart des postes, le mode Annuel est plus rapide. Utilisez le mode Mensuel lorsque vous devez suivre le calendrier des dépenses d'un projet ou un déploiement par phases.

---

### Ventilations

L'onglet Ventilations répartit la dépense d'investissement entre vos sociétés et départements. Cela alimente les rapports de refacturation et aide à ventiler les coûts d'actifs.

**Sélection d'année** :

- Fonctionne comme le Budget : utilisez les onglets d'année pour basculer entre A-2, A-1, A, A+1, A+2
- Chaque année peut avoir une méthode de ventilation différente
- Le **Budget de l'année** sélectionnée s'affiche à droite

**Méthodes de ventilation** :

1. **Effectif (par défaut)** : Répartit la dépense d'investissement proportionnellement à l'effectif de chaque société pour l'année sélectionnée. Les pourcentages se mettent à jour automatiquement lorsque vous modifiez les métriques des sociétés. C'est la méthode standard.

2. **Utilisateurs IT** : Répartit la dépense proportionnellement au nombre d'utilisateurs IT de chaque société pour l'année sélectionnée. Utile pour les investissements d'infrastructure IT qui évoluent avec le personnel IT.

3. **Chiffre d'affaires** : Répartit la dépense proportionnellement au chiffre d'affaires de chaque société pour l'année sélectionnée. Utile pour les plateformes ou infrastructures à l'échelle de l'entreprise.

4. **Manuel par société** : Vous sélectionnez les sociétés qui bénéficient de cet investissement. Choisissez un inducteur dans **Ventiler par** (Effectif, Utilisateurs IT ou Chiffre d'affaires) pour calculer les pourcentages entre les sociétés sélectionnées. Seules les sociétés sélectionnées entrent dans la répartition.

5. **Manuel par département** : Vous sélectionnez des paires société/département. Les pourcentages sont calculés à partir de l'effectif de chaque département. Utile lorsqu'un investissement ne bénéficie qu'à certains départements (ex. : équipement de production).

6. **Pourcentages manuels** : Vous choisissez les sociétés et saisissez vous-même chaque pourcentage. Le total doit faire 100 %.

**Méthodes par défaut et méthodes épinglées** :

- L'option **par défaut** -- affichée comme *Effectif (par défaut)* tant que votre organisation n'a pas configuré une autre méthode -- suit le réglage défini dans **Gestion budgétaire > Administration > Méthode de ventilation par défaut**. Chaque investissement laissé sur la valeur par défaut est recalculé lorsqu'un administrateur modifie ce réglage.
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

**Conseil** : Utilisez Effectif pour la plupart des postes (c'est le plus simple et il se met à jour automatiquement). Réservez Manuel par société aux investissements qui ne bénéficient qu'à des entités précises (ex. : un datacenter régional). Utilisez Manuel par département pour les investissements très ciblés.

---

### Relations

L'onglet Relations lie ce poste CAPEX aux objets associés : Projets, Contrats, Contacts, Sites web pertinents et Pièces jointes. Tout ce qui se trouve dans cet onglet s'enregistre automatiquement.

**Projets** :

- Utilisez l'autocomplétion pour lier un ou plusieurs projets
- Cela aide à regrouper les dépenses d'investissement par projet dans les rapports et permet la comptabilité projet
- Retirez un projet en cliquant sur le X de sa puce

**Contrats** :

- Utilisez l'autocomplétion pour lier un ou plusieurs contrats
- Une fois lié, le nom du contrat apparaît pour référence rapide
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
- **Contrats** : Savoir quels postes d'investissement sont couverts par des contrats d'achat ou de service
- **Contacts** : Garder les coordonnées des fournisseurs et parties prenantes associées à l'investissement
- **Sites web et pièces jointes** : Centraliser toute la documentation et les références de l'investissement pour y accéder facilement

**Conseil** : Téléversez les devis fournisseur, notes d'approbation et spécifications techniques en pièces jointes. Liez les contrats pour suivre les achats. Utilisez les contacts pour associer les interlocuteurs fournisseurs à chaque poste d'investissement.

---

## Import/export CSV

Vous pouvez charger en masse les postes CAPEX via CSV pour accélérer la configuration initiale ou la synchronisation avec des systèmes externes.

**Export** :

1. Cliquez sur **Export CSV** dans la liste CAPEX
2. Choisissez :
   - **Modèle** : En-têtes uniquement (utilisez-le pour créer un CSV vierge à remplir)
   - **Données** : Tous les postes CAPEX actuels avec les budgets pour A-1, A et A+1

**Structure du CSV** :

- Séparateur : point-virgule `;` (pas de virgule)
- Encodage : UTF-8 (enregistrez au format « CSV UTF-8 » dans Excel)
- En-têtes : `item_number;description;ppe_type;investment_type;priority;currency;effective_start;status;disabled_at;notes;company_name;owner_it_email;owner_business_email;analytics_category;y_minus1_budget;y_minus1_landing;y_budget;y_follow_up;y_landing;y_revision;y_plus1_budget;y_plus1_revision;y_plus2_budget`
- `disabled_at` est la fin de validité : la date à laquelle le poste s'arrête. Indiquez une date (`2026-12-31`) ou une date avec heure. Laissez vide s'il n'y a pas de fin
- Les anciens fichiers avec une colonne `effective_end` s'importent toujours : sa date alimente la fin de validité lorsque `disabled_at` est vide

**Import** :

1. Cliquez sur **Import CSV** dans la liste CAPEX
2. Téléversez votre fichier CSV (glisser-déposer ou sélecteur de fichiers)
3. Cliquez sur **Vérification** pour valider :
   - Les en-têtes correspondent exactement
   - Les sociétés existent dans votre espace de travail
   - Les champs obligatoires (description, ppe_type, investment_type, priority, currency, effective_start, company_name) sont présents
   - Aucune description en double
4. Examinez le rapport de vérification (il affiche les totaux et jusqu'à 5 exemples d'erreurs)
5. Si tout est correct, cliquez sur **Charger** pour importer

**Remarques importantes** :

- **Clé unique** : Les postes CAPEX sont identifiés par `description`. Si une description existe déjà, elle est **ignorée** (pas de mise à jour).
- **Insertion uniquement** : L'importateur ne crée que de nouveaux postes ; il ne met pas à jour les existants. Utilisez l'interface pour modifier les postes existants.
- **Références** : `company_name` doit correspondre à une Société par nom (insensible à la casse).
- **Type d'immobilisation** : Doit être `hardware` ou `software` (insensible à la casse).
- **Type d'investissement** : Doit être l'un des suivants : `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth`, `other` (insensible à la casse).
- **Priorité** : Doit être `mandatory`, `high`, `medium` ou `low` (insensible à la casse).
- **Budgets** : Les colonnes budgétaires alimentent les versions A-1, A et A+1. Les montants sont répartis uniformément sur 12 mois (mode Annuel) et la période de la colonne devient l'année entière. Une cellule vide laisse la colonne telle quelle ; `0` l'efface.
- **Montants mensuels** : pour charger ou relire les montants mois par mois, avec la période de chaque colonne, utilisez le **Fichier des lignes budgétaires** dans l'Administration budgétaire.

**Erreurs courantes** :

- **« Société introuvable »** : Créez d'abord la société dans **Données de référence > Sociétés**, puis relancez l'import.
- **« ppe_type invalide »** : Utilisez exactement `hardware` ou `software`.
- **« investment_type invalide »** : Utilisez l'un des 7 types d'investissement valides (voir la liste ci-dessus).
- **« Priorité invalide »** : Utilisez `mandatory`, `high`, `medium` ou `low`.
- **« Devise invalide »** : Utilisez des codes ISO à 3 lettres (USD, EUR, GBP) autorisés dans les paramètres de devise de votre espace de travail.
- **« En-têtes non conformes »** : Téléchargez un modèle récent ; les en-têtes doivent correspondre exactement (ordre compris).

**Conseil** : Commencez par l'export du modèle, remplissez quelques lignes et lancez une vérification pour détecter les erreurs tôt. Corrigez les erreurs dans le CSV et téléversez-le à nouveau jusqu'à ce que la vérification passe, puis chargez.

---

## Statut et cycle de vie

Chaque poste CAPEX a un **statut** (Activé ou Désactivé) et une **Fin de validité** optionnelle qui détermine quand il apparaît dans les rapports et les listes de sélection. C'est la seule date de fin d'un poste.

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
- Vous pouvez programmer une fin de validité future (utile pour les cessions d'actifs planifiées ou les dates de fin de vie)

**Afficher les postes désactivés** :

- Par défaut, la liste CAPEX n'affiche que les postes **Activés**
- Utilisez la bascule **Afficher : Activé / Désactivé / Tous** pour changer le périmètre

**Désactiver ou supprimer** :

- **Privilégiez la désactivation** : Elle préserve l'historique, garantit la cohérence des rapports et conserve la piste d'audit
- **Supprimez uniquement si** : Le poste a été créé par erreur et n'a ni budget, ni ventilation, ni tâche
- La suppression est protégée : vous ne pouvez pas supprimer un poste qui a des données budgétaires, des ventilations ou des tâches, ou qui est référencé par des contrats

**Conseil** : Utilisez la Fin de validité pour marquer les actifs entièrement amortis ou cédés, ou les projets terminés. Ne supprimez qu'en cas de véritable erreur.

---

## Autorisations

L'accès CAPEX est contrôlé par trois niveaux :

- `capex:reader` -- Consulter la liste CAPEX, ouvrir les postes, voir les budgets et ventilations (lecture seule)
- `capex:manager` -- Créer et modifier les postes CAPEX, mettre à jour les budgets et ventilations, téléverser les pièces jointes, gérer les liens et contacts
- `capex:admin` -- Tous les droits manager plus import CSV, opérations budgétaires (gel, copie, réinitialisation) et suppression en masse

De plus :

- Les tâches ont des autorisations séparées (`tasks:member` pour créer/modifier des tâches sur les postes CAPEX)
- Les utilisateurs avec `tasks:reader` peuvent consulter les tâches mais ne peuvent pas les créer ou les modifier

Si vous ne pouvez pas effectuer une action (ex. : le bouton **Import CSV** est absent), demandez à l'administrateur de votre espace de travail de revoir les autorisations de votre rôle.

---

## Conseils

- **Commencez simple** : Créez les postes avec juste l'essentiel (description, type d'immobilisation, type d'investissement, société), puis ajoutez les budgets et ventilations au fur et à mesure.
- **Utilisez la ventilation par effectif** : Pour la plupart des investissements, Effectif suffit. Réservez les ventilations manuelles aux investissements qui ne bénéficient qu'à des sociétés ou départements spécifiques.
- **Liez les contrats** : Si vous gérez les achats d'investissement via des contrats, liez-les dans l'onglet Relations pour suivre les achats.
- **Téléversez la documentation** : Utilisez les pièces jointes pour stocker les devis fournisseur, notes d'approbation et spécifications techniques avec le poste.
- **Classifiez avec précision** : Utilisez le Type d'investissement et la Priorité de manière cohérente pour permettre une analyse et une priorisation pertinentes des dépenses d'investissement.
- **Maintenez les métriques des sociétés à jour** : Les ventilations dépendent de l'effectif, des utilisateurs IT et du chiffre d'affaires des sociétés. Des métriques obsolètes causent des erreurs de ventilation.
- **Utilisez le CSV pour la configuration en masse** : Si vous migrez depuis un autre système ou avez de nombreux postes d'investissement, commencez par l'import CSV.
- **Désactivez, ne supprimez pas** : Préservez l'historique en désactivant les postes lorsque les actifs sont cédés ou les projets terminés.
- **Vérifiez la ligne de totaux** : Avant de finaliser les budgets d'investissement, vérifiez la ligne de totaux épinglée pour vous assurer que vos dépenses s'additionnent comme prévu.
- **Utilisez les liens profonds** : Cliquez directement sur une colonne de budget ou de ventilation dans la liste pour accéder directement à cet onglet et à cette année.
- **Suivez le calendrier des dépenses** : Pour les gros projets aux dépenses échelonnées, utilisez le mode Mensuel pour suivre les dépenses par rapport aux jalons du projet.
- **Gelez après la clôture de fin d'année** : Utilisez l'Administration budgétaire pour geler les budgets de l'année précédente une fois le réalisé finalisé, ce qui empêche les modifications accidentelles.
