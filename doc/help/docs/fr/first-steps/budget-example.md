---
title: "Votre budget IT dans KANAP en dix minutes : découvrir avec l'exemple"
description: Cinq pas sur l'exemple Fromage & Co pour voir ce que KANAP fait d'un budget IT, de la vue d'ensemble à la question posée à Plaid, en dix minutes.
---

<!--
Brouillon du 31 octobre 2026, à relire avant publication.
Dépend encore d'une décision :
- Langue des données d'exemple. Les noms cités (lignes, centres de coûts, fournisseurs) sont ceux du jeu Fromage & Co actuel, en anglais. Si le jeu est traduit, reprendre les noms. Les captures attendent cette décision et la livraison des écrans d'onboarding de la 26.11.
- Prise de rendez-vous avec le fondateur. La fin de page renvoie aux deux autres parcours ; si le rendez-vous est retenu, y ajouter son lien.
Écrit pour la 26.11 :
- Pas 1 : les tuiles budgétaires sont sur l'accueil (fusion de l'accueil de Gestion budgétaire dans l'accueil principal, prévue en 26.11). Si la fusion n'est pas livrée, écrire « Gestion budgétaire › Vue d'ensemble ».
- Pas 5 : le dépôt d'un fichier à Plaid suppose l'import par Plaid de la 26.11.
Écart avec la liste « Vos cinq premiers pas » prévue :
- Pas 1 : l'écran ne donne pas de total par société ; le pas montre le total de l'année et la tuile « Par centre de coûts ».
-->

# Votre budget IT dans KANAP en dix minutes

**Découvrir avec l'exemple** · [Commencer avec mes données](budget-own-data.md)

En dix minutes, sur le budget de Fromage & Co, vous saurez lire un budget IT dans KANAP, ouvrir une ligne et suivre ses mois, trouver les plus gros postes et les plus fortes hausses, et vérifier une réponse de Plaid, l'assistant. Fromage & Co est un groupe fromager fictif dont l'exemple est chargé dans votre espace de travail.

## 1. La vue d'ensemble

:material-clock-outline: 2 minutes

Pour chaque ligne et chaque année, KANAP garde cinq colonnes de montants, une par étape du cycle budgétaire ; la colonne par défaut, « Budget », est celle que les écrans et les rapports montrent d'abord.

**Le geste.** Ouvrez l'accueil, en cliquant sur le logo KANAP. Regardez la tuile « Budget », puis la tuile « Par centre de coûts ».

**Ce que vous lisez.** La tuile « Budget » donne trois années côte à côte, l'OPEX, le CAPEX et leur total, dans chaque colonne affichée :

- « Budget » : le budget voté ;
- « Révision » : le budget révisé en cours d'année ;
- « Réalisé » : la dépense constatée ;
- « Atterrissage prévu » : l'estimation de fin d'année ;
- « Prévision », la cinquième colonne, est masquée au départ.

Les noms se changent dans les réglages, l'ordre ne change pas. La tuile « Par centre de coûts » donne les cinq équipes qui portent le plus de budget cette année.

<!-- capture : Accueil, tuiles « Budget » et « Par centre de coûts » sur l'année en cours ; cadrer les deux tuiles côte à côte -->

## 2. Une ligne budgétaire

:material-clock-outline: 2 minutes

Une ligne budgétaire est un poste OPEX ou CAPEX ; autour d'elle, tout dit qui paie, sur quel compte, qui en répond et comment on la classe.

**Le geste.** Ouvrez « Gestion budgétaire » › « Lignes budgétaires », puis « Microsoft Enterprise (M365 + Azure + GitHub) », la plus grosse ligne de l'exemple. Ouvrez l'onglet « Budget », année en cours, puis l'onglet « Historique ».

**Ce que vous lisez.** Dans le panneau « Propriétés » : la « Société payeuse » (Fromage & Co SA), le « Compte » (612100, abonnements SaaS), le « Centre de coûts » (Workplace and support) et la « Nature de coût », une dimension analytique. Dans l'onglet « Budget » : une carte par colonne, 650 000 € au « Budget », 659 500 € en « Atterrissage prévu », et le « Résultat par mois », qui étale chaque colonne sur les douze mois et les quatre trimestres. L'onglet « Historique » garde chaque modification, avec son auteur et sa date.

