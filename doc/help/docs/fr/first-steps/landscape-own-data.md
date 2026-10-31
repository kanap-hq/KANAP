---
title: "Votre système d'information dans KANAP en dix minutes : commencer avec vos données"
description: Cinq pas pour mettre votre propre cartographie dans KANAP, des applications aux serveurs et à la première carte des flux, puis l'ouvrir à un collègue, en dix minutes.
---

<!--
Brouillon du 31 octobre 2026, à relire avant publication.
Dépend encore d'une décision :
- Langue des données d'exemple : sans effet sur ce texte, qui ne cite aucune donnée d'exemple ; les captures attendent cette décision et la livraison des écrans d'onboarding de la 26.11, et se prendront sur un espace rempli de données vraisemblables.
- Prise de rendez-vous avec le fondateur. La fin de page renvoie aux deux autres parcours ; si le rendez-vous est retenu, y ajouter son lien.
Écrit pour la 26.11 :
- Pas 1 : le dépôt d'un fichier à Plaid suppose l'import par Plaid de la 26.11 ; « collez votre liste » n'est prévu qu'en lot suivant et n'est pas cité.
Précision par rapport à la liste « Vos cinq premiers pas » prévue :
- Pas 4 : la carte ne montre une interface que si elle a une liaison dans l'environnement affiché ; le pas fait donc ajouter la liaison en Prod, entre les déploiements créés au pas 3.
-->

# Votre système d'information dans KANAP en dix minutes

[Découvrir avec l'exemple](landscape-example.md) · **Commencer avec mes données**

En dix minutes, vous aurez vos applications, leurs technologies et leurs serveurs dans KANAP, vos premières fins de support, une première carte des flux, et un collègue pour la tenir à jour. Votre espace de travail est vide : tout ce que vous voyez à la fin vient de vous.

## 1. Vos applications

:material-clock-outline: 2 minutes

Une application est ce que le métier utilise ; sa fiche réunit sa criticité, ses responsables, ses flux et l'endroit où elle tourne.

**Le geste.** Le plus court : ouvrez « Plaid », glissez votre liste d'applications, en Excel ou en CSV, sur la zone de saisie et écrivez « Importe ces applications ». Plaid montre comment il a lu chaque colonne ; corrigez ce qui doit l'être, puis approuvez. Sans fichier : « Cartographie SI » › « Applications » › « Nouvelle application / service », un nom, puis « Créer ».

**Ce que vous lisez.** Ce que Plaid a placé, ce qu'il a supposé et ce qu'il n'a pas su placer, puis la vérification de KANAP : rien n'est chargé tant qu'une erreur reste. Dans « Applications », une fiche par application ; complétez la criticité et les « Responsables IT » des plus importantes.

<!-- capture : Cartographie SI › Applications, liste après import de quelques applications ; cadrer les colonnes Criticité, Éditeur et Responsables -->

## 2. Vos technologies

:material-clock-outline: 2 minutes

Une technologie est ce sur quoi une application repose, à une version précise ; c'est la version qui porte la date de fin de support.

**Le geste.** Ouvrez une application, onglet « Exploitation », section « Technologies », et cliquez sur « Ajouter ». Cherchez la technologie dans le catalogue, par exemple votre base de données, et choisissez sa version. Recommencez pour deux ou trois applications, puis ouvrez « Cartographie SI » › « Fins de support ».

**Ce que vous lisez.** Dans la section « Technologies », la colonne « Fin de support » se remplit seule pour toute technologie du catalogue. La page « Fins de support » liste vos versions déjà hors support ou qui le seront dans l'« Horizon » choisi, avec leur « État » : « Hors support », « Support étendu », « Fin proche ».

<!-- capture : Cartographie SI › Applications, fiche d'une application, onglet « Exploitation », section « Technologies » avec la colonne « Fin de support » ; cadrer la section -->

## 3. Vos serveurs

:material-clock-outline: 2 minutes

Un serveur est la machine, virtuelle ou physique, sur laquelle tourne un déploiement d'application ; le relier dit ce qui s'arrête quand il s'arrête.

**Le geste.** Ouvrez « Cartographie SI » › « Actifs » › « Ajouter un actif ». Saisissez le « Nom », le « Type d'actif » et l'« Environnement », puis « Créer ». Ouvrez ensuite une application, onglet « Déploiements » : « Ajouter un déploiement » en « Prod », puis « Ajouter un serveur » et choisissez le serveur créé. Pour plusieurs dizaines de serveurs, « Importer » dans la liste des actifs prend un fichier.

**Ce que vous lisez.** Le bloc « Prod » de l'application, avec son serveur. Sur la fiche du serveur, onglet « Exploitation », les « Applications hébergées ». Les fins de support et les vulnérabilités d'une technologie remontent désormais jusqu'à ce serveur.

<!-- capture : Cartographie SI › Applications, fiche d'une application, onglet « Déploiements », bloc Prod avec un serveur ; cadrer le bloc -->

## 4. Votre première carte

:material-clock-outline: 2 minutes

Une interface est un flux de données d'une application vers une autre ; la carte dessine celles qui sont en place dans un environnement donné.

**Le geste.** Ouvrez « Cartographie SI » › « Interfaces » › « Ajouter une interface ». Saisissez le « Nom », l'« Application source », l'« Application cible » et la « Catégorie de données », puis « Créer l'interface ». Dans l'onglet « Environnements », ajoutez l'environnement « Prod » et sa liaison, entre le déploiement de production de chaque application. Ouvrez enfin « Cartographie SI » › « Carte des interfaces ».

**Ce que vous lisez.** Vos deux applications reliées par une flèche, dans le sens du flux. Un clic sur la flèche ouvre les « Détails de l'interface » ; un clic sur une application, ses responsables et ses serveurs. Une interface sans liaison en Prod n'apparaît pas sur la carte en Prod : c'est voulu, la carte montre ce qui tourne.

<!-- capture : Cartographie SI › Carte des interfaces, environnement Prod, deux applications et une interface ; cadrer la carte entière -->

## 5. Un collègue

:material-clock-outline: 2 minutes

Une cartographie reste juste quand ceux qui connaissent chaque application la tiennent à jour eux-mêmes.

**Le geste.** Ouvrez « Administration » › « Utilisateurs » › « Nouveau ». Saisissez l'« E-mail » d'un responsable d'application, choisissez le rôle « Membre Cartographie SI » dans « Rôles », puis « Enregistrer et inviter ». Ajoutez-le ensuite comme « Responsables IT » de son application.

**Ce que vous lisez.** Votre collègue apparaît avec le statut « Invité » et reçoit l'e-mail « Vous êtes invité sur KANAP », avec un lien pour choisir son mot de passe. Une fois entré, il modifie les applications et les serveurs, sans pouvoir importer de fichier ; « Lecteur Cartographie SI » lui donnerait la seule lecture.

<!-- capture : Administration › Utilisateurs, fenêtre « Nouvel utilisateur » avec le rôle « Membre Cartographie SI » ; cadrer l'e-mail, les rôles et le bouton « Enregistrer et inviter » -->

## Et ensuite

Votre système d'information est dans KANAP. Les deux autres parcours prennent aussi dix minutes, sur vos données :

- [Votre budget IT dans KANAP en dix minutes](budget-own-data.md)
- [Votre portefeuille dans KANAP en dix minutes](portfolio-own-data.md)

Pour aller plus loin sur ce parcours : [Applications](../applications.md), [Technologies](../technologies.md), [Actifs](../assets.md), [Interfaces](../interfaces.md).
