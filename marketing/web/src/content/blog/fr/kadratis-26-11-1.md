---
title: "Kadratis 26.11.1 : tout pour faciliter le démarrage"
description: "La 26.11.1 soigne la première heure dans Kadratis : un démarrage guidé dans un espace prêt à l'emploi, Kad qui répond à vos questions d'utilisation et importe vos tableurs, la même création au clavier pour toutes les fiches. Le tour de la version."
date: 2026-11-08
topic: release
features: [ai, it-landscape]
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: kanap-26-11-1
---

La première impression décide souvent de la suite. La 26.11.1 lui est consacrée :

- L'essai vous demande ce qui vous amène et vous propose trois parcours de découverte (budget, cartographie et portefeuille de projets).
- Les guides s'adaptent selon que vous utilisez la société de test ou que vous démarrez avec vos propres données.
- Kad, l'assistant IA intégré à Kadratis, répond à vos questions sur l'outil et importe vos tableurs existants en vous évitant une fastidieuse conversion.
- Toutes les fiches se créent de la même façon, et encore plus rapidement au clavier.
- Les écrans sont aussi plus légers : les textes redondants ont disparu et l'interface est plus agréable.

## Le démarrage guidé

![À la première ouverture d'un espace d'essai, Kadratis demande ce qui vous amène : le budget IT, la cartographie du SI, ou les projets et les demandes. La question suivante porte sur la façon de commencer.](/screenshots/blog/trial-first-opening-2026-11-08.png)

**Deux questions à la première ouverture.** À la première ouverture, Kadratis demande ce qui vous amène (le budget IT, la cartographie du SI, les projets et les demandes), puis comment commencer : avec l'exemple complet ou avec vos données. L'exemple, la société fictive Fromage & Co, se charge en arrière-plan dans la langue de l'espace de travail : français, anglais, allemand ou espagnol.

