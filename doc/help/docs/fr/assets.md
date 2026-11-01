# Actifs

Les Actifs documentent votre inventaire d'infrastructure : serveurs physiques, machines virtuelles, conteneurs, instances cloud et équipements réseau. Liez les actifs aux sites, applications, connexions, contrats, projets et tâches pour construire une image complète de votre infrastructure IT.

## Premiers pas

Rendez-vous dans **Cartographie SI > Actifs** pour voir votre inventaire d'actifs. Cliquez sur **Ajouter un actif** pour créer votre première entrée.

**Champs obligatoires** :
- **Nom** : Le nom de l'actif ou son nom d'hôte, 200 caractères au plus
- **Type d'actif** : Serveur web, Machine virtuelle, Serveur physique, Conteneur, etc. (configurable dans **Cartographie SI > Paramètres**). Aucun type n'est présélectionné : **Créer** reste indisponible tant que vous n'en avez pas choisi un
- **Site** : Où l'actif est hébergé (détermine le fournisseur, le type d'hébergement et le pays)

**Fortement recommandé** :
- **Cycle de vie** : Statut actuel (Actif, Obsolète, Retiré, etc.)
- **Environnement** : À quel environnement cet actif appartient (Prod, Pré-prod, QA, Test, Dev, Sandbox)

**Noms uniques** : deux actifs ne peuvent pas avoir le même nom ni le même FQDN. La casse et les espaces en début ou en fin ne comptent pas. KANAP refuse le doublon et nomme l'actif qui porte déjà la valeur (`AST-12`). Les doublons enregistrés auparavant restent modifiables tant que vous ne changez pas cette valeur.

**Conseil** : Utilisez des conventions de nommage cohérentes incluant l'environnement et les informations de rôle (ex. : `prod-web-01`, `dev-db-master`). Lors de la création d'un nouvel actif, le nom d'hôte est automatiquement dérivé du nom que vous saisissez.

**Autorisations** :
- Consultation : `infrastructure:reader`
- Création / modification : `infrastructure:member`
- Import / Export / Suppression : `infrastructure:admin`

---

## Travailler avec la liste { #working-with-the-list }

La liste des actifs vous donne une vue filtrable et triable de chaque actif de votre inventaire.

**Colonnes par défaut** :

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **#** | Référence de l'actif (ex. : `AST-123`), monospace. Se trie par numéro |
| **Nom** | Nom de l'actif (cliquez pour ouvrir l'espace de travail) |
| **Vulnérabilités à traiter** | Les vulnérabilités encore à traiter sur les technologies renseignées sur l'actif, puis, en orange, le nombre de critiques ou élevées (`5 · 2`). Vide pour un actif retiré ou quand il n'en reste aucune. Cliquez pour ouvrir la page [Vulnérabilités](vulnerabilities.md) filtrée sur l'actif. Présente quand les vulnérabilités sont suivies |
| **Type d'actif** | Le type de l'actif (ex. : Machine virtuelle, Serveur physique) |
| **Cluster** | Les clusters dont l'actif est membre. Un cluster affiche une icône à la place (« Cluster » dans son infobulle). Vide pour un actif qui n'est dans aucun cluster |
| **Environnement** | Prod, Pré-prod, QA, Test, Dev, Sandbox, avec un point coloré |
| **Site** | Où l'actif est hébergé |
| **Hébergement** | Type d'hébergement (dérivé du site) |
| **OS** | Système d'exploitation : la technologie marquée comme système d'exploitation du serveur, avec sa version |
| **Zone réseau** | La zone réseau du sous-réseau de la première adresse IP. Un sous-réseau rattaché au site de l'actif passe avant un sous-réseau de même plage sans site |
| **Cycle de vie** | Statut de cycle de vie actuel |
| **Affectations** | Nombre d'affectations d'applications, y compris celles héritées de ses clusters |
| **Créé** | Quand l'enregistrement a été créé |

**Tri par défaut** : **Créé** décroissant (le plus récent en premier).

**Colonnes supplémentaires** (masquées par défaut, disponibles via le sélecteur de colonnes) :
- **Sous-site** : Zone spécifique au sein du site (bâtiment, salle, baie)
- **Mise en production** : Date à laquelle l'actif est entré en production
- **Fin de vie** : Date de retrait planifiée ou effective
- **Zone d'administration** : La zone de votre modèle d'administration à laquelle appartient l'actif

**Filtrage** :

La plupart des colonnes prennent en charge des filtres par jeu de cases à cocher pour un filtrage multi-sélection rapide. Les options de filtre se mettent à jour dynamiquement en fonction des autres filtres actifs et de la requête de recherche, vous ne voyez donc que les valeurs présentes dans le jeu de résultats actuel.

| Colonne | Notes |
|---------|-------|
| Type d'actif | Filtrer par un ou plusieurs types d'actif |
| Cluster | Les noms des clusters, puis **(Est un cluster)** pour les clusters eux-mêmes et **(Aucun cluster)** pour les actifs qui ne sont dans aucun cluster |
| Environnement | Prod, Pré-prod, QA, Test, Dev, Sandbox |
| Site | Inclut « (Sans site) » pour les actifs non assignés |
| Sous-site | Inclut « (Sans sous-site) » pour les actifs sans sous-site |
| Hébergement | Filtrer par type d'hébergement |
| OS | Filtrer par système d'exploitation |
| Zone réseau | Filtrer par segment réseau |
| Cycle de vie | Filtrer par statut de cycle de vie |
| Zone d'administration | Inclut « (Vide) » pour les actifs sans zone |
| Vulnérabilités à traiter | **Avec des vulnérabilités graves**, **Avec des vulnérabilités** ou **Sans**. Un actif retiré n'entre dans aucune de ces valeurs |

