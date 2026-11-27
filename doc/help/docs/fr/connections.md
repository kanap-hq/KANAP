# Connexions

Les connexions documentent les chemins réseau de niveau infrastructure entre les serveurs et les entités. Alors que les interfaces décrivent les flux de données logiques entre les applications, les connexions décrivent les routes réseau physiques : quels serveurs communiquent, sur quels protocoles et ports.

## Premiers pas

Naviguez vers **Cartographie SI > Connexions** pour voir votre registre de connexions. Pour créer une connexion :

1. Cliquez sur **Ajouter une connexion**. La page de la connexion s'ouvre avec un titre vide dans l'en-tête. Le titre, la topologie, les endpoints et les protocoles sont ouverts. Le reste de la page est grisé.
2. Saisissez un nom descriptif.
3. Choisissez la **Topologie** dans la barre sous le titre : **Serveur à serveur** ou **Multi-serveur**.
4. Choisissez les **Endpoints** : une source et une destination pour **Serveur à serveur** (chacune un serveur, un cluster ou une entité), ou au moins deux serveurs pour **Multi-serveur**.
5. Ajoutez au moins un protocole réseau sous **Protocoles**.

Vous pouvez les remplir dans l'ordre de votre choix. Rien n'est enregistré tant que le nom, les endpoints et un protocole ne sont pas donnés. Dès qu'ils le sont, Kadratis crée la connexion avec tout ce que vous avez saisi et lui attribue sa référence (`CONN-12`). Le reste de la page s'ouvre, avec les onglets **Chemin** et **Historique**.

**Conseil** : Les connexions peuvent être liées aux liaisons d'interfaces pour montrer quelle infrastructure supporte chaque intégration applicative.

### Créer ou annuler { #cancelling-a-creation }

Tant que la connexion est en cours de création, son en-tête affiche **Créer** et **Annuler**. Ils restent jusqu'à ce que vous quittiez la connexion. **Ctrl+S** agit comme le bouton affiché.

- **Créer** enregistre la connexion quand le brouillon est complet et la laisse ouverte. S'il manque encore quelque chose, rien n'est enregistré : un titre vide affiche son message, le libellé de chaque champ manquant passe en rouge avec une icône d'alerte, et le titre ou le premier champ manquant prend le focus
- Quand Kadratis refuse la connexion, par exemple avec le même actif des deux côtés, le message s'affiche sous le champ concerné. Le brouillon reste tel quel
- Une fois la connexion créée, **Créer** devient **Terminé**. **Terminé** enregistre ce que vous êtes en train de saisir et vous ramène à votre point de départ
- **Annuler** supprime la connexion. Si vous l'avez modifiée après sa création, une confirmation liste ce qui sera supprimé. Vous pouvez annuler votre propre création sans le droit de supprimer des connexions
- Dès qu'une autre personne a modifié la connexion, ou qu'une liaison d'interface ou un document y est lié, **Annuler** est refusé : supprimez plutôt la connexion

Si vous quittez la connexion autrement (le menu, la flèche de retour), elle est conservée : elle est complète.

Avant la création de la connexion, **Annuler**, la flèche de retour ou Échap dans le titre partent sans rien enregistrer. Quand le brouillon contient plus que son nom, une confirmation est demandée avant de l'abandonner. Un lien du menu demande la même chose.

---

## Travailler avec la liste

La liste vous offre une vue filtrable de chaque connexion de votre registre.

