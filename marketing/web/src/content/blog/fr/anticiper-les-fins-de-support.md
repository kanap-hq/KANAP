---
title: "Anticiper les fins de support"
description: "Windows Server 2012, SQL Server 2016, Ubuntu 20.04 : la date de fin de support est connue, ce qui en dépend l'est rarement. Le rapport des fins de support de Kadratis nomme les serveurs et les applications touchés, assez tôt pour budgéter la migration."
date: 2026-11-07
topic: mapping
features: [it-landscape]
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: anticipate-end-of-support
---

Octobre 2023 : Windows Server 2012 sort de son support étendu. Beaucoup de DSI l'ont appris par un audit, ou par le devis du support étendu payant. La date était connue depuis des années. Ce qui manquait, c'est la liste des applications qui tournaient encore dessus, et donc le coût de leur migration.

Le constat vaut pour chaque version d'un système d'exploitation, d'une base de données, d'un hyperviseur ou d'un équipement. Savoir qu'une version arrive en fin de support ne suffit pas : il faut savoir ce qu'elle porte, qui en répond, et le savoir assez tôt pour que la migration entre dans le budget de l'année.

Voici comment Kadratis y répond : une vue de toutes les échéances, ce que touche chacune, et la liste des données à compléter pour que la réponse soit juste.

## Une vue, quatre types d'échéances

![La vue Échéances du rapport des fins de support, à 24 mois : systèmes d'exploitation, bases de données, applications et matériel.](/screenshots/end-of-support-deadlines-2026-11-07.png)

Le rapport s'ouvre depuis **Cartographie SI > Fins de support**. Sa vue Échéances réunit quatre types d'échéances :

- **Les technologies** : une version en service sur un serveur, ou déclarée par une application. SQL Server 2016, vSphere 7, Tomcat 9.
- **Les systèmes d'exploitation** : Windows Server, les distributions Linux, AIX, en service sur vos serveurs.
- **Les applications** : leur propre date de fin de support, celle que l'éditeur annonce pour votre version.
- **Le matériel** : la fin de vie d'un équipement physique, ou la fin de son contrat de support.

On choisit l'horizon, 6, 12, 24 ou 36 mois. Chaque ligne porte un état : hors support, support étendu, fin proche. Ce qui est retiré ou que plus rien n'utilise n'apparaît pas.

Les dates viennent de deux sources. Celles des technologies et des systèmes d'exploitation viennent du catalogue, alimenté par endoflife.date et par les pages des éditeurs que Kadratis relève : personne ne les saisit, et elles suivent quand un éditeur les déplace. Celles des applications et du matériel viennent de vos fiches : la date de fin de support saisie sur l'application, la fin de vie ou la fin du contrat de support saisie sur l'actif. L'article [Technologies : le lien entre serveurs et applications](/fr/blog/technologies-le-lien-entre-serveurs-et-applications) explique comment ce catalogue est tenu.

## Ce que touche chaque échéance

![Une ligne dépliée : les serveurs qui portent la version et les applications qui en dépendent.](/screenshots/end-of-support-impact-2026-11-07.png)

Chaque ligne donne deux compteurs, serveurs et applications. Un clic la déplie : les noms apparaissent, et chacun ouvre sa fiche.

Kadratis suit les liens de la cartographie pour les trouver :

- **Une version de technologie** touche les serveurs où elle est installée, et les applications qui la déclarent ou tournent sur ces serveurs, machines virtuelles comprises.
- **Un équipement physique** en fin de vie touche les serveurs qu'il porte, ce qu'ils contiennent, et les applications déployées sur l'ensemble.
- **Un cluster** compte ses membres : SQL Server installé sur le cluster touche chacun de ses nœuds. L'article [Les clusters dans la cartographie Kadratis](/fr/blog/les-clusters-dans-la-cartographie-kadratis) détaille ces règles.

La réponse ne s'arrête donc pas à « Ubuntu 20.04 est hors support ». Elle nomme les serveurs et les applications qui en dépendent, et chaque fiche d'application donne son responsable et sa criticité. La discussion sur la migration commence avec les bonnes personnes.

## Commencer par ce qui manque

![La vue Données manquantes : les fiches à compléter pour que les échéances soient justes.](/screenshots/end-of-support-missing-data-2026-11-07.png)

Un rapport n'est juste que si les données le sont. Un serveur sans ses technologies n'apparaîtra jamais dans les échéances, et une version sans date non plus. C'est pourquoi le rapport a une seconde vue, Données manquantes, qui liste ce qui l'empêche de répondre :

- un serveur de base de données qui ne porte aucune technologie de base de données ;
- une application qui utilise le SSO sans technologie d'identité ;
- un serveur ou une application qui utilise une technologie sans dire quelle version ;
- une machine virtuelle sans hôte.

Chaque ligne ouvre la fiche à compléter. C'est la partie la plus utile pour démarrer : elle montre où la cartographie a encore des trous.

Kadratis ne scanne pas vos serveurs. Il sait ce que vous y avez déclaré, à la main, par un fichier CSV ou par Netbox.

## Du rapport au budget

Une migration prévue l'an prochain a besoin de son budget cette année. Passez la vue à 24 mois au moment de préparer le budget : ce qui finit dans cet horizon est ce qu'il faut chiffrer maintenant.

L'export CSV ou Excel donne la liste à joindre à l'arbitrage. Kad, l'assistant intégré à Kadratis, répond aussi directement : « Quelles applications arrivent en fin de support dans les six mois ? »

Une fois la migration décidée, elle prend place dans le même outil : une ligne de [budget](/fr/features/budget) ou un projet, liés à la technologie, au serveur ou aux applications concernés. Ce lien se crée à la main ; il permet ensuite de lire sur la fiche de la technologie ce que sa migration coûte.

## Par où commencer

1. **Ouvrez Données manquantes** et complétez les fiches signalées.
2. **Passez la vue Échéances à 24 mois.**
3. **Dépliez les trois premières lignes** et nommez un responsable pour chaque migration.

Pour voir le rapport sur des données réalistes, un essai gratuit de 14 jours de notre version hébergée donne accès aux données d'exemple du groupe fictif Fromage & Co, chargées en une minute. Kadratis est entièrement open source : il s'installe aussi gratuitement sur vos propres serveurs.
