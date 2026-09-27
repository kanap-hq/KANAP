# Administration

La section Administration donne accès à la gestion des utilisateurs, la configuration des rôles, la facturation, les paramètres d'authentification, les contrôles de personnalisation et le lecteur du journal d'audit. Ces pages sont généralement réservées aux administrateurs.

## Où trouver cette page

Rendez-vous dans **Administration** depuis le menu principal pour accéder au hub d'administration.

**Autorisations** : Les différentes pages d'administration nécessitent différentes autorisations :
- Sociétés, Départements, Fournisseurs, Comptes : `{ressource}:reader` pour consulter
- Utilisateurs et accès : `users:reader` pour consulter, `users:admin` pour gérer
- Rôles : `users:reader` pour consulter, `users:admin` pour modifier
- Journal d'audit : Nécessite `users:admin`
- Facturation : Nécessite le rôle admin facturation
- Authentification : Nécessite `users:admin` (contrôlé par feature flag ; nécessite SSO activé)
- Personnalisation : Nécessite `users:admin` (hôte tenant uniquement ; accessible depuis la barre latérale)

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
| **Journal d'audit** | Parcourir tout l'historique des modifications | `users:admin` |
| **Facturation** | Plan et factures | Admin facturation |

Authentification et Personnalisation sont accessibles depuis la navigation dans la barre latérale mais n'apparaissent pas sur la page d'accueil du hub d'administration.

---

## Journal d'audit

La page Journal d'audit affiche l'historique des modifications au niveau du tenant pour les mises à jour de données à travers la plateforme.

### Accès

- Route : `/admin/audit-logs`
- Autorisation requise : `users:admin`
- Cette page est en lecture seule (aucune action de création/modification/suppression).

### Ce que vous pouvez faire

- Rechercher dans le nom de table, l'action et l'acteur (e-mail/nom)
- Filtrer par :
  - Date
  - Table
  - Action
  - Source (`user`, `system`, `webhook`)
