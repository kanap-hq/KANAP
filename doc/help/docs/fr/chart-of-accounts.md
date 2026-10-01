# Plans comptables et gestion des comptes

Les plans comptables (CoA) organisent votre structure comptable en regroupant les comptes en ensembles nommés. Chaque société peut être liée à un CoA, qui détermine les comptes disponibles lors de l'enregistrement de postes OPEX ou CAPEX.

## Pourquoi utiliser les plans comptables ?

Sans CoA, tous les comptes sont disponibles pour toutes les sociétés. Il est alors facile d'utiliser le mauvais compte par erreur ou de mélanger des normes comptables entre entités. Les plans comptables résolvent ce problème en :

  - **Garantissant la cohérence** : Les sociétés ne voient que les comptes de leur CoA assigné
  - **Prenant en charge plusieurs normes** : Différents pays ou unités métier peuvent utiliser différentes structures de comptes
  - **Simplifiant la sélection** : Les menus déroulants de comptes n'affichent que les comptes pertinents, pas tout votre catalogue
  - **Permettant les modèles** : Chargez des ensembles de comptes préconfigurés à partir de modèles propres à chaque pays

**Exemple** : Votre filiale française utilise le PCG (Plan Comptable Général), tandis que votre entité britannique utilise le UK GAAP. Créez deux CoA, un pour chaque norme, et assignez les sociétés en conséquence. Lors de l'enregistrement des dépenses, les utilisateurs voient automatiquement les bons comptes.

## La relation : CoA -> Société -> Comptes

La hiérarchie fonctionne ainsi :

```
Plan comptable (FR-2024)
  -> assigné à
Société (Acme France)
  -> utilisé lors de l'enregistrement
Postes OPEX/CAPEX -> Sélection de compte (filtré aux comptes FR-2024 uniquement)
```

**Points clés** :
  - Un CoA peut être assigné à plusieurs sociétés
  - Chaque société a un CoA
  - Un compte appartient à un CoA
  - Lorsque vous créez ou modifiez des postes de dépenses, le menu déroulant des comptes est filtré par le CoA de la société

## Où trouver cette page

- Chemin : **Données de référence -> Plans comptables**
- Autorisations :
  - Consultation : `accounts:reader`
  - Créer/modifier des comptes et des CoA : `accounts:manager`
  - Import CSV, Export CSV, Suppression : `accounts:admin`

## Travailler avec la liste

La page comporte deux niveaux : un **sélecteur de CoA** en haut et une **grille de comptes** en dessous.

### Barre de pastilles CoA

Une rangée horizontale de pastilles représente chaque plan comptable. Cliquez sur une pastille pour afficher les comptes de ce CoA dans la grille.

- La pastille sélectionnée est pleine ; les autres sont en contour.
- Un badge étoile (**★**) indique le CoA par défaut du pays de ce CoA.
- Un badge cercle-plus indique le CoA par défaut global.
- Survolez une pastille pour voir le nom du CoA et son nombre de comptes.

Si vous avez l'autorisation `accounts:manager`, deux contrôles supplémentaires apparaissent à droite :

- **Nouveau** : Ouvre la boîte de dialogue **Nouveau plan comptable**.
- **Gérer** : Ouvre la fenêtre **Gérer les plans comptables** pour l'administration.

Lorsqu'aucun CoA n'existe, la barre de pastilles vous invite à créer votre premier plan comptable.

### Résumé du CoA

Sous la barre de pastilles, une ligne de résumé affiche le **code**, le **nombre de comptes**, le **nom** et le **pays** du CoA sélectionné (pour les CoA de périmètre pays).

### Grille des comptes

La grille affiche uniquement les comptes du CoA sélectionné.

**Colonnes par défaut** :
- **N° de compte** : Le numéro de compte. Cliquez pour ouvrir l'espace de travail du compte.
- **Nom** : Le nom du compte. Cliquez pour ouvrir l'espace de travail du compte.
- **N° compte de consolidation** : Le numéro du compte de consolidation.
- **Nom de consolidation** : Le nom du compte de consolidation.

**Colonnes supplémentaires** (masquées par défaut, activez-les via le sélecteur de colonnes) :
- **Nom local** : Le nom du compte dans la langue locale.
- **Description** : La description du compte.
- **Description de consolidation** : La description du compte de consolidation.
- **Statut** : Indique si le compte est activé ou désactivé.
- **Créé** : Date et heure de création du compte.

**Filtrage** :
- Recherche rapide : Recherche dans les colonnes texte visibles.
- Périmètre par statut : le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la grille. Par défaut **Activés**, qui n'affiche que les comptes actifs. Choisissez **Tous** pour inclure les comptes désactivés.
- Filtres de colonnes : Utilisez les filtres des en-têtes de colonnes (par exemple, la colonne **Statut** a un filtre par liste de valeurs). Cliquer sur **Effacer** dans le filtre **Statut**, ou décocher les deux valeurs, n'affiche plus rien, quel que soit le choix de **Afficher**.

