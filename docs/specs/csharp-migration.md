# Mandarin: moving the server to C#

**Status, 13 October 2026: done.** Stage 7 part 6 (v0.9.0) deletes the Node server; what is left is the owner's
test from `:migration` and their merge to `main` as v0.9.0. What follows is the plan as it was written and built.

**Status: a draft for the owner, 9 October 2026.** Stage 0 is built (v0.8.25), stage 1's parts a to c (v0.8.26), d (v0.8.31), and e and most of f (v0.8.34); Shelf's page (v0.8.28, below); the C# server on Macs, and updates that bring both servers together (v0.8.29); stage 2 (v0.8.37, v0.8.38), stage 3 (v0.8.40), and stage 4 whole: parts 1 (v0.8.39), 2 (v0.8.44), 3 (v0.8.45), 4 and 5 (v0.8.47). **From v0.8.29, new server work is done in C# only** (2.4). **The way to a server with no Node at all, as the owner decided after v0.8.47:** stage 5 (v0.8.48), everything but playback; stage 6, playback whole; stage 7, Node removed, the v0.9.0 candidate (section 4). It is written from
`main` at v0.8.23 (`e7676a7`), with `replaygain-fix` (v0.8.24) waiting to be merged. The owner
decides who does each stage, and each stage is planned in detail, its questions put to the owner,
and coded only once the owner is happy with it, as `roadmap-stages.md` did.

`server/README.md` stays the record of what has moved. This file is what is left, in what order,
and what has to be settled first.

---

## 1. Where it stands

### How it runs

