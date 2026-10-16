# Actifs

Les Actifs documentent votre inventaire d'infrastructure -- serveurs physiques, machines virtuelles, conteneurs, instances cloud et équipements réseau. Liez les actifs aux sites, applications, connexions, contrats, projets et tâches pour construire une image complète de votre infrastructure IT.

## Premiers pas

Rendez-vous dans **Cartographie SI > Actifs** pour voir votre inventaire d'actifs. Cliquez sur **Ajouter un actif** pour créer votre première entrée.

**Champs obligatoires** :
- **Nom** : Un nom d'actif ou nom d'hôte unique
- **Type d'actif** : Serveur web, Machine virtuelle, Serveur physique, Conteneur, etc. (configurable dans **Cartographie SI > Paramètres**)
- **Site** : Où l'actif est hébergé (détermine le fournisseur, le type d'hébergement et le pays)

**Fortement recommandé** :
- **Cycle de vie** : Statut actuel (Actif, Obsolète, Retiré, etc.)
- **Environnement** : À quel environnement cet actif appartient (Prod, Pré-prod, QA, Test, Dev, Sandbox)

**Conseil** : Utilisez des conventions de nommage cohérentes incluant l'environnement et les informations de rôle (ex. : `prod-web-01`, `dev-db-master`). Lors de la création d'un nouvel actif, le nom d'hôte est automatiquement dérivé du nom que vous saisissez.

**Autorisations** :
- Consultation : `infrastructure:reader`
- Création / modification : `infrastructure:member`
- Import / Export / Suppression : `infrastructure:admin`

---

## Travailler avec la liste

La liste des actifs vous donne une vue filtrable et triable de chaque actif de votre inventaire.

**Colonnes par défaut** :

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **#** | Référence de l'actif (ex. : `AST-123`), monospace |
| **Nom** | Nom de l'actif (cliquez pour ouvrir l'espace de travail) |
| **Type d'actif** | Le type de l'actif (ex. : Machine virtuelle, Serveur physique) |
| **Cluster** | Appartenance à un cluster, ou un badge « Cluster » si cet actif est lui-même un cluster |
| **Environnement** | Prod, Pré-prod, QA, Test, Dev, Sandbox -- avec un point coloré |
| **Site** | Où l'actif est hébergé |
| **Hébergement** | Type d'hébergement (dérivé du site) |
| **OS** | Système d'exploitation |
| **Zone réseau** | Segment réseau (dérivé du sous-réseau) |
| **Cycle de vie** | Statut de cycle de vie actuel |
| **Assignations** | Nombre d'assignations d'applications |
| **Créé** | Quand l'enregistrement a été créé |

**Tri par défaut** : **Créé** décroissant (le plus récent en premier).

**Colonnes supplémentaires** (masquées par défaut, disponibles via le sélecteur de colonnes) :
- **Sous-site** : Zone spécifique au sein du site (bâtiment, salle, baie)
- **Mise en production** : Date à laquelle l'actif est entré en production
- **Fin de vie** : Date de retrait planifiée ou effective

**Filtrage** :

La plupart des colonnes prennent en charge des filtres par jeu de cases à cocher pour un filtrage multi-sélection rapide. Les options de filtre se mettent à jour dynamiquement en fonction des autres filtres actifs et de la requête de recherche, vous ne voyez donc que les valeurs présentes dans le jeu de résultats actuel.

| Colonne | Notes |
|---------|-------|
| Type d'actif | Filtrer par un ou plusieurs types d'actif |
| Cluster | Inclut « (Sans cluster) » pour les actifs autonomes |
| Environnement | Prod, Pré-prod, QA, Test, Dev, Sandbox |
| Site | Inclut « (Sans site) » pour les actifs non assignés |
| Sous-site | Inclut « (Sans sous-site) » pour les actifs sans sous-site |
| Hébergement | Filtrer par type d'hébergement |
| OS | Filtrer par système d'exploitation |
| Zone réseau | Filtrer par segment réseau |
| Cycle de vie | Filtrer par statut de cycle de vie |

**Conseil** : Combinez les filtres entre colonnes pour affiner les résultats. Par exemple, filtrez par Environnement = « Prod » et Cycle de vie = « Actif » pour voir uniquement les actifs de production actifs.

**Actions** :
- **Ajouter un actif** : Créer un nouvel actif (`infrastructure:member`)
- **Import CSV** / **Export CSV** : Opérations en masse (`infrastructure:admin`)
- **Supprimer un actif** (lignes sélectionnées) : Supprimer les actifs sélectionnés (`infrastructure:admin`). Un actif encore affecté à des applications ou lié à des connexions ne peut pas être supprimé : retirez-le d'abord de ces éléments. Avant toute suppression, la confirmation liste les actifs conservés, avec la raison

