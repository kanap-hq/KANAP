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
- Survolez une pastille pour voir le nom du CoA, ses pays, son nombre de comptes et ses rôles. Voir [Rôles des plans](#roles-des-plans).

Si vous avez l'autorisation `accounts:manager`, deux contrôles supplémentaires apparaissent à droite :

- **Nouveau** : Ouvre la boîte de dialogue **Nouveau plan comptable**.
- **Gérer les plans** : Ouvre la fenêtre [Gérer les plans](#la-fenetre-gerer-les-plans).

Lorsqu'aucun CoA n'existe, la barre de pastilles vous invite à créer votre premier plan comptable.

### Résumé du CoA

Sous la barre de pastilles, un résumé indique le **code** et le **nombre de comptes** du CoA sélectionné. Une deuxième ligne donne son **nom**, ses **pays** et ses **rôles** en toutes lettres, par exemple « Plan comptable français · France · Plan par défaut du pays (France) ».

### Ligne de suivi de la consolidation

Lorsque votre espace de travail a un [plan de consolidation](#le-plan-de-consolidation), une troisième ligne indique dans quelle mesure le CoA sélectionné s'y rattache. Elle n'apparaît pas sur le plan de consolidation lui-même, car ses comptes sont les comptes du groupe.

Dans les exemples ci-dessous, `IFRS` représente le code de votre plan de consolidation.

- **Tous les comptes sont rattachés au plan de consolidation IFRS.** Chaque compte a un compte de consolidation qui existe dans le plan de consolidation.
- **N comptes pointent vers un compte de consolidation absent de IFRS** : ces comptes gardent un numéro que le plan de consolidation ne contient pas.
- **N comptes n'ont pas de compte de consolidation** : ces comptes ne sont pas encore rattachés.

Chaque nombre est un lien. Cliquez dessus pour filtrer la grille sur ces comptes. Le filtre affiche les comptes de tous les statuts : les comptes désactivés sont donc comptés et listés aussi. Cliquez de nouveau sur le nombre, ou sur **Afficher tous les comptes**, pour revenir à la liste normale. Le filtre est aussi retiré lorsque vous choisissez une autre pastille. Lorsque vous ouvrez un compte depuis une liste filtrée, les flèches précédent et suivant de l'espace de travail parcourent la même liste filtrée.

Dans la grille, un petit point orange à côté de **N° compte de consolidation** signale un compte dont le numéro n'est pas dans le plan de consolidation. Survolez le point pour voir le nom du plan de consolidation.

Sans plan de consolidation, la ligne indique « Aucun plan de consolidation. ». Les gestionnaires peuvent cliquer sur **Choisissez-en un dans Gérer les plans** pour ouvrir la fenêtre.

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
- **Nouveau compte** (`accounts:manager`) : Ouvre un nouveau formulaire de compte avec le CoA sélectionné déjà choisi.
- **Import CSV** (`accounts:admin`) : Importer des comptes dans le CoA sélectionné.
- **Export CSV** (`accounts:admin`) : Exporter les comptes du CoA sélectionné.
- **Supprimer la sélection** (`accounts:admin`) : Supprimer les lignes de comptes sélectionnées. Sélectionnez les lignes avec la colonne de cases à cocher (visible par les administrateurs).

Toutes les cellules sont des liens cliquables vers l'espace de travail du compte. Vous pouvez faire un clic droit ou Ctrl+clic pour ouvrir dans un nouvel onglet.

## L'espace de travail du compte

Cliquez sur n'importe quelle ligne de la grille des comptes pour ouvrir l'espace de travail du compte.

### Disposition

- **En-tête** : le numéro de compte sert de référence (vous pouvez le copier à cet endroit) et le nom du compte sert de titre. Cliquez sur le titre pour renommer le compte. Les flèches **Compte précédent** et **Compte suivant** parcourent les comptes de la liste d'où vous venez, dans le même ordre, avec la même recherche et les mêmes filtres. Le lien de retour ramène à **Plans comptables** en conservant votre sélection.
- **Panneau des propriétés** à droite : **Plan comptable**, **Numéro de compte** et **Cycle de vie** (l'interrupteur de statut et la date de **Fin de validité**). Le bouton du panneau permet de le réduire ou de le rouvrir. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie).
- **Colonne principale** : **Nom local (langue locale)**, **Description** et la section **Consolidation**.

**Les modifications s'enregistrent automatiquement.** Chaque champ s'enregistre lorsque vous le quittez, et il n'y a pas de bouton Enregistrer. Si une valeur est refusée, un message apparaît sous le champ. Le **Numéro de compte** doit être un nombre entier supérieur à zéro.

Vous avez besoin de `accounts:manager` pour modifier. Les utilisateurs en lecture seule voient la même page, avec les champs verrouillés.

### Compte de consolidation

La section **Consolidation** contient un seul champ, **Compte de consolidation**. C'est une liste des comptes de votre [plan de consolidation](#le-plan-de-consolidation), affichés avec leur numéro et leur nom. Choisissez-en un pour y rattacher le compte, ou choisissez **Aucun** pour supprimer le rattachement.

- Vous choisissez le numéro. Le nom et la description du compte de consolidation viennent du plan de consolidation et s'affichent sous le champ. Vous ne pouvez pas les saisir.
- Les comptes désactivés du plan de consolidation ne sont proposés que si le compte y est déjà rattaché. Ils portent la mention **Désactivé**.
- Si le numéro enregistré n'existe pas dans le plan de consolidation, il reste visible avec un point orange et le message « Ce numéro n'existe pas dans le plan de consolidation IFRS. Choisissez un compte de IFRS. » Choisissez un compte valide pour corriger.
- Sans plan de consolidation, le champ est verrouillé et indique « Aucun plan de consolidation n'est défini. » avec un lien vers **Plans comptables > Gérer les plans**.

### Créer un compte

**Nouveau compte** dans la liste ouvre un court formulaire avec le plan que vous consultiez déjà sélectionné. Renseignez le plan, le numéro de compte et le nom, ainsi que les champs facultatifs, puis cliquez sur **Créer le compte**. Après la création, le compte s'ouvre dans l'espace de travail et s'enregistre ensuite automatiquement.

## Configurer les plans comptables

### Créer un CoA

Cliquez sur **Nouveau** dans la barre de pastilles, ou sur **Nouveau plan** dans la fenêtre Gérer les plans. Vous pouvez créer un CoA de deux façons :

1. **Un plan vide** : ajoutez les comptes plus tard, un par un ou par import CSV.
2. **Un modèle** : chargez un ensemble de comptes préconfiguré, géré par les administrateurs de la plateforme.

**Champs de la boîte de dialogue de création** :
- **Partir de** : **Un plan vide** ou **Un modèle**.
- **Modèle** (mode modèle uniquement) : Choisissez un modèle dans la liste. Chaque entrée indique son nom, ses pays et sa version. Le choix d'un modèle renseigne le nom et le code, que vous pouvez modifier.
- **Code** (obligatoire) : Un identifiant court et stable, utilisé dans les fichiers CSV et les liens.
- **Nom** (obligatoire) : Un nom descriptif pour le CoA.
- **Utilisé pour** : **Un pays** ou **Tous les pays**. Un modèle global crée toujours un plan pour **Tous les pays**.
- **Pays** (un pays uniquement) : Choisissez un pays dans la liste.
- **En faire le plan par défaut pour {pays}** (un pays uniquement) : Cochez pour faire de ce CoA le plan par défaut du pays choisi.

En mode modèle, cliquez sur **Vérifier le modèle** avant de créer pour voir combien de comptes seront ajoutés et combien mis à jour. Cliquez ensuite sur **Créer**.

Un nouveau plan n'a aucun rôle, hormis le plan par défaut d'un pays que vous cochez ici. Pour lui donner un autre rôle, utilisez [Gérer les plans](#la-fenetre-gerer-les-plans).

### Charger depuis les modèles

Les modèles sont des ensembles de comptes standard gérés par les administrateurs de la plateforme. Ils peuvent être :
  - Propres à un pays (ex. : PCG français, UK GAAP)
  - Globaux (disponibles pour tous les pays)

**Fonctionnement** :
  - Allez dans **Données de référence -> Plans comptables**
  - Cliquez sur **Nouveau** dans la barre de pastilles
  - Sous **Partir de**, choisissez **Un modèle**
  - Sélectionnez un modèle. Les modèles globaux affichent « Tous les pays » et créent un plan pour tous les pays ; les modèles pays affichent leur pays
  - Cliquez sur **Vérifier le modèle** pour voir combien de comptes seront ajoutés et combien mis à jour
  - Cliquez sur **Créer** pour copier les comptes dans votre CoA

**Ce qui est copié** : Numéros de comptes, noms, noms locaux (langue locale), descriptions, correspondances de consolidation et statut. Les comptes deviennent les vôtres et sont modifiables. Les modifications du modèle de la plateforme n'affectent pas votre CoA, sauf si vous le rechargez explicitement. Si votre espace de travail a un plan de consolidation, le nom et la description de consolidation de chaque compte sont repris de ce plan (voir [Le plan de consolidation](#le-plan-de-consolidation)).

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

### Nouveaux espaces de travail (provisionnement)

Les nouveaux espaces de travail sont automatiquement provisionnés avec le modèle **IFRS v1.0**. Cela crée un CoA pour tous les pays, contenant les 14 comptes de consolidation IFRS. Il est à la fois le **Plan par défaut des autres pays** et le **Plan de consolidation** : les sociétés et le reporting de groupe fonctionnent donc immédiatement, sans configuration. Vous pouvez ensuite modifier ou supprimer les comptes et le plan préchargés si nécessaire (dans le respect des garde-fous habituels).

## Rôles des plans

Un plan peut avoir jusqu'à trois rôles. Ils sont indépendants et chacun s'affiche en toutes lettres dans l'infobulle de la pastille, dans le résumé et dans **Gérer les plans**.

| Rôle | Ce qu'il fait | Combien |
|------|---------------|---------|
| **Plan par défaut du pays ({pays})** | Proposé lorsque vous créez une société dans ce pays | Un par pays. Pour les plans d'un seul pays |
| **Plan par défaut des autres pays** | Utilisé pour les sociétés d'un pays sans plan par défaut. Il est aussi attribué aux sociétés sans plan comptable | Un par espace de travail. Pour les plans de tous les pays |
| **Plan de consolidation** | Les comptes du groupe auxquels chaque compte local est rattaché pour le reporting consolidé | Un par espace de travail. N'importe quel plan |

Le point de départ habituel est un plan IFRS qui porte à la fois **Plan par défaut des autres pays** et **Plan de consolidation**, plus un plan local par pays qui porte **Plan par défaut du pays ({pays})**. Vous pouvez séparer les rôles, par exemple un plan de groupe qui est le plan de consolidation alors qu'un autre plan pour tous les pays sert les autres pays. Un plan peut aussi n'avoir aucun rôle.

Chaque rôle a un seul titulaire (un par pays pour le plan par défaut d'un pays). Donner un rôle à un autre plan le retire au titulaire précédent.

## Gérer les plans comptables

### La fenêtre Gérer les plans

Cliquez sur **Gérer les plans** dans la barre de pastilles pour ouvrir la fenêtre. Un tableau liste tous les plans :

- **Code** et **Nom**
- **Pays** : le pays du plan, ou « Tous les pays »
- **Rôles** : les rôles du plan en toutes lettres, ou un tiret s'il n'en a aucun
- **Sociétés** : le nombre de sociétés assignées au plan
- **Comptes** : le nombre de comptes du plan

Trois courtes lignes sous le tableau expliquent les rôles. **Nouveau plan** (`accounts:manager`), en bas à gauche, ouvre la boîte de dialogue de création.

Chaque ligne a un menu **⋯** qui ne propose que les actions applicables à ce plan. Le libellé suit l'état actuel.

- **Définir comme plan par défaut du pays** / **Ne plus utiliser comme plan par défaut du pays** (`accounts:manager`) : pour les plans d'un seul pays.
- **Définir par défaut pour les autres pays** / **Ne plus utiliser par défaut pour les autres pays** (`accounts:manager`) : pour les plans de tous les pays. En le définissant par défaut, vous l'attribuez aussi aux sociétés qui n'ont pas de plan comptable.
- **Définir comme plan de consolidation** / **Ne plus utiliser comme plan de consolidation** (`accounts:manager`) : pour n'importe quel plan. Voir [Modifier le plan de consolidation](#modifier-le-plan-de-consolidation).
- **Supprimer** (`accounts:admin`) : Supprime le plan avec ses comptes. Si le plan contient des comptes, une confirmation indique combien sont supprimés. S'il s'agit du plan de consolidation, la confirmation précise que le reporting de groupe n'aura plus de plan de référence. La suppression est refusée tant que des sociétés utilisent le plan ou que des postes OPEX/CAPEX utilisent ses comptes, et la fenêtre en indique la raison.

Les rôles changent dès que vous choisissez une action. Le tableau se met à jour immédiatement.

## Gérer les comptes

### Numéros de compte

Un numéro de compte est un nombre entier supérieur à zéro (par exemple `6011`). Au sein d'un CoA, chaque numéro n'est utilisé qu'une fois.

### Noms locaux pour le multilinguisme

Certains pays exigent que les comptes soient enregistrés dans la langue locale. Utilisez le champ **Nom local** pour stocker le nom d'origine tout en conservant le nom anglais dans le champ principal **Nom du compte**.

**Exemple** : Compte français
  - **Nom du compte** : `Travel expenses` (anglais, pour le reporting)
  - **Nom local** : `Frais de deplacement` (français, pour la conformité légale)

Le nom local est disponible dans une colonne masquée de la grille des comptes. Activez-la depuis le sélecteur de colonnes pour voir les deux noms côte à côte.

## Comptes de consolidation (reporting de groupe)

Dans les organisations multi-pays, le travail quotidien se fait avec les plans comptables locaux (PCG français, UK GAAP, HGB allemand, etc.), mais le reporting de groupe exige souvent une consolidation vers une norme commune comme **IFRS** ou **US GAAP**.

Les **comptes de consolidation** répondent à ce besoin en rattachant les comptes locaux aux comptes d'un plan de référence.

### Le plan de consolidation

Votre espace de travail a au plus un **Plan de consolidation**. Il contient les comptes du groupe auxquels chaque compte local est rattaché. Il est indépendant des plans par défaut : n'importe quel plan peut être le plan de consolidation, y compris un plan qui est aussi le plan par défaut des autres pays.

Sur chaque compte local, vous choisissez un **Compte de consolidation** parmi les comptes du plan de consolidation. Le numéro fait le lien. Le nom et la description du compte de consolidation viennent automatiquement du plan de consolidation : ils correspondent donc toujours à ses comptes.

**Exemple de correspondance** :

| Pays | CoA local | Compte local | Nom local | -> | Compte de consolidation | Nom de consolidation |
|---------|-----------|---------------|------------|---|----------------------|-------------------|
| France | FR-PCG | 6061 | Frais postaux | -> | 6200 | IT Services and Software |
| Royaume-Uni | UK-GAAP | 5200 | Postage and courier | -> | 6200 | IT Services and Software |
| Allemagne | DE-HGB | 4920 | Portokosten | -> | 6200 | IT Services and Software |

Les trois comptes locaux sont rattachés au même compte de consolidation `6200`, ce qui permet l'agrégation au niveau du groupe.

**Ce qui reste synchronisé** :

  - Lorsque vous renommez un compte du plan de consolidation, modifiez sa description ou lui donnez un nouveau numéro, tous les comptes qui y sont rattachés suivent. Leur numéro, leur nom et leur description sont mis à jour partout, en une seule opération.
  - Lorsque vous rattachez un compte à un numéro qui existe dans le plan de consolidation, le nom et la description de consolidation sont renseignés pour vous.

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
Tous les modèles intégrés incluent les correspondances de consolidation IFRS sur chaque compte. Chargez n'importe quel modèle pays et les colonnes de consolidation sont déjà remplies. Un nouvel espace de travail a déjà le plan IFRS comme plan de consolidation. Consultez [Modèles disponibles](#modeles-disponibles) pour la liste complète.

**Option 2 : Import CSV**
Lors de l'import de comptes, incluez les champs de consolidation dans votre CSV :

```
coa_code;account_number;account_name;consolidation_account_number;consolidation_account_name;consolidation_account_description
FR-PCG;6061;Frais postaux;6200;IT Services and Software;
UK-GAAP;5200;Postage and courier;6200;IT Services and Software;
DE-HGB;4920;Portokosten;6200;IT Services and Software;
```

Seul le numéro de compte de consolidation compte lorsque le plan de consolidation le contient : l'import remplace les colonnes de nom et de description par celles du plan de consolidation. Lorsque le numéro n'est pas dans le plan de consolidation, le nom et la description du fichier sont conservés, et le compte est signalé comme absent du plan de consolidation. Un numéro vide supprime le rattachement, le nom et la description.

**Option 3 : Saisie manuelle**
Ouvrez un compte et choisissez son **Compte de consolidation** dans l'espace de travail du compte.

### Modifier le plan de consolidation

1. Ouvrez **Gérer les plans** puis le menu **⋯** du plan que vous voulez utiliser.
2. Cliquez sur **Définir comme plan de consolidation**.
3. Si le plan remplace un autre plan de consolidation, ou si certains comptes pointent vers des numéros qu'il ne contient pas, une confirmation s'ouvre. Elle indique quel plan il remplace et donne les nombres : combien de comptes conservent leur compte de consolidation, combien pointent vers un numéro absent du nouveau plan, et combien n'ont pas de compte de consolidation.
4. Cliquez sur **Définir comme plan de consolidation** pour confirmer.

**Ce qu'il advient des rattachements existants** : KANAP ne rattache jamais les comptes à votre place. Chaque compte conserve son numéro de consolidation.

  - Les comptes dont le numéro existe dans le nouveau plan le conservent et reprennent le nom et la description de ce plan.
  - Les comptes dont le numéro n'existe pas dans le nouveau plan conservent leur numéro et sont signalés : la ligne de suivi les compte, un point les marque dans la grille et l'espace de travail du compte vous invite à choisir un compte valide. Filtrez-les depuis la ligne de suivi et rattachez-les un par un, ou chargez un CSV.
  - Les comptes sans numéro restent non rattachés.

Si vous choisissez **Ne plus utiliser comme plan de consolidation**, le reporting de groupe n'a plus de plan de référence. Les rattachements des comptes sont conservés.

### Bonnes pratiques

  - **Utilisez une norme commune** : IFRS est courant pour les groupes européens, US GAAP pour les sociétés américaines. Tous les modèles intégrés sont déjà associés aux 14 mêmes comptes de consolidation IFRS (voir [Consolidation IFRS intégrée](#consolidation-ifrs-integree))
  - **Gardez un seul plan de consolidation** : C'est la liste des comptes de reporting de votre groupe. Si vous utilisez les modèles intégrés, les 14 comptes IFRS servent de référence
  - **Choisissez le bon niveau de détail** : Ne consolidez ni trop large (perte d'information), ni trop fin (trop complexe)
  - **Impliquez la finance** : Les correspondances de consolidation doivent être alignées sur les exigences de reporting financier de votre groupe
  - **Mettez à jour systématiquement** : Lorsque vous ajoutez des comptes locaux, rattachez-les immédiatement à des comptes de consolidation. La ligne de suivi montre ce qui manque encore

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
  - Une fois la fin de validité passée, le statut passe à **Désactivé** de lui-même dans l'heure
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

Le CSV global `/accounts` inclut une colonne `coa_code` qui identifie le CoA de chaque compte. **Exporter CSV** et **Importer CSV** l'utilisent lorsqu'aucun CoA n'est sélectionné sur la page.

  - **Exporter CSV** : tous les comptes avec leur code CoA, numéro, nom, nom local, description, correspondances de consolidation et statut
  - **Importer CSV** : **Télécharger le modèle** dans la fenêtre donne un fichier avec les seuls en-têtes. Commencez par la **Vérification préalable** pour valider la structure, l'encodage, les champs obligatoires et les doublons, puis **Charger** pour appliquer les insertions et les mises à jour
  - **Correspondance** : par `(coa_code, account_number)` dans votre espace de travail
  - **Cellules obligatoires** : `coa_code`, `account_number`, `account_name`. Toutes les lignes d'un fichier doivent porter le même `coa_code`
  - **Cellules facultatives** : `native_name`, `description`, champs de consolidation, `status`
  - Les doublons du fichier (même coa_code + account_number) sont dédoublonnés ; la première occurrence l'emporte

**Schéma CSV** (l'export écrit le séparateur de la langue de l'écran ; montré ici avec des points-virgules) :
```
coa_code;account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

### Comptes (limités au CoA)

Depuis la page Plans comptables, **Import CSV** et **Export CSV** portent automatiquement sur le CoA sélectionné.

  - **Exporter CSV** : comptes de ce CoA (pas besoin de colonne `coa_code`)
  - **Importer CSV** : les comptes sont insérés ou mis à jour automatiquement dans ce CoA

**Schéma CSV** (limité au CoA ; montré ici avec des points-virgules) :
```
account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

**Remarques** :
  - Voir [Fichiers CSV](csv-files.md) pour l'encodage, le séparateur, les formes de dates et les deux étapes d'import
  - Le `coa_code` doit correspondre à un plan comptable existant de votre espace de travail
  - Les numéros de compte doivent être uniques au sein d'un CoA
  - Valeurs de statut : `enabled` ou `disabled` (enabled par défaut)
  - Colonnes de consolidation : lorsque `consolidation_account_number` existe dans votre plan de consolidation, son nom et sa description remplacent les cellules `consolidation_account_name` et `consolidation_account_description`. Un numéro vide efface les trois. Voir [Configurer les correspondances de consolidation](#configurer-les-correspondances-de-consolidation)

## Conseils

  - **Commencez par les modèles** : KANAP est livré avec des modèles pour 9 pays plus IFRS. Chargez-en un au lieu de partir de zéro : vous obtenez directement les bons numéros de compte, les noms locaux et les correspondances de consolidation IFRS. Commencez avec la v1.0 (Simple) en cas de doute ; passez à la v2.0 (Détaillé) si vous avez besoin de plus de détail.
  - **Un défaut par pays** : Faites d'un CoA le plan par défaut de chaque pays, pour que les nouvelles sociétés démarrent avec la bonne structure de comptes.
  - **Noms locaux pour la conformité** : Utilisez le champ **Nom local** si la réglementation locale exige les comptes dans la langue du pays. Activez la colonne **Nom local** dans la grille pour voir les deux noms d'un coup d'œil.
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
  2. Faites de chacun le plan par défaut de son pays (**Gérer les plans**, puis **Définir comme plan par défaut du pays**)
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

  3. Faites de chaque CoA le plan par défaut de son pays et assignez les sociétés

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
R : Ouvrez **Gérer les plans** sur la page Plans comptables et consultez la colonne **Sociétés** de la ligne du CoA. Vous pouvez aussi filtrer la page Sociétés par CoA.

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

**Q : Le plan de consolidation doit-il être le plan par défaut des autres pays ?**
R : Non. Les deux rôles sont indépendants. Dans la configuration habituelle, un même plan IFRS porte les deux, et vous pouvez les donner à des plans différents à tout moment dans **Gérer les plans**.

**Q : Que deviennent les comptes quand je renomme ou renumérote un compte du plan de consolidation ?**
R : Tous les comptes qui y sont rattachés suivent. Leur numéro, leur nom et leur description de consolidation sont mis à jour ensemble : les rattachements restent valides.

**Q : Pourquoi la grille affiche-t-elle un point à côté de certains numéros de consolidation ?**
R : Le point signale un compte dont le numéro de consolidation n'existe pas dans le plan de consolidation, typiquement après un changement de plan de consolidation. Ouvrez le compte et choisissez un compte de consolidation valide, ou utilisez la ligne de suivi pour les lister tous.
