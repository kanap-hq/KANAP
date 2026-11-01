# Administration

La section Administration donne accès à la gestion des utilisateurs, la configuration des rôles, la facturation, les paramètres d'authentification, les contrôles de personnalisation et le journal d'audit, qui enregistre aussi les connexions et les exports. Ces pages sont généralement réservées aux administrateurs.

## Où trouver cette page

Rendez-vous dans **Administration** depuis le menu principal pour accéder au hub d'administration.

**Autorisations** : Les différentes pages d'administration nécessitent différentes autorisations :
- Sociétés, Départements, Fournisseurs, Comptes : `{ressource}:reader` pour consulter
- Utilisateurs et accès : `users:reader` pour consulter, `users:admin` pour gérer
- Rôles : `users:reader` pour consulter, `users:admin` pour modifier
- Journal d'audit : Nécessite `users:admin`
- Accès aux données : Nécessite `users:admin` et l'accès à toutes les données (voir [Accès aux données](data-access.md))
- Facturation : Nécessite le rôle admin facturation
- Authentification : Nécessite `users:admin` (contrôlé par feature flag ; nécessite SSO activé)
- Personnalisation : Nécessite `users:admin` (hôte tenant uniquement ; accessible depuis la barre latérale)
- Données d'exemple : Nécessite le rôle Administrateur (espaces de travail cloud uniquement ; accessible depuis la barre latérale)

---

## Hub d'administration

La page d'accueil Administration donne un accès rapide aux principales fonctions administratives :

| Carte | Description | Autorisation requise |
|-------|-------------|----------------------|
| **Sociétés** | Gérer les sociétés et les métriques annuelles | `companies:reader` |
| **Départements** | Gérer les départements et l'effectif | `departments:reader` |
| **Fournisseurs** | Gérer les fournisseurs et contacts | `suppliers:reader` |
| **Comptes** | Gérer les codes comptables | `accounts:reader` |
| **Utilisateurs et accès** | Gérer les utilisateurs et rôles | `users:reader` |
| **Rôles** | Définir les autorisations des rôles | `users:reader` |
| **Journal d'audit** | Parcourir l'historique des modifications, les connexions et les exports | `users:admin` |
| **Facturation** | Plan et factures | Admin facturation |

Authentification, Personnalisation et Données d'exemple sont accessibles depuis la navigation dans la barre latérale mais n'apparaissent pas sur la page d'accueil du hub d'administration.

---

## Journal d'audit

La page Journal d'audit conserve l'historique des modifications de données et des événements de sécurité de votre espace de travail. Elle vous permet de voir qui a changé quoi et quand, qui s'est connecté et qui a exporté des données.

### Accès

- Route : `/admin/audit-logs`
- Autorisation requise : `users:admin`
- Le journal est en lecture seule. Vous pouvez le parcourir, le filtrer et l'exporter, mais vous ne pouvez ni modifier ni supprimer des entrées.

### Ce qui est enregistré

**Modifications de données** : créations, mises à jour, suppressions et désactivations d'enregistrements, avec l'utilisateur, l'heure et les valeurs avant et après.

**Modifications de rôles** : création, renommage et suppression d'un rôle, et chaque changement de ses autorisations.