- Ouvrir n'importe quelle ligne pour voir les détails complets :
  - Pastilles de métadonnées (date, table, action, source, référence source, tenant, id d'enregistrement, utilisateur)
  - Résumé des champs modifiés
  - Payloads JSON **Avant** et **Après** côte à côte

### Colonnes

**Colonnes par défaut** :
- **Date** : Quand la modification a eu lieu
- **Table** : Quelle table de base de données a été affectée
- **Action** : Le type de modification (create, update, delete, disable)
- **Source** : Qui ou quoi a déclenché la modification (user, system, webhook)
- **Utilisateur** : E-mail de l'utilisateur qui a fait la modification (ou « System »/« Webhook » pour les sources non-utilisateur)

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
- **ID d'enregistrement** : Identifiant de l'enregistrement affecté
- **ID utilisateur** : UUID de l'utilisateur agissant
- **Nom utilisateur** : Nom d'affichage de l'utilisateur agissant
- **Réf. source** : Référence externe pour les modifications provenant de webhooks
- **ID tenant** : Le tenant auquel cette entrée appartient

### Pagination

- La grille utilise une pagination explicite avec **100 lignes par page**.
- Les filtres et la recherche s'appliquent à l'ensemble des données, pas seulement à la page actuelle.

### Comprendre la source et l'acteur

- **Source = user** : modification déclenchée par l'action d'un utilisateur authentifié.
- **Source = webhook** : modification déclenchée par un webhook externe (par exemple des événements de synchronisation de facturation). Utilisez **Réf. source** pour faire le lien avec les identifiants d'événements en amont.
- **Source = system** : processus interne de la plateforme, sans acteur utilisateur direct.

Si un compte utilisateur n'est plus identifiable dans le contexte actuel, la colonne Utilisateur peut afficher un UUID de repli (`Unknown (xxxx...)`) au lieu d'un e-mail.

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
| **Importer CSV** | Import en masse d'utilisateurs | `users:admin` |
| **Exporter CSV** | Exporter la liste des utilisateurs | `users:admin` |
| **Inviter** | Envoyer des invitations de connexion aux utilisateurs sélectionnés | `users:admin` |
| **Désactiver** | Désactiver les utilisateurs sélectionnés. Ils sont déconnectés immédiatement. | `users:admin` |
| **Supprimer** | Supprimer définitivement les utilisateurs sélectionnés | `users:admin` |

`users:reader` suffit pour ouvrir la page et consulter la liste. Toutes les actions ci-dessus, ainsi que les actions de ligne ci-dessous, nécessitent `users:admin`.

Actions de ligne, depuis le menu au bout de chaque ligne :

| Action | Description |
|--------|-------------|
| **Modifier** | Ouvrir l'utilisateur pour le modifier. Cliquer sur la ligne fait la même chose. |
| **Activer** / **Désactiver** | Activer ou désactiver le compte. La désactivation déconnecte la personne immédiatement. |
| **Envoyer une invitation** | Envoyer une invitation de connexion par e-mail. Masqué pour les comptes Microsoft Entra. |
| **Envoyer une réinitialisation de mot de passe** | Envoyer un lien de réinitialisation de mot de passe par e-mail. Affiché uniquement pour les comptes locaux activés. |
| **Supprimer** | Supprimer définitivement l'utilisateur. Désactivez plutôt le compte si d'autres enregistrements le référencent. |

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

### Assignation multi-rôles

Les utilisateurs peuvent se voir assigner plusieurs rôles. Leurs autorisations effectives sont la combinaison de tous les rôles assignés -- si un rôle donne accès à une ressource, l'utilisateur a cet accès.

Retirer tous les rôles ne supprime pas le compte. L'utilisateur revient au rôle système **Contact**, ne conserve aucun accès et apparaît avec le statut **Accès en attente** dans la grille. Vous ne pouvez pas retirer votre propre dernier rôle, vous ne pouvez donc pas vous bloquer l'accès.

### Gestion des sièges

L'abonnement hébergé inclut un nombre **illimité d'utilisateurs** — il n'y a pas de limite de sièges à gérer :
- **Utilisateurs activés** : Peuvent se connecter et utiliser KANAP
- **Utilisateurs désactivés** : Conservent leurs données mais ne peuvent plus se connecter
- Le compteur dans la barre d'outils affiche le nombre d'utilisateurs activés
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
- **Contributeur** : Consultation et modification des éléments existants, ajout de commentaires et pièces jointes, mais pas de création de nouveaux éléments de premier niveau (actuellement utilisé pour les projets du portefeuille)
- **Member** : Consultation, création et modification
- **Admin** : Accès complet incluant la suppression

### Groupes d'autorisations

Les ressources sont organisées en groupes pour faciliter la gestion :

**Budget et finance**
| Ressource | Ce qu'elle contrôle |
|-----------|---------------------|
| `opex` | Dépenses opérationnelles |
| `capex` | Dépenses d'investissement |
| `budget_ops` | Outils d'administration budgétaire |
| `contracts` | Contrats fournisseurs |
| `analytics` | Dimensions analytiques |
| `reporting` | Accès aux rapports |

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
| `settings` | Paramètres des applications |

**Données de référence**
| Ressource | Ce qu'elle contrôle |
|-----------|---------------------|
| `companies` | Données de référence des sociétés |
| `departments` | Données de référence des départements |
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
| **Intégré** | Rôles pré-configurés fournissant des schémas d'accès standard. Ne peut pas être modifié directement -- utilisez **Dupliquer** pour créer une copie personnalisable. |
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
- **Modifier des projets existants** -- mettre à jour les champs, ajouter des commentaires, téléverser des pièces jointes, gérer les phases, jalons, dépendances et entrées de temps
- **Créer et travailler sur les tâches projet** -- ajouter des tâches aux projets, saisir du temps et poster des commentaires
- **Consulter les utilisateurs, sociétés, départements et contacts** pour les sélections dans les menus déroulants

Un Contributeur métier **ne peut pas** :
- Créer de nouveaux projets (nécessite le niveau Member sur les projets du portefeuille)
- Convertir des demandes en projets (nécessite le niveau Member)
- Importer/exporter en CSV (nécessite le niveau Admin)

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
- **Supprimer** : Supprimer un rôle personnalisé (seulement si aucun utilisateur n'est assigné)
- **Enregistrer les détails** : Mettre à jour le nom et la description du rôle
- **Enregistrer les autorisations** : Appliquer les modifications d'autorisations

### Créer un rôle personnalisé

1. Cliquez sur **Nouveau rôle**
2. Saisissez un nom et une description
3. Cliquez sur **Créer**
4. Définissez les niveaux d'autorisation pour chaque groupe de ressources
5. Cliquez sur **Enregistrer les autorisations**

**Conseil** : Commencez par dupliquer un rôle intégré qui se rapproche de ce dont vous avez besoin, puis ajustez les autorisations.

---

## Facturation

Gérez votre abonnement, vos utilisateurs et vos factures.

### Vue d'ensemble de l'abonnement

La carte d'abonnement affiche votre plan actuel en un coup d'oeil :
- **Plan** : Hosted KANAP (ou Essai gratuit). L'abonnement inclut un nombre illimité d'utilisateurs — facturation mensuelle ou annuelle
- **Sièges** : Nombre d'utilisateurs activés
- **Statut** : Actif, En essai, En retard, Annulé, etc.
- **Date de renouvellement** : Quand le prochain cycle de facturation commence

Pour les abonnements actifs (pas les essais locaux), des détails supplémentaires sont affichés :
- **Montant par période** : Coût pour le cycle de facturation en cours
- **Fréquence de facturation** : Mensuelle ou Annuelle
- **Méthode de collecte** : Prélèvement automatique ou Facture (paiement manuel)
- **Moyen de paiement** : Détails de la carte ou Virement bancaire
- **Dernière synchro Stripe** : Quand les données d'abonnement ont été mises à jour depuis Stripe

Si l'abonnement est en période d'essai, le nombre de jours d'essai restants est affiché.

### Actions

- **Choisir un plan** / **Changer de plan** : Ouvrir la boîte de dialogue du plan pour souscrire ou basculer entre facturation mensuelle et annuelle. Nécessite l'admin facturation.
- **Gérer l'abonnement** : Ouvrir le portail client Stripe pour mettre à jour les moyens de paiement, annuler ou effectuer d'autres modifications. Disponible uniquement lorsqu'un abonnement Stripe existe.

Si votre abonnement n'est pas en règle (essai expiré, paiement en retard, etc.), la boîte de dialogue de sélection du plan s'ouvre automatiquement lorsque vous visitez la page Facturation.

### Historique des factures

Les factures passées sont affichées sous la carte d'abonnement :
- Numéro de facture et date
- Statut (Brouillon, Ouverte, Payée, Annulée, Non recouvrable)
- Montant et devise
- **Voir** : Ouvrir la facture dans le lecteur hébergé de Stripe
- **Télécharger** : Télécharger le PDF de la facture

Par défaut, les cinq factures les plus récentes sont affichées. Cliquez sur **Afficher plus de factures** pour voir tout l'historique.

### Informations client

Mettez à jour les coordonnées associées à votre enregistrement client Stripe :
- **Nom du client** et **Société**
- **E-mail** et **Téléphone**
- **Numéro de TVA**
- **Adresse** (ligne 1, ligne 2, ville, état/province, code postal, pays)

### Informations de facturation

Coordonnées séparées utilisées spécifiquement sur les factures. Cliquez sur **Copier depuis le client** pour pré-remplir depuis les informations client ci-dessus.

Les champs sont les mêmes que dans la section Informations client : nom du destinataire, société, e-mail, téléphone, numéro de TVA et adresse complète.

Cliquez sur **Enregistrer les modifications** pour mettre à jour à la fois les informations client et les informations de facturation. Utilisez **Réinitialiser** pour abandonner les modifications non enregistrées.

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
| **Dernière synchronisation {date} — N comptes actualisés, N désactivés.** | Résultat de la dernière exécution réussie. |
| **La dernière synchronisation a échoué : {message}** | La dernière exécution ne s'est pas terminée. Le message provient de Microsoft. |
| **Synchroniser maintenant** | Lance la synchronisation immédiatement au lieu d'attendre la nuit. Affiche **Synchronisation terminée : N comptes actualisés, N désactivés.** |

Les étapes de configuration de l'enregistrement d'application Entra sont décrites dans [SSO Microsoft Entra](on-premise/sso-entra.md).

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

## Paramètres

La page Paramètres vous permet de gérer votre profil personnel et vos préférences de notification. Accédez-y depuis le menu utilisateur (avatar en haut à droite) ou naviguez vers `/settings`.

La page a deux onglets, accessibles via URL :
- `/settings/profile` (par défaut) -- Onglet Profil
- `/settings/notifications` -- Onglet Notifications

### Profil

Modifiez vos informations personnelles :
- **Prénom** / **Nom**
- **Intitulé de poste**
- **Tél. professionnel** / **Tél. mobile**

Si votre organisation utilise Microsoft Entra ID (SSO), certains champs peuvent être synchronisés depuis Entra et ne peuvent pas être modifiés dans KANAP.

### Notifications

Contrôlez quelles notifications par e-mail vous recevez.

**Bascule principale** : Activez ou désactivez toutes les notifications par e-mail avec le commutateur **Notifications par e-mail** en haut.

**Catégories par espace de travail** (chacune avec sa propre bascule activer/désactiver) :

| Espace de travail | Catégories de notifications |
|-------------------|-----------------------------|
| **Portefeuille** | Changements de statut, ajout à une équipe, changements d'équipe sur les éléments que vous pilotez, commentaires |
| **Tâches** | Assignation (comme responsable, demandeur ou observateur), changements de statut, commentaires |
| **Budget** | Alertes d'expiration, changements de statut, commentaires |

Les **Alertes d'expiration** envoient un e-mail aux responsables d'un contrat, d'un poste OPEX ou d'un poste CAPEX 30, 14, 7 et 1 jour(s) avant ses dates : la date limite de résiliation et la date de fin d'un contrat, la fin de validité d'un poste OPEX ou CAPEX. Seuls les responsables qui ont activé les notifications Budget et les **Alertes d'expiration** les reçoivent. La vérification a lieu chaque jour à 08h00 UTC.

**E-mail de revue hebdomadaire** : Recevez un résumé périodique de votre activité et des éléments à venir. Configurez :
- **Jour de la semaine** (ex. : lundi)
- **Heure** (dans votre fuseau horaire)
- **Fuseau horaire**

Utilisez le bouton **Aperçu de l'e-mail** pour vous envoyer un e-mail de test et vérifier le format.

Toutes les modifications sont enregistrées automatiquement lorsque vous basculez les commutateurs ou changez les sélections.

---

## Conseils

  - **Dupliquez les rôles intégrés** : Au lieu de créer des rôles de zéro, dupliquez un rôle intégré et ajustez les autorisations. Cela fait gagner du temps et vous assure de ne pas oublier de ressources importantes.
  - **Utilisez le multi-rôle pour la flexibilité** : Assignez aux utilisateurs plusieurs rôles pour combiner les autorisations -- par exemple, un rôle « Lecteur finance » plus un rôle « Chef de projet ».
  - **Utilisez le SSO** : Si vous avez Microsoft 365, connectez Entra ID pour une gestion plus facile des utilisateurs et une synchronisation automatique des profils.
  - **Désactivez, ne supprimez pas** : Lorsque quelqu'un part, désactivez son compte pour préserver l'historique d'audit.
  - **Revoyez les autorisations régulièrement** : Auditez les autorisations des rôles périodiquement pour maintenir le principe du moindre privilège.
