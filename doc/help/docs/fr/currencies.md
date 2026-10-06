# Paramètres de devises

La page Paramètres de devises (**Gestion budgétaire > Administration > Devises**) est l'endroit où vous configurez comment les devises sont stockées, affichées et converties dans votre espace de travail. Elle contrôle la devise de reporting au niveau du tenant, les devises par défaut pour les nouveaux éléments et les restrictions optionnelles sur les devises utilisables.

Pour des informations de fond sur les concepts de devises et les mécanismes de conversion, consultez le guide de gestion des devises.

## Qui peut la consulter et la modifier

Les devises sont un paramètre budgétaire. La page se trouve avec les autres paramètres budgétaires dans l'[Administration budgétaire](budget-operations.md).

- **Ouvrir la page, modifier les paramètres et lancer la synchronisation des taux de change** : administration budgétaire au niveau administrateur. La carte est masquée pour les autres utilisateurs.
- **Utiliser les devises sur les postes** : les utilisateurs OPEX et CAPEX choisissent parmi les devises autorisées dans leurs formulaires de poste, sans ouvrir cette page.

Le droit **Paramètres** de la cartographie SI ne donne pas accès aux devises. Il couvre uniquement les paramètres de la cartographie SI.

## Le formulaire des paramètres de devises

### Devise de reporting
La **devise au niveau du tenant** utilisée pour tous les rapports, totaux et affichages de listes. Lorsque vous changez cette devise :
  - Toutes les colonnes annuelles OPEX et CAPEX sont converties vers la nouvelle devise de reporting
  - Les totaux dans les rapports sont recalculés avec la nouvelle base
  - **Vos données stockées restent inchangées** -- seuls l'affichage et la conversion sont affectés

**Exemple** : Si vous passez de EUR à USD, les totaux de votre liste OPEX s'afficheront en USD, mais la devise stockée de chaque poste (EUR, GBP, etc.) reste la même.

**Conseil** : Choisissez une devise de reporting qui correspond à la norme de reporting financier de votre groupe (ex. : EUR pour un siège européen, USD pour un groupe basé aux États-Unis).

### Devise OPEX par défaut
La devise qui **est pré-remplie** lorsque vous créez un nouveau poste OPEX (dépense). Cela ne restreint pas les devises sélectionnables -- cela fait simplement gagner du temps en proposant une valeur par défaut judicieuse.

**Exemple** : Si la majeure partie de vos dépenses récurrentes est en EUR, définissez EUR. Les utilisateurs peuvent toujours sélectionner manuellement GBP, USD ou toute autre devise autorisée.

### Devise CAPEX par défaut
La devise qui **est pré-remplie** lorsque vous créez un nouveau poste CAPEX. Fonctionne de la même manière que la devise OPEX par défaut, mais pour les dépenses d'investissement.

**Conseil** : Si vos CAPEX sont principalement approvisionnés dans une devise différente des OPEX quotidiens (ex. : USD pour les achats de matériel), définissez une valeur par défaut différente ici.

### Devises autorisées (optionnel)
Une **liste séparée par des virgules** de codes ISO qui restreint les devises que les utilisateurs peuvent sélectionner lors de la création ou modification de postes OPEX et CAPEX.

  - **Vide (par défaut)** : Les utilisateurs peuvent sélectionner n'importe quel code de devise ISO à 3 lettres valide
  - **Liste spécifiée** (ex. : `EUR, USD, GBP`) : Seules ces devises apparaissent dans les menus déroulants
  - **La devise de reporting est toujours autorisée** : Même si elle n'est pas listée, la devise de reporting est toujours disponible
  - **Les devises par défaut sont toujours autorisées** : Les devises OPEX et CAPEX par défaut sont toujours disponibles

**Pourquoi utiliser cela ?**
Limiter les devises autorisées est utile lorsque :
  - Votre source de données de taux de change ne couvre pas les devises exotiques
  - Vous souhaitez imposer une standardisation entre les équipes
  - Vous devez prévenir les erreurs de saisie de codes périmés ou erronés

**Conseil** : Laissez ce champ vide sauf si vous avez une raison spécifique de restreindre. Si vous restreignez, incluez toutes les devises que vos équipes utilisent activement (ex. : `EUR, USD, GBP, CHF, PLN`).

## Enregistrer les modifications

