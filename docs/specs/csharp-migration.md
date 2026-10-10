# Mandarin: moving the server to C#

**Status: a draft for the owner, 9 October 2026.** Stage 0 is built (v0.8.25), stage 1's parts a to c (v0.8.26), d (v0.8.31), and e and most of f (v0.8.34); Shelf's page (v0.8.28, below); the C# server on Macs, and updates that bring both servers together (v0.8.29). **From v0.8.29, new server work is done in C# only** (2.4). It is written from
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
Tailscale, and from v0.8.34 the library scans) is handed over to it each time the Node server starts
(`/internal/front/runs`). `server/README.md` has the details.

### In numbers

| | |
|---|---|
| HTTP routes the Node server registers | about 210 |
| answered by C# | about 120 |
| still passed to Node | about 90 (listed in the appendix) |
| Node code, `lib/` | about 23,500 lines (this includes the Node copies of parts already moved) |
| C# server, `server/Mandarin.Server` | about 27,100 lines |
| C# audio engine, `engine/` | about 930 lines (a program of its own, already C#) |
| Tests | 83 files; the suite passes both ways (Node alone, and behind C#) |

### Already in C#

The front door, signing in, the page and its files, reading the library (walls, search, album
pages, Home's rows, filters), playlists, settings, hearts and Listen later, covers already drawn
and drawn from an album's own picture, music files sent as they are, conversions without DSP or
gain, the phone's downloads and its Opus stream, tag reading, the library scan itself,
identification, the pack, measuring loudness, waveforms, record labels, release days, Smart Picks,
write-ups, sharing, the album editor, backups and built-in Tailscale; from v0.8.39, browsing
Qobuz's and Tidal's catalogue.

### Still Node's, by area

| Area | Routes | Main Node files (lines) | Talks to | Size, risk |
|---|---|---|---|---|
| **Playback**: rooms, transport, queue, grouping, radio, the phone as a zone | 35 | `lib/sonos/*` 2,200, `lib/renderers/*` 2,060, `lib/local/*` 920, `api-playback.js` and `playback.js` 750, radio and plays 520 | Sonos (SOAP on port 1400), SSDP multicast, UPnP renderers (SOAP, GENA events), LinkPlay, the audio engine, the Android app's long poll | **Large, highest risk** |
| **Conversions Node still makes**: ReplayGain (`?g=`), DSP (`?o=`), 32-bit, Qobuz and Tidal | the `/stream` cases C# passes on | `lib/stream.js` 546, `lib/dsp.js`, `public/biquad.js` | ffmpeg; the transcode folder shared with C# | Medium |
| **Qobuz and Tidal**: sign-in, import, favourites, opening and playing, their streams (browsing C#'s since v0.8.39) | about 22 | `lib/services/*`, `lib/qobuz/*`, `lib/tidal/*` 1,600 | qobuz.com, tidal.com (OAuth, DASH) | Large |
| **Audio Devices and DSP**: the device register, per-device settings, headphone profiles | 8 | `lib/renderers/devices.js`, `registry.js`, `profiles.js`, `lib/autoeq.js`, `api-devices.js`, `api-dsp.js` 1,000 | AutoEq on GitHub; live player state | Medium (writes re-plan live queues) |
| **Library housekeeping**: when to scan (timer, folder watcher, Rescan), music folders, clean-up, `/api/status`, the wall display's content, a streamed album's page | 13 | `lib/server/api-library.js` (parts), `lib/library/watch.js`, `lib/server/mounts.js`, `lib/library/index.js` | the file system | Medium |
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
  The scan now reads tags with C#'s reader whatever the tag check says, unless the server is
  started with `TAG_READER=node`, which keeps the scans the Node server's. Clean-up stays the Node
  server's while Qobuz's and Tidal's albums are (stage 4).
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

### Stage 3: the conversions Node still makes (M)

1. **ReplayGain streams (`?g=`):** C# adds the volume filter and the `-g` cache name, written
   exactly as JavaScript writes the number.
2. **32-bit:** the probe for ffmpeg's 32-bit FLAC, then 32 bits accepted.
3. **DSP (`?o=`):** the device's DSP read from `audio_devices` when the device fetches, the filter
   graph from stage 2, and playback's second core while DSP runs.

After this, Node converts only Qobuz and Tidal tracks.

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
3. Import, the favourites watch and the service playlists, as a job handed over.
4. Sign-in and sign-out. **The C# server alone refreshes Tidal's token** from then on: with two
   refreshing at once, one can be left holding a token that no longer works.
5. Their streams: fetch, copy or convert, Tidal's DASH fed to ffmpeg directly (no loopback
   route), Qobuz's play reports.

Playing a service album stays a call into Node's playback until stage 6.

### Stage 5: Audio Devices, the writes (S to M)

Plain settings (name, hidden, sharing, output, DSP, levelling, the user's rates) written by C#.
Node is then told (`/internal/devices/changed`) so it re-reads its names and re-plans what is
playing. The device list stays Node's, because it shows live state, until stage 6.

### Stage 6: playback (L, several versions)

The largest stage and the riskiest: about 6,600 lines of Node, the Sonos queue's exact command
order and timing, multicast discovery under Docker's host networking, renderer events, gapless
arming that waits for a conversion to finish, and the phone's protocol that installed apps
depend on.

The zone hub serves every kind of player at once (Sonos, renderers, sound devices on the server,
phones), with one state, one revision for the long polls, and shared history and radio. Splitting
it by kind would need a protocol between the two processes that is thrown away afterwards.

**Proposed: the whole hub ported behind a switch** (`PLAYBACK=csharp`, off by default), built up
over several versions, each a kind of player:

1. the hub, the queue store, the phone as a zone (no device I/O), history, plays and the radio;
2. Sonos: discovery, topology, control, the queue on the speaker (with the copy of it the Node
   server keeps since v0.8.35, read again only when the speaker's UpdateID moves);
3. UPnP renderers: discovery, GENA (C# answers the events itself), gapless, LinkPlay;
4. sound devices on the server: the engine's driver (the engine is already C#), ALSA's list;
5. the device list and `/api/status`'s rooms.

While the switch is off, Node plays, as now. CI runs the playback tests with the switch on as each
kind lands. The owner tries the switch on their own server and household. The default flips once
every kind is in, and Node's playback is kept for one release as the fallback.

The alternative is to move the read-only state first (rooms, the queue, the long poll), then each
kind, with Node and C# sharing zone state over a private protocol. That gives more, smaller steps,
but each one changes playback at home, and the protocol is extra code to write, test and then
remove.

### Stage 7: Node leaves (M to L)

- **The last routes:** `/login`, `/display`, deep links, `/api/health`, the event callbacks.
  (`/shelf` moved in v0.8.28: Shelf now asks the Node server only for playback, which moves in
  stage 6, with play-track's `only` and the room's `queue_items_remaining` that v0.8.27 added.)
- **The database's tables and migrations** move to C#. Today `lib/library/db.js` and the
  `Features` constructor create every table; C# creates none.
- **The updater and launcher** move to C#, and the C# tag reader is used everywhere.
- **The image** drops Node (its health check uses `node -e` today) and the npm packages
  (`better-sqlite3`, `sharp`, `music-metadata`, `express`).
- **Macs** run the C# server alone.
- **The Node copies** of every part are deleted (2.4), and CI's Node-alone run goes.
- **The tests stay in JavaScript** (`node:test`), with Node in CI only, but every test drives the
  server over HTTP. Many reach into the Node server today (`ctx.playback`, `ctx.zones`,
  `ctx.devices`, `ctx.services`, `ctx.loudness`…) and are rewritten as their area moves.

### The order, and why

0 first, because everything after it is wasted on in-app updates without it. 1 next: small,
independent, and it builds pieces later stages need (URL signing, the ReplayGain sums). 2 before
3 and 6, so the hard logic is proven before it runs. 3 before 4, because the services' streams
use the conversions. 4 and 5 before 6, so playback is the last thing standing. 7 last.

---

## 5. Risks, and what answers each

| Risk | Answer |
|---|---|
| The Sonos queue's order and timing (play now, play next, batches of 16, re-planning a playing queue) | Stage 2's ports; `test/fake-sonos.js` extended; the switch, tried at home before the default flips |
| DIDL and SOAP bytes Sonos is picky about | Byte-for-byte parity in stage 2 |
| The phone's long poll (one shared `seq`, trimming to `sync`, 45 s presence); apps already installed | Unchanged shapes; `phone.test.js` run against both; Android's own `PhoneTest.kt` |
| Multicast discovery and GENA under Docker's host networking | The interface ranking ported as is; checked on the owner's household before the default flips |
| Two servers converting into one transcode folder | Identical cache names (stage 2); one writer per name |
| Tidal's token refreshed by two processes | One owner from stage 4 step 4 |
| An in-app update leaves the two servers mismatched | Stage 0's version check: everything passed to Node |
| Tests that reach inside the Node server | Rewritten to HTTP as each area moves |
| Two accounts working at once | 2.3 |

---

## 6. For the owner to decide

1. ~~**Stage 0 first?**~~ Decided: yes, and built in v0.8.25.
2. ~~**Macs:**~~ Decided: the C# server built for macOS and run there (2.2), built in v0.8.29;
   existing Macs move by running the install line again.
3. **Who does what:** which account takes which stage; one stage in flight per account (2.3).
4. **Playback:** the whole hub behind a switch (recommended), or the read-only state first and
   then each kind of player?
5. **When the Node copies go:** the rule in 2.4, or another? Decided meanwhile: no more work done
   twice; new server work is C# only (2.4).
6. **Covers:** ffmpeg as now, or an image library for what `sharp` still draws (1f)?
7. **The tag reader:** keep using C#'s only where the check has passed, until stage 7 (as now), or
   make it the only one sooner?

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
- **Qobuz and Tidal** (`api-service.js`, for each of `qobuz` and `tidal`): `GET` and `POST
  /api/settings/<svc>`, `POST …/signin`, `…/signin/cancel`, `…/signout`, `…/disconnect`,
  `…/import`; `POST /api/<svc>/favorite`, `/unfavorite`, `/open`, `/play` (the `GET` catalogue
  routes C#'s since v0.8.39);
  `POST /api/services/watch`; `GET /internal/dash/:key`
- **Library** (`api-library.js`): `GET /api/status`, `/api/library/cleanup`, `/api/display/content`;
  `POST /api/library/cleanup`; a streamed album's `GET /api/album`; the services part of
  `GET /api/search/external` (the music folders, Rescan and Reindex C#'s since v0.8.34)
- **Admin:** `GET /api/update/status`, `POST /api/update/check`, `/api/update/apply` (registered in
  `api-playlists.js`); `GET /api/tagcheck`, `/api/tagcheck/report` (power and `/api/cpu` C#'s since
  v0.8.31)
- **Streams and pictures C# passes on:** `/stream/` with `?g=` or `?o=`, 32-bit, a Qobuz or Tidal
  track, or an unsigned request from a speaker; `/api/image/` for an album with no cover, a
  picture only `sharp` reads well, or an outside picture
- **Node's own:** `NOTIFY /upnp/event/:id`, `GET /api/health`, `/login`, `/display`, and every deep
  link (`/shelf` C#'s since v0.8.28)

## Appendix B: corrections found while surveying

- `docs/specs/roadmap-stages.md` says the image has ffmpeg 6.0. Debian 12's is 5.1 (this is what
  broke Measure ReplayGain; fixed in v0.8.24).
- `server/README.md` says "streams and covers still gated by Node". C# checks the signature or the
  device itself (`Streams.cs`); only what it can't check is passed on.
- `Streams.cs`'s header says the Opus stream is passed to Node; C# answers it (`Downloads.StreamOpus`).
- A comment in `api-library.js` names `lib/server/api-qobuz.js`, which is now `api-service.js`.