---

## Clusters

Les actifs peuvent être organisés en clusters :

- **Actif standard** : Une instance d'infrastructure individuelle
- **Cluster** : Un groupe d'actifs agissant comme une seule unité logique

Lors de la modification d'un actif, basculez **Cluster** dans l'onglet Technique pour le marquer comme cluster. Les actifs cluster peuvent être des points de terminaison dans les connexions, mais les assignations d'applications doivent être faites sur les hôtes membres, pas sur le cluster lui-même.

Les membres du cluster sont gérés depuis l'onglet **Technique** de l'espace de travail du cluster via **Modifier les membres**.

---

## L'espace de travail des Actifs

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. L'espace de travail comporte un **en-tête** avec des métadonnées rapides, un **tiroir des propriétés** sur la droite (la carte d'identité de l'actif -- toujours visible) et une **zone de contenu** au centre qui change selon l'onglet.

### En-tête

L'en-tête affiche :
- **Nom de l'actif** (modifiable sur place)
- **Référence de l'actif** (ex. : `AST-123`) : identifiant copiable
- Pastille **Cycle de vie** (également modifiable depuis le tiroir des propriétés)
- **Envoyer le lien** : copier un lien partageable vers cet espace de travail
- **Supprimer** (`infrastructure:admin`). Pour un actif encore utilisé, la raison s'affiche avant toute confirmation
- **Précédent / Suivant** (ex. : « 3 sur 47 ») : naviguer dans la liste filtrée sans y revenir

### Tiroir des propriétés (panneau de droite)

Le tiroir affiche la carte d'identité de l'actif sur chaque onglet. Les modifications sont enregistrées automatiquement.

**Identification et site** :
- **Type d'actif** (obligatoire)
- **Site** (obligatoire)
- **Sous-site** (lorsque le site a des sous-sites définis)
- **Type d'hébergement**, **Fournisseur cloud / Société exploitante**, **Pays**, **Ville** -- en lecture seule, dérivés du site

**Statut** :
- **Environnement** : Prod, Pré-prod, QA, Test, Dev, Sandbox
- **Cycle de vie** : Actif, Obsolète, Retiré, etc. (configurable dans les Paramètres)
- **Mise en production** : Quand l'actif est entré en production
- **Fin de vie** : Date de retrait planifiée ou effective

---

### Vue d'ensemble

L'onglet Vue d'ensemble est la page d'accueil de l'actif.

**Description** : Une description en texte enrichi de l'actif. Sauvegarde automatiquement au fur et à mesure que vous éditez.

**Assignations** (non affichées pour les actifs cluster) : Liste les applications s'exécutant sur cet actif. Chaque ligne affiche :

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **Application** | Nom de l'application (cliquable -- saute aux Déploiements de l'application) |
| **Environnement** | L'environnement de déploiement auquel l'assignation appartient |
| **Rôle** | Rôle serveur (Web, Base de données, Application, etc.) |
| **Depuis** | Date à laquelle le serveur a été assigné |
| **Notes** | Notes en texte libre |

Cliquez sur **Ajouter une assignation** pour rattacher cet actif à un déploiement d'application. Choisissez l'application, puis l'environnement (l'application doit déjà avoir un déploiement dans cet environnement), puis le rôle et la date / les notes optionnelles. Utilisez les icônes de ligne pour modifier ou supprimer.

Si cet actif est un cluster, une notification en ligne remplace le tableau d'assignations et vous demande d'assigner les hôtes membres à la place.

**Connexions** : Une vue en lecture seule de toutes les connexions impliquant cet actif. Chaque ligne affiche l'ID et le nom de la connexion (cliquable -- ouvre l'espace de travail de la Connexion), la topologie (Serveur à serveur ou Multi-serveur), les protocoles, les libellés des points de terminaison source et destination, et le statut de cycle de vie. Pour créer ou modifier une connexion, rendez-vous dans **Cartographie SI > Connexions**.

**Connaissances** : Articles de connaissances liés pour cet actif. Avec `knowledge:member`, vous pouvez créer de nouveaux articles directement depuis cette section.

---

### Technique

L'onglet Technique organise le cluster, l'identité réseau et la configuration IP.

**Gestion du cluster** :
- Bascule **Cluster** : marquer cet actif comme cluster.
- Si l'actif **est un cluster** : une section **Membres** liste les actifs membres (Nom, Environnement, Statut, Système d'exploitation). Cliquez sur **Modifier les membres** pour ajouter ou supprimer des membres via une boîte de dialogue de recherche.
- Si l'actif **n'est pas un cluster** : une section **Appartenance à un cluster** affiche les clusters auxquels cet actif appartient (le cas échéant).

