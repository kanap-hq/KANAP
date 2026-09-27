# Vue d'ensemble de la gestion budgétaire

La vue d'ensemble de la gestion budgétaire vous offre une vision globale de l'état de vos dépenses IT : aperçus OPEX et CAPEX, échéances à venir, indicateurs de qualité des données et éléments qui méritent le plus votre attention, le tout en un seul endroit.

## Où le trouver

- Chemin : **Gestion budgétaire > Vue d'ensemble** (`/ops`)
- La page qui s'ouvre après la connexion est votre [tableau de bord](my-dashboard.md) personnel. Ouvrez cette vue d'ensemble depuis l'espace **Gestion budgétaire**.

## Disposition

Le tableau de bord est composé de tuiles disposées en grille responsive : trois colonnes sur un écran large, deux sur tablette et une seule colonne sur mobile. Chaque tuile comporte une icône, un titre et généralement un bouton **Voir** qui vous amène directement à la page complète derrière les données.

## Tuiles

### Aperçu OPEX

Un tableau compact couvrant trois exercices fiscaux : l'année dernière (A-1), l'année en cours (A) et l'année prochaine (A+1). Jusqu'à cinq colonnes de valeurs apparaissent : les colonnes budgétaires affichées par votre organisation, sous leurs noms (**Budget**, **Révision**, **Réalisé** et **Atterrissage prévu** avec les réglages standard, plus **Prévision** quand elle est affichée). Une colonne s'affiche dès qu'elle contient un montant pour au moins une des trois années. Les colonnes masquées n'apparaissent jamais. Les tuiles OPEX et CAPEX affichent les mêmes colonnes. Tous les montants sont arrondis au millier le plus proche et affichés avec un suffixe « k » (par exemple, `7 846k`).

Cliquez sur **Voir** pour ouvrir la liste OPEX.

### Aperçu CAPEX

Même disposition et formatage que l'aperçu OPEX, mais basé sur vos données de dépenses d'investissement.

Cliquez sur **Voir** pour ouvrir la liste CAPEX.

### Mes tâches

Affiche le nombre total de tâches ouvertes qui vous sont assignées (les tâches terminées sont exclues), suivi des cinq tâches dont les dates d'échéance sont les plus proches. Les tâches en retard sont surlignées en rouge. Les tâches sans date d'échéance n'apparaissent pas ici.

Cliquez sur **Tout voir** pour ouvrir la page Tâches.

### Prochains renouvellements

Liste les cinq prochaines échéances de résiliation de contrats encore dans le futur. Les échéances passées sont automatiquement filtrées pour que vous ne voyiez que ce qui arrive.

Cliquez sur **Tout voir** pour ouvrir la page Contrats.

### Hygiène des données

Quatre contrôles qui vous aident à repérer les enregistrements incomplets en un coup d'œil. La tuile affiche une colonne de compteurs par type de poste que vous pouvez consulter : **OPEX** et **CAPEX** côte à côte.

- **Sans responsable IT** : postes sans responsable IT
- **Sans responsable métier** : postes sans responsable métier
- **Sans société payeuse** : postes sans société payeuse
- **Compte hors du plan de la société** : postes dont le compte n'appartient pas au plan comptable de la société payeuse

Un compteur devient orange (rouge pour le contrôle du plan comptable) lorsqu'il est supérieur à zéro. Cliquez sur un compteur pour ouvrir la liste du type correspondant.

### Actions rapides

Boutons de raccourci pour créer un nouveau poste OPEX ou CAPEX directement depuis le tableau de bord. Ces boutons ne sont visibles que si votre rôle vous accorde au moins les autorisations `opex:manager` ou `capex:manager`.

Sous les boutons, une section **Mises à jour récentes** liste les cinq postes les plus récemment modifiés, OPEX et CAPEX confondus. Chaque ligne affiche la date de la dernière modification, le nom du poste et son type. Cliquez sur une ligne pour ouvrir le poste.

### Top postes (A)

Les cinq postes les plus importants de l'année en cours, classés selon la colonne par défaut. Le titre nomme la colonne, par exemple **Top postes (Budget, A)**. Les montants sont arrondis au millier avec un suffixe « k ».

Utilisez les onglets **OPEX** / **CAPEX** de l'en-tête de la tuile pour choisir le type de poste. La tuile mémorise votre choix. Cliquez sur **Ouvrir** pour voir le rapport Top postes complet sur le même type.

### Plus fortes hausses (A vs A-1)

Les cinq postes avec la plus forte augmentation de la colonne par défaut par rapport à l'année précédente, calculée sur tous les postes du type. Le titre nomme la colonne, par exemple **Plus fortes hausses (Budget, A vs A-1)**. Les postes dont le montant est stable ou en baisse n'apparaissent pas. Les montants sont arrondis au millier avec un suffixe « k ».

Utilisez les onglets **OPEX** / **CAPEX** de l'en-tête de la tuile pour choisir le type de poste. La tuile mémorise votre choix. Cliquez sur **Ouvrir** pour voir le rapport Top hausse / baisse complet sur le même type.

Un type que vous ne pouvez pas consulter est désactivé dans les onglets et n'a pas de colonne dans **Hygiène des données**. Si vous ne pouvez consulter ni OPEX ni CAPEX, ces tuiles sont masquées.

## Conseils

- **Colonne utilisée par les tuiles** : Un administrateur budgétaire choisit la colonne par défaut et les noms des colonnes dans [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires). Les tuiles Top et les rapports qu'elles ouvrent suivent ce choix.
- **Montants arrondis** : Tous les montants du tableau de bord sont arrondis au millier pour une vue compacte. Ouvrez la liste OPEX ou CAPEX, ou les rapports, lorsque vous avez besoin de chiffres exacts.
- **Boutons manquants** : Si vous ne voyez pas les boutons **Nouveau OPEX** ou **Nouveau CAPEX**, votre rôle actuel n'inclut pas l'autorisation manager requise. Demandez à votre administrateur de vérifier votre accès.
- **Tuiles vides** : Une tuile qui affiche « Pas de données » signifie simplement qu'il n'y a pas encore d'enregistrements de ce type. Dès que vous ou votre équipe commencez à saisir des données, la tuile se remplira automatiquement.