**Changements d'accès aux données** (table **Accès aux données**) : le mode et les nœuds d'une personne avant et après, avec la source **Écran** ou **Import**. Voir [Accès aux données](data-access.md#audit-log).

**Événements de connexion et de session** (table **Connexion et session**) :

| Événement | Enregistré quand |
|-----------|------------------|
| **Connexion** | Quelqu'un se connecte |
| **Échec de connexion** | Une connexion est refusée. Le **motif** en donne la raison, par exemple mot de passe incorrect, compte désactivé ou aucun compte avec cette adresse |
| **Déconnexion** | Quelqu'un se déconnecte |
| **Renouvellement de session refusé** | La session n'a pas pu être renouvelée, par exemple parce qu'elle a expiré |
| **Réinitialisation du mot de passe demandée** / **Réinitialisation du mot de passe terminée** | Quelqu'un demande un lien de réinitialisation, puis définit un nouveau mot de passe avec ce lien. Si l'e-mail contenant le lien n'a pas pu être envoyé, le **motif** le signale |
| **Connexion avec Microsoft** / **Échec de connexion avec Microsoft** | Une connexion via Microsoft Entra ID réussit ou échoue |

**Exports** (table **Export**) : chaque fichier que KANAP produit à partir de vos données : exports de listes et de rapports en CSV ou Excel, documents et rapports PDF. La ligne indique ce qui a été exporté et par qui. Ses détails donnent le format, les paramètres de l'export (filtres, recherche, tri, année, etc.) et, pour un fichier de lignes, le nombre de lignes écrites. L'export du journal d'audit est lui aussi enregistré.

Les lignes de connexion, de session et d'export conservent aussi l'**adresse IP** d'où venait la demande et le **navigateur** utilisé. Ouvrez la ligne pour les lire dans les lignes **Adresse IP** et **Navigateur** de son tableau. Derrière un reverse proxy, c'est l'adresse IP de la personne elle-même, tant que le proxy la transmet (on-premise : voir l'[exemple de reverse proxy](on-premise/installation.md#reverse-proxy-example-nginx)).

Les mots de passe, les liens de connexion et les jetons ne sont jamais écrits dans le journal. Quand quelqu'un tente de se connecter avec une adresse e-mail sans compte, la ligne affiche **Compte inconnu** et ne conserve pas l'adresse saisie.

### Durée de conservation

Les événements de connexion et de session sont supprimés après **365 jours**. Les modifications de données, les modifications de rôles et les exports sont conservés sans limite de durée.

### Ce que vous pouvez faire

- Rechercher dans la table (son nom tel qu'affiché dans votre langue, par exemple **Fournisseurs**), l'action et l'acteur (e-mail/nom)
- Filtrer par :
  - Date
  - Table
  - Action
  - Source (`user`, `system`, `webhook`)
- Ouvrir n'importe quelle ligne pour voir les détails complets :
  - Pastilles de métadonnées (date, table, action, source, motif ou référence source, enregistrement, utilisateur)
  - La référence métier de l'enregistrement dans l'en-tête (par exemple `PRJ-3`, `APP-12`, `AST-31`, `LOC-4`, `CONN-2` ou `INT-8`), quand l'entrée en porte une. Sans référence, l'en-tête affiche **Identifiant** et garde l'identifiant stocké dans une infobulle
  - Un tableau des champs : **Champ**, **Avant** et **Après** pour une modification, **Champ** et **Valeur** pour toute autre entrée. Les noms des champs s'affichent dans votre langue quand ils sont connus. Les dates, les valeurs oui/non et les personnes s'affichent sous une forme lisible ; les autres identifiants s'affichent comme **Identifiant**, avec la valeur dans une infobulle. Les champs techniques comme `id`, `tenant_id` et `updated_at` sont omis
  - **Voir les données brutes** affiche le JSON complet avant et après
- Exporter le journal en CSV ou Excel (voir ci-dessous)

### Colonnes

**Colonnes par défaut** :
- **Date** : Quand la modification ou l'événement a eu lieu
- **Table** : Le type d'enregistrement concerné, sous son nom dans l'application (par exemple **Fournisseurs** ou **Liens de contrat**). Le filtre et le détail affichent les mêmes noms. Les événements de connexion et de session affichent **Connexion et session**, et un export affiche ce qui a été exporté (par exemple **Fournisseurs**)
- **Action** : Le type de modification ou d'événement (créer, mettre à jour, supprimer, désactiver, restaurer, connexion, export, etc.). **Restaurer** marque une colonne budgétaire ramenée à ses valeurs d'ouverture depuis l'onglet Budget d'une ligne
- **Source** : Qui ou quoi a déclenché la modification (utilisateur, système, webhook)
- **Utilisateur** : Nom de l'utilisateur qui a fait la modification, ou son adresse e-mail s'il n'a pas de nom. Affiche « Système » ou « Webhook » pour les sources non-utilisateur, et « Compte inconnu » pour une tentative de connexion sur une adresse inconnue.

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
- **ID enregistrement** : Identifiant de l'enregistrement affecté
- **ID utilisateur** : UUID de l'utilisateur agissant
- **Nom d'utilisateur** : Nom d'affichage de l'utilisateur agissant
- **Réf. source** : Référence externe pour les modifications provenant de webhooks, ou motif d'une connexion refusée
- **ID tenant** : Le tenant auquel cette entrée appartient

### Pagination

- La grille utilise une pagination explicite avec **100 lignes par page**.
- Les filtres et la recherche s'appliquent à l'ensemble des données, pas seulement à la page actuelle.

### Export

Cliquez sur **Exporter** en haut de la page, puis choisissez **CSV** ou **Excel (.xlsx)**, pour télécharger le journal sous forme de fichier. Votre navigateur mémorise ce choix pour l'export suivant.

- Le fichier contient les entrées qui correspondent aux filtres, à la recherche et au tri affichés à l'écran. Effacez les filtres pour exporter tout le journal.
- Un fichier contient au plus **100 000 entrées**, les plus récentes d'abord par défaut. Quand le journal est plus grand, KANAP vous indique que le fichier s'arrête là. Affinez les filtres (une plage de dates, par exemple) et exportez à nouveau pour obtenir le reste.
- Vous ne pouvez lancer que quelques exports par minute. Si vous cliquez de nouveau trop tôt, KANAP vous demande d'attendre une minute.
- L'export est enregistré dans le journal, comme tout autre export.

Le fichier CSV a toujours le même format, quelle que soit votre langue, pour qu'un outil de collecte de journaux puisse le lire sans réglage :

- séparé par des virgules, en UTF-8 sans marque d'ordre des octets ;
- noms de colonnes en anglais : `date`, `action`, `table`, `record_id`, `user`, `source`, `source_ref`, `ip`, `user_agent`, `before`, `after` ;
- codes d'actions et de tables en anglais (par exemple `login_failed`), tels qu'ils sont stockés ;
- dates au format ISO 8601, en UTC (par exemple `2026-10-09T14:32:05.000Z`) ;
- colonnes `before` et `after` en JSON compact.

Si Excel utilise le point-virgule comme séparateur de liste sur votre poste (fréquent avec les paramètres régionaux français ou allemands), ne double-cliquez pas sur le fichier CSV. Utilisez **Données > À partir d'un fichier texte/CSV**, choisissez UTF-8 comme origine du fichier et la virgule comme délimiteur, ou exportez plutôt en Excel.

Le fichier Excel contient les mêmes colonnes et les mêmes valeurs sur une feuille, toutes en texte : les dates gardent leur forme ISO 8601, avec l'heure.

### Qui peut voir quoi

Les valeurs **Avant** et **Après** contiennent l'enregistrement complet tel qu'il a été sauvegardé, y compris les données personnelles comme les noms, les adresses e-mail et les numéros de téléphone. L'écran de détail et le fichier exporté montrent les mêmes valeurs, et les deux exigent `users:admin`. Les empreintes de mots de passe et les secrets d'authentification multifacteur ne sont jamais écrits dans le journal. Traitez un fichier exporté comme le journal lui-même : conservez-le avec le même soin.

### Comprendre la source et l'acteur

- **Source = user** : modification déclenchée par l'action d'un utilisateur authentifié. Les événements de connexion, de session et d'export utilisent aussi cette source.
- **Source = webhook** : modification déclenchée par un webhook externe (par exemple des événements de synchronisation de facturation). Utilisez **Réf. source** pour faire le lien avec les identifiants d'événements en amont.
- **Source = system** : processus interne de la plateforme, sans acteur utilisateur direct.

Si un compte utilisateur n'est plus identifiable dans le contexte actuel, la colonne Utilisateur peut afficher un UUID de repli (`Inconnu (xxxx...)`) au lieu d'un nom.

---

## Utilisateurs et accès

Gérez qui peut accéder à KANAP et ce qu'ils peuvent faire.

### La grille des utilisateurs

**Colonnes par défaut** :
- **Nom** / **Prénom** : Nom de l'utilisateur
- **Adresse e-mail** : Adresse e-mail de connexion
- **Poste** : Leur rôle dans l'organisation
- **Statut** : Une pastille colorée indiquant l'état du compte. Voir ci-dessous.
- **Dernière connexion** : Quand la personne s'est connectée pour la dernière fois, ou **Jamais**
- **Rôles** : tous les rôles assignés à l'utilisateur
- **Type de compte** : **Local** pour les comptes qui se connectent avec une adresse e-mail et un mot de passe, **Microsoft Entra** pour les comptes qui se connectent avec Microsoft
- **Société** / **Département** : Affectation organisationnelle de l'utilisateur

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
- **Téléphone professionnel** / **Téléphone mobile** : Numéros de contact
- **MFA activé** : Si l'authentification multi-facteur est active
- **Créé** : Quand l'utilisateur a été créé

Dès que l'accès aux données d'une personne est limité, une colonne **Accès** montre l'accès de chacun : **Toutes les données**, les noms de ses nœuds, ou **Aucun**. Voir [Accès aux données](data-access.md).

**Valeurs de statut** :

| Statut | Signification |
|--------|---------------|
| **Activé** | Le compte peut se connecter et utiliser KANAP. |
| **Désactivé** | Le compte est conservé avec tout son historique, mais ne peut pas se connecter. |
| **Invité** | Une invitation a été envoyée et n'a pas encore été acceptée. |
| **Accès en attente** | La personne peut se connecter mais n'a aucun rôle, elle ne peut donc rien ouvrir. Assignez-lui un rôle pour lui donner accès. |
| **Contact** | Une simple entrée de répertoire. La personne ne se connecte pas. |

La grille affiche par défaut les utilisateurs **Activés**. Utilisez la bascule **Afficher** pour basculer entre **Tous**, **Activés**, **Invités** et **Désactivés**.

### Actions de gestion des utilisateurs

Actions de la barre d'outils :

| Action | Description | Autorisation |
|--------|-------------|-------------|
| **Nouveau** | Créer un nouvel utilisateur | `users:admin` |
| **Importer** | Import en masse d'utilisateurs depuis un fichier CSV ou un classeur Excel | `users:admin` |
| **Exporter** | Exporter la liste des utilisateurs en CSV ou Excel | `users:admin` |
| **Inviter** | Envoyer des invitations de connexion aux utilisateurs sélectionnés | `users:admin` |
| **Désactiver** | Désactiver les utilisateurs sélectionnés. Ils sont déconnectés immédiatement. | `users:admin` |
| **Supprimer** | Supprimer définitivement les utilisateurs sélectionnés. Votre propre compte est conservé : la confirmation l'indique avant toute suppression. Pour garder l'historique d'un utilisateur et bloquer son accès, désactivez-le plutôt | `users:admin` |

`users:reader` suffit pour ouvrir la page et consulter la liste. Toutes les actions ci-dessus, ainsi que les actions de ligne ci-dessous, nécessitent `users:admin`.

Actions de ligne, depuis le menu au bout de chaque ligne :

| Action | Description |
|--------|-------------|
| **Modifier** | Ouvrir l'utilisateur pour le modifier. Cliquer sur la ligne fait la même chose. |
| **Activer** / **Désactiver** | Activer ou désactiver le compte. La désactivation déconnecte la personne immédiatement. |
| **Envoyer une invitation** | Envoyer une invitation de connexion par e-mail. Masqué pour les comptes Microsoft Entra. |
| **Envoyer une réinitialisation de mot de passe** | Envoyer un lien de réinitialisation de mot de passe par e-mail. Affiché uniquement pour les comptes locaux activés. |
| **Accès aux données** | Ouvre l'utilisateur sur l'onglet **Accès aux données**. Affiché aux personnes qui ont accès à toutes les données, sur les lignes des autres personnes. |
| **Supprimer** | Supprimer définitivement l'utilisateur. Les enregistrements sur lesquels il a travaillé restent, sans lui. Vous ne pouvez pas supprimer votre propre compte. Pour bloquer l'accès d'une personne en gardant son compte, désactivez-le plutôt. |

### Fichier CSV des utilisateurs

**Exporter** télécharge la liste des utilisateurs dans un fichier CSV ou un classeur Excel. **Importer** relit un fichier. La fenêtre d'import propose aussi **Télécharger le modèle** : un fichier avec les seuls en-têtes.

Les colonnes :

| Colonne | Contenu |
|---|---|
| `email` | Obligatoire. Les lignes sont rapprochées par cette adresse, écrivez-la donc telle que l'espace de travail la contient |
| `first_name`, `last_name` | Le nom de la personne |
| `role` | Le rôle à attribuer. Une cellule vide donne le rôle **Contact** |
| `company_name` | La société, par son nom. Facultatif |
| `department_name` | Le département, par son nom. Il nécessite un `company_name` |
| `status` | `contact`, `invited`, `enabled` ou `disabled`. Une cellule vide donne `contact` |

Un rôle nommé par le fichier et absent de votre espace de travail est créé par le chargement, avec une description par défaut. La vérification le liste et ne crée rien : un fichier que vous vous contentez de vérifier ne change aucun rôle. Un nom présent deux fois dans le fichier n'est gardé qu'une fois, la première ligne l'emportant.

Le fichier ne contient ni date ni montant. Un import ne définit aucun mot de passe : un nouvel utilisateur se connecte après une invitation ou une réinitialisation de mot de passe.

Voir [Fichiers CSV et Excel](csv-files.md) pour les formats, l'encodage, le séparateur et les deux étapes d'import.

### Créer un utilisateur

1. Cliquez sur **Nouveau**
2. Remplissez les champs obligatoires :
   - **E-mail** : Adresse e-mail de connexion (doit être unique)
3. Champs optionnels :
   - **Prénom** / **Nom** : Nom de l'utilisateur
   - **Intitulé de poste** : Leur rôle dans l'organisation
   - **Tél. professionnel** / **Tél. mobile** : Numéros de contact
   - **Rôles** : Assigner un ou plusieurs rôles (détermine les autorisations)
   - **Société** / **Département** : Affectation organisationnelle
   - **Activé** : Si l'utilisateur peut se connecter
4. Cliquez sur **Enregistrer** ou **Enregistrer et inviter** pour envoyer l'e-mail de connexion

Quand vous modifiez un utilisateur, la fenêtre a deux onglets : **Identité**, avec les champs ci-dessus et les rôles, et **Accès aux données**, qui limite la personne à une partie du budget et des contrats. Un seul **Enregistrer** écrit les deux. L'onglet **Accès aux données** est affiché aux personnes qui ont accès à toutes les données, sur les comptes des autres. Voir [Accès aux données](data-access.md).

### Assignation multi-rôles

Les utilisateurs peuvent se voir assigner plusieurs rôles. Leurs autorisations effectives sont la combinaison de tous les rôles assignés : si un rôle donne accès à une ressource, l'utilisateur a cet accès.

Retirer tous les rôles ne supprime pas le compte. L'utilisateur revient au rôle système **Contact**, ne conserve aucun accès et apparaît avec le statut **Accès en attente** dans la grille. Vous ne pouvez pas retirer votre propre dernier rôle, vous ne pouvez donc pas vous bloquer l'accès.

### Utilisateurs activés et désactivés

Votre abonnement inclut un nombre **illimité d'utilisateurs**. Le commutateur **Activé** détermine qui peut se connecter :
- **Utilisateurs activés** : Peuvent se connecter et utiliser KANAP
- **Utilisateurs désactivés** : Conservent leurs données mais ne peuvent plus se connecter
- Basculez le commutateur **Activé** lors de la modification d'un utilisateur pour contrôler l'accès

### Utilisateurs gérés par Microsoft Entra

Les comptes dont le type de compte est **Microsoft Entra** appartiennent à votre annuaire. Leur profil est actualisé depuis Entra à deux moments :

- **À chaque connexion**, depuis le profil Microsoft de la personne
- **Chaque nuit**, par la synchronisation quotidienne de l'annuaire, si un administrateur Microsoft Entra l'a approuvée. Voir [Authentification](#authentification).

Les deux actualisent les mêmes champs : prénom, nom, poste, téléphone professionnel, téléphone mobile, ainsi que le département et la société, rapprochés par leur nom des enregistrements qui existent déjà dans KANAP. Les valeurs vides de l'annuaire n'effacent jamais ce qui est stocké dans KANAP.

Les personnes qui sont aussi contributeurs reçoivent également leur **Responsable** depuis l'annuaire, avec la synchronisation nocturne. KANAP rapproche le responsable déclaré dans Entra de son compte KANAP et l'inscrit sur la fiche du contributeur, où le champ devient en lecture seule. Un responsable qui n'a pas encore de compte KANAP est repris par une synchronisation ultérieure. Voir [Contributeurs](portfolio-team-members.md).

Lors de la modification d'un de ces utilisateurs, les champs e-mail, nom, poste et téléphone sont verrouillés, avec la mention :

> Cet utilisateur est géré par Microsoft Entra ID et ne peut pas être modifié ici. Dernière synchronisation depuis Microsoft Entra : {date}

Vous pouvez toujours gérer ses rôles, sa société, son département et le commutateur Activé.

Les comptes Microsoft Entra n'ont jamais de mot de passe KANAP. Ils ne peuvent recevoir ni invitation ni réinitialisation de mot de passe.

Si une personne est supprimée de votre annuaire, ou si son compte d'annuaire est désactivé, la synchronisation nocturne désactive son compte KANAP. Elle est déconnectée immédiatement et ses données sont conservées.

### Connexion à la volée avec Microsoft

Lorsque le single sign-on est connecté, une personne qui se connecte avec Microsoft pour la première fois obtient automatiquement un compte KANAP. Si un compte avec la même adresse e-mail existe déjà, il est lié à son identité Microsoft à la place.

Un nouveau compte démarre avec le rôle système **Contact** et aucune autorisation. La personne voit une page indiquant :

> Votre compte n'a pas encore reçu l'accès à KANAP. Demandez à votre administrateur de vous accorder l'accès.

Les administrateurs reçoivent un e-mail lorsque cela se produit. Pour donner l'accès à la personne, ouvrez **Administration > Utilisateurs**, repérez-la à son statut **Accès en attente**, puis assignez-lui un rôle.

---

## Rôles

Définissez ce que chaque rôle peut faire dans KANAP.

### Comment fonctionnent les rôles

Chaque rôle a des niveaux d'autorisation pour différentes ressources :
- **Aucun** : Pas d'accès à cette ressource
- **Reader** : Consultation uniquement
- **Contributeur** : Consultation et modification des éléments existants, ajout de commentaires et pièces jointes, mais pas de création de nouveaux éléments de premier niveau. L'éditeur de rôles propose ce niveau sur la plupart des ressources (pas sur Knowledge, les paramètres d'IA, le chat Plaid ni l'accès MCP). Les projets du portefeuille, les incidents et les agents IA l'utilisent aujourd'hui. Sur toutes les autres ressources, les modifications exigent le niveau Membre : un Contributeur y a donc un accès Lecteur.
- **Member** : Consultation, création et modification
- **Admin** : Accès complet incluant la suppression

### Groupes d'autorisations

Les ressources sont organisées en groupes pour faciliter la gestion :

**Budget et finance**
| Ressource | Ce qu'elle contrôle |
|-----------|---------------------|
| `budget` | Lignes budgétaires, OPEX et CAPEX |
| `budget_ops` | Outils d'administration budgétaire, dont les paramètres de devises |
| `contracts` | Contrats fournisseurs |
| `analytics` | Dimensions analytiques |
| `reporting` | Accès aux rapports |

La ressource Budget couvre les lignes OPEX et CAPEX de la même façon. Un rôle qui avait auparavant des niveaux OPEX et CAPEX distincts garde le plus élevé des deux sur Budget.

**Gestion du portefeuille**
| Ressource | Ce qu'elle contrôle |
|-----------|---------------------|
| `portfolio_requests` | Demandes du portefeuille |
| `portfolio_projects` | Projets du portefeuille |
| `portfolio_planning` | Planification du portefeuille |
| `portfolio_reports` | Rapports du portefeuille |
| `portfolio_settings` | Paramètres du portefeuille |

**Cartographie SI**
| Ressource | Ce qu'elle contrôle |
|-----------|---------------------|
| `applications` | Applications |
| `infrastructure` | Serveurs et infrastructure |
| `locations` | Données de référence des sites |
| `settings` | Paramètres de la cartographie SI uniquement |

**Données de référence**
| Ressource | Ce qu'elle contrôle |
|-----------|---------------------|
| `companies` | Données de référence des sociétés |
| `departments` | Données de référence des départements |
| `cost_centers` | Centres de coûts et leurs groupes |
| `working_day_profiles` | Calendriers de jours ouvrés, pour les lignes au prix par jour |
| `suppliers` | Données de référence des fournisseurs |
| `contacts` | Répertoire des contacts |
| `accounts` | Plan comptable |
| `business_processes` | Catalogue des processus métier |

**Tâches**
| Ressource | Ce qu'elle contrôle |
|-----------|---------------------|
| `tasks` | Gestion des tâches |

**Base de connaissances**
| Ressource | Ce qu'elle contrôle |
|-----------|---------------------|
| `knowledge` | Articles de la base de connaissances |

La ressource Knowledge supporte les niveaux Reader, Member et Admin (Contributeur n'est pas disponible pour cette ressource).

**Administration**
| Ressource | Ce qu'elle contrôle |
|-----------|---------------------|
| `users` | Gestion des utilisateurs et rôles |
| `billing` | Facturation et abonnement |

### Types de rôles

Les rôles sont catégorisés par la manière dont ils peuvent être modifiés :

| Badge | Description |
|-------|-------------|
| **Système** | Ne peut pas être modifié. Administrateur a un accès complet ; Contact est pour les entrées du répertoire uniquement. |
| **Intégré** | Rôles pré-configurés fournissant des schémas d'accès standard. Ne peut pas être modifié directement : utilisez **Dupliquer** pour créer une copie personnalisable. |
| _(pas de badge)_ | Rôles personnalisés que vous créez. Entièrement modifiables. |

### Rôles intégrés

KANAP est livré avec des rôles pré-configurés organisés par domaine fonctionnel :

**Budget** : Administrateur budget, Membre budget, Lecteur budget
**Portefeuille** : Administrateur portefeuille, Membre portefeuille, Lecteur portefeuille, **Contributeur métier**
**Cartographie SI** : Administrateur Cartographie SI, Membre Cartographie SI, Lecteur Cartographie SI
**Données de référence** : Administrateur données de référence, Membre données de référence, Lecteur données de référence
**Tâches** : Administrateur tâches, Membre tâches, Lecteur tâches

#### Le rôle Contributeur métier

Le rôle **Contributeur métier** est conçu pour les parties prenantes métier qui participent au processus de portefeuille sans avoir les privilèges complets de gestion de projet. Un Contributeur métier peut :

- **Soumettre et gérer des demandes de portefeuille** (accès complet member aux demandes)
- **Modifier des projets existants** : mettre à jour les champs, ajouter des commentaires, téléverser des pièces jointes, gérer les phases, jalons, dépendances et entrées de temps
- **Créer et travailler sur les tâches projet** : ajouter des tâches aux projets, saisir du temps et poster des commentaires
- **Consulter les utilisateurs, sociétés, départements et contacts** pour les sélections dans les menus déroulants

Un Contributeur métier **ne peut pas** :
- Créer de nouveaux projets (nécessite le niveau Member sur les projets du portefeuille)
- Convertir des demandes en projets (nécessite le niveau Member)
- Importer et exporter (nécessite le niveau Admin)

Ce rôle comble le fossé entre l'accès en lecture seule (Reader) et la gestion complète de projet (Member), permettant aux utilisateurs métier de contribuer activement sans pouvoir créer de nouveaux projets.

### Le rôle Contact

Le rôle **Contact** est un rôle système spécial pour les utilisateurs qui apparaissent dans les listes déroulantes mais n'ont pas besoin de se connecter. Utilisations courantes :

- Demandeurs ou sponsors qui n'ont besoin d'être que référencés, pas d'être des utilisateurs actifs
- Parties prenantes externes listées à des fins de suivi
- Entrées de remplacement pour la structure organisationnelle

**Les utilisateurs Contact :**
- Ne peuvent pas se connecter à KANAP
- Ne comptent pas dans le total des utilisateurs activés
- Ne reçoivent pas de notifications par e-mail (même s'ils sont assignés à des projets/tâches)
- Peuvent être sélectionnés dans les menus déroulants d'utilisateurs (ex. : comme sponsor de projet)

Si une personne avec le rôle Contact a besoin d'utiliser activement KANAP, changez son rôle vers un rôle classique (ex. : Lecteur, Member) et invitez-la.

Une exception : une personne créée automatiquement lors de sa première connexion Microsoft porte aussi le rôle Contact. Elle peut se connecter, mais elle n'atteint que la page d'accès en attente tant que vous ne lui avez pas assigné de rôle. La grille l'affiche avec le statut **Accès en attente**.

### Gérer les rôles

La page Rôles a une disposition à deux panneaux :
- **Panneau gauche** : Liste de tous les rôles avec des badges indiquant le type, et un compteur d'utilisateurs pour chaque rôle
- **Panneau droit** : Détails et autorisations pour le rôle sélectionné

**Actions** :
- **Nouveau rôle** : Créer un rôle personnalisé de zéro
- **Dupliquer** : Copier un rôle existant (y compris les rôles intégrés) comme point de départ. Non disponible pour les rôles Système.
- **Supprimer** : Supprimer un rôle personnalisé. Un rôle attribué à des utilisateurs ne peut pas être supprimé : attribuez-leur d'abord un autre rôle. La fenêtre l'indique avant toute confirmation.
- **Enregistrer les détails** : Mettre à jour le nom et la description du rôle
- **Enregistrer les autorisations** : Appliquer les modifications d'autorisations

Un administrateur des utilisateurs qui a accès à toutes les données peut aussi interroger [Plaid](ai-assistant.md#tool-calls) sur les rôles, leur nombre d'utilisateurs et leurs droits. Les modifications restent sur cette page.

### Créer un rôle personnalisé

1. Cliquez sur **Nouveau rôle**
2. Saisissez un nom et une description
3. Cliquez sur **Créer**
4. Définissez les niveaux d'autorisation pour chaque groupe de ressources
5. Cliquez sur **Enregistrer les autorisations**

**Conseil** : Commencez par dupliquer un rôle intégré qui se rapproche de ce dont vous avez besoin, puis ajustez les autorisations.

Chaque modification d'un rôle (création, renommage, autorisations, suppression) est enregistrée dans le [Journal d'audit](#journal-daudit), avec la personne qui l'a faite et les valeurs avant et après.

---

## Facturation

Gérez votre abonnement, vos informations de facturation et vos factures.

### Vue d'ensemble de l'abonnement

Le haut de la page résume votre abonnement en deux lignes :
- Le plan, la fréquence de facturation et le montant, par exemple « Hosted KANAP · Annuel · 2 490,00 € / an ». L'abonnement inclut un nombre illimité d'utilisateurs, avec une facturation mensuelle ou annuelle.
- Le statut (Actif, En période d'essai, En retard, Annulé, etc.), la date de renouvellement et le moyen de paiement, par exemple « Actif · renouvellement le 7 oct. 2027 · Visa •••• 4242 ».

Sans abonnement en cours (un essai, un essai expiré ou un abonnement terminé), seul le statut est affiché. Pendant un essai, il est accompagné de la date de fin d'essai et du nombre de jours restants.

Pendant un essai, une pastille dans la barre du haut indique aussi les jours restants, par exemple « Essai : 9 j ». Pour les administrateurs de la facturation, elle ouvre cette page. Survolez-la pour voir la date de fin d'essai. Une fois l'essai expiré, un bandeau prend sa place.

Lorsqu'un passage à la facturation mensuelle est prévu, une troisième ligne l'indique, par exemple « Passe en mensuel le 7 oct. 2027. » Cliquez sur **Rester en annuel** sur cette ligne pour annuler ce passage.

### Actions

- **Choisir un plan** / **Changer de plan** : Ouvrir la boîte de dialogue du plan pour souscrire ou basculer entre facturation mensuelle et annuelle. Nécessite l'admin facturation.
- **Gérer le paiement** : Ouvrir le portail client Stripe pour mettre à jour le moyen de paiement, annuler ou effectuer d'autres modifications. Disponible uniquement une fois l'abonnement souscrit.

Si votre abonnement n'est pas en règle (essai expiré, paiement en retard, etc.), la boîte de dialogue de sélection du plan s'ouvre automatiquement lorsque vous visitez la page Facturation.

### Souscrire

Pour souscrire, les informations de facturation doivent être complètes : société, e-mail, adresse, pays et, dans l'Union européenne, numéro de TVA (voir [Informations de facturation](#informations-de-facturation)). S'il manque quelque chose, la boîte de dialogue **Choisir un plan** liste les champs manquants et les boutons de paiement restent désactivés. Cliquez sur **Compléter les informations de facturation** pour fermer la boîte de dialogue et accéder au premier champ manquant. Une fois les informations enregistrées, les boutons de paiement deviennent disponibles.

Cochez **J'accepte les conditions générales de vente** avant de payer. Cette case est aussi demandée à chaque changement de plan.

Vous pouvez payer de deux façons :
- **Payer par carte** : pour une facturation mensuelle ou annuelle. La page de paiement Stripe s'ouvre. La carte est débitée à chaque émission de facture.
- **Payer par virement** : pour une facturation annuelle uniquement. KANAP émet la facture et l'ouvre. La facture est payable sous 30 jours.

Aucune TVA n'est facturée. Chaque facture porte la mention « TVA non applicable, art. 293 B du CGI ».

### Changer de plan

Ouvrez **Changer de plan**, choisissez la périodicité de facturation et confirmez avec **Changer de plan (carte)** ou **Changer de plan (virement)**.

- **De mensuel à annuel** : le changement s'applique immédiatement. Une nouvelle période annuelle commence aujourd'hui, la partie non utilisée du mois en cours est créditée et la différence est facturée. Avec une carte, elle est débitée tout de suite. Si votre banque vous demande de confirmer le paiement, la page de paiement s'ouvre et le plan change une fois la facture payée. Avec un virement, la facture est payable sous 30 jours.
- **D'annuel à mensuel** : le changement s'applique à la fin de la période annuelle. D'ici là, la page affiche « Passe en mensuel le » suivi de la date. Cliquez sur **Rester en annuel** pour conserver la facturation annuelle.

Passer du virement à la carte nécessite une carte enregistrée. Si vous n'en avez pas, une page Stripe vous demande d'en ajouter une, puis la boîte de dialogue du plan se rouvre pour que vous confirmiez le changement.

Le changement de plan d'un abonnement par carte en cours ne demande pas des informations de facturation complètes. Un changement payé par virement les demande.

### Informations de facturation

Ces informations figurent sur vos factures. KANAP les copie dans votre fiche client Stripe lorsque vous souscrivez et à chaque enregistrement d'un champ.

La section contient la société, l'e-mail, le nom du destinataire, le téléphone, l'adresse (ligne 1, ligne 2, code postal, ville, état/province), le pays et le numéro de TVA.

Chaque champ est enregistré séparément, sans bouton d'enregistrement. Un champ texte est enregistré lorsque vous le quittez ou appuyez sur Entrée, et le pays dès que vous le choisissez. « Enregistrement... » puis « Enregistré » s'affichent à côté du titre de la section. Pour supprimer une valeur, videz le champ et quittez-le.

Le champ **Pays** est une liste avec recherche. Un pays saisi en texte libre dans une version précédente apparaît vide tant que vous n'en choisissez pas un dans la liste.

Les champs obligatoires sont marqués d'un astérisque :
- **Société**
- **E-mail**
- **Adresse ligne 1**, **Code postal** et **Ville**
- **Pays**
- **Numéro de TVA**, lorsque le pays fait partie de l'Union européenne

Vous pouvez laisser des informations incomplètes et les terminer plus tard. Tant que quelque chose manque, une ligne sous les champs le liste, par exemple « Requis avant de vous abonner : e-mail, ville. » Les informations doivent être complètes avant de souscrire.

Les versions précédentes de KANAP avaient une carte distincte d'informations client. Si vous l'avez remplie, ses valeurs apparaissent dans les champs de facturation correspondants restés vides, et elles sont enregistrées comme informations de facturation la prochaine fois que vous modifiez un champ.

Pour un pays de l'Union européenne, le numéro de TVA est transmis à Stripe et imprimé sur vos factures. Si Stripe ne l'accepte pas, KANAP affiche « Le numéro de TVA n'a pas été accepté. Vérifiez-le dans les informations de facturation. » Corrigez le numéro et réessayez.

### Historique des factures

Vos factures sont listées dans un tableau sous les informations de facturation :
- Numéro de facture et date
- Montant
- Statut (Brouillon, Ouverte, Payée, Annulée, Irrécouvrable)
- **Voir** : Ouvrir la facture dans le lecteur hébergé de Stripe
- **Télécharger** : Télécharger le PDF de la facture

Les cinq factures les plus récentes sont affichées en premier. Cliquez sur **Tout afficher** pour voir les autres.

Chaque facture est aussi envoyée par e-mail à l'adresse e-mail de facturation. Le PDF est au format A4. Sa langue suit le pays de l'adresse de facturation : français pour la France et Monaco, allemand pour l'Allemagne et l'Autriche, espagnol pour l'Espagne, anglais pour les autres pays. Pour une société française, la facture indique aussi son SIREN, tiré du numéro de TVA.

---

## Authentification

Configurez le single sign-on (SSO) pour votre organisation. Cette page n'est disponible que lorsque la fonctionnalité SSO est activée et n'est pas accessible depuis l'hôte platform-admin.

### Microsoft Entra ID

Connectez KANAP à votre tenant Microsoft Entra ID pour le SSO :

1. Cliquez sur **Connecter**
2. Connectez-vous avec un compte administrateur Microsoft
3. Accordez les autorisations demandées
4. Les utilisateurs peuvent maintenant se connecter avec leurs comptes Microsoft

### Statut SSO

- **Connecté** : Affiche votre ID de tenant Entra
- **Non connecté** : Authentification locale uniquement

### Actions

| Action | Description |
|--------|-------------|
| **Connecter** | Lancer le flux de configuration Microsoft Entra |
| **Reconnecter** | Relancer le flux de configuration (affiché lorsque déjà connecté) |
| **Tester la connexion** | Tester la connexion SSO avec votre compte Microsoft |
| **Déconnecter** | Supprimer la configuration SSO (revient à l'auth locale) |

### Synchronisation quotidienne de l'annuaire

Ce bloc apparaît sous la carte Entra une fois le single sign-on connecté. Chaque nuit à 03h00 (heure du serveur), KANAP actualise les noms, postes, téléphones, départements et sociétés depuis Microsoft Entra, actualise le responsable des personnes qui sont contributeurs, et désactive les comptes supprimés ou désactivés dans l'annuaire.

Les départements et les sociétés sont rapprochés par leur nom des enregistrements qui existent déjà dans KANAP. Rien n'est créé automatiquement. Les valeurs vides de l'annuaire n'effacent jamais ce qui est déjà stocké dans KANAP.

La synchronisation nécessite une approbation unique par un administrateur Microsoft Entra. Tant qu'elle n'est pas accordée, le bloc affiche **Pas encore autorisé. Un administrateur Microsoft Entra doit autoriser KANAP à lire les utilisateurs de l'annuaire.**

| État ou action | Signification |
|----------------|---------------|
| **Pas encore autorisé...** | Aucun administrateur Microsoft Entra n'a approuvé la synchronisation, ou l'autorisation requise manque dans l'enregistrement d'application. |
| **Autoriser dans Microsoft Entra** | Vous envoie vers la page d'approbation de Microsoft. Affiché tant que la synchronisation n'est pas autorisée. Vous revenez avec **Accès accordé. La première synchronisation est en cours.** |
| **Dernière synchronisation {date} : N comptes actualisés, N désactivés.** | Résultat de la dernière exécution réussie. |
| **La dernière synchronisation a échoué : {message}** | La dernière exécution ne s'est pas terminée. Le message provient de Microsoft. |
| **Synchroniser maintenant** | Lance la synchronisation immédiatement au lieu d'attendre la nuit. Affiche **Synchronisation terminée : N comptes actualisés, N désactivés.** |

Les étapes de configuration de l'enregistrement d'application Entra sont décrites dans [SSO Microsoft Entra](on-premise/sso-entra.md).

### Limites de connexion

KANAP limite les demandes de connexion répétées :

- **Connexion par mot de passe** : 60 demandes par minute depuis la même adresse IP. Après 5 échecs sur un compte depuis la même adresse IP en 15 minutes, ce compte ne peut plus se connecter depuis cette adresse pendant 15 minutes. Le même compte peut toujours se connecter depuis une autre adresse, et les autres comptes depuis la même adresse. Une connexion réussie remet le compteur à zéro.
- **Connexion Microsoft** : 60 demandes par minute depuis la même adresse IP.

Les limites par adresse sont hautes parce que les collaborateurs d'une même organisation accèdent souvent à KANAP depuis la même adresse sortante. Une fois une limite par adresse atteinte, la personne patiente une minute et réessaie. Derrière un reverse proxy, KANAP compte l'adresse IP de chaque personne, tant que le proxy la transmet.

Les connexions et les échecs de connexion apparaissent dans le [Journal d'audit](#journal-daudit). Quand 5 échecs bloquent un compte depuis une adresse, un échec de connexion avec le motif **Trop de tentatives de connexion** est enregistré. Les tentatives refusées pendant les 15 minutes qui suivent ne sont pas enregistrées, pas plus que les demandes bloquées par une limite par adresse.

---

## Personnalisation

Utilisez **Administration > Personnalisation** pour appliquer l'identité de votre entreprise dans KANAP.

- Route : `/admin/branding`
- Autorisation : `users:admin`
- Portée : hôtes tenant uniquement (non disponible sur l'hôte platform-admin)

La personnalisation vous permet de :
- Téléverser ou supprimer le logo de votre tenant
- Contrôler si le logo est affiché en mode sombre
- Définir des couleurs primaires séparées pour les modes clair et sombre
- Réinitialiser toute la personnalisation aux valeurs par défaut

Pour les instructions détaillées étape par étape, consultez : [Personnalisation](branding.md)

---

## Données d'exemple

Utilisez **Administration › Données d'exemple** pour remplir un espace de travail vide avec Fromage & Co, une fromagerie fictive, puis pour effacer ensuite tout l'espace de travail.

- Route : `/admin/sample-data`
- Qui : les utilisateurs ayant le rôle Administrateur
- Portée : espaces de travail cloud uniquement

Pour le contenu du jeu, ce que l'effacement supprime et conserve, et le bandeau de la page d'accueil, consultez : [Données d'exemple](sample-data.md)

---

## Paramètres

La page Paramètres vous permet de gérer votre profil personnel et vos préférences de notification. Accédez-y depuis le menu utilisateur (avatar en haut à droite) ou naviguez vers `/settings`.

La page a ces onglets, chacun avec sa propre URL :
- `/settings/profile` (par défaut) : Onglet Profil
- `/settings/notifications` : Onglet Notifications
- `/settings/appearance` : Onglet Apparence
- `/settings/connected-apps` : Onglet Applications connectées, affiché quand l'API MCP est proposée (voir [Applications connectées](connected-apps.md))
- `/settings/about` : Onglet À propos

### Profil

Modifiez vos informations personnelles :
- **Prénom** / **Nom**
- **Intitulé de poste**
- **Tél. professionnel** / **Tél. mobile**

Si votre organisation utilise Microsoft Entra ID (SSO), certains champs peuvent être synchronisés depuis Entra et ne peuvent pas être modifiés dans KANAP.

Si votre compte n'a ni prénom ni nom, une petite fenêtre vous les demande après la connexion. **Plus tard** la masque dans ce navigateur. Vous pouvez modifier les deux ici à tout moment.

### Notifications

Contrôlez quelles notifications par e-mail vous recevez.

**Bascule principale** : Activez ou désactivez toutes les notifications par e-mail avec le commutateur **Notifications par e-mail** en haut.

**Catégories par espace de travail** (chacune avec sa propre bascule activer/désactiver) :

| Espace de travail | Catégories de notifications |
|-------------------|-----------------------------|
| **Portefeuille** | Changements de statut, ajout à une équipe, changements d'équipe sur les éléments que vous pilotez, commentaires |
| **Tâches** | Assignation (comme responsable, demandeur ou observateur), changements de statut, commentaires |
| **Budget** | Alertes d'expiration, changements de statut, commentaires |
| **Technologies** | Vulnérabilités critiques ou élevées trouvées sur les technologies dont vous êtes responsable IT. Affiché quand les vulnérabilités sont suivies |

Les **Alertes d'expiration** envoient un e-mail aux responsables d'un contrat, d'une ligne OPEX ou d'une ligne CAPEX 30, 14, 7 et 1 jour(s) avant ses dates : la prochaine date limite de résiliation d'un contrat, la fin d'un contrat qui ne sera pas reconduit (la fin de son terme, ou sa fin de validité si elle vient avant), la fin de validité d'une ligne OPEX ou CAPEX. Un contrat à reconduction tacite n'est pas averti de la fin de chaque terme. Seuls les responsables qui ont activé les notifications Budget et les **Alertes d'expiration** les reçoivent. La vérification a lieu chaque jour à 08h00 UTC. Chaque rappel est envoyé une seule fois par jour à chaque destinataire, même si la vérification s'exécute à nouveau ce jour-là, par exemple après un redémarrage.

Les **Notifications des technologies** envoient un e-mail aux responsables IT d'une technologie sur ses nouvelles vulnérabilités critiques ou élevées, après la vérification qui les trouve. Voir [Vulnérabilités](vulnerabilities.md#notifications-par-e-mail) pour ce qui est annoncé.

**E-mail de revue hebdomadaire** : Recevez un résumé périodique de votre activité et des éléments à venir. Configurez :
- **Jour de la semaine** (ex. : lundi)
- **Heure** (dans votre fuseau horaire)
- **Fuseau horaire**

Utilisez le bouton **Aperçu de l'e-mail** pour vous envoyer un e-mail de test et vérifier le format.

Toutes les modifications sont enregistrées automatiquement lorsque vous basculez les commutateurs ou changez les sélections.

### À propos de KANAP

Ouvrez **À propos de KANAP** depuis le menu utilisateur, sous **Déconnexion**. L'entrée du menu indique aussi la version. L'onglet **À propos** de cette page affiche le même contenu :

- La version et le déploiement (cloud ou sur site)
- Sur le cloud, pendant un essai, les jours restants, avec un lien **Choisir une offre** pour les administrateurs de la facturation
- Pendant un essai, le parcours choisi à la première ouverture, avec **Changer**, et **Afficher les premiers pas** quand la tuile des premiers pas est masquée. Voir [Mon tableau de bord](my-dashboard.md#trial-first-steps)
- Des liens vers les notes de version de cette version, la documentation, kanap.net et le code source (licence AGPL-3.0)
- Sur site, un lien vers le guide de mise à jour

**Support** indique où obtenir de l'aide :

- Sur le cloud, le support par e-mail est inclus. L'adresse du support ouvre un e-mail qui contient déjà la version, l'espace de travail, le déploiement et votre navigateur. **Copier les informations pour le support** copie les mêmes informations, à coller dans un message.
- Sur site, si vous avez un contrat de support, écrivez à la même adresse, avec le même e-mail prérempli et le même bouton de copie. Sinon, posez votre question dans GitHub Discussions ou signalez un problème dans GitHub Issues. Un dernier lien mène à l'offre de support.

---

## Conseils

  - **Dupliquez les rôles intégrés** : Au lieu de créer des rôles de zéro, dupliquez un rôle intégré et ajustez les autorisations. Cela fait gagner du temps et vous assure de ne pas oublier de ressources importantes.
  - **Utilisez le multi-rôle pour la flexibilité** : Assignez aux utilisateurs plusieurs rôles pour combiner les autorisations, par exemple un rôle « Lecteur finance » plus un rôle « Chef de projet ».
  - **Utilisez le SSO** : Si vous avez Microsoft 365, connectez Entra ID pour une gestion plus facile des utilisateurs et une synchronisation automatique des profils.
  - **Désactivez, ne supprimez pas** : Lorsque quelqu'un part, désactivez son compte pour préserver l'historique d'audit.
  - **Revoyez les autorisations régulièrement** : Auditez les autorisations des rôles périodiquement pour maintenir le principe du moindre privilège.
