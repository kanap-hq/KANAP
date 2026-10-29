# Sites

Les sites documentent l'emplacement de votre infrastructure IT : centres de données, régions cloud, salles serveur de bureaux et installations de colocation. Assigner des actifs et des applications à des sites vous donne une visibilité géographique, aide à la planification de capacité et garde les contacts des installations à portée de main lorsque vous en avez besoin.

## Premiers pas

Naviguez vers **Cartographie SI > Sites** pour ouvrir le registre des sites. Cliquez sur **Ajouter un site** pour créer une nouvelle entrée.

**Champs obligatoires** :
- **Code** : Un identifiant court unique (par ex., `DC-EU-WEST`, `AWS-US-EAST-1`)
- **Nom** : Un nom d'affichage descriptif
- **Type d'hébergement** : Le type d'installation (centre de données on-premise, colocation, région cloud, etc.)

**Fortement recommandé** :
- **Pays** : Où le site se trouve géographiquement
- **Fournisseur** ou **Société exploitante** : Qui exploite l'installation

**Conseil** : Utilisez des conventions de nommage cohérentes. Préfixer les sites cloud avec le nom du fournisseur (`AWS-`, `AZURE-`, `GCP-`) les rend faciles à repérer dans les listes et rapports.

---

## Travailler avec la liste

La liste vous donne un aperçu consultable de chaque site enregistré.

