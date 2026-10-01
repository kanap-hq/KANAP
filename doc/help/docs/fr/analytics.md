# Dimensions analytiques

Les dimensions analytiques classent votre budget IT pour le reporting, en dehors de votre structure comptable. Vous choisissez vos propres façons de lire le budget, comme la nature de la dépense ou le programme qu'elle sert, sans retravailler les sociétés, les départements, les comptes ou les centres de coûts.

## Dimensions et valeurs

Une **dimension** est une façon de classer les lignes budgétaires, par exemple **Nature** ou **Program**. Ses **valeurs** sont les choix qu'elle propose, par exemple **Licenses**, **Cloud** et **Services** pour Nature.

- Chaque dimension a sa propre liste de valeurs.
- Chaque ligne OPEX et CAPEX peut porter une valeur par dimension. Une ligne peut être **Licenses** sur Nature et **Workplace** sur Program en même temps.
- Une ligne peut aussi n'avoir aucune valeur sur une dimension. Les rapports affichent ces lignes comme « Non affecté ».

Par exemple :

```
Nature          Program
  Licenses        Workplace
  Cloud           ERP
  Services        Security
```

### La dimension par défaut

Chaque espace de travail commence avec une dimension, la dimension par défaut. Tant que vous ne lui donnez pas de nom, elle s'affiche comme **Dimension analytique**, dans la langue de chaque personne. Si votre espace de travail avait déjà des valeurs analytiques, elles appartiennent à cette dimension et chaque ligne conserve sa valeur.

La dimension par défaut a un rôle particulier :

- Elle ne peut être ni désactivée ni supprimée. Son espace de travail n'a pas de bouton **Supprimer**, et une ligne sous **Cycle de vie** en donne la raison : « Cette dimension ne peut être ni désactivée ni supprimée : les anciens fichiers et les questions posées à l'IA l'utilisent. »
- Les anciens fichiers CSV et les questions posées à Plaid sur la catégorie analytique l'utilisent. Voir [Import/export CSV](#importexport-csv) et [Dimensions analytiques dans Plaid](#dimensions-analytiques-dans-plaid).
- Elle reste la dimension par défaut quand vous la renommez, changez son code ou changez son ordre.
- Son libellé est réservé : aucune autre dimension ne peut s'appeler « Dimension analytique », dans aucune des langues de l'application.

---

## Premiers pas

Naviguez vers **Données de référence > Dimensions analytiques** (dans la section **Classification**).

1. **Nommez la dimension par défaut** si « Dimension analytique » ne vous convient pas : cliquez sur le bouton de modification à côté de sa pastille, puis saisissez un nom dans son espace de travail, par exemple **Nature**.
2. **Ajoutez ses valeurs** : cliquez sur **Nouvelle valeur**.
3. **Ajoutez une dimension** lorsque vous avez besoin d'une autre façon de lire le budget : cliquez sur **Nouvelle dimension**, puis ajoutez ses valeurs.

**Astuce** : commencez avec une ou deux dimensions et 5 à 10 valeurs chacune. Un nommage cohérent rend les listes plus faciles à parcourir.

---

## La page Dimensions analytiques

### Les pastilles de dimension

Sous le titre, une ligne de pastilles affiche vos dimensions dans l'ordre. Une dimension désactivée est marquée **Désactivé**.

- Cliquez sur une pastille pour lister les valeurs de cette dimension. L'adresse de la page conserve votre choix : un lien enregistré en favori s'ouvre sur la même dimension. Sans choix, la page s'ouvre sur la dimension par défaut.
- La pastille sélectionnée a un bouton de modification (icône crayon). Cliquez dessus pour ouvrir l'espace de travail de la dimension.
- **Nouvelle dimension**, en fin de ligne, crée une dimension (nécessite `analytics:member`).

Avec une seule dimension, la page affiche une pastille et ses valeurs.

### Liste des valeurs

La liste affiche les valeurs de la dimension sélectionnée.

**Colonnes** :

