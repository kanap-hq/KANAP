---
title: "Les clusters dans la cartographie KANAP"
description: "Un SQL Server Always On, une ferme vSphere : décrivez le cluster une fois. Où poser ses applications selon le type de cluster, ce dont les membres héritent, et des vues d'impact qui comptent juste."
date: 2026-11-02
topic: mapping
features: [it-landscape]
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: server-clusters-kanap-mapping
---

Un SQL Server Always On à deux nœuds, une ferme vSphere de six hôtes. Dans un tableur ou une CMDB tenue à la main, chaque application et chaque flux réseau se recopie sur chaque nœud. Le septième hôte, ajouté l'an dernier, n'a rien reçu.

Le jour d'une panne, la question « qu'est-ce qui tombe avec cet hôte ? » reçoit alors une réponse fausse, et les vulnérabilités du nœud oublié n'apparaissent nulle part.

Dans KANAP, vous décrivez le cluster une fois. Ses membres héritent de ce qu'il porte, et toutes les vues qui comptent des serveurs comptent juste. Encore faut-il savoir où poser chaque application : la réponse dépend du type de cluster.

## Deux types de clusters, deux règles

Un cluster se crée par **Ajouter un cluster**, ou en activant l'interrupteur **Cluster** sur un actif existant. Ses membres se gèrent en haut de son onglet **Exploitation**.

Vient ensuite la question qui fait la justesse de tout le reste : où affecter les applications ?

- **Un cluster de bascule**, comme SQL Server Always On, fait tourner l'application sur chaque nœud. Affectez l'application au cluster : chaque membre en service l'héberge, avec le rôle de l'affectation.
- **Un cluster de virtualisation**, comme vSphere, fait tourner des machines virtuelles qui passent d'un hôte à l'autre. Placez les machines dans la section **Contient** du cluster, dans son onglet **Dépendances**, et affectez chaque application à sa machine virtuelle. Seule la plateforme elle-même, vSphere avec le rôle virtualisation, s'affecte au cluster.

Quelques règles évitent les incohérences. Un cluster qui a des membres n'a pas de système d'exploitation : chaque membre a le sien. Un membre ne devient pas un cluster, et un cluster n'est pas membre d'un autre.

![L'onglet Exploitation d'un cluster SQL Server : ses deux serveurs membres et les applications affectées au cluster.](/screenshots/clusters-operations-2026-11-02.png)

## Saisie unique et héritage

Ce que porte le cluster se transmet à ses membres. Un nœud ajouté l'an prochain héberge aussitôt les applications du cluster ; un nœud retiré cesse de les héberger. Un serveur retiré du parc n'hérite de rien.

L'erreur la plus courante reste d'affecter l'application à un seul nœud. Quand vous visez un membre, KANAP demande **Affecter au cluster ?**. La question nomme les membres dont l'affectation propre sera remplacée par celle du cluster, qui garde la date de mise en service la plus ancienne et leurs notes. **Ce serveur seulement** reste possible, pour l'exception réelle.

Les flux suivent la même logique. Une connexion peut partir d'un cluster, y arriver ou le traverser : elle s'applique à chaque membre en service. L'onglet **Réseau** d'un membre liste les connexions de son cluster, et la carte des connexions dessine les membres.

![La question « Affecter au cluster ? » : PAR-SQL-01 fait partie de PAR-SQL-CL01, et ses deux membres hébergeront l'application.](/screenshots/clusters-assign-2026-11-02.png)

## Des vues exactes

Le bénéfice se voit le jour où un serveur tombe. Sur la fiche d'un membre, l'onglet **Dépendances** s'ouvre sur **Si ce serveur tombe** (**Si cet actif tombe** pour une machine virtuelle). Le cluster y apparaît **Dégradé**, avec le nombre de membres tombés, et ses applications continuent de tourner sur les autres nœuds. Il ne passe **Tombé** que lorsque plus aucun membre ne tient : ses applications et ses machines virtuelles tombent alors avec lui.

Partout où KANAP cherche où s'exécute une application, il compte les membres :

- **Les vulnérabilités et la fin de support** d'une application tiennent compte de chaque nœud. Un cluster affiche les vulnérabilités de ses membres en service avec les siennes.
- **Les technologies** des membres apparaissent sur le cluster, une ligne par version, avec les membres qui la portent.
- **Les zones d'administration, les sites et les contrats** comptent les applications des membres.
- **L'assistant Plaid et Connaissances** répondent avec les mêmes règles.

Sur le cluster lui-même, l'onglet **Dépendances** replie les actifs dont dépendent ses membres, sous une ligne **Par les membres**.

![La vue d'impact d'un membre : PAR-SQL-CL01 est dégradé, un membre sur deux est tombé.](/screenshots/clusters-impact-2026-11-02.png)

## Importer plutôt que saisir

KANAP ne découvre pas vos clusters : il les décrit. Si votre parc est déjà dans Netbox, la synchronisation associe chaque cluster Netbox à un cluster KANAP et range ses machines virtuelles dans **Contient**, avec les mêmes règles. Voir [Votre parc est déjà dans Netbox](/fr/blog/votre-parc-est-deja-dans-netbox).

L'import CSV des actifs a une colonne `cluster` : elle crée de vraies appartenances, que vous retrouverez à l'export. La vérification préalable refuse un nom de cluster inconnu ou ambigu avant toute écriture.

Enfin, supprimer un membre ne se fait pas à l'aveugle : la confirmation dit quels clusters il quitte et quelles relations partent avec lui.

## Par où commencer

1. Créez vos clusters et rattachez-y leurs membres, depuis l'onglet **Exploitation**.
2. Pour un cluster de bascule, affectez les applications au cluster. Pour un cluster de virtualisation, placez les machines virtuelles dans le cluster et laissez les applications sur leurs machines.
3. Ouvrez l'onglet **Dépendances** d'un membre, et vérifiez que la réponse est correcte.

Pour voir comment les technologies relient ces serveurs à vos applications, lisez [Technologies : le lien entre serveurs et applications](/fr/blog/technologies-le-lien-entre-serveurs-et-applications). KANAP est open source et s'essaie gratuitement, en ligne ou sur vos serveurs.
