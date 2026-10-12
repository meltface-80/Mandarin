# Claude Instructions for Repository Management & Releases

You are an expert AI software developer and repository maintainer. Your primary goal is to help me develop features, fix bugs, and manage code without causing repository bloat, accidental tags, or cluttered commit histories.

Follow these strict operational rules when interacting with this repository, writing code, or generating instructions.

step 4 is important and to be followed during migration from node to C#

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

## 4. For the current migration work stream from node to full C# follow this approach

1. Complete each stage, test, and merge to a separate branch called "migration"
2. Name each branch of each stage by its stage name e.g. stage 3a - description 
3. Test each stage and when green merge to Migration branch
4. I test the my installation by updating from the migration branch. You need to provide me with the correct docker compose instructions for initial install and subsequent updates from the migration branch
5. When migration is complete and fully free of node, I will thoroughly test from the migration branch until I'm happy
6. When step 5. is complete and I'm happy I'll manual merge to main. The final merge will be v0.9.0

Final note: no more tags/releases go to main until I'm happy migration work is complete and working. When on v0.9.0 any bugs will be set up to have a new branch named v0.9.x-rc1 - bug name. When green, you will provide docker compose update instructions for this bug hotfix. For example, v0.9.1-rc1 will update over v0.9.0. when I'm happy with v0.9.1-rc1 it will get merged to main as v0.9.1 and that will update over V0.9.1-rc1.

New features will adopt the above process from step 1 down to 3 and adopt my process in step 4.

At the time of writing this branch v0.8.43 and v0.8.44 are green and getting merge by order of build number. Next will be v0.8.45 and you will follow step 4 explicitly. Advise immediately if step 4 cannot happen.

You will also remove all tags/releases on main in the v0.8.x range except v0.8.44. That will remain the :latest on main for now until migration work is fully completed. Acknowledge this on next session

---

## 5. Quality gates (machine-enforced)

`docs/quality-plan.md` says what they are and why. The rules no tool can check:

* **`npm run check` is green before every push**: the gates (`npm run gates`: file length, `@ts-check` and `tsc`, ESLint) and the whole suite. The pre-commit hook runs the gates; CI runs all of it on every push and the image waits for it. Never `--no-verify`, never a hook or workflow edit that skips a gate.
* **Baselines only shrink.** A file in `tools/quality/allowance.json`, or under `exempt` in `tools/quality/policy.json`, is never grown: what a change needs goes in a new module under 400 lines, or the file is split first. Never raise a length entry, add a lint suppression or `eslint-disable`, or add a module to `tools/quality/ts-baseline.json` to make a change pass; if it seems necessary, ask first. The baselines are written by their tools (`npm run lines -- accept`, `npm run lint:prune`), never by hand.
* **Never loosen a rule to get green.** A lint rule a file breaks on purpose is turned off for that file in `tools/lint/eslint.config.js`, with the reason beside it. A test is never skipped, disabled or loosened; find the cause.
* **Every new server module opens with `// @ts-check`** and carries JSDoc on what it exports. A listed module touched for a change gains the pragma when the change is in it anyway, and leaves the list.
* **A test proves something:** break the code once and watch it fail before trusting it.
* **This file shrinks as the tools take over.** A rule a tool can check moves out of here and into a gate.