**Tri** : Par défaut, **N° de compte** par ordre croissant.

**Actions** (dans l'en-tête de la page) :
- **Nouveau compte** (`accounts:manager`) : Ouvre l'espace de travail d'un nouveau compte déjà lié au CoA sélectionné.
- **Import CSV** (`accounts:admin`) : Importer des comptes dans le CoA sélectionné.
- **Export CSV** (`accounts:admin`) : Exporter les comptes du CoA sélectionné.
- **Supprimer la sélection** (`accounts:admin`) : Supprimer les lignes de comptes sélectionnées. Sélectionnez les lignes avec la colonne de cases à cocher (visible par les administrateurs).

Toutes les cellules sont des liens cliquables vers l'espace de travail du compte. Vous pouvez faire un clic droit ou Ctrl+clic pour ouvrir dans un nouvel onglet.

## L'espace de travail du compte

Cliquez sur n'importe quelle ligne de la grille des comptes pour ouvrir l'espace de travail du compte.

### Vue d'ensemble

L'espace de travail comporte un seul onglet **Vue d'ensemble** avec un formulaire pour consulter et modifier les champs du compte.

**Ce que vous pouvez modifier** :
- **Plan comptable** : Le CoA auquel ce compte appartient (menu déroulant de tous les CoA de votre espace de travail).
- **Numéro de compte** (obligatoire) : Le numéro du compte.
- **Nom du compte** (obligatoire) : Le nom du compte en anglais (ou dans votre langue principale).
- **Nom local (langue locale)** : Le nom du compte dans la langue locale.
- **Description** : Description en texte libre.
- **Numéro de compte de consolidation** : Le numéro de compte de consolidation standardisé.
- **Nom du compte de consolidation** : Le nom de consolidation standardisé.
- **Description du compte de consolidation** : Précisions sur la catégorie de consolidation.
- **Cycle de vie** : l'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité**. Définissez une **Fin de validité** pour programmer le moment où le compte n'apparaît plus dans les menus déroulants de sélection. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie).

**Navigation** :
- **Préc. / Suiv.** : Passer d'un compte à l'autre dans l'ordre actuel de la liste.
- **Enregistrer** : Enregistrer les modifications (actif lorsque le formulaire a été modifié et que vous avez `accounts:manager`).
- **Réinitialiser** : Annuler les modifications non enregistrées.
- **Fermer** (bouton X) : Revenir à la liste des comptes en conservant votre sélection de CoA, votre tri, votre recherche et vos filtres.

Si vous quittez la page avec des modifications non enregistrées, le système vous invite à enregistrer ou à annuler.

**Conseil** : Vous avez besoin de `accounts:manager` pour modifier. Les utilisateurs en lecture seule voient une bannière d'information.

## Configurer les plans comptables

### Créer un CoA

Vous pouvez créer un CoA de deux manières :

1. **De zéro** : Choisissez un périmètre, puis créez un CoA vide.
   - **Périmètre** : `GLOBAL` (sans pays) ou `PAYS` (nécessite de choisir un pays)
   - Pour le périmètre `PAYS`, vous pouvez le marquer comme défaut pour ce pays. Il n'existe qu'un seul défaut par pays à la fois.
   - Vous pouvez ensuite charger des comptes via CSV.
2. **À partir d'un modèle** : Chargez un ensemble de comptes préconfiguré, maintenu par les administrateurs de la plateforme.
   - Les modèles globaux créent un CoA de périmètre `GLOBAL` (sans champ pays).
   - Les modèles pays créent un CoA de périmètre `PAYS` avec le pays du modèle prérempli.

**Champs de la boîte de dialogue de création** :
- **Mode** : Choisissez **Créer de zéro** ou **Copier à partir d'un modèle**.
- **Modèle** (mode modèle uniquement) : Sélectionnez un modèle dans le menu déroulant. Les modèles globaux apparaissent sous la forme « ALL -- ... » ; les modèles pays affichent leur code à 2 lettres.
- **Code** (obligatoire) : Un identifiant stable utilisé dans les exports/imports CSV et les liens directs.
- **Nom** (obligatoire) : Un nom descriptif pour le CoA.
- **Périmètre** : `Pays` ou `Global`.
- **Pays** (périmètre pays uniquement) : Sélectionnez un pays dans la liste.
- **Définir comme défaut pour ce pays** (périmètre pays uniquement) : Cochez pour faire de ce CoA le défaut du pays sélectionné.

En mode modèle, vous pouvez lancer une **Vérification** avant la création pour voir combien de comptes seront insérés et mis à jour. Cliquez ensuite sur **Créer** pour finaliser.

**Valeurs par défaut** :
  - Par pays : Vous pouvez marquer un CoA comme défaut pour chaque pays. Les nouvelles sociétés de ce pays sont automatiquement assignées à ce CoA (vous pouvez le changer ensuite dans l'onglet Vue d'ensemble de la société).
  - Repli global : Votre espace de travail peut avoir un CoA par défaut global, utilisé pour les pays qui n'ont pas encore de défaut propre. Les défauts pays sont prioritaires ; le défaut global s'applique partout ailleurs.