Le tri sur **Vulnérabilités à traiter** classe les actifs par leurs vulnérabilités critiques ou élevées, puis par leur total. Les actifs retirés viennent en dernier. La colonne ne compte que les liens directs : une machine virtuelle ne compte pas les vulnérabilités de son hôte. Voir [Ce que KANAP compte](vulnerabilities.md#what-kanap-counts).

**La recherche rapide** porte sur le nom, la référence, le nom d'hôte, le FQDN, les adresses IP, le cluster, le site, le sous-site et le système d'exploitation.

**Conseil** : Combinez les filtres entre colonnes pour affiner les résultats. Par exemple, filtrez par Environnement = « Prod » et Cycle de vie = « Actif » pour voir uniquement les actifs de production actifs.

**Actions** :
- **Ajouter un actif** : ouvre un menu (`infrastructure:member`). **Ajouter un actif** crée un actif ; **Ajouter un cluster** en crée un avec l'interrupteur **Cluster** déjà activé
- **Importer** / **Exporter** : Opérations en masse en CSV ou Excel (`infrastructure:admin`). L'export contient les actifs que la liste affiche. Voir [Options d'export](#export-options)
- **Supprimer un actif** (lignes sélectionnées) : Supprimer les actifs sélectionnés (`infrastructure:admin`). Un actif encore affecté à des applications ou lié à des connexions ne peut pas être supprimé. Le refus nomme les applications, et jusqu'à cinq connexions par leur référence et leur nom. Retirez d'abord l'actif de ces liens. Une affectation que l'actif hérite seulement de son cluster ne bloque pas. Avant toute suppression, la confirmation liste les actifs conservés, avec la raison, et ce que les autres emportent avec eux (voir [Supprimer un cluster ou un membre](#deleting-a-cluster-or-a-member))

---

## Clusters

Les actifs peuvent être organisés en clusters :

- **Actif standard** : Une instance d'infrastructure individuelle
- **Cluster** : Un groupe d'actifs agissant comme une seule unité logique

Pour créer un cluster, choisissez **Ajouter un cluster** dans le menu **Ajouter un actif**, ou activez l'interrupteur **Cluster** dans le tiroir des propriétés d'un actif. Une connexion posée sur un cluster vaut pour ses membres : voir [Connexions sur un cluster](connections.md#connections-on-a-cluster).

### Applications sur un cluster { #applications-on-a-cluster }

Une application peut être affectée à un cluster, depuis l'onglet **Déploiements** de l'application ou l'onglet **Exploitation** du cluster. Ses membres en service hébergent alors l'application avec le rôle de l'affectation du cluster. Un membre ajouté plus tard l'héberge aussi. Un membre retiré du cluster ne l'héberge plus. Un membre retiré du parc n'hérite de rien, et un cluster retiré ne transmet rien.

Où affecter dépend du cluster :

- **Cluster de bascule** (SQL Server Always On, par exemple) : l'application tourne sur chaque nœud. Affectez-la au cluster.
- **Cluster de virtualisation** (vSphere, par exemple) : les applications tournent dans les machines virtuelles que le cluster contient. Affectez chaque application à sa machine virtuelle. Seule la plateforme elle-même, comme vSphere avec le rôle virtualisation, s'affecte au cluster.

Un membre exécute ce qui est affecté à son cluster. Un actif que le cluster contient tourne dedans et n'hérite de rien.

Quand vous affectez une application à un membre d'un cluster, KANAP demande **Affecter au cluster ?** : **Affecter au cluster** pose l'affectation sur le cluster pour tous ses membres, **Ce serveur seulement** la garde sur ce serveur. La question nomme les membres dont l'affectation propre de même environnement et de même rôle sera remplacée par celle du cluster. L'affectation du cluster garde alors la date **Depuis** la plus ancienne et leurs notes. Quand le membre héberge déjà l'application dans ce rôle par son cluster, rien n'est créé et un message le dit. Une affectation faite par l'assistant suit les mêmes règles, sans la question.

Partout où KANAP lit où tourne une application, il compte les membres du cluster : les vulnérabilités et la fin de support de l'application, son type d'hébergement (un cluster sans site prend le type d'hébergement de ses membres), les zones d'administration, les applications d'un site ou d'un contrat sur un serveur, l'assistant et Connaissances. Dans l'impact d'un membre tombé, le cluster est dégradé et ses applications continuent de tourner. Voir [Dépendances](#dependencies).

Les membres se gèrent en haut de l'onglet **Exploitation** du cluster. Voir [Exploitation](#operations). Les règles :

- Un membre est un actif simple. Un cluster ne peut pas être membre, et un actif ne peut pas être membre de lui-même.
- Un cluster qui a des membres ne peut pas redevenir un actif simple : retirez d'abord ses membres.
- Un membre d'un cluster ne peut pas devenir un cluster : sortez-le d'abord de ses clusters.
- Un cluster qui a des membres n'a pas de système d'exploitation : chaque membre a le sien. Un cluster sans membre peut en garder un, par exemple un groupe d'instances cloud dont vous ne renseignez pas les serveurs. Voir [Système d'exploitation](#systeme-dexploitation).

Les installations mises à jour depuis une version antérieure gardent leurs clusters. Les appartenances contraires à ces règles ont été retirées pendant la mise à jour. Un nom de cluster saisi dans l'ancien champ texte est devenu une vraie appartenance quand il désignait un seul cluster.

### Machines virtuelles sur un cluster { #virtual-machines-on-a-cluster }

Un cluster de virtualisation contient ses machines virtuelles : ajoutez-les à la section **Contient** du cluster, dans son onglet **Dépendances**. Une machine du cluster peut tourner sur n'importe lequel de ses hôtes.

Quand vous ajoutez une relation **Contient** depuis un hôte membre d'un cluster, KANAP demande **Placer dans le cluster ?**. **Placer dans le cluster** pose la relation sur le cluster. **Cet hôte seulement** la garde sur l'hôte. La même question vient quand vous ajoutez un tel hôte sous **Contenu dans**. Un hôte ou un cluster retiré ne pose pas de question.

- Placer un actif dans le cluster remplace les liens que les hôtes membres avaient vers lui. Un message nomme les hôtes.
- Un hôte ne peut pas contenir un actif que son cluster contient déjà. Le message nomme le cluster.
- Un actif qui a deux conteneurs en service, par exemple un hôte et un cluster, porte une icône d'avertissement à côté de son nom dans **Contient** et **Contenu dans**. L'infobulle nomme les autres conteneurs. Retirez le lien qui n'est plus à jour.

L'assistant et la [synchronisation Netbox](netbox.md#clusters) suivent les mêmes règles, sans la question.

### Supprimer un cluster ou un membre { #deleting-a-cluster-or-a-member }

Avant la suppression d'un actif, la confirmation dit ce qui part avec lui : les clusters qu'il quitte, les membres qui perdent leur cluster et les relations avec d'autres actifs qui sont retirées. Confirmez avec **Supprimer quand même**. Le [Journal d'audit](admin.md#journal-daudit) inscrit ces pertes : sur chaque cluster qu'il quitte et chaque actif qui avait une relation vers lui, et, pour ses propres membres et relations, dans l'entrée de sa suppression.

---

## L'espace de travail des Actifs

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. L'espace de travail comporte un **en-tête** avec des métadonnées rapides, un **tiroir des propriétés** sur la droite (la carte d'identité de l'actif, toujours visible) et une **zone de contenu** au centre qui change selon l'onglet.

Une adresse qui ne désigne aucun actif ouvre une page **Actif introuvable**, avec un lien de retour à la liste.

Les onglets sont **Vue d'ensemble**, **Exploitation**, **Réseau**, **Matériel** (types d'actifs physiques uniquement), **Dépendances**, **Relations** et **Historique** (les modifications apportées à l'actif, voir [Historique des fiches](record-history.md)). À la création d'un actif, **Vue d'ensemble** et **Réseau** sont ouverts. Les autres onglets s'ouvrent dès que vous cliquez sur **Créer**.

### En-tête

L'en-tête affiche :
- **Nom de l'actif** (modifiable sur place)
- **Référence de l'actif** (ex. : `AST-123`) : identifiant copiable
- Pastille **Cycle de vie** (également modifiable depuis le tiroir des propriétés)
- **Vulnérabilités graves**, par exemple « 3 graves » : les vulnérabilités critiques ou élevées encore à traiter sur l'actif, avec la couleur de la plus haute. Une icône d'alerte suit quand certaines sont connues comme exploitées. Cliquez pour ouvrir la page [Vulnérabilités](vulnerabilities.md) filtrée sur l'actif. Affiché seulement quand l'actif en a
- **Partager** : copier un lien partageable vers cet espace de travail
- **Supprimer**, une icône corbeille avec son nom en infobulle (`infrastructure:admin`). Pour un actif encore utilisé, la raison s'affiche avant toute confirmation
- **Précédent / Suivant** (ex. : « 3 sur 47 ») : naviguer dans la liste filtrée sans y revenir

### Tiroir des propriétés (panneau de droite)

Le tiroir affiche la carte d'identité de l'actif sur chaque onglet. Les modifications sont enregistrées automatiquement. Les champs forment trois groupes.

**Type et zone** :
- **Type d'actif** (obligatoire)
- **Cluster** : activez-le pour marquer l'actif comme cluster. Le changement s'enregistre aussitôt et ne retire rien. Il est refusé pour un cluster qui a des membres et pour un membre d'un cluster. Voir [Clusters](#clusters)
- **Environnement** : Prod, Pré-prod, QA, Test, Dev, Sandbox
- **Zone d'administration** : La zone de votre modèle d'administration à laquelle appartient l'actif, par exemple le Tier 0 pour un contrôleur de domaine et l'hyperviseur qui le fait tourner. Choisissez parmi les zones configurées dans **Cartographie SI > Paramètres**, ou **Sans zone**. L'actif apparaît alors dans cette zone sur la page [Zones d'administration](administration-view.md)

**Site** :
- **Site** (obligatoire) : chaque actif en a un, qu'il vienne de l'écran, d'un import ou de l'assistant. Quand le site n'existe pas encore, tapez son nom et choisissez **+ Créer le site « … »** : indiquez son type d'hébergement, et le nouveau site se place dans le champ. Il faut `locations:member`
- **Sous-site** (lorsque le site a des sous-sites définis)
- **Type d'hébergement**, **Société exploitante** ou **Fournisseur cloud**, **Pays**, **Ville** : en lecture seule, dérivés du site. Ils suivent quand vous changez de site

**Cycle de vie** :
- **Cycle de vie** : Actif, Obsolète, Retiré, etc. (configurable dans les Paramètres)
- **Date de mise en service** : Quand l'actif est entré en production
- **Date de fin de vie** : Date de retrait planifiée ou effective

---

### Vue d'ensemble

L'onglet Vue d'ensemble est la page d'accueil de l'actif.

**Netbox** : sur un actif lié à Netbox, une ligne en haut indique la date de la dernière synchronisation, avec **Ouvrir dans Netbox**. Elle signale aussi quand l'objet n'est plus dans Netbox, quand son statut Netbox demande votre attention et quand l'actif est **Géré par Netbox**. Voir [Synchronisation Netbox](netbox.md).

**Informations de base** (à la création d'un actif) : **Nom**, **Type d'actif**, **Site** et **Environnement**.

**Description** : Une description en texte enrichi de l'actif. Sauvegarde automatiquement au fur et à mesure que vous éditez.

**Support** : le support fournisseur de l'actif, pour tous les types d'actifs. La section apparaît une fois l'actif créé et s'enregistre d'elle-même pendant la saisie.

- **Fournisseur** : Sélectionner depuis l'annuaire des fournisseurs
- **Contrat de support** : Lien vers un enregistrement de contrat
- **Niveau de support** : Texte libre (ex. : Or, Argent, 24x7)
- **Expiration du support** : Date d'expiration
- **Notes**

**Contacts de support** : Un tableau où vous pouvez ajouter des contacts depuis l'annuaire de contacts, chacun avec un libellé de rôle en texte libre. Le tableau affiche automatiquement l'e-mail, le téléphone et le mobile de chaque contact.

**Connaissances** : Articles de connaissances liés pour cet actif. Avec `knowledge:member`, vous pouvez créer de nouveaux articles directement depuis cette section. La section apparaît une fois l'actif créé.

---

### Exploitation { #operations }

L'onglet Exploitation montre le cluster de l'actif et ce qui tourne sur lui : les applications qu'il héberge, les technologies qu'il porte et leurs vulnérabilités. Il s'ouvre une fois l'actif créé.

**Cluster**, en haut de l'onglet :

- Sur un **cluster**, la section **Membres** liste les actifs membres (Nom, Environnement, Statut, Système d'exploitation). Cliquez sur un nom pour ouvrir cet actif. **Ajouter des membres** (sur un cluster sans membre) ou **Modifier les membres** ouvre une boîte de dialogue de recherche. Elle ne propose que des actifs simples, jamais un cluster ni le cluster lui-même. Une icône d'avertissement signale un membre dont l'environnement diffère de celui du cluster. Quand vous retirez des membres d'un cluster qui porte des applications, **Retirer des membres ?** nomme les applications que chacun n'hébergera plus. **Retirer quand même** enregistre.
- Sur un serveur membre d'un cluster, la section **Appartenance au cluster** affiche ses clusters, avec leur environnement et leur statut. Cliquez sur un nom pour ouvrir le cluster. Un serveur qui n'est dans aucun cluster n'a pas cette section.

**Applications hébergées** : les applications qui s'exécutent sur cet actif. Chaque ligne affiche :

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **Application** | Nom de l'application. Cliquez dessus pour ouvrir l'application sur son onglet **Déploiements** |
| **Déploiement** | Le déploiement de l'application que l'actif sert, nommé d'après son environnement |
| **Rôle** | Rôle serveur (Web, Base de données, Application, etc.) |
| **Depuis** | Date à laquelle le serveur a été affecté |
| **Notes** | Notes en texte libre |

Cliquez sur **Ajouter une affectation** pour rattacher cet actif à un déploiement d'application. Choisissez l'application, puis son déploiement. Quand l'application n'a pas encore de déploiement dans un environnement, **+ Créer le déploiement …** le crée avec l'affectation. Choisissez ensuite le rôle et la date / les notes optionnelles. Sur un membre d'un cluster, KANAP demande d'abord s'il faut affecter le cluster ou ce serveur seulement. Voir [Applications sur un cluster](#applications-on-a-cluster). Le crayon en fin de ligne ouvre l'application : l'affectation se modifie dans son onglet **Déploiements**. L'icône corbeille retire l'affectation, après une confirmation. **Ajouter une affectation** est indisponible tant qu'aucun rôle serveur n'est configuré dans **Cartographie SI > Paramètres**. Ces commandes demandent `infrastructure:member` et `applications:member`. Sans les deux, le tableau est en lecture seule.

Sur un membre, une application affectée à son cluster s'affiche « via » le nom du cluster, sans crayon ni corbeille : modifiez-la sur le cluster.

Sur un cluster, quand une application est affectée directement à chacun de ses membres en service, une ligne sous le tableau les nomme, avec **Affecter au cluster**. Après une confirmation, le cluster prend l'affectation et les affectations propres des membres sont retirées. L'application reste alors disponible tant qu'un membre tient.

**Technologies** : ce que porte le serveur, par exemple Windows Server, SQL Server, vSphere ou Active Directory. Colonnes : **Réf.**, **Nom**, **Famille**, **Version** et, quand le serveur porte une technologie par un autre, **Via**.

- **Système d'exploitation** : le système d'exploitation du serveur est l'une de ses technologies, de la famille **Système d'exploitation**. Il vient en tête de liste, avec la mention « Système d'exploitation » après son nom. Voir [Système d'exploitation](#systeme-dexploitation) ci-dessous.
- **Version** : affichée en orange quand le support finit dans les 12 mois ou qu'il ne reste que le support étendu, et en rouge une fois toutes les dates de fin passées. Survolez-la pour voir la fin du support standard et du support étendu.
- Une technologie installée sur ce serveur se retire avec la croix au bout de sa ligne.
- Sur un cluster, une technologie installée sur ses membres s'affiche une fois par version, avec sous **Via** les membres qui la portent. Une telle ligne suit l'installation et se retire là-bas.
- Une technologie qui vient seulement de l'hôte dans lequel ce serveur tourne, comme l'ESXi de son hôte, est la plateforme sous-jacente. Elle se range sous une ligne fermée en fin de tableau, **Plateforme sous-jacente (n)**, avec l'hôte sous **Via**. Cliquez sur la ligne pour l'afficher. Ces lignes ne sont pas comptées dans la section.
- **Ajouter** (`infrastructure:member`) ouvre une recherche de technologie, puis le choix de la version : choisissez une version, **Version inconnue**, ou tapez un nouveau libellé et choisissez **Ajouter la version « … »** pour la créer. Chaque modification s'enregistre aussitôt.
- **Changer une version** (`infrastructure:member`) : cliquez sur la version d'une technologie installée, ou sur le crayon au bout de sa ligne. Le même choix de version s'ouvre.

Les notes d'une installation se changent depuis l'onglet **Serveurs** de la technologie. Voir [Technologies](technologies.md#serveurs).

#### Système d'exploitation

Un serveur a un système d'exploitation : une technologie de la famille **Système d'exploitation**, avec sa version.

- **Ajoutez-le** comme n'importe quelle technologie. Quand le serveur n'a pas encore de système d'exploitation, la première technologie de cette famille que vous ajoutez le devient.
- **Retirez-le** avec sa croix. Si une autre technologie de la famille reste sur le serveur, c'est elle qui devient le système d'exploitation.
- **Changez la version** en cliquant dessus, comme pour toute technologie.
- Un **cluster** qui a des membres n'a pas de système d'exploitation : chaque membre a le sien. Un cluster sans membre peut en porter un, posé par un import ou par l'assistant. À l'écran, une technologie de cette famille ajoutée à un cluster reste une technologie ordinaire.
- Ajouter les premiers membres à un cluster qui a un système d'exploitation pose la question **Retirer le système d'exploitation ?**. **Retirer et enregistrer** le retire et enregistre les membres. Si vous annulez, rien n'est enregistré.

Pour que VMware ESXi ou FortiOS soit le système d'exploitation d'un hôte, placez cette technologie dans la famille **Système d'exploitation** (son champ **Famille**, sur la technologie).

Le système d'exploitation apparaît dans la colonne **OS** de la liste, dans le tableau des membres d'un cluster et sur la [Carte des connexions](connection-map.md). Ses versions et ses dates de fin de support viennent de la technologie : voir [Technologies](technologies.md).

#### Vulnérabilités

Quand les vulnérabilités sont suivies, la dernière section de l'onglet liste les vulnérabilités encore à traiter sur les technologies renseignées sur cet actif, dans les alertes. Le nombre à côté du titre est celui des vulnérabilités distinctes à traiter : cliquez dessus pour ouvrir la page [Vulnérabilités](vulnerabilities.md) filtrée sur l'actif. Une ligne par technologie et version :

| Colonne | Ce qu'elle affiche |
|---|---|
| **Technologie**, **Version** | La technologie et sa version. **Version non renseignée (potentiellement concernée)** quand l'actif ne nomme aucune version |
| **Crit.**, **Élev.**, **Moy.**, **Faible**, **N. éval.** | Une colonne par sévérité (Critique, Élevée, Moyenne, Faible, Non évaluée, le nom complet en infobulle sur l'en-tête) : les vulnérabilités encore à traiter. Une vulnérabilité notée **Aucune** compte avec **Faible** |
| **Total** | Les vulnérabilités distinctes encore à traiter sur cette ligne |

**Voir** ouvre la page [Vulnérabilités](vulnerabilities.md) filtrée sur l'actif et la technologie. Quand il ne reste rien à traiter, la section le dit en une ligne. Tant que la première lecture d'un produit dans la NVD, ou le rapprochement d'une technologie qui vient d'être renseignée sur cet actif, est en cours, la section affiche « Recherche des vulnérabilités en cours… » et se complète d'elle-même. Quand la recherche ne peut pas aboutir, la section le dit. Un actif retiré n'a pas de section.

Sur un **cluster**, **Sur ses membres** liste à part les technologies de ses membres, une ligne par technologie et version, avec dans la colonne **Actif** les membres qui la portent. Un cluster compte les vulnérabilités de ses membres en service avec les siennes : le nombre de la section, le badge de l'en-tête (son infobulle dit « membres compris ») et la colonne de la liste. Le **Voir** d'une ligne ouvre la page sur le membre qui la porte.

Ce qui vient seulement de l'hôte dans lequel tournent l'actif ou ses membres, comme l'ESXi de l'hôte d'une machine virtuelle, est la plateforme sous-jacente. Il se range sous une ligne fermée **Plateforme sous-jacente (n)**, qui s'ouvre d'un clic. Il n'est compté ni dans la section, ni dans le badge, ni dans la colonne de la liste : une vulnérabilité compte sur l'actif où la technologie est renseignée. Son **Voir** ouvre la page sur cet hôte. Voir [Ce que KANAP compte](vulnerabilities.md#what-kanap-counts).

---

### Réseau { #network }

L'onglet Réseau regroupe l'identité réseau de l'actif, ses adresses IP et ses connexions. Il est ouvert à la création d'un actif. Si le nom d'hôte est mal formé quand vous cliquez sur **Créer**, l'onglet s'ouvre sur l'erreur.

Sur un actif géré par Netbox, une ligne en haut indique que Netbox remplit les champs qu'il fournit et que les autres sont à compléter par vous.

**Identité** :
- **Nom d'hôte** : Le nom d'hôte réseau de l'actif. Pré-rempli automatiquement à partir du nom de l'actif lors de la création ; vous pouvez le remplacer à tout moment. Obligatoire lorsqu'un domaine est sélectionné. Il accepte les lettres, les chiffres, les traits d'union et les points, chaque partie entre deux points étant limitée à 63 caractères : un nom comme `DL3.ROBOT-15MS.IE2000` est donc valide tel quel.
- **Domaine** : Le domaine Active Directory ou DNS auquel l'actif appartient. Choisissez parmi les domaines configurés dans **Cartographie SI > Paramètres**. Les options système incluent « Workgroup » (autonome) et « N/A » (non applicable).
- **FQDN** : Fully Qualified Domain Name, calculé automatiquement à partir du nom d'hôte et du suffixe DNS du domaine. Lecture seule.
- **Alias** : Noms DNS ou alias supplémentaires pour cet actif. Tapez et appuyez sur Entrée pour ajouter.

**Adresses IP** :

Les actifs prennent en charge plusieurs adresses IP, chacune avec sa propre configuration réseau :

- Cliquez sur **Ajouter une adresse IP** pour ajouter une nouvelle entrée.
- **Type** : L'objectif de l'adresse IP (Hôte, IPMI, Management, iSCSI, ou types personnalisés depuis les Paramètres)
- **Adresse IP** : L'adresse elle-même. Une adresse mal formée est refusée, avec le message sous le champ
- **Sous-réseau** : Sous-réseau depuis la liste configurée (filtré au site de l'actif)
- **Zone réseau** : Dérivée automatiquement du sous-réseau sélectionné (lecture seule)
- **VLAN** : Dérivé automatiquement du sous-réseau sélectionné (lecture seule)

Cela vous permet de documenter plusieurs interfaces réseau par actif, par exemple un serveur physique avec à la fois une IP hôte et une adresse de management IPMI sur des sous-réseaux différents.

**Connexions** : Une vue en lecture seule des connexions de cet actif, une fois celui-ci créé : celles où il est une extrémité, un serveur ou l'équipement d'un saut, et celles de ses clusters. Chaque ligne affiche la référence et le nom (cliquez pour ouvrir la connexion), la topologie, les protocoles, la source et la destination, et le statut de cycle de vie. Sous le nom, **Saut 2** indique que l'actif est l'équipement de ce saut, et **via** nomme le cluster quand la connexion atteint l'actif par lui. Une connexion multi-serveur nomme ses serveurs à la place de la source et de la destination. Pour créer ou modifier une connexion, rendez-vous dans **Cartographie SI > Connexions**.

---

### Matériel

*Visible uniquement pour les types d'actifs physiques. L'onglet s'ouvre une fois l'actif créé.*

Suit les détails du matériel physique. Sauvegarde automatique au fur et à mesure que vous tapez.

- **Numéro de série**
- **Fabricant**
- **Modèle**
- **Date d'achat**
- **Emplacement en baie** (ex. : Rangée A, Baie 12)
- **Unité de baie** (ex. : U1-U4)
- **Notes**

---

### Dépendances { #dependencies }

L'onglet Dépendances montre la place de l'actif parmi les autres actifs : ce qui s'arrête avec lui et ses relations avec d'autres actifs. Il s'ouvre une fois l'actif créé. Le badge de l'onglet compte les relations entre actifs. Les membres d'un cluster sont dans l'onglet [Exploitation](#operations).

**Si ce serveur tombe** : l'onglet s'ouvre sur ce qui s'arrête avec cet actif. Une ligne de synthèse compte les applications, actifs, clusters et processus métier touchés, puis un tableau par type :

- **Applications** : celles qui ont un déploiement en service sur un actif tombé, avec leurs environnements, leur criticité et les actifs sur lesquels elles tournent (**Via**).
- **Actifs** : les actifs qu'il contient, jusqu'à trois niveaux, et les actifs qui dépendent de lui. Un cluster qui tombe entraîne tous ses membres en service, et ce qui dépend d'eux. **Via** montre le chemin.
- **Clusters** : les clusters dont un membre tombe. **Dégradé** tant qu'un membre tient, avec le nombre de membres tombés : ses applications continuent de tourner. **Tombé** quand plus aucun membre ne tient : ses applications et les actifs qu'il contient, comme ses machines virtuelles, tombent avec lui.
- **Processus métier** : les processus des applications touchées.

Les actifs retirés arrêtent la chaîne : rien ne tombe à travers eux. Chaque tableau montre ses 50 premières lignes et compte le reste. Les applications et les processus demandent le droit de les lire. La section se met à jour dès que vous ajoutez ou retirez une relation entre actifs, changez les membres d'un cluster ou activez ou désactivez l'interrupteur **Cluster**.

**Relations entre actifs**, un tableau par sens :

| Section | Signification |
|---|---|
| **Contient** | Les actifs placés dans celui-ci, par exemple les serveurs d'une baie |
| **Contenu dans** | Les actifs dans lesquels celui-ci se trouve |
| **Dépend de** | Les actifs dont celui-ci a besoin pour fonctionner, par exemple un serveur de base de données |
| **Requis par** | Les actifs qui ont besoin de celui-ci |

Chaque tableau affiche la référence (`AST-12`), le nom, le type, l'environnement et le statut. Un actif retiré ou désactivé reste affiché, son nom grisé. Cliquez sur une ligne pour ouvrir l'actif.

Sur un cluster, **Dépend de** se termine par une ligne repliée, **Par les membres (n)**. Elle liste les actifs dont dépendent les membres en service du cluster, avec ces membres dans la colonne **Via**. Ces lignes sont en lecture seule et ne comptent pas dans la pastille de l'onglet.

Avec `infrastructure:member`, **Ajouter**, à droite d'une section, ouvre une recherche d'actif. Choisissez un résultat : la relation est enregistrée aussitôt. Pour retirer une relation, survolez la ligne et cliquez sur la croix en fin de ligne. Un message le confirme et propose **Annuler**. Les lecteurs voient les tableaux en lecture seule. Une relation **Contient** depuis un membre d'un cluster demande d'abord où placer l'actif : voir [Machines virtuelles sur un cluster](#virtual-machines-on-a-cluster).

---

### Relations

L'onglet Relations montre ce à quoi l'actif est lié : lignes budgétaires, contrats, projets, tâches et incidents, chacun dans son propre tableau, puis ses liens et fichiers. Les relations entre actifs sont dans l'onglet [Dépendances](#dependencies), et les technologies de l'actif dans l'onglet [Exploitation](#operations). L'onglet s'ouvre une fois l'actif créé. Cliquez sur une ligne pour ouvrir l'enregistrement. Le badge de l'onglet compte les enregistrements liés que vous pouvez voir, ainsi que les liens et fichiers.

**Enregistrements liés**, un tableau chacun :

| Section | Colonnes |
|---|---|
| **Lignes budgétaires** | Référence (`BL-12`), nom, type (OPEX ou CAPEX), fournisseur, et le montant de l'année en cours dans votre colonne budgétaire par défaut, dans la devise de reporting. Un tiret signifie que la ligne n'a pas de budget pour l'année |
| **Contrats** | Nom, fournisseur, fin de la période en cours, montant annuel dans la devise du contrat, renouvellement (tacite ou manuel) |
| **Projets** | Référence (`PRJ-7`), nom, statut, fin prévue |
| **Tâches** | Référence (`T-118`), titre, statut, assigné, échéance. Les tâches ouvertes viennent en premier |
| **Incidents** | Référence (`INC-14`), titre, sévérité, statut, date de détection |

Vous ne voyez que les sections des modules que vous pouvez lire : budget, contrats, projets du portefeuille, tâches et incidents. Un Contributeur métier ne voit que les projets et les tâches auxquels il participe. Un incident confidentiel n'apparaît qu'aux personnes qui peuvent le voir dans le registre des incidents, sans son titre.

Les dates en orange demandent votre attention : un contrat dont la décision de renouvellement tombe dans votre fenêtre de décision des contrats, ou une tâche ouverte dont l'échéance est passée. Une ligne budgétaire ou un contrat désactivé reste affiché, son nom grisé. À partir de deux lignes, les lignes budgétaires et les contrats se terminent par une ligne de total. Le total des lignes budgétaires est dans la devise de reporting et exclut une ligne dont la devise n'a pas de taux de change pour l'année : un avertissement d'une ligne sous le tableau l'indique. Les contrats ont un total par devise, sans les contrats désactivés.

**Ajouter et retirer des liens** (`infrastructure:member`) : **Ajouter**, à droite d'une section, ouvre une recherche. Tapez un nom ou une référence et choisissez un résultat : le lien est enregistré aussitôt. Lier demande aussi de pouvoir lire le module cible : **Ajouter** est donc absent d'une section que vous ne pouvez pas lire. Pour retirer un lien, survolez la ligne et cliquez sur la croix en fin de ligne. Un message le confirme et propose **Annuler**. Retirer un lien ne supprime rien d'autre. Les lecteurs voient les tableaux en lecture seule.

- Une tâche liée ou déliée ici apparaît aussi dans l'activité de la tâche.
- Lier ou délier un incident demande aussi `incidents:contributor` et s'inscrit dans le journal de l'incident. Un incident clos ou annulé ne peut être ni lié ni délié : rouvrez-le d'abord.

**Liens et fichiers** : les liens web de l'actif (portails fournisseurs, tableaux de bord de monitoring, documentation) et ses fichiers (fichiers de configuration, schémas, documents fournisseurs), une ligne chacun avec son nom, le domaine du lien ou la taille du fichier, et sa date d'ajout. Cliquez sur un lien pour l'ouvrir dans un nouvel onglet, ou sur un fichier pour le télécharger. Avec `infrastructure:member` :

- **Ajouter un lien** ouvre une boîte de dialogue pour une URL et un nom optionnel ; le lien est enregistré aussitôt. Une adresse saisie sans `http://` ni `https://` reçoit `https://`. Tout autre schéma est refusé. Pour modifier un lien, survolez sa ligne et cliquez sur le crayon.
- **Joindre un fichier** ouvre le sélecteur de fichiers. Vous pouvez aussi déposer des fichiers sur la section.
- Pour retirer un lien ou un fichier, survolez la ligne et cliquez sur la croix. Retirer un lien affiche un message et propose **Annuler**, qui recrée le lien. La suppression d'un fichier demande d'abord une confirmation.

---

## Import/export CSV

Maintenez votre inventaire d'actifs à grande échelle grâce à l'import et l'export. Cette fonctionnalité prend en charge les opérations en masse pour le chargement initial de données, les mises à jour périodiques depuis des systèmes externes et l'extraction de données pour le reporting.

### Accéder aux fonctionnalités CSV

Depuis la liste des Actifs :
- **Exporter** : Télécharger les actifs dans un fichier CSV ou un classeur Excel
- **Importer** : Téléverser un fichier CSV ou un classeur Excel pour créer ou mettre à jour des actifs

**Autorisations requises** : `infrastructure:admin` pour les opérations d'import/export.

### Options d'export { #export-options }

**Contenu du fichier** : les actifs que la liste affiche. L'export suit les filtres des colonnes et la recherche rapide. La boîte de dialogue indique combien d'actifs le fichier contiendra. Vous pouvez aussi exporter tout le référentiel. Les lignes gardent l'ordre de la liste.

**Format** : **CSV** ou **Excel (.xlsx)**, choisi dans la fenêtre et mémorisé par votre navigateur. Le classeur contient les mêmes colonnes que le CSV sur une feuille, avec les nombres et les dates en valeurs qu'Excel sait trier et filtrer. L'import lit l'un ou l'autre ; dans un classeur, il lit la première feuille. Voir [Fichiers CSV et Excel](csv-files.md).

**Colonnes** : le fichier commence par `id` et `reference` (`AST-12`), puis les colonnes suivent l'espace de travail, onglet par onglet. L'import ignore `reference`.

Les colonnes du type d'actif, du cycle de vie, du domaine, de la zone d'administration et du type d'adresse IP contiennent les libellés de l'écran, dans la langue de l'écran.

| Option | Description |
|--------|-------------|
| **Export complet** | Tous les champs exportables, à utiliser pour le reporting et l'extraction complète des données |
| **Enrichissement de données** | Tous les champs importables. Correspond au format du modèle d'import, idéal pour l'édition aller-retour (export, modification, ré-import) |
| **Sélection personnalisée** | Choisir les champs spécifiques à inclure dans votre export |

**Téléchargement du modèle** (depuis la boîte de dialogue d'import) : Télécharge un CSV vierge avec tous les en-têtes de champs importables. Utilisez-le pour préparer des fichiers d'import avec la bonne structure.

### Processus d'import

1. **Préparez votre fichier** : un fichier CSV ou un classeur Excel (`.xlsx`). Enregistrez un fichier CSV en UTF-8. Les virgules et les points-virgules conviennent tous les deux, de même qu'un fichier enregistré par Excel en CSV simple (Windows-1252). Téléchargez un modèle pour vous assurer des bons en-têtes. Le séparateur, les montants, les dates et les oui ou non de chaque langue sont dans [Fichiers CSV et Excel](csv-files.md).

2. **Choisissez les paramètres d'import** :
   - **Mode** :
     - `Enrichir` (par défaut) : Les cellules vides conservent les valeurs existantes : ne mettez à jour que ce que vous spécifiez
     - `Remplacer` : Remplace les valeurs des colonnes du fichier. Une cellule vide efface la valeur enregistrée. Une colonne absente du fichier garde ses valeurs. Certains champs ne peuvent pas être vidés : la **Vérification préalable** les signale.
   - **Opération** :
     - `Upsert` (par défaut) : Créer de nouveaux actifs ou mettre à jour les existants
     - `Mise à jour uniquement` : Ne modifier que les actifs existants, ignorer les nouveaux
     - `Insertion uniquement` : Ne créer que de nouveaux actifs, ignorer les existants

3. **Validez d'abord** : Cliquez sur **Vérification préalable** pour valider votre fichier sans apporter de modifications. Examinez les erreurs et avertissements.

4. **Appliquez les modifications** : Si la validation réussit, cliquez sur **Importer** pour valider les changements.

### Ce que la vérification préalable refuse

La vérification préalable signale une erreur sur la ligne, et rien n'est chargé, pour :

- un nom d'hôte qui ne respecte pas la règle de l'onglet Réseau ;
- une adresse IP mal formée ;
- un type d'actif, un domaine, un cycle de vie, une zone d'administration ou un type d'adresse IP qui ne correspond à rien dans **Cartographie SI > Paramètres** ;
- une date absente du calendrier, comme `31/02/2025`, ou une date écrite en toutes lettres. Les formes de date acceptées sont dans [Fichiers CSV et Excel](csv-files.md) ;
- un emplacement d'adresse IP rempli alors qu'un emplacement précédent est vide, par exemple `ip_2_address` sans `ip_1_address` ;
- un nom ou un FQDN qu'un autre actif porte déjà.

Pour un actif existant, le nom d'hôte et les adresses IP ne sont revérifiés que si le fichier les change.

### Référence des champs

**Champs principaux** :

| Colonne CSV | Description | Obligatoire | Notes |
|-------------|-------------|-------------|-------|
| `id` | UUID de l'actif | Non | Pour les mises à jour ; laisser vide pour les nouveaux actifs |
| `name` | Nom de l'actif | Oui | Utilisé comme identifiant unique pour la correspondance |
| `location_reference` | Code du site | Oui | Le **Code** d'un site existant |
| `kind` | Type d'actif | Oui | Accepte un code ou un libellé (ex. : `vm` ou `Virtual Machine`) |
| `environment` | Environnement | Oui | `prod`, `pre_prod`, `qa`, `test`, `dev`, `sandbox` |
| `status` | Statut de cycle de vie | Non | Accepte un code ou un libellé (ex. : `active` ou `Active`) |
| `is_cluster` | Est-ce un cluster | Non | `oui` ou `non` |
| `hostname` | Nom d'hôte réseau | Non | |
| `domain` | Domaine DNS | Non | Accepte un code ou un libellé depuis les Paramètres |
| `admin_zone` | Zone d'administration | Non | Accepte un code ou un libellé depuis les Paramètres |
| `aliases` | Alias DNS | Non | Liste séparée par virgules |
| `operating_system` | Système d'exploitation | Non | Le nom de la technologie, suivi de sa version (`Windows Server 2019`). Voir ci-dessous |
| `cluster` | Appartenance aux clusters | Non | Les noms des clusters dont l'actif est membre, séparés par des virgules. Voir ci-dessous |
| `notes` | Notes en texte libre | Non | |

**Champs Adresse IP** (jusqu'à 4 adresses par actif) :

| Colonne CSV | Description | Notes |
|-------------|-------------|-------|
| `ip_1_type` | Type d'adresse IP | Accepte un code ou un libellé (ex. : `host` ou `Host IP`) |
| `ip_1_address` | Adresse IP | |
| `ip_1_subnet_cidr` | Sous-réseau en notation CIDR | |
| `ip_2_type` à `ip_4_type` | Types IP supplémentaires | Même schéma pour les emplacements 2-4 |
| `ip_2_address` à `ip_4_address` | Adresses supplémentaires | |
| `ip_2_subnet_cidr` à `ip_4_subnet_cidr` | Sous-réseaux supplémentaires | |

### Acceptation des libellés et codes

Pour les champs configurés dans **Cartographie SI > Paramètres**, vous pouvez utiliser soit le code interne, soit le libellé affiché à l'écran, en anglais, français, allemand ou espagnol :

| Champ | Exemples de codes | Exemples de libellés |
|-------|-------------------|----------------------|
| Type d'actif (`kind`) | `vm`, `physical`, `container` | `Virtual Machine`, `Physical Server`, `Container` |
| Cycle de vie (`status`) | `active`, `inactive`, `decommissioned` | `Active`, `Inactive`, `Decommissioned` |
| Domaine | `corp`, `dmz` | `Corporate Domain`, `DMZ` |
| Zone d'administration (`admin_zone`) | `tier_0`, `tier_1` | `Tier 0 (cœur de confiance)`, `Tier 1 (serveurs et applications)` |
| Type d'adresse IP | `host`, `ipmi`, `mgmt` | `Host IP`, `IPMI`, `Management` |

Le système normalise automatiquement les valeurs lors de l'import, donc `Virtual Machine`, `virtual machine` et `vm` se résolvent tous vers le même type d'actif. Une valeur qui correspond à plusieurs entrées est refusée plutôt que devinée. L'export écrit les noms pour ces colonnes, dans la langue de l'écran, si bien qu'un fichier exporté peut être réimporté tel quel.

**Système d'exploitation** : la colonne `operating_system` contient le nom de la technologie suivi de sa version, comme l'écrit l'export (`Windows Server 2019`, `Ubuntu 24.04 LTS`). À l'import, KANAP cherche la technologie parmi les vôtres, puis dans le catalogue, et enregistre la version. Une technologie ou une version introuvable est créée : vérifiez donc l'orthographe avant. La valeur devient le système d'exploitation du serveur.

**Appartenance aux clusters** : la colonne `cluster` nomme les clusters de l'actif, séparés par des virgules (`ESX-PROD, SQL-CLUSTER`). La casse ne compte pas. L'export écrit les clusters dont l'actif est membre. À l'import :

- En mode `Enrichir`, l'actif rejoint les clusters nommés dans la cellule et reste dans ses autres clusters.
- En mode `Remplacer`, l'actif quitte aussi les clusters que sa cellule ne nomme pas.
- Une cellule vide ne change rien, dans les deux modes.

**Vérification préalable** signale une erreur sur la ligne quand un nom ne correspond à aucun actif, correspond à plusieurs clusters ou désigne un actif qui n'est pas un cluster. Elle refuse aussi une ligne qui se nomme elle-même, une ligne qui est ou devient un cluster, et un cluster qui a un système d'exploitation : l'import n'en retire jamais. Les colonnes `is_cluster` et `operating_system` suivent les règles de [Clusters](#clusters).

### Correspondance et mises à jour

Les actifs sont identifiés par **nom** (insensible à la casse). Lorsqu'une correspondance est trouvée :
- En mode `Enrichir` : Seules les valeurs CSV non vides mettent à jour l'actif
- En mode `Remplacer` : Les colonnes du fichier sont mises à jour, et une cellule vide efface la valeur enregistrée. Les colonnes absentes du fichier gardent leurs valeurs. Le nom, l'`id`, le statut et les champs obligatoires ne peuvent pas être vidés : la **Vérification préalable** signale une erreur sur la ligne. Pour les colonnes d'adresses IP, seules les sous-colonnes présentes dans le fichier sont appliquées. Un nouvel actif reçoit les valeurs par défaut.

Si vous incluez la colonne `id` avec un UUID valide, la correspondance utilise d'abord l'ID, puis se rabat sur le nom.

### Champs dérivés

Certains champs sont calculés et ne peuvent pas être importés :
- **Fournisseur** : Dérivé automatiquement du site de l'actif, et mis à jour quand le site change
- **FQDN** : Calculé à partir du nom d'hôte + domaine
- **Vulnérabilités** : `vulnerabilities_to_review` (les vulnérabilités encore à traiter) et `severe_vulnerabilities` (celles critiques ou élevées), comptées comme dans la colonne de la liste. Export seulement : l'import les ignore. Vides pour un actif retiré. Absentes du fichier quand les vulnérabilités ne sont pas suivies

### Limitations

- **Maximum 4 adresses IP** : Les actifs prennent en charge jusqu'à 4 entrées d'adresse IP dans un fichier
- **Site obligatoire** : Chaque actif doit avoir le code d'un site existant. La **Vérification préalable** signale une erreur sur une ligne dont la cellule `location_reference` est vide et refuse un fichier sans cette colonne
- **Relations non incluses** : Les affectations d'applications, connexions, liens financiers, projets, tâches et pièces jointes doivent être gérés dans l'espace de travail

### Résolution de problèmes

**Erreur « Le fichier n'est pas correctement formaté »** : Cela indique généralement un problème d'encodage. Assurez-vous que votre CSV est enregistré en **UTF-8** :

- **Dans LibreOffice** : Lors de l'ouverture d'un CSV, sélectionnez `UTF-8` dans le menu déroulant Jeu de caractères (pas « Japanese (Macintosh) » ni d'autres encodages). Lors de l'enregistrement, cochez « Modifier les paramètres de filtre » et choisissez UTF-8.
- **Dans Excel** : Enregistrer sous > CSV UTF-8 (délimité par des virgules).
- **Conseil général** : Si vous voyez des caractères illisibles au début de votre fichier, l'encodage est incorrect.

### Exemple CSV

```csv
name;location_reference;kind;environment;status;hostname;domain;ip_1_type;ip_1_address
PROD-WEB-01;NYC-DC1;Virtual Machine;prod;Active;prodweb01;corp;Host IP;10.0.1.10
PROD-DB-01;NYC-DC1;vm;prod;active;proddb01;corp;host;10.0.1.20
```

---

## Conseils

- **Nommez de manière cohérente** : Incluez l'environnement, le rôle et la séquence dans les noms d'actifs pour une identification facile.
- **Utilisez les clusters** : Regroupez les actifs liés (ex. : cluster web, cluster base de données) pour simplifier la gestion. Affectez au cluster une application qui tourne sur chaque nœud, et une application d'une machine virtuelle à cette machine.
- **Suivez le cycle de vie** : Marquez les actifs obsolètes et retirés pour garder les comptes d'inventaire précis.
- **Liez aux sites** : Assignez les actifs aux sites pour que le type d'hébergement, le pays et la ville soient renseignés automatiquement.
- **Affectez aux applications** : Utilisez la section **Applications hébergées** de l'onglet Exploitation pour lier les actifs aux déploiements d'applications. Les mêmes affectations apparaissent sous l'onglet Déploiements de l'application.
- **Utilisez l'onglet Relations** : Connectez les actifs aux lignes budgétaires, contrats et projets pour la visibilité financière.
- **Liez les tâches ici** : Ajoutez une tâche sous Relations > Tâches. Le lien apparaît aussi dans l'activité de la tâche.
- **Attachez la documentation** : Téléversez les fichiers de configuration, diagrammes d'architecture ou documents fournisseurs directement dans l'onglet Relations.