| Colonne | Ce qu'elle affiche |
|---|---|
| **Nom** | Le nom de la valeur |
| **Description** | Ce que couvre la valeur |
| **Statut** | **Activé** ou **Désactivé** |
| **Mis à jour** | Date et heure de la dernière modification |

Cliquez sur n'importe quelle cellule pour ouvrir l'espace de travail de la valeur.

**Filtres** :

- **Recherche rapide** : recherche dans le nom et la description
- **Filtre de statut** : un filtre par cases à cocher sur la colonne **Statut**. Cliquer sur **Effacer** dans ce filtre, ou décocher les deux valeurs, n'affiche plus rien, quel que soit le choix de **Afficher**
- **Portée du statut** : le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la liste. Par défaut, la liste affiche les valeurs activées

**Actions** :

- **Nouvelle valeur** : créer une valeur dans la dimension sélectionnée (nécessite `analytics:member`). Tant que la dimension sélectionnée est désactivée, le bouton est désactivé et son info-bulle indique « Activez cette dimension pour ajouter des valeurs. »
- **Importer CSV** : charger des valeurs depuis un fichier (nécessite `analytics:admin`)
- **Exporter CSV** : télécharger les valeurs de toutes les dimensions (nécessite `analytics:admin`)
- **Supprimer la sélection** : supprimer les valeurs sélectionnées (nécessite `analytics:admin`). Les valeurs utilisées par des lignes budgétaires sont conservées

---

## Dimensions

### Créer une dimension

Cliquez sur **Nouvelle dimension**, remplissez les champs, puis cliquez sur **Créer**. L'espace de travail de la nouvelle dimension s'ouvre. Une nouvelle dimension est activée.

- Le **Nom** est obligatoire.
- Le **Code** est proposé à partir du nom : en minuscules, sans accents, les espaces remplacés par `-`. Vous pouvez le modifier avant de créer la dimension.
- L'**Ordre** est proposé pour que la nouvelle dimension arrive en dernier.
- La **Description** est facultative.

Revenez ensuite à la page pour ajouter les valeurs de la nouvelle dimension.

### L'espace de travail de la dimension

Ouvrez-le avec le bouton de modification de la pastille sélectionnée.

- **En-tête** : le nom de la dimension. Cliquez dessus pour renommer la dimension. **Précédent** / **Suivant** parcourent les dimensions dans leur ordre, et le bouton de fermeture ramène à la page sur cette dimension
- **Zone principale** : une ligne d'utilisation, par exemple « 12 valeurs. Utilisation : 27 lignes OPEX et 2 lignes CAPEX. », puis la **Description**
- **Panneau Propriétés** à droite : **Nom**, **Code**, **Ordre** et **Cycle de vie**

**Enregistrement automatique** : chaque modification s'enregistre d'elle-même. Il n'y a pas de bouton Enregistrer. Les champs texte s'enregistrent quand vous les quittez (dans **Nom**, **Code** et **Ordre**, appuyez sur Entrée pour enregistrer aussitôt) ; le cycle de vie s'enregistre dès que vous le modifiez. Lorsqu'une modification est refusée, la raison s'affiche sous le champ concerné, par exemple un code en double sous **Code**. Un nom refusé dans l'en-tête s'affiche en haut de la page.

### Champs de la dimension

