# Paramètres de devises

La page des paramètres de devises (**Gestion budgétaire > Administration > Devises**) règle la manière dont KANAP enregistre, affiche et convertit les devises. Elle fixe la devise de reporting de tout l'espace de travail, les devises proposées par défaut sur les nouvelles lignes et, si besoin, la liste des devises autorisées.

Pour le fonctionnement détaillé des devises et des conversions, consultez le guide de gestion des devises.

## Qui peut la consulter et la modifier

Les devises sont un paramètre budgétaire. La page se trouve avec les autres paramètres budgétaires dans l'[Administration budgétaire](budget-operations.md).

- **Ouvrir la page, modifier les paramètres, lancer la synchronisation des taux de change et saisir des taux manuels** : administration budgétaire au niveau administrateur. La carte est masquée pour les autres utilisateurs.
- **Utiliser les devises sur les lignes** : les utilisateurs OPEX et CAPEX choisissent parmi les devises autorisées dans leurs formulaires de ligne, sans ouvrir cette page.

Le droit **Paramètres** de la cartographie SI ne donne pas accès aux devises. Il couvre uniquement les paramètres de la cartographie SI.

## Le formulaire des paramètres de devises

### Devise de reporting
La devise de **tout l'espace de travail**, dans laquelle s'affichent les rapports, les totaux et les listes. Quand vous la changez :
  - Toutes les colonnes annuelles OPEX et CAPEX sont converties dans la nouvelle devise de reporting
  - Les totaux des rapports sont recalculés dans cette devise
  - **Les montants enregistrés ne changent pas** : seuls l'affichage et la conversion évoluent

**Exemple** : si vous passez de EUR à USD, les totaux de la liste OPEX s'affichent en USD, mais chaque ligne garde sa propre devise (EUR, GBP, etc.).

**Conseil** : retenez la devise de la consolidation financière de votre groupe (par exemple EUR pour un siège européen, USD pour un groupe américain).

### Devise OPEX par défaut
La devise **proposée** à la création d'une ligne OPEX. Elle ne limite pas le choix : elle évite seulement de la ressaisir.

**Exemple** : si l'essentiel de vos dépenses récurrentes est en EUR, choisissez EUR. Les utilisateurs peuvent toujours sélectionner GBP, USD ou toute autre devise autorisée.

### Devise CAPEX par défaut
La devise **proposée** à la création d'une ligne CAPEX. Elle fonctionne comme la devise OPEX par défaut, pour les investissements.

**Conseil** : si vos investissements sont surtout achetés dans une autre devise que vos dépenses courantes (par exemple du matériel acheté en USD), choisissez ici une autre devise.

### Devises autorisées (facultatif)
Une **liste de codes ISO séparés par des virgules** qui limite les devises proposées à la création ou à la modification des lignes OPEX et CAPEX.

  - **Vide (par défaut)** : tout code ISO à 3 lettres valide peut être choisi
  - **Liste renseignée** (par exemple `EUR, USD, GBP`) : seules ces devises apparaissent dans les listes déroulantes
  - **La devise de reporting est toujours autorisée**, même absente de la liste
  - **Les devises par défaut sont toujours autorisées** : les devises OPEX et CAPEX par défaut restent disponibles

**Pourquoi la renseigner ?**
Limiter les devises autorisées est utile quand :
  - vos sources de taux de change ne couvrent pas certaines devises peu courantes
  - vous voulez harmoniser les pratiques entre équipes
  - vous voulez éviter les codes mal saisis ou périmés

**Conseil** : laissez ce champ vide sauf raison précise. Si vous le renseignez, incluez toutes les devises réellement utilisées par vos équipes (par exemple `EUR, USD, GBP, CHF, PLN`).

## Enregistrer les modifications

Cliquez sur **Enregistrer** pour appliquer vos modifications. KANAP :
  1. Vérifie que chaque devise est un code ISO à 3 lettres
  2. Enregistre les paramètres de l'espace de travail
  3. Met à jour les taux de l'année en cours. Un changement de devise de reporting met à jour toutes les années utilisées (voir [Changer de devise de reporting](#changer-de-devise-de-reporting))
  4. Affiche un message de confirmation

