---
title: "Votre système d'information dans KANAP en dix minutes : découvrir avec l'exemple"
description: Cinq pas sur l'exemple Fromage & Co pour voir ce que KANAP fait de votre cartographie, des flux entre applications aux fins de support et aux vulnérabilités, en dix minutes.
---

<!--
Brouillon du 31 octobre 2026, à relire avant publication.
Dépend encore d'une décision :
- Langue des données d'exemple. Les noms cités (applications, serveurs, technologies) sont ceux du jeu Fromage & Co actuel, en anglais. Si le jeu est traduit, reprendre les noms. Les captures attendent cette décision et la livraison des écrans d'onboarding de la 26.11.
- Prise de rendez-vous avec le fondateur. La fin de page renvoie aux deux autres parcours ; si le rendez-vous est retenu, y ajouter son lien.
Écrit pour la 26.11 :
- Pas 5 : le dépôt du fichier des applications à Plaid suppose l'import par Plaid de la 26.11. « Collez votre liste » n'est prévu qu'en lot suivant : la liste des technologies passe ici par Plaid, qui sait déjà créer une technologie depuis le catalogue et la relier à une application.
Points qui varient avec la date :
- Pas 3 : les dates de fin de support viennent du catalogue et ne suivent pas l'année de l'exemple ; PostgreSQL 13 restera hors support, les autres exemples peuvent changer d'état.
- Pas 4 : l'exemple ne contient aucune CVE ; elles viennent de la synchronisation des bases publiques et changent chaque jour. Aucune CVE n'est citée.
-->

# Votre système d'information dans KANAP en dix minutes

**Découvrir avec l'exemple** · [Commencer avec mes données](landscape-own-data.md)

En dix minutes, sur le système d'information de Fromage & Co, vous saurez lire un flux entre deux applications, ouvrir la fiche d'une application et voir où elle tourne, repérer ce qui sort du support et les failles qui touchent vos serveurs. Fromage & Co est un groupe fromager fictif dont l'exemple est chargé dans votre espace de travail.

## 1. La carte des applications

:material-clock-outline: 2 minutes

Une interface est un flux de données d'une application vers une autre ; la carte les dessine toutes, environnement par environnement.

**Le geste.** Ouvrez « Cartographie SI » › « Carte des interfaces ». Laissez l'« Environnement » sur « Prod ». Cliquez sur la flèche qui va de « CheeseTrack » à « SAP S/4HANA ».

**Ce que vous lisez.** Chaque nœud est une application, chaque flèche une interface, dans le sens du flux. Le panneau « Détails de l'interface » donne sa criticité, sa route (directe ou via un middleware) et ses « Points de terminaison » en production : CheeseTrack envoie chaque heure ses lots de production à SAP, pour la traçabilité. « Ouvrir l'interface » mène à sa fiche complète.

<!-- capture : Cartographie SI › Carte des interfaces, environnement Prod, panneau « Détails de l'interface » ouvert sur CheeseTrack → SAP S/4HANA ; cadrer la carte et le panneau -->

## 2. Une fiche d'application

:material-clock-outline: 2 minutes

Une fiche d'application dit ce que l'application fait pour le métier, qui en répond, avec quoi elle échange et où elle tourne.

**Le geste.** Ouvrez « Cartographie SI » › « Applications », puis « SAP S/4HANA ». Parcourez les onglets « Interfaces » et « Déploiements ».

**Ce que vous lisez.** En en-tête, la criticité : « Critique ». Dans le panneau des propriétés, les « Responsables métier » (Maria Casanova) et les « Responsables IT » (Sophie Laurent), l'éditeur et la date de « Fin de support » de l'application. L'onglet « Interfaces » sépare les flux entrants et sortants. L'onglet « Déploiements » montre un bloc par environnement avec ses serveurs : PAR-ERP-01 en production, PAR-ERP-QA-01 en QA. L'onglet « Relations » la relie aux lignes budgétaires, aux contrats et aux projets.

