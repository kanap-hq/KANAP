# On-premise : configuration du SSO Microsoft Entra

Ce guide explique comment activer le SSO Microsoft Entra (Azure AD) pour un déploiement on-premise de KANAP.
Le SSO Entra est facultatif ; si vous ne le configurez pas, l'authentification locale par e-mail et mot de passe reste disponible.

## Vue d'ensemble

KANAP utilise le flux OAuth2/OIDC avec code d'autorisation, en tant que client confidentiel.
Chaque client on-premise **doit enregistrer sa propre application Entra** et fournir son ID client et son secret.

### Ce que le client fournit

- Un enregistrement d'application (App Registration) Entra **dans son tenant**
- `ENTRA_CLIENT_ID` et `ENTRA_CLIENT_SECRET`
- `ENTRA_AUTHORITY` pointant vers son tenant
- `ENTRA_REDIRECT_URI` correspondant à son URL KANAP

## Prérequis

- Une adresse HTTPS pour KANAP que les navigateurs de vos utilisateurs peuvent joindre (reverse proxy devant l'API). Un nom interne convient : Microsoft se contente de rediriger le navigateur de l'utilisateur vers cette adresse.
- La possibilité de créer un enregistrement d'application et d'accorder le consentement administrateur dans Entra
- Une connectivité sortante du conteneur API de KANAP vers :
  - `login.microsoftonline.com` (métadonnées OIDC, échange de jetons, JWKS)
  - `graph.microsoft.com` (enrichissement du profil à la connexion et synchronisation quotidienne de l'annuaire)

## Étape 1 : créer un enregistrement d'application (Entra)

1. Ouvrez **Microsoft Entra ID → App registrations → New registration**
2. Nom : `KANAP (on-prem)`
3. Types de comptes pris en charge : **Single tenant** (recommandé)
4. URI de redirection (Web) : `https://<your-kanap-domain>/api/auth/entra/callback`
5. Enregistrez et notez :
   - **Application (client) ID**
   - **Directory (tenant) ID**

## Étape 2 : créer un secret client

1. Allez dans **Certificates & secrets**
2. Créez un nouveau **Client secret**
3. Copiez la **secret value** (elle n'est affichée qu'une seule fois)

## Étape 3 : autorisations d'API

KANAP a besoin de deux jeux d'autorisations : des autorisations déléguées pour la connexion interactive, et une autorisation d'application pour la synchronisation quotidienne de l'annuaire.

### Autorisations déléguées (connexion)

Chaque demande de connexion demande à Entra exactement ces étendues :

```
openid profile email offline_access User.Read
```

Ajoutez les cinq comme autorisations **configurées** de l'enregistrement d'application :

1. Ouvrez **App registrations → votre application KANAP → API permissions**
2. **Add a permission → Microsoft Graph → Delegated permissions**
3. Sélectionnez `openid`, `profile`, `email`, `offline_access` et `User.Read`
4. Cliquez sur **Add permissions**

`User.Read` permet à KANAP de lire dans Microsoft Graph le profil de la personne connectée, pour renseigner son nom, son intitulé de poste, ses téléphones, son département et sa société. Gardez-la. C'est une autorisation distincte de `User.Read.All`. Sans elle, les utilisateurs doivent donner leur consentement à chaque connexion, ou la connexion échoue.

!!! warning "Ajoutez les étendues OIDC avant d'accorder le consentement administrateur"
    Le consentement administrateur à l'échelle du tenant réécrit l'autorisation accordée à l'application pour la faire correspondre à la liste des autorisations **configurées**. `openid`, `profile`, `email` et `offline_access` figurent en général sous « Other permissions granted » et ne sont pas configurées par défaut : un consentement à l'échelle du tenant les supprimerait et casserait les connexions existantes. Le portail Azure affiche lui-même cet avertissement. Ajoutez d'abord les quatre étendues comme autorisations déléguées configurées, puis accordez le consentement.

### Autorisation d'application (synchronisation quotidienne de l'annuaire)

La synchronisation nocturne de l'annuaire s'exécute sans utilisateur connecté : elle a donc besoin d'une autorisation d'application.

1. **API permissions → Add a permission → Microsoft Graph → Application permissions**
2. Sélectionnez **`User.Read.All`**
3. Cliquez sur **Add permissions**

`User.Read.All` couvre aussi le responsable hiérarchique de chaque compte, que KANAP inscrit sur le profil contributeur des personnes qui sont contributeurs. Rien d'autre à ajouter pour cela.

La nouvelle ligne affiche maintenant l'état **Not granted** avec un avertissement orange. C'est attendu. L'autorisation devient utilisable quand un administrateur Microsoft Entra accorde le consentement à l'échelle du tenant, ce qui se fait depuis KANAP à l'[étape 7](#etape-7-autoriser-la-synchronisation-quotidienne-de-lannuaire).

Qui fait quoi :

- **KANAP hébergé** : l'opérateur de KANAP possède l'enregistrement d'application et ajoute l'autorisation. L'administrateur Entra du client se contente d'accorder le consentement.
- **On-premise** : l'équipe IT du client possède l'enregistrement d'application : elle ajoute donc l'autorisation et accorde le consentement.

### Si vous ne voulez pas d'appels Graph à la connexion

```
ENTRA_ENRICH_PROFILE=false
```

Ce paramètre supprime uniquement l'appel Microsoft Graph `/me` effectué pendant la connexion. Les noms et les autres champs du profil proviennent alors du seul jeton d'identité. Il ne désactive pas la synchronisation quotidienne de l'annuaire, qui utilise sa propre autorisation d'application.

## Étape 4 : configurer les variables d'environnement de KANAP

Renseignez les valeurs suivantes dans votre `.env` on-premise :

```bash
# SSO Entra (on-premise) : les quatre sont requises ensemble
ENTRA_CLIENT_ID=<application-client-id>
ENTRA_CLIENT_SECRET=<client-secret>
ENTRA_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
ENTRA_REDIRECT_URI=https://kanap.company.com/api/auth/entra/callback
```

Remarques :
- `ENTRA_AUTHORITY` doit être **propre à votre tenant** en on-premise.
- `ENTRA_REDIRECT_URI` doit correspondre **exactement** à ce que vous avez enregistré dans Entra.
- Vérifiez que `APP_BASE_URL` contient l'adresse exacte ouverte par les utilisateurs (schéma, hôte et port lorsqu'il n'est pas standard). La redirection après connexion est construite à partir d'elle. Sans elle, la connexion Microsoft répond « application URL is not configured ».

## Étape 5 : redémarrer KANAP

Après la modification de `.env`, recréez le conteneur API pour qu'il prenne en compte la nouvelle configuration. Un simple `restart` conserve les anciennes valeurs.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d api
```

## Étape 6 : connecter Entra dans KANAP

1. Connectez-vous en tant qu'administrateur
2. Allez dans **Administration → Authentification**
3. Dans la carte **Microsoft Entra ID**, cliquez sur **Connecter**
4. Approuvez le consentement dans Entra
5. Utilisez **Tester la connexion** pour confirmer la connexion de bout en bout

## Étape 7 : autoriser la synchronisation quotidienne de l'annuaire

Le bloc **Synchronisation quotidienne de l'annuaire** apparaît dans **Administration → Authentification** une fois Entra connecté. Tant qu'un administrateur Microsoft Entra ne l'a pas approuvé, le bloc affiche :

> Pas encore autorisé. Un administrateur Microsoft Entra doit autoriser KANAP à lire les utilisateurs de l'annuaire.

Pour l'approuver :

1. Connectez-vous à KANAP avec un compte administrateur qui est aussi administrateur Microsoft Entra
2. Allez dans **Administration → Authentification → Synchronisation quotidienne de l'annuaire**
3. Cliquez sur **Autoriser dans Microsoft Entra**
4. Approuvez la demande sur la page de consentement de Microsoft

Vous revenez dans KANAP avec le message **Accès accordé. La première synchronisation est en cours.** La ligne « Pas encore autorisé » disparaît.

Vous pouvez aussi accorder le consentement depuis le portail Azure avec **Grant admin consent for &lt;tenant&gt;** sur la page API permissions. KANAP ne le remarque alors qu'à la synchronisation suivante. Cliquez sur **Synchroniser maintenant** pour vérifier tout de suite. Comme KANAP met en cache son jeton Microsoft, la première tentative juste après un consentement accordé dans le portail peut encore indiquer « pas encore autorisé ». Cliquez de nouveau sur **Synchroniser maintenant** et elle réussit. L'exécution nocturne se rétablit d'elle-même dans tous les cas.

## La synchronisation quotidienne de l'annuaire

Une fois autorisé, KANAP interroge Microsoft Graph chaque nuit à 03:00 UTC (l'horloge du conteneur API) et, pour chaque utilisateur lié à Entra :

- Actualise le prénom, le nom, l'intitulé de poste, le téléphone professionnel et le téléphone mobile
- Rapproche le département et la société de l'annuaire **par leur nom** avec les enregistrements KANAP existants. Rien n'est créé automatiquement, et un nom sans correspondance laisse l'affectation inchangée.
- Définit la langue de l'interface uniquement si la personne n'en a pas choisi
- Désactive le compte KANAP si la personne a été retirée de l'annuaire, ou si son compte d'annuaire a été désactivé (`accountEnabled` vaut false)

Une valeur vide dans l'annuaire n'efface jamais une donnée déjà présente dans KANAP.

La désactivation d'un compte déconnecte immédiatement la personne et bloque toute nouvelle connexion. Ses données et son historique sont conservés.

Le bloc de **Administration → Authentification** indique le résultat : **Dernière synchronisation {date} : N comptes actualisés, N désactivés.** après une exécution réussie, ou **La dernière synchronisation a échoué : {message}** sinon. **Synchroniser maintenant** lance la même tâche à la demande.

## Dépannage

- **SSO_NOT_CONFIGURED** : les variables d'environnement Entra manquent ou le tenant n'est pas connecté. Les utilisateurs voient « La connexion avec Microsoft n'est pas configurée pour cet espace de travail. »
- **ENTRA_TENANT_MISMATCH** : vous avez connecté un tenant mais vous essayez de vous connecter depuis un autre. Les utilisateurs voient « Ce compte Microsoft appartient à une autre organisation que celle connectée à cet espace de travail. »
- **ENTRA_EMAIL_UNVERIFIED** : l'adresse e-mail du compte Microsoft n'est pas vérifiée : elle ne peut donc pas servir à la connexion.
- **Invalid Entra state / nonce** : l'état de connexion a expiré, ou la redirection Entra n'est pas revenue à l'URL de callback configurée. Relancez la connexion et vérifiez que `ENTRA_REDIRECT_URI` correspond exactement à l'enregistrement d'application Entra.
- **Mauvaise redirection après la connexion** : vérifiez que `APP_BASE_URL` est l'adresse exacte ouverte par les utilisateurs. La redirection provient de `APP_BASE_URL`, et les en-têtes `Host` et `X-Forwarded-Host` ne la modifient pas. Vérifiez aussi que le proxy envoie `X-Forwarded-Proto`.
- **« Pas encore autorisé » sur la synchronisation de l'annuaire** : soit l'autorisation d'application `User.Read.All` n'a jamais été ajoutée à l'enregistrement d'application, soit un administrateur Microsoft Entra n'a pas encore accordé le consentement à l'échelle du tenant. Vérifiez les deux, puis cliquez sur **Synchroniser maintenant**.
- **Les connexions échouent juste après l'octroi du consentement administrateur** : le consentement a remplacé l'autorisation accordée à l'application par la liste des autorisations configurées, en supprimant `openid`, `profile`, `email` et `offline_access`. Ajoutez-les comme autorisations déléguées configurées et accordez de nouveau le consentement.
- **Secret client expiré** : Microsoft renvoie `AADSTS7000222`. Les utilisateurs voient seulement le message générique « La connexion avec Microsoft n'a pas abouti. Réessayez ou contactez votre administrateur. » sur la page de connexion. Pour confirmer la cause, consultez **Administration → Authentification → Synchronisation quotidienne de l'annuaire** : la ligne d'échec cite le code d'erreur Microsoft. Relancer **Connecter** l'affiche aussi. Créez un nouveau secret client dans **Certificates & secrets**, mettez à jour `ENTRA_CLIENT_SECRET` et recréez l'API (`docker compose -f infra/compose.onprem.yml up -d api`).

## Notes de sécurité

- Ne commitez pas `ENTRA_CLIENT_SECRET` dans git. Gardez `.env` lisible par son seul propriétaire (`chmod 600 .env`).
- Renouvelez le secret régulièrement.
- Utilisez un enregistrement d'application dédié.
