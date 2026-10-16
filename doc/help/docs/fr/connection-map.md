# Carte des connexions

La Carte des connexions est une visualisation interactive de la topologie de votre réseau d'infrastructure. Les serveurs, clusters et entités externes apparaissent comme des nœuds ; les connexions entre eux sont les arêtes. Utilisez-la pour explorer les dépendances, tracer les chemins de connexion et exporter des diagrammes pour la documentation d'architecture ou les revues de sécurité.

## Où la trouver

Rendez-vous dans **Cartographie SI > Carte des connexions** pour ouvrir la visualisation.

**Autorisations** : Vous avez besoin d'au moins `applications:reader` pour consulter la carte.

---

## Comprendre la visualisation

La carte utilise une disposition de graphe à forces dirigées où :

- **Les nœuds** représentent les serveurs, clusters ou entités externes
- **Les arêtes** représentent les connexions entre composants d'infrastructure
- **Les couleurs** indiquent le type d'hébergement (sur site, cloud) ou le type de nœud
- **Le placement basé sur les rôles** (activé par défaut) conserve la disposition à forces mais pousse les nœuds dans des bandes hiérarchiques de haut en bas

### Types de nœuds

| Type | Forme | Couleur de bordure | Description |
|------|-------|--------------------|-------------|
| **Serveurs** | Rectangle arrondi | Vert (sur site) ou bleu (cloud) | Instances d'infrastructure individuelles (VM, conteneurs, etc.) |
| **Clusters** | Rectangle arrondi, bordure pointillée | Cyan | Groupes de serveurs agissant comme une seule unité logique |
| **Entités** | Pastille / forme stade | Orange | Points de terminaison logiques (systèmes externes, services SaaS) |

Les membres de cluster apparaissent comme des nœuds serveur séparés, avec des lignes indicatrices pointillées les reliant à leur nœud cluster parent.

---

## Filtres

### Cycle de vie

Filtre multi-sélection pour le statut de cycle de vie de la connexion (Actif, Planifié, Obsolète, etc.). Par défaut sur **Actif**.

### Applications et environnement d'app

Trouvez des serveurs via les applications qui s'y exécutent :

1. Sélectionnez une ou plusieurs applications dans le menu déroulant **Applications**
2. Choisissez les environnements dans le menu déroulant **Env. d'app** (seuls les environnements où les apps sélectionnées ont des serveurs assignés apparaissent)
3. Les serveurs correspondants sont automatiquement ajoutés au filtre **Serveurs**

C'est utile lorsque vous voulez voir les connexions d'infrastructure pour une application sans savoir sur quels serveurs elle s'exécute.

### Serveurs

Choisissez directement les serveurs, clusters ou entités à mettre en avant :

1. Cliquez sur le menu déroulant **Serveurs**
2. Choisissez des éléments (regroupés par **Entités**, **Clusters**, **Serveurs**)
3. Utilisez le filtre **Profondeur** pour contrôler combien de sauts afficher

Lorsque de nombreux éléments sont sélectionnés, seule la première pastille est affichée avec une pastille **+N de plus**. Cliquez sur **+N de plus** pour ouvrir une popover qui liste tous les éléments sélectionnés, avec une icône de suppression à côté de chacun.

### Profondeur

Limite le nombre de sauts à partir des éléments sélectionnés à afficher :

- **Tout** : Afficher toutes les connexions (pas de filtrage par profondeur)
- **0** : Afficher uniquement les éléments sélectionnés, leurs clusters parents et les entités directement adjacentes
- **1-5** : Afficher les éléments dans un rayon de N sauts des racines sélectionnées

La profondeur bascule automatiquement à **0** lorsque vous sélectionnez des racines via les filtres Applications ou Serveurs.

---

## Options d'affichage

### Afficher les connexions multi-serveurs

Bascule la visibilité des connexions multi-serveurs (connexions impliquant plus de deux serveurs dans une topologie maillée). Activé par défaut.

### Afficher les couches de connexion

Lorsque activé (par défaut), chaque leg d'une connexion multi-leg est rendu comme sa propre arête, vous permettant de voir comment elle est routée à travers les points intermédiaires. Lorsque désactivé, les connexions sont rendues comme de simples arêtes source-vers-destination.

### Placement basé sur les rôles

Lorsque activé (par défaut), la carte conserve sa disposition à forces mais ajoute un guidage hiérarchique vertical :

- Bandes **Haut / Supérieur / Centre / Inférieur / Bas**
- **Les serveurs** utilisent les assignations de rôles configurées dans les paramètres Cartographie SI
- **Les entités** utilisent leur **Niveau du graphe** configuré (par défaut Haut)
- **Les serveurs non assignés** retombent au Centre
- **Les clusters** héritent du niveau de plus haute priorité de leurs membres

Utilisez cette bascule lorsque vous voulez une vue de topologie qui se lit comme des niveaux d'architecture (composants en façade en haut, magasins de données en bas). Le paramètre est uniquement par session et se réinitialise au rechargement de la page.

---

## Contrôles du graphe

Le panneau de contrôle sur le côté gauche de la carte fournit ces outils :