<!-- capture : Gestion budgétaire › Lignes budgétaires, ligne « Microsoft Enterprise (M365 + Azure + GitHub) », onglet « Budget » de l'année en cours ; cadrer les cartes des colonnes et le résultat par mois -->

## 3. Un rapport

:material-clock-outline: 2 minutes

Les rapports répondent aux questions de la revue budgétaire ; chaque ligne d'un rapport ramène à la ligne budgétaire qui la porte.

**Le geste.** Ouvrez « Gestion budgétaire » › « Rapports », puis « Top lignes ». Revenez et ouvrez « Top hausse / baisse » : il compare par défaut l'an dernier et cette année, sur la colonne « Budget ». Cliquez sur le nom d'une ligne.

**Ce que vous lisez.** « Top lignes » classe les dix plus gros postes de l'année, avec leur part du total : Microsoft en tête, puis IT Staff Augmentation et SAP S/4HANA Maintenance. « Top hausse / baisse » donne l'écart de chaque ligne, en montant et en pourcentage : « Workday HCM » passe ainsi de 80 000 à 150 000 €, avec le déploiement de Workday dans les filiales. Le nom ouvre la ligne dans un nouvel onglet, pour comprendre la hausse.

<!-- capture : Gestion budgétaire › Rapports › « Top hausse / baisse », année précédente contre année en cours, colonne « Budget » ; cadrer le tableau des hausses -->

## 4. Une question à Plaid

:material-clock-outline: 2 minutes

Plaid lit le budget avec vos droits ; les totaux qu'il cite sont calculés par KANAP, pas par le modèle.

**Le geste.** Ouvrez « Plaid » dans la barre du haut et demandez : « Quelles sont mes cinq plus grosses lignes cette année ? »

**Ce que vous lisez.** Cinq lignes, leur montant au « Budget » et leur total, chacune avec un lien vers sa fiche. Vérifiez contre le rapport « Top lignes » du pas précédent : les trois premières sont les mêmes, aux mêmes montants.

<!-- capture : Plaid, réponse à « Quelles sont mes cinq plus grosses lignes cette année ? » ; cadrer la question et la liste des cinq lignes -->

## 5. Vos données

:material-clock-outline: 2 minutes

Un budget entre dans KANAP par un fichier, celui que vous tenez déjà : KANAP le vérifie entièrement avant d'en charger la moindre ligne.

**Le geste.** Dans « Gestion budgétaire » › « Lignes budgétaires », cliquez sur « Exporter », choisissez le format « Excel (.xlsx) » et ouvrez le fichier : c'est le format de KANAP. Puis ouvrez « Plaid », glissez votre propre fichier budget sur la zone de saisie et écrivez : « Charge ce budget ». Plaid montre comment il a lu chaque colonne ; corrigez ce qui doit l'être, puis approuvez.

**Ce que vous lisez.** Ce que Plaid a placé, ce qu'il a supposé et ce qu'il n'a pas su placer. Puis la vérification de KANAP : les « Erreurs », qui bloquent le chargement, les « Modifications » (lignes à créer, à mettre à jour, inchangées) et les « Avertissements ». Rien n'est chargé tant qu'une erreur reste.

<!-- capture : Plaid, résultat de la vérification d'un fichier budget avant chargement ; cadrer les sections « Erreurs », « Modifications » et « Avertissements » -->

## Et ensuite

Vous avez vu l'essentiel de KANAP pour le budget IT. Les deux autres parcours prennent aussi dix minutes :

- [Votre système d'information dans KANAP en dix minutes](landscape-example.md)
- [Votre portefeuille dans KANAP en dix minutes](portfolio-example.md)

Pour aller plus loin sur ce parcours : [Lignes budgétaires](../budget-lines.md), [Rapports](../reports.md), [Charger un budget depuis un tableur](../budget-file.md).
