# Installation assistée par IA

Au lieu de suivre vous-même la [procédure pas à pas](installation-example.md), vous pouvez la confier à un agent IA de programmation. L'agent lit la procédure et l'exécute sur votre serveur, étape par étape. Un prompt, un serveur, un résultat.

Des outils comme [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) ou [OpenAI Codex](https://openai.com/index/codex/) peuvent lire la documentation KANAP, installer chaque dépendance, configurer tous les services et vérifier le résultat, en général en moins de 20 minutes.

## Prérequis

| Exigence | Détails |
|-------------|---------|
| **Serveur** | Ubuntu 26.04 LTS (24.04 LTS fonctionne), fraîchement installé, avec 6 Go de RAM ou plus (8 Go recommandés ; le build des images a besoin de cette marge), un utilisateur disposant de sudo et un accès sortant à internet pendant l'installation (paquets, images Docker, GitHub, et Let's Encrypt si vous l'utilisez) |
| **Nom** | Le nom que les utilisateurs saisissent pour ouvrir KANAP. Un enregistrement DNS public n'est nécessaire que pour Let's Encrypt. Sinon, utilisez un enregistrement dans le DNS de votre entreprise, ou une entrée du fichier hosts pour un test (voir [Nom et certificat](installation.md#nom-et-certificat)). |
| **Certificat** | L'un des trois cas : un nom public avec Let's Encrypt, des fichiers de certificat de votre autorité interne déjà présents sur le serveur, ou un certificat auto-signé pour un test |
| **Agent IA** | Un agent IA de programmation installé sur le serveur (Claude Code, Codex ou équivalent) |

### sudo sans mot de passe

L'agent IA exécute de nombreuses commandes avec `sudo`. Pour éviter une demande de mot de passe à chaque étape, accordez temporairement à votre utilisateur le sudo sans mot de passe :

```bash
echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/90-install-nopasswd
sudo chmod 0440 /etc/sudoers.d/90-install-nopasswd
```

Vous le retirerez à la fin de l'installation : voir [Après l'installation](#apres-linstallation).

## Le prompt

Ouvrez votre agent IA sur le serveur et collez le prompt suivant. Remplacez les valeurs de la liste **Parameters** par les vôtres, et ne gardez qu'une seule ligne **Certificate**. Le prompt reste en anglais : il cite les pages anglaises de la documentation.

```
Install KANAP on this Ubuntu server by following the official installation
example step by step, running its commands as written:

  https://doc.kanap.net/on-premise/installation-example/

Background pages: https://doc.kanap.net/on-premise/installation/ and
https://doc.kanap.net/on-premise/configuration/

Parameters:
- Address users open: https://kanap.example.com
- Administrator email: admin@example.com
- Organization name: Example Company
- Certificate (keep one line):
  - Public name: get a certificate from Let's Encrypt, with automatic renewal.
  - Internal certificate: the files are on this server at <path of the full
    chain> and <path of the private key>.
  - Test only: create a self-signed certificate.

Rules:
1. Follow the steps of the guide in order. Use the commands as they are
   written; where the guide shows a choice (Ubuntu 24.04, certificate case),
   take the one that matches this server and my parameters above.
2. Generate every secret on the server, as the guide's step 0 does. Never
   print a secret in the conversation and never write one to the log file.
3. Keep a log of your work in ~/kanap-install.md: the commands you ran, the
   configuration files you wrote (without secrets), and what you saw. For the
   secrets, write only where they are stored: ~/kanap-install.env (deleted at
   the end), /opt/kanap/.env and /etc/default/rustfs.
4. If the docker group is not active in your shell yet, put sudo in front of
   the docker commands.
5. Keep SSH allowed in the firewall before you enable it.
6. Run the checks of the guide's step 9, including the smoke test. Read the
   administrator password from /opt/kanap/.env into the environment of that
   command without printing it.
7. When you finish, report: the start-up lines of the API log (the [ENV],
   [SECRETS], [RATE-LIMIT], [CORS], [DB], [on-prem] and [SECURITY] lines and
   any WARN), the output of docker compose ps, the last line of the smoke
   test, and anything that did not work as the guide says.
```

### Configuration de l'e-mail

Ajoutez **un** des blocs suivants à la fin du prompt pour activer l'e-mail sortant (réinitialisation de mot de passe, invitations, notifications). L'agent ajoute les valeurs au fichier `.env`.

**Option A : Resend** (API d'e-mail dans le cloud) :

```
Email transport: Resend
- RESEND_API_KEY=re_xxxxx
- RESEND_FROM_EMAIL=KANAP <noreply@example.com>
```

**Option B : SMTP** (relais interne ou fournisseur) :

```
Email transport: SMTP
- SMTP_HOST=smtp.company.com
- SMTP_PORT=587
- SMTP_SECURE=false
- SMTP_USER=noreply@company.com
- SMTP_PASSWORD=secret
- SMTP_FROM=KANAP <noreply@company.com>
```

Remplacez les valeurs par vos véritables identifiants. SMTP_USER et SMTP_PASSWORD vont ensemble. Si vous ne configurez pas l'e-mail, KANAP fonctionne quand même, mais la réinitialisation de mot de passe et les invitations restent indisponibles jusqu'à ce que vous configuriez l'e-mail (voir [Configuration](configuration.md)).

## À quoi s'attendre

L'agent lit la procédure, puis la déroule :

1. **Paquets système** : installe Docker et Git.
2. **Pare-feu** : autorise SSH, HTTP et HTTPS depuis le réseau, et PostgreSQL et le stockage depuis les réseaux Docker uniquement.
3. **Fichiers KANAP** : clone le dépôt dans `/opt/kanap` et bascule sur `stable`.
4. **PostgreSQL** : l'installe, crée la base de données, le rôle applicatif et les extensions nécessaires, et autorise les connexions des réseaux Docker.
5. **Stockage objet** : installe RustFS, crée le bucket, un utilisateur applicatif aux droits restreints et la clé de chiffrement.
6. **KANAP** : écrit `.env` avec les secrets générés, construit les images Docker et démarre les conteneurs.
7. **TLS et nginx** : obtient ou crée le certificat, configure le reverse proxy, s'assure que le serveur résout le nom.
8. **Vérification** : contrôle la santé de l'API et du front-end, puis lance le test de recette (base de données, stockage, connexion, exports).

L'agent demande une confirmation avant d'exécuter des commandes sur votre serveur. Quand il a terminé, il vous remet le rapport décrit dans le prompt. Le journal de l'installation se trouve dans `~/kanap-install.md`.

## Après l'installation

1. **Lisez le rapport.** Vérifiez les lignes de démarrage : un avertissement `[SECURITY]`, `[CONFIG]` ou `[CORS]`, ou une ligne `[ENV] APP_ENV is not set`, signale un paramètre à revoir (voir [Configuration](configuration.md#ce-que-le-journal-de-lapi-affiche-au-demarrage)).
2. **Relisez votre fichier `.env`** dans `/opt/kanap/.env`. Il est lisible par son seul propriétaire et contient tous les secrets.
3. **Configurez l'e-mail** si ce n'est pas déjà fait : voir [Configuration](configuration.md) pour SMTP ou Resend, puis [testez-le](configuration.md#tester-lenvoi-des-e-mails). L'e-mail permet la réinitialisation de mot de passe, les invitations et les notifications.
4. **Connectez-vous** à `https://votre-adresse` avec `ADMIN_EMAIL` et le `ADMIN_PASSWORD` de `.env` : `grep '^ADMIN_PASSWORD=' /opt/kanap/.env` l'affiche. Changez-le dans votre profil si vous voulez un mot de passe connu de vous seul.
5. **Ajoutez votre logo et vos couleurs** dans **Administration → Personnalisation** (facultatif).
6. **Mettez en place les sauvegardes** et lisez le guide [Opérations](operations.md) pour les mises à jour et la supervision.
7. **Conservez la clé de chiffrement.** `/etc/default/rustfs` contient la clé qui chiffre les fichiers stockés. Conservez-la avec la sauvegarde de votre configuration.
8. **Retirez le sudo sans mot de passe.** L'installation est terminée, rétablissez la sécurité normale :

    ```bash
    sudo rm /etc/sudoers.d/90-install-nopasswd
    ```

!!! tip "Même résultat, autre chemin"
    Ce prompt produit la même installation que la [procédure manuelle](installation-example.md). Si vous devez plus tard diagnostiquer ou adapter un composant, ce guide reste la référence.
