# The quality gates

What a machine checks on every commit, so the code can't quietly get worse while it is built
by an agent. Modelled on [filepawl](https://github.com/ohshitgorillas/filepawl)'s gates and the
note that led to them: a model writes code that works, not code that stays readable, and the
cure is boring structural rules a tool enforces, not rules in a prompt that get skipped.

`npm run check` is the bar, green before every commit, and CI runs it before the tests on every
push. `npm test` is the other half: a test that doesn't block a merge is a suggestion.

## 1. The file-length ratchet

`node tools/quality/file-length.js` (`npm run ratchet`). Policy in `tools/quality/policy.json`;
state in `tools/quality/allowance.json`, written by the tool and never by hand.

- A file under the **watch line** (400 lines) is free.
- Over it, the file needs an **allowance entry** recording its length. The entry only ever
  comes down: a file that grows past it fails until it is split, one that shrinks must have
  its entry lowered (`accept` does that, and never raises one).
- A **hard cap** (500 lines, 800 for a test file) refuses any file, watched or not, from
  growing past it. The files that were over the cap on the day the gate came are listed under
  `exempt` in the policy with that reason: the cap doesn't apply to them, the ratchet does, so
  they only ever shrink. Nothing is added to that list without a reason beside it.
- `check` lists every finding, one per line, and ends with the `accept` command when one would
  settle any of them. `accept [PATH...] [--reason TEXT]` brings the allowance to the tree.
- The stale audit catches an allowance for a file that is gone, untracked, moved into `test/`,
  or back under the watch line.

**At edit time**, Claude Code runs the same gate as a hook before every Write and Edit
(`.claude/settings.json`): under the watch line it says nothing; over it, it says where the
file stands and what the edit does to it; an edit that grows a file over its cap is turned
down, so the split is planned at the first edit rather than discovered at commit.

**Why these numbers.** 500 lines is about what one person, or one model, holds in their head
with the file's neighbours. The watch line below it is where a file starts to earn an entry,
so the list of what needs splitting is explicit and visible in a diff.

## 2. Lint with a baseline that only goes down

`node tools/quality/lint.js` (`npm run lint`), ESLint's recommended rules (`eslint.config.js`)
over the server, the tools, the tests and the pages.

- What the rules found on the day the gate came is in `tools/quality/lint-baseline.json`, per
  file and rule. A file may never have more of a rule's findings than its entry says; a new
  finding anywhere fails.
- An entry only ever comes down: a file that got cleaner must have its entry lowered
  (`accept`); nothing raises one and nothing adds one. `init` wrote the baseline once.
- Rules get stricter as the baseline empties, never looser. A rule a file breaks on purpose
  is turned off for that file in the config, with the reason beside it, not baselined.

## 3. Type checking without a rewrite

`tsc -p jsconfig.json` (`npm run typecheck`). A JavaScript file opts in with `// @ts-check` on
its first line and JSDoc on what it exports; the checker then holds it to its types, and the
"renamed variable" class of bug is caught before the file runs. `checkJs` is off, so a file
that hasn't opted in is read for what the checked files import, not judged.

Every new module opts in. A module touched for a change opts in when the change is in it
anyway. The quality tools are checked; `lib/` follows as it is split.

## 4. Tests that block, and tests that prove something

- `npm test` runs the whole suite; CI runs it on every push, on Node 20 alone and on Node 22
  and a Mac through the C# server, and a red test stops a merge. The migration's rule stands:
  never skip, disable or loosen a test to get green.
- A test is worth what it refuses. For any test that matters, break the code on purpose once
  and watch the test fail; a test that passes against broken code is a suggestion. The gates'
  own tests (`test/quality-gates.test.js`) run on synthetic trees under a real `git init`.
- Logic that matters lives in a small module with its own tests, not inside a page or route
  file.

## 5. C#

The C# projects build with warnings as errors and nullable reference types on, and the ratchet
measures `.cs` files like the rest. The Kotlin and Go of the Android app are measured too.

## 6. CLAUDE.md shrinks as the tools take over

A rule a tool can check leaves CLAUDE.md and becomes a gate: a lint rule, a test, a line in the
policy. What stays in CLAUDE.md is what no tool can check: who merges what, where releases
come from, what is put to the owner.

## 7. What is not here yet

- A directory-count gate (how many files sit in one folder). `test/` and
  `server/Mandarin.Server/` hold more files than filepawl's default allows; it comes once
  they are grouped.
- filepawl's other gates (barrels, nesting, return shapes, the test-suite gates) are Python
  only. The ratchet and the baselines above are the same idea in Node, so the repository needs
  nothing it doesn't already have.

## 8. The migration

The gates landed between stage 5 and stage 6 of the move to C#. What they mean for it:

- `index.js` and the Node modules are in the ratchet and only shrink, which is the direction
  the migration takes them anyway; stage 7 deletes most of the allowance list.
- New C# files come in under the watch line, or under the cap with an entry; the playback port
  (stage 6) is split into modules as it is written rather than added to `LibraryRoutes.cs`,
  `Library.cs` or `Scanner.cs`, which only shrink.
- `public/app.js` is exempt from the cap (the owner's rule: the pages stay HTML/JS, one file)
  and in the ratchet: a change to the page must not add net lines. A feature that needs more
  takes lines out elsewhere in the file, or moves a part to its own script.
- Each stage's CI gains the `check` job (about a minute). Nothing changes in the owner's
  Dockge flow.