**Identité** :
- **Nom d'hôte** : Le nom d'hôte réseau de l'actif. Pré-rempli automatiquement à partir du nom de l'actif lors de la création ; vous pouvez le remplacer à tout moment. Obligatoire lorsqu'un domaine est sélectionné. Il accepte les lettres, les chiffres, les traits d'union et les points, chaque partie entre deux points étant limitée à 63 caractères : un nom comme `DL3.ROBOT-15MS.IE2000` est donc valide tel quel.
- **Domaine** : Le domaine Active Directory ou DNS auquel l'actif appartient. Choisissez parmi les domaines configurés dans **Cartographie SI > Paramètres**. Les options système incluent « Workgroup » (autonome) et « N/A » (non applicable).
- **FQDN** : Fully Qualified Domain Name, calculé automatiquement à partir du nom d'hôte et du suffixe DNS du domaine. Lecture seule.
- **Alias** : Noms DNS ou alias supplémentaires pour cet actif. Tapez et appuyez sur Entrée pour ajouter.
- **Système d'exploitation** : Type et version d'OS (ex. : Windows Server 2022, Ubuntu 24.04 LTS). Désactivé pour les clusters -- l'OS est défini par membre. Lorsqu'il est sélectionné, affiche les dates de fin de support standard et étendu en dessous.

**Adresses IP** :

Les actifs prennent en charge plusieurs adresses IP, chacune avec sa propre configuration réseau :

