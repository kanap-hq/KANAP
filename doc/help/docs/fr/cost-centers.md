# Centres de coûts

Un centre de coûts indique qui porte une ligne budgétaire : l'équipe ou l'unité qui répond de la dépense. Chaque ligne OPEX et CAPEX peut porter un centre de coûts. Les centres de coûts s'organisent en arbre de groupes, ce qui permet de lire le budget d'une direction entière aussi facilement que celui d'une seule équipe.

## Ce qui distingue les centres de coûts des autres données de référence

| Donnée de référence | Question à laquelle elle répond | Sur une ligne budgétaire |
|---|---|---|
| **Sociétés** | Quelle entité juridique paie | La **Société payeuse** |
| **Départements** | Quelles unités d'une société consomment l'IT, avec leur effectif | Utilisés par les ventilations et la refacturation |
| **Centres de coûts** | Qui porte la dépense et en répond | Le **Centre de coûts** |
| **Dimensions analytiques** | Des classifications libres pour le reporting | Un champ par dimension, par exemple **Nature** |

Un département appartient à une seule société et pilote les ventilations par son effectif. Un centre de coûts porte un code, une société, un responsable budgétaire et une place dans un arbre, et les groupes de centres de coûts peuvent couvrir plusieurs sociétés. Les centres de coûts ne modifient ni les ventilations ni la refacturation.

---

## Groupes et centres de coûts

L'arbre contient deux types d'éléments :

- **Groupe** : contient des centres de coûts et d'autres groupes. Un groupe n'a pas de société ; il peut donc rassembler des centres de coûts de plusieurs sociétés. Un groupe ne peut pas être placé sur une ligne budgétaire.
- **Centre de coûts** : appartient à une société et n'a pas d'enfants. Seuls les centres de coûts se placent sur les lignes budgétaires.

Les deux types peuvent se trouver au premier niveau, sans parent. Par exemple :

```
IT division (group)
  Infrastructure (group)
    IT-100  Data centers        Company A
    IT-110  Network             Company B
  IT-200  Business applications  Company A
IT-300  Workplace               Company B
```

Ici, le groupe **IT division** rassemble des centres de coûts de deux sociétés. Filtrer un rapport sur ce groupe couvre IT-100, IT-110 et IT-200.

---

## Premiers pas

Naviguez vers **Données de référence > Centres de coûts** (dans la section **Organisation**) pour ouvrir la liste. Cliquez sur **Nouveau** pour créer votre première entrée.

**Champs obligatoires** :

- **Code** : le code utilisé par votre équipe finance
- **Nom** : le nom sous lequel il est connu
- **Type** : **Groupe** ou **Centre de coûts**
- **Société** : pour un centre de coûts uniquement

**Facultatifs mais utiles** :

- **Groupe parent** : sa place dans l'arbre. Laissez vide pour le premier niveau
- **Responsable budgétaire** : la personne qui rend compte de cette enveloppe budgétaire lors de la revue budgétaire. Chaque ligne OPEX et CAPEX du centre de coûts affiche cette personne
- **Description** : ce que couvre le centre de coûts

**Astuce** : si votre équipe finance tient déjà la liste des centres de coûts, importez-la depuis un fichier CSV. Les lignes peuvent être dans n'importe quel ordre.

---

## Utiliser la liste

Tant que l'espace de travail n'a aucun centre de coûts, une ligne sous le titre l'indique : « Les centres de coûts indiquent qui porte chaque ligne budgétaire. Créez-en un ou importez un fichier. »

**Colonnes** :

- **Code** : le code du centre de coûts
- **Nom** : en retrait selon le niveau lorsque la liste est dans l'ordre de l'arbre
- **Type** : **Groupe** ou **Centre de coûts**
- **Parent** : le groupe auquel il appartient
- **Société** : la société d'un centre de coûts (vide pour un groupe)
- **Responsable budgétaire** : la personne qui rend compte du budget du centre de coûts
- **Statut** : **Activé** ou **Désactivé** (masquée par défaut, ajoutez-la via le sélecteur de colonnes)

Cliquez sur n'importe quelle cellule pour ouvrir l'espace de travail.

**Tri** : la liste s'ouvre dans l'ordre de l'arbre : chaque groupe est suivi de ce qu'il contient. Cliquez sur un en-tête de colonne pour trier sur cette colonne. Le retrait n'apparaît que dans l'ordre de l'arbre.

**Filtres** :

- **Recherche rapide** : recherche dans le code, le nom et le chemin complet. Rechercher le nom d'un groupe trouve aussi tout ce qu'il contient
- **Filtres de colonnes** : **Type**, **Parent**, **Société** et **Statut** utilisent des filtres par cases à cocher
- **Filtre de statut** : le bouton bascule **Tous / Activés / Désactivés** au-dessus de la liste. Par défaut, la liste affiche les éléments activés

