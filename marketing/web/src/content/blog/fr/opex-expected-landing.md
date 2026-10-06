---
title: Budget, épisode 1 - L'atterrissage
description: Dans cette première partie, nous allons fiabiliser notre atterrissage 2026 ligne par ligne, en nous aidant des outils intégrés à KANAP. Ce sera ensuite la base du budget 2027.
date: 2026-08-29
topic: cost
author: Friedrich
authorRole: Fondateur, DSI
draft: false
series:
  key: opex-budget
  part: 1
  title: Préparer le budget OPEX avec KANAP
---

Septembre. La direction financière demande une première version du budget 2027, et le fichier Excel de l'an dernier ressort du placard : deux cents lignes, huit onglets, trois versions qui ne disent plus la même chose. C'est reparti pour un tour ?

Cette série décrit la préparation d'un budget OPEX complet dans KANAP. Épisode 1 : fiabiliser l'atterrissage de l'année en cours. Épisode 2 : reporter les chiffres vers 2027. Épisode 3 : restituer, défendre, verrouiller. Le principe est le même du début à la fin : vous ne touchez qu'à ce qui change, KANAP s'occupe du reste, y compris de la présentation.

Vos lignes vivent encore dans Excel ? « Importer CSV » les charge en une fois, et la revue commence le jour même.

## L'atterrissage prévu, la colonne qui compte

Chaque poste de dépense (`OPX-12`, `OPX-47`...) porte quatre colonnes budgétaires par année : **Budget**, **Révision**, **Réalisé** et **Atterrissage prévu**, sur l'année écoulée, l'année en cours et les deux suivantes. À ce stade, l'enjeu est de savoir où et comment on finira l'année en cours. C'est le moment de sortir votre meilleure estimation de ce qu'un poste aura réellement coûté au 31 décembre !

C'est aussi le socle du budget de l'année suivante : un atterrissage soigné évite de reconduire en janvier des montants qui auraient changé dans l'année en cours.

## Filtrer comme dans Excel

Personne ne relit deux cents lignes d'un bloc. La liste OPEX se manipule comme une feuille de calcul : un filtre rapide en haut, des filtres à cases à cocher sur chaque colonne. Société payeuse, Compte, Ventilation, Devise, Responsable IT, Responsable métier, Analytique : vous cochez, la liste se resserre, et la ligne de totaux recalcule sur la sélection.

![La liste OPEX filtrée, avec la ligne de totaux qui suit la sélection](/screenshots/blog/opex-list-filters.png)

La revue se découpe alors naturellement : les prestations de service un matin, les licences le lendemain, les postes d'une filiale ensuite. Les filtres sont conservés dans l'URL ; vous ouvrez une ligne, vous revenez, la sélection n'a pas bougé.

Ou bien, si vous êtes pressés, triez simplement par montant et traitez les 20 plus grosses lignes, qui portent en général l'essentiel du budget !

## Parcourir la sélection, poste par poste

Ouvrez le premier poste de la sélection, onglet **Budget**. Les flèches Préc. / Suiv. affichent « Poste 3 sur 42 » et suivent votre liste filtrée, dans son ordre de tri. Vous avancez ligne à ligne et ne corrigez l'atterrissage que là où la réalité a divergé : un contrat renégocié, un projet décalé, une consommation cloud plus haute que prévu.

![L'onglet Budget d'un poste, avec la navigation dans la sélection](/screenshots/blog/opex-budget-tab.png)

Pour les lignes qui méritent mieux qu'un montant annuel, l'onglet Budget propose un mode **Mensuel** et un outil « Répartir un montant annuel », en linéaire ou en 4-4-5.

> Les lignes où rien n'a bougé restent vides. L'épisode 2 les remplira toutes d'un coup.

## Pendant qu'on y est : noter ce qu'on sait déjà de 2027

La colonne « Budget A+1 (2027) » est juste à côté. Profitez de la revue pour y saisir les changements déjà actés : extension de périmètre, renégociation, résiliation... Pour les fins de contrat, aucun effort de mémoire : chaque poste affiche son contrat, et chaque contrat porte sa date limite de résiliation. Les échéances 2027 se lisent dans la liste des contrats.

N'hésitez pas non plus à exploiter les notes : un petit mot (« +10 % au T3, renégociation en cours ») et vous vous remercierez dans 6 mois.

Ces montants saisis à la main ne risquent rien : la copie automatique de l'épisode 2 ne remplit que les cellules vides.

## Astuce : les devises d'abord

KANAP gère les budgets multi-devises, mais il faut y penser avant ! Dans Gestion budgétaire → Administration → **Devises**, définissez la devise de reporting, les devises par défaut OPEX et CAPEX et la liste des devises autorisées. Les taux de change se synchronisent automatiquement par exercice. Chaque poste garde sa devise ; totaux et rapports convertissent en devise de reporting.

![Les paramètres de devise : devise de reporting, devises autorisées et taux de change](/screenshots/blog/currency-settings.png)

## Et le CAPEX ?

Tout ce qui précède vaut pour les investissements : lignes `CPX`, mêmes colonnes, mêmes filtres, même navigation. La revue d'atterrissage se fait au même endroit, onglet CAPEX. L'épisode 3 montrera les deux enveloppes côte à côte.

## La suite

Au terme de cette revue, l'atterrissage 2026 est fiable sur les lignes qui ont bougé et les grands mouvements de 2027 sont déjà notés. À l'épisode 2, nous compléterons tout le reste en trois clics.