Cliquez sur **Enregistrer** pour appliquer vos mises à jour. Le système va :
  1. Valider tous les codes de devises (doivent être des codes ISO à 3 lettres)
  2. Mettre à jour vos paramètres du tenant
  3. Déclencher automatiquement un rafraîchissement en arrière-plan des taux de change pour l'année en cours et toutes les années avec des données budgétaires
  4. Afficher un message de succès

Cliquez sur **Réinitialiser** pour annuler les modifications non enregistrées et revenir aux dernières valeurs enregistrées.

**Important** : Changer la devise de reporting affecte immédiatement l'affichage des listes et rapports. Planifiez ce changement pendant une fenêtre de maintenance si vous avez besoin de périodes de reporting cohérentes.

## Forcer la synchronisation des taux de change

Le bouton **Forcer la synchronisation des taux** déclenche manuellement un rafraîchissement en arrière-plan des taux de change pour toutes les années fiscales concernées (année en cours plus toute année avec des données OPEX ou CAPEX).

**Quand l'utiliser** :
  - Après avoir ajouté de nouvelles devises autorisées
  - Lorsque vous avez besoin de taux spot à jour pour l'année en cours
  - Si vous suspectez que les taux sont périmés ou manquants
  - Avant de générer des rapports pour les parties prenantes

**Ce qui se passe** :
  - Le système met en file d'attente un job en arrière-plan pour récupérer les taux de change
  - Un message de succès indique quelles années fiscales sont en cours de rafraîchissement
  - Les taux se mettent à jour en quelques secondes
  - Le tableau des instantanés de taux de change se rafraîchit automatiquement

**Rafraîchissement automatique** : Le système rafraîchit aussi les taux automatiquement tous les 30 jours lorsqu'un utilisateur se connecte (couvre A-1, A, A+1). La synchronisation manuelle vous donne le contrôle lorsque vous avez besoin de mises à jour immédiates.

**Conseil** : Si vous ajoutez une nouvelle devise aux devises autorisées, lancez immédiatement la synchronisation des taux pour remplir les taux avant que les utilisateurs ne commencent à créer des postes dans cette devise.

## Tableau des instantanés de taux de change

Sous le formulaire de paramètres, le tableau **Derniers instantanés de taux de change** affiche les taux de change les plus récents capturés pour chaque année fiscale.

**Colonnes** :
  - **Devise** : Le code ISO à 3 lettres
  - **Colonnes d'années fiscales** : Une colonne par année avec des données (ex. : 2023, 2024, 2025)
  - **Valeurs de taux** : Taux de change vers votre devise de reporting (précision à 6 décimales)
  - **Libellé de source** : Affiche la source de données pour chaque année :
      - **Moy. annuelle** : Moyenne annuelle Banque Mondiale (années historiques)
      - **Moy. trimestrielle** : Moyenne trimestrielle Banque Mondiale (si disponible)
      - **Spot en temps réel** : Taux spot actuel d'ExchangeRate-API (année en cours)
      - **Estimation prospective** : Taux de l'année en cours réutilisé pour les années futures

**Exemple** :
Si votre devise de reporting est EUR :

| Devise | 2024 (Moy. annuelle) | 2025 (Spot en temps réel) | 2026 (Estimation prospective) |
|--------|----------------------|---------------------------|-------------------------------|
| USD    | 0,925820             | 0,931200                  | 0,931200                      |
| GBP    | 1,175300             | 1,182000                  | 1,182000                      |
| CHF    | 0,962100             | 0,965500                  | 0,965500                      |

**Lire le tableau** :
  - Les taux indiquent combien d'unités de votre devise de reporting équivalent à 1 unité de la devise listée
  - Si un taux affiche `—`, aucune donnée n'est disponible (une conversion de repli à 1,00 est utilisée)
  - Les taux sont capturés au moment de la synchronisation et restent stables jusqu'au prochain rafraîchissement

**Conseil** : Si vous voyez des taux manquants (`—`), vérifiez que le code devise est valide et couramment publié. Envisagez de limiter les devises autorisées pour éviter les codes exotiques sans données.

## Import et export CSV

### Export
Les exports OPEX et CAPEX incluent les données des postes et les montants annuels dans la **propre devise de chaque poste** -- pas la devise de reporting. Cela préserve les données originales pour la réimportation ou l'analyse externe.