**Actions** :

- **Nouveau** : créer un groupe ou un centre de coûts (nécessite `cost_centers:member`)
- **Importer CSV** : charger l'arbre depuis un fichier (nécessite `cost_centers:admin`)
- **Exporter CSV** : télécharger tous les éléments (nécessite `cost_centers:admin`)
- **Supprimer la sélection** : supprimer les éléments sélectionnés (nécessite `cost_centers:admin`). Les éléments qui ne peuvent pas être supprimés sont conservés et listés avec la raison. Le contenu est supprimé avant son groupe : sélectionner un groupe avec tout ce qu'il contient supprime l'ensemble

---

## Créer un centre de coûts

Cliquez sur **Nouveau**. Remplissez les champs, puis cliquez sur **Créer**. Un nouvel élément est activé.

Le **Type** commence sur **Centre de coûts**. Choisissez **Groupe** pour créer un groupe : le champ **Société** disparaît alors.

Après **Créer**, l'espace de travail du nouvel élément s'ouvre.

---

## L'espace de travail du centre de coûts

Cliquez sur n'importe quelle ligne de la liste pour ouvrir l'espace de travail.

- **En-tête** : le code comme référence, avec un bouton de copie, et le nom. Cliquez sur le nom pour le renommer. **Précédent** / **Suivant** parcourent la liste dans son ordre et ses filtres actuels, et le bouton de fermeture ramène à la liste
- **Zone principale** : une ligne comme « Utilisé par 3 lignes OPEX et 1 ligne CAPEX. » lorsque des lignes budgétaires utilisent l'élément, puis la **Description**
- **Panneau Propriétés** à droite : **Code**, **Type**, **Groupe parent**, **Société** (centres de coûts uniquement), **Responsable budgétaire** et **Cycle de vie**

**Enregistrement automatique** : chaque modification s'enregistre d'elle-même. Il n'y a pas de bouton Enregistrer. Les champs texte s'enregistrent quand vous les quittez (appuyez sur Entrée dans **Code** pour enregistrer aussitôt) ; les listes et les interrupteurs s'enregistrent dès que vous choisissez une valeur. Vous pouvez continuer à travailler pendant l'enregistrement. Lorsqu'une modification est refusée, la raison s'affiche sous le champ concerné, par exemple un code en double sous **Code**. Un nom refusé s'affiche en haut de la page.

### Champs

| Champ | Ce qu'il faut saisir | Où trouver cette valeur |
|---|---|---|
| **Code** | Jusqu'à 50 caractères. Les codes sont uniques sans tenir compte de la casse : `IT-100` et `it-100` sont le même code | Le code utilisé par votre équipe finance pour ce centre de coûts, tel qu'il figure dans votre système comptable ou votre référentiel budgétaire |
| **Nom** | Jusqu'à 200 caractères | Le nom utilisé dans vos revues budgétaires |
| **Type** | **Groupe** ou **Centre de coûts** | Un groupe rassemble ; un centre de coûts se place sur les lignes budgétaires |
| **Groupe parent** | Un groupe, ou vide pour le premier niveau. Un élément ne peut pas passer sous lui-même ni sous un élément qu'il contient ; ceux-ci ne figurent donc pas dans la liste | Votre organigramme ou l'arbre des centres de coûts de votre équipe finance |
| **Société** | Une société activée. Centres de coûts uniquement | L'entité juridique qui paie les coûts de ce centre de coûts. C'est l'une de vos sociétés dans **Données de référence > Sociétés** |
| **Responsable budgétaire** | Un utilisateur actif | La personne qui rend compte de cette enveloppe budgétaire lors de la revue budgétaire. L'indication sous le champ le rappelle |
| **Cycle de vie** | L'interrupteur **Activé** et la date de **Fin de validité** | Fixez une date future pour programmer la fin, ou désactivez l'interrupteur pour le désactiver dès aujourd'hui |

### Responsable budgétaire sur les lignes budgétaires

Chaque ligne OPEX et CAPEX qui a un centre de coûts affiche le responsable budgétaire de ce centre de coûts dans sa barre de métadonnées, après **Responsable IT** et **Responsable métier**. Survolez-le pour voir de quel centre de coûts il provient.

