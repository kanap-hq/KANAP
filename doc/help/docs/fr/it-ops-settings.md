# Paramètres de la cartographie SI

La page **Paramètres de la cartographie SI** vous permet de personnaliser les valeurs des menus déroulants utilisés dans toute la Cartographie SI. Ces listes contrôlent les options qui apparaissent lorsque les utilisateurs créent ou modifient des Applications, Interfaces, Actifs, Connexions et Sites. Les modifications ici s'appliquent à tous les utilisateurs de votre espace de travail.

Pour la lisibilité des cartes, les **Entités** et les **Rôles de serveur** incluent également un champ **Niveau du graphe** utilisé par le placement basé sur les rôles de la Carte des connexions.

## Où trouver cette page

- Espace de travail : **Cartographie SI**
- Chemin : **Cartographie SI > Paramètres**, dernière entrée du menu
- Autorisations :
  - Vous avez besoin au minimum de `settings:reader` pour consulter l'onglet **Listes**.
  - Vous avez besoin de `settings:admin` pour modifier les valeurs.
  - Vous avez besoin de `infrastructure:admin` pour voir l'onglet **Netbox**.

Vous ne voyez que les onglets que vos autorisations permettent. Si vous ne voyez pas l'entrée **Paramètres** dans le tiroir de la Cartographie SI, demandez à votre administrateur de vous accorder les autorisations appropriées. D'autres écrans appellent cette page les paramètres de l'IT.

## Organisation de la page

La page compte deux onglets :

- **Listes** contient les valeurs des listes déroulantes décrites sur cette page.
- **Netbox** contient la synchronisation avec votre inventaire Netbox. Voir [Synchronisation Netbox](netbox.md).

Dans l'onglet **Listes**, l'éditeur **Classifications et continuité** se trouve en haut. En dessous, les listes sont regroupées en quatre sections repliables :

1. **Sites** - Listes utilisées lors de la création ou de la modification des sites.
2. **Serveurs et connexions** - Listes utilisées pour les serveurs, les connexions et les données de risque/endpoint associées.
3. **Applications, services et interfaces** - Listes utilisées pour les applications, les instances d'application, les interfaces et les liaisons.
4. **Incidents** - Listes utilisées par le registre des incidents.

Les listes des technologies sont dans deux sections : **Familles de technologies** et **Zones d'administration** sous **Serveurs et connexions**, **Types d'hébergement** sous **Sites**. Les autres écrans appellent cette page les réglages IT.

Dans une section, les listes sont triées par nom. Chaque liste apparaît comme un panneau extensible, avec une courte indication de l'endroit où ses valeurs sont utilisées (par exemple, *Applications / Choix de la catégorie*). Cliquez sur un en-tête de panneau pour le développer et voir les valeurs. Le contenu de chaque section ne se charge que lorsque vous la développez pour la première fois, ce qui maintient la rapidité de la page même avec de nombreuses listes.

### Contrôles de l'éditeur

Chaque liste possède ses propres contrôles en haut :

- **Ajouter un élément** - Insère une nouvelle ligne en haut de la liste, focalisée et prête à saisir. Son champ de nom affiche un exemple propre à la liste.
- Les modifications sont enregistrées automatiquement environ une seconde et demie après votre dernière saisie, dès que toutes les lignes sont valides. Un indicateur d'enregistrement s'affiche à côté de la liste.

Pour les longues listes (plus de 25 lignes), le tableau virtualise les lignes, affichant environ 20 à la fois avec un défilement fluide et des en-têtes fixes.

### Les noms identifient les valeurs

Vous ne voyez et ne saisissez jamais que des **noms**. KANAP génère un code interne stable à partir du nom lors du premier enregistrement d'une valeur et le conserve définitivement : renommer une valeur ne casse donc jamais les enregistrements qui l'utilisent. Ce code est visible des intégrateurs dans l'API et peut être utilisé dans les fichiers CSV, mais l'export CSV écrit les noms et l'import accepte l'un comme l'autre.

Parce que les noms identifient les valeurs, quelques règles s'appliquent au sein d'une liste :

