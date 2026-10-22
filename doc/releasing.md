# Releasing KANAP

KANAP publishes versions on the maintainer's decision. A version is a tested commit of `main`
with a number, a Git tag, a `CHANGELOG.md` entry and a GitHub release. Two commands of
`scripts/release/release.mjs` do the work: `prepare` opens the release pull request, `publish`
tags and publishes it once it has merged.

## Versions

- Numbers are calendar based: `YY.M.N`, the year on two digits, the month, then the number of the
  version in that month. `26.10.1`, then `26.10.2`, then `26.11.1`; January 2027 is `27.1.1`.
  There is no leading zero, so `npm version` accepts the number as it is. Versions compare as
  three integers.
- The tag is the number with a `v` in front: `v26.10.1`. A tag is never moved.
- A version is `main` at the moment of the decision, plus one release commit: `backend/package.json`
  and `frontend/package.json` (and their lockfiles) at the version, and one new entry at the top of
  `CHANGELOG.md`. The API reports the version of `backend/package.json`.
- The `stable` branch points to the latest published version. On-premise installations follow it;
  QA and production run published versions only.
- Fixes always come from `main`: a fix is merged like any change, then shipped in a new version.
  There is no maintenance branch, so `stable` only ever moves forward.

## Release notes

`CHANGELOG.md` is written by release pull requests only. Every other pull request carries its
notes in the `## Release notes` section of its description (see
`.github/pull_request_template.md`): what users see under `Visible changes`, and required actions,
recommendations and migrations under `On-premise`. A pull request with nothing to say writes
`None`.

An entry of `CHANGELOG.md` looks like this. The heading ends with `· Action required` when an
existing installation must do something; the GitHub release title repeats it.

```markdown
## 26.11.1 (2026-11-03) · Action required

One or two lines on what this version brings.

### Changes
- Budget lists open on the current year (#512)

### Fixes
- CSV exports keep the dates of the lines (#515)

### On-premise
- Action required: set `APP_BASE_URL` to the address users open.
- Migrations: run automatically at start (1853880000000-round-inputs-lines-result).
- Recommended: none
```

Notes describe the behaviour of the version in neutral words.

## Prepare a version

Run it when the merge queue is empty, from any directory of the repository:

```bash
node scripts/release/release.mjs prepare 26.10.2 [--dry-run]
```

The first version has no previous tag to start from: give the starting commit with
`--since <ref>`. Once a version tag exists, `--since` is ignored.

Refresh the KANAP-maintained catalog before preparing a version. Its files are
`backend/src/technologies/catalog/curated/*.json`. The `technology-catalog-curation` skill reads
each vendor source again and regenerates the shipped catalog. `prepare` then warns when a
product's oldest `checked_on` is more than 120 days old. The warning does not stop the command.

The command:

1. Checks that `gh` is signed in, that the number is a valid version, and, after
   `git fetch origin --tags`, that it is greater than the latest `v*` tag of `origin`.
2. Creates a worktree outside the repository, `../kanap-release/v26.10.2`, on a new branch
   `release/v26.10.2` from `origin/main`. The checkout you run the command from is never touched.
   When the worktree already exists on that branch, it is reused.
3. When `CHANGELOG.md` has no entry for the version yet: runs `npm version <version>
   --no-git-tag-version` in `backend/` and `frontend/` (it updates `package.json` and
   `package-lock.json`, no `node_modules` needed), and inserts an empty entry dated today. Its
   On-premise block lists the migrations added since the previous version.
4. Lists the pull requests merged since the previous version (the `(#NNN)` of the squash commits),
   reads their descriptions with `gh pr view`, and writes their `Release notes` sections to
   `../kanap-release/v26.10.2-release-notes.md`. Pull requests without a section come last. The
   draft stays outside the repository and is never committed.

Write the entry in the worktree's `CHANGELOG.md` from the draft: the summary line, the `Changes`
and `Fixes` items with their pull request numbers, and the On-premise block. Then run:

```bash
node scripts/release/release.mjs prepare 26.10.2 --commit
```

It checks the entry again (an entry that is still the empty skeleton is refused), commits
`Release 26.10.2` with the two `package.json`, the two lockfiles and `CHANGELOG.md`, pushes the
branch, and opens the pull request `Release 26.10.2` with the entry as its description. The
`auto-queue` workflow puts it in the merge queue; the command also runs
`.github/scripts/queue-stack.sh`, which leaves it alone once it is queued. The release pull request is pushed without
a separate validation on the dev stack: its content was validated pull request by pull request.

A rerun is safe: an existing entry is kept, an open pull request for the branch is reused, and a
pull request already in the queue is not queued again. After the merge, remove the worktree with
`git worktree remove ../kanap-release/v26.10.2`.

## Publish a version

Run it once the release pull request has merged, as the first step of the QA deployment:

```bash
node scripts/release/release.mjs publish 26.10.2 [--dry-run] [--no-sbom]
```

1. Checks that `gh` is signed in and that the number is valid, then runs `git fetch origin --tags`.
2. Finds the merged pull request titled exactly `Release 26.10.2` and takes its merge commit. The
   tag goes on that commit: the queue squashes, and other pull requests may have merged since.
   The commit must be on `origin/main`.
3. Reads that commit: both `package.json` must be at the version and `CHANGELOG.md` must hold its
   entry.
4. Lists, as a warning, the pull requests merged between the previous tag and the release commit
   that the entry does not cite. They merged while the release pull request was waiting. The
   warning does not stop the command.
5. Creates the annotated tag `v26.10.2` on the merge commit and pushes it.
6. Creates the GitHub release: the entry's heading gives the title (`KANAP 26.10.2`, plus
   `· Action required` when the heading has it), the rest of the entry gives the notes.
7. Generates the component inventory and the third-party notices (`scripts/sbom/generate.mjs`, in
   a temporary worktree at the tag) and attaches them to the release. `--no-sbom` skips this step.
8. Moves `stable` to the tag with a plain push. The first publication creates the branch.

Then deploy the tag to QA, and to production once QA has been tested.

`--dry-run` runs every read (the fetch included) and prints the tag, push, release, upload and
worktree commands without running them.

## When something fails

| Message | Cause and what to do |
|---|---|
| `no merged pull request is titled "Release <version>"` | The release pull request has not merged yet, or its title differs. Wait for the merge queue, or fix the title. |
| `several merged pull requests are titled ...` | Two pull requests carry the same title. Rename the wrong one, then rerun. |
| `<file> is at <x> in <sha>, not <version>` | The release commit does not hold the version. Prepare it again with a new release pull request. |
| `CHANGELOG.md has no <version> entry in <sha>` | Same cause: the entry is missing from the merged commit. |
| `the tag v<version> already points at ..., not at ...` | The tag exists on another commit. Tags are never moved: find out why it exists before going on. |
| `stable (...) is not an ancestor of ...: stable must be fast-forwardable` | `stable` holds a commit that is not on `main`. Find out how it got there; the tag and the release stay in place. |
| `The inventory step failed` | The tag and the release exist; `stable` has not moved. Fix the cause and rerun. |
| `<version> must be greater than the latest version` (`prepare`) | Pick the next number. |

Every step of `publish` checks what already exists first: a tag on the right commit, an existing
release and a `stable` already on the commit are kept. After a failure, fix the cause and run the
same command again; it only does what is missing. The inventory is uploaded again with
`--clobber`.