- **Lu depuis le centre de coûts** : le responsable budgétaire n'est pas enregistré sur la ligne. Modifiez-le ici et chaque ligne du centre de coûts affiche aussitôt la nouvelle personne. Il ne change sur une ligne que lorsque vous changez le centre de coûts de la ligne.
- **Affiché seulement s'il est renseigné** : une ligne sans centre de coûts, ou dont le centre de coûts n'a pas de responsable budgétaire, n'affiche rien.
- **Un rôle distinct** : le **Responsable IT** et le **Responsable métier** d'une ligne restent tels quels, définis sur chaque ligne. Ils couvrent aussi les espaces de travail qui n'utilisent pas de centres de coûts.
- **Dans les listes** : les listes OPEX et CAPEX ont une colonne **Responsable budgétaire**, masquée par défaut, avec un filtre par cases à cocher.

### Changer le type

- **De centre de coûts à groupe** : la société est retirée. C'est refusé tant que des lignes budgétaires utilisent le centre de coûts.
- **De groupe à centre de coûts** : choisissez **Centre de coûts** dans **Type**, puis choisissez la société. Le changement s'enregistre une fois la société renseignée. Un groupe qui contient des éléments ne peut pas devenir un centre de coûts : **Type** ne le propose donc pas.

### Supprimer

Le bouton **Supprimer** de l'en-tête supprime l'élément immédiatement (nécessite `cost_centers:admin`). Il est désactivé, avec la raison sur une ligne, lorsque des lignes budgétaires utilisent le centre de coûts (par exemple « Utilisé par 3 lignes OPEX. Désactivez-le plutôt. ») ou lorsque le groupe contient encore des éléments (par exemple « Contient 2 éléments. »). Désactivez plutôt l'élément : il reste sur ses lignes et dans les rapports.

---

## Les règles que vous rencontrerez

- **Un centre de coûts utilisé par des lignes budgétaires ne peut ni devenir un groupe ni être supprimé.** Désactivez-le plutôt. Le message indique les lignes, par exemple « IT-300 is used by 3 OPEX lines and 1 CAPEX line. Disable it instead. »
- **Un groupe qui contient des éléments ne peut ni être supprimé ni devenir un centre de coûts.** Déplacez ou supprimez d'abord son contenu. Le message donne le nombre, par exemple « Infrastructure still contains 4 nodes. Move or delete them first. »
- **Seul un groupe peut être parent.** Un centre de coûts n'a pas d'enfants.
- **Pas de boucle.** Un groupe ne peut pas passer sous lui-même ni sous l'un de ses propres groupes.
- **Les éléments désactivés restent en place.** Un centre de coûts désactivé reste sur les lignes budgétaires qui l'ont déjà et continue de compter dans les rapports. Dans les listes de choix, il est marqué **Désactivé** et ne peut pas être choisi pour une nouvelle ligne. Désactiver un groupe ne change pas son contenu, et un groupe désactivé peut encore recevoir des éléments.
- **Les codes sont uniques sans tenir compte de la casse.** Un code en double est refusé : « A cost center with code IT-100 already exists. »
- **Renommer un code conserve les lignes.** Les lignes budgétaires pointent vers le centre de coûts lui-même : un nouveau code ne change rien pour elles. Après le renommage, les listes et les rapports affichent le nouveau code. La modification est enregistrée dans le journal d'audit.
- **Une société désactivée ou un utilisateur inactif ne peuvent pas être choisis** pour un centre de coûts.
- **Une société à laquelle appartiennent des centres de coûts ne peut pas être supprimée.** Changez leur société, ou désactivez plutôt la société.

---

## Les centres de coûts sur les lignes budgétaires