### Charger depuis les modèles

Les modèles sont des ensembles de comptes standard gérés par les administrateurs de la plateforme. Ils peuvent être :
  - Propres à un pays (ex. : PCG français, UK GAAP)
  - Globaux (disponibles pour tous les pays)

**Fonctionnement** :
  - Allez dans **Données de référence -> Plans comptables**
  - Cliquez sur **Nouveau** dans la barre de pastilles
  - Choisissez le mode **Copier à partir d'un modèle**
  - Sélectionnez un modèle ; les modèles globaux apparaissent sous la forme « ALL -- ... » (ils chargent un CoA `GLOBAL`) ; les modèles pays affichent leur code à 2 lettres
  - Le système affiche un rapport de vérification (nombre de comptes qui seront insérés ou mis à jour)
  - Confirmez pour copier les comptes dans votre CoA

**Ce qui est copié** : Numéros de comptes, noms, noms locaux (langue locale), descriptions, correspondances de consolidation et statut. Les comptes deviennent les vôtres et sont modifiables. Les modifications du modèle de la plateforme n'affectent pas votre CoA, sauf si vous le rechargez explicitement.

**Conseil** : Après avoir chargé un modèle, vous pouvez ajouter des comptes propres à la société, renommer des entrées ou désactiver les comptes inutilisés. Les modèles sont un point de départ, pas une structure figée.

### Modèles disponibles

KANAP est livré avec **20 modèles préconfigurés** couvrant 10 normes comptables. Chaque norme existe en deux versions :

- **v1.0 (Simple)** : Un ensemble ciblé d'environ 20 comptes utiles pour l'IT : licences logicielles, hébergement cloud, cybersécurité, télécoms, conseil, coûts de personnel, formation, etc. Idéal pour les organisations qui veulent un point de départ léger.
- **v2.0 (Détaillé)** : Tout le contenu de la v1.0, plus des sous-comptes plus fins (environ 30 comptes). Ajoute des distinctions comme Logiciel acheté ou développé en interne, Équipement réseau, Licences SaaS ou perpétuelles, Communications mobiles, Primes IT, Assurance IT, etc. Idéal pour les organisations qui ont besoin d'un suivi des coûts plus fin.

Les deux versions utilisent des **numéros de compte réels issus de la norme comptable officielle de chaque pays** et incluent les noms locaux dans la langue du pays.

| Code modèle | Pays | Norme | Comptes (v1 / v2) |
|---------------|---------|----------|---------------------|
| **IFRS** | Global | International Financial Reporting Standards | 14 / 30 |
| **FR-PCG** | France | Plan Comptable Général | 20 / 31 |
| **DE-SKR03** | Allemagne | Standardkontenrahmen 03 | 20 / 32 |
| **GB-UKGAAP** | Royaume-Uni | UK GAAP | 20 / 31 |
| **ES-PGC** | Espagne | Plan General de Contabilidad | 20 / 31 |
| **IT-PDC** | Italie | Piano dei Conti | 20 / 31 |
| **NL-RGS** | Pays-Bas | Rekeningschema (RGS) | 20 / 31 |
| **BE-PCMN** | Belgique | Plan Comptable Minimum Normalisé | 20 / 31 |
| **CH-KMU** | Suisse | Kontenrahmen KMU | 20 / 31 |
| **US-USGAAP** | États-Unis | US GAAP | 20 / 32 |

**Choisir une version** :

  - Commencez avec la **v1.0** si vous voulez un plan propre et minimal qui couvre les catégories de coûts IT essentielles. Vous pourrez toujours ajouter des comptes plus tard.
  - Choisissez la **v2.0** si votre organisation suit les dépenses IT à un niveau fin (ex. : distinguer les abonnements SaaS des licences perpétuelles, ou séparer les salaires IT des primes).

### Consolidation IFRS intégrée

Tous les modèles, quel que soit le pays, associent chaque compte à l'un des **14 comptes de consolidation IFRS standardisés**. Le reporting au niveau du groupe fonctionne donc immédiatement, même entre normes locales différentes.