| Champ | Ce qu'il faut saisir |
|---|---|
| **Nom** | Jusqu'à 200 caractères. Les noms sont uniques sans tenir compte de la casse. Obligatoire, sauf sur la dimension par défaut : laissez-le vide pour afficher « Dimension analytique » dans la langue de chaque personne. Le libellé de la dimension par défaut est réservé dans toutes les langues de l'application (« Analytics dimension », « Dimension analytique », « Analysedimension », « Dimensión analítica »), sans tenir compte de la casse : une autre dimension qui porte l'un de ces noms est refusée avec « This name is reserved for the default dimension. » |
| **Code** | De 1 à 40 caractères : lettres minuscules, chiffres, `-` ou `_`, en commençant par une lettre ou un chiffre. Chaque code est unique. Le code nomme la colonne de la dimension dans les fichiers CSV OPEX et CAPEX : le modifier change donc le nom de cette colonne. Les lignes budgétaires conservent leurs valeurs quand le code change |
| **Ordre** | Un nombre entier. Les dimensions sont classées selon ce nombre, du plus petit au plus grand : sur cette page, sur les lignes budgétaires, dans les filtres des rapports et dans le sélecteur de dimension du rapport |
| **Description** | À quoi sert la dimension, pour que vos collègues classent les lignes de la même façon |
| **Cycle de vie** | L'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité**. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie). Verrouillé sur la dimension par défaut, avec une ligne en dessous : « Cette dimension ne peut être ni désactivée ni supprimée : les anciens fichiers et les questions posées à l'IA l'utilisent. » |

### Supprimer une dimension

Le bouton **Supprimer** de l'en-tête supprime la dimension immédiatement (nécessite `analytics:admin`). Tant que la dimension a encore des valeurs, le bouton est désactivé et une ligne sous la ligne d'utilisation en donne la raison : « Pour supprimer cette dimension, supprimez d'abord ses valeurs. »

La dimension par défaut n'a pas de bouton **Supprimer** : elle ne peut pas être supprimée.

Pour conserver plutôt les valeurs sur les lignes, désactivez la dimension.

---

## Valeurs

### Créer une valeur

Cliquez sur **Nouvelle valeur**. Le champ **Dimension** commence sur la dimension sélectionnée sur la page et ne propose que les dimensions activées. Saisissez le **Nom**, et une **Description** si vous le souhaitez, puis cliquez sur **Créer**. L'espace de travail de la nouvelle valeur s'ouvre. Une nouvelle valeur est activée.

### L'espace de travail de la valeur

- **En-tête** : le nom de la valeur. Cliquez dessus pour renommer la valeur. **Précédent** / **Suivant** parcourent les valeurs de la même dimension, dans l'ordre et avec les filtres actuels de la liste. Le bouton de fermeture ramène à la liste
- **Zone principale** : une ligne comme « Utilisée par 3 lignes OPEX et 1 ligne CAPEX. » lorsque des lignes budgétaires utilisent la valeur, puis la **Description**
- **Panneau Propriétés** à droite : **Dimension** (en lecture seule) et **Cycle de vie**

Les modifications s'enregistrent d'elles-mêmes, comme dans l'espace de travail de la dimension. Un nom refusé dans l'en-tête s'affiche en haut de la page.

### Règles des valeurs

- **Une liste par dimension** : les noms sont uniques au sein d'une dimension, sans tenir compte de la casse. Deux dimensions peuvent chacune avoir une valeur appelée « Other ». Un doublon est refusé, par exemple « A value named Licenses already exists in Nature. »
- **Une valeur reste dans sa dimension** : la dimension est fixée à la création de la valeur et ne peut pas changer. Pour déplacer une valeur, créez-la dans l'autre dimension, modifiez les lignes, puis supprimez l'ancienne valeur.
- **Renommer conserve les lignes** : les lignes pointent vers la valeur elle-même, le nouveau nom s'affiche donc aussitôt dans les listes et les rapports.
- **Supprimer** : le bouton **Supprimer** de l'en-tête supprime la valeur immédiatement (nécessite `analytics:admin`). Il est désactivé lorsque des lignes budgétaires utilisent la valeur, avec la raison, par exemple « Utilisée par 3 lignes OPEX et 1 ligne CAPEX. Désactivez-la plutôt. » Retirez d'abord la valeur de ces lignes, ou désactivez-la.

---

## Statut et cycle de vie

Les dimensions et les valeurs ont chacune un statut (**Activé** ou **Désactivé**) et une **Fin de validité** facultative. Ils permettent de retirer une dimension ou une valeur sans la supprimer.