- Cliquez sur **Ajouter une adresse IP** pour ajouter une nouvelle entrée.
- **Type** : L'objectif de l'adresse IP (Hôte, IPMI, Management, iSCSI, ou types personnalisés depuis les Paramètres)
- **Adresse IP** : L'adresse elle-même
- **Sous-réseau** : Sous-réseau depuis la liste configurée (filtré au site de l'actif)
- **Zone réseau** : Dérivée automatiquement du sous-réseau sélectionné (lecture seule)
- **VLAN** : Dérivé automatiquement du sous-réseau sélectionné (lecture seule)

Cela vous permet de documenter plusieurs interfaces réseau par actif -- par exemple, un serveur physique avec à la fois une IP hôte et une adresse de management IPMI sur des sous-réseaux différents.

---

### Matériel

*Visible uniquement pour les types d'actifs physiques.*

Suit les détails du matériel physique. Sauvegarde automatique au fur et à mesure que vous tapez.

- **Numéro de série**
- **Fabricant**
- **Modèle**
- **Date d'achat**
- **Emplacement en baie** (ex. : Rangée A, Baie 12)
- **Unité de baie** (ex. : U1-U4)
- **Notes**

---

### Support

*Visible uniquement pour les types d'actifs physiques.*

Suit les informations de support et de contact fournisseur.

- **Fournisseur** : Sélectionner depuis l'annuaire des fournisseurs
- **Contrat de support** : Lien vers un enregistrement de contrat
- **Niveau de support** : Texte libre (ex. : Or, Argent, 24x7)
- **Expiration du support** : Date d'expiration
- **Notes**

**Contacts de support** : Un tableau où vous pouvez ajouter des contacts depuis l'annuaire de contacts, chacun avec un libellé de rôle en texte libre. Le tableau affiche automatiquement l'e-mail, le téléphone et le mobile de chaque contact.

---

### Relations

L'onglet Relations connecte cet actif à d'autres enregistrements dans KANAP. Le badge de l'onglet compte tous les éléments liés. La plupart des champs sont enregistrés automatiquement.

**Relations entre actifs** :
- **Dépend de** : Autres actifs dont celui-ci dépend (ex. : un serveur de base de données)
- **Contient** : Actifs contenus dans celui-ci (ex. : serveurs dans une baie)
- **Contenu par** / **Dépendu par** : Vues inverses en lecture seule, affichées uniquement lorsque d'autres actifs référencent celui-ci

**Finance et projets** :
- **Lignes budgétaires** : Lien vers des lignes OPEX et CAPEX, dans une seule liste. Recherchez par titre ou par référence (`BL-12`) ; chaque suggestion affiche son type
- **Contrats** : Lien vers des enregistrements de contrats
- **Projets** : Lien vers des projets du portefeuille liés à cet actif

**Tâches** : Tâches liées à cet actif. En lecture seule ici -- les tâches gagnent ou perdent ce lien lorsque vous définissez le champ **Actif** sur une tâche dans la page Tâches.

**Sites web pertinents** : Ajoutez des URL avec des noms optionnels -- utile pour les portails fournisseurs, tableaux de bord de monitoring ou liens de documentation. **Ajouter une URL** ouvre une boîte de dialogue ; les entrées existantes peuvent être modifiées ou supprimées.

**Pièces jointes** : Glissez-déposez des fichiers ou cliquez sur **Sélectionner des fichiers** pour téléverser. Cliquez sur la pastille d'une pièce jointe pour la télécharger. La suppression est disponible pour les managers.

---

## Import/export CSV

Maintenez votre inventaire d'actifs à grande échelle grâce à l'import et l'export CSV. Cette fonctionnalité prend en charge les opérations en masse pour le chargement initial de données, les mises à jour périodiques depuis des systèmes externes et l'extraction de données pour le reporting.

### Accéder aux fonctionnalités CSV

Depuis la liste des Actifs :
- **Export CSV** : Télécharger les actifs dans un fichier CSV
- **Import CSV** : Téléverser un fichier CSV pour créer ou mettre à jour des actifs

**Autorisations requises** : `infrastructure:admin` pour les opérations d'import/export.

### Options d'export

| Option | Description |
|--------|-------------|
| **Export complet** | Tous les champs exportables -- à utiliser pour le reporting et l'extraction complète des données |
| **Enrichissement de données** | Tous les champs importables -- correspond au format du modèle d'import, idéal pour l'édition aller-retour (export, modification, ré-import) |
| **Sélection personnalisée** | Choisir les champs spécifiques à inclure dans votre export |

**Téléchargement du modèle** (depuis la boîte de dialogue d'import) : Télécharge un CSV vierge avec tous les en-têtes de champs importables -- utilisez-le pour préparer des fichiers d'import avec la bonne structure.

### Processus d'import

1. **Préparez votre fichier** : enregistrez-le en UTF-8. Les virgules et les points-virgules conviennent tous les deux, de même qu'un fichier enregistré par Excel en CSV simple (Windows-1252). Téléchargez un modèle pour vous assurer des bons en-têtes. Le séparateur, les montants, les dates et les oui ou non de chaque langue sont dans [Fichiers CSV](csv-files.md).

2. **Choisissez les paramètres d'import** :
   - **Mode** :
     - `Enrichir` (par défaut) : Les cellules vides conservent les valeurs existantes -- ne mettez à jour que ce que vous spécifiez
     - `Remplacer` : Les cellules vides effacent les valeurs existantes -- remplacement complet de tous les champs
   - **Opération** :
     - `Upsert` (par défaut) : Créer de nouveaux actifs ou mettre à jour les existants
     - `Mise à jour uniquement` : Ne modifier que les actifs existants, ignorer les nouveaux
     - `Insertion uniquement` : Ne créer que de nouveaux actifs, ignorer les existants

3. **Validez d'abord** : Cliquez sur **Vérification préalable** pour valider votre fichier sans apporter de modifications. Examinez les erreurs et avertissements.

4. **Appliquez les modifications** : Si la validation réussit, cliquez sur **Importer** pour valider les changements.

### Référence des champs

**Champs principaux** :

| Colonne CSV | Description | Obligatoire | Notes |
|-------------|-------------|-------------|-------|
| `id` | UUID de l'actif | Non | Pour les mises à jour ; laisser vide pour les nouveaux actifs |
| `name` | Nom de l'actif | Oui | Utilisé comme identifiant unique pour la correspondance |
| `location_code` | Code du site | Oui | Doit correspondre à un code de site existant |
| `kind` | Type d'actif | Oui | Accepte un code ou un libellé (ex. : `vm` ou `Virtual Machine`) |
| `environment` | Environnement | Oui | `prod`, `pre_prod`, `qa`, `test`, `dev`, `sandbox` |
| `status` | Statut de cycle de vie | Non | Accepte un code ou un libellé (ex. : `active` ou `Active`) |
| `is_cluster` | Est-ce un cluster | Non | `oui` ou `non` |
| `hostname` | Nom d'hôte réseau | Non | |
| `domain` | Domaine DNS | Non | Accepte un code ou un libellé depuis les Paramètres |
| `aliases` | Alias DNS | Non | Liste séparée par virgules |
| `operating_system` | Type d'OS | Non | Accepte un code ou un libellé depuis les Paramètres |
| `cluster` | Appartenance à un cluster | Non | Nom du cluster parent |
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

Pour les champs configurés dans **Cartographie SI > Paramètres**, vous pouvez utiliser soit le code interne, soit le libellé d'affichage :

| Champ | Exemples de codes | Exemples de libellés |
|-------|-------------------|----------------------|
| Type d'actif (`kind`) | `vm`, `physical`, `container` | `Virtual Machine`, `Physical Server`, `Container` |
| Cycle de vie (`status`) | `active`, `inactive`, `decommissioned` | `Active`, `Inactive`, `Decommissioned` |
| Système d'exploitation | `windows_2022`, `ubuntu_24` | `Windows Server 2022`, `Ubuntu 24.04 LTS` |
| Domaine | `corp`, `dmz` | `Corporate Domain`, `DMZ` |
| Type d'adresse IP | `host`, `ipmi`, `mgmt` | `Host IP`, `IPMI`, `Management` |

Le système normalise automatiquement les valeurs lors de l'import, donc `Virtual Machine`, `virtual machine` et `vm` se résolvent tous vers le même type d'actif. Une valeur qui correspond à plusieurs entrées est refusée plutôt que devinée. L'export CSV écrit les noms pour ces colonnes, si bien qu'un fichier exporté peut être réimporté tel quel.

### Correspondance et mises à jour

Les actifs sont identifiés par **nom** (insensible à la casse). Lorsqu'une correspondance est trouvée :
- En mode `Enrichir` : Seules les valeurs CSV non vides mettent à jour l'actif
- En mode `Remplacer` : Tous les champs sont mis à jour, les valeurs vides effacent les données existantes

Si vous incluez la colonne `id` avec un UUID valide, la correspondance utilise d'abord l'ID, puis se rabat sur le nom.

### Champs dérivés

Certains champs sont calculés et ne peuvent pas être importés :
- **Fournisseur** : Dérivé automatiquement du site de l'actif
- **FQDN** : Calculé à partir du nom d'hôte + domaine

### Limitations

- **Maximum 4 adresses IP** : Les actifs prennent en charge jusqu'à 4 entrées d'adresse IP via CSV
- **Assignation de cluster par nom** : Utilisez le nom du cluster, pas l'ID, dans la colonne `cluster`
- **Site obligatoire** : Chaque actif doit avoir un code de site valide
- **Relations non incluses** : Les assignations d'applications, connexions, liens financiers, projets, tâches et pièces jointes doivent être gérés dans l'espace de travail

### Résolution de problèmes

**Erreur « Le fichier n'est pas correctement formaté »** : Cela indique généralement un problème d'encodage. Assurez-vous que votre CSV est enregistré en **UTF-8** :

- **Dans LibreOffice** : Lors de l'ouverture d'un CSV, sélectionnez `UTF-8` dans le menu déroulant Jeu de caractères (pas « Japanese (Macintosh) » ni d'autres encodages). Lors de l'enregistrement, cochez « Modifier les paramètres de filtre » et choisissez UTF-8.
- **Dans Excel** : Enregistrer sous > CSV UTF-8 (délimité par des virgules).
- **Conseil général** : Si vous voyez des caractères illisibles au début de votre fichier, l'encodage est incorrect.

### Exemple CSV

```csv
name;location_code;kind;environment;status;hostname;domain;ip_1_type;ip_1_address
PROD-WEB-01;NYC-DC1;Virtual Machine;prod;Active;prodweb01;corp;Host IP;10.0.1.10
PROD-DB-01;NYC-DC1;vm;prod;active;proddb01;corp;host;10.0.1.20
```

---

## Conseils

- **Nommez de manière cohérente** : Incluez l'environnement, le rôle et la séquence dans les noms d'actifs pour une identification facile.
- **Utilisez les clusters** : Regroupez les actifs liés (ex. : cluster web, cluster base de données) pour simplifier la gestion. Assignez les applications aux hôtes membres, pas au cluster lui-même.
- **Suivez le cycle de vie** : Marquez les actifs obsolètes et retirés pour garder les comptes d'inventaire précis.
- **Liez aux sites** : Assignez les actifs aux sites pour que le type d'hébergement, le pays et la ville soient renseignés automatiquement.
- **Assignez aux applications** : Utilisez l'onglet Vue d'ensemble pour lier les actifs aux déploiements d'applications. Les mêmes assignations apparaissent sous l'onglet Déploiements de l'application.
- **Utilisez l'onglet Relations** : Connectez les actifs aux lignes budgétaires, contrats et projets pour la visibilité financière.
- **Les tâches viennent de la page Tâches** : Pour rattacher une tâche à un actif, définissez le champ Actif sur la tâche elle-même ; elle apparaîtra alors sous Relations > Tâches.
- **Attachez la documentation** : Téléversez les fichiers de configuration, diagrammes d'architecture ou documents fournisseurs directement dans l'onglet Relations.
