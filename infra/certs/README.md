# Certificates from an internal authority

Put a certificate authority file here when the API must trust servers whose certificates your company's own authority signed: an SMTP relay, a PostgreSQL server with `sslmode=require` or `verify-full`, or an S3 store over HTTPS.

The API container reads this directory at `/etc/kanap/certs` (read-only). Git ignores every file here except this one, so `git pull` leaves your files alone.

## What to put here

- One PEM file, for example `company-ca.pem`, with the certificate of your root authority.
- Add the intermediate authorities to the same file when your servers do not send them. A file may hold several certificates one after the other.
- Certificates only. Do not put a private key here.

## Set it up

Run from the repository root (`/opt/kanap` in the installation guide):

```bash
cp /path/to/company-ca.pem infra/certs/company-ca.pem
chmod 644 infra/certs/company-ca.pem
```

The API runs as the unprivileged `node` user, so the file must be readable by everyone. A certificate of an authority is public: mode 644 is safe.

Add this line to `.env`:

```bash
NODE_EXTRA_CA_CERTS=/etc/kanap/certs/company-ca.pem
```

Restart the API:

```bash
docker compose -f infra/compose.onprem.yml up -d api
```

## Check

```bash
docker compose -f infra/compose.onprem.yml exec api node -e 'require("tls").createSecureContext()'
```

The command prints nothing when the API can read the file. When it cannot, it prints a line that starts with `Warning: Ignoring extra certs from`, followed by the path and the reason. The API log shows the same line after the first secure connection. Check the path in `.env`, the name of the file and its mode.

Your authorities are added to the public ones: connections to public services keep working.
