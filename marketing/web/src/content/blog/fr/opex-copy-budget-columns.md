---
title: "Construire le budget DSI de l'année suivante"
description: "Du budget N+1 à partir de l'atterrissage : recopier ce qui ne change pas, simuler, puis ne retravailler que les lignes qui comptent."
date: 2026-08-30
topic: cost
author: Friedrich
authorRole: Fondateur, DSI
draft: false
updated: 2026-10-10
series:
  key: opex-budget
  part: 2
  title: "Construire le budget de la DSI"
---

L'épisode 1 a consisté en une revue ciblée : l'atterrissage 2026 a intégré les principaux mouvements et les changements majeurs de 2027 sont déjà enregistrés. Restent toutes les lignes où rien n'a changé. Les identifier et les recopier une à une est le travail le plus ingrat de la saison budgétaire. Dans KANAP, c'est un outil et quelques clics.

## Les deux passes

Dans Gestion budgétaire > Administration, ouvrez « Copier les colonnes budgétaires » et choisissez OPEX ou CAPEX en haut de la page. L'outil copie une colonne budgétaire vers une autre, d'une année vers une autre, avec un ajustement en pourcentage si besoin.

Premier passage : compléter l'atterrissage 2026. Source : Budget 2026 (ou Révision, ou Réalisé, selon votre pratique - vous pouvez enchaîner les copies, par exemple commencer par copier le réalisé puis copier la révision). Destination : Atterrissage prévu 2026. Les lignes revues à l'épisode 1 ont déjà une valeur ; l'outil les ignore et ne remplit que les cellules vides.

Deuxième passage : construire le budget 2027. Source : Atterrissage prévu 2026. Destination : Budget 2027, avec « Augmentation en pourcentage » au taux souhaité pour absorber les hausses de prix. Vos saisies manuelles de l'épisode 1 restent intactes.

## La simulation d'abord

Votre travail est précieux ! Aussi, « Copier les données » reste grisé tant qu'aucune simulation n'a tourné. La simulation liste chaque poste avec sa valeur source, sa valeur actuelle en destination et la valeur qui serait écrite. Les postes déjà renseignés apparaissent marqués « Ignoré » : ils ne seront pas modifiés. L'interrupteur « Écraser les données existantes » couvre les cas assumés ; laissez-le éteint, sauf cas particulier.

![La simulation avant copie : valeurs sources, valeurs prévisualisées et postes ignorés](/screenshots/blog/copy-budget-columns-2026-10.png)

En bas, trois totaux : source, destination actuelle, prévisualisé. Un chiffre vous surprend ? Rien n'est encore écrit. Ajustez, resimulez, copiez.

La copie suit aussi la validité des postes. Un contrat qui se termine en juin 2027 ne reçoit que six mois, marqués « Au prorata » dans la simulation ; un poste qui n'existe plus en 2027 n'est pas copié.

## Les lignes en quantité × prix

Pour un poste calculé à partir de ses lignes de quantité et de prix (voir l'épisode 1), le pourcentage ne s'applique pas au montant, mais au prix unitaire de chaque ligne. Les quantités ne bougent pas, les périodes glissent d'un an, et chaque mois se recalcule avec les jours ouvrés de 2027. Deux consultants à 650 € par jour avec +3 % deviennent deux consultants à 669,50 € par jour en 2027, sur un calendrier qui compte ses propres jours fériés.

Le total peut donc différer légèrement de « source + 3 % » : c'est voulu, l'année suivante n'a pas le même nombre de jours ouvrés. Les ETP se recalculent avec.

## Les ventilations suivent

Si vous gérez une refacturation IT interne, chaque poste porte sa règle de ventilation : effectifs, utilisateurs IT, chiffre d'affaires, ou répartition manuelle. Typiquement ce qui devient vite ingérable dans Excel. « Copier les ventilations », dans la même Administration, reporte ces règles vers 2027, pour l'OPEX comme pour le CAPEX, simulation comprise. Le « qui paie quoi » suit donc les chiffres sans ressaisie.

## Et le CAPEX ?

Les colonnes budgétaires fonctionnent à l'identique pour les investissements, et la copie aussi : même outil, même simulation, en choisissant CAPEX en haut de la page. Le plan d'investissement se décide souvent projet par projet, mais les investissements récurrents (renouvellement du parc, maintien en condition) se reportent ainsi en une passe.

## La suite

Le budget 2027 est complet : les changements connus ont été saisis à la main, tout le reste a été reporté en intégrant l'inflation. L'épisode 3 passe à la restitution : les rapports pour la présentation du budget en direction, la refacturation par société, puis le gel des chiffres approuvés.
