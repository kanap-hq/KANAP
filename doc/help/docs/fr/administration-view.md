# Vue de l'administration

La Vue de l'administration montre qui administre quoi. Elle liste vos zones d'administration avec leurs technologies et leurs serveurs, puis vos domaines avec leur forêt, leurs approbations et leurs contrôleurs de domaine. Elle suit la vue de l'administration du guide de cartographie du système d'information de l'ANSSI, et aide à répondre aux questions d'une revue NIS2 sur les accès à privilèges.

Ouvrez-la depuis **Cartographie SI > Vue de l'administration**, dans le groupe **Infrastructure**. Il faut `infrastructure:reader`.

## Avant de commencer

La vue lit ce que vous saisissez ailleurs :

1. Définissez vos zones d'administration et complétez vos domaines dans **Cartographie SI > Paramètres**. Voir [Zones d'administration](it-ops-settings.md#zones-dadministration) et [Domaines](it-ops-settings.md#domaines).
2. Placez chaque technologie dans sa zone avec le champ **Zone d'administration** de son panneau de propriétés. Voir [Technologies](technologies.md#panneau-de-proprietes).
3. Liez les technologies aux serveurs qui les portent. Voir [Lier une technologie à un serveur](technologies.md#lier-une-technologie-a-un-serveur).

## Zones d'administration

Un bloc par zone, par nom. Chaque bloc montre :

- Le **Groupe d'administrateurs**, le **Niveau de privilèges** et les **Secrets** (l'endroit où ses secrets sont conservés) de la zone.
- **Services d'annuaire** : les technologies de la famille **Annuaire et identité** placées dans la zone.
- Un tableau de ses technologies : **Réf.**, **Technologie**, **Famille** et **Serveurs**. Les serveurs sont ceux qui portent la technologie, directement ou par le serveur dans lequel ils tournent (« via » ce serveur).

Les technologies sans zone viennent en dernier, sous **Sans zone**. Un avertissement en haut de la page les compte : ouvrez chacune et renseignez sa zone.

Les technologies retirées et les serveurs retirés sont écartés. Une zone marquée **Ne plus proposer** dans les paramètres reste affichée tant que des technologies y sont placées. Une zone supprimée des paramètres alors que des technologies la nomment encore s'affiche comme **Zone inconnue**, avec son code.

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

## Export

**Exporter les zones** et **Exporter les domaines** téléchargent chaque liste en fichier CSV.

## Conseils

- **Commencez par le tier 0** : placez d'abord l'annuaire, ses contrôleurs et les outils qui les administrent. Ce sont les plus exposés.
- **Nommez les secrets** : l'**Emplacement des secrets** d'une zone répond à la première question d'un audit : où sont conservés les mots de passe d'administration ?
- **Vérifiez les contrôleurs** : un domaine sans contrôleur, ou avec un contrôleur inattendu, révèle souvent un serveur dont le domaine ou les technologies manquent.