| Contrôle | Action | Description |
|----------|--------|-------------|
| Pause / Lecture | **Geler / dégeler** | Mettre en pause la simulation à forces pour positionner manuellement les nœuds |
| Réticule | **Centrage automatique** | Basculer le centrage automatique lors de la sélection de nœuds (mis en évidence lorsque activé) |
| Zoom + | **Zoom avant** | Augmenter le niveau de zoom |
| Zoom - | **Zoom arrière** | Diminuer le niveau de zoom |
| Grille | **Aligner sur la grille** | Aligner tous les nœuds sur une grille pour des dispositions plus propres |
| SVG | **Exporter en SVG** | Télécharger la vue actuelle comme image vectorielle |
| PNG | **Exporter en PNG** | Télécharger la vue actuelle comme image matricielle |

Vous pouvez également zoomer avec la molette de la souris et faire un panoramique en cliquant et faisant glisser l'arrière-plan.

---

## Interagir avec la carte

### Sélectionner des nœuds

Cliquez sur un nœud serveur ou cluster pour mettre en évidence ses connexions et ouvrir un panneau de détails affichant :

- **Type de serveur**, **Site du serveur**, **Système d'exploitation**, **Segment réseau**, **Adresse IP**
- **Applications assignées** : Apps s'exécutant sur ce serveur, regroupées par environnement. Cliquez sur un nom d'app pour l'ouvrir.
- Bouton **Modifier le serveur** ou **Voir le cluster** pour ouvrir l'espace de travail

Cliquez sur un nœud entité pour voir son type et son environnement.

### Sélectionner des arêtes

Cliquez sur une arête de connexion pour voir :

- **Objectif**, **Protocoles**, **Ports typiques**, **Criticité**
- **Topologie** : Serveur à serveur ou Multi-serveur
- Bouton **Modifier la connexion** pour ouvrir l'espace de travail de la connexion
- Section **Interfaces liées** affichant quelles interfaces applicatives utilisent cette connexion. Chaque carte d'interface liée affiche le type de leg, l'environnement, le pattern et les points de terminaison source/cible. Depuis là, vous pouvez :
  - Cliquer sur **Ouvrir l'interface** pour consulter l'interface
  - Cliquer sur **Voir dans la Carte des interfaces** pour sauter à l'interface dans son contexte

### Faire glisser des nœuds

Faites glisser n'importe quel nœud pour le repositionner. Pendant que la simulation tourne, la disposition s'ajuste autour du nœud déplacé. Lorsque la simulation est gelée, faire glisser déplace le nœud librement sans affecter les autres.

---

## Liens directs

La carte prend en charge les paramètres URL pour partager des vues spécifiques :

| Paramètre | Description | Exemple |
|-----------|-------------|---------|
| `lifecycles` | Pré-sélectionner les filtres de cycle de vie (séparés par virgules) | `active,planned` |
| `focusConnectionId` | Mettre en évidence une connexion spécifique | UUID |
| `rootIds` | Pré-sélectionner serveurs/clusters/entités à mettre en avant (séparés par virgules) | UUIDs |
| `depth` | Définir la limite de profondeur | `0`, `1`, `all` |

**Exemple** : `/it/connection-map?lifecycles=active&rootIds=abc123&depth=1`

---

## Visualisation des clusters

Les clusters apparaissent comme des nœuds distincts avec une bordure cyan pointillée :

- Les membres du cluster apparaissent comme des nœuds séparés connectés à leur cluster parent par des lignes indicatrices pointillées
- Lors du filtrage avec depth=0, à la fois les serveurs membres sélectionnés et leurs clusters parents sont affichés
- Les serveurs membres conservent leurs propres connexions serveur-à-serveur en plus des connexions du cluster

---

## Configurer les niveaux du graphe

Vous pouvez contrôler où les nœuds tendent à apparaître verticalement en modifiant les niveaux dans **Cartographie SI > Paramètres** :

- Liste **Rôles serveur** : définir le Niveau du graphe pour chaque rôle (ex. : Web = Haut, BD = Bas)
- Liste **Entités** : définir le Niveau du graphe pour chaque type d'entité (les entités sont par défaut au niveau Haut)

Les changements de niveau prennent effet au prochain chargement des données de la carte.

---

## Conseils

- **Partez des applications** : Utilisez les filtres Applications + Env. d'app pour trouver les serveurs d'une application spécifique sans connaître les noms des serveurs.
- **Utilisez depth=0 pour des vues focalisées** : Lorsque vous ne voulez voir que les connexions directement attachées à des serveurs spécifiques, sélectionnez-les et définissez la profondeur à 0.
- **Exportez pour la documentation d'architecture** : SVG produit des diagrammes réseau vectoriels adaptés à la documentation ; PNG produit une image matricielle haute résolution.
- **Activez les couches pour le dépannage** : Activez **Afficher les couches de connexion** pour voir exactement comment les connexions multi-leg sont routées dans votre infrastructure.
- **Utilisez les niveaux de rôles pour les vues d'architecture** : Gardez **Placement basé sur les rôles** activé lors de la présentation de diagrammes d'architecture en couches.
- **Recoupez avec la Carte des interfaces** : Utilisez **Voir dans la Carte des interfaces** dans le panneau des interfaces liées pour voir quelles interfaces métier dépendent d'une connexion d'infrastructure donnée.
- **Alignez et gelez avant d'exporter** : Après avoir positionné les nœuds, gelez la disposition et utilisez **Aligner sur la grille** pour produire la sortie la plus propre.
