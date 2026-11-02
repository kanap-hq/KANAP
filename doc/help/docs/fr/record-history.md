# Historique des fiches

L'historique d'une fiche liste les modifications qui lui ont été apportées : qui a modifié quoi, et quand. Il répond aux questions courantes, comme « qui a augmenté ce montant ? » ou « quand ce contrat a-t-il été délié ? », sans passer par le journal d'audit.

## Où le trouver

- **Onglet Historique**, le dernier onglet de la fiche : lignes budgétaires (voir [Lignes budgétaires](budget-lines.md#historique)), contrats, sociétés, départements, fournisseurs, sites, connexions, interfaces, applications, actifs, technologies, incidents, projets, demandes et tâches.
- **Bouton Historique** dans l'en-tête, qui ouvre l'historique dans un panneau latéral : comptes, centres de coûts, calendriers de jours ouvrés, processus métier, dimensions et valeurs analytiques, et contacts.
- **Onglet Historique** dans le panneau de droite d'un document de la base de connaissances.

Un incident garde aussi son onglet **Journal**. Le journal raconte ce qui s'est passé pendant l'incident. L'historique liste les modifications de la fiche.

Le fil d'activité d'un projet, d'une demande ou d'une tâche ne montre que les commentaires et les décisions. Les modifications de la fiche sont dans son historique. Sur une tâche, un commentaire écrit en changeant le statut affiche ce changement.

## Qui peut le voir

- Toute personne qui peut ouvrir la fiche peut lire son historique. Aucune autorisation supplémentaire n'est nécessaire.
- Avec un accès aux données limité à certaines sociétés ou à certains centres de coûts, une personne ne voit que l'historique des fiches comprises dans son accès. Voir [Accès aux données](data-access.md).
- Un incident restreint reste caché à qui ne peut pas le voir, de même que l'historique de ses tâches.

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

Sur les autres fiches, l'historique liste de la même façon les liens et les éléments qu'elles portent : lignes budgétaires, applications, actifs, contrats, membres de l'équipe, contacts, dépendances, liens web, documents intégrés, pièces jointes, tâches, déploiements et notes par critère.

## Fiches que vous ne pouvez pas lire

Une entrée peut nommer une autre fiche, par exemple un contrat lié à la ligne. Si vous ne pouvez pas ouvrir cette fiche, l'entrée la désigne seulement par son type, par exemple « un contrat ». Une fiche supprimée depuis apparaît comme « un contrat supprimé ».

Sur un contrat, un projet ou une demande, une personne à l'accès aux données limité voit les lignes budgétaires hors de son accès comptées, sans leur nom : « et 2 lignes hors de votre accès ».

## Valeurs que l'historique ne montre pas

- Un changement de l'adresse e-mail, du téléphone, du mobile ou des notes d'un contact se lit **E-mail modifié**, **Téléphone modifié**, **Mobile modifié** ou **Notes modifiées**. La valeur reste hors de l'historique.
- Pour un contenu long, l'entrée indique seulement qu'il a changé : **Contenu modifié** pour le corps d'un document de la base de connaissances, **Jours ouvrés modifiés** pour les jours d'un calendrier de jours ouvrés, **Description modifiée**, **Objectif modifié** ou **Situation actuelle modifiée** pour les textes longs des autres fiches.

## Demander à l'assistant

[Plaid](ai-assistant.md#tool-calls) lit l'historique d'une fiche avec les mêmes droits que sa page. Demandez par exemple : « Qui a modifié les montants de BL-12 ? » ou « Qu'est-ce qui a changé sur TEC-3 cette année ? » Plaid répond à partir de l'onglet Historique seulement : pour une fiche qui n'en a pas, il dit que KANAP n'en garde pas l'historique.

## Le journal d'audit complet

L'historique s'en tient à ce dont un lecteur a besoin. Le relevé technique complet de chaque modification, pour tout l'espace de travail, reste dans **Administration > Journal d'audit**. Voir [Journal d'audit](admin.md#journal-daudit).
