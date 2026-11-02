# Technologies

Les technologies recensent ce que la DSI fait tourner ou souscrit pour que les applications fonctionnent : SQL Server, vSphere, Active Directory, Entra ID, Tomcat. Chaque technologie liste ses versions et leurs dates de fin de support, pour savoir lesquelles demandent votre attention avant de devenir un risque.

## Ce qu'est une technologie

KANAP décrit votre paysage en trois boîtes :

| Boîte | Ce qu'elle contient | Exemples |
|---|---|---|
| **Applications** | Ce dans quoi les métiers travaillent | ERP, CRM, paie, intranet |
| **Technologies** | Ce que la DSI fait tourner ou souscrit pour ces applications | SQL Server, vSphere, Active Directory, Entra ID, Tomcat |
| **Actifs** | Où cela tourne | Serveurs, machines virtuelles, clusters, bases de données cloud |

Un serveur porte des technologies. Une application est hébergée sur des serveurs et dépend de technologies.

Enregistrez une application pour ce que vous gérez comme un service, avec ses responsables, sa criticité, ses contrats et ses coûts. Enregistrez une technologie pour un produit installé sur vos serveurs, suivi par ses versions, ses dates de fin de support et ses vulnérabilités. On travaille rarement dans une technologie elle-même, pourtant d'autres applications tombent ou deviennent exposées quand elle tombe. Un même produit peut être les deux : voir VMware vSphere ci-dessous.

Quelques exemples :