![L'accueil d'un espace d'essai place en tête la section du parcours choisi, avec la tuile « Vos cinq premiers pas ».](/screenshots/blog/trial-first-steps-2026-11-08.png)

**Cinq premiers pas par parcours.** L'accueil met en tête la section du parcours choisi, avec la tuile **Vos cinq premiers pas**. Chaque étape ouvre son écran avec une indication courte. Le manuel a une nouvelle section [Premiers pas](https://doc.kadratis.com/fr/first-steps/budget-example/), un guide court par parcours et par mode pour détailler les étapes, et le bouton Aide mène au guide de cette étape.

**Kad en une case à cocher.** Pendant l'essai, un administrateur active Kad depuis sa page en un clic. Les questions suggérées suivent votre parcours.

**Kad répond à vos questions sur Kadratis.** Kad lit le manuel de la version installée. À une question « comment faire… », il répond avec le lien vers la section du manuel. Le serveur MCP lit le même manuel.

**Un espace prêt à l'emploi.** Un nouvel espace de travail démarre déjà équipé, qu'il s'agisse d'un essai, d'une réinitialisation ou du premier démarrage d'une installation on-premise. Les données que vous chargez y trouvent aussitôt leur place :

- quatre dimensions analytiques pour classer les lignes budgétaires, avec leurs valeurs, dans la langue de l'espace : Nature de coût, Domaine IT, Motif et Priorité ;
- un plan comptable ;
- Windows Server et Ubuntu dans les technologies, avec leur fin de support et leurs vulnérabilités déjà suivies ;
- trois sources de demande (Informatique, Métier, Conformité) et cinq catégories de projets, dans la langue de l'espace, pour classer vos premières demandes ;
- des modèles de phase et des critères d'évaluation pour le portefeuille.

Ce sont des valeurs ordinaires : vous les renommez, les complétez ou les supprimez comme les autres.

## La même création pour toutes les fiches

![Une nouvelle application en cours de création : le nom saisi dans l'en-tête, les boutons Créer et Annuler, et tous les onglets déjà disponibles.](/screenshots/blog/create-at-title-2026-11-08.png)

Toutes les fiches de Kadratis partagent maintenant la même interface de création. Vous tapez le nom dans l'en-tête, et la fiche existe aussitôt, avec tous ses onglets. Les champs obligatoires sont vérifiés au moment de créer.

**Partout dans Kadratis.** Applications, demandes, projets, incidents, lignes budgétaires, contrats, actifs, connexions, interfaces, tâches, documents, processus métier, et les données de référence, des sociétés aux sites. Une interface attend en plus ses applications source et cible.

**Rapide au clavier.** Tapez le nom et validez avec Entrée, ou pressez Tab pour passer aux champs obligatoires encore vides et à la description. Faites Ctrl+S pour créer la fiche. Pendant la création, l'en-tête montre deux boutons : **Créer** crée la fiche et vous ramène d'où vous veniez, **Annuler** la supprime.

## Kad importe vos tableurs

![Dans Kad, la correspondance d'un tableur d'applications : pour chaque colonne de l'import, la colonne du fichier lue, le degré de confiance, puis les premières lignes.](/screenshots/blog/plaid-import-mapping-2026-11-08.png)

Vous avez déjà des fichiers pour votre budget, vos applications, vos actifs, au format Excel ou CSV. Vous pouvez maintenant les donner directement à Kad, qui les adapte au format de chargement de Kadratis.

**Joignez le fichier, Kad fait la correspondance.** Kad accepte un classeur `.xlsx` ou un fichier CSV, jusqu'à 5 Mo et 20 000 lignes. Demandez-lui de l'importer dans une liste. Pour chaque colonne de l'import, il montre la colonne de votre fichier qu'il lit et son degré de certitude, comment il a lu les dates, les nombres et les valeurs du catalogue, ce qu'il n'a pas su lire, et les premières lignes telles qu'elles seront importées. Vous corrigez dans la conversation (« la colonne Owner, c'est le responsable IT ») ou vous approuvez.

![Une fois approuvée, la carte montre le résultat de l'import : six applications créées, et le fichier préparé à télécharger en .xlsx.](/screenshots/blog/plaid-import-result-2026-11-08.png)

**L'import de la liste, avec vos droits.** À l'approbation, Kad passe par l'import de la liste, avec ses contrôles et vos droits : il importe ce que vous pourriez importer vous-même. La carte montre ce qui a été créé, mis à jour ou refusé, avec les numéros de ligne de votre fichier. Le fichier préparé se télécharge en `.xlsx`, et le journal d'audit enregistre chaque import. Le modèle d'IA ne reçoit qu'un résumé du fichier.

**Des imports plus simples, avec ou sans Kad.** Les principaux dialogues d'import proposent **Télécharger un exemple** : un classeur avec des lignes d'exemple et les valeurs admises. Les colonnes portent leur titre dans la langue de l'écran, et l'import lit ces titres dans toutes les langues.

## Les processus métier à la manière d'ISO 9001

![La liste des processus métier en arbre, avec la colonne Type et le processus parent.](/screenshots/blog/business-processes-tree-2026-11-08.png)

Une cartographie des processus est presque toujours hiérarchique : macro-processus, processus, sous-processus. Kadratis la décrit ainsi.

**Un type et un parent.** Chaque processus prend un type ISO 9001 (pilotage, réalisation ou support) et un processus parent. La liste s'affiche en arbre, les sélecteurs montrent le chemin complet (Parent › Enfant), et la recherche trouve un processus par le nom de son type. Sa page suit celle des autres fiches, onglet Historique compris. Voir la page [Processus métier](https://doc.kadratis.com/fr/business-processes/) du manuel.

## Améliorations de la personnalisation

**Un logo pour le mode sombre.** La personnalisation accepte un second logo, que le mode sombre affiche.

**Le nom de votre espace.** Le nom de l'espace de travail, réglé dans **Administration > Personnalisation**, apparaît dans l'onglet du navigateur, comme nom de l'application installée, dans l'objet et l'en-tête des mails et sur la page d'autorisation des outils d'IA connectés par MCP. Sans logo, il remplace le logo dans l'en-tête et sur la page de connexion. Les mails de réinitialisation du mot de passe et d'invitation portent le logo et la couleur de l'espace. Voir la page [Personnalisation](https://doc.kadratis.com/fr/branding/) du manuel.

## Autres améliorations

- **Des écrans plus légers.** Les phrases d'aide qui répétaient l'évidence ont quitté tous les espaces, du budget à l'administration. Les explications encore utiles s'ouvrent depuis une icône d'information à côté du libellé.
- **Un accueil à votre main.** L'accueil regroupe ses tuiles en sections (Mon travail, Portefeuille, Cartographie SI, Gestion budgétaire). Vous réordonnez, masquez ou ajoutez sections et tuiles sur place, et une tuile qui n'a rien à montrer est masquée.
- **Accès limité aux données** : les personnes limitées à une partie du budget modifient les fournisseurs et les contacts, comme leur rôle le permet. Supprimer et importer restent réservés aux personnes qui ont accès à toutes les données.
- **Un actif a toujours un site**, que vous pouvez créer depuis l'actif. Un site qui contient encore des actifs ne peut plus être supprimé.
- **Le budget va à l'essentiel.** La liste budgétaire s'ouvre sur ses montants, l'onglet Budget d'une ligne sur son graphique, et la tuile Budget de l'accueil montre le total par année (OPEX et CAPEX au survol).
- **Mot de passe réinitialisé, compte débloqué** : une réinitialisation terminée lève le blocage dû aux tentatives échouées.
- **Le coût de l'IA, réponse par réponse.** Chaque modèle d'IA peut recevoir un effort de raisonnement, et **Utilisation & coûts** compte le coût de chaque réponse de Kad.

Cette version met aussi à jour les dépendances de l'API, de l'interface et du site, et corrige des vulnérabilités publiées.

## Mettre à jour

Sur le service hébergé, il n'y a rien à faire : vous êtes déjà en 26.11.1.

Si vous hébergez Kadratis et suivez la branche stable, passez directement à la 26.11.1, après avoir lu la section on-premise des [notes de version](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.1). Si votre installation est antérieure à la 26.10.1, passez-la d'abord sur `stable`, comme l'explique le [guide d'exploitation](https://doc.kadratis.com/fr/on-premise/operations/#procedure-de-mise-a-jour).

## Suivre les nouvelles versions

- **Sur GitHub** : suivez le dépôt et choisissez « Releases » pour être prévenu à chaque version.
- **Sur le blog** : abonnez-vous au [flux RSS](/fr/blog/rss.xml).
- **Sur le site** : le [changelog](/fr/changelog) liste tous les articles de version.

[Détails techniques et liste complète des changements](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.1)
