# Déploiement on-premise

KANAP peut être déployé on-premise en **mode single-tenant**. Vous fournissez votre propre PostgreSQL, un stockage compatible S3 et un reverse proxy TLS. KANAP s'occupe du reste : les migrations s'exécutent automatiquement, le tenant et l'utilisateur administrateur sont créés au premier démarrage. Le nombre d'utilisateurs n'est pas limité.

## Guides

- **[Installation](installation.md) :** prérequis, nom et certificat, clonage, build, configuration et démarrage
- **[Exemple d'installation](installation-example.md) :** procédure pas à pas sur Ubuntu 26.04 avec PostgreSQL, RustFS, un pare-feu et nginx
- **[Installation assistée par IA](installation-ai.md) :** installation en un seul prompt avec un agent IA de programmation
- **[Configuration](configuration.md) :** référence des variables d'environnement, lignes du journal au démarrage, tâches de fond, règles de pare-feu
- **[Opérations](operations.md) :** versions et mises à jour, sauvegarde et restauration, supervision, dépannage
- **[SSO Microsoft Entra](sso-entra.md) :** authentification unique facultative avec Microsoft Entra ID

## Ce qui est inclus

- Toutes les fonctionnalités de l'application (budgets, contrats, portefeuille, opérations IT, reporting)
- Migrations automatiques de la base de données au démarrage
- Provisionnement au premier démarrage (tenant, utilisateur administrateur, abonnement)
- Authentification locale par identifiant et mot de passe (sans dépendance externe)
- E-mail facultatif via l'API Resend ou un serveur SMTP géré par le client
- SSO Microsoft Entra facultatif
- Fonctions d'IA facultatives, avec votre propre fournisseur

## Ce qui est désactivé

- **Facturation / Stripe :** désactivée automatiquement (aucune gestion d'abonnement nécessaire)
- **Administration de la plateforme :** single-tenant uniquement, aucune fonction de gestion multi-tenant
- **Points d'accès d'essai et de facturation du support :** sans objet on-premise

## Notes rapides

- **Versions.** KANAP publie une version environ une fois par mois (`26.10.1` est la première). Vous installez la branche `stable`, qui pointe toujours vers la dernière version publiée, et vous mettez à jour en la récupérant après avoir lu `CHANGELOG.md`. Mettez à jour au moins une fois par mois. Voir [Opérations](operations.md#procedure-de-mise-a-jour).
- **Plateforme.** L'exemple utilise Ubuntu 26.04 LTS (Ubuntu 24.04 fonctionne). Tout système avec Docker Engine 24+ et le plugin Docker Compose 2.20 ou plus récent (les versions actuelles sont en 5.x) est pris en charge.
- **Stockage.** L'exemple exécute RustFS sur le serveur. Tout stockage compatible S3 convient, et un MinIO existant continue de fonctionner.
- **Réseaux internes.** Aucun DNS public n'est nécessaire. Utilisez un nom de votre DNS d'entreprise (ou une entrée du fichier hosts pour un test) avec un certificat de votre autorité interne. Voir [Nom et certificat](installation.md#nom-et-certificat).
- `DEPLOYMENT_MODE=single-tenant` est le seul paramètre qui active le mode on-premise.
- `APP_BASE_URL` doit correspondre exactement à l'adresse ouverte par les utilisateurs (port non standard compris) pour les liens des e-mails, les redirections de connexion et les exports. Mettez la même adresse dans `CORS_ORIGINS`.
- Pour l'e-mail sortant, choisissez **Resend** ou **SMTP**. SMTP est réservé aux déploiements single-tenant / on-premise.
- Les fonctions désactivées on-premise sont masquées automatiquement dans l'application.
