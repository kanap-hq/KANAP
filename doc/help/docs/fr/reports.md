# Rapports

La section Rapports vous donne accès à des rapports préconstruits et interactifs pour analyser les données budgétaires, les ventilations de coûts et les tendances de dépenses. Chaque rapport associe un tableau récapitulatif à un graphique, et tous exportent leur tableau en CSV ou Excel et leur graphique en image.

## Où trouver cette page

Rendez-vous dans **Rapports** depuis le menu principal pour ouvrir le hub de rapports.

- Chemin : **Rapports**
- Autorisations : `reporting:reader` (minimum)

Pour une personne dont l'[accès aux données](data-access.md) est limité, chaque rapport compte les lignes qu'elle voit, sans total du groupe.

---

## Hub de rapports

La page d'accueil affiche une carte par rapport disponible avec une courte description. Cliquez sur n'importe quelle carte pour ouvrir le rapport.

| Rapport | Ce qu'il couvre |
|---------|----------------|
| **Refacturation globale** | Totaux de ventilation par société, KPI et flux intersociétés |
| **Refacturation par société** | Vue détaillée d'une société avec départements, lignes budgétaires et KPI |
| **Top lignes** | Plus grandes lignes budgétaires pour une année sélectionnée (top N personnalisable) |
| **Top hausse / baisse** | Plus grandes variations entre deux colonnes budgétaires (top N personnalisable) |
| **Comparaison budgétaire** | Comparer les métriques budgétaires sur une plage d'années |
| **Comparaison de colonnes budgétaires** | Choisir jusqu'à 10 combinaisons année+colonne |
| **Comptes de consolidation** | Budget regroupé par compte de consolidation |
| **Dimensions analytiques** | Budget regroupé par dimension analytique |
| **Effectifs par mois** | ETP mensuels par centre de coûts, ligne budgétaire, fournisseur ou dimension analytique |
| **Coût par ETP** | Coût annuel d'un ETP ou TJM, par centre de coûts, ligne budgétaire, fournisseur ou dimension analytique, sur plusieurs colonnes budgétaires et années |

### Choisir le type de lignes

**Top lignes**, **Top hausse / baisse**, **Comparaison budgétaire**, **Comparaison de colonnes budgétaires**, **Comptes de consolidation**, **Dimensions analytiques**, **Effectifs par mois** et **Coût par ETP** commencent chacun par des onglets **Tous**, **OPEX** et **CAPEX**, la première commande de la barre de filtres.

- Le rapport s'ouvre sur **Tous** : les lignes OPEX et CAPEX ensemble. **OPEX** ou **CAPEX** garde les lignes de ce type. Les trois demandent l'accès en lecture aux lignes budgétaires (`budget:reader`). Sans cet accès, les onglets sont désactivés.
- L'adresse de la page conserve le type choisi (`?scope=all`, `?scope=opex` ou `?scope=capex`) : un lien enregistré en favori ou partagé s'ouvre sur le même type.
- Le sous-titre et le titre du graphique nomment le type : une impression ou un PNG exporté indique les lignes couvertes.
- Changer de type efface les lignes budgétaires que vous avez exclues.

Les deux rapports de refacturation ont les mêmes onglets **Tout**, **OPEX** et **CAPEX**, et s'ouvrent sur **OPEX**. Voir [Refacturation globale](#refacturation-globale).

### Choisir le montant ou les ETP

Les six rapports budgétaires ont un sélecteur **Mesure**. Il se trouve juste après les onglets de type. Il propose **Montant** (par défaut) et **ETP**. Les deux rapports de refacturation n'ont pas de mesure.

Avec **ETP**, un rapport additionne des personnes au lieu de montants :

- Chaque colonne budgétaire affiche l'ETP moyen sur l'année complète que déclarent ses lignes de quantité et de prix. Les lignes en personnes ou en jours ajoutent des ETP. Les lignes en pièces comptent 0. Une colonne sans lignes ne déclare aucun ETP et n'est pas prise en compte : seuls les ETP déclarés comptent. Voir [Quantité et prix](budget-lines.md#quantite-et-prix) et [ETP](budget-lines.md#etp).
- Une année ou une colonne où aucune ligne ne déclare d'ETP affiche une cellule vide, sans barre ni point dans le graphique.
- **Top lignes**, **Comptes de consolidation** et **Dimensions analytiques** écartent les lignes budgétaires et les groupes qui ne déclarent aucun ETP. Les parts sont des parts du total des ETP.
- **Top hausse / baisse** compare les ETP des deux colonnes ligne budgétaire par ligne budgétaire. Une ligne budgétaire qui déclare des ETP d'un seul côté compte 0 de l'autre.
- Les valeurs s'affichent avec deux décimales. Les noms de colonnes et les titres de graphiques portent la mention ETP.
- L'adresse de la page conserve la mesure (`?measure=fte`) : un lien enregistré en favori ou partagé s'ouvre sur la même mesure.
- Les noms des fichiers exportés contiennent `-fte`.

Avec les ETP, un avertissement sous le tableau signale quand certaines lignes budgétaires déclarent des ETP dans une colonne dont le montant ne suit plus les lignes de quantité et prix. C'est le cas quand le montant a été réparti, quand ses mois ont été modifiés à la main, ou quand la colonne a été copiée depuis une colonne dont les lignes ne servaient que de référence. L'avertissement indique combien de lignes budgétaires et combien d'ETP sont concernés, par colonne et par année. Avec plusieurs colonnes, elle se lit par exemple : « Le montant ne suit plus les lignes pour : Budget 2026 (2 lignes, 1,50 ETP), Budget 2027 (1 ligne, 0,50 ETP). » Avec une seule colonne : « 2 lignes déclarent 1,50 ETP alors que leur montant ne suit plus leurs lignes de quantité et prix. » Leurs ETP comptent toujours. L'avertissement vous signale que le montant de la colonne ne correspond pas au coût de ses lignes de quantité et prix.

### Colonnes budgétaires dans les rapports

Chaque sélecteur de colonne ou de métrique propose les colonnes budgétaires affichées par votre organisation, sous leurs noms, dans l'ordre fixe des colonnes. Prévision est proposée quand elle est affichée. Les colonnes masquées ne sont pas proposées. Chaque rapport démarre sur la colonne par défaut, comme décrit ci-dessous. Les administrateurs budgétaires définissent les noms, les colonnes affichées et la colonne par défaut dans [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires).

### Filtres par centre de coûts, run ou build et dimensions analytiques

