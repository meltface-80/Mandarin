# Audit before main (v0.9.0)

The repository audited at `migration` 45fe2cc (v0.9.0, PR #216 merged, CI green), before the owner's
merge to `main`. Five modules, as asked: code quality, testing, security, performance,
documentation. **This is the report only: no code is changed until it is reviewed.**

How it was measured, so each number can be checked again:

- **C# server** (`server/Mandarin.Server`, 174 files): a copy built with .NET's recommended analyzers
  (`AnalysisLevel=latest-recommended`), unused code and parameters raised to warnings (IDE0051,
  IDE0052, IDE0060, IDE0005). `dotnet list package --vulnerable --include-transitive`.
- **JavaScript** (page, tests, tools): `npm audit` (root and `tools/lint`), the ESLint and
  `@ts-check` baselines the gates already keep.
- **Routes against tests**: every `"/api/…"`, `"/stream/…"` and `"/internal/…"` literal in the
  server (179) looked for in `test/*.js` and the recorded answers in `test/golden/`.
- **Android**: the CI build's own warnings; source files mapped to test files.
- **By hand**: secrets, authentication, the session cookie, SQL built from strings, archive
  extraction, shell use, outbound fetches, response headers, backups, indexes, blocking calls.

Severity: **High**: worth fixing before `main`. **Medium**: fix soon. **Low**: cleanliness
or defence in depth. **Info**: no change proposed, recorded so it isn't raised again.

## Summary

| Module | High | Medium | Low | Info | Branch |
|---|---|---|---|---|---|
| 1. Code quality | 0 | 2 | 5 | 1 | `audit/code-quality-fixes` |
| 2. Testing | 0 | 3 | 2 | 0 | `audit/test-coverage-expansion` |
| 3. Security | 0 | 2 | 4 | 3 | `audit/security-hardening` |
| 4. Performance | 0 | 1 | 2 | 1 | `audit/performance-optimization` |
| 5. Documentation | 0 | 2 | 2 | 0 | `audit/documentation-updates` |

Nothing found is High. The server has no secrets in its code, no SQL built from input, no shell,
no archive path written to disk, a sign-in lockout and an HttpOnly, SameSite cookie. The largest
real gaps are untested routes (identification's accept and reject among them), backups that carry
service tokens in the clear, and pages that can be framed.

## Branches

The prompt branches each category off `main`. Here `main` is v0.8.44 (the Node server), so, as
the owner asked, everything is based on `migration`:

- `audit-b4-main`: from `migration` at 45fe2cc, holding this report.
- One branch per category from `audit-b4-main`: `audit/code-quality-fixes`,
  `audit/test-coverage-expansion`, `audit/security-hardening`, `audit/performance-optimization`,
  `audit/documentation-updates`. Each one its own pull request into `audit-b4-main`, squash-merged
  when CI is green; then `audit-b4-main` into `migration` as one pull request, before v0.9.0 goes
  to `main`.
- Nothing crosses between branches. Each keeps CLAUDE.md §5: `npm run gates` green before every
  push, baselines only shrink (written by their tools), no test skipped or loosened, every new
  test broken once on purpose and seen to fail.

---

## Module 1: Code quality and architecture

### Q1. Duplicate request plumbing (Medium)

- **Where:**
  - Three JSON body readers:
    - `server/Mandarin.Server/Auth.Body.cs:27` (`Auth.Body`)
    - `server/Mandarin.Server/ShareRoutes.cs:32` (`JsBody`)
    - `server/Mandarin.Server/ServiceRoutes.cs:162` (`ServiceBody`)
  - Three copies of the 2 MB limit:
    - `Auth.Body.cs:14`
    - `ShareRoutes.cs:24`
    - `Pages.NotThere.cs:16`
  - Eight JSON reply helpers:
    - `IdentifyRoutes.cs:23` and `:37`
    - `LibraryRoutes.cs:195`
    - `PlaybackRoutes.cs:69`
    - `Auth.cs:494` and `:503`
    - `Downloads.cs:236`
    - `Pages.cs:193`
- **Issue:** each was ported from a different Node route file and kept its own copy. They have
  already drifted once: a body sent without a length was read by one reader and refused by
  another (fixed in #216).
- **Fix:** one `Http` module with one body reader (limit, charset, Bad JSON, 413) and one JSON
  writer (ETag, `X-Mandarin-Answered`, HEAD). The others call it, file by file, with the full suite
  between steps.
- **Branch:** `audit/code-quality-fixes`

### Q2. Files over the 500-line cap (Medium, ongoing)

- **Where:** 35 files in `tools/quality/policy.json` `exempt`, the largest:
  - `server/Mandarin.Server/Tags/Case.cs` (3,132 lines)
  - `android/…/PhonePlayerService.kt` (1,440)
  - `server/Mandarin.Server/Identify/Identifier.cs` (1,195)
  - `Scan/Scanner.cs` (1,044)
  - `android/…/MainActivity.kt` (954)
  - `LibraryRoutes.cs` (923)
  - `Admin/Backup.cs` (810)
  - `Playback/WebUrl.cs` (767)
  - `public/shelf.js` (2,062)
- **Issue:** more than one responsibility per file. `LibraryRoutes.cs`, for example, holds the
  route tables, the middleware chain and dozens of handlers.
- **Fix:** split along the seams already marked in each file, one file per commit:
  `LibraryRoutes.cs` (route table / chain / handlers), `Identifier.cs` (state, scheduling,
  matching), `Backup.cs` (write / read / apply), `PhonePlayerService.kt`. The ratchet then
  lowers each entry.
- **Out of scope by the owner's rule:** `public/app.js` (19,582 lines) stays one file.
- **Branch:** `audit/code-quality-fixes`

### Q3. Dead code (Low)

- **Where:**
  - `Extras/WriteUpSources.cs:64`: private `S` never used.
  - `Streams.cs:52`: `cacheDir` assigned, never read.
  - Unused parameters:
    - `AlbumEditRoutes.cs:208` (`st`)
    - `Identify/Identifier.cs:803` (`lib`)
    - `Images.cs:69` (`path`)
  - 29 unneeded `using` lines (IDE0005).
- **Fix:** remove them.
- **Branch:** `audit/code-quality-fixes`

### Q4. Timers owned but never disposed (Low)

- **Where:** 11 types own a `Timer` or `SemaphoreSlim` without implementing `IDisposable` (CA1001):
  - `Admin/Tailscale.cs:31`
  - `Admin/Updater.cs:38`
  - `Extras/Lastfm.cs:30`
  - `Extras/Taste.cs:27`
  - `Extras/WriteUpSources.cs:45`
  - `Identify/Identifier.cs:49`
  - `Identify/Loudness.cs:34`
  - `Identify/Pack.cs:295`
  - `Playback/Phones.Commands.cs:13`
  - `Scans.cs:370`
  - `Services/Accounts.cs:91`
- **Issue:** each lives as long as the process (a Restart starts the program again in place), so
  nothing leaks today. A test or a future in-process restart would leave them running.
- **Fix:** dispose them in each type's existing `Stop()`.
- **Branch:** `audit/code-quality-fixes`

### Q5. Small correctness smells (Low)

- **Where:**
  - `Local/EngineOutput.cs:119` and `:180` throw bare `Exception` (CA2201).
  - `Scan/NodeFs.cs:155` ignores `closedir`'s result (CA1806).
  - 17 `CA1859` and 6 `CA1862` (case-insensitive compares made by lower-casing).
- **Fix:** a specific exception type; check the result; `StringComparison.OrdinalIgnoreCase`.
- **Branch:** `audit/code-quality-fixes`

### Q6. Number formatting that depends on the locale (Low)

- **Where:** 21 calls without a culture (CA1305), for example:
  - `Auth.cs:105` (`int.Parse` of an address)
  - `Admin/Tailscale.cs:278`
  - `Streams.cs:80` (`long.Parse` of a Range header)
  - `Front.cs:72` (the log's time)
- **Issue:** the Docker image runs without a locale. A Mac runs in its owner's locale, where a
  parse or format can change. The Sonos metadata (`Playback/Didl.cs:69–85`) was checked by hand:
  it only places strings already formatted invariantly, so it is unaffected.
- **Fix:** `CultureInfo.InvariantCulture` at each call.
- **Branch:** `audit/code-quality-fixes`

### Q7. Names from the Node era (Low)

- **Where:**
  - `Front.cs:1–4`: `Front`, "named for the front door it was while the Node server stood
    behind it".
  - `Scan/NodeFs.cs`.
- **Fix:** rename (`Server`, `PosixDir`) only together with Q1's split, so the rename lands once.
  Otherwise document the history in each header and leave the names.
- **Branch:** `audit/code-quality-fixes`

### Q8. The JavaScript-compatible layer (Info)

- **Where:** `Playback/JsMath.cs` (615 lines), `Tags/Js*`, `Scan/JsJson.cs`, `Js.Truthy`.
- **Note:** these keep the server's answers and stored data byte-for-byte as the Node server made
  them: numbers, JSON, sort order. The page, the apps and existing databases rely on that.
  Removing them is a behaviour change, not a cleanup. **No change proposed.**

---

## Module 2: Testing

### T1. Routes no test calls (Medium)

13 of the server's 179 routes appear in no test and no recording:

| Route | Defined at |
|---|---|
| `POST /api/identify/accept`, `/api/identify/reject` | `LibraryRoutes.cs:110–111` |
| `POST /api/playlist/play`, `/api/playlist/play-track`, `GET /api/playlist/art` | `LibraryRoutes.cs:102–103`, `:55` |
| `POST /api/play-multi` | `PlaybackRoutes.cs:22` |
| `POST /api/queue/history-multi`, `/api/queue/play-history-next` | `PlaybackRoutes.cs:23` |
| `POST /api/shortcut/play-unheard` | `PlaybackRoutes.cs:20` |
| `POST /api/output/standby`, `/api/output/convenience-switch` | `PlaybackRoutes.cs:24` |
| `POST /api/tailscale/logout` | `AdminRoutes.cs:63` |
| `GET /api/update/status` | `UpdateRoutes.cs:28` |

- **Issue:** accept and reject change the library's identification. The playlist and multi-play
  routes start playback. A regression in any of them reaches no test.
- **Fix:** HTTP tests on the running server: accept and reject (with `test/fake-musicbrainz`'s
  answers) changing the album's match and undo restoring it; each play route queuing the right
  tracks on the fake Sonos household. Each is broken once on purpose and seen to fail.
- **Branch:** `audit/test-coverage-expansion`

### T2. Fixed sleeps in tests (Medium)

- **Where:** 93 waits of 100 ms or more (`await new Promise(r => setTimeout(r, N))`):
  - `test/stale-page.test.js` and `test/front.test.js` (5 each)
  - `test/playback-csharp.test.js` (4)
  - `test/loudness.test.js`, `test/menu.test.js`, `test/scans-csharp.test.js`,
    `test/share-open.test.js`, `test/library-live.test.js` (3 each)
- **Issue:** a fixed wait is either too short on a busy runner (the two loudness races fixed
  today were of this family) or wasted time on a fast one.
- **Fix:** wait for the condition (`until(...)`) wherever the test then reads a state. A sleep stays
  only where the test proves something *doesn't* happen within a window, with a comment saying so.
- **Branch:** `audit/test-coverage-expansion`

### T3. The same helpers written 62 times (Medium)

- **Where:**
  - 62 test files define their own `until()`.
  - 25 define their own `api()`.
- **Issue:** they differ in their timeouts and in what they swallow. A fix in one doesn't reach
  the rest.
- **Fix:** `test/helpers.js` (`// @ts-check`), with `until`, `api` and `started`. Files move to it
  as they are touched.
- **Branch:** `audit/test-coverage-expansion`

### T4. Assertions behind a platform test (Low)

- **Where:**
  - `test/local-output.test.js:154` (`if (process.platform === "darwin")`)
  - `test/tailscale-builtin.test.js:189`
- **Issue:** one test asserts different things depending on where it runs.
- **Fix:** split each into a test per platform, each skipping with its reason elsewhere.
- **Branch:** `audit/test-coverage-expansion`

### T5. The Android app module has no tests (Low)

- **Where:** the 12 test files cover `android/core`. Of the app module's 36 files, none has a test.
- **Fix:** JVM tests where no device is needed: `DsdExtractor` (DSF/DFF parsing, pure logic) and
  `DownloadStore` (its bookkeeping). The update check of `AppUpdate`: version comparison,
  refusing a downgrade.
- **Branch:** `audit/test-coverage-expansion`

---

## Module 3: Security

### S1. Backups carry service tokens and keys in the clear (Medium)

- **Where:** `server/Mandarin.Server/Admin/Backup.cs:6–7, 44, 127`. The "keys" part (API keys, the
  Qobuz and Tidal sign-in tokens) and `tailscale.json` (the server's Tailscale identity) are
  written into a plain `.tar.gz`.
- **Issue:** a backup kept in a cloud drive or sent by mail hands over those sign-ins and the
  server's place on your tailnet.
- **Fix:** an optional passphrase. When set, the keys part and `tailscale.json` are sealed with
  AES-GCM, the key derived from the passphrase with PBKDF2. Restore asks for it. Backups without
  a passphrase restore as before. The page says plainly what a backup holds.
- **Branch:** `audit/security-hardening`

### S2. Pages can be framed by another site (Medium)

- **Where:** `server/Mandarin.Server/Pages.cs:193` (`Send`) and the static file path (`Pages.cs`
  about line 179). No `frame-ancestors` or `X-Frame-Options` on `index.html` or `login.html`.
  Today only the folder redirect (`Pages.cs:154–155`) and one download page carry a CSP.
- **Issue:** a page elsewhere can load Mandarin in a frame and steer clicks: clickjacking of
  Settings, Restart and the like.
- **Fix:** `Content-Security-Policy: frame-ancestors 'self'` (which leaves inline scripts alone),
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin` on every page answer. A test
  reads them. The Android WebView loads the page at top level, so it isn't affected.
- **Branch:** `audit/security-hardening`

### S3. A development package with known vulnerabilities (Low)

- **Where:** `package.json:30`, `sharp ^0.34.3`. `npm audit` says high: libvips CVE-2026-33327,
  -33328, -35590, -35591; libheif; librsvg. Only `tools/icons/make-icons.js` uses it. It is not
  in the image and not in the tests.
- **Fix:** `sharp` 0.35.5, by `npm install`, so the lock file is written by its tool.
- **Branch:** `audit/security-hardening`

### S4. NuGet's vulnerability audit is switched off (Low)

- **Where:** `server/Mandarin.Server/Mandarin.Server.csproj:16` (`<NuGetAudit>false</NuGetAudit>`).
  Today there is nothing to report (`dotnet list package --vulnerable`: none).
- **Fix:** turn it on, so an advisory against `Microsoft.Data.Sqlite` or its SQLite build fails CI
  rather than going unseen.
- **Branch:** `audit/security-hardening`

### S5. The server fetches addresses it is given (Low)

- **Where:**
  - The album editor's cover from an address: `AlbumEditRoutes.cs:285` (`FetchArt`).
  - Foreign covers: `CoversDrawn.cs:159–194`.
- **Issue:** a signed-in device can make the server fetch any address, its own and link-local
  ones among them (`127.0.0.1`, `169.254.169.254`). It's the owner's own server, and a speaker's
  art on the LAN is legitimate, so the exposure is small.
- **Fix:** refuse loopback and link-local addresses for the album editor's fetch (each redirect
  hop checked too), and keep LAN addresses for speakers' art.
- **Branch:** `audit/security-hardening`

### S6. Any certificate accepted from LinkPlay devices (Low)

- **Where:** `server/Mandarin.Server/Renderers/LinkPlay.cs:16–20` (CA5359).
- **Issue:** deliberate: a WiiM's local API uses a self-signed certificate. But the client takes
  any certificate from any address it is pointed at.
- **Fix:** keep it, for private-network addresses only (RFC 1918, link-local, ULA). Suppress the
  analyzer with that reason where it stands.
- **Branch:** `audit/security-hardening`

### S7. Hashes the analyzers call weak, used for non-security purposes (Info)

- **Where:**
  - SHA-1 (CA5350) for ETags and cache keys: `LibraryRoutes.cs:198`, `IdentifyRoutes.cs:26`,
    `LabelRoutes.cs:128`, `Pages.cs:196`, `AlbumEditRoutes.cs:167`, `Extras/LabelLogos.cs:315`,
    `Local/LocalDevices.cs:45`, `Scan/Scanner.cs:253`.
  - MD5 (CA5351) for a colour, a cache name and the request signature Qobuz's API requires:
    `CoversDrawn.cs:98`, `Services/Rows.cs:174`, `Services/QobuzApi.cs:71`.
- **Note:** none of these protects anything. Changing them would change ETags, cache names and
  stored ids, and break Qobuz. **No change**, beyond a suppression with its reason at each site
  (in `audit/code-quality-fixes`), so the analyzers stay worth reading.

### S8. A signing key committed for Android builds (Info)

- **Where:** `android/app/musicd-debug.keystore`, `android/app/build.gradle.kts:53–58`.
- **Note:** used only when the release secrets are absent. CI's Android job has them
  (`HAVE_KEY: true`, run 38386664571), so published APKs carry the private key. A local or forked
  build carries the public one. **No change**; the README says so (D2).

### S9. Checked and found sound (Info)

- No secrets in the tree: keys, tokens and private keys searched for; `.env` files none.
- **SQL:**
  - Every query is parameterised.
  - The 5 built with interpolation insert constants (table and column names), never input.
- **Archives and processes:**
  - Restore reads a `.tar.gz` and accepts only `musicd.db` and a fixed pattern of JSON names,
    kept in memory: no path from the archive reaches the disk (`Admin/Backup.cs:455–510`).
  - No shell: processes start with argument lists.
- **Authentication:**
  - SRP sign-in with a 15-minute lockout and slowing (`Auth.cs:211–390`).
  - Cookie `HttpOnly; SameSite=Lax`, `Secure` over HTTPS (`Auth.cs:200–209`).
  - Media addresses signed (HMAC), and an unsigned one is refused by the gate (401).
- **Inputs and dependencies:**
  - Image sizes clamped to 64–1200 px (`Images.cs:23–29`).
  - Request bodies limited to 2 MB.
  - NuGet: no vulnerable packages. `tools/lint` npm: none.

---

## Module 4: Performance

### P1. Library lists rebuilt and hashed on every request (Medium)

- **Where:** `server/Mandarin.Server/LibraryRoutes.cs:194–207` (`Send`).
- **Issue:** each answer is serialised and SHA-1-hashed for its ETag, even when the browser's copy
  is current and the answer is a 304. On a large library the album list is megabytes, rebuilt
  whenever the page asks.
- **Fix:** keep the bytes and their ETag per route and query, for the library's version and marks.
  A request with a current `If-None-Match` is then answered without building anything. A test
  proves a second request is a 304 and the cache is dropped when the library changes.
- **Branch:** `audit/performance-optimization`

### P2. Page responses hashed per request (Low)

- **Where:** `Pages.cs:193–200`. Same pattern for HTML pages, smaller.
- **Fix:** the same cache, keyed by the file's write time.
- **Branch:** `audit/performance-optimization`

### P3. The page script is shipped unminified (Low; deferred: remind the owner at v0.9.5)

- **Where:** `public/app.js` (1.15 MB, 19,582 lines) and `public/shelf.js`. Revalidated on every
  load (`Cache-Control: public, max-age=0` + ETag, `Pages.cs:179–181`), so a phone parses 1.15 MB
  each time it opens the page.
- **Fix:** keep the source as it is (one file, the owner's rule) and minify only the copy put in
  the image and the update bundle. This adds a build step, so **the owner decides**.
- **Branch:** `audit/performance-optimization`

### P4. Checked and found sound (Info)

- No blocking waits on request threads. The 38 `.Result` / `.Wait()` / `GetResult()` calls are
  in the test commands (`RulesCommand.cs`, `ExtrasCommand.cs`) or read a task already finished
  (`Extras/ReleaseDays.cs:177`).
- Indexes cover the frequent queries: `tracks(album_id)`, `tracks.path UNIQUE`,
  `plays(album_id)`, `plays(ts)`, and primary keys on `track_tags` and `track_loudness`.
- The library is read into one copy and rebuilt only when its version moves.

---

## Module 5: Documentation

### D1. Comments that describe code that no longer exists (Medium)

- **Where:**
  - 222 lines in the server name a deleted `lib/*.js`, and 255 say "the Node server", in 149
    files.
  - 83 lines in `test/*.js` name `lib/`.
  - Some are now false, for example:
    - `Covers.cs:11` ("left to the Node server")
    - `Images.cs:118`
    - `Services/Import.cs:613`
    - `SettingsRoutes.cs:6`
    - `Playback/Didl.cs:9`
- **Issue:** a reader follows a reference to a file that isn't there, or believes a hand-off
  still happens.
- **Fix:**
  - Present-tense claims are rewritten to say what the code does.
  - Historical references point at the tag where the file lived (`lib/x.js at v0.8.50`) or are
    dropped where they add nothing.
- **Branch:** `audit/documentation-updates`

### D2. No API reference (Medium)

- **Where:** 179 routes, described only in comments beside their handlers.
- **Fix:** `docs/specs/api.md`, written by a tool (`tools/api-map.js`) from the route tables:
  method, path, auth (signed-in, signed media or open), handler file and line. A gate checks it is
  current, as the length allowance is. Also in the README: which keys sign which APKs (S8), and
  what a backup holds (S1).
- **Branch:** `audit/documentation-updates`

### D3. Files published with the site but linked from nowhere (Low; dropped: the owner keeps both)

- **Where:**
  - `docs/IMG_8974.jpeg`
  - `docs/Mandarin-music-scanning-guide.pdf`
- **Fix:** link them from the site or the README, or remove them. **The owner decides** which.
- **Branch:** `audit/documentation-updates`

### D4. Empty catch blocks in the page (Low)

- **Where:** 45 `no-empty` suppressions, all in `public/app.js`
  (`tools/lint/eslint-suppressions.json`), plus 17 `no-useless-assignment`.
- **Issue:** a failure is swallowed without a word, so a reader can't tell intent from oversight.
- **Fix:** a comment in each saying why nothing is done (as the C# side does: `/* gone */`), or a
  `console.debug`. Then `npm run lint:prune` lowers the baseline.
- **Branch:** `audit/documentation-updates`

---

## The owner's decisions

1. **The branch plan:** as above. Category branches from `audit-b4-main`, each squash-merged back
   into it when green, then `audit-b4-main` into `migration` as one pull request before v0.9.0 goes
   to `main`.
2. **S1, encrypted backups:** in v0.9.0.
3. **P3, minifying the page in the image:** not now. **Remind the owner when the work reaches
   v0.9.5.**
4. **D3:** both files kept as they are, and D3 is dropped. `docs/IMG_8974.jpeg` is the MusicD
   waveform logo; `docs/Mandarin-music-scanning-guide.pdf` is the owner's guide to waveforms for
   Qobuz and Tidal.
5. **Q7 renames:** with Q1, in the same change.
6. **Order:** security, testing, code quality, performance, documentation.
