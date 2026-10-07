# On-premise : Configuration SSO Microsoft Entra

Ce guide explique comment activer le SSO Microsoft Entra (Azure AD) pour un déploiement KANAP on-premise.
Le SSO Entra est optionnel ; si vous ne le configurez pas, l'authentification locale par email/mot de passe reste disponible.

## Vue d'ensemble

KANAP utilise le flux de code d'autorisation OAuth2/OIDC en tant que client confidentiel.
Chaque client on-premise **doit enregistrer sa propre application Entra** et fournir son client ID/secret.

### Ce que le client fournit

- Un enregistrement d'application Entra **dans son tenant**
- `ENTRA_CLIENT_ID` et `ENTRA_CLIENT_SECRET`
- `ENTRA_AUTHORITY` pointant vers son tenant
- `ENTRA_REDIRECT_URI` correspondant à son URL KANAP

## Prérequis

- Une URL HTTPS publique pour KANAP (reverse proxy devant l'API)
- La capacité de créer un enregistrement d'application et d'accorder le consentement admin dans Entra
- Connectivité sortante depuis le conteneur API KANAP vers :
  - `login.microsoftonline.com` (métadonnées OIDC, échange de token, JWKS)
  - `graph.microsoft.com` (enrichissement de profil à la connexion et synchronisation quotidienne de l'annuaire)

## Étape 1 : Créer un enregistrement d'application (Entra)

1. Ouvrez **Microsoft Entra ID → Inscriptions d'applications → Nouvelle inscription**
2. Nom : `KANAP (on-prem)`
3. Types de comptes pris en charge : **Locataire unique** (recommandé)
4. URI de redirection (Web) :
   `https://<votre-domaine-kanap>/api/auth/entra/callback`
5. Enregistrez et notez :
   - **ID d'application (client)**
   - **ID de répertoire (tenant)**

## Étape 2 : Créer un secret client

1. Allez dans **Certificats & secrets**
2. Créez un nouveau **Secret client**
3. Copiez la **valeur du secret** (elle n'est affichée qu'une seule fois)

## Étape 3 : Autorisations API

KANAP a besoin de deux ensembles d'autorisations : des autorisations déléguées pour la connexion interactive, et une autorisation d'application pour la synchronisation quotidienne de l'annuaire.

### Autorisations déléguées (connexion)

Chaque demande de connexion réclame à Entra exactement ces scopes :

```
openid profile email offline_access User.Read
```

Ajoutez les cinq comme autorisations **configurées** sur l'enregistrement d'application :

1. Ouvrez **Inscriptions d'applications → votre application KANAP → Autorisations d'API**
2. **Ajouter une autorisation → Microsoft Graph → Autorisations déléguées**
3. Sélectionnez `openid`, `profile`, `email`, `offline_access` et `User.Read`
4. Cliquez sur **Ajouter des autorisations**

`User.Read` permet à KANAP de lire depuis Microsoft Graph le profil de la personne connectée, afin de renseigner son nom, son poste, ses téléphones, son département et sa société. Conservez cette autorisation. Il s'agit d'une autorisation distincte de `User.Read.All`, pas d'une version plus ancienne. Sans elle, les utilisateurs doivent donner leur consentement à chaque connexion, ou la connexion échoue.

!!! warning "Ajoutez les scopes OIDC avant d'accorder le consentement administrateur"
    Le consentement administrateur à l'échelle du tenant réécrit l'autorisation accordée à l'application pour la faire correspondre à la liste des autorisations **configurées**. `openid`, `profile`, `email` et `offline_access` figurent généralement sous « Autres autorisations accordées » et ne sont pas configurées par défaut. Un consentement à l'échelle du tenant les supprimerait donc et casserait les connexions existantes. Le portail Azure affiche lui-même cet avertissement. Ajoutez d'abord les quatre scopes comme autorisations déléguées configurées, puis accordez le consentement.

### Autorisation d'application (synchronisation quotidienne de l'annuaire)

La synchronisation nocturne de l'annuaire s'exécute sans utilisateur connecté. Elle a donc besoin d'une autorisation d'application :

1. **Autorisations d'API → Ajouter une autorisation → Microsoft Graph → Autorisations d'application**
2. Sélectionnez **`User.Read.All`**
3. Cliquez sur **Ajouter des autorisations**

`User.Read.All` couvre aussi le responsable de chaque compte, que KANAP inscrit sur la fiche des personnes qui sont contributeurs. Rien d'autre à ajouter pour cela.

La nouvelle ligne affiche alors le statut **Non accordé** avec un avertissement orange. C'est normal. L'autorisation devient utilisable une fois qu'un administrateur Microsoft Entra a accordé le consentement à l'échelle du tenant, ce qui se fait depuis KANAP à l'[Étape 7](#etape-7-autoriser-la-synchronisation-quotidienne-de-lannuaire).

Qui fait quoi :

- **KANAP hébergé** : l'opérateur KANAP possède l'enregistrement d'application et ajoute l'autorisation. L'administrateur Entra du client accorde seulement le consentement.
- **On-premise** : l'informatique du client possède l'enregistrement d'application, elle ajoute donc l'autorisation et accorde le consentement.

### Si vous ne souhaitez pas d'appels Graph à la connexion

```
ENTRA_ENRICH_PROFILE=false
```

Cela ignore uniquement l'appel Microsoft Graph `/me` effectué pendant la connexion. Les noms et les autres champs de profil proviennent alors du seul token ID. Cela ne désactive pas la synchronisation quotidienne de l'annuaire, qui utilise sa propre autorisation d'application.

## Étape 4 : Configurer les variables d'environnement KANAP

Définissez les éléments suivants dans votre `.env` on-premise :

```bash
# SSO Entra (on-prem)
ENTRA_CLIENT_ID=<application-client-id>
ENTRA_CLIENT_SECRET=<client-secret>
ENTRA_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
ENTRA_REDIRECT_URI=https://kanap.company.com/api/auth/entra/callback
```

Notes :
- `ENTRA_AUTHORITY` doit être **spécifique au tenant** pour l'on-premise.
- `ENTRA_REDIRECT_URI` doit correspondre **exactement** à ce que vous avez enregistré dans Entra.
- Assurez-vous que `APP_BASE_URL` est défini sur l'adresse exacte que les utilisateurs ouvrent (schéma, hôte et port s'il n'est pas standard). La redirection post-connexion en est déduite. Sans elle, la connexion Microsoft répond « application URL is not configured ».

## Étape 5 : Redémarrer KANAP

Après avoir mis à jour `.env`, redémarrez vos conteneurs pour que l'API prenne en compte la nouvelle configuration.

## Étape 6 : Connecter Entra dans KANAP

1. Connectez-vous en tant qu'administrateur
2. Allez dans **Administration → Authentification**
3. Dans la carte **Microsoft Entra ID**, cliquez sur **Connecter**
4. Approuvez le consentement dans Entra
5. Utilisez **Tester la connexion** pour confirmer la connexion de bout en bout

## Étape 7 : Autoriser la synchronisation quotidienne de l'annuaire

Le bloc **Synchronisation quotidienne de l'annuaire** apparaît dans **Administration → Authentification** une fois Entra connecté. Tant qu'un administrateur Microsoft Entra ne l'a pas approuvé, le bloc affiche :

> Pas encore autorisé. Un administrateur Microsoft Entra doit autoriser KANAP à lire les utilisateurs de l'annuaire.

Pour l'approuver :

1. Connectez-vous à KANAP avec un compte administrateur qui est aussi administrateur Microsoft Entra
2. Allez dans **Administration → Authentification → Synchronisation quotidienne de l'annuaire**
3. Cliquez sur **Autoriser dans Microsoft Entra**
4. Approuvez la demande sur la page de consentement Microsoft

Vous revenez dans KANAP avec le message **Accès accordé. La première synchronisation est en cours.** La ligne « Pas encore autorisé » disparaît.

Vous pouvez aussi accorder le consentement depuis le portail Azure avec **Accorder un consentement administrateur pour &lt;tenant&gt;** sur la page des autorisations d'API. KANAP ne s'en aperçoit alors qu'à la synchronisation suivante. Cliquez sur **Synchroniser maintenant** pour vérifier immédiatement. Comme KANAP met en cache son token Microsoft, la première tentative juste après un consentement donné dans le portail peut encore signaler « pas encore autorisé ». Cliquez de nouveau sur **Synchroniser maintenant** et l'opération réussit. Dans tous les cas, l'exécution nocturne se rétablit d'elle-même.

## La synchronisation quotidienne de l'annuaire

Une fois autorisée, KANAP contacte Microsoft Graph chaque nuit à 03h00 (heure du serveur) et, pour chaque utilisateur lié à Entra :

- Actualise le prénom, le nom, le poste, le téléphone professionnel et le téléphone mobile
- Rapproche le département et la société de l'annuaire **par leur nom** des enregistrements KANAP existants. Rien n'est créé automatiquement, et un nom sans correspondance laisse l'affectation inchangée.
- Définit la langue de l'interface uniquement si la personne n'en a pas choisi une
- Désactive le compte KANAP si la personne a été supprimée de l'annuaire, ou si son compte d'annuaire a été désactivé (`accountEnabled` est faux)

Les valeurs vides de l'annuaire n'effacent jamais des données déjà présentes dans KANAP.

La désactivation d'un compte déconnecte immédiatement la personne et bloque toute connexion ultérieure. Ses données et son historique sont conservés.

Le bloc dans **Administration → Authentification** indique le résultat : **Dernière synchronisation {date} — N comptes actualisés, N désactivés.** après une exécution réussie, ou **La dernière synchronisation a échoué : {message}** sinon. **Synchroniser maintenant** lance la même tâche à la demande.

## Dépannage

- **SSO_NOT_CONFIGURED** : Les variables d'environnement Entra sont manquantes ou le tenant n'est pas connecté. Les utilisateurs voient « La connexion avec Microsoft n'est pas configurée pour cet espace de travail. »
- **ENTRA_TENANT_MISMATCH** : Vous avez connecté un tenant mais vous essayez de vous connecter depuis un autre. Les utilisateurs voient « Ce compte Microsoft appartient à une autre organisation que celle connectée à cet espace de travail. »
- **ENTRA_EMAIL_UNVERIFIED** : L'adresse e-mail du compte Microsoft n'est pas vérifiée et ne peut donc pas servir à la connexion.
- **Invalid Entra state / nonce** : L'état de connexion a expiré ou la redirection Entra n'est pas revenue vers l'URL de callback configurée. Réessayez la connexion et vérifiez que `ENTRA_REDIRECT_URI` correspond exactement à l'enregistrement d'application Entra.
- **Mauvaise redirection après connexion** : Vérifiez que `APP_BASE_URL` est l'adresse exacte que les utilisateurs ouvrent. La redirection vient de `APP_BASE_URL`, et les en-têtes `Host` et `X-Forwarded-Host` ne la modifient pas. Vérifiez aussi que le proxy envoie `X-Forwarded-Proto`.
- **« Pas encore autorisé » sur la synchronisation de l'annuaire** : soit l'autorisation d'application `User.Read.All` n'a jamais été ajoutée à l'enregistrement d'application, soit aucun administrateur Microsoft Entra n'a encore accordé le consentement à l'échelle du tenant. Vérifiez les deux points, puis cliquez sur **Synchroniser maintenant**.
- **Les connexions ont commencé à échouer juste après l'octroi du consentement administrateur** : le consentement a remplacé l'autorisation accordée à l'application par la liste des autorisations configurées, supprimant `openid`, `profile`, `email` et `offline_access`. Ajoutez-les comme autorisations déléguées configurées et accordez de nouveau le consentement.
- **Secret client expiré** : Microsoft renvoie `AADSTS7000222`. Les utilisateurs voient seulement le message générique « La connexion avec Microsoft n'a pas abouti. Réessayez ou contactez votre administrateur. » sur la page de connexion. Pour confirmer la cause, regardez **Administration → Authentification → Synchronisation quotidienne de l'annuaire** : la ligne d'échec cite le code d'erreur Microsoft. Relancer **Connecter** l'affiche également. Créez un nouveau secret client dans **Certificats & secrets**, mettez à jour `ENTRA_CLIENT_SECRET`, puis redémarrez l'API.

## Notes de sécurité

- Ne commitez pas `ENTRA_CLIENT_SECRET` dans git.
- Renouvelez le secret périodiquement.
- Utilisez un enregistrement d'application dédié.
