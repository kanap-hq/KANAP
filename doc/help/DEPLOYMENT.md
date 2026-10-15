# Documentation Deployment Guide

This guide explains how to deploy the KANAP user documentation to Cloudflare Pages.

## Overview

- **Source**: `doc/help/` folder in the main repository
- **Build tool**: MkDocs with Material theme
- **Hosting**: Cloudflare Pages
- **URL**: https://doc.kanap.net

## Cloudflare Pages Setup

### 1. Create a new Pages project

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create**
2. Select **Pages** → **Connect to Git**
3. Select your repository and authorize access
4. Configure the build settings:

| Setting | Value |
|---------|-------|
| **Project name** | `kanap-help` |
| **Production branch** | `stable` |
| **Framework preset** | None |
| **Build command** | `pip install -r requirements.txt && mkdocs build` |
| **Build output directory** | `site` |
| **Root directory** | `doc/help` |
| **Preview deployments** | None |

The production branch is `stable`, which `release.mjs publish` moves to each published version (see `doc/releasing.md`). The published manual therefore always matches the version that cloud and self-hosted installations run. A documentation change merged on `main` goes live with the next version.

The project `kanap-help` was created on 2026-10-15 on the repository `kanap-hq/KANAP`, after the transfer of the repository to the `kanap-hq` organization: a Pages project cannot follow a transferred repository. The former project `kanap-docs` is kept with its automatic deployments disabled, pending deletion.

### 2. Set environment variables (if needed)

No environment variables are required for the basic setup.

For future i18n support, you may add:
- `MKDOCS_LANG`: Default language code

### 3. Configure custom domain

1. In your Pages project, go to **Custom domains**
2. Click **Set up a custom domain**
3. Enter `doc.kanap.net`
4. Cloudflare will automatically configure DNS if the domain is on Cloudflare

### 4. Configure build triggers (optional)

By default, Cloudflare Pages rebuilds on every push to the production branch. To only rebuild when documentation changes:

1. Go to **Settings** → **Builds & deployments**
2. Under **Build watch paths**, add:
   ```
   doc/help/*
   ```

The `kanap-help` project watches `doc/help/*`.

This prevents unnecessary rebuilds when only application code changes.

## Build Configuration Files

### `requirements.txt`
Python dependencies for MkDocs:
```
mkdocs>=1.5.0
mkdocs-material>=9.5.0
pymdown-extensions>=10.0
```

### `mkdocs.yml`
MkDocs configuration including:
- Material theme with light/dark mode
- Navigation structure
- Search configuration
- Markdown extensions

### `docs/_headers`
Cloudflare Pages headers for caching:
- Static assets: 1 year cache
- HTML pages: No cache (instant updates)

### `docs/_redirects`
URL redirects (currently minimal, ready for i18n)

## Local Development

```bash
# Navigate to help folder
cd doc/help

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install dependencies
pip install -r requirements.txt

# Start development server
mkdocs serve

# Open http://localhost:8000
```

## Deployment Workflow

### Automatic (Recommended)

1. Make changes to documentation in `doc/help/docs/en/` (then the translations)
2. Merge them on `main` through a pull request
3. At the next `release.mjs publish`, the `stable` branch moves and Cloudflare Pages rebuilds (~60 seconds)
4. Changes are live at https://doc.kanap.net

### Manual (via Wrangler CLI)

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Build locally
cd doc/help
pip install -r requirements.txt
mkdocs build

# Deploy
wrangler pages deploy site --project-name=kanap-help
```

## Adding a New Language

When ready to add French (or other languages):

1. **Install i18n plugin**:
   ```bash
   # Add to requirements.txt
   mkdocs-static-i18n>=1.2.0
   ```

2. **Update mkdocs.yml**:
   ```yaml
   plugins:
     - search
     - i18n:
         default_language: en
         languages:
           - locale: en
             name: English
             default: true
           - locale: fr
             name: Français
             build: true
   ```

3. **Add translated files**:
   - Copy English files to `docs/fr/`
   - Translate content
   - English stays at `/`, translations at `/fr/`, `/de/`, `/es/`

## Troubleshooting

### Build fails with "mkdocs not found"
Ensure `requirements.txt` is in the root directory (`doc/help/`) and the build command includes `pip install -r requirements.txt`.

### CSS/JS not loading
Check that `site_url` in `mkdocs.yml` matches your deployment URL.

### Changes not appearing
- Check Cloudflare Pages build logs for errors
- Verify the build watch paths include your changed files
- Try a manual deployment via Wrangler

### Search not working
Ensure the `search` plugin is enabled in `mkdocs.yml` and the build completed successfully.

## Monitoring

- **Build status**: Cloudflare Dashboard → Workers & Pages → kanap-help
- **Analytics**: Cloudflare Dashboard → Analytics & Logs (if Web Analytics enabled)
- **Errors**: Check build logs for any Python/MkDocs errors

## Cost

Cloudflare Pages free tier includes:
- 500 builds per month
- Unlimited requests
- Unlimited bandwidth

This is more than sufficient for documentation hosting.