| # | Compte de consolidation | Ce qu'il couvre |
|---|-----------------------|----------------|
| 1000 | Immobilisations corporelles (CAPEX) | Équipement IT physique : serveurs, postes de travail, matériel réseau |
| 1100 | Immobilisations incorporelles (CAPEX) | Logiciels immobilisés et coûts de développement |
| 1200 | Amortissements | Amortissement du matériel et des logiciels |
| 1300 | Dépréciations et mises au rebut | Dépréciations et dévalorisations d'actifs |
| 2000 | Licences logicielles (OPEX) | Licences perpétuelles, abonnements SaaS, support open source |
| 2100 | Services cloud et hébergement | IaaS, PaaS, supervision, outils de cybersécurité |
| 2200 | Télécommunications et réseau | Internet, mobile, WAN/LAN |
| 2300 | Maintenance et support | Contrats de maintenance matériel et logiciel |
| 2400 | Conseil IT et services externes | Conseil, intégration de systèmes, prestataires |
| 2500 | Coûts du personnel IT | Salaires, primes, charges sociales, retraites |
| 2600 | Formation et certification | Programmes de formation, certifications, conférences |
| 2700 | IT poste de travail (non immobilisé) | Équipements utilisateurs sous le seuil d'immobilisation |
| 2800 | Déplacements et mobilité (projets IT) | Déplacements liés aux projets |
| 2900 | Autres charges d'exploitation IT | Coûts IT divers, assurance cyber |

**Exemple** : Votre filiale française charge **FR-PCG v1.0** et votre filiale allemande charge **DE-SKR03 v1.0**. Elles utilisent des numéros de compte et des noms locaux différents, mais chaque compte est associé à la même structure de consolidation IFRS. Les rapports de groupe s'agrègent sans aucun travail de correspondance manuel.

### CoA par défaut global (provisionnement)

Les nouveaux espaces de travail sont automatiquement provisionnés avec le modèle **IFRS v1.0**. Cela crée un CoA de périmètre `GLOBAL` contenant les 14 comptes de consolidation IFRS et le définit comme défaut global du tenant, pour que les sociétés puissent l'utiliser immédiatement sans configuration. Vous pouvez ensuite modifier ou supprimer les comptes et le CoA préchargés si nécessaire (dans le respect des garde-fous habituels).

Les CoA globaux sont affichés avec leur périmètre dans la fenêtre **Gérer**, sans valeur de pays pour les entrées `GLOBAL`. Seuls les CoA `GLOBAL` peuvent être marqués comme défaut global, et seuls les CoA `PAYS` peuvent être définis comme défaut d'un pays.

## Gérer les plans comptables

### La fenêtre Gérer

Cliquez sur **Gérer** dans la barre de pastilles pour ouvrir la fenêtre d'administration. Elle comporte deux panneaux :

**Panneau de gauche** : liste des CoA
- Affiche tous vos plans comptables avec leurs codes et noms.
- Badges par défaut : **★** pour le défaut pays, cercle-plus pour le défaut global.
- Cliquez sur une ligne pour voir ses détails.

**Panneau de droite** : détails du CoA
- **Code** et **Nom**
- **Périmètre** : `GLOBAL` ou `PAYS`
- **Pays** (pour les CoA de périmètre pays)
- **Défaut pays** : Oui/Non
- **Défaut global** : Oui/Non
- **Sociétés associées** : Nombre de sociétés assignées à ce CoA
- **Comptes** : Nombre de comptes de ce CoA

