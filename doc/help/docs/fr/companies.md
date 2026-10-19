# Sociétés

Les sociétés sont le socle de vos données de référence. Elles représentent les entités juridiques auxquelles vous imputez les dépenses IT et pour lesquelles vous établissez les refacturations. Chaque ventilation, ligne de dépense et de nombreux rapports font référence à une société, il est donc important de maintenir ces données à jour.

Lorsque votre espace de travail est créé, il démarre avec une société portant le nom de votre organisation. Son pays est celui que vous avez sélectionné lors de l'inscription à l'essai, et elle sera automatiquement assignée au plan comptable par défaut pour ce pays lorsqu'il est disponible. Vous pouvez la renommer ou en ajouter d'autres.

## Premiers pas

Rendez-vous dans **Données de référence > Sociétés** pour ouvrir la liste.

**Champs obligatoires** :

- **Nom** : un libellé unique que vos équipes reconnaissent
- **Pays** : code pays ISO (recherche par nom ou code)
- **Ville** : ville où la société est basée
- **Devise de base** : code devise ISO (recherche par nom ou code)

**Noms uniques** : chaque société a son propre nom, quelle que soit la casse (`Acme` et `acme` sont le même nom). Un nom déjà porté par une autre société est refusé, avec un message sous le nom.

## Travailler avec la liste

La liste affiche toutes les sociétés de votre espace de travail. Utilisez-la pour revoir les informations clés en un coup d'oeil, trouver rapidement des sociétés et ouvrir les espaces de travail pour les modifier.

**Colonnes par défaut** :

| Colonne | Ce qu'elle affiche |
|---------|-------------------|
| **Nom** | Nom de la société (cliquez pour ouvrir l'espace de travail) |
| **Pays** | Code pays ISO |
| **Devise** | Code de devise de base |
| **Effectif (année)** | Effectif pour l'année sélectionnée (cliquez pour ouvrir l'onglet Détails) |
| **Utilisateurs IT (année)** | Utilisateurs IT pour l'année sélectionnée (cliquez pour ouvrir l'onglet Détails) |
| **Chiffre d'affaires (année)** | Chiffre d'affaires pour l'année sélectionnée, en millions de la devise de base de la société, par exemple `35 M USD` (cliquez pour ouvrir l'onglet Détails) |
| **Statut** | Activé ou Désactivé |

**Colonnes supplémentaires** (masquées par défaut, ajoutez-les via le sélecteur de colonnes) :

| Colonne | Ce qu'elle affiche |
|---------|-------------------|
| **Ville** | Ville |
| **Code postal** | Code postal |
| **Adresse 1** | Ligne d'adresse principale |
| **Adresse 2** | Ligne d'adresse secondaire |
| **État** | État ou province |
| **Notes** | Notes en texte libre |
| **Créé** | Date et heure de création de l'enregistrement |

**Filtrage** :

- **Recherche rapide** : recherche en texte libre dans toutes les colonnes visibles
- **Filtres de colonnes** : cliquez sur n'importe quel en-tête de colonne pour filtrer par valeur ; les colonnes numériques (Effectif, Utilisateurs IT, Chiffre d'affaires) supportent les filtres numériques
- **Périmètre par statut** : le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la liste contrôle quelles sociétés apparaissent. Par défaut, la liste affiche les sociétés activées

**Sélecteur d'année** : utilisez le champ **Année** dans la barre d'outils pour changer quelle année de métriques est affichée. La ligne du bas affiche les **totaux** pour Effectif, Utilisateurs IT et Chiffre d'affaires pour toutes les sociétés visibles (filtrées).

**Valeurs des métriques** :