Cliquez sur **Réinitialiser** pour abandonner les modifications non enregistrées et revenir aux dernières valeurs enregistrées.

**Important** : un changement de devise de reporting s'applique aussitôt à toutes les listes et à tous les rapports. Choisissez un moment où personne ne prépare de restitution.

### Changer de devise de reporting

Quand vous enregistrez une nouvelle devise de reporting, une fenêtre de confirmation s'ouvre d'abord, par exemple **Changer la devise de reporting en USD ?**. Elle indique ce que le changement entraîne :

  - Chaque montant est converti dans la nouvelle devise au taux de son année. Les taux sont récupérés pour les années utilisées.
  - Les taux manuels saisis pour la devise de reporting actuelle ne s'appliquent plus. La fenêtre les liste par devise, année et taux. Ils s'appliquent de nouveau si vous revenez plus tard à la devise actuelle.
  - Pour chaque année qui a des versions budgétaires gelées : ces versions gardent les taux de leur gel, convertis dans la nouvelle devise au taux de l'année (voir [Années gelées](#annees-gelees)).
  - La nouvelle devise sera ajoutée aux devises autorisées, si la liste ne la contient pas encore.

Les trois derniers points n'apparaissent que s'ils s'appliquent. Cliquez sur **Changer la devise** pour enregistrer, ou sur **Annuler** pour garder les paramètres actuels.

KANAP récupère ensuite les taux de la nouvelle devise pour toutes les années utilisées : les années budgétaires (années gelées comprises), les années où une société a un chiffre d'affaires, les années affichées sur la page des contrats, ainsi que l'année civile en cours, la précédente et la suivante. La page attend le résultat et l'affiche comme pour une [synchronisation forcée](#forcer-la-synchronisation-des-taux-de-change).

## Forcer la synchronisation des taux de change

Le bouton **Forcer la synchronisation des taux de change** récupère tout de suite les taux de l'année civile en cours, de la précédente et de la suivante, de chaque année du bloc des taux manquants, et de chaque année qui a déjà des montants budgétaires.

**Quand l'utiliser** :
  - après avoir ajouté des devises autorisées
  - quand vous avez besoin du taux du jour pour l'année en cours
  - si vous pensez que des taux sont anciens ou manquants
  - avant de présenter des rapports à la direction

**Ce qui se passe** :
  - Le bouton reste occupé pendant que KANAP récupère les taux, 20 secondes au plus
  - Un message au-dessus du tableau donne ensuite le résultat : le nombre de taux récupérés, par exemple **12 taux récupérés.**, suivi des paires toujours sans taux, par exemple **Toujours manquants : BRL 2026.**, ou de **Chaque devise utilisée a un taux.**
  - Lorsque la récupération n'apporte aucun taux nouveau et que chaque devise utilisée a déjà un taux, le message dit **Les taux de change sont à jour.** Lorsque des paires manquent encore, il dit **Aucun nouveau taux n'a été récupéré.** et les nomme.
  - Si les sources n'ont pas répondu, le message le signale, et les taux déjà enregistrés restent en place
  - Si la récupération dure plus longtemps, le message indique **La synchronisation continue en arrière-plan.** Le tableau et le bloc des taux manquants se mettent à jour quand elle se termine
  - Si une mise à jour des taux est déjà en cours, KANAP lui ajoute vos années : aucune demande n'est perdue

**Mise à jour automatique** : KANAP met aussi à jour les taux tous les 30 jours, à la connexion d'un utilisateur (années A-1, A et A+1). Quand une liste, un rapport ou la page des contrats a besoin d'un taux que la capture de son année ne contient pas (une devise utilisée depuis, ou une année sans capture), KANAP récupère cette année en arrière-plan dès la lecture, et l'affichage suivant utilise le nouveau taux. La synchronisation forcée sert quand vous voulez le résultat tout de suite.

