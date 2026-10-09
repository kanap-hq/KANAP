# AI-assisted installation

Instead of following the [step-by-step walkthrough](installation-example.md) yourself, you can give it to a coding AI agent. The agent reads the walkthrough and runs it on your server, step by step. One prompt, one server, one result.

Tools like [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) or [OpenAI Codex](https://openai.com/index/codex/) can read the KANAP documentation, install every dependency, configure all services, and verify the result, typically in under 20 minutes.

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **Server** | Ubuntu 26.04 LTS (24.04 LTS works), freshly provisioned, with 6 GB of RAM or more (8 GB recommended; the image build needs that room), a user with sudo access and outbound internet access during the installation (packages, Docker images, GitHub, and Let's Encrypt if you use it) |
| **Name** | The name users type to open KANAP. A public DNS record is needed only for Let's Encrypt. Otherwise use a record in your company DNS, or a hosts file entry for a test (see [Name and certificate](installation.md#name-and-certificate)). |
| **Certificate** | One of three cases: a public name with Let's Encrypt, certificate files from your internal authority already on the server, or a self-signed certificate for a test |
| **AI agent** | A coding AI agent installed on the server (Claude Code, Codex, or similar) |

### Passwordless sudo

The AI agent runs many commands with `sudo`. To avoid being prompted for a password on every step, temporarily grant your user passwordless sudo:

```bash
echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/90-install-nopasswd
sudo chmod 0440 /etc/sudoers.d/90-install-nopasswd
```

You will remove this at the end of the installation: see [After installation](#after-installation).

## The prompt

Open your AI agent on the server and paste the following prompt. Replace the values in the **Parameters** list with yours, and keep only one **Certificate** line.

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

### Email configuration

Append **one** of the following blocks to the prompt to enable outbound email (password reset, invitations, notifications). The agent adds the values to the `.env` file.

**Option A: Resend** (cloud email API):

```
Email transport: Resend
- RESEND_API_KEY=re_xxxxx
- RESEND_FROM_EMAIL=KANAP <noreply@example.com>
```

**Option B: SMTP** (internal relay or provider):

```
Email transport: SMTP
- SMTP_HOST=smtp.company.com
- SMTP_PORT=587
- SMTP_SECURE=false
- SMTP_USER=noreply@company.com
- SMTP_PASSWORD=secret
- SMTP_FROM=KANAP <noreply@company.com>
```

Replace the values with your actual credentials. SMTP_USER and SMTP_PASSWORD go together. If you skip email configuration, KANAP still works, but password reset and invitations are unavailable until you configure email later (see [Configuration](configuration.md)).

## What to expect

The agent reads the walkthrough, then works through it:

1. **System packages**: installs Docker and Git.
2. **Firewall**: allows SSH, HTTP and HTTPS from the network, and PostgreSQL and the storage from the Docker networks only.
3. **KANAP files**: clones the repository into `/opt/kanap` and checks out `stable`.
4. **PostgreSQL**: installs it, creates the database, the application role and the required extensions, and lets the Docker networks connect.
5. **Object storage**: installs RustFS, creates the bucket, a restricted application user and the encryption key.
6. **KANAP**: writes `.env` with the generated secrets, builds the Docker images and starts the containers.
7. **TLS and nginx**: obtains or creates the certificate, configures the reverse proxy, makes sure the server resolves the name.
8. **Verification**: checks the API health and the front end, then runs the smoke test (database, storage, sign-in, exports).

The agent asks for confirmation before running commands on your server. When it finishes, it gives you the report described in the prompt. The log of the installation is in `~/kanap-install.md`.

## After installation

1. **Read the report.** Check the start-up lines: a `[SECURITY]`, `[CONFIG]` or `[CORS]` warning, or an `[ENV] APP_ENV is not set` line, means a setting needs attention (see [Configuration](configuration.md#what-the-api-log-shows-at-start)).
2. **Review your `.env` file** at `/opt/kanap/.env`. It is readable by its owner only and holds every secret.
3. **Configure email** if you haven't already: see [Configuration](configuration.md) for SMTP or Resend setup, then [test it](configuration.md#test-the-email). Email enables password reset, invitations, and notifications.
4. **Sign in** at `https://your-address` with `ADMIN_EMAIL` and the `ADMIN_PASSWORD` of `.env`: `grep '^ADMIN_PASSWORD=' /opt/kanap/.env` shows it. Change it in your profile if you want one only you know.
5. **Add your logo and colors** in **Admin → Branding** (optional).
6. **Set up the backups** and read the [Operations](operations.md) guide for upgrades and monitoring.
7. **Keep the encryption key.** `/etc/default/rustfs` holds the key that encrypts the stored files. Keep it with your configuration backup.
8. **Remove passwordless sudo.** The installation is complete, restore normal security:

    ```bash
    sudo rm /etc/sudoers.d/90-install-nopasswd
    ```

!!! tip "Same result, different path"
    This prompt produces the same installation as the [manual walkthrough](installation-example.md). If you need to troubleshoot or customize individual components later, that guide remains the reference.
