# Carte des interfaces

La Carte des interfaces est une visualisation interactive de votre paysage d'intégration applicative. Les applications apparaissent comme des nœuds et les interfaces comme des arêtes de connexion, vous donnant une vue d'ensemble de la circulation des données entre vos systèmes pour un environnement donné.

## Où la trouver

Rendez-vous dans **Cartographie SI > Carte des interfaces** pour ouvrir la visualisation.

**Autorisations** : Vous avez besoin d'au moins `applications:reader` pour consulter la carte.

---

## Comprendre la visualisation

La carte utilise une disposition de graphe à forces dirigées où :

- **Les nœuds** représentent les applications
- **Les arêtes** représentent les interfaces entre applications
- **Les libellés des arêtes** affichent l'identifiant de l'interface sur chaque connexion
- **La taille des nœuds** reflète combien d'interfaces touchent l'application

### Vue Métier vs Technique

Basculez entre les deux modes de vue avec le commutateur **Afficher le middleware** dans la barre d'outils.

**Vue métier** (par défaut, commutateur désactivé) :

- Masque les applications middleware
- Affiche les relations directes source-vers-cible
- Idéale pour comprendre les flux de données métier

**Vue technique** (commutateur activé) :

- Affiche les plateformes middleware comme nœuds intermédiaires (rendus comme des losanges)
- Développe chaque interface en son chemin de données réel (Source -> Middleware -> Cible)
- Idéale pour comprendre l'architecture technique

Une courte légende sous l'en-tête de page rappelle quelle vue est active.

---

## Filtres

Tous les filtres se trouvent dans la barre d'outils au-dessus de la carte.

### Environnement

Filtrer les interfaces par environnement de déploiement :

- Production, Pré-prod, QA, Test, Développement, Sandbox

La valeur par défaut est **Production**. Les liaisons affichées dans le panneau latéral et les connexions d'infrastructure liées reflètent toujours l'environnement sélectionné.

### Cycle de vie

Filtre multi-sélection pour le statut de cycle de vie de l'interface (Actif, Planifié, Obsolète, etc.). Par défaut sur **Actif**.

### Applications

Concentrer la carte sur des applications ou services spécifiques :