**Colonnes par défaut** :
- **Code** : Code du site (cliquez pour ouvrir l'espace de travail)
- **Nom** : Nom d'affichage
- **Type d'hébergement** : On-premise, colocation, cloud public, etc.
- **Fournisseur / Société** : Fournisseur cloud pour les sites de type cloud, ou société exploitante pour les sites on-premise
- **Pays** : Nom du pays et code ISO
- **Ville** : Nom de la ville
- **Actifs** : Nombre d'actifs assignés à ce site
- **Créé** : Date de création de l'enregistrement

**Filtrage** :
- Recherche rapide : Recherche en texte libre sur toutes les lignes
- Filtres de colonnes : Filtres texte sur Code, Nom et Ville ; filtre d'ensemble sur Type d'hébergement

**Actions** :
- **Ajouter un site** : Créer un nouveau site (nécessite `locations:member`)

Vous pouvez également afficher, masquer et réorganiser les colonnes en utilisant le sélecteur de colonnes.

---

## L'espace de travail Sites

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. Il comporte quatre onglets : **Vue d'ensemble**, **Contacts & Support**, **Relations** et **Historique** (les modifications apportées au site, voir [Historique des fiches](record-history.md)). Les onglets Contacts & Support et Relations deviennent disponibles après le premier enregistrement du site.

### Vue d'ensemble

L'onglet Vue d'ensemble capture les informations d'identité et de géographie, divisées en deux sections, plus un panneau de sous-sites.

**Informations de base** :
- **Code** : Identifiant unique (obligatoire)
- **Nom** : Nom d'affichage (obligatoire)
- **Type d'hébergement** : Catégorie d'installation (obligatoire). Les types d'hébergement sont configurables dans **Cartographie SI > Paramètres**.

**Détails du site** : les champs affichés ici dépendent de la catégorie de type d'hébergement :

Pour les types d'hébergement **on-premise** :
- **Société exploitante** : La société qui gère l'installation. La sélection d'une société remplit automatiquement Pays et Ville s'ils sont vides.

Pour les types d'hébergement **cloud** :
- **Fournisseur cloud** : Le fournisseur cloud (par ex., AWS, Azure, GCP)
- **Région** : Région cloud ou zone de disponibilité

Les deux catégories affichent aussi :
- **Pays** : Sélectionné dans la liste des pays ISO
- **Ville** : Nom de la ville
- **Informations complémentaires** : Notes libres sur le site

**Comment ça fonctionne** : Basculer entre un type d'hébergement on-premise et cloud efface les champs qui appartiennent à l'autre catégorie. L'éditeur demande confirmation avant d'effectuer le changement.

#### Sous-sites

Sous le formulaire principal, le panneau **Sous-sites** vous permet de décomposer un site en zones physiques plus petites : bâtiments, salles, racks, cages, ou toute autre subdivision qui a du sens pour votre infrastructure.

Chaque sous-site possède :
- **Nom** : Un libellé court (par ex., « Bâtiment A, Salle 1, Baie 5 »)
- **Description** : Détail supplémentaire optionnel

Les sous-sites sont disponibles dès que le site existe (après avoir cliqué sur **Créer**). Chaque ligne s'enregistre seule lorsque vous quittez le champ, et la suppression d'un sous-site demande d'abord une confirmation.

Les actifs peuvent être assignés à un sous-site spécifique au sein d'un site, ce qui vous permet de suivre exactement où se trouve le matériel. L'onglet Relations montre le sous-site de chaque actif qui en a un.

---

### Contacts & Support

Cet onglet organise les personnes et références associées à un site en trois sections.

**Contacts internes** : Membres de l'équipe de votre organisation liés à ce site. Chaque ligne a un sélecteur **Utilisateur** et un champ **Rôle** en texte libre (par ex., « Resp. Ops », « Responsable sécurité »).

**Contacts externes** : Contacts tiers tirés de vos données de référence Contacts. Chaque ligne a un sélecteur **Contact** et un champ **Rôle** (par ex., « Gestionnaire de compte », « Contact NOC »).

**Sites web pertinents** : Liens utiles comme les portails fournisseur, la documentation des installations ou les pages de statut. Chaque ligne a une **Description** et une **URL**.

Les modifications s'enregistrent automatiquement. L'ajout d'un contact ou d'un lien est enregistré immédiatement, et un rôle, une description ou une URL s'enregistre lorsque vous quittez le champ.

---

### Relations

L'onglet Relations affiche les actifs de ce site et les applications qui tournent dessus, puis les liens web du site. Cliquez sur une ligne pour ouvrir l'actif ou l'application. Le badge de l'onglet compte les actifs et les applications que vous pouvez voir, et les liens web.

| Section | Colonnes |
|---|---|
| **Actifs** | Référence (`AST-12`), nom, sous-site, type, environnement, fournisseur, statut |
| **Applications** | Référence (`APP-3`), nom, environnements, cycle de vie |

**Actifs** liste les actifs placés sur ce site. La colonne **Sous-site** n'apparaît que si au moins un actif a un sous-site. La section est en lecture seule : le site d'un actif se choisit sur l'actif lui-même. Elle demande de pouvoir lire l'infrastructure.

**Applications** liste les applications qui ont une instance sur l'un de ces actifs. **Environnements** affiche les environnements de ces instances. La section est en lecture seule et demande de pouvoir lire les applications. Un Contributeur métier ne voit que les applications auxquelles il participe.

**Liens web** : les liens du site (portails fournisseur, documentation des installations, pages de statut), une ligne chacun avec son nom, le domaine du lien et la date d'ajout. Ce sont les mêmes liens que les **Sites web pertinents** de l'onglet Contacts & Support. Cliquez sur un lien pour l'ouvrir dans un nouvel onglet. Avec `locations:member` :

- **Ajouter un lien** ouvre une boîte de dialogue pour une URL et un nom optionnel ; le lien est enregistré aussitôt. Pour modifier un lien, survolez sa ligne et cliquez sur le crayon.
- Pour retirer un lien, survolez sa ligne et cliquez sur la croix. Un message nomme le lien et propose **Annuler**, qui le recrée.

---

## Supprimer un site

Depuis l'en-tête de l'espace de travail, cliquez sur **Supprimer** (icône corbeille) pour retirer un site.

- Nécessite l'autorisation `locations:member`.
- Les actifs liés ne sont pas supprimés : ils sont automatiquement désassignés (leur référence de site est effacée).
- Si vous avez des modifications non enregistrées dans l'espace de travail, ces modifications sont perdues lors de la suppression.

---

## Types d'hébergement

Les types d'hébergement sont configurables dans **Cartographie SI > Paramètres**. Chaque type appartient à une catégorie qui contrôle quels champs apparaissent dans l'espace de travail.

| Type | Catégorie | Exemple |
|------|-----------|---------|
| Centre de données privé | On-premise | Installation détenue par l'entreprise |
| Colocation | On-premise | Espace loué dans une installation partagée |
| Cloud public | Cloud | AWS, Azure, GCP |
| Cloud privé | Cloud | Plateforme cloud exploitée par l'entreprise |
| Edge | Cloud | Sites de calcul edge |

---

## Autorisations

| Action | Niveau minimum |
|--------|---------------|
| Voir la liste et l'espace de travail | `locations:reader` |
| Créer, modifier ou supprimer un site | `locations:member` |
| Configurer les types d'hébergement et fournisseurs | `settings:admin` |

---

## Conseils

- **Soyez cohérent avec les codes** : Une convention de nommage claire rend les sites faciles à identifier d'un coup d'œil et garde les filtres utiles.
- **Utilisez les sous-sites pour la granularité** : Si un centre de données a plusieurs salles ou racks, modélisez-les comme des sous-sites plutôt que des sites séparés. Cela garde la liste propre tout en suivant le placement physique.
- **Suivez les régions cloud individuellement** : Créez un site par région cloud que vous utilisez, pas juste un par fournisseur.
- **Liez les actifs aux sites** : Cela permet le reporting géographique, la planification de DR et l'analyse d'impact rapide lors des pannes.
- **Documentez les contacts tôt** : Avoir les contacts des installations en dossier avant un incident vous fait gagner un temps précieux quand ça compte le plus.
