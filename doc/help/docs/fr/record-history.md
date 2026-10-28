# Historique des fiches

L'onglet **Historique** d'une fiche liste les modifications qui lui ont été apportées : qui a modifié quoi, et quand. Il répond aux questions courantes, comme « qui a augmenté ce montant ? » ou « quand ce contrat a-t-il été délié ? », sans passer par le journal d'audit.

!!! note "Où le trouver"
    Aujourd'hui, l'onglet **Historique** figure sur les lignes budgétaires (voir [Lignes budgétaires](budget-lines.md#historique)). Les autres fiches le recevront plus tard.

## Qui peut le voir

- Toute personne qui peut ouvrir la fiche peut lire son historique. Aucune autorisation supplémentaire n'est nécessaire.
- Avec un accès aux données limité à certaines sociétés ou à certains centres de coûts, une personne ne voit que l'historique des fiches comprises dans son accès. Voir [Accès aux données](data-access.md).

## Ce que montre une entrée

L'onglet liste une entrée par modification, la plus récente en haut. Chaque entrée indique :

- la date et l'heure de la modification ;
- son auteur : une personne, **Système** pour les modifications que KANAP fait lui-même, **Import** pour les modifications chargées depuis un fichier, ou **Plaid pour** une personne quand l'assistant a fait la modification en son nom ;
- pour la fiche elle-même, l'évènement : **Création**, **Modification** ou **Suppression** ; pour ses parties, le titre ou l'évènement de la partie ;
- chaque champ modifié, avec sa valeur avant et après (`avant → après`).

Une modification de montant indique l'année, la colonne et les valeurs avant et après.

Les historiques longs se chargent par pages : cliquez sur **Charger plus** en bas de la liste pour voir les modifications plus anciennes.

## Modifications des éléments d'une fiche

L'historique d'une ligne budgétaire liste aussi les modifications de ses éléments :

- les montants, par année et par colonne budgétaire ;
- les dimensions analytiques ;
- les ventilations ;
- les liens et les pièces jointes ;
- les contacts ;
- les applications, technologies et actifs liés ;
- les tâches.

## Fiches que vous ne pouvez pas lire

Une entrée peut nommer une fiche d'un autre module, par exemple un contrat lié à la ligne. Si vous ne pouvez pas lire ce module, ou si la fiche a été supprimée depuis, l'entrée la désigne seulement par son type, par exemple « un contrat ».

## Le journal d'audit complet

L'historique s'en tient à ce dont un lecteur a besoin. Le relevé technique complet de chaque modification, pour tout l'espace de travail, reste dans **Administration > Journal d'audit**. Voir [Journal d'audit](admin.md#journal-daudit).