**Exemple de ligne CSV** (OPEX) :
```
Item Name;Company;Account;Currency;Y-1;Y;Y+1;Y+2
SaaS License;Acme UK;6200;GBP;10000;12000;12000;12000
```

### Import
Lors de l'import de postes OPEX ou CAPEX, la colonne `Currency` doit contenir des **codes ISO standard à 3 lettres**.

**Validation** :
  - Si des **devises autorisées** sont configurées, les imports utilisant des codes non listés sont rejetés
  - La réponse d'erreur inclut la liste `allowedCurrencies` pour clarification
  - La devise de reporting et les devises par défaut sont toujours acceptées

**Exemple** :
Si Devises autorisées = `EUR, USD, GBP` et vous importez un poste avec `Currency=CHF`, l'import échoue avec :
```
Currency "CHF" is not allowed. Allowed currencies: EUR, USD, GBP
```

**Conseil** : Exportez un modèle, vérifiez la liste des devises autorisées et assurez-vous que votre fichier d'import n'utilise que ces codes.

## Statut et données historiques

Lorsque vous changez les paramètres :
  - **Devise de reporting** : Affecte l'affichage immédiatement ; les données historiques restent intactes et sont converties en utilisant les taux qui étaient actifs lors de la saisie des données
  - **Devises par défaut** : N'affectent que les nouveaux postes ; les postes existants conservent leurs devises
  - **Devises autorisées** : Les postes existants ne sont pas validés rétroactivement -- les restrictions s'appliquent uniquement aux postes nouveaux ou modifiés

## Mécanismes de conversion (référence rapide)

### Années passées
Les taux moyens annuels de la Banque Mondiale sont utilisés. Ils sont stables et ne changent pas une fois publiés.

### Année en cours
Le taux spot en temps réel d'ExchangeRate-API est utilisé (repli sur le dernier taux annuel si indisponible). Se rafraîchit lorsque vous lancez la synchronisation des taux ou lors du rafraîchissement automatique de 30 jours.

### Années futures
Réutilise le taux de l'année en cours comme estimation prospective. Cela fournit des indications pour la planification budgétaire mais devrait être revu à mesure que ces années approchent.

**Repli** : Si aucun taux n'est trouvé pour une devise, le système utilise **1,00** jusqu'à ce que des données deviennent disponibles. Cela prévient les erreurs mais peut produire des conversions inexactes -- lancez la synchronisation des taux pour remplir les taux manquants.

## Conseils

  - **Définissez la devise de reporting une fois** : La changer en cours d'année affecte tous les rapports. Si vous devez la changer, faites-le en fin d'année.
  - **Les devises par défaut font gagner du temps** : Définissez-les sur les devises que vos équipes utilisent le plus fréquemment.
  - **Restreignez les devises intentionnellement** : N'utilisez les devises autorisées que si vous avez une raison claire (ex. : couverture des données de change, conformité, standardisation).
  - **Lancez la synchronisation des taux proactivement** : Après avoir ajouté des devises, avant de générer des rapports ou lorsque les taux semblent périmés.
  - **Vérifiez le tableau des instantanés de taux** : Utilisez-le pour vérifier que les taux sont raisonnables et complets avant de finaliser les rapports.
  - **Utilisez des codes ISO cohérents** : Utilisez toujours des codes à 3 lettres (EUR, USD, GBP) -- jamais de symboles (€, $, £) ni de codes numériques.

## Scénarios courants

### Scénario 1 : Changer la devise de reporting
Votre groupe passe d'un reporting basé EUR à un reporting basé USD.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Changez la devise de reporting de `EUR` à `USD`
  3. Cliquez sur **Enregistrer** (déclenche automatiquement un rafraîchissement des taux)
  4. Vérifiez que le tableau des instantanés de taux affiche USD comme base (tous les taux devraient maintenant être relatifs à USD)
  5. Vérifiez les listes OPEX et CAPEX -- les totaux et colonnes annuelles s'affichent maintenant en USD

**Résultat** : Tous les rapports, tableaux de bord et listes affichent USD. Vos données stockées (la propre devise de chaque poste) restent inchangées.

### Scénario 2 : Restreindre les devises pour la conformité
Votre équipe financière exige que toutes les dépenses soient enregistrées en EUR, USD ou GBP uniquement.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Définissez les devises autorisées sur `EUR, USD, GBP`
  3. Cliquez sur **Enregistrer**
  4. Lancez **Forcer la synchronisation des taux** pour vous assurer que les taux sont disponibles pour les trois devises

