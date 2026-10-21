---
name: technology-catalog-curation
description: Build and refresh the KANAP-maintained part of the technology catalog (products endoflife.date does not cover, such as Check Point Gaia or Juniper Junos): read each vendor's official lifecycle source, record versions with release and end-of-support dates, cite the source of every date, and report what changed. Use before every KANAP release, and when a product is added to the curated catalog.
---

# Technology catalog curation

Improve it each time it runs: what made a source hard to read goes into "Vendor notes", and a rule
that turned out wrong is fixed here.

## Why

KANAP ships a catalog of technologies with their versions and end-of-support dates
(`backend/src/technologies/catalog/technologies.catalog.json`). Most entries come from
endoflife.date, which every installation also reads daily. Products endoflife.date does not cover
are maintained by KANAP, one file per product, and refreshed at each release with this skill. A date
KANAP ships is a statement KANAP makes: a wrong date gives customers false confidence. Accuracy
beats coverage.

## Scope rules

- **Step 0: endoflife.date first.** Before adding a product, look for it in
  `https://endoflife.date/api/v1/products` by vendor and product name, aliases and tags included
  (Stormshield is there as `sns-firmware`). If it exists, it belongs to the endoflife.date part of
  the catalog, not here. A curated product that reaches endoflife.date leaves the curated file.
- **Official public sources only.** The vendor's own domain, or its parent or legacy brand domain
  (NetScaler on citrix.com, NetBackup on sort.veritas.com). Accepted forms: HTML pages, pages
  rendered by JavaScript, PDF and spreadsheet attachments, tables published as images, and a
  listing of end-of-life notices when the vendor publishes no table (one notice per version).
  Refused: anything behind a login or a support session, partner portals, forums and community
  posts, reseller pages, Wikipedia, third-party trackers, AI summaries.