- chaque valeur doit avoir un nom (un astérisque marque la colonne **Nom**), et deux valeurs ne peuvent pas porter le même nom (la casse n'est pas prise en compte) ;
- un nom ne peut pas être identique au code interne d'une autre valeur de la même liste ;
- les noms des **Méthodes d'accès** ne peuvent contenir ni virgule ni point-virgule, car l'export CSV les regroupe dans une seule cellule séparée par des virgules.

Une liste qui enfreint l'une de ces règles n'est pas enregistrée tant que vous ne l'avez pas corrigée ; la ligne indique ce qui ne va pas.

### Supprimer une valeur

**Supprimer** efface une valeur que rien n'utilise. Lorsque des enregistrements référencent encore la valeur, KANAP indique combien (applications, actifs, interfaces, connexions, sites, incidents, sous-réseaux…), avec un lien vers la liste filtrée lorsqu'une liste peut être filtrée sur ce champ, et propose **Ne plus proposer** à la place : la valeur reste visible sur les enregistrements qui l'utilisent déjà et n'est plus proposée pour les nouveaux. Une valeur utilisée n'est jamais supprimée, même via l'API.

Les valeurs intégrées que KANAP gère lui-même (les quatre statuts de cycle de vie, les domaines Workgroup et N/A) ne peuvent être ni modifiées ni supprimées. Les zones réseau et types d'actif par défaut peuvent être modifiés et retirés, mais pas supprimés : le serveur les recréerait.

### Traduire vos valeurs

Les valeurs que vous saisissez s'affichent telles quelles dans toutes les langues. Pour les afficher dans la langue de chaque utilisateur, utilisez l'action **Traduire** sur une ligne : la boîte de dialogue présente le nom de base (et la description pour les niveaux de classification) ainsi qu'un champ par langue. Un champ laissé vide utilise la traduction automatique tant que la valeur est encore une valeur par défaut de KANAP, sinon le texte de base. L'enregistrement des traductions ne modifie jamais le texte de base, et un nom traduit peut être utilisé dans les fichiers CSV et l'API au même titre que le nom lui-même ; c'est pourquoi il ne doit pas faire doublon avec une autre valeur de la liste.

Les éditeurs affichent et modifient toujours le texte de base ; lorsque le nom affiché diffère pour votre langue, la ligne l'indique (« Affiché : … »).

---

## Sites

### Fournisseurs cloud

Fournisseurs cloud utilisés par les serveurs et les sites (ex. : AWS, Azure, GCP).

**Colonnes** : Nom, Ne plus proposer

**Où c'est utilisé** :
- Espace de travail Actifs > Onglet Vue d'ensemble > Champ **Fournisseur**
- Espace de travail Sites > Onglet Vue d'ensemble > **Fournisseur cloud** (lorsque le type d'hébergement est cloud)

### Types d'hébergement

Où sont hébergés les sites et les technologies. Valeurs par défaut : Sur site, Colocation, Cloud public, Cloud privé, SaaS.

**Colonnes** : Nom, Catégorie (**Sur site / colocation** ou **Cloud / SaaS**), Ne plus proposer

**Où c'est utilisé** :
- Espace de travail Sites > Onglet Vue d'ensemble > Champ **Type d'hébergement**
- Espace de travail Technologies > panneau de propriétés > **Type d'hébergement**, et la fenêtre de nouvelle technologie. Voir [Technologies](technologies.md#type-dhebergement).

Un type utilisé par une technologie ne peut pas être supprimé : marquez-le plutôt **Ne plus proposer**.

La catégorie détermine quels champs apparaissent lors de la modification d'un Site :
- **Sur site / colocation** affiche Société d'exploitation et champs Datacenter
- **Cloud / SaaS** affiche Fournisseur cloud, Région et champs d'informations complémentaires

---

## Serveurs et connexions

### Zones d'administration

Les zones de votre modèle d'administration. KANAP fournit les trois tiers du modèle d'administration en tiers, une bonne pratique reconnue :

- **Tier 0 (cœur de confiance)** : les annuaires comme Active Directory ou Entra ID, la PKI, les outils d'administration de l'identité, et les systèmes qui les hébergent.
- **Tier 1 (serveurs et applications)** : les serveurs métier, les applications, les bases de données et le middleware.
- **Tier 2 (postes de travail)** : les postes de travail et les équipements des utilisateurs.

