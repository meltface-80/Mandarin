# The page's script in parts (v1.0.5)

`public/app.js` grew to one file of 19,579 lines: every screen of the page, in one
script. Pages stay HTML and JavaScript (the owner's rule), so it is not rewritten;
it is carved into files of its own under `public/app/`, each at most 400 lines (the watch line:
a new file over it would grow the allowance, docs/quality-plan.md), and served joined, as one script.

## How the parts are served

- `public/app/parts.txt` lists the parts in order, one path from `public/` a line
  (`#` begins a comment). Only `.js` paths inside `public/` are taken.
- `GET /app.js` (`server/Mandarin.Server/Pages.Script.cs`) joins them: each part is
  headed by `// <path>` and parted from the next by a lone `;` on a line of its own,
  so no two parts can run on into one statement. It is made once and kept while
  neither the list nor a part changes (`SendMade`, as style.css), with an ETag.
- Only listed parts are joined. An update lays new files over old ones and deletes
  nothing, so a part since renamed or merged may still lie in the folder.
- Without the list (a page from before v1.0.5), `public/app.js` is sent as it is.
- The Android app's offline copy is joined the same way at build time
  (`android/app/build.gradle.kts`, `bundleSite`); `OfflineSite.kt` serves it unchanged.
- `index.html` is unchanged: still one `<script src="app.js">`.

Joined, the parts are one script, run exactly as the one file ran: one scope, the
function declarations hoisted over all of it, sloppy mode as before (no part adds
`"use strict"`).

## The stages

| Stage | What moves | Branch |
|---|---|---|
| 0 | The join, its tests, the tour test (below) | `v1.0.5-stage-0-groundwork` |
| 1a | Ten small blocks before and after the rest (sign-out guard to UI settings; UI Settings to Backup), moved unchanged, each a part | `v1.0.5-stage-1a-small-blocks` |
| 1b | Everything between the core and those: the five big add-on blocks (mini transport, share card, settings sheet, service browser, audio devices) split, and the small blocks among them moved, in their order | `v1.0.5-stage-1b-big-blocks` |
| 2 | The core block (the first after the four small ones at the top) cut into parts, startup last | `v1.0.5-stage-2-core` |

Each stage is a pull request into `migration`, squash-merged when green.

Stage 1a takes only the small blocks at either end: the ones in the middle sit between big ones, and
the order the blocks run in is kept, so they move with their neighbours in 1b.

Rules for every part:

- Cut only at statement boundaries; the order of the parts is the order the code had.
- A name one part declares for the others is marked `/* exported name */` there and
  `/* global name */` where it is used, so ESLint (which reads each file alone) sees it.
- Each part opens with a header saying what it is, as the blocks had.
- No behaviour changes in the same stage as a move.

## How it is tested

- `test/page-script.test.js`: every listed part is there, once, without a BOM; every
  script in `public/app/` is listed; the server's join, the Android join and the
  test's own agree; `/app.js` is served as `text/javascript`, `no-cache`, with a 304
  for its ETag, and not without signing in.
- `test/page-tour.test.js`: every screen of the page opened in a real browser, at a
  desktop and at a phone, with nothing thrown: Home and each row's wall, each item of
  the side menu, every Settings and Setup page, an album played to a room with Now
  playing over it, search and an artist. A part that loses a name another needs fails
  only when its screen opens, which no compiler sees; this opens them all.
- The rest of the browser tests, unchanged, over the joined script.
