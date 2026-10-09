---
title: "Construire le budget DSI de l'année suivante"
description: "Du budget N+1 à partir de l'atterrissage : recopier ce qui ne change pas, simuler, puis ne retravailler que les lignes qui comptent."
date: 2026-08-30
topic: cost
author: Friedrich
authorRole: Fondateur, DSI
draft: false
series:
  key: opex-budget
  part: 2
  title: "Construire le budget de la DSI"
---

L'épisode 1 a consisté en une revue ciblée : l'atterrissage 2026 a intégré les principaux mouvements et les changements majeurs de 2027 sont déjà enregistrés. Restent toutes les lignes où rien n'a changé. Les identifier et les recopier une à une est le travail le plus ingrat de la saison budgétaire. Dans KANAP, c'est un outil et quelques clics.

## Les deux passes

Dans Administration, ouvrez « Copier les colonnes budgétaires ». L'outil copie une colonne budgétaire vers une autre, d'une année vers une autre, avec un ajustement en pourcentage si besoin.

Premier passage : compléter l'atterrissage 2026. Source : Budget 2026 (ou Révision, ou Réalisé, selon votre pratique - vous pouvez enchaîner les copies, par exemple commencer par copier le réalisé puis copier la révision). Destination : Atterrissage prévu 2026. Les lignes revues à l'épisode 1 ont déjà une valeur ; l'outil les ignore et ne remplit que les cellules vides.

Deuxième passage : construire le budget 2027. Source : Atterrissage prévu 2026. Destination : Budget 2027, avec « Augmentation en pourcentage » au taux souhaité pour absorber les hausses de prix. Vos saisies manuelles de l'épisode 1 restent intactes.

## La simulation d'abord

Votre travail est précieux ! Aussi, « Copier les données » reste grisé tant qu'aucune simulation n'a tourné. La simulation liste chaque poste avec sa valeur source, sa valeur actuelle en destination et la valeur qui serait écrite. Les postes déjà renseignés apparaissent marqués [SKIP] : ils ne seront pas modifiés. L'interrupteur « Écraser les données existantes » couvre les cas assumés ; laissez-le éteint, sauf cas particulier.

![La simulation avant copie : valeurs sources, valeurs prévisualisées et postes ignorés](/screenshots/blog/copy-budget-columns.png)

En bas, trois totaux : source, destination actuelle, prévisualisé. Un chiffre vous surprend ? Rien n'est encore écrit. Ajustez, resimulez, copiez.

## Les ventilations suivent

Si vous gérez une refacturation IT interne, chaque poste porte sa règle de ventilation : effectifs, utilisateurs IT, chiffre d'affaires, ou répartition manuelle. Typiquement ce qui devient vite ingérable dans Excel. « Copier les ventilations », sur la même page, reporte ces règles vers 2027, simulation comprise. Le « qui paie quoi » suit donc les chiffres sans ressaisie.

## Et le CAPEX ?

Les colonnes budgétaires fonctionnent à l'identique pour les investissements. La copie de colonnes, elle, reste propre à l'OPEX, et c'est cohérent : le plan d'investissement se décide projet par projet.

## La suite

Le budget 2027 est complet : les changements connus ont été saisis à la main, tout le reste a été reporté en intégrant l'inflation. L'épisode 3 passe à la restitution : les rapports pour la présentation du budget en direction, la refacturation par société, puis le gel des chiffres approuvés.
