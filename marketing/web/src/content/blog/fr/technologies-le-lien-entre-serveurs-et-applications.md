---
title: "Technologies : le lien entre serveurs et applications"
description: "SQL Server, vSphere, Active Directory, Entra ID : ce qui tourne entre vos applications et vos serveurs manque à la plupart des référentiels. Avec un catalogue pré-rempli, KANAP en fait le maillon qui relie fins de support, vulnérabilités, accès à privilèges et coûts."
date: 2026-10-30
topic: mapping
features: [it-landscape]
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: technologies-link-servers-applications
---

On décide de faire évoluer SQL Server 2016. Première question : qui en dépend ? La liste des applications ne le dit pas. Celle des serveurs donne le système d'exploitation et s'arrête là. Il reste à interroger les équipes, une par une, et à espérer que personne n'oublie une base installée il y a six ans.

La même question revient sous d'autres formes. Entra ID tombe : quelles applications ne connectent plus leurs utilisateurs ? Le contrat vSphere arrive à renouvellement : combien nous coûte-t-il, et pour quels serveurs ?

Ce qui tourne entre les serveurs et les applications est le lien qui manque à la plupart des référentiels. Voici comment KANAP le tient, sans saisie fastidieuse, et les bénéfices qu'on peut en tirer.

## Logique de classement

KANAP décrit le système d'information en trois types d'objets :

- **Les applications** : ce dans quoi les métiers travaillent. L'ERP, le CRM, la paie, l'intranet.
- **Les technologies** : ce que la DSI fait tourner ou souscrit pour que ces applications fonctionnent. SQL Server, vSphere, Active Directory, Entra ID, Tomcat.
- **Les actifs** : où cela tourne. Serveurs, machines virtuelles, clusters, bases de données cloud.

Le critère est donc simple : une technologie, c'est un produit dans lequel personne ne travaille, mais dont la panne fait tomber ou expose d'autres applications. Entra ID ne tourne sur aucun de vos serveurs, Active Directory tourne sur vos contrôleurs de domaine, SQL Server a une ligne par version en service : les trois sont des technologies.

## Un catalogue de 192 produits, tenu à jour

![La fenêtre du catalogue des technologies, avec une recherche par éditeur : les six produits Oracle.](/screenshots/technologies-catalog-oracle-2026-10-29.png)

Créer une technologie commence par le catalogue. On cherche le produit, on clique : KANAP crée la technologie avec son éditeur, sa famille, son type d'hébergement, ses versions et leurs dates de fin de support, y ajoute ses vulnérabilités connues et une description courte dans votre langue.

Les dates viennent d'endoflife.date, la référence ouverte des cycles de vie. Pour les produits qu'il ne couvre pas, comme Cisco NX-OS, Juniper Junos, Dell PowerStore ou WebLogic, KANAP relève les dates sur les pages officielles des éditeurs. Chaque version affiche alors sa source et le jour où la date a été vérifiée.

Une technologie adoptée reste à jour. Dans la version hébergée, chaque jour, KANAP consulte le catalogue : une nouvelle version publiée s'ajoute, une date déplacée par l'éditeur suit. Ce que vous avez saisi à la main est conservé, et une version que vous avez supprimée n'est pas recréée.

Pour la version on-premise, chaque nouvelle version de KANAP apporte les mises à jour du catalogue, ce qui ne vous empêche pas d'activer la mise à jour quotidienne depuis Internet si votre environnement le permet.

Enfin, un produit absent du catalogue peut être créé à la main ; quatre champs suffisent.

## Les versions et leur statut

![L'aperçu d'une technologie : ses versions, leurs dates de fin de support et leur statut.](/screenshots/technologies-versions-2026-10-29.png)

Une technologie porte une ligne par version, avec la fin du support standard et la fin du support étendu. KANAP en déduit un statut : supportée, fin proche quand le support standard s'arrête dans les 12 mois, support étendu, hors support, ou date inconnue.

Une ligne par version majeure suffit : 2019 et 2022 pour SQL Server, 8.0 pour vSphere. C'est sur ces lignes que reposent les serveurs, les applications et tout ce qui suit. Le rapport des fins de support, que nous présenterons dans un prochain article, part de là.

## Créer les liens