- **Entra ID** : une technologie **SaaS** de la famille **Annuaire et identité**, éditée par Microsoft. Elle ne tourne sur aucun de vos serveurs. Les applications qui connectent leurs utilisateurs par ce service la déclarent.
- **Active Directory** : une technologie **Sur site** de la même famille, portée par vos contrôleurs de domaine. Les applications qui l'utilisent la déclarent.
- **VMware vSphere** : une technologie **Sur site** installée sur le serveur vCenter, tandis que les hôtes portent ESXi et que le service de virtualisation est suivi comme application.
- **SQL Server** : une technologie avec une ligne par version en service (2016, 2019, 2022). Chaque serveur porte sa propre version, et le rapport des fins de support peut nommer les serveurs restés sur une ancienne.
- **Windows Server** : une technologie de la famille **Système d'exploitation**. Chaque serveur enregistre sa version, et cette technologie est le système d'exploitation du serveur. Voir [Systèmes d'exploitation](#systemes-dexploitation).
- **Une application SaaS** : aucune technologie à saisir. L'éditeur maintient ce sur quoi elle tourne.

Une technologie couvre un produit dans son ensemble. « SQL Server » désigne tous les SQL Server que vous faites tourner ; les versions portent le détail.

## Premiers pas

Rendez-vous dans **Cartographie SI > Technologies** et cliquez sur **Nouvelle technologie**.

La fenêtre s'ouvre sur le **Catalogue** : une liste de produits courants avec une description courte, leur éditeur, leur famille et leur type d'hébergement. Cherchez par nom, puis cliquez sur une entrée. KANAP crée aussitôt la technologie avec son éditeur, sa famille, son type d'hébergement, ses identifiants CPE produit, ses noms CVE.org, ses versions avec leurs dates de fin de support et la description courte dans votre langue, puis l'ouvre. Une entrée reste proposée lorsqu'une technologie du même nom a été saisie à la main. L'ajout la complète, et l'entrée l'indique (Complète TEC-10). Une recherche qui correspond à une entrée du catalogue déjà adoptée la liste sous **Déjà dans vos technologies**, avec la référence de votre technologie, et un clic ouvre cette technologie ; tant que la recherche est vide, cette section reste masquée.

Une technologie adoptée depuis le catalogue reste à jour : quand l'éditeur publie une nouvelle version ou change une date, KANAP ajoute la version et déplace la date (voir [Versions issues du catalogue](#versions-issues-du-catalogue)).

Pour un produit que le catalogue ne connaît pas, cliquez sur **Saisir une technologie absente du catalogue**. Renseignez :

- **Nom** (obligatoire) : unique parmi vos technologies.
- **Famille** : le genre de technologie (base de données, hyperviseur, annuaire et identité, etc.).
- **Éditeur** : les suggestions viennent de vos autres technologies et du catalogue, pour qu'un même éditeur garde une seule orthographe.
- **Type d'hébergement** : où tourne la technologie. **Sur site** par défaut. Voir [Type d'hébergement](#type-dhebergement).

**Droits** :

- Consulter : `infrastructure:reader`
- Créer et modifier : `infrastructure:member`
- Supprimer : `infrastructure:admin`

## Systèmes d'exploitation

Le système d'exploitation d'un serveur est une technologie de la famille **Système d'exploitation**. Ajoutez-la au serveur comme toute autre technologie, avec sa version : quand le serveur n'en a pas encore, elle devient son système d'exploitation. La fiche du serveur l'affiche en tête de sa section **Technologies**, avec la mention « Système d'exploitation ». Voir [Actifs](assets.md#systeme-dexploitation).

Le catalogue propose Windows Server, Ubuntu, Red Hat Enterprise Linux, Debian, SUSE Linux Enterprise Server, Rocky Linux, AlmaLinux, Oracle Linux, Amazon Linux, Alpine Linux, CentOS, IBM AIX, IBM i et Oracle Solaris. Il liste les versions dont le support a pris fin en 2010 ou après, et pour Windows Server les seules versions à support long.

Le sens des deux dates de support dépend de l'éditeur :

| Système d'exploitation | Fin du support standard | Fin du support étendu |
|---|---|---|
| **Ubuntu**, **Red Hat Enterprise Linux**, **SUSE Linux Enterprise Server** | Fin des correctifs de sécurité | Fin de l'extension payante |
| **Windows Server** | Fin du support principal | Fin du support étendu |
| **Debian** | Fin du support régulier | Fin de Debian LTS |

Toute technologie peut être un système d'exploitation : placez VMware ESXi ou FortiOS dans la famille **Système d'exploitation** et elle peut devenir le système d'exploitation d'un hôte ou d'un pare-feu.

Les systèmes d'exploitation du catalogue ont des identifiants CPE produit : KANAP les rapproche des vulnérabilités publiées.

Les distributions Linux publient leurs vulnérabilités par paquet. KANAP suit le support de chaque version et rapproche les vulnérabilités que l'éditeur attribue à la version. Il ne sait pas quels paquets un serveur a installés, ni à quel niveau. Pour les distributions Linux du catalogue, la table des versions mène au suivi de sécurité du distributeur, où vous pouvez vérifier chaque paquet. Voir [Versions issues du catalogue](#versions-issues-du-catalogue).

Les systèmes d'exploitation sont exclus des alertes de vulnérabilité par défaut. KANAP ne connaît pas le niveau de correctifs d'un serveur : un système d'exploitation remonterait un très grand nombre de vulnérabilités, la plupart déjà corrigées. Cela vaut pour une technologie de la famille **Système d'exploitation** et pour un système d'exploitation adopté depuis le catalogue, quelle que soit sa famille. Une technologie existante que vous adoptez depuis le catalogue comme système d'exploitation passe exclue elle aussi. Vous pouvez la réinclure : voir [Alertes de vulnérabilité](#alertes-de-vulnerabilite).

Les installations mises à jour depuis une version antérieure gardent leurs données : les systèmes d'exploitation utilisés par les serveurs, et les entrées ajoutées à l'ancienne liste des systèmes d'exploitation des paramètres, sont devenus des technologies, avec leurs versions et leurs dates.

---

## Travailler avec la liste

Chaque ligne est une technologie. Cliquez sur une ligne pour l'ouvrir.

**Colonnes par défaut** :

| Colonne | Ce qu'elle montre |
|---|---|
| **Référence** | La référence de la technologie (`TEC-4`) |
| **Nom** | Le nom de la technologie |
| **Famille** | Le genre de technologie |
| **Éditeur** | Qui l'édite |
| **Serveurs** | Les actifs en service sur lesquels elle est installée. Les clusters ne sont pas comptés, ni les machines virtuelles d'un hôte qui la porte. La pastille **Serveurs** de la fiche et le rapport [Fins de support](end-of-support.md) donnent le même nombre |
| **Applications** | Les applications qui la déclarent ou sont hébergées sur un serveur qui la porte |
| **Prochaine fin de support** | La plus proche fin de support standard à venir parmi les versions en service. En orange quand elle tombe dans les 12 prochains mois |
| **Vulnérabilités à traiter** | Les vulnérabilités connues encore à traiter sur les versions en service qui sont dans les alertes. En orange avec le nombre de critiques ou élevées (`3 · 1 critiques ou élevées`). Cliquez pour ouvrir la page [Vulnérabilités](vulnerabilities.md) sur cette technologie. Présente quand les vulnérabilités sont suivies |

**Colonnes supplémentaires** (par le sélecteur de colonnes) : **Cycle de vie**, **Versions en service**, **Responsable IT**.

Quand les vulnérabilités sont suivies, la colonne **Éditeur** ouvre aussi la page Vulnérabilités sur les produits de cet éditeur. Voir [Vulnérabilités](vulnerabilities.md) pour savoir quand elles sont suivies.

**Filtres** : **Famille**, **Éditeur** et **Cycle de vie** proposent des filtres à cases à cocher. La zone de recherche porte sur le nom, l'éditeur et la référence.

**Actions** :

- **Nouvelle technologie** (`infrastructure:member`).
- **Importer les liens** (`infrastructure:member`) et **Exporter les liens** : chargez ou téléchargez les liens entre les technologies et les serveurs ou les applications dans un fichier CSV ou un classeur Excel. Voir [Importer et exporter les liens](#importer-et-exporter-les-liens).
- **Supprimer** les lignes sélectionnées (`infrastructure:admin`). La confirmation compte ce qui part avec elles : liens vers les serveurs et les applications, contrats, lignes budgétaires, projets, incidents et documents.

---

## La fiche technologie

La fiche comporte un en-tête, un panneau de propriétés à droite et sept onglets : **Aperçu**, **Serveurs**, **Applications**, **Exploitation**, **Conformité**, **Relations** et **Historique** (les modifications apportées à la technologie, voir [Historique des fiches](record-history.md)). Les onglets **Serveurs**, **Applications** et **Relations** affichent leur nombre en pastille.

### En-tête

- **Nom** : modifiable sur place.
- **Référence** : cliquez pour la copier.
- **Cycle de vie** : cliquez pour le changer. Une technologie retirée n'est plus proposée quand vous en cherchez une à lier.
- **Famille**.
- **Supprimer**, une icône corbeille (`infrastructure:admin`) : la confirmation nomme ce qui part avec la technologie.

### Panneau de propriétés

- **Éditeur**, **Famille** et **Type d'hébergement**.
- **Zone d'administration** : affichée pour les seules technologies de la famille **Annuaire et identité**. Elle place un service d'annuaire dans une zone de votre modèle d'administration, par exemple le tier 0 pour Entra ID, qui ne tourne sur aucun de vos serveurs. Les zones viennent de **Cartographie SI > Paramètres**, et la page [Zones d'administration](administration-view.md) liste les services d'annuaire avec leur zone. Les autres technologies ne prennent pas de zone : placez plutôt les serveurs qui les portent. Une zone posée auparavant sur une technologie d'une autre famille reste affichée, en lecture seule, avec une mention indiquant que la valeur n'est plus utilisée.
- **Remplacée par** : la technologie qui prend la suite de celle-ci, par exemple un produit plus récent vers lequel vos équipes migrent.
- **Responsables IT** : les personnes responsables de la technologie.

Les modifications s'enregistrent au fil de la saisie.

#### Type d'hébergement

Le type d'hébergement dit où tourne la technologie. La liste est celle des **Types d'hébergement** de **Cartographie SI > Paramètres**, partagée avec les sites : **Sur site**, **Colocation**, **Cloud public**, **Cloud privé** et **SaaS** par défaut. Chaque type est sur site ou dans le cloud :

- **Sur site** (Sur site, Colocation) : la technologie est attendue sur vos serveurs. Celle qui ne tourne sur aucun serveur apparaît dans les **Données manquantes** du rapport [Fins de support](end-of-support.md#donnees-manquantes).
- **Dans le cloud** (Cloud public, Cloud privé, SaaS) : le fournisseur la fait tourner, par exemple Entra ID ou un service Kubernetes managé. Déclarez-la sur les applications qui l'utilisent.

Un type marqué **Ne plus proposer** reste sur les technologies qui l'ont. Un type supprimé des paramètres, ou une liste sans aucun type en service, fait aussi apparaître la technologie dans les **Données manquantes**.

### Aperçu

**Description** : à quoi sert la technologie.

**Versions** : une ligne par version suivie, avec **Fin du support standard**, **Fin du support étendu** et un **Statut** :

| Statut | Signification |
|---|---|
| **Supportée** | Le support standard finit à plus de 12 mois d'aujourd'hui |
| **Fin proche** | Le support standard finit dans les 12 mois |
| **Support étendu** | Le support standard est fini ; le support étendu court encore |
| **Hors support** | Toutes les dates de fin sont passées |
| **Date inconnue** | Aucune date de fin saisie |

Le support court encore le jour de sa date de fin. Avec une seule date, cette date est la fin. **Ajouter une version** ajoute une ligne ; survolez une ligne pour la modifier ou la supprimer. Supprimer une version utilisée par des serveurs ou des applications demande confirmation, avec le nombre de serveurs sur lesquels elle est installée et d'applications : ces liens affichent alors une version inconnue.

**Notes** : en bas de l'onglet, texte libre, comme les conditions de licence ou les dates de renouvellement.

#### Alertes de vulnérabilité

Quand les vulnérabilités sont suivies, la table des versions choisit les versions qui comptent dans les alertes de vulnérabilité. Une version dans les alertes apparaît par défaut sur la page [Vulnérabilités](vulnerabilities.md), dans les e-mails et dans les compteurs. Une version hors des alertes reste rapprochée des vulnérabilités : la section [Vulnérabilités](#vulnerabilites) de la technologie la montre toujours, et la page montre ses lignes avec son filtre **Alertes**.

- **Inclure dans les alertes de vulnérabilité** : l'interrupteur de la ligne de titre **Versions**, à côté de **Ajouter une version**. C'est le réglage de la technologie. Survolez-le pour un rappel : il vaut pour les versions sans réglage propre, pour les versions ajoutées plus tard, et pour les serveurs et applications qui n'indiquent aucune version. Le changer remplace les réglages propres des versions ; quand certaines en ont un, KANAP demande d'abord et dit combien. Il s'affiche même quand la technologie n'a aucune version.
- Colonne **Alertes** : un interrupteur par version, pour une exception sur une version. Survolez l'icône d'information de son en-tête pour savoir ce qu'elle fait. Un petit point à côté de l'interrupteur marque une version qui a son réglage propre. Remettez l'interrupteur sur la valeur de la technologie et la version suit de nouveau la technologie.

Les nouvelles technologies sont dans les alertes, avec deux exceptions :

- **Systèmes d'exploitation** : voir [Systèmes d'exploitation](#systemes-dexploitation).
- **Services cloud gérés par un fournisseur** : une technologie dont le [type d'hébergement](#type-dhebergement) est dans le cloud, comme **Cloud public** ou **SaaS**, et une entrée du catalogue que le fournisseur fait tourner, comme Entra ID. Le fournisseur corrige un service en ligne, donc ses vulnérabilités ne vous demandent aucune action. Une technologie en **Cloud privé** reste dans les alertes.

Changer plus tard la famille ou le type d'hébergement d'une technologie laisse son réglage tel quel. Les interrupteurs demandent le niveau Membre sur l'infrastructure.

#### Versions issues du catalogue

Une version issue du catalogue affiche **Catalogue** à côté de son libellé, et une technologie adoptée depuis le catalogue indique « Versions et dates tenues à jour depuis le catalogue » sous ses versions. KANAP consulte le catalogue chaque jour dans le cloud. Sur une installation sur site, chaque version de KANAP apporte son catalogue au démarrage, sauf si votre administrateur [active la consultation quotidienne](on-premise/configuration.md#optional-technology-catalog).

Les dates viennent de deux sources. La plupart des produits les tiennent d'endoflife.date. Pour les produits qu'endoflife.date ne couvre pas, comme Cisco NX-OS, Juniper Junos ou Dell PowerStore, KANAP relève les dates sur les pages officielles de l'éditeur. Chaque version de KANAP met ces dates à jour.

Une version dont KANAP a relevé les dates affiche leur source sous son libellé : « Source : », l'éditeur et le jour où les dates ont été vérifiées. Le nom de l'éditeur mène à la page d'où viennent les dates. La ligne reste tant que les deux dates de fin correspondent au catalogue. Elle disparaît dès que vous en changez une. Quand l'éditeur ne prévoit aucune fin de support, comme pour IBM WebSphere 8.5 et 9.0, les deux colonnes de fin de support indiquent « Aucune fin prévue par l'éditeur ».

Certains produits n'ont pas de dates publiques : HPE Aruba Networking AOS-CX, Pure Storage Purity//FA, HPE Alletra 5000/6000 (NimbleOS), Rubrik CDM, Cohesity DataProtect et PRTG Network Monitor. Le catalogue les apporte sans versions. Saisissez vous-même vos versions et leurs dates.

Une distribution Linux du catalogue affiche une ligne sous le tableau : « Ce distributeur publie ses vulnérabilités par paquet ». La ligne mène au suivi de sécurité du distributeur, par exemple le suivi de sécurité Debian ou les mises à jour de sécurité Red Hat. Vous y voyez quels paquets une vulnérabilité touche et quelles mises à jour la corrigent. Voir [Systèmes d'exploitation](#systemes-dexploitation).

La consultation ajoute les nouvelles versions, les nouveaux identifiants CPE produit et les nouveaux noms CVE.org du produit, et met à jour les dates de fin de support, les identifiants et les noms que le catalogue a changés. Elle n'écrase jamais une valeur que vous avez changée, et ne recrée jamais une version, un identifiant ou un nom que vous avez supprimé. Une version saisie avant que le catalogue ne la connaisse lui est rattachée quand les libellés correspondent, et ses dates vides sont remplies.

#### Identifiants de vulnérabilité

Le groupe **Identifiants de vulnérabilité**, sous les versions, réunit les identifiants CPE produit et les noms CVE.org. KANAP trouve les vulnérabilités d'une technologie grâce à eux.

- **Replié** : quand la technologie a au moins un identifiant, le groupe est replié, avec un résumé sur sa ligne de titre, par exemple `2 identifiants CPE · 3 noms CVE.org`. Cliquez sur le titre pour l'ouvrir.
- **Ouvert** : quand la technologie n'en a aucun, le groupe est ouvert, avec un avertissement : aucune vulnérabilité n'est recherchée pour cette technologie. La section **Versions** le signale aussi. Avec le niveau Membre sur l'infrastructure, **Ajouter un identifiant** à côté de cette ligne ouvre le groupe.

Le rapprochement se fait au niveau de la technologie. Chaque version de la technologie est comparée aux vulnérabilités de ses identifiants, et une version que vous ajoutez est rapprochée aussitôt. Sans identifiant, KANAP ne recherche aucune vulnérabilité, pour aucune version.

**Identifiants CPE produit** : les noms que les bases de sécurité donnent à ce produit, sous la forme `part:vendor:product` (par exemple `a:microsoft:sql_server`). KANAP les rapproche des vulnérabilités publiées. Un produit peut en avoir plusieurs (vSphere couvre vCenter et ESXi). Où trouver cette valeur : cherchez le produit dans le [Dictionnaire CPE du NIST](https://nvd.nist.gov/products/cpe/search) et gardez sa partie, son éditeur et son produit. Recopiez-les comme la NVD les écrit, avec la barre oblique inverse devant un signe : `a:veeam:veeam_backup_\&_replication`. La plupart des entrées du catalogue arrivent avec leurs identifiants, systèmes d'exploitation compris.

**Noms CVE.org** : les noms d'éditeur et de produit tels que l'éditeur les écrit dans ses propres fiches de vulnérabilité, par exemple l'éditeur `SAP_SE` et le produit `SAP HANA Database`. KANAP les rapproche de la liste CVE.org, qui contient aussi des vulnérabilités que la NVD n'a pas analysées (voir [Vulnérabilités](vulnerabilities.md#comment-kanap-les-trouve)). Les noms se trouvent sous les identifiants CPE produit et s'affichent quand KANAP lit la liste CVE.org. Chaque nom est listé à part.

- **Ajouter un nom** : tapez une partie du nom du produit dans la recherche. La liste propose les noms exacts que les éditeurs écrivent dans leurs fiches, chacun avec son nombre de vulnérabilités et la date de la dernière. Choisissez-en un, avec une version facultative. Un nom absent de la liste ne peut pas être saisi.
- **Suggestions** : les noms vus sur les vulnérabilités de vos identifiants CPE. Chacun indique son nombre de vulnérabilités et la part de ces vulnérabilités qui le portent.
- **Noms exacts** : la comparaison ignore la casse et la ponctuation, et demande pour le reste le nom exact. Un nom proche ne correspond pas : déclarez chaque variante d'un produit à part. Par exemple, `Microsoft SQL Server 2008` ne rapproche rien : les fiches écrivent `Microsoft SQL Server 2008 Service Pack 4 (QFE)`. Choisissez ce nom, avec la version `2008`.
- **Version** : une version limite le nom aux versions de la technologie dont le libellé commence par elle, par exemple `2019` pour `Windows Server 2019`. Quand un libellé commence par plusieurs d'entre elles, seule la plus longue compte : `2012 R2` reçoit le nom de `2012 R2` et laisse celui de `2012`.
- **Depuis le catalogue** : beaucoup d'entrées du catalogue arrivent avec leurs noms (Microsoft, Apache, bases de données et d'autres). La consultation du catalogue les tient à jour comme les identifiants CPE, et un nom que vous avez retiré ne revient pas.

Où trouver cette valeur : sur [cve.org](https://www.cve.org), ouvrez la fiche d'une vulnérabilité du produit. Le nom doit être celui de sa section **Product status**. Modifier les noms demande le niveau Membre sur l'infrastructure, comme pour les identifiants CPE.

### Serveurs

Les serveurs qui portent la technologie, une ligne par serveur et par version :

| Colonne | Ce qu'elle montre |
|---|---|
| **Réf.**, **Serveur** | Le serveur. Un cluster affiche une icône devant son nom. Cliquez sur la ligne pour l'ouvrir |
| **Environnement**, **Système d'exploitation** | Repris du serveur |
| **Version** | La version installée. Un tiret signifie que la version est inconnue |
| **Via** | Pour un serveur qui porte la technologie par un autre : les actifs sur lesquels elle est installée. La colonne n'apparaît que si l'onglet a une telle ligne |
| **Notes** | Texte libre sur cette installation, par exemple « nœud du cluster » |

Une technologie atteint un serveur de deux façons :

- **Installée** : quelqu'un a lié la technologie à ce serveur. Vous pouvez changer la version et les notes sur place, ou retirer la ligne.
- **Par un autre serveur** : pour un cluster, la technologie est installée sur ses membres. Par exemple, SQL Server installé sur les nœuds d'un cluster s'affiche sur le cluster en une ligne par version, avec sous **Via** les nœuds qui le portent. Elle suit l'installation : changez-la ou retirez-la sur ces serveurs.

Les serveurs qui tournent dans un hôte portant la technologie, comme les machines virtuelles d'un hôte ESXi, se rangent sous une ligne fermée en fin de tableau, **Actifs hébergés (n)**. Cliquez dessus pour les afficher, avec leur hôte sous **Via**.

**Ajouter** (`infrastructure:member`) ouvre une recherche de serveur, puis le choix de la version : choisissez une version, **Version inconnue**, ou tapez un nouveau libellé et choisissez **Ajouter la version « … »** pour la créer. Chaque modification s'enregistre aussitôt.

Un serveur retiré reste listé, grisé et marqué « retiré », pour que vous puissiez retirer son lien. Il ne compte nulle part : ni dans la pastille, ni dans le total, ni dans les compteurs de la liste, ni dans les rapports. La pastille et la ligne **Total** comptent les serveurs en service sur lesquels la technologie est installée, chacun une fois. Un cluster et un actif hébergé sont listés sans être comptés.

### Applications

Les applications qui utilisent la technologie, une ligne par application, environnement, serveur et version. Il faut pouvoir lire les applications pour voir cet onglet ; sans ce droit, une seule ligne le dit. Un Business Contributor ne voit que ses propres applications.

| Colonne | Ce qu'elle montre |
|---|---|
| **Réf.**, **Application** | L'application. Cliquez sur la ligne pour l'ouvrir |
| **Environnement** | L'environnement du déploiement |
| **Criticité** | La criticité métier de l'application |
| **Externe** | « Oui » quand l'application est exposée à l'extérieur |
| **Serveur** | Le serveur qui porte la technologie pour ce déploiement, avec son hôte quand il tourne dans un autre serveur. **Déclarée** pour une ligne ajoutée à la main |
| **Version** | La version utilisée. Un tiret signifie que la version est inconnue |
| **Responsable IT** | Les responsables IT de l'application |

Une application apparaît de deux façons :

- **Hébergée** : un de ses déploiements tourne sur un serveur qui porte la technologie. KANAP déduit la ligne des serveurs ; changez le serveur ou le déploiement pour la modifier.
- **Déclarée** : l'application dépend de la technologie sans tourner à côté d'elle, par exemple une application qui connecte ses utilisateurs par Entra ID. Changez la version sur place, ou retirez la déclaration. La retirer enlève toutes les versions déclarées de cette application.

**Ajouter** (`infrastructure:member`) ouvre une recherche où vous pouvez cocher plusieurs applications, puis demande leur version : choisissez-en une, tapez-en une nouvelle, ou choisissez **Version inconnue**. Elles sont toutes déclarées avec cette version. Cliquez sur la version d'une ligne déclarée pour la changer. Les applications et déploiements désactivés ne comptent pas.

**Exporter** télécharge les lignes dans un fichier CSV ou Excel, dans la langue de votre écran.

### Exploitation

Qui appeler et comment obtenir de l'aide :

- **Support** : les contacts de support, avec leur **E-mail**, leur **Téléphone** et leur **Rôle**. **Ajouter un contact** ouvre un court formulaire : choisissez le **Contact** (obligatoire) et donnez un **Rôle** facultatif. Un contact n'est listé qu'une fois ; l'ajouter à nouveau garde son rôle. Retirez un contact avec la croix au bout de sa ligne.
- **Notes de support** : texte libre, comme le numéro du contrat de support, les horaires de la hotline ou le circuit d'escalade. Elles s'enregistrent quand vous quittez le champ.

La technologie apparaît alors dans la section **Lié à** de la page de chaque contact.

### Conformité

La même classification que pour les applications, pour les technologies qui comptent dans vos plans de continuité :

- **Criticités** : **Criticité cyber**.
- **Continuité et reprise** : **Vague de reprise**, **Objectif de délai de reprise (RTO)** et **Objectif de perte de données (RPO)**.

Les niveaux et les vagues viennent de **Classifications et continuité** dans les [Paramètres de la cartographie SI](it-ops-settings.md#classifications-et-continuite). Survolez le point d'interrogation à côté d'un champ pour voir sa signification.

Dessous, quand les vulnérabilités sont suivies, la section **Vulnérabilités** résume les vulnérabilités connues de chaque version. Voir [Vulnérabilités](#vulnerabilites).

#### Vulnérabilités

Un résumé des vulnérabilités, une ligne par version installée de la technologie, dans l'ordre de la table des versions. Le nombre à côté du titre est le nombre de vulnérabilités distinctes, tous états confondus.

| Colonne | Ce qu'elle montre |
|---|---|
| **Version** | La version. Une version hors des alertes est grisée et indique **Exclue des alertes**. **Version non renseignée (potentiellement concernée)** regroupe les serveurs et applications qui n'indiquent aucune version ; cette ligne n'apparaît que s'il y en a |
| **Serveurs** | Le nombre de serveurs en service qui ont cette version renseignée sur eux-mêmes. Les clusters et les serveurs qui tournent dans un autre ne sont pas comptés. Voir [Ce que KANAP compte](vulnerabilities.md#what-kanap-counts) |
| **Critique**, **Élevée**, **Moyenne**, **Faible**, **Non évaluée** | Une colonne par sévérité : les vulnérabilités encore à traiter. Une vulnérabilité de sévérité **Aucune** compte avec **Faible**. Un point signifie qu'il n'en reste aucune. Survolez un en-tête pour un rappel |
| **Total** | Les vulnérabilités distinctes de cette version, tous états confondus |

**Voir** ouvre la page [Vulnérabilités](vulnerabilities.md) filtrée sur la version : sur ses vulnérabilités à traiter quand elle en a, sur tous les états sinon. **Tout voir dans la page Vulnérabilités**, sous la table, ouvre la page sur toute la technologie, tous états confondus.

Les versions qu'aucun serveur ni aucune application n'utilise n'ont pas de ligne. Elles sont nommées ensemble sous la table, par exemple « Non installées : 2016, 2017 ». KANAP ne recherche les vulnérabilités que des versions installées sur un serveur ou déclarées par une application.

Quand la technologie ou certaines de ses versions sont hors des alertes, une ligne en tête de la section le dit : **Exclue des alertes**, **Exclue des alertes, sauf 2 versions** ou **3 versions exclues des alertes**. Avec le niveau Membre sur l'infrastructure, **Modifier** à côté ouvre la table des versions de l'onglet Aperçu, où se trouvent les interrupteurs. Voir [Alertes de vulnérabilité](#alertes-de-vulnerabilite).

KANAP rapproche à nouveau la technologie dès que ses identifiants, ses noms CVE.org, ses versions, ses serveurs ou ses applications changent. Après un nouvel identifiant CPE produit, la section indique « Recherche des vulnérabilités en cours… » pendant que KANAP lit ce produit dans la NVD. Quand cette lecture ne peut pas aboutir, la section le dit. **Actualiser** (`infrastructure:member`) lance la comparaison à la main.

### Relations

Les fiches liées à la technologie, une section par genre :

- **Lignes budgétaires** : avec le montant de l'année en cours dans la colonne budgétaire de votre espace de travail, et un total. Une ligne dont la devise n'a pas de taux de change pour l'année affiche son montant dans sa propre devise avec une petite marque orange, et le total l'exclut. Un avertissement d'une ligne sous le tableau l'indique. Voir [Taux manuels](currencies.md#taux-manuels).
- **Contrats** : fournisseur, date de fin et montant annuel, avec un total par devise.
- **Projets** : statut et fin prévue.
- **Incidents** : sévérité, statut et date de détection. Lier un incident demande `incidents:contributor`. Un incident clos ou annulé ne peut être ni lié ni délié.
- **Liens et fichiers** : les liens web de la technologie et ses fichiers, une ligne chacun avec son nom, le domaine du lien ou la taille du fichier, et sa date d'ajout. Cliquez sur un lien pour l'ouvrir dans un nouvel onglet, ou sur un fichier pour le télécharger. Avec le niveau Membre sur l'infrastructure, **Ajouter un lien** et **Joindre un fichier** ajoutent une ligne, et les fichiers peuvent aussi être déposés sur la section. Survolez une ligne pour modifier un lien ou retirer une ligne. Retirer un lien affiche un message et propose **Annuler**, qui recrée le lien. La suppression d'un fichier demande une confirmation. Une adresse saisie sans `http://` ni `https://` reçoit `https://`. Tout autre schéma est refusé.

Une section n'apparaît que si vous pouvez lire son module. **Ajouter** (`infrastructure:member`) ouvre une recherche sur place ; la croix au bout d'une ligne retire le lien.

---

## Lier une technologie à un serveur

Vous pouvez indiquer qu'un serveur porte une technologie depuis l'un ou l'autre côté :

- Depuis la technologie : onglet **Serveurs**, **Ajouter**, puis choisissez le serveur et la version.
- Depuis le serveur : onglet **Exploitation** de l'actif, section **Technologies**, **Ajouter**, puis choisissez la technologie et la version. Voir [Actifs](assets.md#operations).

Saisissez la technologie sur le serveur où elle est installée : l'hôte pour un hyperviseur, chaque contrôleur de domaine pour Active Directory, le serveur de base de données pour SQL Server. Les serveurs qui tournent dedans, et le cluster de ces serveurs, l'affichent alors sans autre saisie. Une technologie dans le cloud, comme Entra ID, ne tourne sur aucun de vos serveurs : déclarez-la plutôt sur les applications.

---

## Importer et exporter les liens

La liste des technologies charge et télécharge les liens en masse, un lien par ligne d'un fichier CSV ou d'un classeur Excel. Il existe deux fichiers :

- **Serveurs et technologies** : les technologies installées sur chaque serveur.
- **Applications et technologies** : les technologies que chaque application déclare. Les applications hébergées sur un serveur qui porte une technologie sont déduites des serveurs : le fichier les laisse de côté.

Cliquez sur **Importer les liens** ou **Exporter les liens** dans la barre d'outils, puis choisissez le fichier. L'export propose les données, en CSV ou Excel, ou un modèle CSV vide. Les règles générales des fichiers d'import s'appliquent : encodage, séparateur, oui et non en quatre langues, 20 000 lignes au plus. Voir [Fichiers CSV et Excel](csv-files.md).

**Permissions** :

- Exporter le fichier des serveurs : `infrastructure:reader`.
- Importer le fichier des serveurs : `infrastructure:member`.
- Le fichier des applications demande aussi le droit de lire les applications. Un Business Contributor exporte et importe les liens de ses propres applications uniquement.

### Colonnes

| Colonne | Signification |
|---|---|
| `asset_reference`, `asset_name` | Le serveur (fichier des serveurs). La référence (`AST-12`) est lue en premier. Sans elle, le nom trouve le serveur, et un nom porté par deux serveurs est une erreur. Une référence et un nom qui désignent deux serveurs différents sont aussi une erreur |
| `application_reference`, `application_name` | L'application (fichier des applications), par sa référence (`APP-4`) d'abord, puis par son nom |
| `technology_reference`, `technology_name` | La technologie, par sa référence (`TEC-3`) d'abord, puis par son nom |
| `version` | Le libellé de la version. Une cellule vide signifie que la version est inconnue |
| `operating_system` | Fichier des serveurs uniquement. Indique si la technologie est le système d'exploitation du serveur : voir ci-dessous |
| `notes` | Texte libre sur le lien |
| `source` | L'origine du lien : saisie manuelle, import, assistant, agent ou Netbox. L'export l'écrit ; l'import l'ignore |

La colonne `operating_system` prend trois valeurs :

- **oui** : le lien devient le système d'exploitation du serveur. L'import refuse la ligne quand la technologie n'est pas de la famille **Système d'exploitation**, quand le serveur est un cluster qui a des membres, ou quand le serveur a déjà un autre système d'exploitation.
- **non** : le lien n'est jamais marqué.
- **Vide** : un nouveau lien suit la règle de la fiche du serveur. Une technologie de la famille **Système d'exploitation** devient le système d'exploitation du serveur quand celui-ci n'en a pas encore et n'est pas un cluster. L'aperçu l'indique sur la ligne.

L'import ne retire jamais la marque de système d'exploitation d'un lien.

### Ce que fait un import

**Vérification préalable** lit le fichier et liste ce que le chargement ferait, avec les éventuelles erreurs par ligne. Un fichier qui contient une erreur ne charge rien.

- Un lien, c'est un serveur ou une application, une technologie et une version : une ligne avec une autre version ajoute un second lien. Le même lien deux fois dans un fichier est une erreur.
- Chaque ligne ajoute un lien ou met à jour un lien existant. Les liens absents du fichier restent tels quels : l'import ne supprime jamais de lien.
- Un lien existant garde son origine. Ses notes changent quand la cellule `notes` contient un texte différent, et une cellule vide les laisse telles quelles.
- Un nouveau lien est marqué comme issu d'un import, avec le nom du fichier.
- La technologie doit déjà figurer dans votre liste. Adoptez-la depuis le catalogue ou créez-la d'abord.
- Une version que vous ne suivez pas encore est créée sur la technologie. L'aperçu la nomme.

Un gros fichier prend du temps à charger et retient les liens de ses technologies jusqu'à la fin. Plusieurs petits fichiers gênent moins les personnes qui travaillent au même moment.

---

## Où apparaissent les technologies

- **Applications** : la section **Technologies**, en haut de l'onglet Exploitation, liste ce dont une application dépend. Voir [Applications](applications.md#operations).
- **Actifs** : la section **Technologies** de l'onglet Exploitation d'un actif liste ce que porte le serveur, son système d'exploitation en tête. Voir [Actifs](assets.md#operations).
- **Contrats**, **lignes budgétaires** et **incidents** : un champ **Technologies** dans leur onglet Relations, pour les utilisateurs qui peuvent lire l'infrastructure.
- Rapport **Fins de support** : les versions qui atteignent leur fin de support, systèmes d'exploitation compris, et ce qu'elles touchent. Voir [Fins de support](end-of-support.md).
- **Vulnérabilités** : les vulnérabilités connues des versions en service, et les serveurs et applications qu'elles atteignent. Voir [Vulnérabilités](vulnerabilities.md).
- **Zones d'administration** : les services d'annuaire avec leur zone, et les serveurs qui portent une technologie d'annuaire hors de la zone la plus sensible. Voir [Zones d'administration](administration-view.md).
- **Contacts** : la section **Lié à** d'un contact liste les technologies qu'il supporte. Voir [Contacts](contacts.md#ou-les-contacts-sont-utilises).
- **Recherche** : la recherche globale et les mentions `@` de l'assistant trouvent les technologies par nom et par référence (`@TEC-4`).

## Convertir une application

Une fiche créée comme application peut être en réalité une technologie, par exemple un moteur de base de données ou un annuaire. Ouvrez l'application et utilisez **Convertir en technologie**. Voir [Applications](applications.md#convertir-une-application-en-technologie).

## Demander à l'assistant

[Plaid](ai-assistant.md) lit les technologies avec les mêmes droits que cette page. Demandez par exemple : « Qui est responsable de TEC-3 ? », « Quels liens web a PostgreSQL ? », « Les alertes de vulnérabilité sont-elles actives sur TEC-3 ? » ou « Quelles technologies sont hors support ? »

Avec le niveau Membre sur l'infrastructure, Plaid écrit aussi, et chaque modification arrive sous forme d'aperçu que vous approuvez :

- Adopter une entrée du catalogue, compléter une technologie du même nom saisie à la main, ou créer une technologie que le catalogue ne connaît pas.
- Modifier les champs de la technologie.
- Ajouter des versions et changer leurs libellés, leurs dates et leurs notes.
- Ajouter ou retirer des responsables IT, des responsables métier et des contacts de support.
- Ajouter, modifier ou retirer des liens web.
- Activer ou désactiver les alertes de vulnérabilité, pour la technologie ou pour une version.

Plaid nomme la famille, le cycle de vie et les autres valeurs de liste dans votre langue, et refuse une valeur qui en désigne plusieurs. Il refuse un nom porté par deux utilisateurs ou par deux contacts, et deux liens de même adresse. Demandez par exemple : « Adopte PostgreSQL depuis le catalogue KANAP », « Ajoute la version 17 à TEC-3 », « Ajoute Camille Roux comme responsable métier de PostgreSQL », « Ajoute le contact Oracle Support au support de TEC-3 », « Ajoute le lien des notes de version https://www.postgresql.org/docs/release/ à PostgreSQL » ou « Exclus la version 14 de TEC-3 des alertes ».

Ajouter un contact de support demande aussi le droit de lire les contacts. En retirer un ne le demande pas. Plaid n'ajoute comme responsables que des utilisateurs actifs, et retire un responsable même si son compte est désactivé. Un contact sans nom ne peut pas être ajouté : donnez-lui d'abord un nom dans Contacts. Quand Plaid complète une technologie saisie à la main, il ne change que les champs qui diffèrent, et s'arrête si l'un d'eux a été modifié à l'écran après l'aperçu.

La suppression d'une technologie ou d'une version, les pièces jointes, les identifiants CPE et les noms CVE.org, et le rapprochement des vulnérabilités restent sur cette page.

## Conseils

- **Partez du catalogue** : vous obtenez les versions et leurs dates de fin de support sans les saisir.
- **Suivez les versions majeures** : une ligne par version majeure (2019, 2022) suffit pour suivre le support.
- **Nommez les responsables** : les responsables IT sont les personnes à appeler quand une version atteint sa fin de support. Ils reçoivent aussi l'e-mail sur les nouvelles vulnérabilités critiques.
- **Renseignez les identifiants CPE produit et les noms CVE.org** : sans aucun des deux, KANAP ne peut pas rapprocher la technologie des vulnérabilités publiées.
- **Saisissez la version sur chaque serveur** : une version inconnue est potentiellement concernée par toutes les vulnérabilités du produit.
