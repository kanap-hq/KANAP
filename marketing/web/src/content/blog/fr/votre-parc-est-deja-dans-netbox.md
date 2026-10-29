---
title: Votre inventaire matériel existe déjà, il est dans Netbox
description: "L'équipe infrastructure tient Netbox à jour. KANAP le lit, aligne ses fiches d'actifs sans ressaisie, et y ajoute ce que Netbox ignore : applications, contrats, coûts."
date: 2026-09-23
topic: mapping
features: [it-landscape]
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: netbox-inventory-single-source
---

Mardi, 2 h 40. La supervision signale que PAR-ESX-04R ne répond plus. L'ingénieur d'astreinte ouvre le fichier de parc et cherche le serveur : aucune ligne à ce nom. La machine a été renommée le mois dernier, et le fichier en est resté à PAR-ESX-04.

Il lui faut vingt minutes et deux appels pour savoir quelles applications tournaient dessus, sous quel contrat de maintenance, et quel numéro composer chez le constructeur.

Le bon nom figurait pourtant quelque part. L'équipe infrastructure l'avait changé dans Netbox le jour même du renommage, comme elle y consigne chaque baie, chaque adresse et chaque numéro de série.

![La fiche Netbox du serveur PAR-ESX-01 : site, baie, numéro de série, adresse et système](/screenshots/blog/netbox-device.png)

## L'inventaire et la couche métier

Netbox dit où se trouve une machine et comment elle est branchée : site, baie, unité, numéro de série, adresse, système. Il le fait très bien, et cette information mérite d'être saisie une seule fois.

La DSI a besoin d'autres réponses. Quelles applications tournent sur ce serveur ? Quel contrat le couvre, et jusqu'à quand ? Combien coûte-t-il, et sur quel budget ? Quel incident l'a touché le mois dernier ? Ces questions sortent du périmètre de Netbox.

Dans KANAP, la fiche d'actif rassemble ces réponses : applications hébergées, contrats, postes OPEX et CAPEX, incidents, tâches. La synchronisation Netbox lui apporte une identité fiable. Elle crée les fiches d'actifs depuis Netbox et les tient à jour, et l'inventaire cesse d'être ressaisi.

## Chaque champ a un seul propriétaire

Deux référentiels finissent toujours par diverger quand la même information se modifie des deux côtés. La règle est donc stricte : les champs renseignés par Netbox sont gouvernés par Netbox, et verrouillés dans KANAP. Le reste de la fiche vous appartient.

