# Rapports

La section Rapports vous donne accès à des rapports préconstruits et interactifs pour analyser les données budgétaires, les ventilations de coûts et les tendances de dépenses. Chaque rapport associe un tableau récapitulatif à un graphique, et tous supportent l'export CSV et image.

## Où trouver cette page

Rendez-vous dans **Rapports** depuis le menu principal pour ouvrir le hub de rapports.

- Chemin : **Rapports**
- Autorisations : `reporting:reader` (minimum)

---

## Hub de rapports

La page d'accueil affiche une carte par rapport disponible avec une courte description. Cliquez sur n'importe quelle carte pour ouvrir le rapport.

| Rapport | Ce qu'il couvre |
|---------|----------------|
| **Refacturation globale** | Totaux de ventilation par société, KPI et flux intersociétés (OPEX) |
| **Refacturation par société** | Vue détaillée d'une société avec départements, postes et KPI (OPEX) |
| **Top postes** | Plus gros postes OPEX ou CAPEX pour une année sélectionnée (top N personnalisable) |
| **Top hausse / baisse** | Plus grandes variations OPEX ou CAPEX entre deux colonnes budgétaires (top N personnalisable) |
| **Tendance budgétaire (OPEX)** | Comparer les métriques OPEX sur une plage d'années |
| **Tendance budgétaire (CAPEX)** | Comparer les métriques CAPEX sur une plage d'années |
| **Comparaison de colonnes budgétaires** | Choisir jusqu'à 10 combinaisons année+colonne pour OPEX ou CAPEX |
| **Comptes de consolidation** | Budget OPEX ou CAPEX regroupé par compte de consolidation |
| **Dimensions analytiques** | Budget OPEX ou CAPEX regroupé par dimension analytique |

### Choisir OPEX ou CAPEX

**Top postes**, **Top hausse / baisse**, **Comptes de consolidation** et **Dimensions analytiques** commencent chacun par un sélecteur **OPEX** / **CAPEX**, la première commande de la barre de filtres.

- Le rapport s'ouvre sur un type que vous pouvez consulter, OPEX en priorité. Un type que vous ne pouvez pas consulter est désactivé.
- L'adresse de la page conserve le type choisi (`?scope=opex` ou `?scope=capex`) : un lien enregistré en favori ou partagé s'ouvre sur le même type.
- Le sous-titre et le titre du graphique nomment le type : une impression ou un PNG exporté indique le type couvert.
- Changer de type efface les postes que vous avez exclus, car chaque type a ses propres postes.

Les deux rapports de refacturation couvrent uniquement les OPEX.

---

## Refacturation globale

Consultez les ventilations de coûts à travers toutes les sociétés avec des KPI récapitulatifs et des flux intersociétés.

### Contrôles

- **Année** : Année fiscale précédente, en cours ou suivante
- **Colonne** : Budget, Atterrissage prévu, Réalisé ou Révision
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
- Bouton séparé **Exporter les flux nets en CSV**

**Tableau des KPI** (lorsque activé) :

| Colonne | Description |
|---------|-------------|
| Société | Nom de la société |
| Montant | Total de la métrique sélectionnée |
| Effectif | Effectif total |
| Utilisateurs IT | Nombre d'utilisateurs IT |
| Chiffre d'affaires | Chiffre d'affaires annuel |
| Coûts IT vs CA | Ratio en pourcentage |
| Coûts IT par utilisateur | Montant divisé par l'effectif |
| Coûts IT par utilisateur IT | Montant divisé par les utilisateurs IT |

Une ligne de totaux est épinglée en bas.

### Export

- **Exporter le tableau en CSV** (icône de téléchargement) : Exporte la grille des ventilations détaillées
- **Exporter le graphique en PNG** (icône image) : Exporte le graphique en barres
- **Imprimer / Enregistrer en PDF** (icône imprimante)

---

## Refacturation par société

Vue détaillée des ventilations de refacturation d'une société avec départements, postes budgétaires, flux intersociétés et KPI.

### Contrôles