- **Fin de validité** : la date à laquelle elle s'arrête. Laissez-la vide pour qu'elle reste active. Vous pouvez aussi programmer une date future.
- Passer à **Désactivé** sans date fixe la fin de validité à aujourd'hui. Repasser à **Activé** efface la date.
- Une fois la fin de validité passée, le statut passe à **Désactivé** de lui-même dans l'heure.

**Une valeur désactivée** :

- Ne peut pas être choisie pour une ligne, dans l'application, dans un fichier CSV ou via Plaid.
- Reste sur les lignes qui l'ont déjà et continue de compter dans les rapports. Dans la liste du champ, elle est marquée **Désactivé**.

**Une dimension désactivée** :

- Disparaît des formulaires des postes, des listes OPEX et CAPEX, des filtres des rapports, du sélecteur de dimension du rapport, des exports CSV OPEX et CAPEX et de Plaid. Seule la page Dimensions analytiques l'affiche, marquée **Désactivé**.
- Conserve ses valeurs sur les lignes. Réactivez la dimension et elles s'affichent de nouveau.
- Ne reçoit plus de nouvelles valeurs. **Nouvelle valeur** est désactivé tant que la dimension est sélectionnée, et les fichiers CSV ne peuvent ni ajouter ni modifier ses valeurs.

La dimension par défaut ne peut pas être désactivée.

**Préférez la désactivation à la suppression** : désactiver garde les rapports cohérents tout en gardant les listes propres.

---

## Valeurs sur les lignes budgétaires

Dans le panneau **Propriétés** d'un poste OPEX ou CAPEX, et lorsque vous en créez un, chaque dimension activée a son propre champ, au nom de la dimension, dans l'ordre des dimensions. La dimension par défaut s'affiche comme **Dimension analytique** tant que vous ne la renommez pas.

- Choisissez une valeur, ou videz le champ pour laisser la ligne sans valeur sur cette dimension. La modification s'enregistre aussitôt.
- Le champ liste les valeurs activées de sa dimension. Une valeur désactivée reste affichée sur les lignes qui l'ont.
- Le champ ne peut pas créer de valeur. Créez les valeurs sur la page Dimensions analytiques, ou laissez un import CSV OPEX ou CAPEX les créer.
- Une valeur s'applique à toute la ligne, sur toutes les années.
- Si les dimensions ne peuvent pas être chargées, une ligne remplace ces champs : « Les dimensions n'ont pas pu être chargées. »

Les listes OPEX et CAPEX ont une colonne par dimension activée, masquée par défaut, avec un filtre par cases à cocher. Voir [OPEX](opex.md) et [CAPEX](capex.md).

---

## Rapports

Le rapport **Dimensions analytiques** (sous **Rapports**) montre comment le budget de vos lignes OPEX ou CAPEX se répartit entre les valeurs d'une dimension. Voir [Rapports](reports.md#dimensions-analytiques) pour la description complète.

- **Type de poste** : OPEX ou CAPEX
- **Dimension** : la dimension sur laquelle le rapport regroupe. Elle s'affiche lorsque vous avez au moins deux dimensions activées, et commence sur la dimension par défaut
- **Plage d'années** : une seule année (graphique en secteurs ou en barres) ou plusieurs années (graphique en courbe)
- **Métrique** : toute colonne budgétaire affichée par votre organisation, sous son nom. Démarre sur la colonne par défaut
- **Exclure des valeurs** : écarter certaines valeurs pour vous concentrer sur les autres

Les sept rapports budgétaires peuvent aussi être restreints à une valeur d'une dimension, avec un filtre par dimension. Voir [Filtres par centre de coûts, run ou build et dimensions analytiques](reports.md#filtres-par-centre-de-couts-run-ou-build-et-dimensions-analytiques).

---

## Dimensions analytiques dans Plaid

- Plaid peut filtrer et regrouper les lignes OPEX et CAPEX sur chaque dimension activée.
- Une question sur la catégorie analytique utilise la dimension par défaut, quels que soient son nom ou son ordre.
- Plaid ne peut modifier la valeur d'une ligne que sur la dimension par défaut. Renseignez les autres dimensions dans l'application ou avec un fichier CSV.

