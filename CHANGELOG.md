# Changelog

Every published version of KANAP, newest first. Versions are numbered `YY.M.N` (year, month,
number in the month: `26.10.1`, then `26.10.2`, then `26.11.1`), and each one has a Git tag of
the same name with a `v` in front (`v26.10.1`). The `stable` branch points to the latest
published version. The same entries are on the GitHub releases page.

Each entry starts with a level-two heading: the version and its date, for example
`26.11.1 (2026-11-03)`. The heading ends with `· Action required` when an existing installation
must do something before or after the upgrade. Below the heading, one or two lines say what the
version brings, followed by three lists:

- **Changes** and **Fixes**: what users see, with the number of the pull request.
- **On-premise**: the required actions (`Action required: ...`), the database migrations, which
  run automatically at start, and the recommended settings.

To upgrade across several versions, read every entry between your version and the target: the
actions add up. The release process is described in `doc/releasing.md`.