**Devises récupérées** : celles des lignes budgétaires, des sociétés et des contrats, plus la devise de reporting, les devises par défaut et les devises autorisées.

**Les taux déjà connus sont conservés** : quand une source ne renvoie plus une devise lors d'une mise à jour ultérieure, le taux enregistré pour cette année reste en place.

**Années pas encore publiées** : la Banque mondiale publie la moyenne d'une année quelques mois après sa fin (vers le milieu de l'année suivante, en général). En attendant, une année passée reprend l'année publiée la plus proche, et le tableau marque ce taux comme **estimation**. La valeur réelle la remplace à la première mise à jour qui suit sa publication. L'année en cours utilise le taux du jour. Quand il n'est pas disponible, elle reprend la dernière année publiée, marquée elle aussi comme estimation.

**Conseil** : quand vous ajoutez une devise autorisée, lancez aussitôt **Forcer la synchronisation des taux de change**, pour que les taux existent avant les premières lignes dans cette devise.

## Tableau des taux de change

Sous le formulaire, le tableau **Dernières captures de taux de change** affiche, pour chaque exercice, les derniers taux enregistrés dans la devise de reporting actuelle. La devise de reporting vient en premier, puis les autres devises par ordre alphabétique. Chaque ligne est une devise utilisée : une devise par défaut, une devise autorisée, ou la devise d'une ligne budgétaire, d'une société ou d'un contrat. Une devise qui a un taux manuel reste dans le tableau même si elle n'est plus utilisée. Après un changement de devise de reporting, l'ancienne devise apparaît aussi pour les années des versions gelées, puisque leur conversion passe par elle. Les taux enregistrés pour une ancienne devise de reporting ne sont pas affichés.

**Colonnes** :
  - **Devise** : le code ISO à 3 lettres
  - **Colonnes des exercices** : une colonne par année qui a des taux (par exemple 2023, 2024, 2025)
  - **Taux** : le taux vers votre devise de reporting, au format de nombre de votre langue, avec 6 décimales au plus et sans zéros inutiles
  - **Source** : l'origine des taux de chaque année :
      - **Moyenne annuelle** : moyenne annuelle de la Banque mondiale (années passées)
      - **Moyenne trimestrielle** : moyenne trimestrielle de la Banque mondiale (si disponible)
      - **Spot en temps réel** : taux du jour fourni par ExchangeRate-API (année en cours)
      - **Estimation à terme** : taux de l'année en cours repris pour les années futures
  - **Marques dans les cellules** : un astérisque (*) après un taux saisi à la main, expliqué par la note **Taux saisi manuellement** sous le tableau (affichée seulement si le tableau contient un tel taux) ; **estimation** à côté d'un taux repris de l'année publiée la plus proche (survolez la marque pour en lire la raison)
  - **Taux manquant** : une paire sans taux affiche `—` dans la couleur d'avertissement

**Exemple** avec EUR comme devise de reporting :

| Devise | 2024 (Moyenne annuelle) | 2025 (Spot en temps réel) | 2026 (Estimation à terme) |
|--------|-------------------------|---------------------------|---------------------------|
| EUR    | 1                       | 1                         | 1                         |
| CHF    | 0,9621                  | 0,9655                    | 0,9655                    |
| GBP    | 1,1753                  | 1,182                     | 1,182                     |
| USD    | 0,92582                 | 0,9312                    | 0,9312                    |

**Lire le tableau** :
  - Un taux indique combien d'unités de votre devise de reporting vaut 1 unité de la devise de la ligne
  - Un taux affiché `—` n'est pas disponible. Les montants des lignes budgétaires dans cette devise sont alors exclus des totaux de cette année (voir [Mécanismes de conversion](#mecanismes-de-conversion-reference-rapide))
  - Les taux sont enregistrés à la synchronisation et ne bougent plus jusqu'à la mise à jour suivante