---

## Import/export CSV

Chargez ou mettez à jour les valeurs de toutes les dimensions depuis un seul fichier. Les dimensions se créent sur la page.

Pour renseigner des valeurs sur les lignes budgétaires depuis un fichier, utilisez les fichiers CSV OPEX et CAPEX. Dans ces fichiers, la colonne `analytics_category` porte la dimension par défaut, et une colonne `analytics:<code>` porte chaque autre dimension. Voir [OPEX](opex.md#importexport-csv) et [CAPEX](capex.md#importexport-csv).

**Export** : cliquez sur **Exporter CSV**, puis sur **Exporter les données**. Le fichier liste les valeurs de toutes les dimensions, activées ou désactivées, dimension par dimension. Pour un fichier vide avec les seuls en-têtes, utilisez **Télécharger le modèle** dans la boîte de dialogue d'import.

**Structure du CSV** :

- Séparateur : point-virgule `;`
- Encodage : UTF-8 (enregistrez au format « CSV UTF-8 » dans Excel)
- En-têtes : `axis_code;name;description;status;disabled_at`

| Colonne | Contenu |
|---|---|
| `axis_code` | Le code de la dimension de la valeur, sans tenir compte de la casse. Vide signifie la dimension par défaut |
| `name` | Obligatoire. Le nom de la valeur |
| `description` | Texte libre |
| `status` | `enabled` ou `disabled`. Vide signifie `enabled` pour une nouvelle valeur et conserve le statut enregistré lors d'une mise à jour |
| `disabled_at` | La fin de validité : une date (`2026-12-31`) ou une date et une heure complètes. Vide s'il n'y a pas de fin. Lors d'une mise à jour, un `status` vide et un `disabled_at` vide conservent les valeurs enregistrées. `enabled` avec une date vide efface la fin de validité. `disabled` avec une date vide conserve une date déjà passée, et sinon termine la valeur aujourd'hui |

Seule la colonne `name` est obligatoire. Lorsque la colonne `description`, `status` ou `disabled_at` manque, les valeurs existantes conservent ce qui est enregistré, et les nouvelles valeurs sont activées, sans description. Un fichier sans `axis_code` place toutes les lignes dans la dimension par défaut.

**Import** :

1. Cliquez sur **Importer CSV** sur la page
2. Choisissez votre fichier
3. Cliquez sur **Vérification préalable**. Le rapport donne le nombre de lignes, les valeurs à créer et à mettre à jour, et les lignes qui ne changent rien
4. Si la vérification préalable est sans erreur, cliquez sur **Charger**

**Fonctionnement de l'import** :

- **Le fichier entier est vérifié avant toute écriture.** Un fichier comportant une erreur ne charge rien : corrigez les lignes et relancez la vérification préalable. Chaque erreur désigne sa ligne par le numéro de ligne du fichier tel qu'un éditeur de texte l'affiche, lignes vides et cellules sur plusieurs lignes comprises.
- **Rapprochement par dimension et par nom** : une ligne dont le nom existe dans sa dimension met à jour cette valeur ; toute autre ligne en crée une. Chaque cellule remplace la valeur enregistrée : une `description` vide l'efface donc. Un nom écrit avec une autre casse trouve la valeur enregistrée et ne la renomme pas. Pour renommer une valeur, renommez-la sur la page.
- **Lignes inchangées** : une ligne identique à la valeur enregistrée ne change rien. Exporter puis importer le même fichier signale toutes les lignes comme inchangées.
- **Dimensions désactivées** : une ligne d'une dimension désactivée est acceptée si elle ne change rien. Un fichier exporté s'importe donc tel quel. Une ligne qui créerait ou modifierait une valeur dans cette dimension est refusée.
- **Les valeurs absentes du fichier** restent telles quelles. L'import ne supprime jamais rien.

**Erreurs courantes** :

- **« Unknown dimension '...'. »** : la cellule `axis_code` ne correspond à aucune dimension. Vérifiez le code dans l'espace de travail de la dimension, ou créez d'abord la dimension.
- **« The ... dimension is disabled. Enable it or leave it out. »** : une ligne crée ou modifie une valeur dans une dimension désactivée. Activez la dimension, ou retirez la ligne.
- **« ... is already on row N. »** : deux lignes portent le même nom pour la même dimension. Gardez-en une.
- **« Invalid status '...'. Use 'enabled' or 'disabled'. »** : corrigez la cellule `status`.
- **« Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again. »** : la ligne est activée avec une date déjà passée. Un fichier exporté avant cette date indique encore `enabled` : exportez à nouveau, ou corrigez la cellule.
- **« Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed. »** : la ligne est désactivée avec une date encore à venir. Corrigez la cellule `status` ou `disabled_at`.
- **« Header mismatch »** : téléchargez un nouveau modèle.

---

## Permissions

| Niveau | Ce qu'il permet |
|---|---|
| `analytics:reader` | Consulter la page Dimensions analytiques et ouvrir les dimensions et les valeurs |
| `analytics:member` | Créer des dimensions et des valeurs, et les modifier |
| `analytics:admin` | Tout ce qui précède, plus l'import et l'export CSV, et la suppression |

Le rôle intégré Administrateur budget est admin, Membre budget est member et Lecteur budget est reader. Toute personne qui peut consulter les OPEX, les CAPEX ou les rapports voit les dimensions et leurs valeurs sur les lignes budgétaires, dans les listes et dans les rapports, sans accès à cette page.

---

## Astuces

- **Restez simple** : quelques dimensions de 5 à 10 valeurs larges chacune en révèlent généralement plus que des dizaines de valeurs détaillées.
- **Une question par dimension** : chaque dimension doit répondre à une seule question sur la dépense, comme « de quel type de dépense s'agit-il ? » ou « quel programme sert-elle ? ».
- **Documentez avec des descriptions** : une courte description aide beaucoup à un usage cohérent entre les équipes.
- **Laissez des vides quand il le faut** : « Non affecté » est un état valide. Évitez les valeurs fourre-tout vagues créées seulement pour combler le vide.
- **Désactivez plutôt que supprimer** : retirer une valeur garde les rapports exacts.
- **Utilisez les rapports pour affiner** : lancez le rapport Dimensions analytiques de temps en temps. Si une valeur capte trop ou trop peu de dépenses, scindez-la ou fusionnez-la.

---

## Questions fréquentes

**Une ligne peut-elle avoir plusieurs valeurs analytiques ?**
Oui, une par dimension. Une ligne peut être **Licenses** sur Nature et **Workplace** sur Program. Au sein d'une dimension, une ligne a une valeur ou aucune.

**Les dimensions analytiques affectent-elles les ventilations ou la comptabilité ?**
Non. Elles servent uniquement au reporting et n'ont aucun impact sur les ventilations de coûts ou la comptabilité formelle.

**Combien de valeurs dois-je créer ?**
Commencez avec 5 à 10 par dimension. Au-delà de 20, la dimension essaie généralement de répondre à trop de questions : scindez-la en deux dimensions.

**Quelle est la différence entre dimensions analytiques, départements et centres de coûts ?**
Les **départements** sont des unités organisationnelles formelles avec des clés de ventilation précises. Les **centres de coûts** indiquent qui porte la dépense et en répond. Les **dimensions analytiques** sont des classifications libres et facultatives pour le reporting, sans ventilation ni responsabilité associées.

**Pourquoi certaines lignes affichent-elles « Non affecté » ?**
Dans le rapport Dimensions analytiques, les lignes sans valeur sur la dimension choisie apparaissent comme « Non affecté ». C'est attendu : les valeurs sont facultatives.

**Que deviennent les lignes quand je renomme une valeur ou une dimension ?**
Rien ne change sur les lignes. Les listes et les rapports affichent aussitôt le nouveau nom.