- **OPEX et CAPEX** : le champ **Centre de coûts** du panneau **Propriétés** présente l'arbre. Les groupes s'affichent pour vous aider à vous repérer et ne peuvent pas être choisis. Lorsque vous créez une ligne et que la société payeuse est vide, choisir un centre de coûts la remplit avec la société du centre de coûts, et la société suit le centre de coûts jusqu'à ce que vous choisissiez vous-même une société ou un compte. Lorsque les deux sociétés diffèrent, les deux sont conservées et une indication le signale. Voir [OPEX](opex.md) et [CAPEX](capex.md).
- **Listes** : les colonnes et filtres **Centre de coûts** et **Run ou build** des listes OPEX et CAPEX.
- **Rapports** : les rapports budgétaires peuvent être filtrés sur un centre de coûts ou un groupe. Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](reports.md#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques).

---

## Import/export CSV

Chargez ou mettez à jour l'arbre entier depuis un fichier.

**Export** : cliquez sur **Exporter CSV**, puis sur **Exporter les données**. Le fichier liste tous les éléments, activés ou désactivés, dans l'ordre de l'arbre. Pour un fichier vide avec les seuls en-têtes, utilisez **Télécharger le modèle** dans la boîte de dialogue d'import.

**Structure du CSV** :

- Séparateur : point-virgule `;`
- Encodage : UTF-8 (enregistrez au format « CSV UTF-8 » dans Excel)
- En-têtes : `code;kind;name;parent_code;company_name;owner_email;description;status;disabled_at`

| Colonne | Contenu |
|---|---|
| `code` | Obligatoire. Le code de l'élément. Les lignes sont rapprochées des éléments existants par code, sans tenir compte de la casse |
| `kind` | Obligatoire. `group` ou `cost_center` |
| `name` | Obligatoire |
| `parent_code` | Le code du groupe parent, présent dans le même fichier ou déjà dans KANAP. Vide pour le premier niveau |
| `company_name` | Obligatoire pour un `cost_center`, vide pour un `group`. Rapproché par nom de société, sans tenir compte de la casse |
| `owner_email` | L'e-mail du responsable budgétaire, un utilisateur actif. Vide pour aucun responsable budgétaire |
| `description` | Texte libre |
| `status` | `enabled` ou `disabled`. Vide signifie `enabled` |
| `disabled_at` | Colonne facultative. La fin de validité : une date (`2026-12-31`) ou une date et une heure complètes. Vide s'il n'y a pas de fin |

**Import** :

1. Cliquez sur **Importer CSV** dans la liste
2. Choisissez votre fichier
3. Cliquez sur **Vérification préalable**. Le rapport donne le nombre de lignes, les éléments à créer et à mettre à jour, et les lignes qui ne changent rien
4. Si la vérification préalable est sans erreur, cliquez sur **Charger**

**Fonctionnement de l'import** :

- **Lignes dans n'importe quel ordre** : un enfant peut précéder son groupe parent. Les parents sont résolus sur l'ensemble du fichier et sur les éléments déjà présents dans KANAP.
- **Le fichier entier est vérifié avant toute écriture** : chaque ligne, puis les parents, puis les règles de l'arbre (un centre de coûts a une société, un groupe n'en a pas, seuls les groupes sont parents, pas de boucle, un centre de coûts utilisé par des lignes reste un centre de coûts). Un fichier comportant une erreur ne charge rien : corrigez les lignes et relancez la vérification préalable.
- **Rapprochement par code** : une ligne dont le code existe met à jour cet élément ; toute autre ligne en crée un. Chaque cellule remplace la valeur enregistrée : un `owner_email` ou une `description` vide l'efface.
- **Lignes inchangées** : une ligne identique à l'élément enregistré ne change rien. Exporter puis importer le même fichier signale toutes les lignes comme inchangées.
- **Les éléments absents du fichier** restent tels quels. L'import ne supprime jamais rien.

**Erreurs courantes** :

- **« Unknown company '...' »** : créez la société dans **Données de référence > Sociétés**, ou corrigez le nom.
- **« Unknown parent code '...' »** : ajoutez le groupe parent au fichier, ou corrigez le code.
- **« Unknown budget holder email '...'. »** ou **« Budget holder '...' is not an active user. »** : la cellule `owner_email` désigne le responsable budgétaire. Utilisez l'e-mail d'un utilisateur actif, ou laissez la cellule vide.
- **« Code ... is already used on row N. »** : deux lignes portent le même code. Gardez-en une.
- **« Type must be 'group' or 'cost_center'. »** : corrigez la cellule `kind`.
- **« Header mismatch »** : téléchargez un nouveau modèle.

---

## Permissions

| Niveau | Ce qu'il permet |
|---|---|
| `cost_centers:reader` | Consulter la liste et ouvrir les centres de coûts |
| `cost_centers:member` | Créer des centres de coûts et des groupes, et les modifier |
| `cost_centers:admin` | Tout ce qui précède, plus l'import et l'export CSV, et la suppression |

Chaque rôle reçoit le niveau qu'il a sur les départements, sauf le rôle intégré Administrateur budget, qui reçoit admin. Ainsi, Administrateur budget et Administrateur données de référence sont admins, Membre budget et Membre données de référence sont membres, et les rôles lecteurs peuvent consulter. Toute personne qui peut consulter les OPEX, les CAPEX ou les rapports peut choisir un centre de coûts sur une ligne ou dans un filtre de rapport sans accès à cette page.

---

## Astuces

- **Reprenez votre référentiel finance** : utilisez les mêmes codes que votre système comptable pour que les lignes budgétaires et le réel concordent.
- **Groupez par responsabilité** : construisez les groupes autour des personnes qui répondent du budget, entre plusieurs sociétés si besoin.
- **Désactivez plutôt que supprimer** : quand un centre de coûts ferme, désactivez-le. Ses lignes le conservent et les rapports restent cohérents.
- **Nommez un responsable budgétaire** : un responsable budgétaire sur chaque centre de coûts s'affiche sur chacune de ses lignes, afin que chacun sache à qui s'adresser au sujet d'une ligne.
