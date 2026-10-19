# Paramètres de devises

La page Paramètres de devises (**Gestion budgétaire > Administration > Devises**) est l'endroit où vous configurez comment les devises sont stockées, affichées et converties dans votre espace de travail. Elle contrôle la devise de reporting au niveau du tenant, les devises par défaut pour les nouveaux éléments et les restrictions optionnelles sur les devises utilisables.

Pour des informations de fond sur les concepts de devises et les mécanismes de conversion, consultez le guide de gestion des devises.

## Qui peut la consulter et la modifier

Les devises sont un paramètre budgétaire. La page se trouve avec les autres paramètres budgétaires dans l'[Administration budgétaire](budget-operations.md).

- **Ouvrir la page, modifier les paramètres, lancer la synchronisation des taux de change et saisir des taux manuels** : administration budgétaire au niveau administrateur. La carte est masquée pour les autres utilisateurs.
- **Utiliser les devises sur les lignes** : les utilisateurs OPEX et CAPEX choisissent parmi les devises autorisées dans leurs formulaires de ligne, sans ouvrir cette page.

Le droit **Paramètres** de la cartographie SI ne donne pas accès aux devises. Il couvre uniquement les paramètres de la cartographie SI.

## Le formulaire des paramètres de devises

### Devise de reporting
La **devise au niveau du tenant** utilisée pour tous les rapports, totaux et affichages de listes. Lorsque vous changez cette devise :
  - Toutes les colonnes annuelles OPEX et CAPEX sont converties vers la nouvelle devise de reporting
  - Les totaux dans les rapports sont recalculés avec la nouvelle base
  - **Vos données stockées restent inchangées** : seuls l'affichage et la conversion sont affectés

**Exemple** : Si vous passez de EUR à USD, les totaux de votre liste OPEX s'afficheront en USD, mais la devise stockée de chaque ligne (EUR, GBP, etc.) reste la même.

**Conseil** : Choisissez une devise de reporting qui correspond à la norme de reporting financier de votre groupe (ex. : EUR pour un siège européen, USD pour un groupe basé aux États-Unis).

### Devise OPEX par défaut
La devise qui **est pré-remplie** lorsque vous créez une nouvelle ligne OPEX (dépense). Cela ne restreint pas les devises sélectionnables : cela fait simplement gagner du temps en proposant une valeur par défaut judicieuse.

**Exemple** : Si la majeure partie de vos dépenses récurrentes est en EUR, définissez EUR. Les utilisateurs peuvent toujours sélectionner manuellement GBP, USD ou toute autre devise autorisée.

### Devise CAPEX par défaut
La devise qui **est pré-remplie** lorsque vous créez une nouvelle ligne CAPEX. Fonctionne de la même manière que la devise OPEX par défaut, mais pour les dépenses d'investissement.

**Conseil** : Si vos CAPEX sont principalement approvisionnés dans une devise différente des OPEX quotidiens (ex. : USD pour les achats de matériel), définissez une valeur par défaut différente ici.

### Devises autorisées (optionnel)
Une **liste séparée par des virgules** de codes ISO qui restreint les devises que les utilisateurs peuvent sélectionner lors de la création ou modification de lignes OPEX et CAPEX.

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

**Rafraîchissement automatique** : Le système rafraîchit aussi les taux automatiquement tous les 30 jours lorsqu'un utilisateur se connecte (couvre A-1, A, A+1). Quand une liste, un rapport ou la page des contrats a besoin d'un taux absent du snapshot de son année (une devise utilisée depuis, ou une année sans snapshot), le système récupère cette année en arrière-plan dès sa lecture, et l'affichage suivant utilise le nouveau taux. La synchronisation manuelle vous donne le contrôle lorsque vous avez besoin de mises à jour immédiates.

**Devises récupérées** : les devises des lignes budgétaires, des sociétés et des contrats, plus les devises de reporting, par défaut et autorisées.

**Les taux déjà connus sont conservés** : quand une source ne renvoie plus une devise lors d'un rafraîchissement ultérieur, le taux enregistré pour cette année reste en place.

**Années pas encore publiées** : la Banque Mondiale publie la moyenne d'une année quelques mois après sa fin (l'année qui vient de s'achever, en général vers le milieu de l'année). En attendant, une année passée utilise l'année publiée la plus proche, et le tableau marque ce taux comme **estimation**. La valeur réelle la remplace au premier rafraîchissement après publication. L'année en cours utilise le taux en temps réel. Quand il est indisponible, elle utilise la dernière année publiée, également marquée comme estimation.

