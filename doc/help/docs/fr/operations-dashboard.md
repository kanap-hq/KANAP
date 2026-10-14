# Vue d'ensemble de la gestion budgétaire

La vue d'ensemble de la gestion budgétaire vous offre une vision globale de l'état de vos dépenses IT : le budget par type et par année, vos propres lignes budgétaires, les échéances à venir, des indicateurs de qualité des données et les lignes qui méritent le plus votre attention, le tout en un seul endroit.

## Où le trouver

- Chemin : **Gestion budgétaire > Vue d'ensemble** (`/ops`)
- La page qui s'ouvre après la connexion est votre [tableau de bord](my-dashboard.md) personnel. Ouvrez cette vue d'ensemble depuis l'espace **Gestion budgétaire**.

## Actions de l'en-tête

L'en-tête contient des boutons de raccourci :

- **Nouvelle ligne OPEX** et **Nouvelle ligne CAPEX** ouvrent une nouvelle ligne budgétaire de ce type. Ils s'affichent lorsque votre rôle a au moins le niveau Membre sur Budget (`budget:member`)
- **Nouveau contrat** ouvre un nouveau contrat. Il s'affiche lorsque votre rôle peut créer des contrats
- **Personnaliser**, à droite, ouvre les réglages de cette vue d'ensemble. Voir [Personnaliser la vue d'ensemble](#personnaliser-la-vue-densemble)

## Disposition

La vue d'ensemble est composée de tuiles disposées en grille responsive : trois colonnes sur un écran large, deux sur tablette et une seule colonne sur mobile. La tuile **Budget** est plus large : deux colonnes sur un écran large, toute la largeur sur tablette. Chaque tuile comporte une icône, un titre et généralement un bouton qui vous amène à la page complète derrière les données.

Plusieurs tuiles ont des onglets **Tous**, **OPEX** et **CAPEX** dans leur en-tête pour choisir le type de lignes qu'elles couvrent. Chaque tuile mémorise votre choix dans votre navigateur.

## Tuiles

Les tuiles ci-dessous sont présentées dans leur ordre par défaut.

### Budget

Un tableau couvrant trois exercices : l'année dernière (A-1), l'année en cours (A) et l'année prochaine (A+1). Chaque année a trois lignes : **OPEX**, **CAPEX** et **Total**. Les colonnes de valeurs sont les colonnes budgétaires affichées par votre organisation, sous leurs noms (**Budget**, **Révision**, **Réalisé** et **Atterrissage prévu** avec les réglages standard, plus **Prévision** quand elle est affichée). Vous pouvez en garder moins dans [Personnaliser](#personnaliser-la-vue-densemble). Une colonne s'affiche dès qu'elle contient un montant pour au moins une ligne. Les colonnes masquées n'apparaissent jamais. Tous les montants sont arrondis au millier le plus proche et affichés avec un suffixe « k » (par exemple, `7 846k`).

Cliquez sur un montant pour ouvrir la [liste des lignes budgétaires](budget-lines.md) sur ce type. Un montant **Total** ouvre la liste sur les deux types. Cliquez sur **Voir** pour ouvrir la liste.

### Hygiène des données

Des contrôles qui vous aident à repérer les lignes incomplètes en un coup d'œil. La tuile affiche une colonne de compteurs par type : **OPEX** et **CAPEX** côte à côte. Les compteurs portent sur les lignes que la liste affiche par défaut (**Afficher : Activés**).

- **Sans responsable IT** : lignes sans responsable IT
- **Sans responsable métier** : lignes sans responsable métier
- **Sans société payeuse** : lignes sans société payeuse
- **Sans centre de coûts** : lignes sans centre de coûts
- **Sans Budget l'an prochain** : lignes dont la colonne par défaut est nulle ou vide pour l'année prochaine. Le contrôle nomme votre colonne par défaut
- **Compte hors du plan de la société** : lignes dont le compte n'appartient pas au plan comptable de la société payeuse

Un compteur devient orange (rouge pour le contrôle du plan comptable) lorsqu'il est supérieur à zéro. Cliquez sur un compteur pour ouvrir la liste sur exactement les lignes qu'il compte.

### Mon budget

Les lignes à votre nom, sur la colonne par défaut de l'année en cours (le sous-titre la nomme, par exemple **Budget, A**). Utilisez les onglets **Tous** / **OPEX** / **CAPEX** pour choisir le type.

- **Comme responsable IT**, **Comme responsable métier** et **Comme responsable budgétaire** : combien de lignes vous portez dans chaque rôle, et leur total. Cliquez sur une ligne du tableau pour ouvrir la liste sur ces lignes budgétaires
- **Mes lignes** : vos trois plus grandes lignes, quel que soit le rôle, avec leur référence. Cliquez sur l'une d'elles pour l'ouvrir

La tuile affiche « Aucune ligne budgétaire à votre nom » lorsque vous n'avez aucune ligne.

### Mes tâches

Affiche le nombre total de tâches ouvertes qui vous sont assignées (les tâches terminées sont exclues), suivi des cinq tâches dont les dates d'échéance sont les plus proches. Les tâches en retard sont surlignées en rouge. Les tâches sans date d'échéance n'apparaissent pas ici.

Cliquez sur **Tout voir** pour ouvrir la page Tâches.

### Prochains renouvellements

Liste les cinq contrats dont l'échéance est la plus proche, aujourd'hui compris, dans l'ordre de la colonne **Prochaine échéance** de la liste des contrats : un contrat à reconduction tacite y figure à sa prochaine date limite de résiliation, tout autre contrat à sa fin. Les contrats échus n'y figurent pas.

Cliquez sur **Tout voir** pour ouvrir la page Contrats.

### Top lignes

Les cinq plus grandes lignes de l'année en cours, classées selon la colonne par défaut. Le sous-titre nomme la colonne, par exemple **Budget, A**. Les montants sont arrondis au millier avec un suffixe « k ».

Utilisez les onglets **Tous** / **OPEX** / **CAPEX** pour choisir le type. Cliquez sur **Ouvrir** pour voir le rapport Top lignes complet sur le même type.

### Plus fortes hausses

Les cinq lignes avec la plus forte augmentation de la colonne par défaut par rapport à l'année précédente. Le sous-titre nomme la colonne, par exemple **Budget, A vs A-1**. Les lignes dont le montant est stable ou en baisse n'apparaissent pas.

Utilisez les onglets **Tous** / **OPEX** / **CAPEX** pour choisir le type. Cliquez sur **Ouvrir** pour voir le rapport Top hausse / baisse complet sur le même type.

### Par centre de coûts

Les cinq centres de coûts au total le plus élevé sur la colonne par défaut de l'année en cours, avec une barre pour chacun. Les lignes sans centre de coûts comptent ensemble sous **Sans centre de coûts**. Utilisez les onglets **Tous** / **OPEX** / **CAPEX** pour choisir le type. Cliquez sur une ligne du tableau pour ouvrir la liste sur les lignes budgétaires de ce centre de coûts.

### Mises à jour récentes

Les cinq lignes budgétaires modifiées le plus récemment, OPEX et CAPEX confondues. Chaque ligne du tableau affiche la date de la dernière modification, la référence de la ligne budgétaire, son nom et son type. Cliquez sur une ligne du tableau pour ouvrir la ligne budgétaire.

Sans accès en lecture aux lignes budgétaires (`budget:reader`), les tuiles du budget sont masquées. **Mes tâches** demande l'accès en lecture aux tâches, et **Prochains renouvellements** l'accès en lecture aux contrats.

## Personnaliser la vue d'ensemble

Cliquez sur **Personnaliser** pour ouvrir **Réglages du tableau de bord du budget**. Vos choix ne s'appliquent qu'à votre propre vue d'ensemble.

- **Afficher ou masquer une tuile** : cochez-la ou décochez-la. La fenêtre liste les tuiles que votre rôle peut voir
- **Changer l'ordre** : faites glisser une tuile par sa poignée, à droite
- **Colonnes de montant de la tuile Budget** : **Colonnes de l'espace de travail**, cochée par défaut, suit les colonnes affichées par votre espace de travail. Décochez-la pour choisir les colonnes vous-même. Gardez-en au moins une : sinon, la fenêtre affiche « Choisissez au moins une colonne de montant. »
- **Enregistrer** applique vos choix. **Rétablir les valeurs par défaut** affiche de nouveau toutes les tuiles, dans l'ordre par défaut, avec les colonnes de l'organisation

## Conseils

- **Colonne utilisée par les tuiles** : Un administrateur budgétaire choisit la colonne par défaut et les noms des colonnes dans [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires). Les tuiles et les rapports qu'elles ouvrent suivent ce choix.
- **Montants arrondis** : Tous les montants de la vue d'ensemble sont arrondis au millier pour une vue compacte. Ouvrez la liste des lignes budgétaires, ou les rapports, lorsque vous avez besoin de chiffres exacts.
- **Boutons manquants** : Si vous ne voyez pas les boutons **Nouvelle ligne OPEX** ou **Nouvelle ligne CAPEX**, votre rôle actuel n'a pas le niveau Membre sur Budget. Demandez à votre administrateur de vérifier votre accès.
- **Tuiles vides** : Une tuile qui affiche « Pas de données » signifie simplement qu'il n'y a pas encore d'enregistrements de ce type. Dès que vous ou votre équipe commencez à saisir des données, la tuile se remplira automatiquement.
