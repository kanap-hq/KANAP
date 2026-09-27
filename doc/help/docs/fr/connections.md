# Connexions

Les connexions documentent les chemins réseau de niveau infrastructure entre les serveurs et les entités. Alors que les interfaces décrivent les flux de données logiques entre les applications, les connexions décrivent les routes réseau physiques — quels serveurs communiquent, sur quels protocoles et ports.

## Premiers pas

Naviguez vers **Cartographie SI > Connexions** pour voir votre registre de connexions. Cliquez sur **Ajouter une connexion** pour créer votre première entrée.

**Champs obligatoires** :
  - **ID de connexion** : Un identifiant unique (par ex., `CONN-WEB-DB-001`)
  - **Nom** : Un nom descriptif
  - **Type de connexion** : Serveur à serveur ou Multi-serveurs
  - **Source** / **Destination** : Une entité, cluster ou serveur à chaque extrémité (pour Serveur à serveur)
  - **Protocoles** : Au moins un protocole réseau

**Fortement recommandé** :
  - **Objectif** : Pourquoi cette connexion existe
  - **Cycle de vie** : Statut actuel

**Conseil** : Les connexions peuvent être liées aux bindings d'interfaces pour montrer quelle infrastructure supporte chaque intégration applicative.

---

## Travailler avec la liste

La liste vous offre une vue filtrable de chaque connexion de votre registre.

