# Fins de support

Le rapport Fins de support liste ce qui a atteint, ou atteint bientôt, la fin de son support, et ce que chaque élément touche : les serveurs qui le font tourner et les applications qui en dépendent. Une seconde vue liste les données manquantes qui empêchent le rapport de répondre.

Ouvrez-le depuis **Cartographie SI > Fins de support**, dans le groupe **Exploitation**. Il faut `infrastructure:reader`. Les colonnes et les lignes d'applications n'apparaissent que si vous pouvez aussi lire les applications.

## Échéances

La vue **Échéances** montre une ligne par élément dont le support est fini, ou finit dans l'horizon. Le sous-titre donne le dernier jour couvert par l'horizon.

Ce que le rapport surveille :

| Type | Ce qui finit | D'où vient la date |
|---|---|---|
| **Technologie** | Une version en service sur un serveur en service, ou déclarée par une application en service | La fin du support standard et étendu de la version, sur la [technologie](technologies.md#apercu) |
| **OS** | Une version d'un système d'exploitation en service sur un serveur en service | La fin du support standard et étendu de la version, sur la technologie de la famille **Système d'exploitation** |
| **Application** | Une application en service | Sa date de fin de support |
| **Matériel** | Un actif physique en service | Sa fin de vie ou la fin de son contrat de support, indiquée dans la colonne **Version** |

Les actifs retirés, les applications désactivées et les versions que personne n'utilise sont exclus.

**Filtres** :

- **Type** : l'un des quatre types, ou **Tous les types**.
- **Horizon** : 6, 12, 24 ou 36 mois. 12 mois par défaut.

**Colonnes** : **Type**, **Élément** (ouvre la fiche), **Version**, **Date de fin**, **État**, **Serveurs** et **Applications** (combien chaque élément en touche).

**État** :

- **Hors support** : toutes les dates de fin sont passées.
- **Support étendu** : le support standard est fini, le support étendu court encore.
- **Fin proche** : le support finit dans l'horizon.

**Ce que touche un élément** : cliquez sur une ligne pour déplier les serveurs et les applications derrière ses compteurs. Chaque nom ouvre sa fiche.

- Une version de technologie touche les serveurs sur lesquels elle est installée, et les applications qui la déclarent ou sont hébergées sur un serveur qui la porte (y compris les machines virtuelles d'un tel serveur).
- Un système d'exploitation touche les serveurs qui utilisent cette version, et les applications déployées sur eux et sur ce qu'ils contiennent. Sa ligne ouvre la technologie.
- Un matériel touche ses serveurs, ce qu'ils contiennent, et les applications déployées sur l'ensemble. Le matériel lui-même n'est pas l'un de ses serveurs.
- Une application touche les serveurs sur lesquels elle est déployée. Sur un cluster, ce sont le cluster et ses membres en service.

Les serveurs d'une technologie ou d'un système d'exploitation se comptent comme dans la colonne **Serveurs** de la [liste des technologies](technologies.md) : les serveurs en service où la version est installée, clusters exclus. Les serveurs d'un matériel sont les actifs qu'il porte, clusters exclus. Les applications d'un cluster comptent toujours.

## Données manquantes

La vue **Données manquantes** liste les fiches à compléter pour que les échéances soient justes. Cliquez sur une ligne pour ouvrir la fiche.

| Donnée manquante | Ce que cela signifie |
|---|---|
| **Application hébergée sans serveur** | Une application hébergée sur site ou en cloud privé n'a aucun serveur sur un déploiement en service |
| **Machine virtuelle sans hôte** | Aucun actif ne contient cette machine virtuelle |
| **Technologie sur site sur aucun serveur** | Une technologie dont le type d'hébergement est sur site (Sur site, Colocation) ne tourne sur aucun serveur |
| **Technologie sans type d'hébergement des réglages IT** | Le type d'hébergement de la technologie n'est plus dans la liste **Types d'hébergement** des paramètres. Choisissez-en un autre sur la technologie |
| **Serveur de base de données sans technologie de base de données** | Un serveur tient un rôle de base de données pour une application, mais ne porte aucune technologie de la famille **Base de données** |
| **Application avec SSO sans technologie d'identité** | Une application utilise le SSO et n'a aucune technologie de la famille **Annuaire et identité** |
| **Lien de technologie sans version** | Un serveur ou une application utilise une technologie sans dire quelle version |
| **Version en service sans date de fin de support** | Le rapport ne peut pas dire quand cette version finit |

Les lignes qui concernent des applications demandent le droit de lire les applications.

## Export et impression

**Exporter le tableau** télécharge la liste à l'écran dans un fichier CSV ou Excel : les échéances avec l'horizon et le type en cours, ou les données manquantes. Les en-têtes suivent la langue de votre écran, et les dates sont de vraies dates dans le fichier Excel, qui ajoute une feuille **Paramètres**. Voir [Rapports](reports.md#export-options). **Imprimer / Enregistrer en PDF** imprime le rapport.

## Demander à l'assistant

[Plaid](ai-assistant.md) lit les deux vues, **Échéances** et **Données manquantes**, avec les mêmes droits que le rapport. Il nomme chaque élément par sa référence (`APP-4`, `AST-12`, `TEC-3`) et lit un horizon à la fois : 6, 12, 24 ou 36 mois. Plaid liste les échéances 30 à la fois et peut lire les pages suivantes ; ses décomptes et ses totaux couvrent toutes les échéances. Quand vous ne pouvez pas lire les applications, Plaid dit qu'il a laissé de côté les lignes des applications.

Plaid peut aussi ajouter des versions de technologie et corriger leurs dates de support, avec votre approbation. La fin de support d'une application est un champ de l'application : Plaid la modifie comme il modifie l'application, avec les droits de la page [Applications](applications.md).

Demandez par exemple : « Quelles applications arrivent en fin de support dans les six mois ? », « Échéances de fin de support des douze prochains mois par type », « Quelles fiches faut-il compléter pour le rapport de fin de support ? », « La version 16 de PostgreSQL finit son support le 31/12/2028 » ou « Efface la date de fin de support étendu de la version 14 de TEC-3 ».

## Conseils

- **Commencez par les données manquantes** : un serveur sans ses technologies, ou une version sans date, n'apparaît jamais dans les échéances.
- **Regardez à 24 mois pour les budgets** : une migration prévue l'an prochain a besoin de son budget cette année.
- **Utilisez le catalogue** : les technologies ajoutées depuis le catalogue arrivent avec leurs dates de fin de support. Elles viennent d'endoflife.date, ou des pages officielles de l'éditeur pour les produits que KANAP tient à jour (voir [Versions issues du catalogue](technologies.md#versions-issues-du-catalogue)).
