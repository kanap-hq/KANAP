# Vue de l'administration

La Vue de l'administration montre qui administre quoi. Elle liste vos zones d'administration avec les actifs qu'elles couvrent, puis vos domaines avec leur forêt, leurs approbations et leurs contrôleurs de domaine, puis les points à corriger. Elle suit la vue de l'administration du guide de cartographie du système d'information de l'ANSSI, et aide à répondre aux questions d'une revue NIS2 sur les accès à privilèges.

Ouvrez-la depuis **Cartographie SI > Vue de l'administration**, dans le groupe **Infrastructure**. Il faut `infrastructure:reader`.

## Avant de commencer

La vue lit ce que vous saisissez ailleurs :

1. Définissez vos zones d'administration et complétez vos domaines dans **Cartographie SI > Paramètres**. Mettez les zones dans l'ordre : la première est la plus sensible. Voir [Zones d'administration](it-ops-settings.md#zones-dadministration) et [Domaines](it-ops-settings.md#domaines).
2. Placez chaque actif dans sa zone avec le champ **Zone d'administration** de son tiroir des propriétés. Voir [Actifs](assets.md#tiroir-des-proprietes-panneau-de-droite).
3. Liez les technologies d'annuaire, comme Active Directory, aux serveurs qui les portent. Voir [Lier une technologie à un serveur](technologies.md#lier-une-technologie-a-un-serveur).
4. Un service d'annuaire qui ne tourne sur aucun de vos serveurs, comme Entra ID, prend sa zone dans le champ **Zone d'administration** de son panneau de propriétés. Voir [Technologies](technologies.md#panneau-de-proprietes).

## Pourquoi les zones comptent

Dans le modèle en tiers de l'ANSSI, tout ce qui peut agir sur un élément d'une zone sensible fait partie de cette zone. L'hyperviseur qui fait tourner un contrôleur de domaine peut en prendre le contrôle : il relève donc lui aussi du tier 0. Les points de contrôle en bas de la page trouvent les actifs qui enfreignent cette règle.

## Zones d'administration

Un bloc par zone, dans l'ordre des paramètres, avec le nombre de ses actifs. Chaque bloc montre :

- Le **Groupe d'administrateurs** de la zone et sa description.
- Son périmètre : le nombre d'actifs de chaque type, et le nombre d'applications hébergées sur ces actifs. Seules les applications et les instances en service comptent.
- Un tableau de ses actifs : **Réf.**, **Nom** et **Type**. Cliquez sur une ligne pour ouvrir l'actif.
- **Services d'annuaire** : les technologies de la famille **Annuaire et identité** placées dans la zone. Cliquez sur une ligne pour ouvrir la technologie.

Les actifs retirés et les technologies retirées sont écartés. Une zone marquée **Ne plus proposer** dans les paramètres reste affichée tant que des actifs ou des services d'annuaire y sont placés. Une zone supprimée des paramètres alors que des actifs ou des services d'annuaire la nomment encore s'affiche après les autres comme **Zone inconnue**, avec son code.

Si aucune zone n'existe encore, la page le dit et, si vous pouvez lire les paramètres, renvoie vers eux.

## Domaines

Une ligne par domaine, sauf les entrées intégrées **Workgroup** et **N/A** :

| Colonne | Ce qu'elle montre |
|---|---|
| **Domaine** | Le nom du domaine. Un domaine qui n'est plus proposé est marqué comme tel |
| **Suffixe DNS** | Le suffixe du nom de ses machines |
| **Forêt** | La forêt Active Directory à laquelle il appartient |
| **Approbations** | Les domaines avec lesquels il a une relation d'approbation, et le sens de chacune |
| **Comptes**, **Machines** | Les nombres saisis dans les paramètres |
| **Contrôleurs de domaine** | Les serveurs déduits comme contrôleurs du domaine |

**Approbations** liste aussi, en lecture seule, les approbations déclarées sur un autre domaine envers celui-ci, avec le sens vu depuis ce domaine : une approbation sortante de A vers B se lit entrante sur B. Les sens signifient :

- **Sortante** : ce domaine approuve l'autre. Les comptes de l'autre domaine peuvent accéder aux ressources de celui-ci.
- **Entrante** : l'autre domaine approuve celui-ci.
- **Bidirectionnelle** : les deux.

Les **Contrôleurs de domaine** ne se saisissent pas à la main. KANAP prend les serveurs du domaine (le champ **Domaine** de l'onglet Technique de l'actif) qui ne sont pas retirés et qui, au choix :

- portent une technologie de la famille **Annuaire et identité** qui n'est pas retirée, comme Active Directory ;
- sont affectés avec le rôle de serveur **Contrôleur de domaine** à une application en service.

Chaque serveur n'apparaît qu'une fois. « Aucun trouvé » signifie qu'aucun serveur du domaine ne remplit l'une ou l'autre règle.

## Points de contrôle

Les points de contrôle listent ce qu'il faut corriger. La première zone des paramètres qui n'est pas marquée **Ne plus proposer** est la zone la plus sensible, et la page la nomme. Chaque point de contrôle affiche son nombre et un tableau. Cliquez sur une ligne pour ouvrir la fiche à corriger.

| Point de contrôle | Ce qu'il liste |
|---|---|
| **Actifs sans zone d'administration** | Les actifs qui ne sont pas retirés et n'ont pas de zone |
| **Contrôleurs de domaine hors de la zone la plus sensible** | Les actifs affectés avec le rôle de serveur **Contrôleur de domaine** à une application en service, quand leur zone est une autre |
| **Actifs portant un service d'annuaire hors de la zone la plus sensible** | Les actifs sur lesquels une technologie d'annuaire est installée, comme Active Directory, quand leur zone est une autre |
| **Actifs dans une zone plus sensible que ce qui les contient** | Un actif dans une zone plus sensible que l'actif qui le contient (une machine virtuelle et son hôte, par exemple), ou un membre de cluster dans une zone plus sensible que son cluster. La ligne ouvre le contenant ou le cluster : placez-le dans une zone au moins aussi sensible |
| **Applications hébergées dans la zone la plus sensible** | Chaque application hébergée sur un actif de cette zone, avec l'actif. Vérifiez qu'elle y a sa place |

Pour ce contrôle de la confiance, KANAP lit les relations **Contient** des actifs et les membres des clusters. Une paire dont l'un des deux actifs n'a pas de zone est écartée : le premier point de contrôle la signale déjà.

Sans aucune zone dans les paramètres, seul le premier point de contrôle s'exécute, et la page vous invite à ajouter une zone.

## Export

**Exporter les zones** et **Exporter les domaines** téléchargent chaque liste en fichier CSV.

Le fichier des zones a une colonne **Record** qui indique la nature de chaque ligne :

- **zone** : une ligne par zone, avec son groupe d'administrateurs, sa description, son nombre d'applications hébergées et, dans **Note**, son nombre d'actifs de chaque type.
- **asset** et **directory** : les actifs et les services d'annuaire de la zone nommée dans **Zone**.
- **control** : une ligne par constat des points de contrôle, avec le titre du point de contrôle dans **Zone**. **Note** donne la zone de l'actif, l'actif contenu pour le contrôle de la confiance, ou l'actif hébergeur pour une application. Un point de contrôle sans constat n'a pas de ligne.

## Conseils

- **Commencez par le tier 0** : placez d'abord l'annuaire, ses contrôleurs, les hyperviseurs qui les font tourner et les outils qui les administrent. Ce sont les plus exposés.
- **Nommez les administrateurs** : le **Groupe d'administrateurs** d'une zone répond à la première question d'un audit : qui détient les droits d'administration ?
- **Vérifiez les contrôleurs** : un domaine sans contrôleur, ou avec un contrôleur inattendu, révèle souvent un serveur dont le domaine, le rôle ou les technologies manquent.
