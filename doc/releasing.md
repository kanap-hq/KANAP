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
node scripts/release/release.mjs publish 26.10.2 [--dry-run] [--no-sbom] [--no-images]
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
5. Creates the annotated tag `v26.10.2` on the merge commit and pushes it. The push starts the
   image workflow (see "Images" below).
6. Waits for the newest run of `release-images.yml` for that tag, started by its push or by a
   manual run on the tag (it appears within two minutes, and the wait stops after 45 minutes),
   downloads its `digests.txt`, and checks that an anonymous client can pull each image at
   `26.10.2` and finds the digest the run published.
7. Creates the GitHub release: the entry's heading gives the title (`KANAP 26.10.2`, plus
   `· Action required` when the heading has it), the rest of the entry gives the notes. The
   notes end with an `### Images` section: each image with its `ghcr.io/...@sha256:...`
   reference, and the `gh attestation verify` command that checks its provenance. That
   command accepts only an attestation signed by `release-images.yml` of the repository for the
   tag `v26.10.2` (`--signer-workflow`, `--source-ref`). A release that already exists without
   that section is completed, not created again.
8. Generates the component inventory and the third-party notices (`scripts/sbom/generate.mjs`, in
   a temporary worktree at the tag) and attaches them to the release. `--no-sbom` skips this step.
9. Points the `stable` and `26.10` image tags at the digests of `26.10.2`: a manual run of
   `release-images.yml` on `main` with `promote=26.10.2`, then a wait for that run (the one whose
   URL `gh workflow run` prints, or else the new run titled `promote 26.10.2`). Skipped when every
   `stable` and `26.10` tag is already on the version; refused when a newer version exists.
10. Moves `stable` to the tag with a plain push. The first publication creates the branch.
    Whether it can fast-forward is checked before step 9, so the image tags never move alone.

Then deploy the tag to QA, and to production once QA has been tested.

`--no-images` skips steps 6 and 9: the release gets no `Images` section and the image tags do not
move. It is only for a version older than the image workflow, and it is refused when the tagged
commit holds `.github/workflows/release-images.yml`: the `stable` branch would move while the
`stable` images stay on an older version. For a version that has the workflow, start or rerun
its image run instead (see "When something fails"). Without `--no-images`, a version whose
images are missing does not move `stable`.

`--dry-run` prints the tag, push, release, upload, worktree and promotion commands without
running them. It runs the reads that the steps before the images depend on: the fetch, the
release pull request, the release commit, the tags, the existing release and the `stable`
branch. It reads neither the image runs nor the registry: it prints the commands it would wait
on and the `Images` section with placeholder digests (`sha256:<digest>`).

The commands act on the GitHub repository of the `origin` remote (`kanap-hq/KANAP`, or a fork
for a trial run), and on `kanap-hq/KANAP` when `origin` is not on GitHub. `origin` must name the
repository by its current name: the image names come from its owner.

## Images

`.github/workflows/release-images.yml` publishes the images of a version on the GitHub
Container Registry, under the owner of the repository (`ghcr.io/kanap-hq/<image>`; a fork
publishes under its own name). Nothing is pushed from a workstation.

| Image | Built from |
|---|---|
| `kanap-api` | `backend/Dockerfile`, `runtime` stage |
| `kanap-api-tools` | `backend/Dockerfile`, `dev` stage (sources and tools, for the database scripts) |
| `kanap-web` | `frontend/Dockerfile`, `VITE_API_URL=/api` |
| `kanap-marketing` | `marketing/Dockerfile`; the website, not part of an on-premise installation |

- **On a tag `vYY.M.N`** (the push of step 5, or a manual run on the tag): checks the form of
  the tag, that `main` contains the tagged commit and that both `package.json` are at the
  version, and checks the base image pins. A published tag is never rewritten
  (`.github/scripts/image-tag-state.mjs`): an image whose `<version>` tag was pushed by an
  earlier run of the same commit (its index annotations `org.opencontainers.image.revision` and
  `org.opencontainers.image.version`) is reused with its digest, and a `<version>` tag from
  another commit stops the run before anything is built. It builds `kanap-api`, runs the same
  checks as the `images` job of `ci.yml` (`.github/scripts/check-api-image.sh`), then pushes the
  missing images with the `<version>` tag only, for `linux/amd64`. Each image carries BuildKit
  provenance and an SBOM. A separate `attest` job, the only one with an OIDC token, adds a
  GitHub provenance attestation to each image; attesting again on a rerun is harmless. The
  builds read the BuildKit cache of `main` and write none. The job summary and the
  `image-digests` artifact (`digests.txt`) list each digest. A rerun of a failed run completes
  the missing images; a rerun of a successful run builds nothing and keeps the same digests.