- Une métrique jamais saisie pour l'année s'affiche **—**. Un zéro saisi s'affiche **0**
- Les nombres suivent la langue de KANAP : virgule décimale en français, en allemand et en espagnol, point décimal en anglais
- Le chiffre d'affaires de chaque ligne est dans la devise de base de la société. La ligne **Total** est dans la devise de reporting : chaque chiffre d'affaires est converti aux taux de l'année. Quand la colonne budgétaire par défaut de l'année est gelée, ce sont les taux qu'elle a figés. Sinon, ce sont les taux courants (voir [Paramètres de devises](currencies.md))
- Quand une devise n'a pas encore de taux, son chiffre d'affaires est laissé hors du total et le total le signale, par exemple « 1 250 M EUR (pas encore de taux pour BRL) ». KANAP va chercher le taux manquant lors de la prochaine mise à jour des taux

**Actions** :

- **Nouveau** : créer une société (nécessite `companies:member`)
- **Import CSV** : import en masse de sociétés depuis un fichier CSV (nécessite `companies:admin`)
- **Export CSV** : exporter les sociétés et leurs métriques en CSV (nécessite `companies:admin`)
- **Supprimer la sélection** : supprimer une ou plusieurs sociétés sélectionnées (nécessite `companies:admin` ; possible uniquement si rien ne référence la société)

**Contexte de recherche** : lorsque vous ouvrez l'espace de travail d'une société depuis la liste, votre recherche, vos filtres, votre tri et votre année sont préservés. Revenir à la liste restaure votre vue précédente.

## Autorisations

| Action | Niveau requis |
|--------|---------------|
| Consulter la liste et les espaces de travail | `companies:reader` |
| Créer ou modifier des sociétés | `companies:member` |
| Importer, exporter ou supprimer | `companies:admin` |

## L'espace de travail de la société

Cliquez sur n'importe quelle ligne de la liste pour ouvrir l'espace de travail de la société. Il comporte deux onglets : **Vue d'ensemble** et **Détails**.

- **En-tête** : le nom de la société. Cliquez dessus pour renommer la société. Les flèches avec « N sur M » permettent de passer d'une société à l'autre dans l'ordre et avec les filtres de la liste, sans revenir à la liste. Le lien de retour, **Sociétés**, ramène à la liste avec votre contexte de recherche intact
- **Statut**, sous le nom : **Activé** ou **Désactivé**. Cliquez dessus pour le changer. Choisir **Désactivé** désactive la société aussitôt : la fin de validité devient l'heure actuelle
- **Panneau Propriétés** à droite : **Pays**, **Devise de base**, **Plan comptable** et **Cycle de vie**. Utilisez le bouton situé à côté pour replier le panneau ou le rouvrir