**Actions** (dans la barre d'outils de la fenêtre) :
- **Nouveau** (`accounts:manager`) : Ouvre la boîte de dialogue de création de CoA.
- **Définir comme défaut pays** (`accounts:manager`) : Marque le CoA de périmètre pays sélectionné comme défaut de son pays. Désactivé pour les CoA globaux.
- **Définir comme défaut global** (`accounts:manager`) : Marque le CoA de périmètre global sélectionné comme défaut global. Désactivé pour les CoA pays.
- **Supprimer la sélection** (`accounts:admin`) : Supprime le CoA sélectionné. La suppression est bloquée si des sociétés le référencent ou si des postes OPEX/CAPEX utilisent ses comptes.

## Gérer les comptes

### Numéros de compte

Les numéros de compte sont stockés sous forme de texte, mais contiennent généralement des valeurs numériques. Lors de la modification des comptes :
  - Vous pouvez saisir des nombres (ex. : `6011`) ou du texte (ex. : `6011-TRAVEL`)
  - Le système convertit automatiquement les saisies numériques en texte
  - Au sein d'un CoA, les numéros de compte doivent être uniques (contrôle appliqué après la reprise des données)

### Noms locaux pour le multilinguisme

Certains pays exigent que les comptes soient enregistrés dans la langue locale. Utilisez le champ **Nom local** pour stocker le nom d'origine tout en conservant le nom anglais dans le champ principal **Nom du compte**.

**Exemple** : Compte français
  - **Nom du compte** : `Travel expenses` (anglais, pour le reporting)
  - **Nom local** : `Frais de deplacement` (français, pour la conformité légale)

Le nom local est disponible dans une colonne masquée de la grille des comptes. Activez-la depuis le sélecteur de colonnes pour voir les deux noms côte à côte.

## Comptes de consolidation (reporting de groupe)

Dans les organisations multi-pays, le travail quotidien se fait avec les plans comptables locaux (PCG français, UK GAAP, HGB allemand, etc.), mais le reporting de groupe exige souvent une consolidation vers une norme commune comme **IFRS** ou **US GAAP**.

Les **comptes de consolidation** répondent à ce besoin en associant les comptes locaux à des comptes de consolidation standardisés.

### Fonctionnement

Chaque compte peut avoir trois champs de consolidation :
  - **Numéro de compte de consolidation** : Le numéro de compte standardisé (ex. : compte IFRS `6200`)
  - **Nom du compte de consolidation** : Le nom standardisé (ex. : `IT Services and Software`)
  - **Description du compte de consolidation** : Précisions facultatives sur la catégorie de consolidation

**Exemple de correspondance** :

| Pays | CoA local | Compte local | Nom local | -> | Compte de consolidation | Nom de consolidation |
|---------|-----------|---------------|------------|---|----------------------|-------------------|
| France | FR-PCG | 6061 | Frais postaux | -> | 6200 | IT Services and Software |
| Royaume-Uni | UK-GAAP | 5200 | Postage and courier | -> | 6200 | IT Services and Software |
| Allemagne | DE-HGB | 4920 | Portokosten | -> | 6200 | IT Services and Software |

Les trois comptes locaux sont associés au même compte de consolidation IFRS `6200`, ce qui permet l'agrégation au niveau du groupe.

### Pourquoi c'est important

**Opérations quotidiennes** : Les utilisateurs travaillent avec les comptes locaux qu'ils connaissent
  - Les utilisateurs français sélectionnent le compte `6061 - Frais postaux`
  - Les utilisateurs britanniques sélectionnent le compte `5200 - Postage and courier`
  - Les utilisateurs allemands sélectionnent le compte `4920 - Portokosten`

**Reporting de groupe** : Le système peut consolider les coûts par compte de consolidation
  - Tous les coûts de services IT de tous les pays s'agrègent sous `6200 - IT Services and Software`
  - La direction dispose d'une vue unifiée, indépendamment des différences comptables locales
  - Le reporting statutaire de chaque pays continue d'utiliser les comptes locaux

### Configurer les correspondances de consolidation

**Option 1 : Modèles (recommandé)**
Tous les modèles intégrés incluent les correspondances de consolidation IFRS sur chaque compte. Chargez n'importe quel modèle pays et les colonnes de consolidation sont déjà remplies, sans correspondance manuelle. Consultez [Modèles disponibles](#modeles-disponibles) pour la liste complète.

**Option 2 : Import CSV**
Lors de l'import de comptes, incluez les champs de consolidation dans votre CSV :

```
coa_code;account_number;account_name;consolidation_account_number;consolidation_account_name;consolidation_account_description
FR-PCG;6061;Frais postaux;6200;IT Services and Software;
UK-GAAP;5200;Postage and courier;6200;IT Services and Software;
DE-HGB;4920;Portokosten;6200;IT Services and Software;
```

**Option 3 : Saisie manuelle**
Modifiez les comptes un par un et remplissez les champs de consolidation dans l'espace de travail du compte.

### Bonnes pratiques

  - **Utilisez une norme commune** : IFRS est courant pour les groupes européens, US GAAP pour les sociétés américaines. Tous les modèles intégrés sont déjà associés aux 14 mêmes comptes de consolidation IFRS (voir [Consolidation IFRS intégrée](#consolidation-ifrs-integree))
  - **Tenez un plan de consolidation** : Conservez un document de référence qui liste vos comptes de consolidation et ce qu'ils représentent. Si vous utilisez les modèles intégrés, les 14 comptes IFRS servent de référence
  - **Choisissez le bon niveau de détail** : Ne consolidez ni trop large (perte d'information), ni trop fin (trop complexe)
  - **Impliquez la finance** : Les correspondances de consolidation doivent être alignées sur les exigences de reporting financier de votre groupe
  - **Mettez à jour systématiquement** : Lorsque vous ajoutez des comptes locaux, associez-les immédiatement à des comptes de consolidation

### Reporting avec les comptes de consolidation

Lorsque vous construisez des rapports, vous pouvez regrouper par :
  - **Comptes locaux** : Détail par pays (pour le management local)
  - **Comptes de consolidation** : Catégories de niveau groupe (pour le reporting de direction)

Cette double vue répond à la fois aux exigences de conformité locales et aux besoins du reporting de groupe, sans dupliquer les données.

## Comptes historiques (aide à la migration)

Les **comptes historiques** sont des comptes sans `coa_id` (créés avant l'introduction des plans comptables).

**Fonctionnement** :
  - Les sociétés SANS CoA peuvent utiliser les comptes historiques
  - Les sociétés AVEC un CoA ne peuvent pas utiliser les comptes historiques : ils sont filtrés automatiquement
  - Les comptes historiques peuvent toujours être migrés via CSV (`coa_code`) et par réassignation

**Chemin de migration** :
  1. Créez ou chargez des plans comptables pour vos sociétés
  2. Assignez les CoA aux sociétés (dans l'onglet Vue d'ensemble de la société)
  3. Assignez un `coa_id` à vos comptes historiques (via import CSV avec `coa_code` ou modification en masse)
  4. Mettez à jour les postes OPEX/CAPEX existants qui affichent un avertissement « compte obsolète »

**Conseil** : Vous n'avez pas à tout migrer en une fois. Les sociétés sans CoA continuent de fonctionner avec les comptes historiques, ce qui permet une adoption progressive.

## Avertissements de compte obsolète

Lors de la modification de postes OPEX ou CAPEX, vous pouvez voir :

```
Compte obsolète détecté. Le compte sélectionné n'appartient pas au
plan comptable de la société. Veuillez mettre à jour le compte.
```

**Pourquoi cela se produit** :
  - Le compte du poste appartient au CoA « A »
  - La société du poste appartient au CoA « B »
  - Une incohérence est détectée

**Cas fréquents** :
  - Vous avez migré une société vers un nouveau CoA sans encore mettre à jour ses anciens postes de dépenses
  - Un compte a été réassigné manuellement à un autre CoA
  - Vous consultez des données historiques antérieures à la migration du CoA

**Comment corriger** : Modifiez le poste et sélectionnez un compte du plan comptable actuel de la société. L'avertissement disparaît dès que le compte correspond au CoA de la société.

## Statut et cycle de vie

Les comptes suivent la même gestion du cycle de vie que les autres données de référence :

  - **Activé** par défaut
  - Définissez une **Fin de validité** pour cesser d'utiliser un compte à partir d'une date donnée. Laissez-la vide pour que le compte reste actif indéfiniment
  - Passer le compte à **Désactivé** sans date fixe sa fin de validité à aujourd'hui
  - Après la fin de validité :
      - Le compte n'apparaît plus dans les menus déroulants de sélection pour les nouveaux postes
      - Les données historiques restent intactes ; les postes existants conservent leur compte
      - Les rapports des années où le compte était actif l'incluent toujours
  - La grille des comptes affiche par défaut les comptes **Activés** uniquement. Utilisez le bouton bascule **Afficher : Tous / Activés / Désactivés** pour choisir **Tous** et inclure les comptes désactivés.

## Suppression du tenant et CoA

Lorsqu'un espace de travail (tenant) est supprimé par un administrateur de la plateforme, toutes les données comptables du tenant sont définitivement effacées lors de la purge :
- Plans comptables (`chart_of_accounts`)
- Comptes (`accounts`)
- Liens entre les sociétés et un CoA (`companies.coa_id`)

La suppression est immédiate et irréversible. L'enregistrement du tenant est conservé pour l'audit, et son identifiant (slug) est libéré pour être réutilisé.

**Conseil** : Préférez la désactivation à la suppression. La suppression n'est possible que si aucun poste OPEX/CAPEX ne référence le compte.

## Import/export CSV

### Plans comptables

Vous pouvez exporter la liste de vos CoA (avec des métadonnées comme le code, le nom, le pays et le statut par défaut), mais pas importer de CoA directement via CSV. Créez les CoA dans l'interface ou chargez-les depuis des modèles.

### Comptes (point d'accès global)

Le CSV global `/accounts` inclut une colonne `coa_code` qui identifie le CoA de chaque compte.

  - **Export**
      - **Modèle** : en-têtes uniquement (utilisez-le pour préparer les imports)
      - **Données** : tous les comptes avec leur code CoA, numéro, nom, nom local, description, correspondances de consolidation et statut
  - **Import**
      - Commencez par la **Vérification** (contrôle de la structure, de l'encodage, des champs obligatoires et des doublons)
      - Si la vérification est correcte, **Charger** applique les insertions et mises à jour
      - **Correspondance** : par `(coa_code, account_number)` dans votre espace de travail
      - **Champs obligatoires** : `coa_code`, `account_number`, `account_name`
      - **Champs facultatifs** : `native_name`, `description`, champs de consolidation, `status`
      - Les doublons du fichier (même coa_code + account_number) sont dédoublonnés ; la première occurrence l'emporte

**Schéma CSV** (séparateur point-virgule `;`, UTF-8) :
```
coa_code;account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

### Comptes (limités au CoA)

Depuis la page Plans comptables, **Import CSV** et **Export CSV** portent automatiquement sur le CoA sélectionné.

  - **Export** : comptes de ce CoA (pas besoin de colonne `coa_code`)
  - **Import** : les comptes sont insérés ou mis à jour automatiquement dans ce CoA

**Schéma CSV** (limité au CoA, séparateur point-virgule `;`, UTF-8) :
```
account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

**Remarques** :
  - Utilisez l'**encodage UTF-8** et des **points-virgules** comme séparateurs
  - Le `coa_code` doit correspondre à un plan comptable existant de votre espace de travail
  - Les numéros de compte doivent être uniques au sein d'un CoA
  - Valeurs de statut : `enabled` ou `disabled` (enabled par défaut)

## Conseils

  - **Commencez par les modèles** : KANAP est livré avec des modèles pour 9 pays plus IFRS. Chargez-en un au lieu de partir de zéro : vous obtenez directement les bons numéros de compte, les noms locaux et les correspondances de consolidation IFRS. Commencez avec la v1.0 (Simple) en cas de doute ; passez à la v2.0 (Détaillé) si vous avez besoin de plus de détail.
  - **Un défaut par pays** : Définissez un CoA par défaut pour chaque pays afin que les nouvelles sociétés reçoivent automatiquement la bonne structure de comptes.
  - **Noms locaux pour la conformité** : Utilisez le champ Nom local si la réglementation locale exige les comptes dans la langue du pays. Activez la colonne **Nom local** dans la grille pour voir les deux noms d'un coup d'œil.
  - **Migrez progressivement** : Vous n'avez pas à tout convertir en une fois. Les sociétés sans CoA continuent de fonctionner avec les comptes historiques.
  - **Corrigez les comptes obsolètes** : Lorsque vous voyez un avertissement, mettez à jour le compte pour qu'il corresponde au CoA actuel de la société. Vos données restent propres pour le reporting.
  - **Désactivez plutôt que de supprimer** : La désactivation préserve l'historique. Ne supprimez que les comptes créés par erreur et jamais utilisés.
  - **Les imports CSV sont additifs** : L'import ajoute les nouveaux comptes et met à jour les existants (correspondance par coa_code + account_number). Il ne supprime pas les comptes absents du fichier.
  - **Les comptes de consolidation sont essentiels pour les groupes** : Si vous opérez dans plusieurs pays, configurez les correspondances de consolidation dès le premier jour. Le reporting de groupe devient simple et les utilisateurs locaux continuent de travailler avec les comptes qu'ils connaissent.
  - **IFRS comme norme de consolidation** : La plupart des groupes européens consolident en IFRS. Tous les modèles intégrés sont déjà associés aux 14 mêmes comptes de consolidation IFRS : le reporting de groupe fonctionne entre pays sans configuration supplémentaire.
  - **Liens directs** : L'URL conserve le CoA sélectionné, l'ordre de tri, le texte de recherche et les filtres. Partagez ou ajoutez un lien à vos favoris pour retrouver exactement la même vue.

## Scénarios courants

### Scénario 1 : Organisation multi-pays

Vous avez des filiales en France, au Royaume-Uni et en Allemagne, chacune soumise à ses normes comptables locales.

**Configuration** :
  1. Chargez trois modèles : **FR-PCG v1.0**, **GB-UKGAAP v1.0**, **DE-SKR03 v1.0** (ou v2.0 pour plus de détail)
  2. Définissez chacun comme défaut de son pays
  3. Assignez les sociétés à leurs CoA respectifs
  4. Les nouvelles sociétés reçoivent automatiquement le bon CoA ; la sélection de comptes est filtrée en conséquence
  5. Les correspondances de consolidation sont déjà en place : les rapports de groupe fonctionnent immédiatement

### Scénario 2 : Migration des comptes historiques vers un CoA

Vous avez 50 comptes et 5 sociétés, tous configurés avant l'arrivée des plans comptables.

**Étapes de migration** :
  1. Créez un CoA (ex. : `US-GAAP`)
  2. Exportez vos comptes en CSV
  3. Ajoutez une colonne `coa_code` (ex. : `US-GAAP`) à toutes les lignes
  4. Importez le CSV mis à jour (les comptes appartiennent désormais au CoA)
  5. Assignez le CoA à vos sociétés
  6. Modifiez les postes OPEX/CAPEX qui affichent un avertissement « compte obsolète »

### Scénario 3 : Changement de CoA d'une société

Votre filiale britannique passe du UK GAAP à l'IFRS.

**Étapes** :
  1. Créez un nouveau CoA : `UK-IFRS` (ou chargez-le depuis un modèle)
  2. Dans l'onglet Vue d'ensemble de la société, remplacez le plan comptable par `UK-IFRS`
  3. Désormais, les utilisateurs ne peuvent sélectionner que des comptes de `UK-IFRS`
  4. Les postes OPEX/CAPEX existants conservent leurs anciens comptes mais affichent des avertissements
  5. Mettez à jour les postes selon les besoins (ou laissez les données historiques en l'état si le reporting le permet)

### Scénario 4 : Mettre en place la consolidation de groupe (multi-pays)

Votre groupe a des filiales en France, au Royaume-Uni et en Allemagne. Chaque pays utilise sa norme comptable locale, mais vous avez besoin d'un reporting IFRS consolidé.

**Configuration** :
  1. Chargez les modèles pays avec consolidation IFRS intégrée :
      - **FR-PCG v1.0** : Plan Comptable Général français (20 comptes)
      - **GB-UKGAAP v1.0** : UK GAAP (20 comptes)
      - **DE-SKR03 v1.0** : Standardkontenrahmen 03 (20 comptes)

  2. Chaque compte de ces modèles est déjà associé à l'un des 14 comptes de consolidation IFRS. Par exemple :
      - FR-PCG `205000` (Logiciels informatiques) -> IFRS `1100` (Immobilisations incorporelles)
      - GB-UKGAAP `510` (Capitalized Software) -> IFRS `1100` (Immobilisations incorporelles)
      - DE-SKR03 `27` (EDV-Software) -> IFRS `1100` (Immobilisations incorporelles)

  3. Définissez chaque CoA comme défaut de son pays et assignez les sociétés

**Résultat** :
  - Les utilisateurs français travaillent au quotidien avec les comptes du PCG et leurs noms locaux en français
  - Les utilisateurs britanniques travaillent avec les comptes UK GAAP
  - Les utilisateurs allemands travaillent avec les comptes SKR03 et leurs noms locaux en allemand
  - La finance groupe produit des rapports par compte de consolidation pour voir les dépenses totales par catégorie IFRS
  - Aucun travail de correspondance manuel : les modèles s'en chargent
  - Le reporting statutaire local et le reporting IFRS de groupe fonctionnent tous deux à partir des mêmes données

## Questions fréquentes

**Q : Un compte peut-il appartenir à plusieurs CoA ?**
R : Non. Chaque compte appartient à un seul CoA (ou à aucun pour les comptes historiques). Si vous avez besoin de la même structure de comptes dans plusieurs CoA, chargez le modèle dans chacun d'eux ou utilisez l'export/import CSV avec des valeurs de `coa_code` différentes.

**Q : Que se passe-t-il si je supprime un plan comptable ?**
R : La suppression est bloquée si des sociétés le référencent ou si des postes OPEX/CAPEX utilisent ses comptes. Réassignez d'abord les sociétés et mettez à jour les postes, puis supprimez le CoA. La suppression d'un CoA supprime aussi tous ses comptes qui ne sont pas référencés ailleurs.

**Q : Puis-je modifier les numéros de compte ?**
R : Oui, dans l'espace de travail du compte. Changer le numéro de compte met automatiquement à jour toutes les références dans les postes OPEX/CAPEX (l'UUID du compte reste le même en interne).

**Q : Comment voir quelles sociétés utilisent un CoA donné ?**
R : Ouvrez **Gérer** sur la page Plans comptables, sélectionnez le CoA et consultez **Sociétés associées** dans le panneau de détails. Vous pouvez aussi filtrer la page Sociétés par CoA.

**Q : Que faire si mon pays n'a pas de modèle ?**
R : KANAP inclut des modèles pour 9 pays (FR, DE, GB, ES, IT, NL, BE, CH, US) plus IFRS comme norme globale. Si votre pays n'est pas couvert, créez un CoA de zéro et ajoutez les comptes manuellement ou par import CSV. Vous pouvez tout de même utiliser les numéros de comptes de consolidation IFRS (1000-2900) dans vos correspondances de consolidation pour rester compatible avec les modèles intégrés.

**Q : Quelle est la différence entre les modèles v1.0 et v2.0 ?**
R : La **v1.0 (Simple)** compte environ 20 comptes centrés sur l'IT qui couvrent les catégories de coûts essentielles. La **v2.0 (Détaillé)** ajoute une dizaine de sous-comptes plus fins pour un suivi plus précis (ex. : séparer les abonnements SaaS des licences perpétuelles, ou les salaires IT des primes). Les deux versions utilisent les mêmes correspondances de consolidation. Commencez par la v1.0 et passez à la v2.0 si vous avez besoin de plus de détail.

**Q : Puis-je modifier les comptes issus d'un modèle ?**
R : Oui. Une fois le modèle chargé, les comptes sont copiés dans votre CoA et entièrement modifiables. Les modifications du modèle de la plateforme n'affectent pas votre CoA, sauf si vous le rechargez explicitement (ce qui écrase vos modifications si vous choisissez le mode « écraser »).

**Q : Les correspondances de consolidation sont-elles obligatoires ?**
R : Non, elles sont facultatives. Si vous n'opérez que dans un pays ou n'avez pas besoin de consolidation de groupe, vous pouvez laisser ces champs vides. Les comptes de consolidation ne sont utiles qu'aux organisations multi-pays qui publient un reporting de groupe dans une norme différente de leur comptabilité locale.

**Q : Plusieurs comptes locaux peuvent-ils être associés au même compte de consolidation ?**
R : Oui, c'est justement le principe. De nombreux comptes locaux de différents CoA peuvent être associés au même compte de consolidation. C'est ainsi que vous regroupez les coûts de plusieurs pays dans une même catégorie consolidée.

**Q : Que se passe-t-il si je modifie une correspondance de consolidation ?**
R : Les postes OPEX/CAPEX ne stockent pas directement de données de consolidation : ils référencent le compte, qui porte la correspondance. Lorsque vous modifiez une correspondance, tous les postes passés et futurs qui utilisent ce compte sont rapportés sous le nouveau compte de consolidation. Modifiez les correspondances avec prudence si vous devez conserver les catégories de reporting historiques.