Les rapports budgétaires (**Top lignes**, **Top hausse / baisse**, **Comparaison budgétaire**, **Comparaison de colonnes budgétaires**, **Comptes de consolidation** et **Dimensions analytiques**), **Effectifs par mois** et **Coût par ETP** peuvent être restreints à une partie du budget avec ces filtres :

- **Centre de coûts** : choisissez un centre de coûts ou un groupe. Un groupe inclut tout ce qui se trouve en dessous, y compris les centres de coûts désactivés, car leurs lignes appartiennent toujours au groupe. **Tous les centres de coûts** retire le filtre. Voir [Centres de coûts](cost-centers.md).
- **Run ou build** : **Tous**, **Run**, **Build**, ou **Non défini** pour les lignes qui n'ont ni l'un ni l'autre.
- **Lignes** : **Toutes les lignes** ou **Lignes avec ETP**. **Lignes avec ETP** garde les lignes budgétaires qui déclarent des ETP dans au moins une colonne budgétaire, toutes années confondues. Le filtre fonctionne avec les deux mesures. Un rapport en montants restreint à **Lignes avec ETP** compare par exemple les montants Budget et Réalisé des lignes budgétaires de personnel. Le montant Réalisé couvre l'ensemble de la ligne budgétaire.
- **Dimensions analytiques** : un filtre par dimension, au nom de la dimension. La dimension par défaut s'affiche comme **Dimension analytique** tant qu'elle n'est pas renommée. Choisissez une valeur, **Aucune valeur** pour les lignes sans valeur sur cette dimension, ou **Toutes** pour retirer le filtre. Chaque filtre propose les valeurs que portent les lignes du rapport. Voir [Dimensions analytiques](analytics.md).

Quand les filtres apparaissent :

