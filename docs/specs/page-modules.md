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
| 2 | The core unwrapped and cut into 33 parts in its order; `app.js` keeps only the startup that closed it | `v1.0.5-stage-2-core` |

Each stage is a pull request into `migration`, squash-merged when green.

Stage 1a takes only the small blocks at either end: the ones in the middle sit between big ones, and
the order the blocks run in is kept, so they move with their neighbours in 1b.

Rules for every part:

- Cut only at statement boundaries; the order of the parts is the order the code had.
- At most 400 lines, so no part is born on the allowance.
- Each part opens with a header saying what it is, as the blocks had; a block cut in several
  says which piece it is ("2 of 3").
- No behaviour changes in the same stage as a move.

## How a big block is cut

A block over 400 lines keeps its names in its own closure, and its pieces have to share them.

- **Unwrapped.** Most blocks lose their wrapper `(() => { ... })();` and their names move to the
  page's top, where every part sees them: the mini transport, the share card, the Settings sheet,
  Audio Devices, the Library Scanner (stage 1b), the core and its search and labels browser
  (stage 2). A name that would clash once
  at the top is renamed where it is declared and everywhere it is read (by scope, not by text):
  one taking a browser's own name (`open`, `close`, `status`), or one two blocks both had
  (the Library Scanner's `pane`, `body`, `busy` … become `scanPane`, `scanBody`, `scanBusy` …;
  the search's `row` and `openBtn` become `searchRow` and `searchOpenBtn`).
  A guard that left the block when its elements were missing (`if (!pane) return;`) cannot
  stand at the top; the elements are in `index.html`, and the guard goes.
- **Installed.** A block that is a factory, made more than once, keeps its closure: each piece
  becomes a function the factory calls with one object, `sb`, that carries what the pieces share.
  A shared name that changes (`let`) is `sb.name` everywhere; one that doesn't is taken off `sb`
  at the piece's start. The streaming-service browser (`initServiceBrowser`, one per service).

What a part declares at the top is every part's. ESLint reads each part alone, so it is told
every part's top names (`tools/lint/eslint.config.js`). `npm run names`
(`tools/quality/page-names.js`, in `npm run gates`) holds the join itself: no name declared
twice, none a browser's own, each read somewhere, and nothing read that no part (and no other
script of the page) declares.

## How it is tested

- `test/Mandarin.Tests/PageScriptTests.cs`: every listed part is there, once, without a BOM; every
  script in `public/app/` is listed; each part compiles alone, and the join as one script; the server's join, the Android join and the
  test's own agree; `/app.js` is served as `text/javascript`, `no-cache`, with a 304
  for its ETag, and not without signing in.
- `test/page-tour.test.js`: every screen of the page opened in a real browser, at a
  desktop and at a phone, with nothing thrown: Home and each row's wall, each item of
  the side menu, every Settings and Setup page, an album played to a room with Now
  playing over it, search and an artist. A part that loses a name another needs fails
  only when its screen opens, which no compiler sees; this opens them all.
- `test/page-names.test.js`: the names gate's verdict on made-up pages.
- The rest of the browser tests, unchanged, over the joined script.

## Where it ended (stage 2)

`public/app.js` is the page's startup: `bootstrap()` and its call, 68 lines, where they ran
when the core was one file. Everything else is 80 parts under `public/app/`, none over 400
lines, listed in run order in `public/app/parts.txt`: the five small blocks that ran first, the
core's 33 parts, `app.js`, then the blocks that followed the core. `app.js` left the file-length
allowance and its exemption, so the page is under the same cap as everything else.

To find a screen's code: its part is named for it (`album-detail.js`, `queue.js`,
`settings-scanner.js` …), and each part's first line says what it holds.