**Colonnes par défaut** :
  - **ID de connexion** : Identifiant unique (cliquez pour ouvrir l'espace de travail)
  - **Nom** : Nom de la connexion (cliquez pour ouvrir l'espace de travail)
  - **Topologie** : Serveur à serveur ou Multi-serveurs
  - **Source** / **Destination** : Les points de terminaison connectés
  - **Protocoles** : Protocoles réseau affichés sous forme de pastilles
  - **Criticité** : Importance métier — peut être dérivée des interfaces liées
  - **Classe de données** : Niveau de sensibilité des données
  - **PII** : Si des données personnelles transitent par cette connexion
  - **Risque** : Manuel ou Dérivé (affiche le nombre d'interfaces liées)
  - **Cycle de vie** : Statut actuel
  - **Créé** : Date de création de l'enregistrement

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
  - **Serveurs** : Nombre de serveurs dans une connexion multi-serveurs

**Filtrage** :
  - Recherche rapide : Recherche dans les champs de connexion
  - Filtres de colonnes : Topologie et Cycle de vie (listes à cocher). Criticité, Classe de données et PII n'ont pas de filtre de colonne

**Actions** :
  - **Ajouter une connexion** : Créer une nouvelle connexion (nécessite `infrastructure:member`)
  - **Supprimer la connexion** : Supprimer les connexions sélectionnées (nécessite `infrastructure:admin`)

---

## Types de connexion

### Serveur à serveur

Une connexion directe entre deux points de terminaison spécifiques. Chaque côté peut être un serveur, un cluster ou une entité nommée :

- **Source** : Où le trafic prend son origine — choisissez un serveur, cluster ou entité
- **Destination** : Où le trafic se termine — mêmes options
- Vous ne pouvez pas sélectionner à la fois un serveur et une entité pour le même côté ; choisissez l'un ou l'autre

Si un point de terminaison est un cluster, une note vous rappellera que les hôtes membres sont gérés dans l'espace de travail Serveurs.

### Multi-serveurs

Une connexion impliquant plusieurs serveurs (par ex., clusters à équilibrage de charge ou topologies maillées) :

- Sélectionnez au moins deux serveurs dans le sélecteur **Serveurs connectés**
- Utilisez les **couches** pour définir le chemin de routage entre eux

---

## L'espace de travail Connexions

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. Il comporte quatre onglets : **Vue d'ensemble**, **Couches**, **Criticité & Conformité** et **Interfaces liées**.

### Vue d'ensemble

L'onglet Vue d'ensemble capture l'identité et la topologie de la connexion.

**Ce que vous pouvez modifier** :
  - **ID de connexion** : Identifiant unique
  - **Nom** : Nom d'affichage
  - **Objectif** : Pourquoi cette connexion existe (texte libre)
  - **Type de connexion** : Serveur à serveur ou Multi-serveurs
  - **Source** / **Destination** : Pour Serveur à serveur — choisissez un serveur, cluster ou entité dans une liste déroulante groupée
  - **Serveurs connectés** : Pour Multi-serveurs — recherchez et sélectionnez deux serveurs ou plus
  - **Protocoles** : Un ou plusieurs protocoles réseau (tirés de vos paramètres de types de connexion)
  - **Cycle de vie** : Statut actuel
  - **Notes** : Contexte supplémentaire

Lorsque vous sélectionnez des protocoles, le système affiche leurs ports typiques pour référence.

---

### Couches

L'onglet Couches vous permet de définir un chemin réseau ordonné de trois sauts maximum — utile pour documenter les reverse proxies, pare-feu ou routage intermédiaire.

**Ce que chaque couche capture** :
  - **Ordre** : Numéro de séquence (1 à 3)
  - **Nom** : Un libellé pour la couche (par ex., `direct`, `reverse_proxy`, `firewall`)
  - **Source** / **Destination** : Une entité, cluster ou serveur à chaque extrémité du saut
  - **Protocoles** : Quels protocoles sont utilisés à cette couche
  - **Port personnalisé** : Port personnalisé si différent du port par défaut du protocole (auto-rempli quand vous choisissez un protocole)
  - **Notes** : Notes spécifiques à la couche

Les couches sont enregistrées indépendamment de l'onglet Vue d'ensemble. Utilisez le bouton **Enregistrer les couches** pour persister vos modifications.

**Conseil** : Vous devez d'abord enregistrer la connexion elle-même avant de pouvoir ajouter des couches.

---

### Criticité & Conformité

Cet onglet contrôle la classification des risques et les paramètres de protection des données.

**Mode de risque** :
  - **Manuel** : Vous définissez directement la criticité, la classe de données et le PII
  - **Dérivé** : Les valeurs sont agrégées depuis les bindings d'interfaces liées — l'onglet affiche les valeurs effectives et combien de bindings contribuent

**Champs** :
  - **Criticité** : Critique métier, Haute, Moyenne ou Basse
  - **Classe de données** : Tirée des paramètres de classification de données de votre organisation
  - **Contient des PII** : Si des données personnelles transitent par la connexion

Lorsque le mode de risque est Dérivé, les champs criticité, classe de données et PII deviennent lecture seule et reflètent les valeurs les plus élevées de toutes les interfaces liées.

---

### Interfaces liées

Cet onglet montre quels bindings d'interfaces sont liés à cette connexion.

**Ce que vous verrez** :
  - **Interface** : Nom et code, avec des pastilles de criticité / classe de données / PII
  - **Environnement** : Environnement du binding et type de segment
  - **Point source** / **Point cible** : Les points de terminaison du binding
  - **Cycle de vie** : Statut du cycle de vie de l'interface
  - **Actions** : Un bouton pour naviguer vers l'espace de travail de l'interface

Cet onglet est en lecture seule. Pour lier un binding d'interface à une connexion, utilisez l'espace de travail Interface ou la carte des connexions.

---

## Conseils

  - **Commencez par les chemins critiques** : Documentez d'abord les connexions de vos applications les plus importantes, puis élargissez.
  - **Utilisez le mode de risque Dérivé** : Laissez le système calculer la criticité à partir des interfaces qui utilisent chaque connexion — cela économise de l'effort et reste à jour lorsque les interfaces changent.
  - **Liez aux interfaces** : Connecter votre infrastructure aux bindings d'interfaces vous donne une traçabilité de bout en bout des flux de données applicatifs jusqu'aux routes réseau.
  - **Documentez les protocoles avec précision** : De bonnes données de protocoles rendent les revues de règles de pare-feu et les audits de sécurité nettement plus faciles.