**Résultat** : Les utilisateurs ne peuvent sélectionner que EUR, USD ou GBP lors de la création ou modification de postes. Les tentatives d'import d'autres devises échoueront avec un message d'erreur clair.

### Scénario 3 : Ajouter une nouvelle devise en cours d'année
Votre entreprise commence des opérations en Suisse et doit suivre les dépenses en CHF.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Ajoutez `CHF` aux devises autorisées (ex. : `EUR, USD, GBP, CHF`)
  3. Cliquez sur **Enregistrer**
  4. Cliquez sur **Forcer la synchronisation des taux** pour récupérer les taux CHF immédiatement
  5. Vérifiez que CHF apparaît dans le tableau des instantanés de taux avec des taux valides

**Résultat** : Les utilisateurs peuvent maintenant sélectionner CHF pour les nouveaux postes. Le tableau des taux inclut CHF avec les taux actuels et historiques pour des conversions précises.

### Scénario 4 : Préparer les cycles budgétaires annuels
Nous sommes en décembre, et vous préparez la planification budgétaire de l'année prochaine.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Cliquez sur **Forcer la synchronisation des taux** pour rafraîchir les taux pour l'année à venir
  3. Vérifiez le tableau des instantanés de taux pour voir les estimations prospectives pour l'année prochaine
  4. Notez que les taux des années futures sont des estimations prospectives (réutilisant le taux de l'année en cours) -- revoyez-les à mesure que l'année approche

**Résultat** : Vos prévisions budgétaires pour l'année prochaine utilisent les derniers taux disponibles. Les équipes peuvent planifier les CAPEX et OPEX avec des hypothèses de change raisonnables.

## Questions fréquentes

**Q : Que se passe-t-il si je change la devise de reporting en cours d'année ?**
R : Tous les rapports et listes sont immédiatement convertis vers la nouvelle devise. Les données historiques restent intactes -- seule la devise d'affichage change. Planifiez ce changement avec soin pour éviter la confusion pendant les périodes de reporting actives.

**Q : Puis-je définir des devises de reporting différentes pour différentes sociétés ?**
R : Non. La devise de reporting est au niveau du tenant. Toutes les sociétés, rapports et totaux utilisent la même devise de reporting. Les postes individuels stockent leur propre devise, mais les conversions ciblent toujours la devise de reporting du tenant.

**Q : Pourquoi je ne vois pas de taux pour une devise spécifique ?**
R : La source de données (Banque Mondiale ou ExchangeRate-API) peut ne pas publier cette devise. Vérifiez que le code ISO est correct et couramment publié. Si nécessaire, limitez les devises autorisées aux codes avec une couverture de données fiable.

**Q : À quelle fréquence les taux de change se rafraîchissent-ils automatiquement ?**
R : Tous les 30 jours, lorsqu'un utilisateur se connecte, le système rafraîchit les taux pour A-1, A et A+1. Vous pouvez aussi déclencher manuellement un rafraîchissement à tout moment via Forcer la synchronisation des taux.

**Q : Les changements de taux affectent-ils mes données stockées ?**
R : Non. Les taux de change n'affectent que la **conversion et l'affichage**. Chaque poste OPEX et CAPEX stocke sa propre devise et ses montants, qui ne changent jamais lors de la mise à jour des taux. Seules les valeurs converties affichées dans les rapports et les listes changent.

**Q : Puis-je importer des taux historiques manuellement ?**
R : Non. Le système récupère les taux automatiquement depuis des sources externes (Banque Mondiale, ExchangeRate-API). Si vous avez besoin de taux personnalisés, contactez le support ou envisagez d'utiliser une devise dont vous pouvez accepter les taux publiés.

**Q : Que faire si j'ai besoin d'une devise qui n'est pas dans la liste autorisée ?**
R : Soit ajoutez-la aux devises autorisées, soit laissez la liste vide (ce qui autorise toutes les devises). N'oubliez pas de lancer la synchronisation des taux après avoir ajouté de nouvelles devises pour remplir les taux.

**Q : Les estimations prospectives pour les années futures sont-elles précises ?**
R : Les estimations prospectives réutilisent le taux de l'année en cours et doivent être traitées comme des **hypothèses de planification**, pas comme des prévisions. Revoyez-les à mesure que les années futures approchent et que les taux deviennent disponibles depuis les sources officielles.