<!-- capture : Cartographie SI › Applications, fiche « SAP S/4HANA », onglet « Déploiements » ; cadrer l'en-tête avec la criticité, le panneau des responsables et les blocs Prod et QA -->

## 3. Les technologies et les fins de support

:material-clock-outline: 2 minutes

Chaque serveur et chaque application déclare ses technologies et leurs versions ; KANAP connaît la date de fin de support de chaque version par son catalogue, tenu à jour à partir des calendriers publics des éditeurs.

**Le geste.** Ouvrez « Cartographie SI » › « Fins de support » et choisissez l'« Horizon » « 6 mois ». Cliquez sur la ligne « PostgreSQL 13 ». Puis ouvrez la technologie elle-même, depuis « Cartographie SI » › « Technologies ».

**Ce que vous lisez.** Une ligne par version qui sort du support dans les six mois, ou qui en est déjà sortie, avec son « État » : « Hors support », « Support étendu » ou « Fin proche ». PostgreSQL 13 est hors support ; la ligne dépliée montre le serveur PAR-DB-01 et l'application qui en dépend. Sur la fiche de la technologie, la pastille « Catalogue » et la mention « Versions et dates tenues à jour depuis le catalogue » disent d'où vient la date.

<!-- capture : Cartographie SI › Fins de support, horizon 6 mois, ligne PostgreSQL 13 dépliée ; cadrer le tableau et les serveurs et applications touchés -->

## 4. Les vulnérabilités

:material-clock-outline: 2 minutes

KANAP rapproche chaque jour les vulnérabilités publiées, les CVE, des technologies et des versions que vous déclarez : vous ne voyez que celles qui touchent votre parc.

**Le geste.** Ouvrez « Cartographie SI » › « Vulnérabilités ». Triez par « Score », puis cliquez sur une CVE qui touche PostgreSQL 13. Si elle ne vous concerne pas, « Changer l'état » la passe à « Non concernée », avec une note.

**Ce que vous lisez.** Pour chaque CVE : sa « Sévérité », son « Score », si elle est « Exploitée », et son « État » (« À traiter », « Traitée », « Non concernée »). Le détail donne la technologie et la version en cause, puis les « Serveurs » et les « Applications » touchés : la liste des machines à corriger, sans recherche à la main.

<!-- capture : Cartographie SI › Vulnérabilités, détail d'une CVE PostgreSQL 13 ; cadrer la sévérité, l'état et les serveurs et applications touchés -->

## 5. Vos données

:material-clock-outline: 2 minutes

Le plus court chemin vers votre propre cartographie est la liste que vous tenez déjà : vos applications et ce sur quoi elles tournent.

**Le geste.** Ouvrez « Plaid », glissez votre fichier d'applications, en Excel ou en CSV, sur la zone de saisie et écrivez : « Importe ces applications ». Plaid montre comment il a lu chaque colonne ; corrigez, puis approuvez. Collez ensuite dans Plaid la liste de vos technologies, avec leurs versions et l'application qui les utilise : « Ajoute ces technologies et relie-les à ces applications ».

**Ce que vous lisez.** Ce que Plaid a placé, ce qu'il a supposé et ce qu'il n'a pas su placer, puis la vérification de KANAP avant tout chargement. Les technologies reconnues dans le catalogue arrivent avec leurs dates : dans la minute, vos versions apparaissent dans « Fins de support » ; leurs vulnérabilités suivent à la synchronisation suivante.

<!-- capture : Plaid, aperçu de la correspondance des colonnes d'un fichier d'applications avant import ; cadrer le tableau de correspondance et les boutons d'approbation -->

## Et ensuite

Vous avez vu l'essentiel de KANAP pour la cartographie du SI. Les deux autres parcours prennent aussi dix minutes :

- [Votre budget IT dans KANAP en dix minutes](budget-example.md)
- [Votre portefeuille dans KANAP en dix minutes](portfolio-example.md)

Pour aller plus loin sur ce parcours : [Applications](../applications.md), [Carte des interfaces](../interface-map.md), [Fins de support](../end-of-support.md), [Vulnérabilités](../vulnerabilities.md).