The C# server (`server/`, .NET 10) is the front door. It takes the port, answers what has moved,
and passes everything else to the Node server behind it, which it starts itself (`node
launcher.js`) on a private port. Both use the same database. The Node server still says which
copy of the library is current and still plays. Background work the C# server does in Node's
place (identification, the MusicBrainz pack, loudness, record labels, release days, Smart Picks,
Tailscale, from v0.8.34 the library scans, from v0.8.44 the month's prune of Qobuz's and Tidal's
albums, from v0.8.45 their import and the favourites' watch, and from v0.8.47 the services
themselves: their accounts, Tidal's token and their streams) is handed over to it each time the
Node server starts (`/internal/front/runs`). `server/README.md` has the details. With the C# server
in front, once the services are handed over, the Node server no longer talks to Qobuz or Tidal in
the ordinary way of things (only in its first seconds, before the hand-over, or for a request the
page never makes, passed to it as it came).

### In numbers

| | |
|---|---|
| HTTP routes the Node server registers | about 210 |
| answered by C# | about 130 |
| still passed to Node | about 80 (listed in the appendix) |
| Node code, `lib/` | about 24,000 lines (this includes the Node copies of parts already moved) |
| C# server, `server/Mandarin.Server` | about 39,500 lines |
| C# audio engine, `engine/` | about 930 lines (a program of its own, already C#) |
| Tests | 101 files; the suite passes both ways (Node alone, and behind C#) |

### Already in C#

The front door, signing in, the page and its files, reading the library (walls, search, album
pages, Home's rows, filters), playlists, settings, hearts and Listen later, covers already drawn
and drawn from an album's own picture, music files sent as they are, conversions (with ReplayGain,
a zone's DSP and 32-bit output since v0.8.40), the phone's downloads and its Opus stream, tag
reading, the library scan itself, identification, the pack, measuring loudness, waveforms, record
labels, release days, Smart Picks, write-ups, sharing, the album editor, backups and built-in
Tailscale; from v0.8.39, browsing Qobuz's and Tidal's catalogue; from v0.8.44, their albums as
library rows (opening one, favourites, a streamed album's page, their Clean up and the month's prune);
from v0.8.45, their import, the favourites' watch, the service playlists and Settings → Services
signed in; from v0.8.47, the rest of them: signing in and out, Settings → Services signed out,
Tidal's token (refreshed by C# alone), playing an album from their browser (its tracks then played by
Node's playback), their streams and conversions (Qobuz's play reports, Tidal's DASH), and their part
of the search from Home. The conversions Node made are therefore all C#'s now.

### Still Node's, by area

| Area | Routes | Main Node files (lines) | Talks to | Size, risk |
|---|---|---|---|---|
| **Playback**: rooms, transport, queue, grouping, radio, the phone as a zone | 35 | `lib/sonos/*` 2,200, `lib/renderers/*` 2,060, `lib/local/*` 920, `api-playback.js` and `playback.js` 750, radio and plays 520 | Sonos (SOAP on port 1400), SSDP multicast, UPnP renderers (SOAP, GENA events), LinkPlay, the audio engine, the Android app's long poll | **Large, highest risk** |
| ~~**Conversions Node still makes**~~ | — | none left: Qobuz's and Tidal's C#'s since v0.8.47 (the rest since v0.8.40). `lib/stream.js` stays for Node's playback plans and a Node server alone | — | Done |
| ~~**Qobuz and Tidal**~~ | — | none left: C#'s whole since v0.8.47 (browsing v0.8.39; the rows v0.8.44; the import v0.8.45; sign-in, the token, playing and the streams v0.8.47). `lib/services/*`, `lib/qobuz/*`, `lib/tidal/*` stay frozen for a Node server alone (2.4) | — | Done |
| **Audio Devices and DSP**: the device register, per-device settings, headphone profiles | 8 | `lib/renderers/devices.js`, `registry.js`, `profiles.js`, `lib/autoeq.js`, `api-devices.js`, `api-dsp.js` 1,000 | AutoEq on GitHub; live player state | Medium (writes re-plan live queues) |
| **Library housekeeping**: when to scan where the scans are the Node server's (timer, folder watcher, Rescan), music folders likewise, the music folders' clean-up and the counts, `/api/status`, the wall display's content (a streamed album's page and the services' clean-up C#'s since v0.8.44) | 11 | `lib/server/api-library.js` (parts), `lib/library/watch.js`, `lib/server/mounts.js`, `lib/library/index.js` | the file system | Medium |
| **Phone downloads, the lists**: an album's download list (with ReplayGain), automatic downloads, plays sent from the phone | 4 | `lib/server/downloads.js` 297 | none | Small |
| **Admin**: in-app update, restart and shut down, the processor split decision | 7 | `lib/updater.js` 363, `launcher.js`, `api-power.js`, `lib/cpu.js` 307 | GitHub releases | Small to medium (see 2.1) |
| **Covers Node still draws** with `sharp`: an album with no cover, CMYK or colour-profiled pictures, outside pictures (`u-` keys: Last.fm, stations, a Sonos queue's art), a speaker asking by its own address | in `/api/image/` | `lib/library/artwork.js` 268 | the web (outside pictures) | Medium |
| **Last.fm**: similar artists and albums, the key | 4 | `lib/lastfm.js`, `api-lastfm.js` 430 | ws.audioscrobbler.com | Small |
| **The tag check**: the C# tag reader checked against music-metadata, file by file | 2 | `lib/library/tagcheck*.js` 510 | none | Stays until Node leaves (see 4.7) |
| **What Node itself is for**: pages `/login`, `/display` and deep links (`/shelf` C#'s since v0.8.28), `/api/health`, the speakers' event callbacks (`NOTIFY /upnp/event`), the database's tables and migrations, the launcher | — | `index.js` 771, `lib/library/db.js` 483 | — | Last |

---

## 2. Settle these first

### 2.1 The C# server isn't updated by in-app updates

The update bundle that **Settings → Updates** installs is built in `release.yml` from `index.js`,
`launcher.js`, `lib`, `public` and the package files: **the Node server only**. The C# server
(`server/bin/mandarin-server`) is in the Docker image and nowhere else, so it changes only when
the image is pulled again. The audio engine and the Tailscale engine already have a way round
this (downloaded from their own pre-releases into the data folder); the C# server has none.

What this means:

- **Fixes in C# don't reach anyone who updates in the app.** v0.8.24's ReplayGain fix is the
  first case the owner will notice: in Docker the measuring is the C# server's, so the fix needs
  `docker pull` and a re-created container; the in-app update alone brings only the Node half.
- **The two servers drift apart.** A new Node server runs behind an older C# server. The C# server
  answers its routes with older code, and claims background work it does the old way.
- **It gets worse with every move.** By the end the Node half is close to empty, and an in-app
  update would change almost nothing.

**Proposal: stage 0** (below): the C# server delivered with every in-app update, and a rule for
when the two don't match.

**Built in v0.8.25, and closed in v0.8.29.** Stage 0 fetched the C# server *after* the update had
put the Node server's files in place, so the two ran mismatched (everything passed to Node) for a
minute or two, or for hours, or for good when GitHub couldn't be reached. From v0.8.29 the update
fetches and checks the C# server of the new version first (`prepare` in `csharp-update.js`, called
by `lib/updater.js` before it stages anything), and stops with nothing changed if it can't be had.
The new Node server then finds it in place and only starts it again. That is what lets a part exist
in C# alone (2.4).

### 2.2 Macs run the Node server alone

`tools/mac/install.sh` installs Node and runs `node launcher.js` from a launchd agent. There is no
C# server on a Mac. So:

- A Mac runs the Node version of every part already moved: identification, the scan, backups,
  everything.
- That is why every moved part still exists in Node, why CI still runs the whole suite on Node
  alone (Node 20), and why a fix to a moved part has to be made twice (v0.8.24 changed both
  `lib/loudness.js` and `Identify/Loudness.cs`).
- Node cannot leave while Macs depend on it.

**Proposal:** the C# server built for macOS (`osx-arm64`, `osx-x64`) and run on Macs the way the
image runs it: launchd starts `mandarin-server`, which starts the Node server. To check before
committing to it: `Cpu.cs` (it keeps work off playback's cores with Linux's `taskset`, and on a Mac
would place nothing), the Mac's sound devices (they play
through `lib/local/output.js` and Core Audio, while the C# audio engine is ALSA only), and built-in
Tailscale (Linux only today). This could come as part of stage 0, or straight after.

**Decided, and built in v0.8.29.** As built:

- **Release:** `mandarin-server-osx-arm64.gz` and `-osx-x64.gz`, built on GitHub's Mac runners (the
  SDK signs them ad hoc there, which macOS needs to run anything), each asked its version, in the
  same sums file as the Linux ones.
- **Installer:** `tools/mac/install.sh` fetches the build for the version installed (an install
  updated from Settings is newer than its download), checks its sum and signature, and makes
  `mandarin-server` what launchd starts, with `NODE_BIN` and `MANDARIN_APP_DIR`. A Mac installed
  earlier moves by running the line again, at the Mac (the owner's choice), so someone is there to
  allow **mandarin-server** onto the network; until then Settings says so. `MANDARIN_NODE_ONLY=1`
  keeps the Node server alone.
- **Updates:** `csharp-update.js` fetches the Mac's build on a Mac and signs it again if its
  signature didn't come through.
- **What differed on a Mac:**
  - the scan's file system calls (`Scan/NodeFs.cs`): macOS lays out directory entries and `stat`
    otherwise, has no `statx`, names the 64-bit-inode forms `$INODE64` on Intel, and numbers some
    errors differently;
  - "libc" is libSystem (`Program.cs`);
  - `Cpu.cs` uses `nice` there, as `lib/cpu.js` does (no core split on a Mac).
  - Sound devices stay the Node server's (Core Audio through ffmpeg) until stage 6; Tailscale stays
    Linux only, as in Node.
- **Tested:** CI runs the whole suite through the C# server on a Mac runner, so the scan is held to
  the Node server's there (`test/scan-csharp.test.js`), and so is everything else.
  - **There is no Mac to try it on by hand** (the owner's answer). The installer, macOS's
    permission prompts, Sonos on a real network, and whether macOS asks again after a C# update (an
    ad hoc signature changes with every build) are untested until a Mac owner tries them.

### 2.3 One move at a time

Two accounts moving parts at once will collide. Every move edits the same files: the table in
`server/README.md`, the header of `test/front.test.js`, `Jobs.cs` and `FRONT_JOBS` in `index.js`,
the CHANGELOG, and the version (both would call theirs 0.8.25). Proposed:

- **Each stage has one owner.** Two accounts can work at once only on stages that don't touch the
  same area, and the second to merge takes the next version number and brings `main` in first.
- **Each branch starts from the latest `main`**, and nothing is stacked on an unmerged branch.
- **Each build has its own branch, named for its version** (the owner's rule from v0.8.30): `v0.8.30`,
  `v0.8.31`, … New work never goes onto a branch whose build is already up for merging; a fix to
  that build does.
- **`replaygain-fix` merged before anything else**: it changes `Identify/Loudness.cs`,
  `Identify/Identifier.cs` and `Jobs.cs`.

Who does what (the owner's split, v0.8.37):

- **Stage 2, one account:** 2a (v0.8.37) is DIDL-Lite, the queue moves, Sonos's ZoneGroupState and
  the renderers' descriptions, sinks, events and capability profiles; 2b (v0.8.38) is the stream
  plans, ReplayGain, the DSP filters, URL signing and the radio's memory.
- **Stage 4's parts 1 to 4, Claude B** (v0.8.39 on): the catalogue, the library rows, the import,
  sign-in. Not the streams (part 5).
- **One more shared file:** `Identify/ScoreCommand.cs`, the `score` harness's dispatch. Each adds
  its own lines there; whoever merges second keeps both.
- **Reviews:** each account reviews the other's pull requests.

### 2.4 When the Node copies go

Today the Node copy of each moved part is kept and tested. It is the fallback for a Mac, for a
C# server that hasn't taken the work (an older image, or one that failed to start), and the
reference the C# code is held to. Proposed rule: **the Node copy of an area is deleted once every
install runs the C# server (2.2), the C# server updates in place (2.1), and one release has gone
out with the C# side as the only one used.** Then the Node-alone run in CI goes too. Until then,
both copies are kept and both are tested.

**Decided by the owner (v0.8.29): no more work done twice.** With the C# server on Macs (2.2) and
updates bringing both servers together (2.1):

- **New server work is done in C# only.** A new route, field or rule goes into the C# server.
- **The Node copies of parts already moved are frozen,** not deleted: they stay as they are for a
  Mac kept on Node alone (`MANDARIN_NODE_ONLY=1`), and for a C# server that hasn't started. A Mac
  on Node alone keeps what it has and gets no new server features.
- **No work in the Node server at all** (the owner's rule, made firmer after v0.8.29). Not even in
  what Node still owns (playback, the updater, Qobuz and Tidal, the conversions it makes): an area
  that needs changing moves to C# first, and is changed there. v0.8.29's change to the updater was
  the last made in Node. The pages stay HTML, CSS and JavaScript (browsers run nothing else), and
  the tests stay in JavaScript (stage 7).
- **Exceptions the owner has allowed:**
  - **hand-over switches**: small Node changes that only make Node do less, so a part can move.
    The library scans (1e, v0.8.34): the job `scan` and Node's timer and watcher left unstarted
    (`index.js`), and the scan reports the C# server sends it, mirrored for its copy of the
    library and `/api/status` (`lib/server/api-library.js`); and in v0.8.36 the rule for when
    they are handed over (decision 7). The conversions with ReplayGain, DSP and 32-bit output
    (stage 3, v0.8.40): the transcoder's `owns` widened (`index.js`), and the C# server's word
    that a DSP conversion runs taken (`POST /internal/cpu/dsp`, which calls `lib/cpu.js`'s own
    `dsp()`), so the split stays the Node server's decision as the work leaves it. Qobuz's and
    Tidal's library rows (stage 4.2, v0.8.44): the job `prune` added to what is handed over and
    the daily prune's timer left idle once it is (`index.js`), and the C# server's word that the
    services' rows changed taken (`services` in `lib/server/api-library.js`'s `libraryChanged`):
    the library read again and the covers drawn ahead, as each service's afterChange did (an album
    opened: read again only, as opening did there), and after a favourite made there, that
    service's kept answers forgotten, as its own favourite forgot them. Their import, the
    favourites' watch and the service playlists (stage 4.3, v0.8.45): the job `import` added to
    what is handed over, the import's and the watch's timers left idle once it is (and the first
    import made after all if the C# server never takes the work), an import or a watch running at
    the hand-over finished first, and when the first import comes and how often the watch looks
    handed over with the rest (`index.js`); an import the Node server would start itself after a
    sign-in (`lib/server/api-service.js`) or a Rescan (`lib/server/api-library.js`) asked of the C#
    server instead (`POST /internal/jobs/import`); the C# server's word that a service's settings
    were written taken (`settings` in `libraryChanged`): Tidal's hi-res asked for again, as its own
    setSettings did; and `POST /internal/services/step`, a step of the import or the watch the C#
    server left to it while Tidal's token was its to refresh (removed in v0.8.47). The services
    themselves (stage 4.4 and 4.5, v0.8.47): the job `services` added to what is handed over; once
    it is, a service's track handed to the C# server to make like any conversion (the transcoder's
    `owns` widened), a speaker fetching one from the Node server itself told to the C# server
    (`/internal/services/played`) rather than reported to Qobuz, and Tidal's token refused a
    refresh there (one owner); at the hand-over a sign-in under way let go, a refresh under way
    finished first and a Qobuz play reported over (`index.js`); where Tidal's sign-in is asked
    handed over with the rest; and `POST /internal/playback/play`, a service album whose rows the
    C# server wrote played by the Node server's playback, running the same lines as
    `api-service.js`'s play (made one function, `play()`, for both);
  - **a bug in playback**: Queue and Play next writing over a queue that wasn't playing (v0.8.34);
  - **the identification's line moved to 85 %** (v0.8.41, the owner's call): in both copies of the
    rule, `lib/identify/score.js` and `Identify/Score.cs`, so the two servers keep the same verdicts;
  - **the Queue screen kept quick** (v0.8.35): the server's copy of each Sonos queue, read again
    only when the speaker's UpdateID moves, and Play from here answered once the room has moved.
- **Tests of C#-only parts** run only through the C# server (`MANDARIN_FRONT=1`, as
  `test/front.test.js` does). The Node-alone run in CI keeps testing what Node still owns.
- Deleting the frozen copies follows the rule above.

---

## 3. How each move is done

These are the rules every move from v0.8.1 to v0.8.23 followed. They stay.

1. **One part per version**, behind the same tests. A part moves only when the whole suite passes
   both ways (`npm test`, and `MANDARIN_FRONT=1 npm test`).
2. **Rule for rule.** The C# code does what the Node code does, down to error texts and JSON
   shapes. Where the logic is intricate, both are held to the same answers by a harness
   (`mandarin-server score`, `test/library-front.test.js`, the `*-csharp.test.js` files).
3. **Pinned.** Which server answers what is written into `test/front.test.js`, so a part can't
   quietly fall back to Node.
4. **One writer.** No two processes write the same state. Background work is handed over through
   `/internal/front/runs`, with the settings Node was started with. A change C# makes that Node
   must know about is told to it (`/internal/library/changed`).
5. **Nothing changes for the apps.** The Android app calls about 80 endpoints directly from its
   own code (`android/core`, `android/app`), and apps already installed keep calling them.
   Response shapes, status codes and the phone's long-poll protocol stay exactly as they are.
6. **The record kept.** A row in `server/README.md`, a line in `front.test.js`'s header, a
   CHANGELOG entry saying what moved and what didn't.

---

## 4. The stages

Sizes: **S** is about one version; **M** two or three; **L** several. No dates: the owner sets
the pace.

### Stage 0: the C# server delivered with the app's updates (M)

**Built in v0.8.25** (branch `stage0-csharp-updates`, waiting to be merged). As built:

1. **Release:** each release carries `mandarin-server-linux-x64.gz` and
   `mandarin-server-linux-arm64.gz`, with their sums in `mandarin-server.sha256`, built by
   `release.yml` (arm64 cross-built, as the image does). macOS waits for 2.2.
2. **Update:** the Node server, started by a C# server of another version (it asks its
   `/server-info`), fetches the program for its own version and machine, checks the sum and that
   it runs and says that version (`mandarin-server --version`), and renames it over the running
   one (`lib/server/csharp-update.js`). It lives where the image put it, so it comes and goes with
   the Node server's files: a container re-created from its image has both from the image again.
   Twice at most for a version; tried again every half hour while GitHub can't be reached.
3. **Start:** the Node server stops with code 76. The C# server starts itself again from the new
   file in the same process (`execv`, `Front.StartAgain`); one from before v0.8.25 stops, and
   Docker's restart policy starts the container again (the first time only).
4. **The two must match.** The Node server says its version with its state (`/internal/library`).
   While they differ, the C# server answers nothing but `/server-info` and passes everything on;
   the Node server turns down the hand-over of background work (`/internal/front/runs`, 409) and
   makes it itself, except built-in Tailscale when the C# server already runs its engine.
5. **Tests:** `test/csharp-update.test.js`, with GitHub and the C# server stood in for, and the
   C# server's pass-through and its start again in the same process run for real. Checked by
   hand end to end: a C# server built as 0.0.1 in front of the real Node server became the
   current one in seven seconds, in the same process, and took over the background work.

### Stage 1: the small, self-contained parts (several S)

**1a, 1b and 1c built in v0.8.26** (branch `stage1-small-parts`); **1d in v0.8.31**; **1e and most of 1f in v0.8.34**.

None of these touch a live player.

- **1a. Last.fm:** the key's routes and its check, similar artists and albums, with the
  in-library matching (`Names.cs` already has the name rules). Outside pictures (`u-` keys) stay
  Node's until 1f. The Last.fm address and key are added to what `/internal/front/runs` hands over.
- **1b. The phone's download lists:**
  - `POST /api/phone/plays`, a plain insert;
  - `GET /api/download/auto` (C# already makes Smart Picks and the album of the day);
  - `POST /api/download/albums`, which needs URL signing in C# (C# only checks signatures today);
  - `GET /api/download/album`, which needs the ReplayGain sums (`infoOf`, `albumOf`) in C#.
- **1c. AutoEq headphone profiles:** the three `/api/dsp/headphones` routes (they need only the
  `cache` table and the AutoEq address).
- **1d. Restart and shut down**, and the processor split decided in C# (`lib/cpu.js`'s decision;
  `Cpu.cs` already applies it). **Built in v0.8.31** (`PowerRoutes.cs`), as the owner chose:
  Restart starts both servers again (the C# one in its same process, as after an update); the
  split's decision stays the Node server's until playback moves (stage 6), since taking it would
  mean changing the Node server, and `/api/cpu` is answered by C# with the split as Node last
  sent it. Answered by C# only where it started the Node server itself (every install).
- **1e. Library housekeeping:** music folders, letting a folder go, the music mount, clean-up,
  `/api/search-status`, Rescan, the scan timer and the folder watcher. The scan itself is already
  C#'s. The Node server keeps its own copy of the library for playback, so it is told when a scan
  ends, as now. **Built in v0.8.34** (`Scans.cs`, `ScanRoutes.cs`, `Mounts.cs`): the scans are a
  job handed over like the others ("scan"), so the Node server's timer and watcher don't start;
  the C# server runs `mandarin-server scan` on its own timer and `FileSystemWatcher`, answers
  Rescan, Reindex, the music folders, the folder picker, Forget folder, `/api/music-mount` and
  `/api/search-status`, and tells the Node server how each scan goes (its state about once a
  second, for `/api/status`; the albums so far; the end, after which it does what followed a scan).
  The scans are handed over only where the Node server's own would already be the C# program's
  (decided by the owner, v0.8.36; decision 7): `TAG_READER=csharp`, or the tag check passed for
  the two readers (and not `TAG_READER=node`). Otherwise they stay the Node server's, as before,
  its own timer and watcher with them. It is decided at the hand-over (v0.8.34 handed them over
  whatever the check said). Clean-up stays the Node server's while Qobuz's and Tidal's albums are
  (stage 4); from v0.8.44 their Clean up is the C# server's where the scans are (stage 4.2), the
  music folders' and the counts still the Node server's.
- **1f. The covers `sharp` still draws:** an album with no cover, CMYK or colour-profiled pictures,
  outside pictures, pictures asked for by a speaker's own address. The owner chose ffmpeg, as
  `Covers.cs` does. **Built in v0.8.34** (`CoversDrawn.cs`): the placeholder (held to sharp's
  drawing by `test/covers-csharp.test.js`) and outside pictures. Left with the Node server: what
  only sharp reads well (CMYK, profiles other than sRGB, cut short; drawn by ffmpeg their colours
  would differ), and a speaker asking by its own address (only the Node server knows its
  speakers, until playback moves).

### Stage 2: pure ports, held to Node's answers (M)

The logic playback and conversions need, in C#, with no change to what runs. Each is held to the
Node version by the `score` harness:

- DIDL-Lite (built byte for byte, and read);
- queue moves (`planMoves`);
- Sonos's ZoneGroupState, UPnP device descriptions, sinks, GENA events;
- renderer capability profiles;
- stream plans (`rendererPlan`, `withGain`, `withDsp`);
- ReplayGain levelling and gains;
- the DSP filters and their fingerprint (`biquad.js`, `dsp.js`);
- URL signing;
- the radio's six-month memory.

This makes stages 3 and 6 much safer, and some of it is needed by 1b.

Done: 2a in v0.8.37 (`Playback/` and `Renderers/`: XML, DIDL-Lite, the queue moves, the household,
SOAP, device descriptions, sinks, events, profiles), 2b in v0.8.38 (`Playback/`: the stream plans
and cache names, ReplayGain, the DSP filters, signing, the radio's memory, and V8's own sin, cos,
log, log10 and pow so the numbers agree to the last bit). The C# server already running was held to
the same tests, and put right where it differed (v0.8.38's CHANGELOG lists where).

### Stage 3: the conversions Node still makes (M)

1. **ReplayGain streams (`?g=`):** C# adds the volume filter and the `-g` cache name, written
   exactly as JavaScript writes the number.
2. **32-bit:** the probe for ffmpeg's 32-bit FLAC, then 32 bits accepted.
3. **DSP (`?o=`):** the device's DSP read from `audio_devices` when the device fetches, the filter
   graph from stage 2, and playback's second core while DSP runs.

After this, Node converts only Qobuz and Tidal tracks.

Done in v0.8.40, on stage 2b's ports (`Playback/StreamPlans.cs`, `Dsp.cs`, `Biquad.cs`): the
`/stream` route plans as index.js does, a `?g=` or `?o=` in a form Express would read differently
(`g[]=`, a key twice) still passed on; the Node server's "make these next" hands these over too
(its `owns`, the hand-over switch); and a DSP conversion here tells the Node server, which keeps
deciding the split (`POST /internal/cpu/dsp`, answered with it).

### Stage 4: Qobuz and Tidal (L)

1. The catalogue, read-only: search, new releases, featured, an album, an artist's albums, lists,
   an album's state. **Built in v0.8.39** (Claude B; `Services/`, `ServiceRoutes.cs`): the seven
   `GET /api/<s>/…` routes of each service answered by C#, held to the Node server's answers
   (`test/services-csharp.test.js`), their addresses handed over with the rest (`Jobs.cs`). The
   account, the kept albums and the library are read from the database the Node server writes;
   nothing is written. A request Tidal's token has to be refreshed for stays the Node server's
   (it alone refreshes it until step 4), and the favourites' ids are kept no longer than the Node
   server's library stays unchanged, so a favourite changed there (step 2, still its own) is seen
   at once. Tidal's lists no longer prime the Node server's copy of an album, so opening one from
   the browser asks Tidal for it once more, until step 2 moves opening too.
2. Library rows: open, favourite and unfavourite, clean-up, the 30-day prune. Node is told.
   **Built in v0.8.44** (`Services/Rows.cs`, `ServiceRoutes.cs`, `LibraryRoutes.cs`): `POST
   /api/<s>/open`, `/favorite` and `/unfavorite` of each service, a streamed album's `GET
   /api/album` (its favourite brought into line with the service's as the page opens, and why it
   is here), `POST /api/library/cleanup` for `qobuz` and `tidal` where the scans are the C#
   server's (its own scan the one Clean up waits for), and the 30-day prune, handed over as the job
   "prune" (daily, the first ten minutes after the hand-over; the Node server's timer then idle).
   The rows are written as `lib/services/streaming.js` writes them, column for column (every number
   bound as a double, as better-sqlite3 binds it), the cover kept beside the database as before;
   each held to the Node server's own write and answer (`test/services-rows-csharp.test.js`). The
   Node server is told (`/internal/library/changed`, `services`) and reads its library again, as
   each service's own afterChange did. A request Tidal's token has to be refreshed for is still
   passed on whole; a favourite is passed on unless the token is good for five more minutes, so it
   is never found due after the favourite was made, and one Tidal refuses changed nothing there.
   Tidal's lists hand their albums to the C# server's copy, so opening one asks Tidal for its
   tracks only again. The import, the favourites' watch and the service playlists (step 3) and
   playing stay the Node server's.
3. Import, the favourites watch and the service playlists, as a job handed over. **Built in
   v0.8.45** (`Services/Import.cs`, `ServiceRoutes.cs`, `Jobs.cs`): handed over as the job "import".
   The C# server makes the import (the favourites, and Qobuz's purchases, kept in the library as
   rows, only what is new or a week old asked again; one no longer wanted let go by the ids asked
   for then; the playlists after) 20 seconds after the hand-over (as the Node server set it up),
   every six hours, and when the Node server asks for it (after a sign-in with the import on, after
   a Rescan); the favourites' watch every two minutes; and answers `GET` and `POST
   /api/settings/<s>` while signed in (the state, the quality and the import's switch: switched on,
   the import started), `POST /api/settings/<s>/import` (Update library now) and `POST
   /api/services/watch` (the page's quick look, once in 15 seconds). The service playlists are kept
   in `userPlaylists` and the albums they need held (`<s>-held`), as `lib/services/streaming.js`
   keeps them; each held to the Node server's own import, watch and answer from the same start
   (`test/services-import-csharp.test.js`). The Node server is told as each service's afterChange
   did, and the C# server's copy of the library is read again then and there too. Tidal's token
   stays the Node server's to refresh: an import or a watch is made here only with a token good
   for five more minutes, and one found due, or refused partway, is left to the Node server from
   there (`POST /internal/services/step`), what was brought in here before kept whole (its counts
   then the Node server's run's). Signed out, Settings → Services stays the Node server's (a Tidal
   sign-in under way is its), with signing in and out (step 4) and playing. (From v0.8.47 the token
   is the C# server's: the step and the route are gone, an import or a watch made here whole.)
4. Sign-in and sign-out. **The C# server alone refreshes Tidal's token** from then on: with two
   refreshing at once, one can be left holding a token that no longer works. **Built in v0.8.47**
   (`Services/Accounts.cs`, `TidalApi.cs`, `ServiceRoutes.cs`), handed over as the job "services":
   `POST /api/settings/<s>/signin` (Qobuz: user/login with the plugin's app id, the token and what
   the page and the reports need of the user kept, never the password; Tidal: OAuth's device flow,
   the link and code, Tidal asked every few seconds until approved, let go or expired, by the clock
   or by Tidal's word, then the account, the user and the subscription kept), `…/signin/cancel`,
   `…/signout` and `…/disconnect`, and `GET` and `POST /api/settings/<s>` signed out (a Tidal sign-in
   under way among it, in memory here as it was there); signed in with the import on, the import
   made here. Tidal's token refreshed here alone, as `api.js` refreshes it: due within the minute,
   first; refused, refreshed and asked once more; one at a time, the refresh token kept when Tidal
   sends none; refused even so, in Tidal's words. The hand-backs that existed only because Node owned
   the token are gone (`ToNode`, `TidalApi.GoodFor`, the import's step, `/internal/services/step`),
   and the Node server refuses to refresh once the services are handed over. Playing an album from
   the browser (`POST /api/<s>/play`) is answered here: its rows written (`Catalogue.EnsureAlbum`),
   the Node server told, then its tracks played by the Node server's playback (`POST
   /internal/playback/play`, the same lines as its own route; playback is its until stage 6). The
   services' part of the search from Home (`GET /api/search/external`) too. Held to the Node server's
   own answers and writes from the same start (`test/services-signin-csharp.test.js`).
5. Their streams: fetch, copy or convert, Tidal's DASH fed to ffmpeg directly (no loopback
   route), Qobuz's play reports. **Built in v0.8.47** (`Services/ServiceStreams.cs`, `Streams.cs`,
   `Transcoder.cs`): a Qobuz or Tidal track's `/stream` answered here once the services are, planned
   as `index.js` plans it, from the transcode folder under the same name (the stream quality where a
   file's time goes), the service asked where its audio is when a device comes for it or the next is
   made ready (the Node server's "make these next" handed over like any conversion), copied as it
   comes where it is already what was planned (or less, for Sonos), else converted with the same
   ffmpeg arguments; Qobuz's signed `track/getFileUrl` for the format the device takes and the
   account allows, and its play reports (Start on a device's fetch, End on the next, on playing
   through, on signing out or this server's stop); Tidal's `playbackinfopostpaywall`, one address or
   MPEG-DASH, the pieces fetched in turn and written to ffmpeg's input; an account given CD for
   hi-res asked for CD from then on, until a setting is written; the rows corrected to what Tidal
   streams. Each file and answer held to the Node server's own (`test/services-signin-csharp.test.js`;
   `test/qobuz.test.js` and `test/tidal.test.js` in this mode).

Playing a service album stays a call into Node's playback until stage 6: for it, a service album is
the library's tracks, as an album of your own is.

### What is left: the fewest steps (the owner's decision, after v0.8.47)

The owner wants the fewest steps to a server with no Node at all. With stage 4 whole, three are
left: everything but playback, then playback, then Node removed. Each is planned in detail and put
to the owner before it is coded, as before, and held to the Node server's answers both ways until
Node goes.

### Stage 5 (v0.8.48): everything but playback (M)

Everything the Node server still does but play, moved in one version:

- **Audio Devices, the writes:** the plain settings (name, hidden, sharing, output, DSP, levelling,
  the user's rates) written by C#; the Node server then told (`/internal/devices/changed`) so it
  reads its names again and re-plans what is playing. The device list itself shows live state, so
  it moves with playback (stage 6).
- **Library housekeeping:** when to scan where the scans are still the Node server's (its timer,
  its folder watcher, Rescan), the music folders' clean-up and the counts, `/api/status`'s library
  part, and the wall display's content.
- **The phone's download lists:** what is left of them (an album's list with its ReplayGain,
  automatic downloads, plays sent from the phone).
- **Admin:** the in-app update, restart and shut down, and the processor split's decision
  (`lib/cpu.js`'s, which playback's cores follow; C# already applies it).
- **The covers Node still draws** with `sharp` (CMYK and colour-profiled pictures, a speaker asking
  by its own address).
- **Last.fm:** what is left of it.
- **The pages** `/login`, `/display` and the deep links, and `/api/health`.
- **The database's tables and migrations:** created and brought up to date by C# (today
  `lib/library/db.js` and the `Features` constructor create every table; C# creates none).

After it, the Node server is playback and nothing else.

#### The plan in detail (branch `stage-5-everything-but-playback`)

Built from stage 4b's head (`1e89f33`). Each part is built, tested both ways (Node alone, and through
the C# server), committed and pushed on its own, and ticked off in the checklist at the end of this
section, so the work can be taken up again from the branch alone. The rules are the ones every move
has kept (section 3): rule for rule, held to the Node server's own answers and writes, pinned in
`test/front.test.js`, the Node copy kept (deleted in stage 7, 2.4), and in the Node server nothing
but hand-over plumbing.

**A job is handed over only once the C# server has taken it.** The lesson from stage 4b's review:
`ctx.madeByFront(job)` is true while the Node server is still waiting for the hand-over (the
`MANDARIN_FRONT_RUNS` window, up to two minutes). Anything that answers a request, or that would
otherwise not happen at all in that window, keeps being done by the Node server until
`ctx.frontRuns.has(job)`, as `ctx.servicesHanded()` does; only a timer's work (a scan, a check) may
wait for the hand-over.

**The order, and why it differs from the list above.** 8 first, since the others build on the
database being the C# server's. Then the small ones, which the code shows are nearly done already
(their routes moved in v0.8.26 and v0.8.34; only fallbacks are left): 7, 3 and 6, so they are banked
early. Then 4, 1 and 2, each with new hand-over plumbing in the Node server. 5 last: drawing a CMYK
or colour-profiled picture as sharp draws it needs colour management ffmpeg doesn't have, the most
uncertain piece of the stage, so a stop there costs least.

**Part 8: the database's tables and migrations** (`Schema.cs`).
- The C# server makes the database and brings it up to date as `lib/library/db.js` does, statement
  for statement (the same `CREATE` text, so `sqlite_master` reads the same): the tables and indexes,
  the columns added since a table first shipped, `user_version`; a database made by something else
  (another program, an older project on the same volume) moved aside as `musicd.old-<ms>.db` and
  what is worth keeping carried over; the album edits read back from `album-edits.json` into an
  empty table, and that file written where there are edits and none; and the three tables the
  `Features` constructor made (`smart_blocks`, `smart_picks`, `radio_played`).
- `mandarin-server db <data folder>` does it and says how it went (one line of JSON). The C# server
  does it itself before it starts the Node server.
- Hand-over (Node): `DB.open` asks the C# program when the C# server that started it has it
  (`MANDARIN_SERVER_DB=1`, with `MANDARIN_SERVER_BIN`), checks the tables then have every column it
  needs, and only then leaves out its own; the `Features` constructor creates nothing then. A Mac on
  Node alone, an older C# server, or the program failing: its own code, as before. A backup put back
  (swapped in as the Node server starts again) is so brought up to date by C# too.
- Tests: `test/db-csharp.test.js`: a new database, one from before the added columns, one made by
  something else, and `album-edits.json` both ways, each made by the C# program and by
  `lib/library/db.js` and compared (tables, indexes, columns, version, rows, files); through the C#
  server, the servers' own databases are its.

**Part 7: the pages, the deep links and `/api/health`** (`Pages.cs`, `HealthRoutes.cs`).
- `/login`, `/display` and `/display/` sent as the files they are; any other address the page opens
  (a deep link: a `GET` or `HEAD` outside `/api/`, `/stream/`, `/internal/` and `public/`) answered
  with the page, as the Node server's `app.get("*")` did, the Android app's form of it included.
- `/api/health` (open, Docker's health check): `{ ok, version, albums, rooms, ffmpeg, soxr,
  transcode_cache, audio_engine, csharp }`, the rooms and the C# server's own update state as the
  Node server last said them (two fields more in `/internal/library`), the rest here.
- Tests: `test/pages-csharp.test.js`: each page and a deep link byte for byte with the Node
  server's, signed out sent to `/login?next=…`; `/api/health` field for field. `front.test.js`'s pins.

**Part 3: the phone's download lists, what is left** (`DownloadListRoutes.cs`, `Downloads.cs`).
- Answered here too: a streamed album's list (its tracks planned as FLAC, as the Node server plans
  them), a streamed track asked for (403, "Streamed tracks can't be downloaded"), a track no longer
  there (404), a file gone from the disk, and `ids` that aren't a list (500, as Express answers the
  TypeError in the image, `NODE_ENV=production`).
- Tests: `test/library-front.test.js`'s download checks extended to these.

**Part 6: Last.fm, what is left** (`LastfmRoutes.cs`, `Jobs.cs`).
- Its routes moved in v0.8.26 and its pictures in v0.8.34. Left: the routes waited for the hand-over,
  since its address and the environment's key came with it. Now the C# server has them from its own
  environment (`LASTFM_URL`, `LASTFM_KEY`, the same container) from the start, the Node server's word
  taking over when it comes.
- Tests: `test/lastfm.test.js` both ways, unchanged; a check that the routes answer here before the
  hand-over.

**Part 4: Admin** (`Admin/Updater.cs`, `Cpu.cs`, `PowerRoutes.cs`).
- **The in-app update**, a job handed over (`update`): Settings → Updates' status, Check now and
  Install, and the check every twelve hours, as `lib/updater.js` makes them (GitHub's latest release,
  or the highest tag; only ever forwards; the bundle downloaded, unpacked with `tar`, checked for
  `index.js`, `package.json` and the package's name), the C# server of the new version fetched,
  checked and put in place first (`csharp-update.js`'s `prepare`, with the release's SHA-256 sums and
  `--version`); then staged for `launcher.js` (`.update/READY`) and the Node server asked to start
  again (code 75): the launcher lays the new files in, the new Node server finds this program of
  another version and asks it to start again from the new file (code 76), as before. With no launcher
  (the tests' own Node server) the files are laid in here, as `applyStaged` does. Hand-over (Node):
  `update` in `FRONT_JOBS`, its twelve-hourly check not started once handed over, and whether it runs
  under the launcher said in the hand-over's settings.
- **Restart and shut down**: the C# server's since v0.8.31 wherever it started the Node server (every
  install). Nothing else moves: the tests' own Node server, which the C# server didn't start, is one
  it can't start again.
- **The processor split**, a job handed over (`cpu`): decided here (`lib/cpu.js`'s `decide`, the DSP
  conversions counted and playback's second core kept ten minutes after the last), and sent to the
  Node server (`POST /internal/cpu/plan`), which follows it for playback's own processes (the audio
  engine, its decoder) and tells this server of a DSP conversion it makes itself (`POST
  /internal/cpu/dsp` here). `/api/cpu` answered from this decision. Hand-over (Node): `cpu` in
  `FRONT_JOBS`; `lib/cpu.js` follows a plan given to it.
- Tests: `test/update-csharp.test.js` (a stand-in GitHub: the status, a check, an install staged as
  the Node server stages it with the C# program fetched first, each refusal word for word);
  `test/cpu.test.js`: the decision held to `lib/cpu.js`'s for the same machine and settings, the Node
  server following it.
- **Built** as planned. Two things found on the way: `/api/cpu` is answered from the decision
  wherever the C# server holds `cpu`, the Node server started by it or not (the other power routes
  keep to an install, where it did; the suite's Node server is the test's own), and the hand-over's
  settings carry `update_repo`, `update_api` and `update_check` besides `via_launcher`, so the
  tests' stand-in GitHub reaches the C# server the way the Node server's environment reached its own
  updater. The suite's C# server is given the test process's cores (`MANDARIN_CPUS`, `test/setup.js`)
  as it would find them starting first, not the rest the Node server has kept itself to; the hold
  after DSP's last conversion is `MANDARIN_CPU_HOLD_MS` for the tests.

**Part 1: Audio Devices, the writes** (`DeviceRoutes.cs`).
- `PATCH /api/audio-devices/:id`: the name, hidden, sharing, output (mode, bits, volume), DSP
  (through `Biquad.normalise`, `Playback/Biquad.cs`), levelling (`loudness.js`'s `levellingPatch`)
  and the user's rates, depths and DSD, checked and written to `audio_devices` as `registry.js`
  writes them, in the same order and with the same refusals (a write before a refusal stays, as
  there). Then the Node server told (`POST /internal/devices/changed`, `{ id, changed }`): it reads
  its names again and does what each write did there (the zones bumped; a renderer's or sound
  device's queue planned again; a phone told its DSP or levelling; a Sonos room's queue re-planned;
  a device hidden while on switched off and let go), and answers the device as its page shows it
  (online, state, events: live), which C# sends on. Switching a player on or off and the radio are
  playback's: a `PATCH` with `enabled` or `radio` is passed on whole, as are the list, a device's
  page, Look again and Forget (stage 6). Away, only the phone the app is on, as before.
- Tests: `test/devices-csharp.test.js`: each write held to the Node server's own (the row and the
  answer), each refusal word for word, the Node server's own effects seen (a name in `/api/zones`,
  a renderer's queue planned again).
- **Built** as planned. The Node server's part (`AudioDevices.changed`, `Registry.refreshName`, the
  internal route) does what each write did there from the row as written, and a refusal that comes
  after a write still tells it of that write, so a name written before a refused switch is the
  room's everywhere at once, as it was. A body the Node server's parser would turn down (bad JSON)
  is passed on for it to turn down.

**Part 2: library housekeeping** (`Scans.cs`, `ScanRoutes.cs`, `HousekeepingRoutes.cs`).
- **When to scan, everywhere**: the job `scan` handed over whatever the tag reader. Where the C#
  program is trusted with the tags (the tag check passed, or `TAG_READER=csharp`) the scan is it, as
  since v0.8.34; where not, each scan this server starts (its timer, its watcher, Rescan, Reindex, a
  folder added) is made by the Node server's own scanner at its ask (`POST /internal/scan`, its state
  sent back line by line as the program's are, the result and the count at the end). Hand-over
  (Node): the internal route, and `scan` no longer kept back when the program isn't trusted.
- **Clean up of the music folders and its counts**: `GET /api/library/cleanup` and `POST
  /api/library/cleanup` `{ kind: "files" }` (the services' kind is C#'s since v0.8.44).
- **`/api/status`**: the library's part here (the scan's state, the music folders, the count, the
  data folder kept or not), the rooms' part (`zone_count`, `sonos`) as the Node server says it with
  its state (`/internal/library`).
- **The wall display's content** (`/api/display/content`): the zone's track asked of the Node server
  (`GET /internal/playback/now?zone=`), the artist's photos (MusicBrainz, then FanArt.tv, kept a
  week), the album's write-up, the artists' stories and more by the artist from here.
- Tests: `test/housekeeping-csharp.test.js`: each answer held to the Node server's own; a scan made
  by the Node server's scanner at the C# server's ask, the library the same as its own scan makes.
- **Built** as planned. The hand-over says whether the program is trusted (`scan_program`); where it
  isn't, the C# server's timer, watcher, Rescan, Reindex and a folder added each ask the Node
  server's scanner (`POST /internal/scan`, its state line by line, the result at the end) and the
  C# server mirrors what it says, telling the Node server only what it doesn't have (the end, a
  folder let go, Clean up's). The Node server's `scanner.scan()` still picks the program itself the
  moment the tag check passes, so trust gained later needs no new hand-over. The wall display's
  artist photos ask MusicBrainz and FanArt.tv at the addresses the hand-over gives (the Node server
  asked the real ones by name, which the suite can't reach). `/internal/library` carries the rooms'
  part of `/api/status` (`zone_count`, `sonos`), and `POST /internal/playback/now` answers a zone's
  track for the display. `test/front.test.js` and `test/scans-csharp.test.js` pinned the old truth
  (`/api/status` and the files' Clean up the Node server's, the scans kept back) and were brought up
  to the new.

**Part 5: the covers the Node server still draws** (`Images.cs`, `Covers.cs`).
- **A speaker asking by its own address**: the Node server's speakers' addresses come with its state
  (`/internal/library`, `speakers`), and a cover asked for from one is sent here, as the gate there
  lets it through.
- **CMYK and colour-profiled pictures**: drawn here, converted to sRGB as sharp converts them (the
  picture's own profile, or sharp's default for CMYK). ffmpeg neither keeps a JPEG's CMYK values nor
  applies a profile, so the decoding and the colour conversion are this server's own. Held to sharp's
  drawing near enough pixel for pixel, as the placeholder is. If it can't be held to it, it is put to
  the owner (another library, or ffmpeg's colours) and these pictures stay the Node server's.
- Tests: `test/covers-csharp.test.js` extended: a CMYK JPEG, one with a Display P3 profile, and a
  speaker's own address.
- **Built in part.** A speaker asking by its own address is the C# server's (`speakers` with the
  Node server's state; `Images.cs`), tested. **CMYK and colour-profiled pictures are put to the
  owner** and stay the Node server's for now: holding them to sharp's drawing near enough pixel for
  pixel means doing what libvips does with lcms2 — the picture's own profile, or libvips's built-in
  CMYK profile for a JPEG without one, through an ICC transform to sRGB — and a port of that (the
  matrix profiles are small; the CMYK ones are lookup tables) is days of work with an uncertain
  match. Three ways, the owner's to choose, before stage 7 can drop Node: (1) link lcms2 into the C#
  server and carry libvips's CMYK profile with it, the same maths; (2) accept ffmpeg's colours for
  these pictures (ffmpeg applies no profile; a CMYK JPEG comes out plainly wrong, a Display P3 one a
  little flat) and draw them here like the rest; (3) a .NET imaging library (ImageSharp does ICC
  transforms from 3.1) for these pictures alone, held to sharp's by test. Covers like these are
  rare (a scanned sleeve saved from a design program); nothing else waits on it.

**Also in this stage:** `test/menu.test.js` waits for the side menu to have finished sliding in
before it taps (it waited a fixed 400 ms, and on a slow Mac runner tapped before the menu was there).

**Checklist** (ticked as each part is committed and pushed):

- [x] Plan written; version 0.8.48
- [x] Part 8: the database's tables and migrations
- [x] Part 7: the pages, the deep links and `/api/health`
- [x] Part 3: the phone's download lists, what is left
- [x] Part 6: Last.fm, what is left
- [x] Part 4: Admin (the update, the processor split)
- [x] Part 1: Audio Devices, the writes
- [x] Part 2: library housekeeping
- [x] Part 5: the covers the Node server still draws (a speaker's own address; CMYK and profiled pictures put to the owner)
- [ ] `test/menu.test.js` waits for the menu
- [ ] The whole suite both ways; README, CHANGELOG and this file brought up to date

### Stage 6: playback, in one stage (L)

The zone hub, Sonos, the UPnP renderers, sound devices on the server, the phone as a zone, the
queue, history, plays, the radio, the device list and `/api/status`'s rooms, moved together: the
largest stage and the riskiest (about 6,600 lines of Node, the Sonos queue's exact command order and
timing, multicast discovery under Docker's host networking, renderer events, gapless arming that
waits for a conversion to finish, and the phone's protocol that installed apps depend on).

The hub serves every kind of player at once (Sonos, renderers, sound devices on the server,
phones), with one state, one revision for the long polls, and shared history and radio. Moving it
kind by kind would need a protocol between the two processes, written, tested and then thrown away;
moved whole, it needs none (the owner's decision). Stage 2's ports (DIDL-Lite, the queue moves,
ZoneGroupState, the renderers' descriptions, sinks, events and profiles, the stream plans) are
already held to the Node server's. Within the stage the work goes the hub and the queue store
first (the phone as a zone, history, plays, the radio), then Sonos (discovery, topology, control,
the queue on the speaker with its copy read again only when the UpdateID moves), the renderers
(discovery, GENA answered by C#, gapless, LinkPlay), sound devices on the server (the engine's
driver, ALSA's list), and last the device list and the rooms; it merges once every playback test
passes through C#, and the owner has tried it on their own household.

#### The plan in detail (branch `stage-6-playback`)

Built from `migration`'s head after the quality gates' merge (`33e6094`, v0.8.48). Each part is
built, tested both ways (the Node server alone, and through the C# server), committed and pushed
on its own, and ticked off in the checklist at the end of this section, so the work can be taken
up again from the branch alone. The rules are the ones every move has kept (section 3): rule for
rule, held to the Node server's own answers, writes and command order, pinned in
`test/front.test.js`, the Node copy kept frozen for a Node server alone (deleted in stage 7, 2.4),
and in the Node server nothing but hand-over plumbing. The quality gates hold too
(`docs/quality-plan.md`): the port is split along the Node modules' own lines and further, every
new C# file under the watch line, `npm run gates` green before every push.

**How playback is handed over.** One job, `playback`, in `FRONT_JOBS` (index.js), `Jobs.Names`
(Jobs.cs) and `MANDARIN_FRONT_RUNS` (test/setup.js). Unlike stage 5's jobs it isn't timer work but
the answer to every playback request, so it keeps a rule of its own: the C# server answers playback
from its first request wherever it holds the job, and the Node server never starts its hub (the
Sonos loops, the device scans, the kept queues put back, history's hooks) where `MANDARIN_FRONT_RUNS`
names the job. That is safe because the hand-over handshake (`Jobs.Start`) completes before the C#
server listens (Program.cs), in the image and in the suite alike, and the Node server the C# server
starts does nothing of playback in the window. An older C# server (no `playback` among its names)
or a Node server alone gets the Node hub as before, started at a hand-over without the job or after
the two-minute wait (`ownWork`). Nothing of playback is done twice.

The hand-over's `config` gains what the hub was set up with: `sonos_hosts` (SONOS_HOSTS and the
hosts known from last time, `sonosKnownHosts`), `server_ip`, `sonos_include`, `sonos_exclude`,
`upnp_hosts`, `upnp_multicast`, `upnp_offline_ms`, `local_audio`, `audio_engine` (where the engine is,
or that it is off) and `port`. The C# server reads the same from its own environment where the
Node server's came from there, so an install needs nothing new; the tests' overrides reach it
through the hand-over, as `update_api` and `scan_program` do.

Once the C# server holds playback, nothing playback-wise goes to the Node server: `/internal/
library`'s `rooms`, `zone_count`, `sonos` and `speakers` are the C# server's own (HealthRoutes,
HousekeepingRoutes and Images read its hub), `POST /internal/playback/now` and `/internal/playback/
play` go unasked (it plays itself), `/internal/devices/changed` goes unasked (the devices are its).
The Node server keeps `/internal/cpu/plan` for the conversions it still makes.

**The order, and why.** The hub, the queue store, the phone, history and the play routes first
(part 1): the heart of it, with the phone the one player that tests it end to end without a
speaker. Then Sonos (part 2), the largest and the owner's household, against the fake household
the end-to-end test drives. Then the renderers (part 3) against the fake renderer, sound devices on
the server (part 4) with the engine, and last the device list, the rooms and the Node hub left idle
(part 5), which needs every kind of player in place.

**Part 1: the hub, the queue store, the phone as a zone, history, the radio, the play routes**
(`Playback/Hub.cs` and `Hub.Commands.cs`, `Playback/Phones.cs` with `Phones.Report.cs` and
`Phones.Commands.cs`, `Playback/QueueStore.cs`, `Playback/Items.cs` and `Item.cs`,
`Playback/Tracks.cs`, `Playback/History.cs`, `Playback/NowPlaying.cs`, `Playback/Register.cs`,
`Playback/ZoneState.cs`, `PlaybackRoutes.cs` with `PlaybackRoutes.Commands.cs` and
`PlaybackRoutes.Play.cs`, `PhoneRoutes.cs`, `ServiceRoutes.Play.cs`; `Playback/Hub.Stubs.cs` holds
the Sonos and renderer halves until parts 2 and 3; the Node side in `lib/server/playback-handover.js`).
Built in v0.8.49: every answer held to a Node server alone, request for request, in
`test/playback-csharp.test.js` (the two servers side by side, a phone zone on each). Two traps it
found, kept here for the parts to come: a key a body doesn't carry is JavaScript's `undefined`
(`Number(undefined)` is NaN, "offset required"), not `null` (`Number(null)` is 0) — `JsonObject`
answers null for both, so the routes ask `ContainsKey` first (`PlaybackRoutes.Num`); and a
`JsonNode` moved into another object is gone from the first (the hello's `resume`).
- **The hub** (`lib/sonos/zones.js`'s `ZoneManager`): one state per zone, the revision and its
  waiters (`/api/zone-state?wait_for=`, 20 s), `applyState` with its three hooks (`track`, `played`
  at the halfway-or-30-seconds mark, `queue-low` 25 s from the end of the last track), `positionNow`,
  `watch` and the hot set, the kept queues (`snapshotOf`, `persist`, `restoreQueues`), `rebuildItems`
  and `targetFor`. Each method's Sonos branch comes in part 2 (until then a Sonos id gets the hub's
  own refusal, "That room isn't available"); the renderer branch in part 3.
- **The phone** (`lib/sonos/phones.js`): hello, the commands long poll (the one `seq`, the trim to a
  `sync`, 45 s presence, the ten-second sweeper), the report (`usb_caps`, `volume_steps`, the phone's
  own list), every command (`load`, `insert`, `jump`, `remove`, `clear`, `mode`, `volume`, `mute`,
  `seek`, `play`, `pause`, `stop`, `next`, `previous`, `dsp`, `replaygain`), `replan`, `optimistic`,
  `targetFor` for a USB DAC. The shapes don't move: the apps installed are the test.
- **The queue store** (`lib/sonos/queue-store.js`): `queue:<id>` rows in `settings`, the same JSON,
  the 300 ms debounce and the ten-second position writes, `flush` on stop, so a queue kept by one
  server is put back by the other across an update.
- **The items** (`lib/server/playback.js`): `planFor` (StreamPlans.PlanFor), `streamUrl` (Signing
  with the server's secret; `o=`, `m=`, `g=`), `artUrl`, `item` (Didl.Build, the renderer's three
  attributes), `itemsFor` with each track's gain (Gain.GainsFor; the device's levelling from
  `audio_devices`), `prefetch` (Transcoder.Prefetch), `playTracks`, `playAlbum` (shuffle), `normaliseKind`.
- **History and the radio** (`lib/server/features.js`'s playback half): a play into `plays` (the
  album's id, never its title) and Listen later's `laterPlayed`; `historyAlbums`, `playedToday`,
  `firstPlay`, `unplayed` and `playStats` where playback asks them (Random Album, `/api/pick-unheard`);
  `radioZones` in `settings`; `radioTopUp` with `RadioMemory` over `radio_played`, the 60-day
  preference; `lastZone`. Smart Picks and the taste graph stay as they are (C#'s since v0.8.20, read
  from `plays`).
- **The routes** (`api-playback.js`, `api-phone.js`): every route in Appendix A's Playback and Phone
  lists, with the gate before them (another device's phone, away from home, the home-only routes),
  the name overlay (`nameFor`, `named`, `namedOutput`), `zoneJson`, `nowPlaying` with `formatOf`
  (the badge, every branch), Random Album and the history-to-queue routes (`resolveTrack`),
  `/api/radio`, `/api/album/now-playing`. `POST /api/<svc>/play` (ServiceRoutes) plays through the
  hub itself (`api-service.js`'s `play()`) and no longer asks the Node server.
- **Hand-over (Node):** `playback` in `FRONT_JOBS`; `zones.start()`, `ctx.devices.start()`,
  `restoreQueues()` and `features.wire()`'s hooks not run where the job is named, run at a hand-over
  that lacks it or after the wait; `/internal/library`'s rooms fields say so when the hub never ran.
- **Tests:** `test/phone.test.js`, `test/phone-music.test.js`, `test/radio-memory.test.js` and
  `test/queue-moves.test.js` through C#; `test/playback-csharp.test.js` (new): the same requests to
  both servers for a phone zone, each answer and refusal held to the Node server's (the JSON
  compared), the kept queue's row the same, the `plays` row the same after a play, the long poll's
  commands the same in order. `front.test.js`'s pins.

**Part 2: Sonos** (`Playback/SonosDevice.cs`, `Playback/SonosTopology.cs`, `Playback/Hub.Sonos.cs`,
`Playback/Hub.SonosCommands.cs`; `Playback/Hub.Register.cs` for the register's sync, brought
forward from part 5 because the phone's page in Audio Devices needs the row). Built in v0.8.49:
the fake household drives both servers in `test/playback-csharp.test.js`, each speaker's command
log compared action for action. Three things worth knowing: a room that isn't there answers
`/api/queue` with an empty queue, not a refusal (zones.js `queue()`); two "playpause" in a row
both pause, because the second comes before the room has been read again — kept, as there; and
the rooms' part of `/api/status`, `/api/health` and `Images.cs`'s speaker addresses read the hub
here from this part on, so `test/sonos-restart.test.js` passes through C#.
- **`SonosDevice`** (`device.js`, `soap.js`'s `call` and `httpGet`): a keep-alive pool of four, the
  SOAPACTION header, the envelope as `Soap.cs` builds it and the fault as it reads it, the ten-second
  timeout, one retry on a connection the player closed, `UPnPError`'s words.
- **Discovery and the household** (`topology.js`): M-SEARCH from every LAN address (stage 2a's
  `searchAddresses`), the seeds and the recent hosts first, `refresh` (the first known host alone,
  then the rest at once, the first answer taken), `fetchModel`, `signature`, `Household`'s rooms,
  groups and coordinators (stage 2a), `sonosKnownHosts` written back.
- **The Sonos half of the hub**: the three loops (discover 60 s, topology 30 s, poll 1 s with the
  hot, playing and every-fifth rule), `pollGroup` and `pollVolumes`, `queueOf` read again only when
  the UpdateID moves (v0.8.35), `enqueue` in its exact order (clear, the first track alone,
  SetAVTransportURI, seek, play, the rest; the v0.8.34 rule for a queue with music that isn't
  playing), `addBatch` (sixteen at a time, one at a time on older firmware), `control`, `seek`,
  `playFromHere` (read back before answering), `removeFromQueue`, `moveAfterCurrent`, `clearQueue`,
  `setSettings` (the six play modes), `setVolume` and `setMute`, `pauseAll`, `group` and `ungroup`,
  `transfer` between any two kinds, `replanSonos`, `pokeAfter`.
- **Tests:** `test/e2e.test.js`, `test/queue-screen.test.js`, `test/queue-stopped.test.js`,
  `test/play-next.test.js`, `test/sonos-restart.test.js`, `test/now-playing-restart.test.js` (its
  reads of `ctx.zones` replaced by the request that bumps), `test/dsp.test.js`, `test/stream.test.js`
  and `test/playlists.test.js` through C#; `playback-csharp.test.js` extended: the fake household's
  command log the same, action for action, for each scenario on both servers.

**Part 3: the renderers** (`Renderers/Players.cs`, `Renderers/Renderer.cs`,
`Renderers/Discovery.cs`, `Renderers/Ssdp.cs`, `Renderers/GenaClient.cs`, `Renderers/LinkPlay.cs`,
`Renderers/Registry.cs`).
- **`UpnpPlayers`** (`players.js`): the queue kept here, `jump`, `armNext` once the next file is
  complete (`ready`: Transcoder's status, a prefetch when it has none), the device that ignores
  SetNext noticed and started by hand, the three-strikes rule, `nextIndex` (shuffle's played set,
  loop), `poll` with `indexOfUri`, `verify` (LinkPlay's getMetaInfo) and `verifyLocal` (ALSA's
  hw_params), `ensureSubscribed` and `onNotify` (GENA; `NOTIFY /upnp/event/:id` answered by the C#
  server before the gate, unsigned), `targetFor` (the profile's effective chips, ffmpeg's 32-bit,
  the DSD mimes, the zone's DSP), `replan`, `restore`, `drop`, every command, the fixed-volume rule.
- **Discovery** (`discovery.js`, `ssdp.js`, `linkplay.js`): the search for MediaRenderer from every
  LAN address, Sonos answers left aside, `describe` with the location cache, the re-check after ten
  minutes and the quiet direct check of a known renderer that missed a round, the Sink read, LinkPlay's
  probe (https then http, the certificate unverified) and `seedLocation`.
- **The register** (`registry.js`): `seen`, `touch`, `rename`, `setUserCaps`, `markVerified`,
  `setSettings`, `forget`, the name overlay: the reads DeviceRoutes.cs already makes, one class.
- **Tests:** `test/renderer-playback.test.js`, `test/audio-devices.test.js`'s renderer half and
  `test/devices-hide.test.js` through C#; the fake renderer's log held to the Node server's.
- **As built** (v0.8.49): `Players.cs` (the players, `targetFor`, `replan`, the zones, `drop`),
  `Players.Poll.cs` (GENA, the poll), `Players.Commands.cs` (`verify`, `ready`, `armNext`,
  `jump`, every command), `Renderer.cs` (the SOAP renderer behind `IRenderer`, which part 4's
  engine output answers too), `Discovery.cs`, `Ssdp.cs`, `GenaClient.cs`, `LinkPlay.cs`; the
  sending half of `soap.js` as `Playback/SoapHttp.cs`, shared with Sonos; `Hub.Upnp.cs` hands
  every `UPNP_`/`LOCAL_` id to the players; `UpnpEventRoutes.cs` answers `NOTIFY /upnp/event/:id`.
  The register stays `Playback/Register.cs` (stage 5's class, grown). Part 5's device list came
  with this part rather than after it, because the renderers' page needs `online`, `events` and
  `last_error` from the hub that drives them: `Renderers/Devices.cs` (`json`, `list`, `get`,
  `online`, `enabled`, the scan loop, `forget`) and `DeviceRoutes.Read.cs` (`GET`, `GET /:id`,
  `POST /rescan`, `POST /:id/forget`, away from home), and `DeviceRoutes.cs`'s PATCH takes
  `enabled` and `radio` and answers from the hub; `/internal/devices/changed` is no longer asked
  (it stays for an older C# server). Part 5 keeps the rooms' `zone_count` and `sonos` (done in
  part 2), the sound devices' `local` counts (part 4) and leaving the Node hub idle.
  `test/devices-csharp.test.js` was changed with it: where C# holds playback the effects are the
  C# hub's (never the Node server's players), the switch and the radio are held to the Node
  server's rows and answers, and a renderer hidden while playing must be sent Stop.

**Part 4: sound devices on the server** (`Local/EngineOutput.cs`, `Local/LocalDevices.cs`).
- **The engine driver** (`lib/local/engine.js`): the program found in the same order
  (AUDIO_ENGINE_BIN, the image's, the one downloaded to the data folder, each probed for
  `protocol 1`), downloaded once in the background where the image lacks it (the SHA256SUMS
  checked), and driven over its stdin and stdout as `EngineOutput` drives it: the commands, the
  events (`pos`, `format`, `ended`, `xrun`, `error`), `pending` and `fetched`, the gain on the
  audio taper (`amplitude`), `halt`; the engine on playback's core (Cpu.cs).
- **The device list** (`lib/local/devices.js`): ALSA's cards from `/proc/asound` and `/dev/snd`
  (the roots overridable for the tests), a Mac's from `system_profiler`, `hwParams`, `idOf`.
- **Not ported**: `lib/local/output.js`, the ffmpeg sink a device was played through before the
  engine (v0.6.18). The image and the Mac installer carry the engine; a Mac on Node alone keeps the
  sink. Stage 7 drops it with the rest of the Node copies.
- **Tests:** `test/local-output.test.js`'s end-to-end half through C#, a `file:` device played by
  the engine (as `test/engine.test.js` plays one), the list from the fake `/proc/asound`; the sink's
  own unit tests stay the Node server's.
- **As built** (v0.8.49): `Local/AudioEngine.cs` (the finder grown out of `HealthRoutes.cs`, with
  `Ensure`, the download — its own temporary name, so a Node server fetching at the same time never
  writes the same file — `Plays` and `Reset`), `Local/EngineOutput.cs` (`IRenderer`, with `Sink` and
  `Sent` for the verified tick), `Local/LocalDevices.cs` (`ListLinux`, `ParseMac`, `HwParams`,
  `List`), `Cpu.Engine.cs` (`Core`, `PlaceRealtime`: playback's cores, `nice -n -10` where
  allowed). The scan loop is `Renderers/Devices.cs`'s (`ScanLocal`, every 30 s and first in Look
  again), its counts the list's `local`. The hub starts the engine's finder (and the download where
  Docker or `AUDIO_ENGINE_DOWNLOAD=1` allows it) once it holds playback. A test's own device list
  reaches the hub through the hand-over (`local_devices`, `lib/server/playback-handover.js`
  `localDevicesFor`), the one piece of Node plumbing. Without the engine (a Mac, or not yet
  downloaded) a `LOCAL_` device is refused in words ("can't be played from this server: Mandarin's
  audio engine isn't here"); the ffmpeg sink is not ported, as planned.

**Part 5: the device list, the rooms, the Node hub idle** (`Renderers/Devices.cs`,
`DeviceRoutes.cs`, `HousekeepingRoutes.cs`, `HealthRoutes.cs`, `Images.cs`).
- **`AudioDevices`** whole (`lib/renderers/devices.js`): the three loops (scan 60 s, sync 10 s,
  local 30 s), `json`, `list` and `get` (`dsp_info`, `found_by`, `last_error`, `events`,
  `volume_fixed`, `takes_flac`…), `enabled`, `shared`, `zoneShown`, `online`, `stateOf`,
  `setEnabled`, `setHidden`, `setShared`, `setOutput`, `setDsp`, `setLevelling`, `rename`,
  `setUserCaps`, `forget`; DeviceRoutes.cs's writes no longer tell the Node server but do what it did.
  `GET /api/audio-devices`, `GET …/:id`, `PATCH` whole (`enabled`, `radio` and away from home too),
  `POST …/rescan`, `POST …/:id/forget`.
- **The rooms**: `/api/status`'s `zone_count` and `sonos`, `/api/health`'s `rooms`,
  `/api/display/content`'s track and `Images.cs`'s speaker addresses from the C# server's own hub.
- **Hand-over (Node):** nothing more; `ctx.deviceShown`, `/internal/devices/changed`,
  `/internal/playback/now` and `/internal/playback/play` stay for an older C# server, unasked by this one.
- **Tests:** `test/audio-devices.test.js`, `test/devices-csharp.test.js` (what was "the Node server's
  own effects" now the C# server's own), `test/housekeeping-csharp.test.js` and
  `test/pages-csharp.test.js`'s health through C#.
- **As built** (v0.8.49): most of this part came earlier — the device list, its routes and
  `PATCH` whole with part 3, the rooms' part of `/api/status` and `/api/health` and a speaker's
  address for a cover with part 2, the sound devices' `local` counts with part 4. Left to this
  part: `/api/display/content`'s track from the hub (`HousekeepingRoutes.cs`), and
  `test/housekeeping-csharp.test.js` changed to hold `/api/status` to the Node server's answer with
  the rooms' part set aside (its hub idle, it counts none) and the display's content to the hub's
  track. The Node hub is idle by the hand-over alone (`lib/server/playback-handover.js`): nothing
  more was needed. The three internal routes stay for an older C# server, as planned.

**Then** the whole suite both ways, the version 0.8.49 everywhere, `server/README.md`'s table, the
CHANGELOG, this file and `handover.md`, the pull request into `migration` with the results, the
review of the diff, and **the owner tries it on their own household before it is merged** (the rule
above): the stage is not merged on CI alone.

**Checklist** (ticked as each part is committed and pushed):

- [x] Plan written; version 0.8.49
- [x] Part 1: the hub, the queue store, the phone, history, the radio, the play routes
- [x] Part 2: Sonos
- [x] Part 3: the renderers (with the device list and its routes from part 5)
- [x] Part 4: sound devices on the server
- [x] Part 5: the device list, the rooms, the Node hub idle
- [x] The whole suite both ways; README, CHANGELOG, handover and this file brought up to date
- [x] Merged into `migration` (PR #209, v0.8.49). The owner's own test moved to the end of stage 7
      by the owner's decision: one final test from `migration` once Node is gone, rather than one
      per stage.

### Stage 7: Node removed → the v0.9.0 candidate (M)

- **The image without Node** and its npm packages (`better-sqlite3`, `sharp`, `music-metadata`,
  `express`); its health check without `node -e`; the C# tag reader used everywhere.
- **The launcher in C#**, and **in-app updates of the C# server only** (stage 0's fetch, without
  the Node half).
- **The tests stay in JavaScript** (`node:test`, with Node in CI only) **and drive the C# server's
  binary** over HTTP. Those that reach into the Node server today (`ctx.playback`, `ctx.zones`,
  `ctx.devices`, `ctx.services`, `ctx.loudness`…) are rewritten; CI's Node-alone run goes.
- **Macs** run the C# server alone, and **the Node copies** of every part are deleted (2.4).

Then the owner tests it from `migration` until happy, and merges it to `main` as v0.9.0.

#### The plan in detail (branch `stage-7-node-removed`, v0.8.50)

The C# server answers everything a page, a phone or a speaker asks since stage 6. What is left
is the scaffolding that assumes a Node server behind it (the hand-over, the Node server's library
state, the launcher), the tests that reach into that Node server, and the image and the files.
The order: the server stands on its own first (parts 1 and 2), so the suite can be moved onto it
(part 4) while the launcher and updates move (part 3); the deletion last (part 5), because the
parity suites need the Node copies until the suite no longer compares against them. v0.8.50 is
the last v0.8.x; the owner's merge to `main` is v0.9.0.

**Part 1: the C# server on its own** (`Config.cs`, `Library.State.cs`, `Jobs.cs`, `Program.cs`).
- **The configuration** index.js reads from the environment (`PORT`, `MUSIC_DIR`, `DATA_DIR`,
  `SERVER_IP`/`BRIDGE_IP`, `SONOS_HOSTS`, `UPNP_HOSTS`, `UPNP_DISCOVERY`, `INCLUDE_ZONES`,
  `EXCLUDE_ZONES`, `SCAN_INTERVAL_HOURS`, `TRANSCODE_CACHE_GB`, `MUSICDNET_BIN`, the `*_URL`
  stand-ins, `IDENTIFY`, `IDENTIFY_TICK_MS`, `LOUDNESS_TICK_MS`, `LASTFM_KEY`, `LOCAL_AUDIO`,
  `AUDIO_ENGINE*`, `UPDATE_*`, `TAG_READER`, `DEBUG`) read here, into the same object the
  hand-over's `config` carries today (`Claimed.Config`), so `Jobs.Start` and everything under it
  take it unchanged: the hand-over becomes a call.
- **The library's state** (`/internal/library`) the server's own: `version` and `marks` counted
  here (bumped where `/internal/library/changed` was sent), `building`, `progress`, `scanning`,
  `built_at` from `Scans.cs`, the label rules from the settings, `day`, `day_start`, `week` on
  this clock, `base_url` from the configuration; `rooms`, `zone_count`, `sonos`, `speakers` are
  the hub's already; `csharp_update` and `app_version` go (nothing to bring to a version).
- **Every job held from the first request** when no Node server is to be started
  (`MANDARIN_NODE=0`, or no `index.js` beside the program): `Jobs.Holds` true, no claim loop, the
  hub started from the configuration. With a Node server still there (the transition), as today.
- **`/api/health`** without `csharp` (nothing to match), and a `--health` subcommand for the
  image's health check (one GET of `/api/health`, exit 0 or 1).
- **Tests:** `test/server.js` (new): starts the binary alone on a port, with a test's
  environment, waits for it, stops it; `test/csharp-alone.test.js` (new): sign-in, the scan, the
  pages, the rooms from a fake household, a phone's hello, a renderer, a play fetched by the
  speaker, with no Node server anywhere. `test/front.test.js`'s pins read "C#" for everything
  once part 2 has moved the last routes.
- **As built** (v0.8.50, part 1): `Config.cs`, `Library.State.cs`, `Jobs.StartAlone`,
  `Admin/Restore.cs`, `Auth.Secret.cs` (the install's secret, which `auth.js` made as the Node
  server started, made here when none is there: without it nothing signed for a speaker was
  vouched for), `HealthRoutes.cs`'s `--health`; `MANDARIN_NODE=0` or no `index.js` beside the
  program. `test/server.js`, `test/config-csharp.test.js`, `test/csharp-alone.test.js`.

**Part 2: the last routes.** The suite run against the server alone (part 4's helper, file by
file) says what is still passed on or missing; each becomes the server's: `/api/tagcheck` and
`/api/tagcheck/report` go with the tag check (the C# reader is the reader; the Library Scanner
page's panel with them), `reset-password` as a subcommand (`mandarin-server reset-password`),
Settings → Updates' `mac_node_only` gone, `/internal/*` gone but `/internal/library/changed`
(kept, front-key only, for a test that changed the database by hand) and the tests' revision
route. Covers in CMYK or with a profile of their own: as the owner decides (section 6; until
then drawn by ffmpeg without the profile, said in the CHANGELOG).
- **As built** (v0.8.50, part 2): the 404s as Express said them (`Program.cs`); the tag check's
  panel out of the page; `Auth.Reset.cs` (`mandarin-server reset-password`); `mac_node_only`
  gone; `Library.UseInternal` (`POST /internal/library/changed`, alone, front key); the hub's
  `X-Mandarin-Answered` on a renderer's event; CMYK and profiled covers and wordless placeholders
  drawn alone (`Covers.cs`, `CoversDrawn.cs`). The other `/internal/*` addresses (the Node server's
  asks of this one) go with the Node copies in part 5.

**Part 3: the launcher and updates in C#** (`Admin/Updater.cs`, `Program.cs`, `Dockerfile`,
the Mac installer). The update lays the staged bundle in itself (the running program carries on
from the old file; the new one is started as `Front.StartAgain` starts it today) — no
`.update/READY`, no launcher; the image's `CMD` runs `mandarin-server` under tini; the Mac
installer's start script runs the binary; `test/update*.test.js` through the binary alone.
- **As built** (v0.8.50, part 3): `Admin/Updater.cs` alone lays the bundle in itself (no
  `index.js` looked for, no npm) and starts the program again through `Jobs.RestartNode` →
  `Front.StartAgain`; `test/update-alone.test.js` (new) and `test/server.js`'s `bin` and
  `exited()`. The image's `CMD` and the Mac's launchd item already run the binary; the launcher
  path behind a Node server, `test/update.test.js` (Node under the launcher) and
  `test/update-csharp.test.js`'s launcher half go with the Node copies in part 5.

**Part 4: the tests drive the binary.** 33 files reach into the Node server (`ctx.db.raw`,
`ctx.db.setSetting`/`setting`, `ctx.library.reload`, `ctx.frontRuns`, `ctx.listeningOn`,
`ctx.tidal.api`, `ctx.scanner.state`, `ctx.features.insertPlay`, `ctx.devices.registry`,
`ctx.transcoder.*`, `ctx.downloads.*`, `ctx.auth.signUrl`…). `test/server.js` gives each what
it needs over HTTP or the database file: `db` (better-sqlite3 opened on `musicd.db`, a dev
dependency from now on), `setting`/`setSetting` through it, `reload` (`POST
/internal/library/changed`), the front key, `signUrl` (`Playback/Signing.cs`'s rule, in the
helper), the scanner's state from `/api/status`. The `*-csharp.test.js` parity suites keep their
assertions on the C# answers and lose their Node halves; CI's Node-alone job goes with them, the
Mac jobs run the binary alone.
- **As built** (v0.8.50, part 4): `test/server.js`'s `createServer` (index.js's options as the
  environment) and its ctx (`db.raw`, `setting`/`setSetting`, `library.reload`, `auth.signUrl`,
  `logs`, `internal`, `restart`). The parity suites keep their Node halves as a recording
  (`test/golden.js`, `test/golden/*.json`, made with `RECORD_<SUITE>=1` under MANDARIN_FRONT=1
  while index.js is here): library-front, devices-csharp, playback-csharp, services-rows,
  services-import, services-signin; what depends on the machine is held by rule (a file's length,
  ETag, ffmpeg's arguments run again, ids as keys, times from now). `test/cpu-alone.test.js` (new),
  power-csharp alone, the update's refusals in update-alone. Left on the Node server, to go with it
  in part 5: the hand-over's own tests (front.test.js's last, cpu.test.js's Node half, power,
  update, update-csharp, update-prepare, csharp-update, tag-reader-switch) and the suites whose
  oracle is a Node module (db-csharp, tags-front, and the `lib/` requires of 60-odd files), which
  part 5 records or drops with the module. Found on the way and fixed: deep links, stream and cover
  refusals alone, Rescan naming the services, a hidden renderer's Stop, an unreadable JSON body
  alone.

**Part 5: the tests without `lib/`.** Every test that still asks a Node module asks the C#
server instead, or keeps the Node server's answers, so `lib/` can go: the parity suites recorded;
the unit tests through `mandarin-server score` or the server running; the hand-over's own tests
dropped with it.
- **As built** (v0.8.50, part 5; merged into `migration` on its own, the owner asked for the rest
  on a branch of its own as part 6): `test/golden.js` `answers()` (each answer list in full where
  small, else a sum of every 32 cases) holds sonos, renderers, extras, identify, share, backup,
  write-ups, art search, streams, scan, db, conversions and AutoEQ to the Node server's answers
  (`RECORD_<SUITE>=1`); `test/tag-oracle.js` keeps `readTags` over `music-metadata` as the tag
  reader's oracle; `test/waveform-rule.js` the waveform's rule; `test/library-server.js` and
  `test/score.js` (with `scoreAsync`) for the rest. `RulesCommand.cs` and new `score` answers
  (`fromnames`, `dates`, `mounts`, `versions`, `soapcall`, `labelnames`, `phoneplays`, `uris`,
  `cpu`, `auth`, `register`, `ssdp`, backup's `applies`). Found and fixed: the library's one-time
  upgrades never made by the program alone (`Scan/Scanner.Migrate.cs`); `album-edits.json` written
  only through the Node server; a scan read as ended before the library was read again; `/api/cpu`'s
  DSP flag ahead of its split. The Node scanner fallback (`Scans.cs`) and the `tools/` reports that
  ran `lib/` removed. Not yet moved, left to part 6: engine, local-output, identify, label-logos,
  lastfm, loudness, mbpack, radio-memory, shelf, similar, stream, tailscale-builtin, and the `RECORD`
  halves of the recorded suites with `test/setup.js`'s `MANDARIN_FRONT` block.

**Part 6: the image and the repository** (branch `stage-7-part-6-node-deleted`). The tests part 5
left; the `RECORD` halves of the recorded suites and `test/setup.js`'s Node block; the Dockerfile
without the node stages and npm packages (the engines, the binary, `public/`); `package.json` with
dev dependencies only (the tests' `better-sqlite3` and `music-metadata`, the gates' tools);
`index.js`, `launcher.js`, `reset-password.js` and `lib/` deleted, and the C# server's paths for a
Node server behind it (`Front.RunsNode`, the `/internal/*` asks, `Library.ToNode`); the ratchet's
allowance and the `@ts-check` baseline shrunk by their tools; CI without the Node matrix (Node 22
for the tests alone); `README.md`, the GitHub Pages site, `server/README.md`'s table, the
CHANGELOG, this file and `handover.md`; the pull request into `migration` for the owner's final
test from `:migration`.
- **As built** (v0.9.0): the twelve suites left on `lib/` ask the program (`mandarin-server score`:
  `engine`, `local`, `scorecall`, `itunes`, `mbpack`, `logos`, `lastfm`, `shelf`) or the server
  running; the recording halves gone from every parity suite, `test/golden.js` read-only;
  `test/setup.js`'s `MANDARIN_FRONT` block gone; the in-app update's end-to-end test
  (`test/update.test.js`, the page's one Update) on the program, which builds the 9.9.9 it updates
  to. `index.js`, `launcher.js`, `reset-password.js` and `lib/` deleted. In the program: no Node
  server started, waited for or passed to (the YARP package gone), `Front.Alone`, `Matched`,
  `RunsNode`, `NodeSays` gone, `Jobs` without the claim and its re-claim (`Jobs.Restart` starts
  the program again in place), the library's state local only, `ToNode`/`AskNode` and every
  `/internal/*` ask of Node gone (the device writes, a service album's play and the wall display
  are the hub's), the CPU split without Node's DSP word or its follow, the updater without the
  launcher or npm, `Config` without `via_launcher`, `cpu_dsp` and `scan_program`. The image on
  Debian with no Node; `package.json` dev dependencies only (`better-sqlite3`,
  `fast-xml-parser`, `music-metadata`, `sharp`); CI without `MANDARIN_FRONT` and checking the image
  has no Node; the release's update bundle the page and `package.json`; the Mac installer
  without Node (and bringing a Node-era install up to date). The baselines shrunk by their tools.
  Found on the way: Last.fm's list of one and its spacing (fixed). Kept: `/internal/mb/slot` (the
  one MusicBrainz timer, pinned by `test/front.test.js`).

**Checklist** (ticked as each part is committed and pushed):

- [x] Plan written; version 0.8.50
- [x] Part 1: the C# server on its own
- [x] Part 2: the last routes
- [x] Part 3: the launcher and updates in C#
- [x] Part 4: the tests drive the binary
- [x] Part 5: the tests without `lib/` (the most of them), and what they found
- [x] Part 6: the image and the repository; docs; the pull request (v0.9.0, branch
  `stage-7-part-6-node-deleted`)

### The order, and why

0 first, because everything after it is wasted on in-app updates without it. 1 next: small,
independent, and it builds pieces later stages need (URL signing, the ReplayGain sums). 2 before
3 and 6, so the hard logic is proven before it runs. 3 before 4, because the services' streams
use the conversions. 4 whole before the rest, so that playback, for a service album, is only the
library's tracks. 5 next, everything but playback in one go, so playback is the last thing
standing; 6, playback whole; 7 last.

---

## 5. Risks, and what answers each

| Risk | Answer |
|---|---|
| The Sonos queue's order and timing (play now, play next, batches of 16, re-planning a playing queue) | Stage 2's ports; `test/fake-sonos.js` extended; the switch, tried at home before the default flips |
| DIDL and SOAP bytes Sonos is picky about | Byte-for-byte parity in stage 2 |
| The phone's long poll (one shared `seq`, trimming to `sync`, 45 s presence); apps already installed | Unchanged shapes; `phone.test.js` run against both; Android's own `PhoneTest.kt` |
| Multicast discovery and GENA under Docker's host networking | The interface ranking ported as is; checked on the owner's household before the default flips |
| Two servers converting into one transcode folder | Identical cache names (stage 2); one writer per name |
| Tidal's token refreshed by two processes | One owner since v0.8.47: the C# server refreshes it, the Node server refuses to once the services are handed over |
| An in-app update leaves the two servers mismatched | Stage 0's version check: everything passed to Node |
| Tests that reach inside the Node server | Rewritten to HTTP as each area moves |
| Two accounts working at once | 2.3 |

---

## 6. For the owner to decide

1. ~~**Stage 0 first?**~~ Decided: yes, and built in v0.8.25.
2. ~~**Macs:**~~ Decided: the C# server built for macOS and run there (2.2), built in v0.8.29;
   existing Macs move by running the install line again.
3. ~~**Who does what:**~~ Decided (v0.8.37): stage 2 is this account's, as 2a (v0.8.37) and 2b
   (v0.8.38); stage 4's parts 1 to 4 are Claude B's (v0.8.39 on), in parallel. See 2.3.
4. ~~**Playback:**~~ Decided (after v0.8.47): playback whole, in one stage (stage 6), after
   everything else (stage 5); then Node removed (stage 7), the v0.9.0 candidate.
5. **When the Node copies go:** the rule in 2.4, or another? Decided meanwhile: no more work done
   twice; new server work is C# only (2.4).
6. ~~**Covers:**~~ Decided: ffmpeg, as `Covers.cs` already does (1f, built in v0.8.34).
7. ~~**The tag reader:**~~ Decided: C#'s only where the tag check has passed (or
   `TAG_READER=csharp`), until stage 7. The library scans go to the C# server on the same rule
   (v0.8.36).

---

## Appendix A: routes still answered by Node

(As of v0.8.26: the headphone profiles, the phone's download lists and plays, and Last.fm have moved since this list was first made.)

From the route list (`app.get/post/…` in `index.js` and `lib/server/`) checked against the C#
server's. Approximate: some routes are answered by C# only in some cases (for example, `/stream/`
and `/api/image/`).

- **Playback** (`api-playback.js`): `GET /api/zones`, `/api/outputs`, `/api/zone-state`, `/api/queue`,
  `/api/radio`, `/api/album/now-playing`, `/api/pick-unheard`, `/api/shortcut/zones`,
  `/api/shortcut/play-random`, `/api/shortcut/play-unheard`; `POST /api/control`, `/api/seek`,
  `/api/volume`, `/api/zone-settings`, `/api/pause-all`, `/api/mute-all`, `/api/group-outputs`,
  `/api/ungroup-outputs`, `/api/transfer-zone`, `/api/play`, `/api/play-track`, `/api/play-multi`,
  `/api/play-from-here`, `/api/play-unheard`, `/api/queue/remove`, `/api/queue/clear`,
  `/api/queue/move`, `/api/queue/play-history-next`, `/api/queue/history-multi`, `/api/radio`,
  `/api/output/standby`, `/api/output/convenience-switch`
- **The phone as a zone** (`api-phone.js`): `POST /api/phone/hello`, `/api/phone/state`;
  `GET /api/phone/commands`
- **Audio Devices** (`api-devices.js`): `GET /api/audio-devices`, `/api/audio-devices/:id`;
  `PATCH /api/audio-devices/:id`; `POST /api/audio-devices/rescan`, `/api/audio-devices/:id/forget`
- ~~**Qobuz and Tidal**~~: none left, C#'s whole since v0.8.47 (the catalogue v0.8.39; `/favorite`,
  `/unfavorite` and `/open` v0.8.44; `/api/settings/<svc>` signed in, `…/import` and `POST
  /api/services/watch` v0.8.45; signed out, `…/signin`, `…/signin/cancel`, `…/signout`,
  `…/disconnect`, `POST /api/<svc>/play` and the services' part of `GET /api/search/external`
  v0.8.47). `GET /internal/dash/:key` stays for a Node server alone, as do the Node copies.
- **Library** (`api-library.js`): `GET /api/status`, `/api/library/cleanup`, `/api/display/content`;
  `POST /api/library/cleanup` for the music folders (a service's C#'s since v0.8.44 where the scans
  are; the music folders, Rescan and Reindex C#'s since v0.8.34; a streamed album's `GET /api/album`
  since v0.8.44; the services part of `GET /api/search/external` since v0.8.47)
- **Admin:** `GET /api/update/status`, `POST /api/update/check`, `/api/update/apply` (registered in
  `api-playlists.js`); `GET /api/tagcheck`, `/api/tagcheck/report` (power and `/api/cpu` C#'s since
  v0.8.31)
- **Streams and pictures C# passes on:** `/stream/` for a `?g=` or `?o=` Express would read as an
  array or an object, 32-bit where ffmpeg can't write it, or an unsigned request from a speaker (a
  Qobuz or Tidal track's C#'s since v0.8.47, the Node server handing such a speaker's conversion and
  play report to C#); `/api/image/` for an album with no cover, a
  picture only `sharp` reads well, or an outside picture
- **Node's own:** `NOTIFY /upnp/event/:id` (`GET /api/health`, `/login`, `/display` and every deep
  link C#'s since v0.8.48; `/shelf` since v0.8.28)

## Appendix B: corrections found while surveying

- `docs/specs/roadmap-stages.md` says the image has ffmpeg 6.0. Debian 12's is 5.1 (this is what
  broke Measure ReplayGain; fixed in v0.8.24).
- `server/README.md` says "streams and covers still gated by Node". C# checks the signature or the
  device itself (`Streams.cs`); only what it can't check is passed on.
- `Streams.cs`'s header says the Opus stream is passed to Node; C# answers it (`Downloads.StreamOpus`).
- A comment in `api-library.js` names `lib/server/api-qobuz.js`, which is now `api-service.js`.
