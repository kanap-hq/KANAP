#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import subprocess
import sys
from pathlib import Path


def run_git(repo_root: Path, *args: str) -> list[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git command failed")
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def load_map(mapping_path: Path) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for raw in mapping_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        doc_file, pattern = line.split("\t", 1)
        rows.append((doc_file.strip(), pattern.strip()))
    return rows


def pattern_variants(pattern: str) -> set[str]:
    # fnmatch reads `**/` as "at least one folder"; expand each one to also match zero folders.
    parts = pattern.split("**/")
    variants = {parts[0]}
    for part in parts[1:]:
        variants = {v + "**/" + part for v in variants} | {v + part for v in variants}
    return variants


def matches(path: str, pattern: str) -> bool:
    return any(fnmatch.fnmatch(path, variant) for variant in pattern_variants(pattern))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Flag likely stale KANAP user manuals from changed product files."
    )
    parser.add_argument(
        "--base",
        default="origin/main",
        help="Git ref to compare committed work against. Default: origin/main",
    )
    parser.add_argument(
        "--report",
        default="doc/help/_process/_stale-doc-report.md",
        help="Markdown report output path, relative to repo root.",
    )
    args = parser.parse_args()

    script_path = Path(__file__).resolve()
    repo_root = script_path.parents[4]
    mapping_path = repo_root / "doc/help/_process/doc-update-map.tsv"
    report_path = repo_root / args.report

    if not mapping_path.exists():
        print(f"Mapping file not found: {mapping_path}", file=sys.stderr)
        return 1

    try:
        committed_changes = set(run_git(repo_root, "diff", "--name-only", f"{args.base}...HEAD"))
        staged_changes = set(run_git(repo_root, "diff", "--name-only", "--cached"))
        unstaged_changes = set(run_git(repo_root, "diff", "--name-only"))
        untracked_changes = set(run_git(repo_root, "ls-files", "--others", "--exclude-standard"))
    except RuntimeError as exc:
        print(f"stale-doc-check failed: {exc}", file=sys.stderr)
        return 1

    changed_files = committed_changes | staged_changes | unstaged_changes | untracked_changes
    mappings = load_map(mapping_path)

    impacted: dict[str, set[str]] = {}
    changed_docs = {
        path
        for path in changed_files
        if path.startswith("doc/help/docs/en/") and path.endswith(".md")
    }

    for doc_file, pattern in mappings:
        for path in changed_files:
            if matches(path, pattern):
                impacted.setdefault(doc_file, set()).add(path)

    mapped_patterns = [pattern for _, pattern in mappings]
    unmapped_frontend = sorted(
        path
        for path in changed_files
        if (
            path.startswith("frontend/src/pages/")
            or path.startswith("frontend/src/components/")
        )
        and not any(matches(path, pattern) for pattern in mapped_patterns)
    )

    needs_review: list[tuple[str, list[str]]] = []
    already_touched: list[tuple[str, list[str]]] = []

    for doc_file in sorted(impacted):
        doc_path = f"doc/help/docs/en/{doc_file}"
        sources = sorted(impacted[doc_file])
        if doc_path in changed_docs:
            already_touched.append((doc_file, sources))
        else:
            needs_review.append((doc_file, sources))

    generated_at = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines: list[str] = [
        "# Stale Documentation Report",
        "",
        f"_Generated: {generated_at}_",
        "",
        f"- Base ref: `{args.base}`",
        f"- Changed files considered: `{len(changed_files)}`",
        f"- Docs needing review: `{len(needs_review)}`",
        f"- Impacted docs already touched: `{len(already_touched)}`",
        f"- Unmapped frontend changes: `{len(unmapped_frontend)}`",
        "",
        "This report is a review aid, not proof. It flags manuals whose mapped product files changed without a matching doc edit.",
        "",
    ]

    if needs_review:
        lines.extend(["## Docs Needing Review", ""])
        for doc_file, sources in needs_review:
            lines.append(f"### `{doc_file}`")
            lines.append("")
            lines.append("Mapped source changes:")
            for source in sources:
                lines.append(f"- `{source}`")
            lines.append("")
    else:
        lines.extend(["## Docs Needing Review", "", "No mapped route manuals are currently flagged.", ""])

    if already_touched:
        lines.extend(["## Impacted Docs Already Touched", ""])
        for doc_file, sources in already_touched:
            lines.append(f"### `{doc_file}`")
            lines.append("")
            lines.append("Mapped source changes:")
            for source in sources:
                lines.append(f"- `{source}`")
            lines.append("")

    if unmapped_frontend:
        lines.extend(["## Unmapped Frontend Changes", ""])
        lines.append("These files changed but do not currently point to a route manual in `doc-update-map.tsv`.")
        lines.append("")
        for source in unmapped_frontend:
            lines.append(f"- `{source}`")
        lines.append("")

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines), encoding="utf-8")

    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