**Conseil** : Si vous ajoutez une nouvelle devise aux devises autorisées, lancez immédiatement la synchronisation des taux pour remplir les taux avant que les utilisateurs ne commencent à créer des lignes dans cette devise.

## Tableau des instantanés de taux de change

Sous le formulaire de paramètres, le tableau **Derniers instantanés de taux de change** affiche les taux de change les plus récents capturés pour chaque année fiscale, dans la devise de reporting actuelle. Une ligne est la devise de reporting, une devise par défaut, une devise autorisée, ou une devise utilisée par une ligne budgétaire, une société ou un contrat. Une devise pour laquelle un taux manuel est enregistré reste dans le tableau. Les taux enregistrés pour une devise de reporting précédente ne sont pas affichés.

**Colonnes** :
  - **Devise** : Le code ISO à 3 lettres
  - **Colonnes d'années fiscales** : Une colonne par année avec des données (ex. : 2023, 2024, 2025)
  - **Valeurs de taux** : Taux de change vers votre devise de reporting (précision à 6 décimales)
  - **Libellé de source** : Affiche la source de données pour chaque année :
      - **Moy. annuelle** : Moyenne annuelle Banque Mondiale (années historiques)
      - **Moy. trimestrielle** : Moyenne trimestrielle Banque Mondiale (si disponible)
      - **Spot en temps réel** : Taux spot actuel d'ExchangeRate-API (année en cours)
      - **Estimation prospective** : Taux de l'année en cours réutilisé pour les années futures
  - **Marques dans les cellules** : un astérisque (*) après un taux saisi à la main, expliqué par la note **Taux saisi manuellement** sous le tableau (affichée seulement quand le tableau contient un tel taux) ; **estimation** à côté d'un taux pris sur l'année publiée la plus proche (survolez la marque pour en voir la raison)
  - **Taux manquant** : une paire sans taux affiche `—` dans la couleur d'avertissement

**Exemple** :
Si votre devise de reporting est EUR :

| Devise | 2024 (Moy. annuelle) | 2025 (Spot en temps réel) | 2026 (Estimation prospective) |
|--------|----------------------|---------------------------|-------------------------------|
| USD    | 0,925820             | 0,931200                  | 0,931200                      |
| GBP    | 1,175300             | 1,182000                  | 1,182000                      |
| CHF    | 0,962100             | 0,965500                  | 0,965500                      |

**Lire le tableau** :
  - Les taux indiquent combien d'unités de votre devise de reporting équivalent à 1 unité de la devise listée
  - Si un taux affiche `—`, aucune donnée n'est disponible. Les montants des lignes budgétaires dans cette devise sont exclus des totaux pour cette année (voir [Mécanismes de conversion](#mecanismes-de-conversion-reference-rapide))
  - Les taux sont capturés au moment de la synchronisation et restent stables jusqu'au prochain rafraîchissement

