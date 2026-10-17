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

- **Entra ID** : une technologie souscrite de la famille **Annuaire et identité**, éditée par Microsoft. Elle ne tourne sur aucun de vos serveurs. Les applications qui connectent leurs utilisateurs par ce service la déclarent.
- **Active Directory** : une technologie installée de la même famille, portée par vos contrôleurs de domaine. Les applications qui l'utilisent la déclarent.
- **vSphere** : une technologie installée, portée par la machine virtuelle vCenter et par les hôtes.
- **SQL Server** : une technologie avec une ligne par version en service (2016, 2019, 2022). Chaque serveur porte sa propre version, et le rapport des fins de support peut nommer les serveurs restés sur une ancienne.
- **Une application SaaS** : aucune technologie à saisir. L'éditeur maintient ce sur quoi elle tourne.

Une technologie couvre un produit dans son ensemble. « SQL Server » désigne tous les SQL Server que vous faites tourner ; les versions portent le détail.

## Premiers pas

Rendez-vous dans **Cartographie SI > Technologies** et cliquez sur **Nouvelle technologie**.

La fenêtre s'ouvre sur le **Catalogue** : une liste de produits courants avec leur éditeur, leur famille et leurs versions. Cherchez par nom, puis cliquez sur une entrée. KANAP crée aussitôt la technologie avec son éditeur, sa famille, son mode, ses identifiants CPE produit et ses versions avec leurs dates de fin de support, puis l'ouvre. Le catalogue ne propose que les produits que vous n'avez pas encore ajoutés.

Pour un produit que le catalogue ne connaît pas, cliquez sur **Saisir une technologie absente du catalogue**. Renseignez :

- **Nom** (obligatoire) : unique parmi vos technologies.
- **Famille** : le genre de technologie (base de données, hyperviseur, annuaire et identité, etc.).
- **Éditeur** : les suggestions viennent de vos autres technologies et du catalogue, pour qu'un même éditeur garde une seule orthographe.
- **Mode** : **Installée** quand elle tourne sur vos serveurs, **Souscrite** pour un service acheté à un fournisseur.

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

**Colonnes supplémentaires** (par le sélecteur de colonnes) : **Cycle de vie**, **Versions en service**, **Responsable IT**.

**Filtres** : **Famille**, **Éditeur** et **Cycle de vie** proposent des filtres à cases à cocher. La zone de recherche porte sur le nom, l'éditeur et la référence.

**Actions** :

- **Nouvelle technologie** (`infrastructure:member`).
- **Supprimer** les lignes sélectionnées (`infrastructure:admin`). La confirmation compte ce qui part avec elles : liens vers les serveurs et les applications, contrats, lignes budgétaires, projets, incidents et documents.

---

## La fiche technologie

La fiche comporte un en-tête, un panneau de propriétés à droite et l'onglet **Aperçu**.

### En-tête

- **Nom** : modifiable sur place.
- **Référence** : cliquez pour la copier.
- **Cycle de vie** : cliquez pour le changer. Une technologie retirée n'est plus proposée quand vous en cherchez une à lier.
- **Famille**.
- **Supprimer** (`infrastructure:admin`) : la confirmation nomme ce qui part avec la technologie.

### Panneau de propriétés

- **Éditeur**, **Famille** et **Mode**.
- **Remplacée par** : la technologie qui prend la suite de celle-ci, par exemple un produit plus récent vers lequel vos équipes migrent.
- **Responsables IT** : les personnes responsables de la technologie.

Les modifications s'enregistrent au fil de la saisie.

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

**Identifiants CPE produit** : les noms que les bases de sécurité donnent à ce produit, sous la forme `part:vendor:product` (par exemple `a:microsoft:sql_server`). Un produit peut en avoir plusieurs (vSphere couvre vCenter et ESXi). Où trouver cette valeur : cherchez le produit dans le [Dictionnaire CPE du NIST](https://nvd.nist.gov/products/cpe/search) et gardez sa partie, son éditeur et son produit. Les entrées du catalogue arrivent avec leurs identifiants.

**Notes** : texte libre, comme les conditions de licence ou les dates de renouvellement.

---

## Où apparaissent les technologies

- **Applications** : la section **Technologies** de l'onglet Relations liste ce dont une application dépend. Voir [Applications](applications.md#relations).
- **Actifs** : la section **Si ce serveur tombe** de l'onglet Relations d'un actif liste les technologies qui s'arrêtent avec lui. Voir [Actifs](assets.md#relations).
- **Contrats**, **lignes budgétaires** et **incidents** : un champ **Technologies** dans leur onglet Relations, pour les utilisateurs qui peuvent lire l'infrastructure.
- Rapport **Fins de support** : les versions qui atteignent leur fin de support, et ce qu'elles touchent. Voir [Fins de support](end-of-support.md).
- **Recherche** : la recherche globale et les mentions `@` de l'assistant trouvent les technologies par nom et par référence (`@TEC-4`).

## Convertir une application

Une fiche créée comme application peut être en réalité une technologie, par exemple un moteur de base de données ou un annuaire. Ouvrez l'application et utilisez **Convertir en technologie**. Voir [Applications](applications.md#convertir-une-application-en-technologie).

## Conseils

- **Partez du catalogue** : vous obtenez les versions et leurs dates de fin de support sans les saisir.
- **Suivez les versions majeures** : une ligne par version majeure (2019, 2022) suffit pour suivre le support.
- **Nommez les responsables** : les responsables IT sont les personnes à appeler quand une version atteint sa fin de support.