**Conseil** : devant un taux manquant (`—`), vérifiez que le code de la devise est valide et couramment publié. Limiter les devises autorisées évite les devises sans données. Vous pouvez aussi saisir le taux vous-même (voir [Taux manuels](#taux-manuels)).

### Taux manquants

Au-dessus du tableau, un bloc liste chaque devise et chaque année utilisées qui n'ont pas de taux, sous un titre comme **2 taux de change manquants**. Chaque ligne précise qu'aucune source ne publie encore ce taux et que les montants dans cette devise sont exclus des totaux tant qu'il manque. Quand rien ne manque, le bloc affiche **Chaque devise utilisée a un taux.**

Une paire devise et année est utilisée quand une ligne budgétaire, les chiffres d'une société ou un contrat en ont besoin. Pour un contrat, ce sont les années affichées sur la page des contrats (l'année en cours, les deux suivantes, et l'année précédente quand le budget a des lignes pour elle) pendant lesquelles le contrat court. La page des contrats et ce bloc signalent donc les mêmes années manquantes. À l'ouverture de la page, KANAP interroge aussi de nouveau les sources pour les années de la liste.

### Taux manuels

Quand aucune source ne publie un taux, ou quand votre direction financière applique ses propres taux, vous pouvez saisir un taux pour une devise et une année.

  1. Cliquez sur la cellule de la devise et de l'année dans le tableau, ou sur **Saisir un taux** à côté d'une ligne du bloc des taux manquants. Le lien **Saisir un taux** d'un avertissement ailleurs dans KANAP mène aussi ici : il ouvre directement la fenêtre de saisie quand l'avertissement ne cite qu'une devise et une année, et sinon met en évidence le bloc des taux manquants quelques secondes.
  2. Dans la fenêtre **Taux de change manuel**, saisissez le taux dans votre devise de reporting pour 1 unité de la devise choisie (par exemple **Taux en EUR pour 1 USD**), avec le séparateur décimal de votre langue. Quand l'année précédente ou suivante a un taux automatique, le champ le rappelle comme repère, par exemple **Taux automatique 2025 : 0,9312**. Sinon, il suggère le taux moyen de l'année publié par votre banque centrale ou votre trésorerie.
  3. Cliquez sur **Enregistrer**. La cellule affiche alors le taux suivi d'un astérisque (*).

La fenêtre contrôle la valeur avant l'enregistrement : le taux est obligatoire, doit être un nombre supérieur à 0, ne peut pas dépasser 1 000 000 000 et ne doit pas valoir 0 une fois arrondi à 6 décimales. Le message sous le champ indique la règle en cause.

Un taux manuel remplace le taux automatique de cette année jusqu'à ce que vous le retiriez. Les mises à jour suivantes ne l'écrasent pas. Pour revenir au taux automatique, ouvrez la cellule et cliquez sur **Retirer le taux manuel** : KANAP récupère de nouveau le taux automatique.

Quand l'année a des versions budgétaires gelées, un taux manuel saisi ou retiré ne les atteint pas, et la page le signale, par exemple **Les 2 versions gelées de 2026 gardent le taux de leur gel.**

Bon à savoir :
  - Seuls les utilisateurs de l'administration budgétaire au niveau administrateur peuvent saisir, modifier ou retirer un taux manuel.
  - Chaque saisie, modification et suppression est enregistrée dans le journal d'audit.
  - Une année gelée garde les taux enregistrés au moment du gel, taux manuels et estimations compris (voir [Années gelées](#annees-gelees)).
  - Un taux manuel est saisi par rapport à la devise de reporting actuelle. Après un changement de devise de reporting, les taux manuels saisis pour l'ancienne ne s'appliquent plus. Ils s'appliquent de nouveau si vous revenez à cette devise de reporting.
  - La devise de reporting a toujours un taux de 1 et ne prend pas de taux manuel.

## Import et export CSV

### Export
Les exports OPEX et CAPEX contiennent les lignes et leurs montants annuels dans la **devise propre à chaque ligne**, et non dans la devise de reporting. Le fichier peut ainsi être réimporté ou analysé tel quel.

**Exemple de ligne CSV** (OPEX) :
```
Item Name;Company;Account;Currency;Y-1;Y;Y+1;Y+2
SaaS License;Acme UK;6200;GBP;10000;12000;12000;12000
```

### Import
À l'import de lignes OPEX ou CAPEX, la colonne `Currency` doit contenir des **codes ISO à 3 lettres**.

**Contrôles** :
  - Si des **devises autorisées** sont définies, une ligne dans une devise absente de la liste est refusée
  - Le message d'erreur rappelle la liste `allowedCurrencies`
  - La devise de reporting et les devises par défaut sont toujours acceptées

**Exemple** :
avec les devises autorisées `EUR, USD, GBP`, l'import d'une ligne en `Currency=CHF` échoue avec :
```
Currency "CHF" is not allowed. Allowed currencies: EUR, USD, GBP
```

**Conseil** : exportez un modèle, vérifiez la liste des devises autorisées et n'utilisez que ces codes dans votre fichier.

## Statut et données historiques

Quand vous changez les paramètres :
  - **Devise de reporting** : s'applique aussitôt à l'affichage ; les montants enregistrés ne changent pas, et chaque année est convertie dans la nouvelle devise avec les taux décrits dans [Mécanismes de conversion](#mecanismes-de-conversion-reference-rapide)
  - **Devises par défaut** : ne concernent que les nouvelles lignes ; les lignes existantes gardent leur devise
  - **Devises autorisées** : les lignes existantes ne sont pas contrôlées après coup ; la restriction s'applique aux lignes créées ou modifiées

## Mécanismes de conversion (référence rapide)

Les montants sont enregistrés dans leur propre devise et convertis à l'affichage. Chaque année utilise les derniers taux enregistrés pour elle, quelle que soit la date de saisie des montants. Quand une synchronisation apporte de nouveaux taux pour une année, les montants de cette année sont désormais convertis avec eux, sauf si l'année est gelée (voir [Années gelées](#annees-gelees)).

### Années passées
KANAP utilise les moyennes annuelles de la Banque mondiale. Elles ne changent plus une fois publiées. Tant que la Banque mondiale n'a pas publié une année, l'année publiée la plus proche la remplace, marquée comme estimation.

### Année en cours
KANAP utilise le taux du jour d'ExchangeRate-API (à défaut, le dernier taux annuel, marqué comme estimation). Il se met à jour quand vous lancez **Forcer la synchronisation des taux de change** et lors de la mise à jour automatique tous les 30 jours.

### Années futures
Le taux de l'année en cours est repris comme estimation. Il sert de repère pour préparer le budget, à revoir à l'approche de ces années.

### Années gelées
Geler la colonne budgétaire par défaut d'une année fige les taux de cette année pour le type gelé (OPEX ou CAPEX) : KANAP met à jour les taux de l'année, puis garde ce jeu de taux pour tous les montants de l'année, même quand des taux plus récents arrivent. Si la devise de reporting change ensuite, ces montants gardent les taux du gel, puis sont convertis dans la nouvelle devise de reporting au taux de l'ancienne pour la même année. Sans ce taux, ils sont exclus des totaux et signalés comme tout taux manquant : l'ancienne devise de reporting apparaît alors pour cette année dans le bloc des taux manquants, et un taux manuel la complète. Dégeler la colonne par défaut libère les taux. Voir [Geler la colonne par défaut fige les taux de change](budget-operations.md#geler-la-colonne-par-defaut-fige-les-taux-de-change).

**Taux manquant** : quand une année n'a pas de taux pour une devise utilisée, les montants des lignes budgétaires dans cette devise sont exclus de tous les totaux en devise de reporting de cette année. Cela vaut pour la liste des lignes budgétaires, la vue d'ensemble de la gestion budgétaire, les rapports budgétaires et de refacturation, les contrats et les onglets Relations des applications et des technologies. L'écran le signale là où c'est utile :

- Un avertissement d'une ligne indique ce qui est exclu, par exemple « 3 lignes sans taux de change exclues : USD 2026. » Il s'affiche sous les totaux de la liste des lignes budgétaires, sur les tuiles de la vue d'ensemble, en haut de chaque rapport budgétaire et de refacturation, et sous les chiffres budgétaires des contrats, des applications et des technologies. Les utilisateurs de l'administration budgétaire au niveau administrateur voient aussi **Saisir un taux**, qui ouvre cette page sur le taux manquant.
- Sur la ligne elle-même, le montant s'affiche dans sa propre devise avec une petite marque orange. Survolez la marque pour lire, par exemple, « Pas de taux de change USD pour 2026 : exclu des totaux. »

KANAP récupère les taux de cette année en arrière-plan (au plus une fois toutes les six heures par année) : l'affichage suivant utilise le nouveau taux dès que la source le publie. Pour repérer les taux manquants, consultez le bloc des taux manquants au-dessus du tableau des taux, et lancez **Forcer la synchronisation des taux de change** pour les récupérer tout de suite. Saisir un [taux manuel](#taux-manuels) règle le problème immédiatement.

## Demander à l'assistant

[Plaid](ai-assistant.md#tool-calls) lit les devises et les taux de cette page pour toute personne qui a le droit de lecture sur le budget. Demandez par exemple : « Quel est le taux USD pour 2026 ? »

## Conseils

  - **Fixez la devise de reporting une fois pour toutes** : la changer en cours d'année modifie tous les rapports. Si vous devez la changer, faites-le en fin d'exercice.
  - **Les devises par défaut font gagner du temps** : choisissez celles que vos équipes utilisent le plus.
  - **Ne limitez les devises qu'à bon escient** : renseignez les devises autorisées seulement pour une raison claire (couverture des taux, conformité, harmonisation).
  - **Synchronisez les taux par avance** : après l'ajout de devises, avant de présenter des rapports, ou quand des taux semblent anciens.
  - **Contrôlez le tableau des taux** : vérifiez que les taux sont plausibles et complets avant de finaliser les rapports.
  - **Utilisez les codes ISO** : toujours les codes à 3 lettres (EUR, USD, GBP), jamais les symboles (€, $, £) ni les codes numériques.

## Scénarios courants

### Scénario 1 : Changer la devise de reporting
Votre groupe passe d'une consolidation en EUR à une consolidation en USD.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Remplacez la devise de reporting `EUR` par `USD`
  3. Cliquez sur **Enregistrer**, lisez la fenêtre de confirmation (taux manuels qui ne s'appliquent plus, versions gelées), puis cliquez sur **Changer la devise**
  4. Lisez le résultat de la récupération des taux. Pour chaque paire encore manquante, saisissez un taux manuel ou relancez plus tard **Forcer la synchronisation des taux de change**
  5. Vérifiez que le tableau des taux affiche désormais des taux en USD (chaque taux est exprimé par rapport à l'USD)
  6. Vérifiez les listes OPEX et CAPEX : les totaux et les colonnes annuelles s'affichent maintenant en USD

**Résultat** : tous les rapports, tableaux de bord et listes s'affichent en USD. Les lignes gardent leur propre devise.

### Scénario 2 : Limiter les devises pour la conformité
Votre direction financière impose que toutes les dépenses soient enregistrées en EUR, USD ou GBP.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Renseignez les devises autorisées : `EUR, USD, GBP`
  3. Cliquez sur **Enregistrer**
  4. Lancez **Forcer la synchronisation des taux de change** pour disposer des taux des trois devises

**Résultat** : les utilisateurs ne peuvent choisir que EUR, USD ou GBP à la création ou à la modification des lignes. Un import dans une autre devise échoue avec un message d'erreur explicite.

### Scénario 3 : Ajouter une devise en cours d'année
Votre entreprise ouvre une activité en Suisse et doit suivre des dépenses en CHF.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Ajoutez `CHF` aux devises autorisées (par exemple `EUR, USD, GBP, CHF`)
  3. Cliquez sur **Enregistrer**
  4. Cliquez sur **Forcer la synchronisation des taux de change** pour récupérer aussitôt les taux du CHF
  5. Vérifiez que CHF apparaît dans le tableau des taux avec des valeurs

**Résultat** : les utilisateurs peuvent choisir CHF sur les nouvelles lignes. Le tableau des taux contient le CHF, avec ses taux actuels et passés.

### Scénario 4 : Préparer le budget de l'année suivante
En décembre, vous préparez le budget de l'année prochaine.

**Étapes** :
  1. Allez dans **Gestion budgétaire > Administration > Devises**
  2. Cliquez sur **Forcer la synchronisation des taux de change** pour mettre à jour les taux de l'année à venir
  3. Consultez dans le tableau des taux les estimations de l'année prochaine
  4. Gardez en tête que les taux des années futures reprennent celui de l'année en cours : revoyez-les à l'approche de l'année

**Résultat** : le budget de l'année prochaine s'appuie sur les derniers taux disponibles, et les équipes chiffrent leurs OPEX et CAPEX avec des hypothèses de change raisonnables.

## Questions fréquentes

**Q : Que se passe-t-il si je change la devise de reporting en cours d'année ?**
R : Tous les rapports et toutes les listes passent aussitôt dans la nouvelle devise. Les montants enregistrés ne changent pas : seule la devise d'affichage change. Les versions budgétaires gelées gardent les taux de leur gel, convertis au taux de chaque année, et les taux manuels saisis pour l'ancienne devise ne s'appliquent plus tant que vous n'y revenez pas. Préparez ce changement pour ne pas perturber une période de restitution.

**Q : Puis-je définir une devise de reporting par société ?**
R : Non. La devise de reporting vaut pour tout l'espace de travail : sociétés, rapports et totaux l'utilisent tous. Chaque ligne garde sa propre devise, mais les conversions se font toujours vers la devise de reporting.

**Q : Pourquoi une devise n'a-t-elle pas de taux ?**
R : Les sources (Banque mondiale ou ExchangeRate-API) ne publient peut-être pas cette devise. Vérifiez que le code ISO est correct et couramment publié. Au besoin, limitez les devises autorisées aux codes bien couverts, ou saisissez un [taux manuel](#taux-manuels).

**Q : À quelle fréquence les taux se mettent-ils à jour automatiquement ?**
R : Tous les 30 jours, à la connexion d'un utilisateur, KANAP met à jour les taux des années A-1, A et A+1. Une année à laquelle manque le taux d'une devise utilisée est aussi récupérée dès qu'une liste, un rapport ou la page des contrats en a besoin, et à l'ouverture de cette page. Vous pouvez aussi lancer une mise à jour à tout moment avec **Forcer la synchronisation des taux de change**.

**Q : Les changements de taux modifient-ils mes données ?**
R : Non. Les taux de change n'interviennent que dans la **conversion et l'affichage**. Chaque ligne OPEX et CAPEX garde sa devise et ses montants, qui ne bougent pas quand les taux changent. Seuls les montants convertis des rapports et des listes évoluent.

**Q : Puis-je importer des taux historiques ?**
R : L'import de taux depuis un fichier n'existe pas. Vous pouvez saisir un taux manuel pour chaque devise et chaque année sur cette page (voir [Taux manuels](#taux-manuels)). Un taux manuel remplace le taux automatique jusqu'à ce que vous le retiriez.

**Q : Que faire si j'ai besoin d'une devise absente de la liste autorisée ?**
R : Ajoutez-la aux devises autorisées, ou videz la liste (toutes les devises sont alors autorisées). Lancez ensuite **Forcer la synchronisation des taux de change** pour récupérer ses taux.

**Q : Les estimations des années futures sont-elles fiables ?**
R : Elles reprennent le taux de l'année en cours : ce sont des **hypothèses de construction budgétaire**. Revoyez-les à l'approche de ces années, quand les sources officielles publient leurs taux.
