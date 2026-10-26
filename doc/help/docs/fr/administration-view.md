# Zones d'administration

La page Zones d'administration montre qui administre quoi. Elle suit le modèle d'administration en tiers, une bonne pratique reconnue pour administrer les annuaires comme Active Directory : vos zones d'administration, les actifs de chacune, les points à corriger, puis vos services d'annuaire et vos domaines. Elle aide à répondre aux questions d'une revue NIS2 sur les accès à privilèges.

Ouvrez-la depuis **Cartographie SI > Zones d'administration**, dans le groupe **Infrastructure**. Il faut `infrastructure:reader` pour la lire, et `infrastructure:member` pour y affecter des zones.

## Avant de commencer

La page lit ce que vous saisissez ailleurs :

1. Définissez vos zones d'administration et complétez vos domaines dans **Cartographie SI > Paramètres**. Mettez les zones dans l'ordre : la première est la plus sensible. Voir [Zones d'administration](it-ops-settings.md#zones-dadministration) et [Domaines](it-ops-settings.md#domaines).
2. Placez chaque actif dans sa zone, ici en masse (voir [Affecter une zone](#affecter-une-zone)) ou avec le champ **Zone d'administration** du tiroir des propriétés de l'actif. Voir [Actifs](assets.md#tiroir-des-proprietes-panneau-de-droite).
3. Liez les technologies d'annuaire, comme Active Directory, aux serveurs qui les portent. Voir [Lier une technologie à un serveur](technologies.md#lier-une-technologie-a-un-serveur).
4. Un service d'annuaire qui ne tourne sur aucun de vos serveurs, comme Entra ID, prend sa zone dans le champ **Zone d'administration** de son tiroir des propriétés. Voir [Technologies](technologies.md#panneau-de-proprietes).

## Pourquoi les zones comptent

Dans le modèle d'administration en tiers, tout ce qui peut agir sur un élément d'une zone sensible appartient à cette zone : l'hyperviseur qui fait tourner un contrôleur de domaine peut en prendre le contrôle, il est donc lui aussi en tier 0. Les points de contrôle trouvent les actifs qui enfreignent cette règle.

## Onglets

La page a deux onglets, chacun avec son compteur :

- **Actifs** : les zones, les points de contrôle et la table des actifs. Son compteur donne le nombre d'actifs qui ne sont pas retirés.
- **Annuaires et domaines** : vos services d'annuaire, puis vos domaines groupés par forêt. Son compteur additionne les services d'annuaire et les domaines.

La page s'ouvre sur **Actifs**. L'adresse de la page garde l'onglet ouvert et les filtres de la table : un lien ouvre la même vue. **Exporter les actifs** et **Exporter les domaines** restent en haut de la page sur les deux onglets. **Affecter à une zone** apparaît sur l'onglet **Actifs**.

## Zones

La bande du haut liste les zones dans l'ordre des paramètres, la plus sensible en premier, puis une ligne **Sans zone**. Chaque ligne montre :

- Le nom de la zone, avec sa description dessous.
- Son **Groupe d'administrateurs**.
- Le nombre de ses actifs de chaque type, le nombre d'applications hébergées sur ces actifs et le nombre de services d'annuaire placés dans la zone. Survolez les services d'annuaire pour lire leurs noms. Seules les applications et les instances en service comptent.

Cliquez sur une ligne pour n'afficher que ses actifs dans la table en dessous. Cliquez à nouveau pour afficher tous les actifs. La ligne **Sans zone** donne le nombre d'actifs qui n'ont pas encore de zone.

Les actifs et les technologies retirés sont exclus. Une zone marquée **Ne plus proposer** dans les paramètres reste affichée tant que des actifs ou des services d'annuaire y sont placés. Une zone supprimée des paramètres alors que des actifs ou des services d'annuaire la nomment encore s'affiche après les autres comme **Zone inconnue**, avec son code.

Si aucune zone n'existe encore, la page le dit et, si vous pouvez lire les paramètres, renvoie vers eux.

## Points de contrôle

Sous la bande, un bouton par point de contrôle donne son nom court et son nombre d'actifs. Survolez-le pour lire le titre complet et ce qu'il faut faire. Cliquez dessus pour n'afficher que les actifs concernés dans la table, et à nouveau pour afficher tous les actifs.

La zone la plus sensible est la première zone des paramètres qui n'est pas marquée **Ne plus proposer**.

| Point de contrôle | Actifs listés |
|---|---|
| **Zone non renseignée** | Les actifs qui n'ont pas de zone |
| **Contrôleur de domaine hors zone** | Les contrôleurs de domaine que liste l'onglet **Annuaires et domaines**, quand leur zone n'est pas la plus sensible. Un serveur d'annuaire sans domaine, ou dont le domaine manque dans les paramètres, compte seulement sous **Service d'annuaire hors zone** |
| **Service d'annuaire hors zone** | Les actifs sur lesquels une technologie d'annuaire est installée, comme Active Directory, quand leur zone n'est pas la plus sensible |
| **Hôte moins sensible** | Les actifs à remonter : un hôte qui fait tourner un actif d'une zone plus sensible (un hôte en tier 1 qui fait tourner une machine virtuelle en tier 0, par exemple), ou le membre d'un cluster d'une zone plus sensible (un hôte ESX en tier 1 dans un cluster en tier 0, par exemple) |
| **Application hébergée** | Les actifs de la zone la plus sensible qui hébergent une application en service. Vérifiez que chaque application y a sa place |

Pour **Hôte moins sensible**, KANAP lit les relations **Contient** des actifs et les membres des clusters. Ce qui fait tourner un actif doit être dans une zone au moins aussi sensible. Une zone marquée **Ne plus proposer** ou absente des paramètres est ignorée. Un actif sans zone interrompt la vérification de la chaîne : KANAP ne compare ni cet actif ni les actifs qui lui sont liés, et **Zone non renseignée** le liste.

Sans aucune zone dans les paramètres, seul **Zone non renseignée** s'affiche, et la page vous invite à ajouter une zone.

## Actifs

La table liste tous les actifs qui ne sont pas retirés, et en charge d'autres à mesure que vous faites défiler. Cliquez sur une ligne pour ouvrir l'actif.

| Colonne | Ce qu'elle montre |
|---|---|
| **Réf.**, **Nom**, **Type** | L'actif |
| **Zone** | Sa zone d'administration, ou **Sans zone** |
| **Technologies** | Les technologies installées sur l'actif. Les deux premiers noms s'affichent, puis le nombre des autres ; survolez la cellule pour la liste complète |
| **Applications** | Les applications en service hébergées sur l'actif, affichées de la même façon, y compris celles affectées à son cluster. Cliquez sur un nom pour ouvrir l'application |
| **Contrôles** | Les points de contrôle qui concernent l'actif. Survolez **Hôte moins sensible** pour en voir la raison : **Héberge** nomme l'actif plus sensible qu'il héberge, **Membre du cluster** nomme le cluster plus sensible, chacun par sa référence et son nom, avec sa zone |

Recherchez sur le nom ou la référence. Filtrez sur **Type**, **Zone** (y compris **Sans zone**) et **Contrôles**, et triez sur **Réf.**, **Nom**, **Type** ou **Zone**. Le tri sur la zone suit l'ordre des paramètres, avec les actifs sans zone à la fin. La bande et les boutons des points de contrôle posent les mêmes filtres que les colonnes **Zone** et **Contrôles**.

## Affecter une zone

Avec `infrastructure:member`, une case ouvre chaque ligne :

- Cochez des lignes pour les choisir une à une.
- Cochez la case de l'en-tête pour choisir tous les actifs du filtre en cours, y compris ceux qui ne sont pas encore chargés. Vous pouvez ensuite décocher des lignes pour les écarter.

Modifier la recherche ou les filtres efface le choix. **Affecter à une zone** ouvre une fenêtre où vous choisissez une zone, ou **Sans zone** pour l'effacer. Une zone marquée **Ne plus proposer** ne peut pas être choisie. Avant que vous confirmiez, la fenêtre compte les actifs dont la zone va changer parmi les actifs choisis. Une affectation couvre jusqu'à 5 000 actifs : au-delà, affinez les filtres.

Si des actifs entrent dans le filtre entre le décompte et la confirmation, KANAP refuse la modification et compte à nouveau : vérifiez le nouveau nombre, puis confirmez. Chaque actif modifié reçoit une entrée dans le journal d'audit, comme lorsque vous le modifiez.

## Services d'annuaire et domaines

**Services d'annuaire** liste les technologies de la famille **Annuaire et identité**, avec leur zone et leur nombre de serveurs (les serveurs qui ne sont pas retirés et portent directement la technologie). Cliquez sur une ligne pour ouvrir la technologie.

**Domaines** liste vos domaines, sauf les entrées intégrées **Workgroup** et **N/A**, groupés par forêt. Les domaines dont la forêt est écrite avec une casse différente partagent un même groupe. Les domaines sans forêt viennent en dernier, sous **Sans forêt**. Chaque domaine montre :

| Colonne | Ce qu'elle montre |
|---|---|
| **Domaine** | Le nom du domaine. Un domaine qui n'est plus proposé est marqué comme tel |
| **Suffixe DNS** | Le suffixe des noms de ses machines |
| **Approbations** | Les domaines avec lesquels il a une approbation, et le sens de chacune |
| **Comptes**, **Ordinateurs** | Les nombres saisis dans les paramètres. Un tiret signifie qu'aucun n'est saisi |
| **Contrôleurs de domaine** | Le nombre de serveurs que KANAP déduit comme contrôleurs du domaine, puis leurs noms. Cliquez sur un nom pour ouvrir l'actif |

**Approbations** liste aussi, en gris, les approbations déclarées sur un autre domaine envers celui-ci, avec le sens vu depuis ce domaine : une approbation sortante de A vers B se lit comme entrante sur B. Les sens signifient :

- **Sortante** : ce domaine approuve l'autre. Les comptes de l'autre domaine peuvent accéder aux ressources de celui-ci.
- **Entrante** : l'autre domaine approuve celui-ci.
- **Bidirectionnelle** : les deux.

Les **Contrôleurs de domaine** ne se saisissent pas à la main. KANAP prend les serveurs du domaine (le champ **Domaine** de l'onglet Réseau de l'actif) qui ne sont pas retirés et qui :

- portent une technologie de la famille **Annuaire et identité** qui n'est pas retirée, comme Active Directory, ou
- sont affectés avec le rôle de serveur **Contrôleur de domaine** à une application en service.

Chaque serveur apparaît une fois. « Aucun trouvé » signifie qu'aucun serveur du domaine ne remplit l'une ou l'autre règle.

## Export

**Exporter les actifs** télécharge les actifs de la table dans un fichier CSV, avec sa recherche, ses filtres et son tri. Les colonnes sont **Zone**, **Reference**, **Name**, **Type**, **Technologies**, **Applications**, **Controls** et **Dependency**. **Dependency** donne, pour **Hôte moins sensible**, chaque actif plus sensible que l'actif fait tourner ou chaque cluster dont il est membre, avec sa zone. Un export contient jusqu'à 10 000 actifs : au-delà, affinez les filtres.

**Exporter les domaines** télécharge chaque domaine avec son suffixe DNS, sa forêt, ses approbations (les siennes et celles déclarées par d'autres domaines), ses nombres de comptes et d'ordinateurs, et ses contrôleurs de domaine.

## Conseils

- **Commencez par le tier 0** : placez d'abord l'annuaire, ses contrôleurs, les hyperviseurs qui les font tourner et les outils qui les administrent. Ce sont les plus exposés.
- **Partez d'un point de contrôle** : cliquez sur **Zone non renseignée**, cochez la case de l'en-tête et affectez la zone en une fois, puis affinez ligne par ligne.
- **Nommez les administrateurs** : le **Groupe d'administrateurs** d'une zone répond à la première question d'un audit : qui détient les droits d'administration ?
- **Vérifiez les contrôleurs** : un domaine sans contrôleur, ou avec un contrôleur inattendu, révèle souvent un serveur dont le domaine, le rôle ou les technologies manquent.