- **Supprimer**, en haut à droite : visible des administrateurs des sociétés (`companies:admin`). Voir [Supprimer une société](#supprimer-une-societe)

**Enregistrement automatique** : chaque modification s'enregistre d'elle-même quand vous quittez le champ. Il n'y a ni bouton Enregistrer, ni bouton Réinitialiser, ni bouton Fermer. Vous pouvez continuer à travailler pendant l'enregistrement. Le haut de la page affiche **Enregistrement…** pendant l'enregistrement, puis **Enregistré** un court instant. Lorsqu'une modification est refusée, le champ reprend sa valeur précédente et la raison s'affiche dessous. Le message reste jusqu'à ce que vous tapiez de nouveau dans le champ.

---

### Panneau Propriétés

- **Pays** (obligatoire) : code pays ISO, recherche par nom ou code. Changer le pays fait aussi passer le **Plan comptable** à celui par défaut du nouveau pays, mais seulement si le plan actuel appartient à un autre pays. Un plan comptable global reste en place
- **Devise de base** (obligatoire) : code devise ISO, recherche par nom ou code
- **Plan comptable** : le plan comptable lié à cette société (voir [Plan comptable](#plan-comptable)). Sur une société existante, vous pouvez choisir un autre plan, mais vous ne pouvez pas vider le champ, car le plan par défaut du pays reviendrait
- **Cycle de vie** : l'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité**. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie)

---

### Vue d'ensemble

L'onglet Vue d'ensemble contient l'adresse, les informations d'immatriculation et les notes. Le nom, le pays, la devise, le plan comptable et le cycle de vie se trouvent dans l'en-tête et le panneau **Propriétés**.

**Ce que vous pouvez modifier** :

- Section **Adresse** :
    - **Adresse ligne 1**, **Adresse ligne 2** : lignes d'adresse
    - **Code postal** : code postal
    - **Ville** (obligatoire) : nom de la ville. Une ville vide est refusée avec « Saisissez une ville. »
    - **Région ou État** : état, province ou région
- Section **Immatriculation** :
    - **Numéro d'immatriculation** : numéro d'immatriculation de la société
    - **Numéro de TVA** : numéro d'identification TVA
- **Notes** : notes en texte libre

**Créer une société** : **Nouveau** ouvre un formulaire unique avec le nom, **Pays**, **Devise de base**, **Plan comptable**, **Ville**, les autres champs d'adresse, les champs d'immatriculation et **Notes**. Le choix d'un pays renseigne le **Plan comptable** à votre place : le plan par défaut du pays s'il en existe un, sinon un plan global. Vous pouvez le modifier avant d'enregistrer. Cliquez sur **Créer** pour enregistrer la société. L'onglet **Détails** devient disponible après la création de la société.

---

### Détails

L'onglet Détails gère les **métriques annuelles**. Utilisez les onglets d'année en haut pour basculer entre les années (année en cours plus deux ans avant et après).

**Ce que vous pouvez modifier** :

- **Effectif** (obligatoire) : nombre total d'employés pour l'année, doit être un nombre entier de zéro ou plus
- **Utilisateurs IT** (optionnel) : nombre d'utilisateurs IT, doit être un nombre entier de zéro ou plus
- **Chiffre d'affaires** (optionnel) : chiffre d'affaires en millions de la devise de base de la société, jusqu'à 3 décimales. Le libellé nomme la devise, par exemple **Chiffre d'affaires (M USD)**

**Comment ça fonctionne** :

- Chaque valeur est enregistrée pour l'année sélectionnée quand vous quittez le champ (ou appuyez sur Entrée). Une valeur non valide affiche un message sous le champ, par exemple « Saisissez un nombre entier, 0 ou plus. » Le champ reprend la valeur enregistrée, et le message reste jusqu'à ce que vous tapiez de nouveau
- Les nombres suivent la langue de KANAP : tapez `12,5` en français, en allemand ou en espagnol, et `12.5` en anglais
- Chaque année est enregistrée séparément : changer d'année charge les valeurs de cette année
- Si les chiffres de la société pour l'année sont **gelés**, les champs sont verrouillés et un avis indique qu'un administrateur budgétaire peut les dégeler (**Gestion budgétaire > Administration > Geler les données de référence**)
- Vous avez besoin de `companies:member` pour modifier les métriques

## Plan comptable

Chaque société peut être liée à un **Plan comptable** (CoA), qui définit l'ensemble des comptes disponibles lors de l'enregistrement de lignes OPEX ou CAPEX pour cette société.

**Comment ça fonctionne** :

- Lorsque vous créez une société, elle est automatiquement assignée au CoA par défaut pour son pays (si un tel CoA existe). S'il n'y a pas de CoA par défaut pour le pays, le plan qui porte le rôle **Plan par défaut des autres pays** est utilisé.
- Vous pouvez changer l'assignation du CoA dans le panneau **Propriétés** en utilisant le sélecteur **Plan comptable**. Le sélecteur affiche les CoA correspondant au pays de la société plus les CoA de portée globale.
- Lorsque vous changez le pays de la société, le CoA suit si l'actuel appartient à un autre pays : il passe à celui par défaut du nouveau pays. Un CoA global reste en place.
- Sur une société existante, le CoA ne peut pas être vidé. Vous pouvez seulement le remplacer par un autre.
- Le CoA que vous sélectionnez détermine quels comptes apparaissent dans le menu déroulant des comptes lors de la création ou modification de lignes de dépenses pour cette société.

**Ce que cela signifie pour votre flux de travail** :

- **Sociétés avec un CoA** : lors de l'enregistrement d'OPEX/CAPEX, vous ne pouvez sélectionner que des comptes appartenant au plan comptable de cette société. Cela garantit la cohérence comptable.
- **Sociétés sans CoA** (historique) : peuvent utiliser des comptes qui n'appartiennent à aucun plan comptable. Cela supporte la migration progressive vers le système de CoA.
- **Changer de CoA** : si vous basculez une société vers un autre CoA, les lignes de dépenses existantes conservent leurs comptes actuels (avec un avertissement s'ils ne correspondent pas au nouveau CoA), mais les nouvelles lignes utiliseront les comptes du nouveau CoA.

**Configurer les plans comptables** : rendez-vous dans **Données de référence > Plans comptables** pour consulter, créer ou gérer vos ensembles de CoA. Vous pouvez créer des CoA de zéro ou les charger depuis des modèles de la plateforme (ensembles de comptes standard par pays). Chaque pays peut avoir un CoA par défaut (**Plan par défaut du pays ({pays})**), proposé lorsque vous créez une société dans ce pays. Les sociétés d'un pays sans plan par défaut utilisent le plan **Plan par défaut des autres pays**. Voir [Rôles des plans](chart-of-accounts.md#roles-des-plans).

**Conseil** : Si vous voyez un avertissement « compte obsolète » lors de la modification de lignes OPEX/CAPEX, cela signifie que le compte n'appartient pas au plan comptable actuel de la société. Mettez à jour le compte vers un compte du bon CoA pour résoudre cet avertissement.

## Statut et cycle de vie

Utilisez la **Fin de validité** pour contrôler quand une société cesse d'être active.

- Les sociétés sont **Activées** par défaut. Laissez la **Fin de validité** vide pour que la société reste active indéfiniment, ou programmez une date future.
- Passer à **Désactivé** fixe la fin de validité à maintenant : la désactivation est immédiate. Tant qu'une date future est fixée, l'interrupteur affiche **Actif jusqu'au** et cette date.
- Une fois la fin de validité passée, le statut passe à **Désactivé** de lui-même dans l'heure.
- Après la fin de validité :
    - La société n'apparaît plus dans les listes de sélection pour les nouvelles ventilations et est exclue des rapports pour les années strictement postérieures.
    - Les données historiques restent intactes ; la société apparaît toujours dans les rapports couvrant les années où elle était active.
- **Préférez la désactivation à la suppression.** Une société encore utilisée ne peut pas être supprimée : lignes budgétaires (comme société payeuse ou dans leurs ventilations), contrats, centres de coûts, départements, utilisateurs, sites qu'elle exploite, tâches, applications, interfaces, projets et demandes du portefeuille, et membres d'équipe dont elle est la société par défaut. Le message compte ce qui l'utilise, par exemple « Cette société est utilisée par 2 départements et 14 utilisateurs ». Désactivez-la à la place. Ses métriques annuelles sont supprimées avec elle. Dans la liste, la confirmation nomme les sociétés ainsi conservées, avec ce qui les utilise, avant toute suppression.
- **Pour supprimer une société malgré tout**, retirez d'abord ce qui l'utilise. Indiquez une autre société sur ses utilisateurs, ses lignes budgétaires et leurs ventilations, ses contrats, ses centres de coûts, les sites qu'elle exploite, ses tâches, applications, interfaces, projets et demandes du portefeuille, et ses membres d'équipe. Déplacez ses départements vers une autre société, ou supprimez-les en dernier, quand plus rien ne les utilise. Supprimez ensuite la société.

## Supprimer une société

Un administrateur des sociétés (`companies:admin`) peut supprimer une société depuis sa fiche avec **Supprimer**, ou plusieurs depuis la liste avec **Supprimer la sélection**.

- KANAP vérifie d'abord. Quand quelque chose utilise la société, le dialogue dit quoi, par exemple « Cette société est utilisée par 2 départements et 14 utilisateurs. Désactivez-la plutôt que de la supprimer. », et propose seulement **Fermer**. Désactivez alors la société (voir [Statut et cycle de vie](#statut-et-cycle-de-vie))
- Sinon, le dialogue demande confirmation : « Cette action est irréversible. » **Supprimer** supprime la société avec ses métriques annuelles et revient à la liste
- Une société supprimée quitte la tuile **Consultés récemment** de [Mon tableau de bord](my-dashboard.md#recemment-consultes)

## Métriques annuelles

De nombreuses parties de l'application sont sensibles à l'année. Les sociétés ont des métriques par année :

- **Effectif** (obligatoire pour l'année)
- **Utilisateurs IT** (optionnel)
- **Chiffre d'affaires** (optionnel, en millions de la devise de base de la société)

**Où c'est important** :

- Les ventilations peuvent utiliser l'Effectif, les Utilisateurs IT ou le Chiffre d'affaires pour répartir les coûts entre les sociétés pour une année donnée. Les chiffres d'affaires en devises différentes sont d'abord convertis dans la devise de reporting. Voir [Ventilations](budget-lines.md#ventilations).
- Les rapports utilisent ces métriques pour les KPI et les ratios.
- Seules les sociétés actives pour une année sont prises en compte pour la ventilation et le reporting de cette année.

**Gel et copie** :

- Vous pouvez **geler** une année une fois finalisée pour empêcher les modifications.
- Utilisez **Copier les indicateurs annuels** dans **Gestion budgétaire > Administration** pour copier les métriques d'une année à l'autre (choisissez quelles métriques copier). Les années gelées ne peuvent pas être écrasées.

## Import/export CSV

**Exporter CSV** télécharge les sociétés que la liste affiche (ou, sur demande dans la fenêtre, toutes les sociétés) avec leurs métriques. **Importer CSV** relit un fichier. La fenêtre d'import propose aussi **Télécharger le modèle** : un fichier avec les en-têtes et une ligne d'exemple, une société fictive avec des métriques pour l'année de la liste. Remplacez-la par vos propres lignes.

Les colonnes, dans cet ordre. Les colonnes de métriques suivent l'année sélectionnée dans la barre d'outils de la liste : l'année précédente, celle-ci et la suivante.

| Colonne | Contenu |
|---|---|
| `name` | Obligatoire. Le nom de la société. Les lignes sont rapprochées par ce nom |
| `country_iso` | Obligatoire. Deux lettres |
| `address1`, `address2` | Lignes d'adresse |
| `postal_code`, `state` | Compléments d'adresse |
| `city` | Obligatoire. La ville |
| `reg_number`, `vat_number` | Numéro d'immatriculation et numéro de TVA |
| `base_currency` | Obligatoire. Trois lettres |
| `status` | `enabled` ou `disabled` |
| `disabled_at` | La fin de validité : une date (`2026-12-31`) ou une date et une heure complètes. L'export écrit la date seule. Réimportée, cette date conserve la fin de validité enregistrée |
| `notes` | Texte libre |
| `headcount_<année>` | Un nombre entier. Obligatoire lorsque la ligne porte une métrique pour cette année |
| `it_users_<année>` | Un nombre entier |
| `turnover_<année>` | Jusqu'à 3 décimales, en millions de la devise de base de la société |

**Import** :

- Commencez par la **Vérification préalable**. Elle valide les en-têtes, l'encodage, les champs obligatoires, les doublons et les métriques. Si la vérification est propre, **Charger** applique les insertions et les mises à jour. Le dialogue compte ensuite les sociétés créées, mises à jour et inchangées, par exemple « 2 créées, 5 mises à jour, 30 inchangées »
- **Correspondance** : par `name` de société, quelle que soit la casse. Le nom enregistré ne change pas : une ligne `ACME` met à jour `Acme`, et la vérification préalable indique « ACME » a été rapproché de « Acme »
- **Une ligne par société** : un nom présent deux fois dans le fichier, quelle que soit la casse, est refusé dès la vérification : « « Acme » figure déjà à la ligne 4. Gardez une seule ligne par société. »
- **Champs obligatoires** : `name`, `country_iso`, `city` et `base_currency`. Une ville vide est refusée dès la vérification, pour une nouvelle société comme pour une mise à jour
- **Statut et fin de validité** : l'export écrit le statut déduit de la fin de validité. Une nouvelle société est activée sauf si la ligne indique `disabled`. Lors d'une mise à jour, un `status` vide et un `disabled_at` vide conservent les valeurs enregistrées. `enabled` avec une date vide efface la fin de validité. `disabled` avec une date vide conserve une date déjà passée, et sinon termine la société aujourd'hui
- Une ligne dont le statut contredit sa date est refusée avec une erreur de ligne : « Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again. » ou « Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed. »
- **Années lues** : le dialogue nomme les années qu'il lit, par exemple « Métriques lues : 2025, 2026, 2027, d'après l'année de la liste. Chaque année est facultative. »
- **Chaque année est facultative** : une année est un bloc de trois colonnes, `headcount_<année>`, `it_users_<année>` et `turnover_<année>`. Si vous omettez tout le bloc, les métriques enregistrées de cette année restent telles quelles. Une colonne d'une année hors des trois années lues est ignorée, et la vérification la liste avec les colonnes ignorées
- **Une année vient entière** : un fichier qui porte une ou deux colonnes d'une année sans les autres est refusé sur la ligne **En-tête**, qui nomme les colonnes manquantes
- **Métriques** : si une ligne porte une métrique pour une année, `headcount_<année>` est obligatoire pour cette année. `it_users_<année>` et `turnover_<année>` peuvent rester vides
- **Années gelées** : une ligne qui porte des métriques pour une année dont les métriques des sociétés sont gelées est refusée dès la vérification : « Les indicateurs pour 2025 sont gelés. Un administrateur budgétaire peut les dégeler. » Omettez les colonnes de cette année, ou dégelez d'abord l'année (voir [Geler les données de référence](master-data-operations.md))

**Notes** :

- Voir [Fichiers CSV](csv-files.md) pour l'encodage, le séparateur, les formes de dates et de montants, et les deux étapes d'import
- La liste se rafraîchit automatiquement après un chargement réussi

## Conseils

- **Désactivez plutôt que supprimer** : gardez l'historique cohérent et les rapports significatifs.
- **Plan comptable** : assignez des CoA aux sociétés pour garantir une utilisation cohérente des comptes dans les lignes OPEX/CAPEX.
- **Chiffre d'affaires** : saisissez les valeurs en millions de la devise de base de la société (ex. : 2,5 = 2,5 millions dans cette devise).
- **Effectif** est le driver de ventilation le plus courant ; maintenez-le à jour pour l'année en cours.
- **Métriques gelées** : vous pouvez toujours les consulter, mais les modifications sont bloquées tant qu'un administrateur budgétaire ne dégèle pas l'année dans **Gestion budgétaire > Administration > Geler les données de référence**.
- **Sélecteur de colonnes** : utilisez-le pour afficher ou masquer les colonnes comme Ville, Adresse, État ou Créé selon votre flux de travail.
- **Les colonnes de métriques renvoient aux Détails** : cliquer sur une valeur d'Effectif, d'Utilisateurs IT ou de Chiffre d'affaires ouvre directement l'onglet Détails pour cette société.
