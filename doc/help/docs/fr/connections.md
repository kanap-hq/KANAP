# Connexions

Les connexions documentent les chemins réseau de niveau infrastructure entre les serveurs et les entités. Alors que les interfaces décrivent les flux de données logiques entre les applications, les connexions décrivent les routes réseau physiques : quels serveurs communiquent, sur quels protocoles et ports.

## Premiers pas

Naviguez vers **Cartographie SI > Connexions** pour voir votre registre de connexions. Cliquez sur **Ajouter une connexion** pour créer votre première entrée.

**Champs obligatoires** :
  - **Nom** : Un nom descriptif
  - **Topologie** : Serveur à serveur ou Multi-serveur
  - **Endpoints** : Une source et une destination (Serveur à serveur), ou au moins deux serveurs (Multi-serveur)
  - **Protocoles** : Au moins un protocole réseau

KANAP donne à chaque connexion une référence, par exemple `CONN-12`.

**Conseil** : Les connexions peuvent être liées aux liaisons d'interfaces pour montrer quelle infrastructure supporte chaque intégration applicative.

---

## Travailler avec la liste

La liste vous offre une vue filtrable de chaque connexion de votre registre.

**Colonnes par défaut** :
  - **Référence** : La référence de la connexion, par exemple `CONN-12` (cliquez pour ouvrir l'espace de travail)
  - **Nom** : Nom de la connexion (cliquez pour ouvrir l'espace de travail)
  - **Topologie** : Serveur à serveur ou Multi-serveur
  - **Source** / **Destination** : Les points de terminaison connectés
  - **Protocoles** : Protocoles réseau affichés sous forme de pastilles
  - **Criticité** : Importance métier ; peut être dérivée des interfaces liées
  - **Classe de données** : Niveau de sensibilité des données
  - **PII** : Si des données personnelles transitent par cette connexion
  - **Risque** : Manuel ou Dérivé (affiche le nombre d'interfaces liées)
  - **Cycle de vie** : Statut actuel
  - **Créé le** : Date de création de l'enregistrement

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
  - **Serveurs** : Nombre de serveurs dans une connexion multi-serveurs

**Filtrage** :
  - Recherche rapide : Recherche dans les champs de connexion
  - Filtres de colonnes : **Topologie**, **Cycle de vie**, **Criticité**, **Classe de données** et **PII** utilisent des listes à cocher : vous pouvez choisir plusieurs valeurs à la fois. **Criticité** et **Classe de données** proposent aussi **(Vide)** pour les connexions sans valeur
  - **Criticité**, **Classe de données** et **PII** filtrent et trient sur la valeur affichée. Pour une connexion dérivée, c'est la valeur héritée de ses interfaces

**Tri** :
  - **Criticité** et **Classe de données** trient par gravité, dans l'ordre des niveaux définis dans [Classifications et continuité](it-ops-settings.md#classifications-et-continuite). Les connexions sans valeur viennent en dernier

**Actions** :
  - **Ajouter une connexion** : Créer une nouvelle connexion (nécessite `infrastructure:member`)
  - **Supprimer la connexion** : Supprimer les connexions sélectionnées (nécessite `infrastructure:admin`). Les sauts de chaque connexion supprimée sont supprimés avec elle. Leurs serveurs, interfaces et documents sont conservés ; seuls leurs liens avec la connexion sont supprimés. Pour supprimer une seule connexion, ouvrez-la et utilisez **Supprimer** dans son en-tête, ce qui nécessite `infrastructure:member` (voir [L'espace de travail Connexions](#lespace-de-travail-connexions)).

---

## Types de connexion { #connection-types }

### Serveur à serveur

Une connexion directe entre deux extrémités. Chaque côté est un serveur, un cluster ou une entité :

- **Source** : L'origine du trafic
- **Destination** : L'arrivée du trafic
- Un côté porte un seul serveur, cluster ou entité
- La source et la destination ne peuvent pas être le même actif

### Multi-serveur

Une connexion entre plusieurs serveurs, par exemple une réplication entre nœuds ou un maillage. Sélectionnez au moins deux serveurs ou clusters.

### Connexions sur un cluster { #connections-on-a-cluster }

Une source, une destination, un serveur d'une connexion multi-serveur ou l'équipement d'un saut peut être un cluster. La connexion vaut alors pour les membres en service du cluster. Un membre ajouté plus tard la reçoit aussi. Un membre retiré du cluster la perd. Un membre retiré du service ne reçoit rien, et un cluster retiré ne transmet rien.

Les sélecteurs marquent un cluster d'une icône et listent ses membres sous son nom.

Quand vous choisissez un serveur membre d'un cluster, KANAP demande **Raccorder au cluster ?**. **Raccorder au cluster** pose le cluster sur la connexion, pour tous ses membres. **Ce serveur seulement** garde le serveur. KANAP ne pose pas la question quand l'autre côté est déjà ce cluster ou un de ses membres : la connexion reste sur le serveur.

Une liste multi-serveur qui contient un cluster et un de ses membres ne garde que le cluster. Un message nomme les membres retirés de la liste. Une liste doit garder au moins deux serveurs.

L'onglet [Réseau](assets.md#network) de chaque membre liste les connexions de ses clusters, et la [carte des connexions](connection-map.md) dessine les membres d'un cluster.

---

## L'espace de travail Connexions

Cliquez sur une ligne pour ouvrir l'espace de travail. Il a trois onglets : **Vue d'ensemble**, **Chemin** et **Historique** (les modifications apportées à la connexion, voir [Historique des fiches](record-history.md)). Le panneau des propriétés, à droite, porte **Cycle de vie**, **Topologie**, **Mode de risque**, **Criticité**, **Classification des données**, **Contient des PII** et **Créé le**. Les modifications s'enregistrent automatiquement.

**Supprimer**, une icône de corbeille dans l'en-tête, supprime la connexion après confirmation (`infrastructure:member`). La confirmation compte les sauts supprimés avec elle et les liaisons d'interfaces dont elle est détachée. Les interfaces elles-mêmes restent.

### Vue d'ensemble

- **Description** : Pourquoi cette connexion existe et ce qu'elle transporte
- **Endpoints** : La source et la destination, ou les serveurs d'une connexion multi-serveur. Voir [Types de connexion](#connection-types)
- **Protocoles** : Un ou plusieurs protocoles réseau, issus de vos paramètres de types de connexion, avec leurs ports usuels
- **Dérivation du risque** : En mode de risque dérivé, les interfaces dont vient le risque, avec leur criticité, leur classification des données et leurs PII
- **Interfaces associées** : Les liaisons d'interfaces liées à cette connexion. **Associer une existante** en lie une autre

### Chemin

L'onglet Chemin documente le chemin réseau de la connexion, saut par saut : proxys inverses, pare-feu, répartiteurs de charge. Créez d'abord la connexion pour ajouter des sauts.

Chaque saut a :

  - Une fonction, par exemple Pare-feu, Proxy inverse ou Répartiteur de charge
  - **Équipement** : Un serveur, un cluster ou une entité, ou rien quand l'équipement n'est pas documenté. Un serveur membre d'un cluster pose la même question qu'une extrémité. Voir [Connexions sur un cluster](#connections-on-a-cluster)
  - **Protocoles (surcharge)** et **Port** : Quand ils diffèrent de ceux de la connexion
  - **Notes**

**Ajouter un saut** ajoute un saut à la fin. Les flèches réordonnent les sauts et la corbeille en retire un. Chaque modification s'enregistre aussitôt.

### Risque

**Mode de risque**, dans le panneau des propriétés :

  - **Manuel** : Vous fixez directement la criticité, la classification des données et les PII
  - **Dérivé** : Les valeurs viennent des liaisons d'interfaces liées. Les champs sont en lecture seule et montrent les valeurs les plus élevées parmi les interfaces liées

**Criticité** utilise les niveaux de [Classifications et continuité](it-ops-settings.md#classifications-et-continuite). Les niveaux par défaut sont Critique, Élevée, Modérée et Faible. **Classification des données** vient de vos paramètres de classification des données.

---

## Conseils

  - **Commencez par les chemins critiques** : Documentez d'abord les connexions de vos applications les plus importantes, puis élargissez.
  - **Utilisez le mode de risque Dérivé** : Laissez le système calculer la criticité à partir des interfaces qui utilisent chaque connexion : cela économise de l'effort et reste à jour lorsque les interfaces changent.
  - **Liez aux interfaces** : Connecter votre infrastructure aux bindings d'interfaces vous donne une traçabilité de bout en bout des flux de données applicatifs jusqu'aux routes réseau.
  - **Documentez les protocoles avec précision** : De bonnes données de protocoles rendent les revues de règles de pare-feu et les audits de sécurité nettement plus faciles.
