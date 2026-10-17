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

Créez une technologie quand personne ne travaille dans le produit lui-même, mais que d'autres applications tombent ou deviennent exposées quand il tombe. Gardez une fiche comme application quand les utilisateurs métier s'y connectent et s'en servent pour leur travail.

Quelques exemples :

- **Entra ID** : une technologie **SaaS** de la famille **Annuaire et identité**, éditée par Microsoft. Elle ne tourne sur aucun de vos serveurs. Les applications qui connectent leurs utilisateurs par ce service la déclarent.
- **Active Directory** : une technologie **Sur site** de la même famille, portée par vos contrôleurs de domaine. Les applications qui l'utilisent la déclarent.
- **vSphere** : une technologie **Sur site**, portée par la machine virtuelle vCenter et par les hôtes.
- **SQL Server** : une technologie avec une ligne par version en service (2016, 2019, 2022). Chaque serveur porte sa propre version, et le rapport des fins de support peut nommer les serveurs restés sur une ancienne.
- **Une application SaaS** : aucune technologie à saisir. L'éditeur maintient ce sur quoi elle tourne.

Une technologie couvre un produit dans son ensemble. « SQL Server » désigne tous les SQL Server que vous faites tourner ; les versions portent le détail.

## Premiers pas

Rendez-vous dans **Cartographie SI > Technologies** et cliquez sur **Nouvelle technologie**.

La fenêtre s'ouvre sur le **Catalogue** : une liste de produits courants avec une description courte, leur éditeur, leur famille et leur type d'hébergement. Cherchez par nom, puis cliquez sur une entrée. KANAP crée aussitôt la technologie avec son éditeur, sa famille, son type d'hébergement, ses identifiants CPE produit, ses versions avec leurs dates de fin de support et la description courte dans votre langue, puis l'ouvre. Le catalogue ne propose que les produits que vous n'avez pas encore ajoutés.

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
| **Serveurs** | Les actifs qui la portent, directement ou parce qu'ils sont dans un actif qui la porte |
| **Applications** | Les applications qui la déclarent ou sont hébergées sur un serveur qui la porte |
| **Prochaine fin de support** | La plus proche fin de support standard à venir parmi les versions en service. En orange quand elle tombe dans les 12 prochains mois |
| **Vulnérabilités à traiter** | Les vulnérabilités connues encore à traiter sur les versions en service. En orange avec le nombre de critiques ou élevées (`3 · 1 critiques ou élevées`). Cliquez pour ouvrir la page [Vulnérabilités](vulnerabilities.md) sur cette technologie. Présente quand les vulnérabilités sont suivies |

**Colonnes supplémentaires** (par le sélecteur de colonnes) : **Cycle de vie**, **Versions en service**, **Responsable IT**.

Quand les vulnérabilités sont suivies, la colonne **Éditeur** ouvre aussi la page Vulnérabilités sur les produits de cet éditeur. Voir [Vulnérabilités](vulnerabilities.md) pour savoir quand elles sont suivies.

**Filtres** : **Famille**, **Éditeur** et **Cycle de vie** proposent des filtres à cases à cocher. La zone de recherche porte sur le nom, l'éditeur et la référence.

**Actions** :

- **Nouvelle technologie** (`infrastructure:member`).
- **Supprimer** les lignes sélectionnées (`infrastructure:admin`). La confirmation compte ce qui part avec elles : liens vers les serveurs et les applications, contrats, lignes budgétaires, projets, incidents et documents.

---

## La fiche technologie

La fiche comporte un en-tête, un panneau de propriétés à droite et six onglets : **Aperçu**, **Serveurs**, **Applications**, **Exploitation**, **Conformité** et **Relations**. Les onglets **Serveurs**, **Applications** et **Relations** affichent leur nombre en pastille.

### En-tête

- **Nom** : modifiable sur place.
- **Référence** : cliquez pour la copier.
- **Cycle de vie** : cliquez pour le changer. Une technologie retirée n'est plus proposée quand vous en cherchez une à lier.
- **Famille**.
- **Supprimer** (`infrastructure:admin`) : la confirmation nomme ce qui part avec la technologie.

### Panneau de propriétés

- **Éditeur**, **Famille** et **Type d'hébergement**.
- **Zone d'administration** : la zone de votre modèle d'administration à laquelle appartient la technologie, par exemple le tier 0 pour l'annuaire. Les zones viennent de **Cartographie SI > Paramètres**. Une technologie sans zone figure parmi les données à compléter de la [Vue de l'administration](administration-view.md).
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

