# Déploiement on-premise

KANAP peut être déployé on-premise en **mode single-tenant**. Vous fournissez votre propre PostgreSQL, stockage compatible S3 et reverse proxy TLS. KANAP gère tout le reste : les migrations s'exécutent automatiquement, le tenant et l'utilisateur administrateur sont créés au premier démarrage. Il n'y a aucune limite d'utilisateurs.

## Guides

- **[Installation](installation.md) :** Cloner, construire, configurer et démarrer
- **[Exemple d'installation](installation-example.md) :** Guide pas à pas sur Ubuntu 24.04 avec PostgreSQL, MinIO et nginx
- **[Installation assistée par IA](installation-ai.md) :** Installation en un seul prompt à l'aide d'un agent IA de codage
- **[Configuration](configuration.md) :** Référence des variables d'environnement
- **[Exploitation](operations.md) :** Mises à niveau, sauvegardes, supervision, dépannage
- **[SSO Microsoft Entra](sso-entra.md) :** Authentification unique optionnelle avec Microsoft Entra ID

## Ce qui est inclus

- Fonctionnalités complètes de l'application (budgets, contrats, portefeuille, opérations IT, reporting)
- Migrations automatiques de la base de données au démarrage
- Provisionnement au premier démarrage (tenant, utilisateur administrateur, abonnement)
- Authentification locale par identifiant/mot de passe (sans dépendances externes)
- E-mail optionnel via l'API Resend ou SMTP géré par le client
- SSO Microsoft Entra optionnel

## Ce qui est désactivé

- **Facturation / Stripe :** Désactivé automatiquement (pas de gestion d'abonnement nécessaire)
- **Administration de la plateforme :** Single-tenant uniquement, pas de surfaces de gestion multi-tenant
- **Endpoints d'essai / facture de support :** Non applicables à l'on-premise

## Notes rapides

- `DEPLOYMENT_MODE=single-tenant` est le seul interrupteur qui active le mode on-premise.
- `APP_BASE_URL` doit correspondre à votre URL publique pour les liens d'e-mails et les exports.
- Pour l'e-mail sortant, choisissez soit **Resend** soit **SMTP**. SMTP est destiné aux déploiements single-tenant/on-prem uniquement.
- Le backend retourne des réponses structurées `FEATURE_DISABLED` pour les fonctionnalités désactivées -- l'interface les masque automatiquement.