**Colonnes par défaut** :
  - **Référence** : La référence de la connexion, par exemple `CONN-12` (cliquez pour ouvrir l'espace de travail)
  - **Nom** : Nom de la connexion (cliquez pour ouvrir l'espace de travail)
  - **Topologie** : Serveur à serveur ou Multi-serveur
  - **Source** / **Destination** : Les points de terminaison connectés
  - **Protocoles** : Protocoles réseau affichés sous forme de pastilles
  - **Criticité** : Importance métier ; peut être dérivée des interfaces liées
  - **Classe de données** : Niveau de sensibilité des données
  - **PII** : Si des données personnelles transitent par cette connexion
  - **Risque** : Manuel ou Dérivé (affiche le nombre d'interfaces liées)
  - **Cycle de vie** : Statut actuel
  - **Créé le** : Date de création de l'enregistrement

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
  - **Serveurs** : Nombre de serveurs dans une connexion multi-serveurs

**Filtrage** :
  - Recherche rapide : Recherche dans les champs de connexion
  - Filtres de colonnes : **Topologie**, **Cycle de vie**, **Criticité**, **Classe de données** et **PII** utilisent des listes à cocher : vous pouvez choisir plusieurs valeurs à la fois. **Criticité** et **Classe de données** proposent aussi **(Vide)** pour les connexions sans valeur
  - **Criticité**, **Classe de données** et **PII** filtrent et trient sur la valeur affichée. Pour une connexion dérivée, c'est la valeur héritée de ses interfaces

**Tri** :
  - **Criticité** et **Classe de données** trient par gravité, dans l'ordre des niveaux définis dans [Classifications et continuité](it-ops-settings.md#classifications-et-continuite). Les connexions sans valeur viennent en dernier

**Actions** :
  - **Ajouter une connexion** : Créer une nouvelle connexion (nécessite `infrastructure:member`)
  - **Supprimer la connexion** : Supprimer les connexions sélectionnées (nécessite `infrastructure:admin`). Les sauts de chaque connexion supprimée sont supprimés avec elle. Leurs serveurs, interfaces et documents sont conservés ; seuls leurs liens avec la connexion sont supprimés. Pour supprimer une seule connexion, ouvrez-la et utilisez **Supprimer** dans son en-tête, ce qui nécessite `infrastructure:member` (voir [L'espace de travail Connexions](#lespace-de-travail-connexions)).

---

## Types de connexion { #connection-types }

### Serveur à serveur

Une connexion directe entre deux extrémités. Chaque côté est un serveur, un cluster ou une entité :

- **Source** : L'origine du trafic
- **Destination** : L'arrivée du trafic
- Un côté porte un seul serveur, cluster ou entité
- La source et la destination ne peuvent pas être le même actif

### Multi-serveur

Une connexion entre plusieurs serveurs, par exemple une réplication entre nœuds ou un maillage. Sélectionnez au moins deux serveurs ou clusters.

### Connexions sur un cluster { #connections-on-a-cluster }

Une source, une destination, un serveur d'une connexion multi-serveur ou l'équipement d'un saut peut être un cluster. La connexion vaut alors pour les membres en service du cluster. Un membre ajouté plus tard la reçoit aussi. Un membre retiré du cluster la perd. Un membre retiré du service ne reçoit rien, et un cluster retiré ne transmet rien.

Les sélecteurs marquent un cluster d'une icône et listent ses membres sous son nom.

Quand vous choisissez un serveur membre d'un cluster, Kadratis demande **Raccorder au cluster ?**. **Raccorder au cluster** pose le cluster sur la connexion, pour tous ses membres. **Ce serveur seulement** garde le serveur. Kadratis ne pose pas la question quand l'autre côté est déjà ce cluster ou un de ses membres : la connexion reste sur le serveur.

Une liste multi-serveur qui contient un cluster et un de ses membres ne garde que le cluster. Un message nomme les membres retirés de la liste. Une liste doit garder au moins deux serveurs.

L'onglet [Réseau](assets.md#network) de chaque membre liste les connexions de ses clusters, et la [carte des connexions](connection-map.md) dessine les membres d'un cluster.

---

## L'espace de travail Connexions

Cliquez sur une ligne pour ouvrir l'espace de travail. Il a trois onglets : **Vue d'ensemble**, **Chemin** et **Historique** (les modifications apportées à la connexion, voir [Historique des fiches](record-history.md)). Le panneau Propriétés, à droite, porte **Cycle de vie**, **Topologie**, **Mode de risque**, **Criticité**, **Classification des données**, **Contient des PII** et **Créé le**. Les modifications s'enregistrent automatiquement.

**Valeurs qui ne sont plus proposées** : le cycle de vie, les protocoles, l'entité de chaque extrémité, ainsi que la fonction, les protocoles et l'entité d'un saut listent les valeurs encore proposées dans les [Paramètres de la Cartographie SI](it-ops-settings.md). Une valeur marquée **Ne plus proposer** reste sur les connexions et les sauts qui l'ont déjà, et ils la gardent quand ils sont enregistrés. Les autres ne peuvent pas la prendre, sur cette page ou par Kad. Un nouveau saut prend les protocoles de la connexion qui sont encore proposés.

**Supprimer**, une icône de corbeille dans l'en-tête, supprime la connexion après confirmation (`infrastructure:member`). La confirmation compte les sauts supprimés avec elle et les liaisons d'interfaces dont elle est détachée. Les interfaces elles-mêmes restent.

### Vue d'ensemble

- **Description** : Pourquoi cette connexion existe et ce qu'elle transporte
- **Endpoints** : La source et la destination, ou les serveurs d'une connexion multi-serveur. Voir [Types de connexion](#connection-types)
- **Protocoles** : Un ou plusieurs protocoles réseau, issus de vos paramètres de types de connexion, avec leurs ports usuels
- **Dérivation du risque** : En mode de risque dérivé, les interfaces dont vient le risque, avec leur criticité, leur classification des données et leurs PII
- **Interfaces associées** : Les liaisons d'interfaces liées à cette connexion. **Associer une existante** en lie une autre

### Chemin

L'onglet Chemin documente le chemin réseau de la connexion, saut par saut : proxys inverses, pare-feu, répartiteurs de charge.

Chaque saut a :

  - Une fonction, par exemple Pare-feu, Proxy inverse ou Répartiteur de charge
  - **Équipement** : Un serveur, un cluster ou une entité, ou rien quand l'équipement n'est pas documenté. Un serveur membre d'un cluster pose la même question qu'une extrémité. Voir [Connexions sur un cluster](#connections-on-a-cluster)
  - **Protocoles (surcharge)** et **Port** : Quand ils diffèrent de ceux de la connexion
  - **Notes**

**Ajouter un saut** ajoute un saut à la fin. Les flèches réordonnent les sauts et la corbeille en retire un. Chaque modification s'enregistre aussitôt.

### Risque

**Mode de risque**, dans le panneau Propriétés :

  - **Manuel** : Vous fixez directement la criticité, la classification des données et les PII
  - **Dérivé** : Les valeurs viennent des liaisons d'interfaces liées. Les champs sont en lecture seule et montrent les valeurs les plus élevées parmi les interfaces liées

**Criticité** utilise les niveaux de [Classifications et continuité](it-ops-settings.md#classifications-et-continuite). Les niveaux par défaut sont Critique, Élevée, Modérée et Faible. **Classification des données** vient de vos paramètres de classification des données.

---

## Conseils

  - **Commencez par les chemins critiques** : Documentez d'abord les connexions de vos applications les plus importantes, puis élargissez.
  - **Utilisez le mode de risque Dérivé** : Laissez le système calculer la criticité à partir des interfaces qui utilisent chaque connexion : cela économise de l'effort et reste à jour lorsque les interfaces changent.
  - **Liez aux interfaces** : Connecter votre infrastructure aux bindings d'interfaces vous donne une traçabilité de bout en bout des flux de données applicatifs jusqu'aux routes réseau.
  - **Documentez les protocoles avec précision** : De bonnes données de protocoles rendent les revues de règles de pare-feu et les audits de sécurité nettement plus faciles.