![L'onglet Applications d'une technologie, avec des lignes hébergées sur des serveurs et une ligne déclarée.](/screenshots/technologies-applications-2026-10-29.png)

Une technologie se saisit là où elle est installée : sur l'hôte pour un hyperviseur, sur chaque contrôleur de domaine pour Active Directory, sur le serveur de base de données pour SQL Server. Le reste est géré automatiquement.

- **Les machines qui en héritent indirectement** la reçoivent sans autre saisie. SQL Server installé sur un cluster apparaît sur chacun de ses membres.
- **Les applications hébergées** sur ces serveurs la reçoivent aussi : KANAP les déduit de leurs déploiements.
- **Les services en ligne** ne tournent sur aucun de vos serveurs. Entra ID se déclare alors sur les applications qui utilisent le service.

Le système d'exploitation d'un serveur est lui aussi une technologie. Le catalogue en propose quatorze : Windows Server, les principales distributions Linux, AIX, IBM i et Solaris. Il s'affiche en tête de la fiche du serveur, avec sa version et ses dates de support.

## Pour démarrer

Vos technologies peuvent être saisies au fil de l'eau ou en masse.

**Par un fichier CSV.** La liste des technologies importe et exporte les liens, serveurs et technologies d'un côté, applications et technologies de l'autre. Une vérification préalable liste ce que le chargement ferait, ligne par ligne, et rien ne se charge si une ligne est en erreur. Un import ajoute ou met à jour des liens, il n'en supprime jamais. Une version que vous ne suiviez pas encore est créée au passage.

**Netbox.** Si votre parc y est déjà, KANAP met chaque plateforme Netbox en correspondance avec un système d'exploitation : « Debian 12 » devient Debian, version 12. Les machines virtuelles rejoignent leur cluster, et reçoivent les technologies installées sur lui. Voir l'article [Votre parc est déjà dans Netbox](/fr/blog/votre-parc-est-deja-dans-netbox).

## Les bénéfices

Une fois les technologies reliées, les questions de l'introduction trouvent leur réponse sans travail supplémentaire.

- **Les fins de support sont inratables** : le rapport nomme les serveurs et les applications utilisant une version qui arrive en fin de support, à l'horizon que vous choisissez.
- **Les vulnérabilités** : les failles publiées sont rapprochées version par version, jusqu'aux applications métier. C'est le sujet de l'article [Vulnérabilités : de la CVE à l'application métier](/fr/blog/vulnerabilites-de-la-cve-a-l-application-metier).
- **Les accès à privilèges** : un service d'annuaire comme Entra ID se place dans une zone d'administration, par exemple le tier 0. La vue des zones signale les serveurs qui portent un annuaire hors de la zone la plus sensible.
- **Le coût** : l'onglet Relations d'une technologie rassemble ses contrats, avec leur échéance et leur montant annuel, et ses lignes budgétaires, avec leur total. Ce que coûte vSphere se lit sur sa fiche, à côté des serveurs qui le portent.

![L'onglet Relations de vSphere : sa ligne budgétaire et son contrat.](/screenshots/technologies-relations-vsphere-2026-10-29.png)

La fiche nomme aussi les responsables IT de la technologie et ses contacts de support, avec leurs coordonnées. Et Plaid, l'assistant intégré à KANAP, ou votre propre outil d'IA connecté par MCP, répond directement : « Quels serveurs portent encore SQL Server 2016 ? »

## Par où commencer

1. **Adoptez vos technologies depuis le catalogue**, en commençant par les systèmes d'exploitation, les bases de données et les hyperviseurs.
2. **Reliez-les aux serveurs**, sur l'hôte ou le cluster quand c'est le cas, à la main, par fichier CSV ou par Netbox.
3. **Déclarez les services en ligne** sur les applications qui les utilisent.
4. **Nommez les responsables IT** de chaque technologie.

KANAP ne découvre pas les logiciels installés sur vos serveurs et ne gère pas les licences : les liens viennent de vous, d'un fichier ou de Netbox.

Pour voir tout cela en action, un essai gratuit de 14 jours de notre version hébergée donne accès aux données d'exemple du groupe fictif Fromage & Co, chargées en une minute. KANAP est entièrement open source : il s'installe aussi gratuitement sur vos propres serveurs.