- **Promotion** (`promote=<version>`, a manual run on `main`, started by step 9): points
  `stable` and `YY.M` at the digests of `<version>` without building anything. It is refused when
  `<version>` is not the latest version tag: `stable` never moves back. The images move one after
  the other: a promotion interrupted halfway leaves `stable` on two versions until it is
  finished by running `publish` again.
- **Website from `main`** (`marketing_from_main`, a manual run on `main`): builds
  `kanap-marketing` alone, tagged `main-<short sha>`, for a website deployment between two
  versions. It touches no other image and no `stable` tag.

A manual run on `main` takes exactly one of the two inputs; a manual run on a version tag takes
none. A new package is private on GHCR: the first publication stops at step 6 until it is made
public (see below).

### Who can publish

The checks of the workflow prevent mistakes. Every account with write access to the repository
can publish and promote images: it can push a version tag (the workflow then runs as written in
the tagged commit), start a manual run, or run any workflow of the repository with
`packages: write`, which may push to the KANAP packages on GHCR. An account without write access
cannot: pull requests from forks and Dependabot get a read-only token, and
the default token permission of the repository is `read`. The `gh attestation verify` command of
the release notes proves that an image was built by `release-images.yml` from the version tag.

## When something fails

| Message | Cause and what to do |
|---|---|
| `no merged pull request is titled "Release <version>"` | The release pull request has not merged yet, or its title differs. Wait for the merge queue, or fix the title. |
| `several merged pull requests are titled ...` | Two pull requests carry the same title. Rename the wrong one, then rerun. |
| `<file> is at <x> in <sha>, not <version>` | The release commit does not hold the version. Prepare it again with a new release pull request. |
| `CHANGELOG.md has no <version> entry in <sha>` | Same cause: the entry is missing from the merged commit. |
| `the tag v<version> already points at ..., not at ...` | The tag exists on another commit. Tags are never moved: find out why it exists before going on. |
| `stable (...) is not an ancestor of ...: stable must be fast-forwardable` | `stable` holds a commit that is not on `main`. Find out how it got there; the tag and the release stay in place. |
| `no run of release-images.yml for v<version>` | The push of the tag started no run (GitHub creates no event when more than three tags are pushed at once, for instance). Start it on the tag: `gh workflow run release-images.yml --ref v<version>`, then rerun `publish`. A version older than the workflow has no images: rerun with `--no-images`. |
| `the image workflow failed, the release was not created and stable was not moved: <url>` | Read the run, fix the cause, and rerun its failed jobs: the images this commit already pushed are reused, the missing ones are built, the attestations are made again. Then rerun `publish`. |
| `--no-images is for a version older than the image workflow` | The version has its image workflow: start or rerun its image run as above instead. |
| `<image>:<version> already published from revision ...` (in the image run) | That tag was pushed from another commit. A published tag is never rewritten: find out why it exists; the fix ships as a new version. |
| `an anonymous pull of <image>:<version> fails: the package is not public` | New packages are private. For each one: organisation `kanap-hq` → Packages → `<image>` → Package settings → Change visibility → Public. Then rerun `publish`. |
| `digests.txt: ...` | The artifact of the image run does not list the four images of the version. Read the run before going on. |
| `the promotion of the images failed, stable was not moved: <url>` | Read the run, fix the cause, rerun `publish`. Some images may already be on the new version: the rerun finishes the promotion. |
| `<newer> is newer than <version>: the stable images never move back` | A later version is published: this one cannot become `stable`. |
| `The inventory step failed` | The tag and the release exist; `stable` has not moved. Fix the cause and rerun. |
| `<version> must be greater than the latest version` (`prepare`) | Pick the next number. |

Every step of `publish` checks what already exists first: a tag on the right commit, a finished
image run, an existing release with its `Images` section, `stable` images already on the version
and a `stable` branch already on the commit are kept. After a failure, fix the cause and run the
same command again; it only does what is missing. The inventory is uploaded again with
`--clobber`.