- **Centre de coûts** s'affiche dès que votre espace de travail compte au moins un centre de coûts ou un groupe.
- **Run ou build** s'affiche dès qu'une ligne du rapport est marquée **Run** ou **Build**, ou lorsque l'adresse de la page contient déjà le filtre.
- **Lignes** s'affiche dès qu'une ligne budgétaire du rapport déclare des ETP, ou lorsque l'adresse de la page contient déjà le filtre.
- Le filtre d'une dimension s'affiche dès qu'une ligne du rapport a une valeur sur cette dimension, ou lorsque l'adresse de la page le contient déjà. Les dimensions désactivées n'ont pas de filtre. Un rapport n'affiche que les dimensions utilisées pour les lignes qu'il couvre : changer de type change la liste. Une dimension réglée sur **OPEX uniquement** n'a pas de filtre dans un rapport CAPEX, et inversement. **Tous** affiche les dimensions des deux types. Voir [Dimensions OPEX ou CAPEX](analytics.md#dimensions-opex-ou-capex).
- Sans aucun de ces filtres, la barre de filtres n'affiche que les contrôles propres au rapport.

Fonctionnement :

- Les filtres s'appliquent avant tout total. Les montants, les parts, les graphiques et les totaux ne couvrent que les lignes retenues.
- Les filtres sur plusieurs dimensions se combinent : une ligne doit correspondre à chacun d'eux.
- Les listes de lignes budgétaires, de comptes et de valeurs à exclure continuent de proposer toutes les lignes budgétaires.
- L'adresse de la page conserve les filtres (`?costCenter=`, `?runBuild=`, `?fte=with` et `?analytics=`) : un lien enregistré en favori ou partagé ouvre le rapport déjà restreint. Un lien qui désigne une dimension désactivée ou supprimée depuis ignore cette partie.
- Si le lien désigne un centre de coûts supprimé depuis, ou si les centres de coûts n'ont pas pu être chargés, le rapport n'affiche aucune ligne et une ligne de texte : « Ce centre de coûts n'existe plus ou n'a pas pu être chargé. » Cliquez sur **Retirer le filtre** pour retrouver le rapport.
- Si le lien contient un filtre analytique et que les dimensions n'ont pas pu être chargées, le rapport n'affiche aucune ligne et une ligne de texte : « Le filtre analytique n'a pas pu être appliqué. Retirez-le ou réessayez. » Cliquez sur **Retirer le filtre** pour retirer les filtres analytiques et retrouver le rapport.
- Les deux rapports de refacturation n'ont pas ces filtres et ne sont pas concernés.

### Montants sans taux de change

Quand la devise d'une ligne n'a pas de taux de change pour une année, les rapports budgétaires, **Effectifs par mois** et **Coût par ETP** excluent les montants de cette ligne pour l'année de leurs chiffres. Un avertissement d'une ligne en haut du rapport les indique, par exemple « 3 lignes sans taux de change exclues : USD 2026. » Les utilisateurs de l'administration budgétaire au niveau administrateur voient aussi **Saisir un taux**, qui ouvre les paramètres des devises sur le taux manquant. Quand l'avertissement ne cite qu'une devise et une année, la fenêtre de saisie du taux s'ouvre directement. L'avertissement n'est pas imprimé. Voir [Taux manuels](currencies.md#taux-manuels).

Les deux rapports de refacturation excluent ces montants de tous leurs chiffres : payé, consommé, départements et flux intersociétés. Chaque rapport reste équilibré sur ce qu'il compte. Le même avertissement s'affiche au-dessus du rapport.

### Ouvrir la liste depuis un rapport

Dans **Effectifs par mois**, **Coût par ETP**, **Dimensions analytiques** et **Comptes de consolidation**, le nom d'un groupe est un lien qui ouvre la [liste des lignes budgétaires](budget-lines.md) dans un nouvel onglet, sur les lignes budgétaires que compte la ligne du rapport :

- les lignes budgétaires du groupe, restreintes par la barre de filtres, et par le filtre **Type** quand le rapport est sur **OPEX** ou **CAPEX** ;
- tous les statuts (**Afficher : Tous**), avec un filtre **Fin de validité** « vide, ou après le 31 décembre » de l'année qui précède la première année du rapport. Un rapport compte les lignes budgétaires encore actives au 1er janvier de sa première année, y compris celles désactivées depuis ;
- dans **Effectifs par mois** et **Coût par ETP**, et avec la mesure **ETP**, seulement les lignes budgétaires qui déclarent des ETP (le filtre **ETP déclarés**).

Les colonnes filtrées s'affichent juste après le nom de la ligne budgétaire pour cette visite : vous voyez pourquoi la liste est restreinte. Un compte de consolidation filtre sur ses comptes, sans colonne à lui.

Cette liste est une vue du rapport. Ce que vous y changez reste dans son adresse, et **Lignes budgétaires** ouvert ensuite depuis le menu affiche vos propres tri, recherche et filtres.

---

## Refacturation globale

Consultez les ventilations de coûts à travers toutes les sociétés avec des KPI récapitulatifs et des flux intersociétés.

### Contrôles

- **Type de ligne** : **Tout**, **OPEX** ou **CAPEX**. Le rapport s'ouvre sur **OPEX**. Sur **Tout** ou **CAPEX**, une note au-dessus des résultats indique « Les CAPEX comptent pour leur montant de l'année, sans amortissement. »
- **Année** : Année fiscale précédente, en cours ou suivante
- **Colonne** : Toute colonne budgétaire affichée. Démarre sur la colonne par défaut
- **Totaux par société** (case à cocher) : Afficher ou masquer le tableau et le graphique en barres des totaux par société
- **Ventilations détaillées** (case à cocher) : Afficher ou masquer la ventilation société/département
- **Inclure les KPI** (case à cocher) : Afficher ou masquer le tableau des KPI
- **Flux intersociétés** (case à cocher) : Afficher ou masquer les flux nets payeur/consommateur
- Bouton **Exécuter** : Rafraîchir manuellement le rapport

### Ce que vous verrez

**Carte du total global** : Le total général pour la métrique et l'année sélectionnées, plus les nombres de sociétés, lignes détaillées et couverture KPI.

**Tableau des totaux par société** (lorsque activé) :

- Nom de la société
- Montant pour la métrique sélectionnée
- Montant payé (comptabilisé)
- Net (consommé moins payé)
- Part du total

**Graphique** : Graphique en barres horizontales des ventilations par société.

**Tableau des ventilations détaillées** (lorsque activé) :

- Colonnes société et département (regroupées avec des lignes de sous-total en gras par société)
- Montant, part du total, effectif et coût par utilisateur
- Les lignes libellées « Coûts communs » représentent les coûts sans affectation de département

**Tableau des flux intersociétés** (lorsque activé) :

- Flux nets payeur-vers-consommateur par paire de sociétés (auto-consommation exclue)
- Colonnes : Payeur, Consommateur, montant

**Tableau des KPI** (lorsque activé) :

| Colonne | Description |
|---------|-------------|
| Société | Nom de la société |
| Montant | Total de la métrique sélectionnée |
| Effectif | Effectif total |
| Utilisateurs IT | Nombre d'utilisateurs IT |
| Chiffre d'affaires | Chiffre d'affaires annuel, en millions de la devise de reporting |
| Coûts IT vs CA | Ratio en pourcentage, les deux termes dans la devise de reporting |
| Coûts IT par utilisateur | Montant divisé par l'effectif |
| Coûts IT par utilisateur IT | Montant divisé par les utilisateurs IT |

Une ligne de totaux est épinglée en bas.

### Export

- **Exporter le tableau** (icône de téléchargement) : **Excel (.xlsx)** écrit une feuille par tableau : **Ventilations détaillées**, **Totaux globaux par société**, **Flux interentreprises** et **KPI de refacturation**, puis la feuille **Paramètres**. **CSV** propose une entrée par tableau, par exemple **CSV : Flux interentreprises**. Les ventilations détaillées contiennent une ligne par département, avec sa société sur chaque ligne, si bien que la somme de la colonne des montants donne le total. Les totaux par société sont dans leur propre tableau
- **Exporter le graphique en PNG** (icône image) : Exporte le graphique en barres
- **Imprimer / Enregistrer en PDF** (icône imprimante)

L'export contient tous les tableaux, quels que soient ceux que les cases à cocher affichent à l'écran.

---

## Refacturation par société

Vue détaillée des ventilations de refacturation d'une société avec départements, lignes budgétaires, flux intersociétés et KPI.

### Contrôles

- **Type de ligne** : **Tout**, **OPEX** ou **CAPEX**, comme dans la refacturation globale. Le rapport s'ouvre sur **OPEX**
- **Société** : Sélectionnez la société à analyser
- **Année** : Année fiscale précédente, en cours ou suivante
- **Colonne** : Toute colonne budgétaire affichée. Démarre sur la colonne par défaut
- **Totaux par département** (case à cocher) : Afficher ou masquer la ventilation par département
- **Lignes de refacturation** (case à cocher) : Afficher ou masquer les ventilations détaillées par ligne budgétaire
- **KPI de refacturation** (case à cocher) : Afficher ou masquer le tableau comparatif des KPI
- **Flux intersociétés** (case à cocher) : Afficher ou masquer les flux partenaires
- Bouton **Exécuter** : Rafraîchir manuellement le rapport (désactivé tant qu'aucune société n'est sélectionnée)

### Ce que vous verrez

**Carte récapitulative de la société** : Nom de la société, montant total, devise de reporting, effectif, utilisateurs IT, coût par utilisateur, coût par utilisateur IT et coûts IT vs chiffre d'affaires.

**Chiffre d'affaires dans les rapports de refacturation** : chaque société saisit son chiffre d'affaires en millions de sa devise de base. Les deux rapports de refacturation le convertissent dans la devise de reporting, aux taux de la version budgétaire de l'année, comme les montants. Le chiffre d'affaires, le ratio coûts IT vs CA et le chiffre d'affaires global des tableaux de KPI utilisent la valeur convertie. Quand une devise n'a pas de taux pour l'année, les sociétés dans cette devise sont écartées des indicateurs de chiffre d'affaires, et un avertissement en haut du rapport nomme chacune d'elles. Le ratio global coûts IT vs CA est alors calculé sur les seules sociétés dont le chiffre d'affaires a été converti, pour les coûts comme pour le chiffre d'affaires. KANAP récupère le taux manquant en arrière-plan.

**Totaux par département** (lorsque activé) :

- Nom du département, montant, part du total, effectif, coût par utilisateur
- « Coûts communs » agrège les ventilations sans département spécifique
- Graphique en barres horizontales à côté du tableau

**Lignes de refacturation** (lorsque activé) :

- Nom de la ligne, méthode de ventilation, montant, part du total
- Ligne de totaux épinglée en bas
- Le nom de la ligne est un lien qui ouvre la ligne budgétaire dans un nouvel onglet. Les coûts communs et les totaux restent du texte simple.

**Flux intersociétés** (lorsque activé) :

- Société partenaire, créances, dettes, net
- Ligne de totaux épinglée

**Tableau des KPI** (lorsque activé) : Mêmes colonnes que le tableau KPI de la refacturation globale, avec une ligne « Totaux globaux » en bas pour comparaison.

**Accès aux données limité** : une personne limitée ouvre les sociétés de ses nœuds société, ou toutes les sociétés avec **Tout**. Les lignes de refacturation montrent alors la part refacturée à la société, avec la société qui paie, le pourcentage de ventilation et les départements ; une ligne qu'elle ne voit pas autrement affiche sa référence sans lien. Les chiffres des autres sociétés et les totaux globaux sont retirés, et un nœud centre de coûts n'ouvre pas ce rapport. Voir [Accès aux données](data-access.md#what-a-limited-person-sees).

### Export

- **Exporter le tableau** : **Excel (.xlsx)** écrit une feuille par tableau : **Totaux par département**, **Lignes de refacturation**, **Flux interentreprises** et **KPI de refacturation**, puis la feuille **Paramètres**. **CSV** propose une entrée par tableau, par exemple **CSV : Lignes de refacturation**
- **Exporter le graphique en PNG** : Exporte le graphique en barres des départements
- **Imprimer / Enregistrer en PDF**

L'export contient tous les tableaux, quels que soient ceux que les cases à cocher affichent à l'écran.

---

## Top lignes

Identifiez vos lignes budgétaires les plus importantes pour une année donnée.

### Contrôles

- **Type de ligne** : **Tous**, **OPEX** ou **CAPEX** (voir [Choisir le type de lignes](#choisir-le-type-de-lignes))
- **Mesure** : **Montant** ou **ETP** (voir [Choisir le montant ou les ETP](#choisir-le-montant-ou-les-etp))
- **Année** : Année précédente, en cours ou suivante
- **Métrique** : Toute colonne budgétaire affichée. Démarre sur la colonne par défaut
- **Nombre top** : Combien de lignes budgétaires afficher (par défaut : 10, minimum : 1)
- **Type de graphique** : Graphique en secteurs ou en barres horizontales
- **Exclure des lignes** : Autocomplétion multi-sélection pour exclure des lignes budgétaires spécifiques
- **Exclure des comptes** : Autocomplétion multi-sélection pour exclure des comptes spécifiques
- **Centre de coûts**, **Run ou build**, **Lignes** et les filtres de dimensions analytiques : Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques)

### Ce que vous verrez

**Graphique** : Graphique en secteurs ou en barres horizontales des lignes budgétaires les plus importantes. Son titre nomme le type, par exemple « Top 10 CAPEX · Budget 2026 ».

**Colonnes du tableau** :

- Ligne budgétaire
- Valeur pour la métrique et l'année sélectionnées
- Part du total (pourcentage)

Le nom de la ligne est un lien qui ouvre la ligne budgétaire dans un nouvel onglet.

**Cartes récapitulatives sous le tableau** :

- **Total top N**, avec sa part du total filtré, par exemple « 45 % du total filtré »
- Le total de la colonne sélectionnée sur toutes les lignes budgétaires, libellé avec le nom de la colonne, par exemple **Budget, total**

La note sous le graphique donne le même total, par exemple « Budget, total : 1 234 ».

### Cas d'usage

Utilisez ce rapport pour repérer rapidement où va la majeure partie de votre budget IT et identifier les candidats à l'optimisation des coûts.

---

## Top hausse / baisse

Identifiez les plus grandes variations entre deux colonnes budgétaires (toute combinaison d'année et de métrique).

### Contrôles

- **Type de ligne** : **Tous**, **OPEX** ou **CAPEX** (voir [Choisir le type de lignes](#choisir-le-type-de-lignes))
- **Mesure** : **Montant** ou **ETP** (voir [Choisir le montant ou les ETP](#choisir-le-montant-ou-les-etp))
- **Année source** et **Métrique source** : La colonne de référence pour la comparaison
- **Année destination** et **Métrique destination** : La colonne cible de comparaison
- **Nombre top** : Combien de lignes budgétaires afficher par direction (par défaut : 10)
- **Type de graphique** : Graphique en secteurs (une seule direction) ou en barres horizontales
- **Exclure des lignes** : Autocomplétion multi-sélection pour exclure des lignes budgétaires spécifiques
- **Exclure des comptes** : Autocomplétion multi-sélection pour exclure des comptes spécifiques
- **Direction** : onglets **Hausses**, **Baisses** ou **Les deux**
- **Centre de coûts**, **Run ou build**, **Lignes** et les filtres de dimensions analytiques : Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques)

Les sélecteurs d'année listent les années qui contiennent des données. Les sélecteurs de métrique proposent les colonnes budgétaires affichées. Le rapport démarre avec la colonne par défaut de l'année précédente comme source et la colonne par défaut de l'année en cours comme destination.

Lorsque **Les deux** est sélectionné, l'option graphique en secteurs est désactivée et le rapport bascule automatiquement en barres.

### Ce que vous verrez

**Graphique** : Visualisation des plus grandes variations. Son titre nomme le type, par exemple « Top 10 hausses OPEX ».

**Colonnes du tableau** :

- Ligne budgétaire
- Valeur source (précédente)
- Valeur destination (actuelle)
- Delta (variation absolue)
- Pourcentage d'augmentation

Le nom de la ligne est un lien qui ouvre la ligne budgétaire dans un nouvel onglet.

**Cartes récapitulatives sous le tableau** :

- Totaux de la sélection (montants de hausse et/ou baisse, avec sommes source/destination)
- Variations brutes à travers toutes les lignes (avec pourcentage de couverture)
- Augmentation ou diminution nette à travers toutes les lignes

### Cas d'usage

Utilisez ce rapport pour identifier les dépassements de coûts, repérer les opportunités d'économies et expliquer les écarts d'une année sur l'autre lors des revues budgétaires.

---

## Comparaison budgétaire

Comparez les métriques budgétaires sur plusieurs années sur un seul graphique en courbe. L'adresse de l'ancien rapport **Tendance budgétaire (CAPEX)** ouvre ce rapport sur CAPEX.

### Contrôles

- **Type de ligne** : **Tous**, **OPEX** ou **CAPEX** (voir [Choisir le type de lignes](#choisir-le-type-de-lignes))
- **Mesure** : **Montant** ou **ETP** (voir [Choisir le montant ou les ETP](#choisir-le-montant-ou-les-etp))
- **Année de début** : Début de la plage (année en cours moins 2 à plus 2)
- **Année de fin** : Fin de la plage
- **Métriques** : Multi-sélection parmi les colonnes budgétaires affichées. Le rapport démarre sur la colonne par défaut et la dernière colonne affichée (Budget et Atterrissage prévu avec les réglages standard). Si vous retirez toutes les métriques, la colonne par défaut est utilisée
- **Centre de coûts**, **Run ou build**, **Lignes** et les filtres de dimensions analytiques : Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques)

### Ce que vous verrez

**Graphique** : Graphique en courbe avec une série par métrique sélectionnée, tracée sur la plage d'années.

**Tableau** : Une ligne par métrique sélectionnée, avec des colonnes d'années affichant les totaux.

### Export

- **Exporter le tableau** : CSV ou Excel. Voir [Options d'export](#export-options)
- **Exporter le graphique en PNG**
- **Imprimer / Enregistrer en PDF**

---

## Comparaison de colonnes budgétaires

Comparez de manière flexible jusqu'à 10 combinaisons année+colonne.

### Contrôles

- **Type de ligne** : **Tous**, **OPEX** ou **CAPEX** (voir [Choisir le type de lignes](#choisir-le-type-de-lignes))
- **Mesure** : **Montant** ou **ETP** (voir [Choisir le montant ou les ETP](#choisir-le-montant-ou-les-etp))
- **Sélections** : Chaque sélection a un sélecteur d'année et un sélecteur de colonne avec les colonnes budgétaires affichées. Le rapport démarre avec deux sélections : la colonne par défaut de l'année en cours et celle de l'année suivante. **Ajouter** ajoute la colonne par défaut de l'année en cours, et l'icône de suppression retire une sélection. Maximum 10 sélections ; minimum 1.
- **Regroupement par année** (case à cocher) : Lorsque activé et qu'au moins deux années partagent une métrique, bascule vers un graphique en courbe groupé avec une série par métrique et les années sur l'axe X. Lorsque désactivé, affiche un graphique en courbe plat avec chaque sélection comme point de données.
- **Centre de coûts**, **Run ou build**, **Lignes** et les filtres de dimensions analytiques : Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques)

### Ce que vous verrez

**Graphique** :

- Mode par défaut : Graphique en courbe avec chaque sélection sur l'axe X et son total sur l'axe Y
- Mode regroupement par année : Graphique en courbe avec les années sur l'axe X et une ligne par métrique

**Tableau** :

- Mode par défaut : Libellé de sélection, année, nom de colonne, total
- Mode regroupement par année : Colonne année, puis une colonne par métrique avec les totaux

### Export

- **Exporter le tableau** : CSV ou Excel. Voir [Options d'export](#export-options)
- **Exporter le graphique en PNG**
- **Imprimer / Enregistrer en PDF**

---

## Comptes de consolidation

Consultez les données budgétaires regroupées par compte de consolidation, avec un type de graphique qui s'adapte à la plage d'années.

### Contrôles

- **Type de ligne** : **Tous**, **OPEX** ou **CAPEX** (voir [Choisir le type de lignes](#choisir-le-type-de-lignes))
- **Mesure** : **Montant** ou **ETP** (voir [Choisir le montant ou les ETP](#choisir-le-montant-ou-les-etp))
- **Année de début** et **Année de fin** : Année précédente, en cours ou suivante
- **Métrique** : Toute colonne budgétaire affichée. Démarre sur la colonne par défaut
- **Type de graphique** : Graphique en secteurs ou en barres horizontales (disponible uniquement pour une seule année sélectionnée)
- **Exclure des comptes** : Autocomplétion multi-sélection pour exclure des comptes spécifiques. Propose tous les comptes utilisés par les lignes du rapport, par nom et numéro, que vous puissiez ou non ouvrir le plan comptable. La liste commence par « Non affecté » : le choisir exclut les lignes sans compte de consolidation
- **Centre de coûts**, **Run ou build**, **Lignes** et les filtres de dimensions analytiques : Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques)

### Ce que vous verrez

**Mode année unique** :

- Graphique en secteurs ou en barres horizontales des totaux par compte de consolidation
- Note de bas de page avec le total pour la métrique sélectionnée

**Mode multi-années** :

- Graphique en courbe avec une série par compte de consolidation, tracé sur les années

**Tableau** : Une ligne par compte de consolidation avec des colonnes d'années. Une ligne de totaux épinglée en bas additionne tous les groupes. Un compte de consolidation ouvre la liste des lignes budgétaires sur ses comptes dans un nouvel onglet (« Non affecté » : les lignes budgétaires dont le compte n'a pas de compte de consolidation, et les lignes budgétaires sans compte). Voir [Ouvrir la liste depuis un rapport](#ouvrir-la-liste-depuis-un-rapport). La ligne de totaux est en texte simple.

Une ligne budgétaire sur un compte de consolidation désactivé depuis compte toujours, sur la ligne de consolidation de ce compte. Les noms et numéros de compte ne s'affichent que si vous pouvez lire le [plan comptable](chart-of-accounts.md) ; sans cet accès, toutes les lignes budgétaires apparaissent sous « Non affecté » à la place (les totaux restent corrects, seule la répartition par compte est masquée). Les lignes budgétaires sans compte de consolidation apparaissent aussi comme « Non affecté ». Les comptes de consolidation sont les comptes de votre [plan de consolidation](chart-of-accounts.md#le-plan-de-consolidation).

---

## Dimensions analytiques

Consultez les données budgétaires regroupées par les valeurs d'une dimension analytique. La disposition reprend celle du rapport Comptes de consolidation. Voir [Dimensions analytiques](analytics.md) pour configurer les dimensions et les valeurs.

### Contrôles

- **Type de ligne** : **Tous**, **OPEX** ou **CAPEX** (voir [Choisir le type de lignes](#choisir-le-type-de-lignes))
- **Mesure** : **Montant** ou **ETP** (voir [Choisir le montant ou les ETP](#choisir-le-montant-ou-les-etp))
- **Dimension** : la dimension sur laquelle le rapport regroupe. Elle propose les dimensions activées utilisées pour le type de ligne choisi, s'affiche lorsqu'il y en a au moins deux, et le rapport s'ouvre sur la dimension par défaut. Si vous passez à un type de ligne qui n'utilise pas la dimension choisie, le rapport revient à la dimension par défaut. L'adresse de la page conserve votre choix : un lien enregistré en favori ou partagé s'ouvre sur la même dimension
- **Année de début** et **Année de fin** : Année précédente, en cours ou suivante
- **Métrique** : Toute colonne budgétaire affichée. Démarre sur la colonne par défaut
- **Type de graphique** : Graphique en secteurs ou en barres horizontales. Disponible pour une seule année, quand **Répartition OPEX / CAPEX** n'est pas cochée
- **Détail par ligne** : liste les lignes de chaque valeur sous celle-ci
- **Répartition OPEX / CAPEX** : ajoute les parts OPEX et CAPEX de chaque valeur. Disponible avec le type de ligne **Tous** uniquement
- **Exclure des valeurs** : Autocomplétion multi-sélection pour exclure des valeurs précises de la dimension choisie. Elle propose les valeurs utilisées pour le type de ligne choisi, plus celles que portent les lignes du rapport. La liste commence par « Non affecté » : le choisir exclut les lignes sans valeur sur la dimension. Changer le type de ligne ou la dimension la vide
- **Centre de coûts**, **Run ou build**, **Lignes** et les filtres de dimensions analytiques : Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques)

Le sous-titre, le titre du graphique et la première colonne du tableau nomment la dimension choisie, par exemple « OPEX par Nature ». L'adresse de la page conserve aussi les deux cases : un lien partagé s'ouvre avec le même détail et la même répartition.

### Ce que vous verrez

**Mode année unique** :

- Graphique en secteurs ou en barres des totaux par valeur. Le graphique en barres prend la hauteur de ses barres
- Avec **Détail par ligne**, le graphique montre les lignes (« BL-12 · nom ») au lieu des valeurs
- Avec **Répartition OPEX / CAPEX**, une barre horizontale par valeur, ramenée à 100 % : sa part OPEX et sa part CAPEX, chacune avec son pourcentage. Une barre **Total** vient en tête dès qu'il y a au moins deux valeurs, et une légende nomme OPEX et CAPEX. Avec **Détail par ligne** en plus, les barres restent une par valeur
- Note de bas de page avec le total de la métrique

**Mode multi-années** :

- Graphique en courbe avec une série par valeur, ou une par ligne avec **Détail par ligne**. La répartition ne change pas le graphique : le tableau la donne

**Tableau** : Une ligne par valeur avec des colonnes d'années, et une colonne **Lignes** avec le nombre de lignes de chaque valeur. Une ligne de totaux épinglée en bas, avec le nombre total de lignes. Les lignes sans valeur sur la dimension choisie apparaissent comme « Non affecté ».

Avec **Détail par ligne**, les lignes de chaque valeur apparaissent en retrait sous celle-ci, « Non affecté » compris, avec ces colonnes :

- **Niveau** : **Valeur** ou **Ligne**
- **Réf** : la référence de la ligne, qui ouvre la ligne dans un nouvel onglet
- **Nature** : **OPEX** ou **CAPEX**
- **Part du total** pour chaque année : la part de la ligne dans le total de sa valeur

Le tri des colonnes est désactivé tant que des lignes sont imbriquées sous les valeurs.

Avec **Répartition OPEX / CAPEX**, chaque année reçoit une colonne **Part OPEX** et une colonne **Part CAPEX**, sur chaque valeur et sur la ligne de totaux. Avec le détail, chaque ligne affiche 100 % dans sa propre nature.

Une valeur ouvre la liste de ses lignes budgétaires dans un nouvel onglet (« Non affecté » : les lignes budgétaires sans valeur). Avec la mesure **ETP**, la liste montre les lignes budgétaires de la valeur qui déclarent des ETP. Voir [Ouvrir la liste depuis un rapport](#ouvrir-la-liste-depuis-un-rapport). La ligne de totaux est en texte simple.

**Accès limité aux données** : une personne dont l'[accès aux données](data-access.md#what-a-limited-person-sees) est limité voit une mention sous chaque valeur, par exemple « et 3 lignes hors de votre accès ». Avec le détail, elle vient après les lignes de la valeur. Le compte suit le type de ligne et les années du rapport, et ignore les filtres. « Non affecté » n'affiche aucune mention.

L'export CSV ou Excel contient la colonne **Lignes**, ainsi que le détail et la répartition quand ils sont cochés. L'impression et l'export laissent de côté les mentions des lignes hors de votre accès.

---

## Effectifs par mois

Voyez combien de personnes chaque partie du budget prévoit, mois par mois. Le rapport lit les ETP mensuels que déclarent les lignes de quantité et de prix d'une colonne budgétaire. Voir [Quantité et prix](budget-lines.md#quantite-et-prix) et [ETP](budget-lines.md#etp).

### Contrôles

- **Type de ligne** : **Tous**, **OPEX** ou **CAPEX** (voir [Choisir le type de lignes](#choisir-le-type-de-lignes))
- **Centre de coûts**, **Run ou build**, **Lignes** et les filtres de dimensions analytiques : Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques)
- **Année** : Année précédente, en cours ou suivante
- **Colonne** : Toute colonne budgétaire affichée. Démarre sur la colonne par défaut
- **Regrouper par** : **Centre de coûts** (par défaut), **Ligne**, **Fournisseur** ou **Dimension analytique**
- **Dimension** : la dimension sur laquelle le rapport regroupe, avec **Dimension analytique**. Elle propose les dimensions activées utilisées pour les lignes du rapport et s'affiche lorsqu'il y en a au moins deux. Le rapport s'ouvre sur la dimension par défaut

L'adresse de la page conserve le regroupement (`?group=item`, `?group=supplier` ou `?group=axis:<dimension id>`) : un lien enregistré en favori ou partagé s'ouvre sur le même regroupement. Sans ce paramètre, le rapport regroupe par centre de coûts.

### Ce que vous verrez

**Graphique** : Des aires empilées sur les douze mois, une pour chacun des huit plus grands groupes par moyenne. Les autres groupes s'additionnent dans une aire **Autres**. Le titre nomme le type, le regroupement, la colonne et l'année, par exemple « Effectifs OPEX par centre de coûts, Budget 2026 ». Survolez un mois pour lire les ETP d'un groupe.

**Tableau** : Une ligne par groupe qui déclare des ETP mensuels, la plus grande moyenne en premier :

- Le groupe : un centre de coûts, une ligne, un fournisseur ou une valeur de la dimension. Les lignes budgétaires sans centre de coûts apparaissent comme « Aucun centre de coûts », sans fournisseur comme « Aucun fournisseur », et sans valeur sur la dimension comme « Aucune valeur »
- Une colonne par mois
- **Moyenne** : la somme des douze mois divisée par 12. C'est l'ETP moyen sur l'année complète que déclare la colonne
- **Pic** : le mois le plus élevé

Une ligne **Total** épinglée donne les totaux mensuels, leur moyenne et leur pic. Les valeurs s'affichent avec deux décimales. Seuls les ETP déclarés comptent : les lignes budgétaires sans lignes de quantité et de prix dans la colonne sont écartées.

Le nom d'un groupe est un lien qui s'ouvre dans un nouvel onglet. Une ligne budgétaire ouvre sa page. Un centre de coûts, un fournisseur ou une valeur ouvre la liste des lignes budgétaires sur les lignes budgétaires du groupe qui déclarent des ETP, dans la période du rapport et restreintes par la barre de filtres (voir [Ouvrir la liste depuis un rapport](#ouvrir-la-liste-depuis-un-rapport)). « Aucun centre de coûts », « Aucun fournisseur » et « Aucune valeur » ouvrent les lignes budgétaires qui n'en ont pas. La ligne **Total** est en texte simple. L'export garde les noms en texte simple.

### Avertissements

Une ligne sous le tableau pour chaque cas, quand il se présente :

- « 2 lignes déclarent 1,50 ETP alors que leur montant ne suit plus leurs lignes de quantité et prix. » Le montant a été réparti, ses mois ont été modifiés à la main, ou la colonne a été copiée. Cet avertissement couvre les lignes budgétaires qui ont un détail mensuel, et leurs ETP comptent toujours dans les mois. Les lignes budgétaires sans détail mensuel apparaissent seulement dans l'avertissement suivant. Voir [Choisir le montant ou les ETP](#choisir-le-montant-ou-les-etp).
- « 1 ligne déclare 3,00 ETP sans détail mensuel. Elle n'est pas comptée dans les mois. » Ces lignes budgétaires déclarent un ETP sur l'année complète, sans ETP par mois. Elles sont écartées des mois, de la moyenne et du pic.

### Export

- **Exporter le tableau** : CSV ou Excel. Le nom du fichier porte le type, l'année, la colonne, le regroupement et le jour de l'export, par exemple `staffing-opex-2026-budget-cost-center-2026-10-27.xlsx`
- **Exporter le graphique en PNG** : Le type, l'année, la colonne et le regroupement, en image PNG
- **Imprimer / Enregistrer en PDF**

---

## Coût par ETP

Voyez ce que coûte un ETP dans chaque partie du budget, et comment ce coût évolue d'une colonne budgétaire et d'une année à l'autre. Le rapport divise le coût des lignes de quantité et de prix en personnes ou en jours par leurs ETP. Il peut aussi afficher le taux journalier moyen (TJM) des lignes au prix par jour (voir [TJM](#tjm)). Voir [Quantité et prix](budget-lines.md#quantite-et-prix) et [ETP](budget-lines.md#etp).

### Contrôles

- **Type de ligne** : **Tous**, **OPEX** ou **CAPEX** (voir [Choisir le type de lignes](#choisir-le-type-de-lignes))
- **Centre de coûts**, **Run ou build**, **Lignes** et les filtres de dimensions analytiques : Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques)
- **Regrouper par** et **Dimension** : les mêmes choix que dans [Effectifs par mois](#effectifs-par-mois). L'adresse de la page conserve le regroupement de la même façon
- **Afficher** : **Coût par ETP** (par défaut) ou **TJM**. Le changement conserve le type, le regroupement, les paires et les filtres. L'adresse de la page conserve le TJM (`?view=rate`) : un lien enregistré ou partagé s'ouvre dessus
- **Colonnes** : une à quatre paires d'une année et d'une colonne budgétaire. Les années vont de deux ans en arrière à deux ans en avant. **Ajouter** ajoute une paire, et le bouton de retrait à côté d'une paire la retire. Le rapport s'ouvre sur la colonne par défaut de l'année dernière et de l'année en cours. Le tableau et le graphique présentent les paires dans l'ordre chronologique

### Ce qui est compté

- Le coût et les ETP des lignes en personnes ou en jours. Les lignes en pièces sont écartées des deux.
- Le rapport lit les résultats des lignes, y compris quand le montant de la colonne ne les suit plus (le montant a été réparti, ses mois ont été modifiés à la main, ou la colonne a été copiée). Le coût est alors le coût des lignes.
- Le coût est converti dans la devise de reporting au taux de la version de chaque année, comme tous les montants des rapports.
- Les lignes budgétaires qui déclarent des ETP sans détail de lignes sont écartées. Un avertissement les signale (voir ci-dessous).

### Ce que vous verrez

**Tableau** : Une ligne par groupe ayant des ETP de personnel dans au moins une paire, le plus grand nombre d'ETP en premier. Les ETP comparés sont ceux de la première paire où un groupe a des ETP de personnel : un budget qui prévoit du personnel pour cette année seulement reste trié par ETP. Sans aucun ETP de personnel, les lignes suivent l'ordre des noms. Chaque paire a trois colonnes sous son nom, par exemple « Budget 2026 » :

- **ETP** : l'ETP moyen sur l'année complète des lignes
- **Coût du personnel** : le coût des mêmes lignes sur l'année, dans la devise de reporting
- **Coût par ETP** : le coût du personnel divisé par les ETP. La cellule est vide quand les ETP valent 0 ou quand le groupe n'a pas de lignes de personnel dans cette paire

Les groupes sont nommés comme dans Effectifs par mois (« Aucun centre de coûts », « Aucun fournisseur », « Aucune valeur »). Une ligne **Total** épinglée donne, pour chaque paire, le total des ETP, le total du coût du personnel et le total du coût du personnel divisé par le total des ETP.

Dans les deux vues, le nom d'un groupe ouvre sa ligne, ou la liste des lignes budgétaires du groupe qui déclarent des ETP, dans un nouvel onglet, comme dans [Effectifs par mois](#effectifs-par-mois).

**Graphique** : Des barres horizontales du coût par ETP, une barre par paire. La première catégorie est le total, suivie des dix premiers groupes du tableau. Le titre nomme le type et le regroupement, par exemple « Coût par ETP OPEX par centre de coûts ». Survolez une barre pour lire le groupe, la paire, le coût par ETP, les ETP et le coût du personnel.

### Avertissements

Une ligne sous le tableau pour chaque cas, quand il se présente. Chaque ligne nomme les paires concernées :

- « Le montant ne suit plus les lignes pour : Budget 2026 (2 lignes, 1,50 ETP). Ces chiffres utilisent le coût de leurs lignes. » Ces colonnes comptent avec le coût de leurs lignes. Voir [Choisir le montant ou les ETP](#choisir-le-montant-ou-les-etp).
- « Aucun détail de lignes pour : Budget 2025 (1 ligne, 0,50 ETP). Ils sont exclus de ces chiffres. » Ces lignes budgétaires déclarent un ETP sur l'année complète, sans résultat par ligne : le rapport ne peut pas lire leur coût.

### TJM

Choisissez **Afficher** > **TJM** pour voir le TJM de chaque groupe à la place du coût par ETP.

- Seules les lignes au prix par jour comptent : les personnes au prix par jour et les forfaits de jours. Le TJM est leur coût divisé par les jours qu'elles achètent : chaque ligne pèse selon ses jours.
- Les lignes au prix par mois n'ont pas de TJM. Elles sont écartées, et un avertissement donne leur coût (voir ci-dessous).
- Comme pour le coût par ETP, le rapport lit les résultats des lignes et convertit le coût dans la devise de reporting.

**Tableau** : Une ligne par groupe ayant des jours dans au moins une paire, le plus grand nombre de jours en premier. Les jours comparés sont ceux de la première paire où un groupe a des jours. Chaque paire a trois colonnes sous son nom :

- **Jours** : les jours achetés par les lignes au prix par jour
- **Coût des jours** : le coût des mêmes lignes sur l'année, dans la devise de reporting
- **TJM** : le coût des jours divisé par les jours. La cellule est vide quand les jours valent 0 ou quand le groupe n'a pas de lignes au prix par jour dans cette paire

Une ligne **Total** épinglée donne, pour chaque paire, le total des jours, le total du coût des jours et le total du coût des jours divisé par le total des jours.

**Graphique** : Les mêmes barres horizontales, avec le TJM. Le titre nomme le type et le regroupement, par exemple « TJM OPEX par centre de coûts ». Survolez une barre pour lire le groupe, la paire, le TJM, les jours et le coût des jours.

**Avertissements** : Les deux avertissements ci-dessus, et une ligne de plus quand des lignes en personnes sont au prix par mois : « Les lignes au prix mensuel sont exclues du TJM : Budget 2026 (180 000). » Le montant est le coût de ces lignes dans chaque paire concernée, dans la devise de reporting.

### Export

- **Exporter le tableau** : CSV ou Excel. Le nom du fichier porte le type, le regroupement, la première paire et le jour de l'export, par exemple `cost-per-fte-opex-cost-center-2025-budget-2026-10-27.xlsx`. Pour le TJM, il commence par `daily-rate`, par exemple `daily-rate-opex-cost-center-2025-budget-2026-10-27.csv`
- **Exporter le graphique en PNG** : Le type, le regroupement et la première paire, en image PNG
- **Imprimer / Enregistrer en PDF**

---

## Demander à l'assistant

[Plaid](ai-assistant.md) donne les chiffres de ces rapports, avec les mêmes droits : Comptes de consolidation, Top hausse / baisse (10 lignes par défaut), Effectifs par mois (chaque mois, la moyenne et le pic), Coût par ETP, Refacturation globale et Refacturation par société. Il mesure aussi plusieurs colonnes ou années dans une même réponse, par exemple le budget de chaque fournisseur sur trois ans. Pour la refacturation, il couvre OPEX et CAPEX quand vous ne nommez aucun des deux, et reprend les avertissements du rapport. Demandez par exemple : « Quelles lignes augmentent le plus du budget 2026 à la révision ? » ou « Combien est refacturé à chaque société en 2026, et combien chacune paie-t-elle ? »

Plaid lit toutes les lignes budgétaires, y compris les lignes terminées. Les rapports budgétaires lisent les lignes encore actives au 1er janvier de l'année qui précède la première année affichée : une ligne terminée plus tôt compte donc dans la réponse de Plaid et pas dans le rapport.

## Fonctionnalités communes

Chaque rapport partage ces capacités via la barre d'outils partagée :

### Options d'export { #export-options }

- **Exporter le tableau** (icône de téléchargement) : ouvre un menu avec **CSV** et **Excel (.xlsx)**. Votre navigateur mémorise le dernier choix et le met en évidence
- **Exporter le graphique en PNG** (icône image) : Télécharge le graphique en tant qu'image PNG
- **Imprimer / Enregistrer en PDF** (icône imprimante) : Ouvre la boîte de dialogue d'impression du navigateur. Vous pouvez aussi ajouter `?print=1` à n'importe quelle URL de rapport pour déclencher l'impression automatiquement au chargement.

KANAP construit le fichier du tableau à partir des mêmes chiffres que l'écran, avec les filtres à l'écran :

- **Valeurs** : les montants gardent leurs centimes, les ETP et les jours leurs décimales, les parts sont des pourcentages. L'écran les arrondit pour la lecture ; le fichier garde les valeurs, si bien qu'une somme dans Excel correspond au rapport.
- **Ordre** : les lignes suivent l'ordre propre du rapport. Un tri cliqué dans un en-tête de colonne reste à l'écran.
- **Langue** : les en-têtes, les noms de groupe (« Aucun centre de coûts ») et les dates suivent la langue de votre écran. Un fichier CSV prend aussi le séparateur et la marque décimale de cette langue (voir [Fichiers CSV et Excel](csv-files.md)).
- **Excel** : une feuille par tableau, avec les lignes de total en gras après les données. Un tri ou un filtre dans Excel laisse les totaux en place. Une dernière feuille, **Paramètres**, liste les filtres appliqués, la date et l'heure de l'export dans votre fuseau horaire, et votre nom.
- **Accès limité aux données** : pour une personne dont l'[accès aux données](data-access.md) est limité, le fichier compte les lignes qu'elle voit et ne contient aucune ligne de total. La feuille **Paramètres** indique **Calculé sur vos accès**.

Chaque export de tableau est enregistré dans le [journal d'audit](admin.md#journal-daudit).

Les noms des fichiers exportés contiennent le nom de la colonne, par exemple `top10-opex-2026-budget-bar.png`, et un fichier de tableau se termine par le jour de l'export. Avec la mesure ETP, les noms contiennent `-fte`, avant le jour pour un fichier de tableau.

### Métriques disponibles

Chaque sélecteur de métrique ou de colonne propose les mêmes colonnes budgétaires : celles que votre organisation affiche, sous leurs noms. Avec les réglages standard, ce sont Budget, Révision, Réalisé et Atterrissage prévu. Prévision est proposée quand elle est affichée. Voir [Colonnes budgétaires dans les rapports](#colonnes-budgetaires-dans-les-rapports).

### Navigation

Pour changer de rapport, cliquez sur **Rapports** dans le panneau de gauche pour revenir au hub.

---

## Conseils

- **Commencez par la refacturation globale** : Obtenez la vue d'ensemble des ventilations avant de plonger dans une société spécifique.
- **Utilisez le Top lignes pour des gains rapides** : Les lignes budgétaires les plus importantes sont vos premiers candidats à l'optimisation.
- **Comparez Budget vs Atterrissage prévu** : Utilisez le rapport Comparaison de colonnes budgétaires pour mesurer la précision des prévisions sur plusieurs années.
- **Basculez les sections sur les rapports de refacturation** : Les cases à cocher vous permettent de vous concentrer uniquement sur les données dont vous avez besoin (départements, lignes budgétaires, KPI ou flux) sans encombrement visuel.
- **Regroupement par année dans la Comparaison de colonnes budgétaires** : Lorsque vous comparez la même métrique sur plusieurs années, activez le regroupement par année pour un graphique en courbe plus lisible.
- **Exportez pour les présentations** : Les graphiques s'exportent en PNG et les tableaux en CSV ou Excel, prêts pour les diaporamas ou les tableurs.