Le support court encore le jour de sa date de fin. Avec une seule date, cette date est la fin. **Ajouter une version** ajoute une ligne ; survolez une ligne pour la modifier ou la supprimer. Supprimer une version utilisée par des serveurs ou des applications demande confirmation : ces liens affichent alors une version inconnue.

#### Versions issues du catalogue

Une version issue du catalogue affiche **Catalogue** à côté de son libellé, et une technologie adoptée depuis le catalogue indique « Versions et dates tenues à jour depuis le catalogue » sous ses versions. KANAP consulte le catalogue chaque jour dans le cloud. Sur une installation sur site, chaque version de KANAP apporte son catalogue au démarrage, sauf si votre administrateur [active la consultation quotidienne](on-premise/configuration.md#optional-technology-catalog).

La consultation ajoute les nouvelles versions et les nouveaux identifiants CPE produit du produit, et met à jour les dates de fin de support et les identifiants que le catalogue a changés. Elle n'écrase jamais une valeur que vous avez changée, et ne recrée jamais une version ou un identifiant que vous avez supprimé. Une version saisie avant que le catalogue ne la connaisse lui est rattachée quand les libellés correspondent, et ses dates vides sont remplies.

**Identifiants CPE produit** : les noms que les bases de sécurité donnent à ce produit, sous la forme `part:vendor:product` (par exemple `a:microsoft:sql_server`). KANAP les rapproche des vulnérabilités publiées : une technologie qui n'en a aucun ne reçoit aucune vulnérabilité. Un produit peut en avoir plusieurs (vSphere couvre vCenter et ESXi). Où trouver cette valeur : cherchez le produit dans le [Dictionnaire CPE du NIST](https://nvd.nist.gov/products/cpe/search) et gardez sa partie, son éditeur et son produit. Recopiez-les comme la NVD les écrit, avec la barre oblique inverse devant un signe : `a:veeam:veeam_backup_\&_replication`. Les entrées du catalogue arrivent avec leurs identifiants.

**Notes** : texte libre, comme les conditions de licence ou les dates de renouvellement.

### Serveurs

Les serveurs qui portent la technologie, une ligne par serveur et par version :

| Colonne | Ce qu'elle montre |
|---|---|
| **Réf.**, **Serveur** | Le serveur. Cliquez sur la ligne pour l'ouvrir |
| **Environnement**, **Système d'exploitation** | Repris du serveur |
| **Version** | La version installée. Un tiret signifie que la version est inconnue |
| **Via** | Pour un serveur qui porte la technologie par un autre : le serveur ou le cluster sur lequel elle est installée. La colonne n'apparaît que si l'onglet a une telle ligne |
| **Notes** | Texte libre sur cette installation, par exemple « nœud du cluster » |

Une technologie atteint un serveur de deux façons :

- **Installée** : quelqu'un a lié la technologie à ce serveur. Vous pouvez changer la version et les notes sur place, ou retirer la ligne.
- **Par un autre serveur** : la technologie est installée sur le serveur ou le cluster dans lequel celui-ci tourne, par exemple SQL Server installé sur un cluster et affiché sur chacun de ses membres. La ligne nomme ce serveur sous **Via**. Elle suit l'installation : changez-la ou retirez-la sur ce serveur.

**Ajouter** (`infrastructure:member`) ouvre une recherche de serveur, puis le choix de la version : choisissez une version, **Version inconnue**, ou tapez un nouveau libellé et choisissez **Ajouter la version « … »** pour la créer. Chaque modification s'enregistre aussitôt.

Un serveur retiré reste listé, grisé et marqué « retiré », pour que vous puissiez retirer son lien. Il ne compte nulle part : ni dans la pastille, ni dans le total, ni dans les compteurs de la liste, ni dans les rapports. La ligne **Total** compte les serveurs en service, chacun une fois.

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

**Ajouter** (`infrastructure:member`) ouvre une recherche où vous pouvez cocher plusieurs applications, puis les ajouter d'un coup. Elles sont déclarées avec une version inconnue : renseignez-la ensuite sur chaque ligne. Les applications et déploiements désactivés ne comptent pas.

**Exporter en CSV** télécharge les lignes dans la langue de votre écran.

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

### Relations

Les fiches liées à la technologie, une section par genre :

- **Lignes budgétaires** : avec le montant de l'année en cours dans la colonne budgétaire de votre espace de travail, et un total.
- **Contrats** : fournisseur, date de fin et montant annuel, avec un total par devise.
- **Projets** : statut et fin prévue.
- **Incidents** : sévérité, statut et date de détection. Lier un incident demande `incidents:contributor`. Un incident clos ou annulé ne peut être ni lié ni délié.
- **Documents** : les fichiers déposés sur la technologie, avec leur taille et leur date. **Ajouter** dépose des fichiers ; cliquez sur un nom pour le télécharger.
- **Liens web** : un nom et une adresse, comme les notes de version de l'éditeur. Cliquez sur le nom pour l'ouvrir ; survolez une ligne pour la modifier. Les adresses commencent par `http://` ou `https://` ; une adresse sans préfixe s'ouvre en `https://`.
- **Vulnérabilités** : quand les vulnérabilités sont suivies, les vulnérabilités connues des versions en service. Voir [Vulnérabilités](#vulnerabilites).

Une section n'apparaît que si vous pouvez lire son module. **Ajouter** (`infrastructure:member`) ouvre une recherche sur place ; la croix au bout d'une ligne retire le lien.

#### Vulnérabilités

Une ligne par version et par vulnérabilité, la plus sévère en premier, avec sa **CVE**, sa **Sévérité**, sa **Version** et son **État**. Le nombre à côté du titre est le nombre de vulnérabilités distinctes. Cliquez sur une ligne pour l'ouvrir dans la page [Vulnérabilités](vulnerabilities.md), où vous la traitez.

KANAP rapproche à nouveau la technologie dès que ses identifiants, ses versions, ses serveurs ou ses applications changent. Après un nouvel identifiant CPE produit, la section indique « Recherche des vulnérabilités en cours… » pendant que KANAP lit ce produit dans la NVD. **Rapprocher à nouveau** (`infrastructure:member`) lance la comparaison à la main.

---

## Lier une technologie à un serveur

Vous pouvez indiquer qu'un serveur porte une technologie depuis l'un ou l'autre côté :

- Depuis la technologie : onglet **Serveurs**, **Ajouter**, puis choisissez le serveur et la version.
- Depuis le serveur : onglet **Technique** de l'actif, section **Technologies**, **Ajouter**, puis choisissez la technologie et la version. Voir [Actifs](assets.md#technique).

Saisissez la technologie sur le serveur où elle est installée : l'hôte pour un hyperviseur, chaque contrôleur de domaine pour Active Directory, le serveur de base de données pour SQL Server. Les serveurs qui tournent dedans, ou les membres de son cluster, l'affichent alors sans autre saisie. Une technologie dans le cloud, comme Entra ID, ne tourne sur aucun de vos serveurs : déclarez-la plutôt sur les applications.

---

## Où apparaissent les technologies

- **Applications** : la section **Technologies** de l'onglet Relations liste ce dont une application dépend. Voir [Applications](applications.md#relations).
- **Actifs** : la section **Technologies** de l'onglet Technique d'un actif liste ce que porte le serveur ; la section **Si ce serveur tombe** de son onglet Relations liste les technologies qui s'arrêtent avec lui. Voir [Actifs](assets.md#technique).
- **Contrats**, **lignes budgétaires** et **incidents** : un champ **Technologies** dans leur onglet Relations, pour les utilisateurs qui peuvent lire l'infrastructure.
- Rapport **Fins de support** : les versions qui atteignent leur fin de support, et ce qu'elles touchent. Voir [Fins de support](end-of-support.md).
- **Vulnérabilités** : les vulnérabilités connues des versions en service, et les serveurs et applications qu'elles atteignent. Voir [Vulnérabilités](vulnerabilities.md).
- **Vue de l'administration** : les technologies de chaque zone d'administration, avec leurs serveurs. Voir [Vue de l'administration](administration-view.md).
- **Contacts** : la section **Lié à** d'un contact liste les technologies qu'il supporte. Voir [Contacts](contacts.md#ou-les-contacts-sont-utilises).
- **Recherche** : la recherche globale et les mentions `@` de l'assistant trouvent les technologies par nom et par référence (`@TEC-4`).

## Convertir une application

Une fiche créée comme application peut être en réalité une technologie, par exemple un moteur de base de données ou un annuaire. Ouvrez l'application et utilisez **Convertir en technologie**. Voir [Applications](applications.md#convertir-une-application-en-technologie).

## Conseils

- **Partez du catalogue** : vous obtenez les versions et leurs dates de fin de support sans les saisir.
- **Suivez les versions majeures** : une ligne par version majeure (2019, 2022) suffit pour suivre le support.
- **Nommez les responsables** : les responsables IT sont les personnes à appeler quand une version atteint sa fin de support. Ils reçoivent aussi l'e-mail sur les nouvelles vulnérabilités critiques.
- **Renseignez les identifiants CPE produit** : sans eux, KANAP ne peut pas rapprocher la technologie des vulnérabilités publiées.
- **Saisissez la version sur chaque serveur** : une version inconnue est potentiellement concernée par toutes les vulnérabilités du produit.
