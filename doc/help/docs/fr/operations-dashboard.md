# Vue d'ensemble de la gestion budgétaire

Le tableau de bord de la gestion budgétaire est la première page que vous voyez après la connexion. Il vous offre une vue d'ensemble de l'état de vos dépenses IT — aperçus OPEX et CAPEX, échéances à venir, indicateurs de qualité des données et les éléments qui méritent le plus votre attention — le tout en un seul endroit.

## Où le trouver

- Chemin : **Gestion budgétaire > Vue d'ensemble** (`/ops`)
- C'est également la page d'accueil par défaut après connexion.

## Disposition

Le tableau de bord est composé de tuiles disposées en grille responsive : trois colonnes sur un écran large, deux sur tablette et une seule colonne sur mobile. Chaque tuile comporte une icône, un titre et généralement un bouton **Voir** qui vous amène directement à la page complète derrière les données.

## Tuiles

### Aperçu OPEX

Un tableau compact couvrant trois exercices fiscaux : l'année dernière (A-1), l'année en cours (A) et l'année prochaine (A+1). Jusqu'à cinq colonnes de valeurs apparaissent : **Budget**, **Révision**, **Prévision**, **Réalisé** et **Atterrissage prévu**. Une colonne s'affiche dès qu'elle contient un montant pour au moins une des trois années. Les tuiles OPEX et CAPEX affichent les mêmes colonnes. Tous les montants sont arrondis au millier le plus proche et affichés avec un suffixe « k » (par exemple, `7 846k`).

Cliquez sur **Voir** pour ouvrir la liste OPEX.

### Aperçu CAPEX

Même disposition et formatage que l'aperçu OPEX, mais basé sur vos données de dépenses d'investissement.

Cliquez sur **Voir** pour ouvrir la liste CAPEX.

### Mes tâches

Affiche le nombre total de tâches ouvertes qui vous sont assignées (les tâches terminées sont exclues), suivi des cinq tâches dont les dates d'échéance sont les plus proches. Les tâches en retard sont surlignées en rouge. Les tâches sans date d'échéance n'apparaissent pas ici.

Cliquez sur **Voir tout** pour ouvrir la page Tâches.

### Prochains renouvellements

Liste les cinq prochaines échéances de résiliation de contrats encore dans le futur. Les échéances passées sont automatiquement filtrées pour que vous ne voyiez que ce qui arrive.

Cliquez sur **Voir tout** pour ouvrir la page Contrats.

### Hygiène des données (OPEX)

Quatre pastilles indicatrices qui vous aident à repérer les enregistrements OPEX incomplets en un coup d'œil :

- **Pas de responsable IT** — éléments sans responsable IT assigné
- **Pas de responsable métier** — éléments sans responsable métier assigné
- **Pas de société payeuse** — éléments sans société payeuse définie
- **Incohérences CoA** — éléments où le compte sélectionné n'appartient pas au plan comptable de la société payeuse

Les pastilles deviennent orange (ou rouges pour les incohérences CoA) lorsque le compteur est supérieur à zéro. Cliquez sur n'importe quelle pastille pour accéder à la liste OPEX.

### Actions rapides

Boutons de raccourci pour créer un nouveau poste OPEX ou CAPEX directement depuis le tableau de bord. Ces boutons ne sont visibles que si votre rôle vous accorde au moins les autorisations `opex:manager` ou `capex:manager`.

Sous les boutons, une section **Mises à jour OPEX récentes** liste les cinq postes OPEX les plus récemment modifiés avec leur date de dernière modification.

### Top OPEX (A)

Les cinq postes OPEX les plus importants de l'année en cours, classés par montant budgétaire. Les montants sont arrondis au millier avec un suffixe « k ».

Cliquez sur **Ouvrir** pour voir le rapport Top OPEX complet.

### Plus fortes hausses (A vs A-1)

Les cinq postes OPEX avec la plus forte augmentation de budget par rapport à l'année précédente. Les montants sont arrondis au millier avec un suffixe « k ».

Cliquez sur **Ouvrir** pour voir le rapport complet des variations OPEX.

## Conseils

- **Montants arrondis** : Tous les montants du tableau de bord sont arrondis au millier pour une vue compacte. Ouvrez la liste OPEX ou CAPEX — ou la section Rapports — lorsque vous avez besoin de chiffres exacts.
- **Boutons manquants** : Si vous ne voyez pas les boutons **Nouveau OPEX** ou **Nouveau CAPEX**, votre rôle actuel n'inclut pas l'autorisation manager requise. Demandez à votre administrateur de vérifier votre accès.
- **Tuiles vides** : Une tuile qui affiche « Pas de données » signifie simplement qu'il n'y a pas encore d'enregistrements de ce type. Dès que vous ou votre équipe commencez à saisir des données, la tuile se remplira automatiquement.