- **Société** : Sélectionnez la société à analyser
- **Année** : Année fiscale précédente, en cours ou suivante
- **Colonne** : Budget, Atterrissage prévu, Réalisé ou Révision
- **Totaux par département** (case à cocher) : Afficher ou masquer la ventilation par département
- **Postes de refacturation** (case à cocher) : Afficher ou masquer les ventilations détaillées par poste
- **KPI de refacturation** (case à cocher) : Afficher ou masquer le tableau comparatif des KPI
- **Flux intersociétés** (case à cocher) : Afficher ou masquer les flux partenaires
- Bouton **Exécuter** : Rafraîchir manuellement le rapport (désactivé tant qu'aucune société n'est sélectionnée)

### Ce que vous verrez

**Carte récapitulative de la société** : Nom de la société, montant total, devise de reporting, effectif, utilisateurs IT, coût par utilisateur, coût par utilisateur IT et coûts IT vs chiffre d'affaires.

**Totaux par département** (lorsque activé) :

- Nom du département, montant, part du total, effectif, coût par utilisateur
- « Coûts communs » agrège les ventilations sans département spécifique
- Graphique en barres horizontales à côté du tableau

**Postes de refacturation** (lorsque activé) :

- Nom du poste, méthode de ventilation, montant, part du total
- Ligne de totaux épinglée en bas

**Flux intersociétés** (lorsque activé) :

- Société partenaire, créances, dettes, net
- Ligne de totaux épinglée
- Bouton séparé **Exporter les flux en CSV**

**Tableau des KPI** (lorsque activé) : Mêmes colonnes que le tableau KPI de la refacturation globale, avec une ligne « Totaux globaux » en bas pour comparaison.

### Export

- **Exporter le tableau en CSV** : Exporte la grille des totaux par département
- **Exporter le graphique en PNG** : Exporte le graphique en barres des départements
- **Imprimer / Enregistrer en PDF**

---

## Top postes

Identifiez vos postes OPEX ou CAPEX les plus importants pour une année donnée.

### Contrôles

