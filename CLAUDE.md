# Claude Instructions for Repository Management & Releases

You are an expert AI software developer and repository maintainer. Your primary goal is to help me develop features, fix bugs, and manage code without causing repository bloat, accidental tags, or cluttered commit histories.

Follow these strict operational rules when interacting with this repository, writing code, or generating instructions.

step 4 is important and to be followed for all work

---

## 1. Branching Strategy & Workflow Adherence
We follow a strict **Two-Tier Deployment Workflow** to decouple day-to-day development from production releases:
* **`main` / `master`:** Pure production code. Never suggest making direct commits here. Code only arrives via a reviewed Pull Request from a release, staging, or hotfix branch.
* **`develop`:** Integration branch for active feature work. All feature branches must branch off `develop` and target `develop` for their Pull Requests.
* **`release/vX.Y.Z`:** Ephemeral staging branches created from `develop` when preparing a milestone. Once fully stable, this branch is merged into `main` (where a tag is cut) and back into `develop`.

When writing scripts, creating documentation, or guiding me through git commands, **always map the actions to this specific workflow**.

---

## 2. Preventing Tag & Release Bloat
* **Never Auto-Tag Commits:** Do not write or suggest CI/CD pipelines, git hooks, or local scripts that automatically create a Git tag or GitHub Release on standard commits or individual Pull Request merges.
* **Semantic Tagging Only:** Instruct that tags should strictly be cut manually or via a `workflow_dispatch` event when a release is finalized.
* **Tag Trigger Guard:** Ensure any GitHub Actions YAML templates you generate enforce tag filtering:
  ```yaml
  on:
    push:
      tags:
        - 'v*.*.*'
  ```

---

## 3. Commit Hygiene & Pull Requests
* **Squash Merges First:** When generating instructions on how to merge feature branches into `develop`, always advise using GitHub's **Squash and Merge** option to compress iterative development commits ("fixed typo", "debug print") into a single, cohesive historical log.
* **Atomic, Clear Explanations:** When writing commit messages or PR descriptions, focus on the *why* and *what*, avoiding conversational clutter.


---

## 4. Work goes to `dev`; a version bump only when I say

The migration to C# is done; its branch, `migration`, is now `dev`.

1. Each bug or feature is a branch of its own, named for its `bug-list.md` item (e.g. `19-apk-publish-on-latest-main`), cut from `dev`.
2. Tested (`npm run check` and the C# suite green, each test shown failing once), it goes into `dev` by a pull request you open and merge yourself. No version change on these merges: what each changes goes in CHANGELOG.md under `## Unreleased`.
3. I update my install from `dev` (`ghcr.io/meltface-80/musicd-server:dev`, and the Android app from the `test-android` pre-release). Give me the docker update instructions when there is something new on it.
4. When all the work is done I'll tell you to bump the version. Then, on one branch into `dev`: the version everywhere it is shown (server, Android `versionName`/`versionCode`), `## Unreleased` renamed to the version, and the README and the Pages site (`docs/`) brought fully up to date with everything since the last version, so that a single merge of `dev` to main brings everything up to date. I merge `dev` to main; then you run the Release workflow for that version.
5. Mark a `bug-list.md` item Fixed only when I say so.

---

## 5. Quality gates (machine-enforced)

`docs/quality-plan.md` says what they are and why. The rules no tool can check:

* **`npm run check` is green before every push**: the gates (`npm run gates`: file length, `@ts-check` and `tsc`, ESLint) and the whole suite. The pre-commit hook runs the gates; CI runs all of it on every push and the image waits for it. Never `--no-verify`, never a hook or workflow edit that skips a gate.
* **Baselines only shrink.** A file in `tools/quality/allowance.json`, or under `exempt` in `tools/quality/policy.json`, is never grown: what a change needs goes in a new module under 400 lines, or the file is split first. Never raise a length entry, add a lint suppression or `eslint-disable`, or add a module to `tools/quality/ts-baseline.json` to make a change pass; if it seems necessary, ask first. The baselines are written by their tools (`npm run lines -- accept`, `npm run lint:prune`), never by hand.
* **Never loosen a rule to get green.** A lint rule a file breaks on purpose is turned off for that file in `tools/lint/eslint.config.js`, with the reason beside it. A test is never skipped, disabled or loosened; find the cause.
* **Every new server module opens with `// @ts-check`** and carries JSDoc on what it exports. A listed module touched for a change gains the pragma when the change is in it anyway, and leaves the list.
* **A test proves something:** break the code once and watch it fail before trusting it.
* **This file shrinks as the tools take over.** A rule a tool can check moves out of here and into a gate.
