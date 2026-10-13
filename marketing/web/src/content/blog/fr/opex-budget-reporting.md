---
title: "Présenter et faire valider le budget de la DSI"
description: "Les rapports qui font passer un budget IT en comité : chiffres clés, tendances, refacturation, puis gel de la version approuvée."
date: 2026-08-31
topic: cost
author: Friedrich
authorRole: Fondateur, DSI
draft: false
updated: 2026-10-10
series:
  key: opex-budget
  part: 3
  title: "Construire le budget de la DSI"
---

Le budget est construit ; reste à le faire approuver. KANAP facilite la présentation du budget avec plusieurs rapports paramétrables qui permettent de présenter les différentes facettes du budget de façon visuelle et pragmatique. Lorsque le budget est approuvé, KANAP permet de verrouiller les colonnes concernées pour éviter toute modification ultérieure.

## Des rapports prêts à l'emploi

La section Rapports propose onze rapports préconfigurés, chacun avec tableau récapitulatif, graphique et exports. Rien à construire : vous choisissez, vous exécutez. Une ligne vous intrigue ? Dans les tops, le nom d'un poste ouvre sa fiche dans un nouvel onglet ; dans les rapports par regroupement, le nom d'un groupe ouvre la liste des postes qui le composent.

![Les rapports préconfigurés de la gestion budgétaire](/screenshots/blog/reporting-landing-2026-10.png)

## Où atterrit-on, qu'est-ce qui augmente ?

« Comparaison de colonnes budgétaires » met côte à côte Budget 2026, Atterrissage prévu 2026 et Budget 2027. L'écart entre budget et atterrissage mesure la qualité de la prévision ; l'écart entre atterrissage et 2027, l'effort demandé pour l'an prochain.

« Top hausse / baisse » nomme ensuite les lignes qui expliquent l'écart. C'est souvent la diapositive la plus intéressante à présenter !

![Le même rapport un an plus tôt : les 10 plus fortes hausses OPEX entre l'atterrissage 2025 et le budget 2026](/screenshots/blog/top-opex-increase-2026-10.png)

Enfin, « Top postes » montre en un clin d'œil les gros postes de votre budget, ceux où le budget, en général, se joue.

Ces rapports, et d'autres que vous pourrez explorer, sont entièrement paramétrables et permettent de produire rapidement des données et des graphiques solides pour soutenir votre présentation budgétaire.

## Combien de personnes, à quel coût ?

En comité, la question des prestataires arrive toujours. Les lignes en quantité × prix de l'épisode 1 y répondent sans travail supplémentaire.

« Effectifs par mois » montre les ETP mois par mois, regroupés par centre de coûts, par fournisseur, par poste ou par dimension analytique, avec la moyenne et le pic de l'année. « Coût par ETP » compare jusqu'à quatre colonnes côte à côte, par exemple l'atterrissage 2026 et le budget 2027, et passe en TJM d'un clic. Si l'équipe externe passe de 12 à 9 ETP mais que le TJM moyen monte de 6 %, la phrase se lit directement dans le tableau.

![Le coût par ETP par fournisseur, budget et atterrissage prévu 2026 côte à côte](/screenshots/blog/cost-per-fte-2026-10.png)

Les rapports budgétaires ont aussi un sélecteur « Mesure » : Montant ou ETP. Le top des hausses, la tendance ou la comparaison de colonnes se lisent alors en personnes.

## Qui paie quoi ?

« Refacturation globale » et « Refacturation par société » convertissent les ventilations de l'épisode 2 en totaux par société et/ou par département, en fonction des métriques choisies (par effectif, par CA, etc.). Ces deux rapports portent sur l'OPEX. On ne vous a jamais demandé « Combien nous coûte l'IT du département X ? ». Cette fois-ci, la réponse est prête : en montant absolu, en pourcentage, et par utilisateur !

Et même si votre société ne refacture pas les coûts, ces rapports sont une mine d'or pour identifier les coûts cachés de votre DSI, et faire prendre conscience à la direction des coûts de certaines solutions de niche qui restent peu visibles dans les « top 10 » du budget.

## Dans la structure de la direction financière

La direction financière lit le budget avec son plan de comptes, pas avec celui de la DSI. « Comptes de consolidation » regroupe le budget par compte du plan de consolidation, quelle que soit la société et son plan de comptes local. Les chiffres présentés sont ceux que le contrôle de gestion retrouvera dans ses propres tableaux.

« Dimensions analytiques » donne une autre lecture : la répartition par nature, par domaine, ou par toute autre dimension que vous aurez définie. Voir [Axe analytique du budget IT : ce que coûte la cyber](/fr/blog/la-dimension-analytique-du-budget-it).

## OPEX et CAPEX, côte à côte

Un sélecteur OPEX / CAPEX ouvre la plupart des rapports, et « Tendance budgétaire » existe pour chaque enveloppe. Fonctionnement et investissements se présentent dans la même réunion, avec les mêmes outils et les mêmes exports, en toute cohérence.

## Exporter

Chaque rapport s'exporte : tableau en CSV, graphique en PNG, page complète en PDF. Le support de présentation se monte sans capture d'écran, et vous pouvez même adapter les rapports en live pour répondre à des questions ad hoc.

Et pour la question qu'aucun rapport n'avait prévue, Plaid, l'agent IA intégré, interroge les mêmes données en langage naturel : « total du budget 2027 par fournisseur », « ETP budgétés par centre de coûts ». La réponse nomme les postes par leur référence (`OPX-12`, `CPX-3`), que vous retrouvez aussitôt dans la liste.

## La phase de revue

Le budget est rarement validé du premier coup. C'est tout l'objet de la colonne révision : y mettre les versions de travail des postes affectés par des coups de rabot ou, qui sait, des renforts budgétaires, puis réintégrer les données des cases vides depuis le budget (même mécanique qu'à l'épisode 2).

Vous construisez ainsi en quelques clics une variante complète du budget, qui peut ensuite être recopiée (en écrasant les données, cette fois) vers la colonne budget après validation. 

## Verrouiller

Budget approuvé ? Dans Administration, « Geler / Dégeler les données » permet de verrouiller des colonnes. Par exemple, verrouillez la colonne Budget 2027, OPEX et CAPEX. Les colonnes gelées passent en lecture seule partout : saisie, imports CSV, copies. Les chiffres validés en comité ne bougeront plus et serviront de référence solide pour le prochain cycle. Geler la colonne par défaut fige aussi les taux de change de l'année : les montants convertis en devise de reporting ne bougeront plus.

En trois épisodes, nous avons parcouru un cycle budgétaire complet : préparation d'un atterrissage fiable, établissement du budget 2027, préparation des chiffres clés et de la présentation budgétaire, révision et verrouillage.

Tout est prêt pour le prochain cycle !