![Les champs d'identité d'un actif lié : Netbox renseigne les champs qu'il fournit, les autres restent à compléter](/screenshots/blog/netbox-managed-fields.png)

| Gérés par Netbox | Qui restent à vous dans KANAP |
|------------------|-------------------------------|
| Nom | Environnement |
| Nom d'hôte et domaine | Notes et description |
| Numéro de série | Dates, support et garantie |
| Fabricant et modèle | Contrats et coûts |
| Baie et unité de baie | Applications hébergées sur l'actif |
| Adresse IP principale | Connexions et autres relations |
| Système d'exploitation | Pièces jointes, tâches, incidents |
| Cycle de vie | Tout le reste de la fiche |
| Site et sous-site | |

Le verrou porte seulement sur les champs que Netbox renseigne pour cet objet. Un équipement sans système déclaré dans Netbox garde un champ système libre. Vous le complétez dans KANAP, et votre valeur reste en place : une synchronisation écrit uniquement les valeurs que Netbox fournit.

KANAP lit Netbox avec un jeton d'API en lecture seule. L'équipe infrastructure garde son outil tel quel.

Votre registre d'actifs couvre aussi ce que Netbox ne décrit pas, comme une instance EC2 ou une base de données managée. Ces actifs vivent dans KANAP à côté des autres, sans alerte.

## Choisir ce qui entre

L'onglet **Correspondances** fixe le périmètre, en trois tableaux.

- **Les rôles.** Chaque rôle Netbox reçoit un type d'actif KANAP, ou **Ne pas importer**. Les serveurs entrent, les PDU et les panneaux de brassage de la même baie restent dehors. Toutes les machines virtuelles passent par une seule ligne.
- **Les sites.** Chaque site Netbox reçoit l'un de vos sites. Ses emplacements de premier niveau deviennent des sous-sites, automatiquement.
- **Les systèmes d'exploitation.** Chaque plateforme Netbox est rapprochée d'un système de votre catalogue : « Debian 12 » côté Netbox devient « Debian 12 (bookworm) » côté KANAP.

Chaque ligne affiche le nombre d'objets qu'elle couvre, donc vous voyez la portée d'un choix avant de le faire. KANAP pré-remplit ce qu'il reconnaît, et vos choix s'appliquent une fois enregistrés avec **Enregistrer les correspondances**.

![L'onglet Correspondances : chaque rôle Netbox reçoit un type d'actif ou Ne pas importer](/screenshots/blog/netbox-mappings.png)

## La première synchronisation, relue ligne à ligne

Le premier passage sur une base déjà remplie est le moment délicat. Vos actifs existent dans KANAP, parfois sous d'autres noms. Le risque est double : des doublons quand le rapprochement échoue, et surtout un mauvais lien, qui laisserait Netbox écraser la fiche d'un autre équipement.

KANAP essaie quatre pistes, dans l'ordre, et s'arrête à la première qui trouve : un lien déjà établi, le numéro de série, le nom d'hôte, le nom. Quand une piste trouve plusieurs actifs, l'objet part dans **À décider** avec les candidats.

Deux indices donnent seulement une suggestion : un nom qui commence pareil, et une adresse IP déjà portée par un actif. Les adresses sont réutilisées, partagées entre les membres d'un cluster, ou simplement périmées. L'objet attend alors dans **À décider** avec l'actif suggéré, et un clic suffit à confirmer.

> Tout rapprochement incertain passe par vous.

**Synchroniser maintenant** ouvre **Vérifier avant d'appliquer**. L'aperçu classe tout : les créations, les mises à jour champ par champ, les décisions à prendre, les objets hors périmètre, ceux qui ont disparu de Netbox. Vous corrigez sur place : lier un objet à un actif existant, en créer un nouveau, ou l'écarter pour de bon.

![L'aperçu avant application : un serveur renommé, un serveur passé en décommissionnement, un numéro de série remplacé et une décision à prendre](/screenshots/blog/netbox-preview.png)

Sur un grand parc, la revue avance par lots de 500. **Appliquer ce lot** écrit exactement ce que l'aperçu affiche. Le lot suivant attend votre lecture.

<aside class="tip">
  <b>Astuce</b>
  <p>Avant le premier passage, complétez les numéros de série dans KANAP et déclarez vos suffixes DNS dans Cartographie SI > Paramètres. Le numéro de série est le rapprochement le plus solide : il résiste aux renommages des deux côtés.</p>
</aside>

## Ensuite, le parc vit

La deuxième synchronisation dit si l'outil est fiable. Elle doit être courte : elle montre seulement ce qui a changé.

- Une machine renommée dans Netbox tient sur une ligne, avec l'ancien et le nouveau nom. C'est le cas de PAR-ESX-04 dans l'aperçu ci-dessus.
- Un emplacement renommé dans Netbox apparaît une seule fois, et tous les équipements qu'il contient suivent.
- Un serveur passé en *Decommissioning* devient **Déprécié**. Un statut *Offline* ou *Failed* s'affiche en avertissement sur la fiche, et le cycle de vie reste Actif.
- Une machine supprimée de Netbox reste dans KANAP avec ses contrats et son historique. Elle rejoint **Absents de Netbox**, et vous décidez vous-même de la passer en **Retiré**.
- Un champ géré modifié à la main dans KANAP est remis en ligne au passage suivant.

Quand deux passages manuels de suite sont propres, le second n'ayant plus rien à changer, activez la **Synchronisation automatique**. Elle tourne toutes les heures et applique les changements directement. Elle démarre après une première synchronisation manuelle appliquée sans erreur, et se met en pause tant qu'un lot reste à relire. Les cas douteux s'accumulent dans **À décider** et attendent votre décision.

## Retour à la nuit de mardi

Avec la synchronisation en place, PAR-ESX-04R existe dans KANAP sous son nom actuel depuis le passage qui a suivi le renommage. L'astreinte le trouve du premier coup. Sa fiche liste les applications qui tournent dessus, avec leur environnement. L'onglet **Support** donne le contrat de maintenance, le niveau de service, la date d'expiration et les contacts du constructeur avec leur téléphone.

La recherche prend une minute, et l'astreinte peut se consacrer à la panne.

## En pratique

La synchronisation fonctionne en cloud comme en on-premise. En cloud, KANAP doit joindre votre Netbox depuis internet. Si votre Netbox vit sur le réseau interne, l'[édition on-premise](https://kanap.net/fr/on-premise) s'installe à côté, sur votre infrastructure.

Netbox reste la référence de l'équipement, et KANAP tient la couche métier autour. Le reste du référentiel est décrit sur la page [Cartographie SI](https://kanap.net/fr/features/it-landscape).
