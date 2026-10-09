# Component inventory and licenses

Each published KANAP version comes with a component inventory (SBOM, CycloneDX JSON) and a
third-party notices file. A license check in CI keeps the production dependencies within the
accepted licenses. Both scripts are plain Node.js with no dependency: they read the
`package-lock.json` files of `backend`, `frontend` and `marketing/web`.

## What counts as a production dependency

Every lockfile entry that `npm ci --omit=dev` installs: entries marked `dev` and links to local
folders are left out; optional packages (platform binaries) and `devOptional` entries are kept,
since a production install can fetch them. A package present at the same version in several
places of the tree counts once.

## License check

`node scripts/sbom/check-licenses.mjs` runs in the `build (onprem)` job of the merge queue, with its
tests (`node --test scripts/sbom/__tests__/*.test.mjs`). It fails when a production dependency has:

- a license of the GPL, AGPL or SSPL family (an `OR` choice passes when one option is accepted, an
  `AND` expression needs every part accepted);
- `UNLICENSED`, a custom reference (`LicenseRef-...`, `SEE LICENSE IN ...`) or no license;
- a value that is not an SPDX expression.

LGPL, MPL and the permissive licenses are accepted. A package that fails can still be accepted
by an entry in `scripts/sbom/license-exceptions.json`: exact name and version, the license the
package declares, and the reason. A new version of that package is checked again. The script lists
the exceptions it used and the ones no longer needed.

## Inventory and notices at a release

1. Check out the release tag. To include package authors in the notices, run `npm ci` in
   `backend`, `frontend` and `marketing/web` first; without `node_modules` the notices give name,
   version and license only.
2. Optional: build the API image of that tag (`docker build -t kanap-api:<version> backend`) to list
   its Alpine packages (pandoc, typst, inkscape, fonts and the base system).
3. Generate the files in a folder outside the repository (the script refuses a folder inside it):

   ```bash
   node scripts/sbom/generate.mjs --out /tmp/kanap-<version>-sbom --image kanap-api:<version>
   ```

4. Attach every file of that folder to the GitHub release:

   ```bash
   gh release upload <tag> /tmp/kanap-<version>-sbom/*
   ```

Files written:

| File | Content |
|---|---|
| `sbom-backend.cdx.json`, `sbom-frontend.cdx.json`, `sbom-marketing-web.cdx.json` | CycloneDX 1.5: one component per package and version, with license, package URL, lockfile hash and download URL |
| `THIRD-PARTY-NOTICES.txt` | Name, version, license and author (when installed) of each production dependency, per folder |
| `api-image-packages.txt` | With `--image`: `apk info -v` of the image and its Node.js version |

The Node.js runtime and the npm bundled in the official `node` image are not Alpine packages: the
image file gives the Node.js version on its second line. The generated files are never committed.