1. Cliquez sur le menu déroulant **Applications**
2. Choisissez une ou plusieurs options (regroupées sous **Applications** et **Services d'infrastructure**)
3. La carte filtre pour afficher uniquement les interfaces connectées à votre sélection

Lorsque vous choisissez au moins une application ici, le filtre **Profondeur** bascule automatiquement de **Tout** à **1** afin que vous ne voyiez que le voisinage immédiat.

### Profondeur

Limite le nombre de sauts à partir des applications sélectionnées à afficher :

- **Tout** : Afficher tous les nœuds connectés (pas de limite)
- **1-5** : Afficher uniquement les nœuds dans un rayon de N sauts des applications sélectionnées

Les nœuds middleware ne comptent pas comme un saut -- le compteur de profondeur ne s'incrémente que lors de la traversée d'un nœud d'application principale.

Ce filtre ne prend effet que lorsque vous avez au moins une application sélectionnée ; sans sélection, la valeur est verrouillée sur **Tout**.

---

## Contrôles du graphe

Le panneau de contrôle sur le côté gauche de la carte fournit ces outils :

| Icône | Action | Description |
|-------|--------|-------------|
| Pause / Lecture | **Geler / dégeler** | Mettre en pause la simulation à forces pour positionner manuellement les nœuds |
| Réticule | **Centrage automatique** | Basculer le centrage automatique lors de la sélection de nœuds (mis en évidence lorsque activé) |
| Zoom + | **Zoom avant** | Augmenter le niveau de zoom |
| Zoom - | **Zoom arrière** | Diminuer le niveau de zoom |
| Grille | **Aligner sur la grille** | Aligner tous les nœuds sur une grille pour des dispositions plus propres |
| SVG | **Exporter en SVG** | Télécharger la vue actuelle comme image vectorielle |
| PNG | **Exporter en PNG** | Télécharger la vue actuelle comme image matricielle |

Les boutons gel et centrage automatique changent de couleur lorsqu'ils sont actifs, vous permettant de voir d'un coup d'œil s'ils sont activés ou non. Vous pouvez également zoomer avec la molette de la souris et faire un panoramique en cliquant et faisant glisser l'arrière-plan.

---

## Interagir avec la carte

### Sélectionner des nœuds

Cliquez sur un nœud d'application pour mettre en évidence ses connexions et ouvrir un panneau de détails sur la droite.

### Sélectionner des arêtes

Cliquez sur une arête d'interface pour voir les détails de l'interface dans le panneau latéral. Les arêtes ont une zone de clic invisible plus large, vous n'avez donc pas besoin de cliquer précisément sur la ligne.

### Faire glisser des nœuds

Faites glisser n'importe quel nœud pour le repositionner manuellement. Pendant que la simulation tourne, la disposition continue de s'ajuster autour du nœud déplacé. Lorsque la simulation est gelée, le nœud reste exactement où vous le placez.

### Effacer la sélection

Cliquez sur l'arrière-plan vide de la carte (ou **Fermer** dans le panneau latéral) pour fermer le panneau de détails.

### Liens directs

La carte prend en charge les paramètres URL pour partager des vues spécifiques :

| Paramètre | Description | Exemple |
|-----------|-------------|---------|
| `environment` | Pré-sélectionner un environnement | `prod`, `dev` |
| `lifecycles` | Pré-sélectionner les filtres de cycle de vie (séparés par virgules) | `active,planned` |
| `focusInterfaceId` | Mettre en évidence une interface spécifique | UUID |
| `rootIds` | Pré-sélectionner les applications à mettre en avant (séparés par virgules) | UUIDs |
| `depth` | Définir la limite de profondeur | `1`, `2`, `all` |

**Exemple** : `/it/interface-map?environment=prod&rootIds=abc123&depth=2`

---

## Le panneau de détails

Lorsque vous sélectionnez un nœud ou une arête, un panneau latéral s'ouvre sur la droite avec les détails.

### Panneau Application

- **Description** : Ce que fait l'application
- **Éditeur** : Éditeur du logiciel
- **Criticité** : Critique métier, Haute, Moyenne ou Basse
- **Serveurs** : Serveurs hébergeant cette app, regroupés par environnement. Cliquez sur un nom de serveur pour ouvrir son espace de travail.
- **Responsables métier** et **Responsables IT** : Contacts responsables
- **Informations de support** : Contacts de support avec leurs rôles. Cliquez sur un nom de contact pour naviguer vers l'onglet Technique de l'application.
- **Modifier l'application** : Ouvre l'espace de travail de l'application

### Panneau Interface

Pour l'interface sélectionnée et l'environnement courant :

- **Criticité**, **Route**, **Nombre de liaisons**, **Via middleware** (oui/non)
- **Points de terminaison** : Pour chaque liaison dans l'environnement actif, affiche app source -> app cible, type de leg, nom du job, point de terminaison source et point de terminaison cible
- **Connexions infra** : Connexions d'infrastructure liées à cette interface pour l'environnement courant. Chaque carte affiche source, destination, protocoles et l'environnement / type de leg de la liaison. Depuis la carte, vous pouvez :
  - Cliquer sur **Modifier** pour ouvrir l'espace de travail de la connexion
  - Cliquer sur **Voir dans la Carte des connexions** pour sauter à la topologie d'infrastructure, pré-focalisée sur la connexion
- **Modifier l'interface** : Ouvre l'espace de travail de l'interface

---

## Conseils

- **Commencez par Production** : Sélectionnez l'environnement Prod pour voir d'abord vos intégrations les plus critiques.
- **Concentrez-vous sur des apps spécifiques** : Choisissez quelques apps dans le filtre Applications et utilisez la profondeur 1 ou 2 pour explorer le voisinage d'une application sans le paysage complet.
- **Basculez en vue Technique** : Lors du dépannage, activez **Afficher le middleware** pour voir le chemin de données réel à travers les plateformes d'intégration.
- **Exportez pour la documentation** : Utilisez SVG pour créer des diagrammes d'architecture vectoriels, ou PNG lorsque vous avez besoin d'une image matricielle.
- **Alignez pour la clarté** : Après avoir glissé les nœuds en position, utilisez **Aligner sur la grille** pour créer des dispositions plus propres et mieux alignées.
- **Liens directs pour le partage** : Copiez l'URL après avoir défini les filtres pour partager des vues spécifiques avec des collègues.
- **Recoupez avec la Carte des connexions** : Utilisez **Voir dans la Carte des connexions** dans la section Connexions infra pour voir la topologie réseau sous-jacente d'une liaison choisie.