- **Type de poste** : OPEX ou CAPEX (voir [Choisir OPEX ou CAPEX](#choisir-opex-ou-capex))
- **Année** : Année précédente, en cours ou suivante
- **Métrique** : Budget, Révision, Réalisé ou Atterrissage prévu
- **Nombre top** : Combien de postes afficher (par défaut : 10, minimum : 1)
- **Type de graphique** : Graphique en secteurs ou en barres horizontales
- **Exclure des postes** : Autocomplétion multi-sélection pour exclure des postes spécifiques
- **Exclure des comptes** : Autocomplétion multi-sélection pour exclure des comptes spécifiques

### Ce que vous verrez

**Graphique** : Graphique en secteurs ou en barres horizontales des postes les plus importants. Son titre nomme le type, par exemple « Top 10 CAPEX · Budget 2026 ».

**Colonnes du tableau** :

- Poste
- Valeur pour la métrique et l'année sélectionnées
- Part du total (pourcentage)

**Cartes récapitulatives sous le tableau** :

- Total du Top N (avec pourcentage de la métrique filtrée)
- Valeur totale pour la métrique sélectionnée à travers tous les postes

### Cas d'usage

Utilisez ce rapport pour repérer rapidement où va la majeure partie de votre budget IT et identifier les candidats à l'optimisation des coûts.

---

## Top hausse / baisse

Identifiez les plus grandes variations OPEX ou CAPEX entre deux colonnes budgétaires (toute combinaison d'année et de métrique).

### Contrôles

- **Type de poste** : OPEX ou CAPEX (voir [Choisir OPEX ou CAPEX](#choisir-opex-ou-capex))
- **Année source** et **Métrique source** : La colonne de référence pour la comparaison
- **Année destination** et **Métrique destination** : La colonne cible de comparaison
- **Nombre top** : Combien de postes afficher par direction (par défaut : 10)
- **Type de graphique** : Graphique en secteurs (une seule direction) ou en barres horizontales
- **Exclure des postes** : Autocomplétion multi-sélection pour exclure des postes spécifiques
- **Exclure des comptes** : Autocomplétion multi-sélection pour exclure des comptes spécifiques
- **Direction** : onglets **Hausses**, **Baisses** ou **Les deux**

Les sélecteurs d'année listent les années qui contiennent des données. Les sélecteurs de métrique proposent les quatre colonnes des rapports : Budget, Réalisé, Atterrissage prévu et Révision.

Lorsque **Les deux** est sélectionné, l'option graphique en secteurs est désactivée et le rapport bascule automatiquement en barres.

### Ce que vous verrez

**Graphique** : Visualisation des plus grandes variations. Son titre nomme le type, par exemple « Top 10 hausses OPEX ».

**Colonnes du tableau** :

- Poste
- Valeur source (précédente)
- Valeur destination (actuelle)
- Delta (variation absolue)
- Pourcentage d'augmentation

**Cartes récapitulatives sous le tableau** :

- Totaux de la sélection (montants de hausse et/ou baisse, avec sommes source/destination)
- Variations brutes à travers tous les postes (avec pourcentage de couverture)
- Augmentation ou diminution nette à travers tous les postes

### Cas d'usage

Utilisez ce rapport pour identifier les dépassements de coûts, repérer les opportunités d'économies et expliquer les écarts d'une année sur l'autre lors des revues budgétaires.

---

## Tendance budgétaire (OPEX)

Comparez les métriques OPEX sur plusieurs années sur un seul graphique en courbe.

### Contrôles

- **Année de début** : Début de la plage (année en cours moins 2 à plus 2)
- **Année de fin** : Fin de la plage
- **Métriques** : Multi-sélection parmi Budget, Réalisé, Atterrissage prévu, Révision (au moins une requise)

### Ce que vous verrez

**Graphique** : Graphique en courbe avec une série par métrique sélectionnée, tracée sur la plage d'années.

**Tableau** : Une ligne par métrique sélectionnée, avec des colonnes d'années affichant les totaux.

### Export

- **Exporter le tableau en CSV**
- **Exporter le graphique en PNG**
- **Imprimer / Enregistrer en PDF**

---

## Tendance budgétaire (CAPEX)

Disposition identique au rapport de tendance OPEX, mais exploitant les données budgétaires CAPEX.

### Contrôles

- **Année de début**, **Année de fin**, **Métriques** : Identiques au rapport de tendance OPEX

### Ce que vous verrez

- Graphique en courbe des totaux CAPEX par métrique sur les années
- Tableau récapitulatif avec colonnes d'années

---

## Comparaison de colonnes budgétaires

Comparez de manière flexible jusqu'à 10 combinaisons année+colonne pour OPEX ou CAPEX.

### Contrôles

- **Type de poste** : Bascule OPEX ou CAPEX
- **Sélections** : Chaque sélection a un sélecteur d'année et un sélecteur de colonne (Budget, Révision, Réalisé, Atterrissage prévu). Ajoutez des sélections avec le bouton **Ajouter** et supprimez avec l'icône de suppression. Maximum 10 sélections ; minimum 1.
- **Regroupement par année** (case à cocher) : Lorsque activé et qu'au moins deux années partagent une métrique, bascule vers un graphique en courbe groupé avec une série par métrique et les années sur l'axe X. Lorsque désactivé, affiche un graphique en courbe plat avec chaque sélection comme point de données.

### Ce que vous verrez

**Graphique** :

- Mode par défaut : Graphique en courbe avec chaque sélection sur l'axe X et son total sur l'axe Y
- Mode regroupement par année : Graphique en courbe avec les années sur l'axe X et une ligne par métrique

**Tableau** :

- Mode par défaut : Libellé de sélection, année, nom de colonne, total
- Mode regroupement par année : Colonne année, puis une colonne par métrique avec les totaux

### Export

- **Exporter le tableau en CSV**
- **Exporter le graphique en PNG**
- **Imprimer / Enregistrer en PDF**

---

## Comptes de consolidation

Consultez les données budgétaires OPEX ou CAPEX regroupées par compte de consolidation, avec un type de graphique qui s'adapte à la plage d'années.

### Contrôles

- **Type de poste** : OPEX ou CAPEX (voir [Choisir OPEX ou CAPEX](#choisir-opex-ou-capex))
- **Année de début** et **Année de fin** : Année précédente, en cours ou suivante
- **Métrique** : Budget, Réalisé, Atterrissage prévu ou Révision
- **Type de graphique** : Graphique en secteurs ou en barres horizontales (disponible uniquement pour une seule année sélectionnée)
- **Exclure des comptes** : Autocomplétion multi-sélection pour exclure des comptes spécifiques

### Ce que vous verrez

**Mode année unique** :

- Graphique en secteurs ou en barres horizontales des totaux par compte de consolidation
- Note de bas de page avec le total pour la métrique sélectionnée

**Mode multi-années** :

- Graphique en courbe avec une série par compte de consolidation, tracé sur les années

**Tableau** : Une ligne par compte de consolidation avec des colonnes d'années. Une ligne de totaux épinglée en bas additionne tous les groupes.

Les postes sans compte de consolidation apparaissent comme « Non assigné ».

---

## Dimensions analytiques

Consultez les données budgétaires OPEX ou CAPEX regroupées par dimension analytique. La disposition reprend celle du rapport Comptes de consolidation.

### Contrôles

- **Type de poste** : OPEX ou CAPEX (voir [Choisir OPEX ou CAPEX](#choisir-opex-ou-capex))
- **Année de début** et **Année de fin** : Année précédente, en cours ou suivante
- **Métrique** : Budget, Réalisé, Atterrissage prévu ou Révision
- **Type de graphique** : Graphique en secteurs ou en barres horizontales (année unique uniquement)
- **Exclure des dimensions analytiques** : Autocomplétion multi-sélection pour exclure des dimensions spécifiques

### Ce que vous verrez

**Mode année unique** :

- Graphique en secteurs ou en barres des totaux par dimension analytique
- Note de bas de page avec le total de la métrique

**Mode multi-années** :

- Graphique en courbe avec une série par dimension analytique

**Tableau** : Une ligne par dimension analytique avec des colonnes d'années. Une ligne de totaux épinglée en bas. Les postes sans dimension analytique apparaissent comme « Non assigné ».

---

## Fonctionnalités communes

Chaque rapport partage ces capacités via la barre d'outils partagée :

### Options d'export

- **Exporter le tableau en CSV** (icône de téléchargement) : Télécharge les données du tableau principal
- **Exporter le graphique en PNG** (icône image) : Télécharge le graphique en tant qu'image PNG
- **Imprimer / Enregistrer en PDF** (icône imprimante) : Ouvre la boîte de dialogue d'impression du navigateur. Vous pouvez aussi ajouter `?print=1` à n'importe quelle URL de rapport pour déclencher l'impression automatiquement au chargement.

### Métriques disponibles

Tous les rapports qui proposent un sélecteur de métrique utilisent les mêmes quatre colonnes :

| Clé | Libellé |
|-----|---------|
| `budget` | Budget |
| `revision` | Révision |
| `follow_up` | Réalisé |
| `landing` | Atterrissage prévu |

### Navigation

Chaque rapport affiche un fil d'Ariane vers le hub **Rapports**, vous permettant de changer de rapport rapidement.

---

## Conseils

- **Commencez par la refacturation globale** : Obtenez la vue d'ensemble des ventilations avant de plonger dans une société spécifique.
- **Utilisez le Top postes pour des gains rapides** : Les postes les plus importants sont vos premiers candidats à l'optimisation.
- **Comparez Budget vs Atterrissage prévu** : Utilisez le rapport Comparaison de colonnes budgétaires pour mesurer la précision des prévisions sur plusieurs années.
- **Basculez les sections sur les rapports de refacturation** : Les cases à cocher vous permettent de vous concentrer uniquement sur les données dont vous avez besoin -- départements, postes, KPI ou flux -- sans encombrement visuel.
- **Regroupement par année dans la Comparaison de colonnes budgétaires** : Lorsque vous comparez la même métrique sur plusieurs années, activez le regroupement par année pour un graphique en courbe plus lisible.
- **Exportez pour les présentations** : Les graphiques s'exportent en PNG et les tableaux en CSV, tous deux prêts pour les diaporamas ou les tableurs.