- **No guess, no extrapolation.** A rolling rule ("supported 12 months after release", "18 months
  from GA") is not a date: a vendor that publishes only a rule stays out. An unknown date is `null`
  with a `note`.

## Data shape (one file per product)

Each product is `backend/src/technologies/catalog/curated/<key>.json`. The file name is the key.

`family` is a code of `DEFAULT_TECHNOLOGY_FAMILIES`. Network equipment uses `network`. Security
products use `network_security` (default label Security). The family that ships is the `family` of
the `PRODUCTS` entry in `scripts/technologies/build-catalog.mjs`: keep the file and that entry on
the same code.

```json
{
  "key": "check-point-gaia",
  "name": "Check Point Gaia",
  "editor": "Check Point",
  "family": "network_security",
  "lifecycle_url": "https://...",
  "source_updated": "2026-10-09",
  "version_grain": "release train as the vendor names it (R81.20)",
  "versions": [
    {
      "label": "R81.20",
      "aliases": [],
      "release_date": "2022-11-01",
      "standard_support_end": "2027-05-31",
      "extended_support_end": null,
      "no_planned_end": false,
      "date_precision": "month",
      "source_url": "https://...",
      "source_terms": {
        "release_date": "General Availability",
        "standard_support_end": "Support Until",
        "extended_support_end": null
      },
      "checked_on": "2026-10-20",
      "note": null
    }
  ]
}
```

- `lifecycle_url`: the page or listing that covers every version. `source_url`: where this
  version's dates are read (often the same).
- `source_updated`: the "last updated" or "as of" date `lifecycle_url` states, `null` if none;
  dates of other source pages go in the version `note`. The next
  refresh compares it.
- `source_terms`: the vendor's exact column or field names for each date used; `null` whenever the
  date is `null` (a cell holding policy text such as "N-2 Policy" is quoted in `note`). A renamed column
  is a signal to re-read the mapping.

### Dates

- ISO `YYYY-MM-DD`. Check `release_date <= standard_support_end <= extended_support_end`.
- **Month-only sources:** `release_date` takes the first day of the month, end dates the last day;
  set `date_precision: "month"` (default `"day"`).
- **GA range** ("Mar 2020 – Dec 2024"): `release_date` = start of the range, range in `note`.
- `release_date` is the general availability of the version, never the date of its latest build.
- **No planned end** (the vendor says so explicitly, IBM WebSphere 8.5/9.0): end dates `null`,
  `no_planned_end: true`. Plain `null` without it means unknown.
- **Two official sources for one product:** when a second one dates more versions, use it as
  `source_url` and cross-check the first; note every disagreement.
- **Conflicting rows in one source** (duplicates, a release date after the end, end dates that
  contradict each other): cross-check a more
  specific vendor page; otherwise keep the earlier end date, or `null` when the row contradicts
  itself; always say so in `note`.

### Mapping the vendor's terms

Two dates per version, with the same meaning as for the endoflife.date entries:

- `standard_support_end`: end of the normal support: maintenance releases, bug fixes and security
  fixes under the regular contract (End of Maintenance, End of Software Maintenance, End of
  Engineering, EoSWM, EOM, Premier Support Ends, EOSS, End of Updates).
- `extended_support_end`: the last date the vendor still provides anything for the version (End of
  Support, Last Date of Support, LDoS, EOL, Extended Support Ends). `null` when the vendor publishes
  a single end date: that date goes to `standard_support_end`.
- Not stored: end of sale, sustaining or "indefinite" support (in `note` if useful).
- Hardware end-of-life dates are out of scope. Platform-specific or certification extensions (FIPS,
  NDcPP, a platform footnote) and product variants: keep the main row's dates, put the extension
  in `note`; no separate entry.
- Extended support that applies only after upgrading to a maintenance release (NetBackup 10.4 →
  10.4.0.1): store the train's dates and say it in `note`.

### Version grain and labels

- **Grain:** the release train by default (Junos `23.4`, Gaia `R81.20`, ASA `9.18(x)`). When the
  vendor dates a finer level and the dates differ inside a train (Sophos maintenance releases,
  Dell PowerStore builds), use the finer level: group the builds that share the same end dates
  under one label, split where they differ, take the release date of the first build.
- **`aliases`:** other strings the vendor uses for the same entry: versions a grouped row covers
  ("R80.20" also covering R80.30), builds under a grouped label, LTS names (`LTS2026`), the bare
  number of a suffixed label (`7.3` for `7.3 LTS`).
- **Label:** the vendor's version form, without the product name and footnote markers ("Check
  Point R81.20" → `R81.20`, "Arista EOS 4.36.x" → `4.36.x`, "Junos OS 23.4 21" → `23.4`). Suffixes
  that are part of the version stay (`7.3 LTS` only if the vendor's label carries it).
- **Which versions:** every version with an end date on or after 2022-01-01, however many (old
  network and storage firmware stays in production and KANAP must flag it), plus every version the
  vendor still lists as current without an end date (when there are more than 5, keep the 5
  newest and say so in the report). Order by version number, newest first; a grouped label sorts by the highest version it covers
  (label or numeric alias). A group takes the label of the first version the vendor names in it.
  Trains with the same numeric part (NX-OS `7.0(3)I7` / `F3`, Junos `12.3X48`) follow the vendor's
  listing order.
- **One label form per product:** the form of the most recent notices (`9.18(x)`); quote the
  vendor's other forms ("Software Release 9.7") in `note`.

## Fetching

- Try WebFetch, then `curl -sL` with a browser User-Agent and Accept headers (cisco.com answers
  403 to a bare curl), then headless Chromium `--dump-dom` for JavaScript pages (Salesforce
  knowledge pages). Before calling a page empty or login-only, read its raw HTML: the data may sit
  in a script variable (SORT: `var eosl_whole_data`).
- Spreadsheets: convert Excel date serials, check them against the file's own "as of" cell.
- Image tables: read at full size, crop to re-read each date used, say in `note` the table is an image.
- Downloads go to a scratch directory, never into the repository.

## Procedure

### Adding a product

1. Step 0 (endoflife.date). Then find the official source; check it is public.
2. Write down the column names before reading any date.
3. Fill the file; one `source_url` per version.
4. Register the key in `PRODUCTS` (`slug: null, curated: true`, with the same family, the editor,
   the name and the CPE identifiers) and add its description in `technologies.descriptions.json`.
5. Check the date order and the version rule. Re-read two versions against the source.
6. Report what is unclear.

### Refresh before a release

For each curated product:

1. Step 0 again: a product now on endoflife.date moves there.
2. Fetch `lifecycle_url`. If it moved or vanished, find the new official source; never keep a dead
   source silently.
3. Compare `source_updated`, then the versions: new versions, changed dates, removed versions,
   renamed columns.
4. Apply the changes, set `checked_on` to today on every version re-read (also when unchanged).
5. List each change in the report: version, field, old value, new value, source.
6. A product with no reachable official source any more: keep its dates, flag it for the
   maintainer's decision.

`release.mjs prepare` prints this warning when the oldest `checked_on` of a product is more than 120 days old. The warning does not stop the command. A version left with an old `checked_on` was not re-read.

```text
Warning: curated catalog: <n> product(s) checked more than 120 days ago: <keys> (run the technology-catalog-curation skill)
```

### Ship the update

After the files are updated, regenerate the shipped catalog and run its checks. The build needs the network (endoflife.date). `--check-cpe` is offline and checks the curated files as well.

```bash
node scripts/technologies/build-catalog.mjs
node scripts/technologies/build-catalog.mjs --check-cpe
cd backend && npx ts-node src/technologies/__tests__/catalog-guard.spec.ts
cd backend && npx ts-node src/technologies/__tests__/catalog-releases.spec.ts
```

Commit the curated files together with `technologies.catalog.json` and `technologies.descriptions.json`.

### Products waiting for a public source

Keep them in the report's "Without public source" list with what was found, and re-check them at
each refresh: Rubrik CDM, Cohesity DataProtect (support portal), Paessler PRTG (rolling rule),
HPE Aruba AOS-CX (portal since 2026-02-23), Pure Storage Purity//FA (Everpure portal), HPE Alletra
5000/6000 NimbleOS (InfoSight).

## Report

Short markdown, per product: status (added, unchanged, updated, moved to endoflife.date, source
problem), the changes, doubts; then the products without public source; then suggested changes to
this skill. Subagents return it as text: the lead saves it.

## Vendor notes

- **Check Point:** https://www.checkpoint.com/support-services/support-life-cycle-policy/, tab
  "Security Gateway & Management"; month only; rows can cover several versions ("Affected Versions").
- **Cisco ASA:** no table; one end-of-life notice per train from the ASA notice listing; current
  trains have no notice. cisco.com refuses curl unless it sends full browser headers (User-Agent,
  Accept, Accept-Encoding, Upgrade-Insecure-Requests, Sec-Fetch-*).
- **Cisco FTD:** compatibility guide, table "Software EOL announcements", ISO dates; lists only
  announced versions.
- **Cisco NX-OS:** "Software Lifecycle Support Statement" (Table 2) for recent trains, Nexus 9000
  notices for older ones; covers Nexus 3000/9000 only.
- **Arista:** EOS Life Cycle Policy page; the table is a PNG; CAPTCHA for scripts, WebFetch passes;
  older trains have their own notices under advisories-notices/end-of-support (curl gets an
  empty body, WebFetch works); "Last Updated" is printed inside the image; the image downloads
  with a Referer header.
- **Sophos:** KBA-000003353 (Salesforce, headless browser); end of life set per maintenance release;
  DD-MON-YYYY.
- **Ivanti:** hub.ivanti.com "Granular Software Release EOL Timelines and Support Matrix" (headless
  browser); M/D/YYYY; some cells hold policy text ("N-2 Policy").
- **Juniper:** support.juniper.net/support/eol/software/junos/, one HTML table, curl and parse
  (WebFetch sees a survey overlay); footnote numbers glued to labels; footnotes hold platform and
  FIPS extensions.
- **NetScaler:** citrix.com Product Matrix and Legacy Product Matrix (static HTML, dd-Mon-yy, GA in
  the version cell); EOS there means end of sale.
- **Dell:** KB 000185734 links three public xlsx (Hardware, Software, Operating Environment),
  refreshed about monthly; Excel serials; duplicates and typos happen: cross-check product KBs
  (PowerStoreOS Matrix 000175213). EOSL equals EOSS by Dell's definition. Data Domain: the Software xlsx has "Data Domain DD OS" rows per build
  with RTS and EOSS (use it), KB 000081247 (LTS ranges) as cross-check. KB pages need headless
  Chromium (curl gets 403); the xlsx download with curl.
- **Synology:** Software Life Cycle Policy PDF on global.download.synology.com; month only; mixes
  DSM Enterprise and DSM UC.
- **Cohesity (NetBackup):** SORT EOSL matrix, rows in `var eosl_whole_data` (curl); a base row and a
  maintenance row per train; extended support only on the maintenance row;
  trains up to 8.2 carry their extended dates on every row: map that row directly.
- **Oracle:** Lifetime Support Policy PDFs per product family; month only; GA can be a range;
  footnotes override cells.
- **IBM WebSphere:** one support page per version; no planned end for 8.5 and 9.0; Liberty has no
  end date by policy.
