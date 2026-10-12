# The quality gates

What a machine checks on every commit, so the code can't quietly get worse while it is built
by an agent. Modelled on [filepawl](https://github.com/ohshitgorillas/filepawl)'s gates, the
note that led to them, and Rouen's `dev/quality.md` (its PR #202), so the owner's two
repositories work the same way: a model writes code that works, not code that stays readable,
and the cure is boring structural rules a tool enforces, not rules in a prompt that get skipped.

`npm run check` is the bar: the gates (`npm run gates`: file length, `@ts-check` and `tsc`,
ESLint) and then the whole suite. The pre-commit hook runs the gates (about fifteen seconds);
CI runs them as its own job on every push and the image waits for the whole run, so a red gate
or a red test stops the `:migration` image. A test that doesn't block a merge is a suggestion.

| Gate | Command | Catches | Starts as | Tightens to |
|---|---|---|---|---|
| Tests that block | `npm test` | Regressions | The suite on Node 20 alone, Node 22 and a Mac through the C# server; CI, the image waits | — |
| File length | `npm run lines` | Files too big to reason about | Watch line 400, cap 500 (800 for a test); 62 files over the watch line in `tools/quality/allowance.json`, 47 of them over the cap and exempt from it, all shrink-only | The allowance empty |
| Types | `npm run typecheck` | A wrong property, a misspelled or renamed name, before it runs | `// @ts-check` on the 48 of 105 server modules that pass; the 57 that don't yet are in `tools/quality/ts-baseline.json`, shrink-only | Every module checked, strict on, then the pages |
| ESLint | `npm run lint` | Undeclared names, unused code, empty blocks, useless assignments and escapes, a thrown error that drops its cause | Today's 121 findings in 37 files, in `tools/lint/eslint-suppressions.json`; only new ones fail | Suppressions empty; more rules |
| C# | `./server/build.sh`, `./engine/build.sh` | Warnings | Warnings are errors, nullable on (already) | — |

`npm run tools` installs the development tools once per clone (the Claude Code session hook does
it). They live in `tools/lint/package.json`, never in the root `package.json`: the root file's
dependencies are what the image and an in-app update install (`npm ci --omit=dev`), and
`tools/`, `.githooks/` and `.claude/` are in `.dockerignore`.

## 1. The file-length ratchet

`node tools/quality/file-length.js` (`npm run lines`). Policy in `tools/quality/policy.json`;
state in `tools/quality/allowance.json`, written by the tool and never by hand.

- A file under the **watch line** (400 lines) is free.
- Over it, the file needs an **allowance entry** recording its length. The entry only ever
  comes down: a file that grows past it fails until it is split, one that shrinks must have
  its entry lowered (`npm run lines -- accept` does that, and never raises one).
- A **hard cap** (500 lines, 800 for a test file) refuses any file, watched or not, from
  growing past it. The files that were over the cap on the day the gate came are listed under
  `exempt` in the policy with that reason: the cap doesn't apply to them, the ratchet does, so
  they only ever shrink. Nothing is added to that list without a reason beside it.
- `check` (the default) lists every finding, one per line, and ends with the `accept` command
  when one would settle any of them. `accept [PATH...] [--reason TEXT]` brings the allowance to
  the tree. The stale audit catches an allowance for a file that is gone, untracked, moved into
  `test/`, or back under the watch line.
- Measured: the server and its tools, the pages, the tests, the C# of the server and the
  engine, the Android app's Kotlin and Go.

**At edit time**, Claude Code runs the same gate as a hook before every Write and Edit
(`.claude/settings.json`): under the watch line it says nothing; over it, it says where the
file stands and what the edit does to it; an edit that grows a file over its cap is turned
down, so the split is planned at the first edit rather than discovered at commit.

**Why these numbers.** 500 lines is about what one person, or one model, holds in their head
with the file's neighbours. The watch line below it is where a file starts to earn an entry,
so the list of what needs splitting is explicit and visible in a diff.

## 2. Types without a rewrite

`npm run typecheck`: `tools/quality/tscheck.js` holds every server module (`index.js`,
`launcher.js`, `reset-password.js`, `lib/**`, `tools/**`) to a `// @ts-check` first line, then
`tsc -p tools/lint/tsconfig.json` checks the files that carry it as the JavaScript they are, with
JSDoc on what they export. The modules that didn't pass when the gate came are listed in
`tools/quality/ts-baseline.json`; the list only shrinks, and a listed module that gains the
pragma must leave it. A new module always carries it. The pages (`public/`) come later.

## 3. Lint with suppressions that only go down

`npm run lint`: ESLint's recommended rules (`tools/lint/eslint.config.js`) over the server, the
tools, the tests and the pages, against `tools/lint/eslint-suppressions.json`, ESLint's own
suppressions file: what the rules found on the day the gate came, per file and rule.

- A new finding anywhere fails. A suppressed finding that is fixed fails too, until
  `npm run lint:prune` takes it out of the file, so the file only ever shrinks.
- Nothing raises or adds a suppression. A rule a file breaks on purpose is turned off for that
  file in the config, with the reason beside it (the page scripts' shared globals, the control
  characters stripped from names on purpose).
- Rules get stricter as the suppressions empty, never looser.

## 4. Tests that block, and tests that prove something

- `npm test` runs the whole suite; CI runs it on every push, on Node 20 alone and on Node 22
  and a Mac through the C# server, and a red test stops the image. The migration's rule stands:
  never skip, disable or loosen a test to get green.
- The run is dealt out (`npm run test:shard`, node's `--test-shard`): three Linux jobs and two
  Mac jobs, each a part of the files, so the whole run takes the time of a part. A file's tests
  stay together in one job, so nothing about the order between files changes.
- A hang is a failure with a name, not a cancelled job: a test's request to a server fails after
  a minute and a half naming its address (`test/setup.js`), the runner gives every test five
  minutes (`--test-timeout`) and exits a test file whose process lingers once its tests are
  done (`--test-force-exit`). Before that, one hung child held a CI job to its 25-minute limit
  with nothing in the log to say which test it was.
- A test that compares two servers' views of one device waits until both have read it (a
  retried compare, bounded), never compares once: each reads on a timer of its own.
- A test is worth what it refuses. For any test that matters, break the code on purpose once
  and watch the test fail; a test that passes against broken code is a suggestion. The gates'
  own tests (`test/quality-gates.test.js`) run on synthetic trees under a real `git init`, and
  each gate was broken on purpose once to see them fail.
- Logic that matters lives in a small module with its own tests, not inside a page or route
  file.

## 5. CLAUDE.md shrinks as the tools take over

A rule a tool can check leaves CLAUDE.md and becomes a gate: a lint rule, a test, a line in the
policy. What stays in CLAUDE.md is what no tool can check: who merges what, where releases
come from, what is put to the owner.

## 6. What is not here yet

- A directory-count gate (how many files sit in one folder). `test/` and
  `server/Mandarin.Server/` hold more files than filepawl's default allows; it comes once
  they are grouped.
- filepawl's other gates (barrels, nesting, return shapes, the test-suite gates) are Python
  only. The ratchet and the baselines above are the same idea in Node, so the repository needs
  nothing it doesn't already have.
- Rouen's `no-use-before-define` and `.innerHTML` rules are Rouen's bug classes; this
  repository's lint grows from its own.

## 7. The migration

The gates landed between stage 5 and stage 6 of the move to C#. What they mean for it:

- `index.js` and the Node modules are in the ratchet and only shrink, which is the direction
  the migration takes them anyway; stage 7 deletes most of the allowance list and the
  `@ts-check` baseline with it.
- New C# files come in under the watch line, or under the cap with an entry; the playback port
  (stage 6) is split into modules as it is written rather than added to `LibraryRoutes.cs`,
  `Library.cs` or `Scanner.cs`, which only shrink.
- `public/app.js` is exempt from the cap (the owner's rule: the pages stay HTML/JS, one file)
  and in the ratchet: a change to the page must not add net lines. A feature that needs more
  takes lines out elsewhere in the file, or moves a part to its own script.
- Each stage's CI gains the gates job (about a minute). Nothing changes in the owner's Dockge
  flow.
