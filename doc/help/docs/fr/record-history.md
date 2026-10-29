# Historique des fiches

L'historique d'une fiche liste les modifications qui lui ont été apportées : qui a modifié quoi, et quand. Il répond aux questions courantes, comme « qui a augmenté ce montant ? » ou « quand ce contrat a-t-il été délié ? », sans passer par le journal d'audit.

## Où le trouver

- **Onglet Historique**, le dernier onglet de la fiche : lignes budgétaires (voir [Lignes budgétaires](budget-lines.md#historique)), sociétés, départements, fournisseurs, sites, connexions, interfaces, actifs et technologies.
- **Bouton Historique** dans l'en-tête, qui ouvre l'historique dans un panneau latéral : comptes, centres de coûts, calendriers de jours ouvrés, processus métier, dimensions et valeurs analytiques, et contacts.
- **Onglet Historique** dans le panneau de droite d'un document de la base de connaissances.

## Qui peut le voir

- Toute personne qui peut ouvrir la fiche peut lire son historique. Aucune autorisation supplémentaire n'est nécessaire.
- Avec un accès aux données limité à certaines sociétés ou à certains centres de coûts, une personne ne voit que l'historique des fiches comprises dans son accès. Voir [Accès aux données](data-access.md).

## Ce que montre une entrée

L'historique liste une entrée par modification, la plus récente en haut. Chaque entrée indique :

- la date et l'heure de la modification ;
- son auteur : une personne, **Système** pour les modifications que KANAP fait lui-même, **Import** pour les modifications chargées depuis un fichier, ou **Plaid pour** une personne quand l'assistant a fait la modification en son nom ;
- pour la fiche elle-même, l'évènement : **Création**, **Modification** ou **Suppression** ; pour ses parties, le titre ou l'évènement de la partie ;
- chaque champ modifié, avec sa valeur avant et après (`avant → après`).

Une modification de montant indique l'année, la colonne et les valeurs avant et après.

Les historiques longs se chargent par pages : cliquez sur **Charger plus** en bas de la liste pour voir les modifications plus anciennes.

## Modifications des éléments d'une fiche

L'historique liste aussi les modifications des éléments d'une fiche. Sur une ligne budgétaire, par exemple :

- les montants, par année et par colonne budgétaire ;
- les dimensions analytiques ;
- les ventilations ;
- les liens et les pièces jointes ;
- les contacts ;
- les applications, technologies et actifs liés ;
- les tâches.

## Fiches que vous ne pouvez pas lire

Une entrée peut nommer une autre fiche, par exemple un contrat lié à la ligne. Si vous ne pouvez pas ouvrir cette fiche, l'entrée la désigne seulement par son type, par exemple « un contrat ». Une fiche supprimée depuis apparaît comme « un contrat supprimé ».

## Valeurs que l'historique ne montre pas

- L'adresse e-mail, les numéros de téléphone et les notes d'un contact n'apparaissent jamais.
- Pour un contenu long, l'entrée indique seulement qu'il a changé : **Contenu modifié** pour le corps d'un document de la base de connaissances, **Jours ouvrés modifiés** pour les jours d'un calendrier de jours ouvrés.

## Demander à l'assistant

[Plaid](ai-assistant.md#tool-calls) lit l'historique d'une fiche avec les mêmes droits que sa page. Demandez par exemple : « Qui a modifié les montants de BL-12 ? » ou « Qu'est-ce qui a changé sur TEC-3 cette année ? » Plaid répond à partir de l'onglet Historique seulement : pour une fiche qui n'en a pas, il dit que KANAP n'en garde pas l'historique.

## Le journal d'audit complet

L'historique s'en tient à ce dont un lecteur a besoin. Le relevé technique complet de chaque modification, pour tout l'espace de travail, reste dans **Administration > Journal d'audit**. Voir [Journal d'audit](admin.md#journal-daudit).