Renommez-les, ajoutez les vôtres ou retirez-les selon votre politique d'administration ou votre modèle d'accès à privilèges. Les trois tiers apparaissent tant que la liste n'a jamais été enregistrée. Une fois la liste enregistrée, même vide, KANAP ne les ajoute plus : ajoutez-les vous-même si vous en avez besoin.

L'ordre de la liste compte : la première zone est la plus sensible. Faites glisser une ligne par sa poignée pour la déplacer. Une nouvelle zone s'ajoute en haut : déplacez-la ensuite à sa place. La page [Zones d'administration](administration-view.md) affiche les zones dans cet ordre et contrôle les actifs par rapport à la première zone qui n'est pas marquée **Ne plus proposer**.

**Colonnes** : Nom, Groupe d'administrateurs, Description, Ne plus proposer

- **Groupe d'administrateurs** : le groupe de l'annuaire ou l'équipe qui administre la zone, par exemple « Admins du domaine ».

**Où c'est utilisé** :
- Espace de travail Actifs > panneau de propriétés > **Zone d'administration**
- Espace de travail Technologies > panneau de propriétés > **Zone d'administration**, pour les technologies de la famille **Annuaire et identité**
- **Cartographie SI > Zones d'administration**, qui compte les actifs et les services d'annuaire de chaque zone, lance les points de contrôle et affecte les zones en masse. Voir [Zones d'administration](administration-view.md).

Une zone marquée **Ne plus proposer** reste sur les technologies et les actifs déjà placés dedans.

### Familles de technologies

Le genre de chaque technologie : base de données, hyperviseur, annuaire et identité, etc. La liste des technologies et les rapports regroupent les technologies par famille, et la page [Zones d'administration](administration-view.md) trouve les services d'annuaire par la famille **Annuaire et identité**.

**Colonnes** : Nom, Ne plus proposer

**Où c'est utilisé** :
- Espace de travail Technologies > en-tête et panneau de propriétés > **Famille**, et la fenêtre de nouvelle technologie

La famille **Système d'exploitation** désigne les systèmes d'exploitation : une technologie de cette famille ajoutée à un serveur qui n'en a pas devient son système d'exploitation. Voir [Technologies](technologies.md#systemes-dexploitation).

### Types de connexion

Catalogue à deux niveaux (catégorie et entrée) des protocoles de connexion, avec les ports courants.

**Colonnes** : Catégorie (ex. : Base de données, Accès distant), Nom, Ports courants, Ne plus proposer

**Où c'est utilisé** :
- Espace de travail Connexions > Sélecteur **Type de connexion**

Le champ **Ports courants** est en texte libre - vous pouvez saisir des ports uniques (`443`), des listes (`80, 443`), des plages (`9101-9103`), ou des indicateurs comme `multiple` ou `à préciser`.

Les catégories par défaut incluent : Application, Authentification, Sauvegarde, Base de données, Email, Partage de fichiers, Transfert de fichiers, Messagerie, Supervision, Services réseau, Accès distant, Réplication, Stockage, VPN / Tunnel, Générique.

### Domaines

Domaines Active Directory ou DNS des actifs. Les entrées intégrées ne peuvent pas être modifiées. Le suffixe DNS sert à calculer le nom de domaine complet (FQDN) de chaque actif.

**Colonnes** : Nom, Suffixe DNS, Forêt, Nombre de comptes, Nombre d'ordinateurs, Approbations, Ne plus proposer

- **Forêt** : la forêt Active Directory du domaine, telle qu'affichée dans Domaines et approbations Active Directory.
- **Nombre de comptes** et **Nombre d'ordinateurs** : le nombre de comptes utilisateurs et d'ordinateurs du domaine, tels que comptés dans Utilisateurs et ordinateurs Active Directory ou par un décompte des objets utilisateur et ordinateur du domaine. Nombres entiers uniquement.

Survolez les en-têtes **Forêt**, **Nombre de comptes** et **Nombre d'ordinateurs** pour savoir où trouver chaque valeur.
- **Approbations** : le bouton indique combien d'approbations a le domaine. Cliquez dessus pour lister les autres domaines avec lesquels il a une relation d'approbation, tels qu'affichés dans Domaines et approbations Active Directory. **Ajouter un domaine approuvé** en ajoute un ; choisissez son **Sens** : **sortante** (ce domaine approuve l'autre, dont les comptes peuvent accéder à ses ressources), **entrante** (l'autre domaine approuve celui-ci) ou **bidirectionnelle** (les deux). La boîte de dialogue montre aussi, en lecture seule, les approbations déclarées sur d'autres domaines envers celui-ci. Le bouton apparaît une fois le domaine enregistré, et demande au moins un autre domaine dans la liste.

**Où c'est utilisé** :
- Espace de travail Actifs > Onglet Technique > Sélecteur **Domaine**
- Espace de travail Actifs > Onglet Technique > **FQDN** (auto-calculé depuis hostname + suffixe DNS)
- **Cartographie SI > Zones d'administration** : domaines groupés par forêt, avec leurs approbations, leurs comptages et leurs contrôleurs de domaine. Voir [Zones d'administration](administration-view.md#services-dannuaire-et-domaines).

**Entrées système** (ne peuvent pas être modifiées ni supprimées) :
- **Workgroup** - Pour les actifs autonomes non joints à un domaine
- **N/A** - Pour les types d'actifs où l'appartenance au domaine ne s'applique pas (ex. : équipements réseau, baies)

**Comportement de remplissage automatique** : Lors de l'ajout d'un nouveau domaine, le suffixe DNS se remplit automatiquement à partir du nom que vous saisissez, jusqu'à ce que vous le modifiiez vous-même.

**Exemple** : Un domaine nommé « Corporate AD » avec le suffixe DNS `corp.example.com` produirait un FQDN de `hostname.corp.example.com` pour un actif avec le hostname `web-server-01`.

### Entités

Endpoints utilisés dans les connexions et les cartes (ex. : Utilisateurs internes, Internet, Réseaux partenaires, Systèmes externes). Le niveau du graphe fixe leur position par défaut sur la carte.

**Colonnes** : Nom, Niveau du graphe, Ne plus proposer

**Où c'est utilisé** :
- Espace de travail Connexions > Champs **Entité source** et **Entité cible**
- Carte des connexions > Les entités apparaissent comme des points de terminaison de flux et utilisent leur niveau du graphe pour le placement vertical (les entités par défaut sont Haut)

### Valeurs du niveau du graphe

Le niveau du graphe contrôle la bande verticale préférée dans la Carte des connexions lorsque le **Placement basé sur les rôles** est activé :

- **Haut** : Points de terminaison les plus exposés aux utilisateurs ou externes
- **Intermédiaire haut** : Couche applicative/service supérieure
- **Centre** : Couche intermédiaire neutre/par défaut
- **Intermédiaire bas** : Infrastructure de support
- **Bas** : Points de terminaison orientés données/stockage

### Types d'adresse IP

Types d'adresses IP des actifs. Utile pour distinguer différentes interfaces réseau comme les IP host, les interfaces de gestion et les réseaux de stockage.

**Colonnes** : Nom, Ne plus proposer

**Valeurs par défaut** : Host, IPMI, Management, iSCSI

**Où c'est utilisé** :
- Espace de travail Actifs > Onglet Technique > Section **Adresses IP** > Menu déroulant **Type**

Les actifs peuvent avoir plusieurs adresses IP, chacune avec son propre type. Par exemple, un serveur physique peut avoir :
- Une IP **Host** pour le trafic applicatif
- Une IP **IPMI** pour la gestion hors bande
- Une IP **iSCSI** pour la connectivité réseau de stockage

### Zones réseau

Zones réseau utilisées pour classer les sous-réseaux et décrire la connectivité (ex. : LAN, DMZ, LAN industriel, WiFi, Cloud public, Invité, Management, Stockage, VPN).

**Colonnes** : Nom, Ne plus proposer

**Où c'est utilisé** :
- Liste des sous-réseaux > Sélecteur **Zone réseau**
- Espace de travail Actifs > Onglet Technique > **Zone réseau** (auto-remplie lorsqu'un sous-réseau est sélectionné)

### Sous-réseaux

Définissez les sous-réseaux avec la notation CIDR et, si besoin, leur VLAN. Chaque sous-réseau appartient à une zone réseau et à un site.

**Colonnes** : Site, CIDR, VLAN (1-4094), Zone réseau, Description, Ne plus proposer

**Où c'est utilisé** :
- Espace de travail Actifs > Onglet Technique > Sélecteur **Sous-réseau**

**Règles de validation** :
- Le CIDR doit être une notation IPv4 valide (ex. : `192.168.1.0/24`)
- Les numéros VLAN doivent être entre 1 et 4094
- Les numéros CIDR et VLAN sont uniques par site (les mêmes valeurs peuvent exister à des sites différents)

**Auto-remplissage** : Lorsque vous sélectionnez un sous-réseau sur un actif, la zone réseau est automatiquement remplie depuis la configuration du sous-réseau.

### Rôles de serveur

Rôles attribués aux serveurs lors de la liaison avec les instances d'application (ex. : Serveur web, Serveur de base de données, Worker). Le niveau du graphe fixe leur position sur la carte des connexions.

**Colonnes** : Nom, Niveau du graphe, Ne plus proposer

**Où c'est utilisé** :
- Espace de travail Applications > Onglet Serveurs > Menu déroulant **Rôle** lors de la liaison d'un actif à une instance
- Carte des connexions > Bande de placement dérivée des rôles pour les serveurs et clusters

Exemples par défaut intégrés :
- `web`, `proxy` > **Haut**
- `app`, `cloud-service` > **Intermédiaire haut**
- `db` > **Bas**

### Types d'actif

Types logiques des serveurs et des actifs d'infrastructure (ex. : Serveur physique, Machine virtuelle, Conteneur, Serverless, Appliance). Les actifs physiques peuvent suivre les informations matérielles et de support.

**Colonnes** : Nom, Physique, Ne plus proposer

**Où c'est utilisé** :
- Espace de travail Actifs > Onglet Vue d'ensemble > Champ **Type**

---

## Applications, services et interfaces

### Méthodes d'accès

Modes d'accès des utilisateurs aux applications (ex. : Web, mobile, VDI).

**Colonnes** : Nom, Ne plus proposer

**Valeurs par défaut** : Web, Application installée localement, Application mobile, IHM propriétaire (interface industrielle), Terminal / CLI, VDI / Bureau distant, Borne

**Où c'est utilisé** :
- Espace de travail Applications > Onglet Technique et support > Champ multi-sélection **Méthodes d'accès**

**Conseil** : Personnalisez les méthodes d'accès pour correspondre à la manière dont votre organisation catégorise l'accès aux applications. Par exemple, ajoutez « Citrix » ou « Client léger » si ce sont des modes d'accès courants dans votre environnement.

### Catégories d'application

Catégories qui décrivent la finalité principale de chaque application ou service.

**Colonnes** : Nom, Ne plus proposer

**Valeurs par défaut** : Métier, Productivité, Sécurité, Analytique, Développement, Intégration, Infrastructure

**Où c'est utilisé** :
- Espace de travail Applications > Onglet Vue d'ensemble > Champ **Catégorie**
- Liste Applications > Colonne et filtre **Catégorie**

**Conseil** : Personnalisez les catégories pour correspondre à la terminologie de votre organisation. Par exemple, renommez « Métier » en « Applications métier » si c'est ainsi que votre équipe les désigne.

### Classifications et continuité

Cet éditeur configure les niveaux utilisés pour classifier les applications, et les technologies dans leur onglet Conformité. Il est disponible aux utilisateurs `settings:admin` en haut de la page et s'ouvre dans une seule boîte de dialogue, avec une liste par catalogue :

- **Criticité business** : les niveaux qu'une application peut recevoir. Chaque niveau a un nom, une description affichée sous le nom au moment du choix, une **durée maximale tolérable d'interruption (DMIA)** facultative en minutes et un indicateur **Ne plus proposer**. La DMIA documente le niveau et déclenche un avertissement sur une application dont le RTO l'atteint ; c'est un attribut du niveau, pas une valeur saisie sur les applications.
- **Criticité cyber** : niveaux de conséquences indépendants.
- **Confidentialité des données** : le catalogue des classes de données, avec descriptions.
- **Vagues de reprise** : étapes ordonnées de restauration ; l'ordre n'est ni une gravité ni une estimation de durée.

**L'ordre est la position dans la liste.** Les catalogues de gravité vont du niveau le plus critique en haut au moins critique en bas ; les vagues de reprise suivent l'ordre de restauration. Utilisez les flèches pour déplacer un niveau ; la position détermine l'ordre de tri des listes, la règle du « niveau le plus élevé » utilisée par les interfaces et les connexions, et l'ordre des menus de sélection. **Ajouter un niveau** ajoute en bas de la liste.

**Modifier le catalogue ne modifie jamais les applications.** Une application enregistre le code de son niveau. Renommer un niveau, modifier sa description ou sa DMIA et réordonner le catalogue laissent chaque application sur le même niveau et n'invalident pas les revues. Un niveau encore utilisé par une application, une interface ou une connexion ne peut pas être supprimé ; marquez-le plutôt **Ne plus proposer** : il reste visible sur les enregistrements existants et n'est plus proposé pour les nouveaux.

Les codes sont générés à partir des noms et ne sont jamais affichés ; les règles de nommage ci-dessus s'appliquent.

Les niveaux business alimentent aussi la criticité opérationnelle des interfaces et des connexions. Les dérivations incomplètes sont signalées comme telles ; elles ne sont pas traitées comme le niveau le plus faible.

#### Confidentialité des données

La liste **Confidentialité des données** contient les classes de données utilisées par les applications et les interfaces. Les niveaux intégrés (Public, Interne, Confidentiel, Restreint) ne peuvent pas être supprimés ni rendus obsolètes.

**Où c'est utilisé** :
- Espace de travail Applications > Onglet Conformité > Champ **Classification données**
- Espace de travail Interfaces > Onglet Vue d'ensemble > Champ **Classification données**
- Liste Applications > Colonne **Classification données**

### Modèles d'intégration

Modèles d'intégration utilisés par les segments d'interface (ex. : API REST, Batch fichier, File d'attente, Staging BDD).

**Colonnes** : Nom, Ne plus proposer

**Où c'est utilisé** :
- Segments d'interface > Champ **Modèle**

### Modes d'authentification d'interface

Modes d'authentification des segments et liaisons d'interface (ex. : Compte de service, OAuth2, Clé API, Certificat).

**Colonnes** : Nom, Ne plus proposer

**Où c'est utilisé** :
- Liaisons d'interfaces > Champ **Mode d'authentification**

### Catégories de données d'interface

Catégories de données métier des interfaces (ex. : Master Data, Transactionnel, Reporting, Contrôle).

**Colonnes** : Nom, Ne plus proposer

**Où c'est utilisé** :
- Espace de travail Interfaces > Champ **Catégorie de données**

### Formats de données d'interface

Formats de données des segments d'interface (ex. : CSV, JSON, XML, IDoc, Binaire).

**Colonnes** : Nom, Ne plus proposer

**Où c'est utilisé** :
- Segments d'interface > Champ **Format**

### Protocoles d'interface

Protocoles pris en charge pour les liaisons d'interface entre applications (ex. : HTTP/REST, gRPC, SFTP, Kafka, Base de données).

**Colonnes** : Nom, Ne plus proposer

**Où c'est utilisé** :
- Liaisons d'interfaces > Champ **Protocole** (liaisons historiques)

### Types de déclenchement d'interface

Types de déclenchement des segments d'interface (ex. : Événementiel, Planifié, Temps réel, Manuel).

**Colonnes** : Nom, Ne plus proposer

**Où c'est utilisé** :
- Segments d'interface > Champ **Déclenchement**

### Statuts du cycle de vie

Options de cycle de vie partagées par les applications, les instances d'application, les interfaces, les liaisons d'interface et les serveurs.

**Colonnes** : Nom, Ne plus proposer

**Codes verrouillés** : Les statuts intégrés (Proposé, Actif, Obsolète, Retiré) ne peuvent pas être supprimés ni voir leur code modifié.

**Où c'est utilisé** :
- Applications, Instances d'applications, Interfaces, Liaisons d'interfaces, Actifs > Champs **Statut**

---

## Incidents

### Catégories d'incident

Catégories utilisées pour classer les entrées du registre des incidents.

**Colonnes** : Nom, Ne plus proposer

**Où c'est utilisé** :
- Incidents > Sélecteur **Catégorie**

---

## Impact des modifications sur les données existantes

- **Les enregistrements existants conservent leur valeur** - Renommer ne modifie que ce que les utilisateurs voient, pas les données sous-jacentes.
- **Valeurs marquées Ne plus proposer** :
  - Restent valides pour les enregistrements qui les utilisent déjà.
  - Sont masquées des menus déroulants lors de la création de nouveaux enregistrements.
  - Apparaissent toujours lors de la modification si l'enregistrement utilise déjà cette valeur.
- **Nouvelles valeurs** deviennent immédiatement disponibles dans les menus déroulants concernés et sont validées côté serveur.

Cette approche vous permet de faire évoluer votre taxonomie au fil du temps sans casser les enregistrements existants.

---

## Référence rapide : quelle liste alimente quel champ

| Liste | Où c'est utilisé |
|-------|------------------|
| **Méthodes d'accès** | Applications (Onglet Technique et support > Méthodes d'accès) |
| **Catégories d'application** | Applications (Catégorie) |
| **Zones d'administration** | Actifs (panneau de propriétés > Zone d'administration), Technologies de la famille Annuaire et identité (panneau de propriétés > Zone d'administration), page Zones d'administration |
| **Fournisseurs cloud** | Actifs (Fournisseur), Sites (Fournisseur cloud) |
| **Types de connexion** | Connexions (Type de connexion) |
| **Domaines** | Actifs (Onglet Technique > Domaine, FQDN), page Zones d'administration |
| **Entités** | Connexions (Entité source/cible), Carte des connexions (placement par niveau du graphe) |
| **Types d'hébergement** | Sites (Vue d'ensemble), Technologies (Type d'hébergement) |
| **Modèles d'intégration** | Segments d'interface (Modèle) |
| **Modes d'authentification d'interface** | Liaisons d'interfaces (Mode d'auth.) |
| **Catégories de données d'interface** | Interfaces (Catégorie de données) |
| **Formats de données d'interface** | Segments d'interface (Format) |
| **Protocoles d'interface** | Liaisons d'interfaces (Protocole) |
| **Types de déclenchement d'interface** | Segments d'interface (Déclenchement) |
| **Catégories d'incident** | Incidents (Catégorie) |
| **Types d'adresse IP** | Actifs (Onglet Technique > Adresses IP > Type) |
| **Statuts du cycle de vie** | Applications, Instances, Interfaces, Liaisons, Actifs |
| **Zones réseau** | Sous-réseaux (Zone réseau), Actifs (auto-rempli depuis le sous-réseau) |
| **Sous-réseaux** | Actifs (Onglet Technique > Adresses IP > Sélecteur de sous-réseau) |
| **Rôles de serveur** | Applications > Onglet Serveurs (rôle lors de la liaison actif-app), Carte des connexions (placement par niveau du graphe) |
| **Types d'actif** | Actifs (Vue d'ensemble > Type) |
| **Familles de technologies** | Technologies (Famille), page Zones d'administration (services d'annuaire) |

---

## Conseils

- **Alignez les noms avec votre terminologie** - Revoyez les valeurs par défaut et renommez les valeurs pour correspondre à la manière dont votre organisation parle de ces concepts. Les enregistrements conservent leur lien avec la valeur ; seul le nom change.
- **Retirez progressivement** - Lors de la transition vers une nouvelle valeur, cochez **Ne plus proposer** sur l'ancienne plutôt que de la supprimer. Cela préserve les données historiques tout en orientant les utilisateurs vers les nouvelles options.
- **Coordonnez les classifications de données avec la sécurité** - Les modifications des classifications de données doivent être alignées avec vos politiques de sécurité de l'information. Consultez la conformité avant d'ajouter ou renommer les niveaux de classification.
- **Utilisez les ports courants comme documentation** - Le champ **Ports courants** des types de connexion est informatif. Remplissez-le pour aider les utilisateurs à comprendre quels ports chaque type de connexion utilise couramment.
- **Ajustez la lisibilité des cartes avec les niveaux** - Gardez les niveaux du graphe des entités et des rôles de serveur alignés avec vos couches d'architecture (edge, app, données) pour des dispositions de Carte des connexions plus claires.