**Conseil** : Si vous voyez des taux manquants (`—`), vérifiez que le code devise est valide et couramment publié. Envisagez de limiter les devises autorisées pour éviter les codes exotiques sans données. Vous pouvez aussi saisir le taux vous-même (voir [Taux manuels](#taux-manuels)).

### Taux manquants

Au-dessus du tableau, un bloc liste chaque devise et année utilisée qui n'a pas de taux, sous un titre comme **2 taux de change manquants**. Chaque ligne indique qu'aucune source ne publie encore ce taux : les montants dans cette devise sont exclus des totaux tant qu'elle n'en a pas un. Quand rien ne manque, le bloc affiche **Chaque devise utilisée a un taux.**

Une paire est considérée comme utilisée quand une ligne budgétaire, les chiffres d'une société ou un contrat en ont besoin. L'ouverture de la page interroge aussi de nouveau les sources pour les années de la liste.

### Taux manuels

Quand aucune source ne publie un taux, ou quand votre équipe finance utilise ses propres taux, vous pouvez saisir un taux pour une devise et une année.

  1. Cliquez sur la cellule de la devise et de l'année dans le tableau, ou cliquez sur **Saisir un taux** à côté d'une ligne du bloc des taux manquants.
  2. Dans la boîte de dialogue **Taux de change manuel**, saisissez le taux dans votre devise de reporting pour 1 unité de la devise choisie (par exemple **Taux en EUR pour 1 USD**). Utilisez le séparateur décimal de votre langue. Une bonne source est le taux moyen de l'année publié par votre banque centrale ou votre trésorerie.
  3. Cliquez sur **Enregistrer**. La cellule affiche alors le taux suivi d'un astérisque (*).

Un taux manuel remplace le taux automatique pour cette année jusqu'à ce que vous le retiriez. Les rafraîchissements suivants ne l'écrasent pas. Pour revenir au taux automatique, ouvrez la cellule et cliquez sur **Retirer le taux manuel** : le taux automatique sera de nouveau récupéré.

Bon à savoir :
  - Seuls les utilisateurs de l'administration budgétaire au niveau administrateur peuvent saisir, modifier ou retirer un taux manuel.
  - Chaque saisie, modification et suppression est enregistrée dans le journal d'audit.
  - Une année gelée conserve les taux capturés lors du gel, taux manuels et estimations compris (voir [Années gelées](#annees-gelees)).
  - Un taux manuel est saisi par rapport à la devise de reporting actuelle. Après un changement de devise de reporting, les taux manuels saisis pour l'ancienne ne s'appliquent plus.
  - La devise de reporting a toujours un taux de 1 et ne prend pas de taux manuel.

## Import et export CSV

### Export
Les exports OPEX et CAPEX incluent les données des lignes et les montants annuels dans la **propre devise de chaque ligne**, pas la devise de reporting. Cela préserve les données originales pour la réimportation ou l'analyse externe.

**Exemple de ligne CSV** (OPEX) :
```
Item Name;Company;Account;Currency;Y-1;Y;Y+1;Y+2
SaaS License;Acme UK;6200;GBP;10000;12000;12000;12000
```

### Import
Lors de l'import de lignes OPEX ou CAPEX, la colonne `Currency` doit contenir des **codes ISO standard à 3 lettres**.

**Validation** :
  - Si des **devises autorisées** sont configurées, les imports utilisant des codes non listés sont rejetés
  - La réponse d'erreur inclut la liste `allowedCurrencies` pour clarification
  - La devise de reporting et les devises par défaut sont toujours acceptées

**Exemple** :
Si Devises autorisées = `EUR, USD, GBP` et vous importez une ligne avec `Currency=CHF`, l'import échoue avec :
```
Currency "CHF" is not allowed. Allowed currencies: EUR, USD, GBP
```

**Conseil** : Exportez un modèle, vérifiez la liste des devises autorisées et assurez-vous que votre fichier d'import n'utilise que ces codes.

## Statut et données historiques

Lorsque vous changez les paramètres :
  - **Devise de reporting** : Affecte l'affichage immédiatement ; les montants enregistrés ne changent pas, et chaque année est convertie dans la nouvelle devise avec les taux décrits dans [Mécanismes de conversion](#mecanismes-de-conversion-reference-rapide)
  - **Devises par défaut** : N'affectent que les nouvelles lignes ; les lignes existantes conservent leurs devises
  - **Devises autorisées** : Les lignes existantes ne sont pas validées rétroactivement : les restrictions s'appliquent uniquement aux lignes nouvelles ou modifiées

## Mécanismes de conversion (référence rapide)

Les montants sont enregistrés dans leur propre devise et convertis à l'affichage. Chaque année utilise les derniers taux capturés pour cette année, quelle que soit la date de saisie des montants. Quand une synchronisation capture de nouveaux taux pour une année, les montants de cette année sont désormais convertis avec eux, sauf si l'année est gelée (voir [Années gelées](#annees-gelees)).

### Années passées
Les taux moyens annuels de la Banque Mondiale sont utilisés. Ils sont stables et ne changent pas une fois publiés. Tant que la Banque Mondiale n'a pas publié une année, l'année publiée la plus proche la remplace, marquée comme estimation.

### Année en cours
Le taux spot en temps réel d'ExchangeRate-API est utilisé (repli sur le dernier taux annuel, marqué comme estimation, si indisponible). Se rafraîchit lorsque vous lancez la synchronisation des taux ou lors du rafraîchissement automatique de 30 jours.

### Années futures
Réutilise le taux de l'année en cours comme estimation prospective. Cela fournit des indications pour la planification budgétaire mais devrait être revu à mesure que ces années approchent.

### Années gelées
Geler la colonne budgétaire par défaut d'une année fige les taux de cette année pour le type gelé (OPEX ou CAPEX) : KANAP rafraîchit les taux de l'année, puis conserve ce jeu pour tous les montants de l'année, même quand de nouveaux taux arrivent. Dégeler la colonne par défaut les libère. Voir [Geler la colonne par défaut fige les taux de change](budget-operations.md#geler-la-colonne-par-defaut-fige-les-taux-de-change).

**Taux manquant** : Quand une année n'a pas de taux pour une devise utilisée, les montants des lignes budgétaires dans cette devise sont exclus de tous les totaux en devise de reporting pour cette année. Cela concerne la liste des lignes budgétaires, la vue d'ensemble de la gestion budgétaire, les rapports budgétaires et de refacturation, les contrats et les onglets Relations des applications et des technologies. L'écran le signale là où cela compte :

- Un avertissement d'une ligne indique ce qui est exclu, par exemple « 3 lignes sans taux de change exclues : USD 2026. » Il s'affiche sous les totaux de la liste des lignes budgétaires, sur les tuiles de la vue d'ensemble, en haut de chaque rapport budgétaire et de refacturation, et sous les chiffres budgétaires des contrats, des applications et des technologies. Les utilisateurs de l'administration budgétaire au niveau administrateur voient aussi **Saisir un taux**, qui ouvre cette page.
- Sur la ligne elle-même, le montant s'affiche dans sa propre devise avec une petite marque orange. Survolez la marque pour lire, par exemple, « Pas de taux de change USD pour 2026 : exclu des totaux. »

KANAP récupère les taux de cette année en arrière-plan (au plus une fois toutes les six heures par année) : l'affichage suivant utilise le nouveau taux dès que la source le publie. Pour repérer les taux manquants, consultez le bloc des taux manquants au-dessus du tableau des instantanés de taux de change, et lancez la synchronisation des taux pour les récupérer tout de suite. Saisir un [taux manuel](#taux-manuels) corrige le problème immédiatement.

## Conseils

  - **Définissez la devise de reporting une fois** : La changer en cours d'année affecte tous les rapports. Si vous devez la changer, faites-le en fin d'année.
  - **Les devises par défaut font gagner du temps** : Définissez-les sur les devises que vos équipes utilisent le plus fréquemment.
  - **Restreignez les devises intentionnellement** : N'utilisez les devises autorisées que si vous avez une raison claire (ex. : couverture des données de change, conformité, standardisation).
  - **Lancez la synchronisation des taux proactivement** : Après avoir ajouté des devises, avant de générer des rapports ou lorsque les taux semblent périmés.
  - **Vérifiez le tableau des instantanés de taux** : Utilisez-le pour vérifier que les taux sont raisonnables et complets avant de finaliser les rapports.
  - **Utilisez des codes ISO cohérents** : Utilisez toujours des codes à 3 lettres (EUR, USD, GBP), jamais de symboles (€, $, £) ni de codes numériques.

## Scénarios courants

### Scénario 1 : Changer la devise de reporting
Votre groupe passe d'un reporting basé EUR à un reporting basé USD.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Changez la devise de reporting de `EUR` à `USD`
  3. Cliquez sur **Enregistrer** (déclenche automatiquement un rafraîchissement des taux)
  4. Vérifiez que le tableau des instantanés de taux affiche USD comme base (tous les taux devraient maintenant être relatifs à USD)
  5. Vérifiez les listes OPEX et CAPEX : les totaux et colonnes annuelles s'affichent maintenant en USD

**Résultat** : Tous les rapports, tableaux de bord et listes affichent USD. Vos données stockées (la propre devise de chaque ligne) restent inchangées.

### Scénario 2 : Restreindre les devises pour la conformité
Votre équipe financière exige que toutes les dépenses soient enregistrées en EUR, USD ou GBP uniquement.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Définissez les devises autorisées sur `EUR, USD, GBP`
  3. Cliquez sur **Enregistrer**
  4. Lancez **Forcer la synchronisation des taux** pour vous assurer que les taux sont disponibles pour les trois devises

**Résultat** : Les utilisateurs ne peuvent sélectionner que EUR, USD ou GBP lors de la création ou modification de lignes. Les tentatives d'import d'autres devises échoueront avec un message d'erreur clair.

### Scénario 3 : Ajouter une nouvelle devise en cours d'année
Votre entreprise commence des opérations en Suisse et doit suivre les dépenses en CHF.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Ajoutez `CHF` aux devises autorisées (ex. : `EUR, USD, GBP, CHF`)
  3. Cliquez sur **Enregistrer**
  4. Cliquez sur **Forcer la synchronisation des taux** pour récupérer les taux CHF immédiatement
  5. Vérifiez que CHF apparaît dans le tableau des instantanés de taux avec des taux valides

**Résultat** : Les utilisateurs peuvent maintenant sélectionner CHF pour les nouvelles lignes. Le tableau des taux inclut CHF avec les taux actuels et historiques pour des conversions précises.

### Scénario 4 : Préparer les cycles budgétaires annuels
Nous sommes en décembre, et vous préparez la planification budgétaire de l'année prochaine.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Cliquez sur **Forcer la synchronisation des taux** pour rafraîchir les taux pour l'année à venir
  3. Vérifiez le tableau des instantanés de taux pour voir les estimations prospectives pour l'année prochaine
  4. Notez que les taux des années futures sont des estimations prospectives (réutilisant le taux de l'année en cours) ; revoyez-les à mesure que l'année approche

**Résultat** : Vos prévisions budgétaires pour l'année prochaine utilisent les derniers taux disponibles. Les équipes peuvent planifier les CAPEX et OPEX avec des hypothèses de change raisonnables.

## Questions fréquentes

**Q : Que se passe-t-il si je change la devise de reporting en cours d'année ?**
R : Tous les rapports et listes sont immédiatement convertis vers la nouvelle devise. Les données historiques restent intactes : seule la devise d'affichage change. Planifiez ce changement avec soin pour éviter la confusion pendant les périodes de reporting actives.

**Q : Puis-je définir des devises de reporting différentes pour différentes sociétés ?**
R : Non. La devise de reporting est au niveau du tenant. Toutes les sociétés, rapports et totaux utilisent la même devise de reporting. Les lignes individuelles stockent leur propre devise, mais les conversions ciblent toujours la devise de reporting du tenant.

**Q : Pourquoi je ne vois pas de taux pour une devise spécifique ?**
R : La source de données (Banque Mondiale ou ExchangeRate-API) peut ne pas publier cette devise. Vérifiez que le code ISO est correct et couramment publié. Si nécessaire, limitez les devises autorisées aux codes avec une couverture de données fiable.

**Q : À quelle fréquence les taux de change se rafraîchissent-ils automatiquement ?**
R : Tous les 30 jours, lorsqu'un utilisateur se connecte, le système rafraîchit les taux pour A-1, A et A+1. Une année à laquelle manque le taux d'une devise utilisée est aussi récupérée dès qu'une liste, un rapport ou la page des contrats en a besoin, et quand vous ouvrez cette page. Vous pouvez aussi déclencher manuellement un rafraîchissement à tout moment via Forcer la synchronisation des taux.

**Q : Les changements de taux affectent-ils mes données stockées ?**
R : Non. Les taux de change n'affectent que la **conversion et l'affichage**. Chaque ligne OPEX et CAPEX stocke sa propre devise et ses montants, qui ne changent jamais lors de la mise à jour des taux. Seules les valeurs converties affichées dans les rapports et les listes changent.

**Q : Puis-je importer des taux historiques manuellement ?**
R : L'import de taux depuis un fichier n'est pas disponible. Vous pouvez saisir un taux manuel pour chaque devise et chaque année sur cette page (voir [Taux manuels](#taux-manuels)). Un taux manuel remplace le taux automatique jusqu'à ce que vous le retiriez.

**Q : Que faire si j'ai besoin d'une devise qui n'est pas dans la liste autorisée ?**
R : Soit ajoutez-la aux devises autorisées, soit laissez la liste vide (ce qui autorise toutes les devises). N'oubliez pas de lancer la synchronisation des taux après avoir ajouté de nouvelles devises pour remplir les taux.

**Q : Les estimations prospectives pour les années futures sont-elles précises ?**
R : Les estimations prospectives réutilisent le taux de l'année en cours et doivent être traitées comme des **hypothèses de planification**, pas comme des prévisions. Revoyez-les à mesure que les années futures approchent et que les taux deviennent disponibles depuis les sources officielles.
