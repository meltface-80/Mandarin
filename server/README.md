# Mandarin's server in C#

`mandarin-server` is Mandarin's server, being moved from Node.js to C# (.NET 10) one part at a
time, from v0.8.1 on.

## How it runs while the move is under way

The C# server is the front door. It takes Mandarin's port (`PORT`, 3500), answers the parts
already moved to C#, and passes everything else, as it came, to the Node server behind it. It
starts the Node server itself (`node launcher.js`, so in-app updates work as before) on a free port
on `127.0.0.1` that nothing else can reach, and stops when it stops.

- **Who is asking** goes through unchanged. The Node server tells home from away by the caller's
  address, believing `X-Forwarded-For` only from this machine (the built-in Tailscale speaks for the
  device behind it). The C# server works the caller out the same way and passes on only that, so no
  device can claim to be at home by sending the header itself.
- **Streams and held requests** pass straight through, as long as they last; request bodies have
  no size limit (a whole database restored from a backup).
- Every response says which server it came through (`X-Mandarin-Server: C# <version>`), and one
  C# wrote itself says so (`X-Mandarin-Answered: C#`). `GET /server-info` answers from C# itself.
  `test/front.test.js` pins which server answers what.
- **The library** is read here from a copy in memory, as the Node server keeps one. Which copy is
  current is the Node server's to say (it reads the library again when told of a scan or a change made
here, and still takes a few edits of its own): each library request asks
  it first, on a private address with a key this server gave it (`/internal/library`), and the
  copy here is rebuilt from the database when it changed, and checked every five seconds besides,
  so a screen seldom waits for the rebuild. On 20,000 albums a rebuild takes about half a second,
  as the Node server's own does; lists are sorted with ICU sort keys, computed once per rebuild. Names sort as JavaScript sorts them
  (ICU's collation, so the image carries libicu), and `test/library-front.test.js` asks both
  servers the same questions and checks the answers are the same.
- **Compression:** what C# answers itself goes out gzipped, as the Node server's did.
- **The database** is the Node server's (`<data>/musicd.db`), shared: the Node server makes it and
  brings its tables up to date first; C# opens it afresh for each request, so a database put back
  from a backup is the one read next.

- **Kept at the Node server's version** (v0.8.25): each release carries this program for
  `linux-x64` and `linux-arm64` with their SHA-256 sums (`release.yml`). An update from Settings
  brings the Node server's files; the Node server, started by a C# server of another version,
  fetches the matching program, checks its sum and that it runs (`mandarin-server --version`),
  renames it over the running one and stops with code 76 (`lib/server/csharp-update.js`). This
  server then starts itself again from the new file in the same process (`execv`, `Front.cs`);
  one from before v0.8.25 stops, and Docker's restart policy starts the container again. Twice
  at most for a version. Until the two match, this server answers nothing but `/server-info` and
  passes everything to the Node server (which has every part), and the Node server keeps the
  background work (`/internal/front/runs` turns down another version). `test/csharp-update.test.js`.
  - From v0.8.29 the update fetches and checks this program of the new version *before* it stages
    the Node server's files, and stops with nothing changed if it can't be had (`prepare`,
    `lib/updater.js` `beforeApply`); the new Node server finds it in place and only asks for the
    start again. `test/update-prepare.test.js`.
- **On a Mac** (v0.8.29): built for `osx-arm64` and `osx-x64` on GitHub's Mac runners (signed ad
  hoc, as macOS needs), carried by each release, and started by launchd in front of the Node server
  as in the image (`tools/mac/install.sh`). The scan's file system calls take macOS's forms
  (`Scan/NodeFs.cs`), "libc" is libSystem, and `nice` is all `Cpu.cs` has there. CI runs the whole
  suite through it on a Mac runner.
- **All server work is done here** (the owner's decision, v0.8.29): the Node copies of parts already
  moved are kept as they are and changed no more, and an area the Node server still owns moves here
  before it is changed (`docs/specs/csharp-migration.md`, 2.4).

When nothing is passed on any more, the Node server, and Node itself, leave the image.

## What has moved

| Part | Where it is |
|---|---|
| The port, who is asking, the Node server's start and stop | C# (v0.8.1) |
| Signing in, signed-in devices, the gate (`Auth.cs`, `Srp.cs`) | C# (v0.8.2); streams and covers still gated by Node |
| The page and its files, `public/` (`Pages.cs`) | C# (v0.8.3); Shelf's page, `/shelf`, C#'s since v0.8.28; deep links, `/login`, `/display` still Node's |
| Reading the library: the Library wall and its Focus sheet, search, artists, an album's page, genres, decades, the random wall, Favourites, Listen later (`Library.cs`, `LibraryRoutes.cs`, `Names.cs`) | C# (v0.8.4); scans, edits, hearts, labels, Home's rows and a streamed album's page still Node's |
| Music files sent as they are, with ranges, to signed-in devices and signed addresses (speakers) (`Streams.cs`) | C# (v0.8.9) |
| Conversions already made, from the cache (the 24/48 rule and a streamer's rate and depth) (`Streams.cs`) | C# (v0.8.10) |
| Making conversions with ffmpeg, sent as they're made; the next tracks made ahead, handed over by the Node server; the cache kept under its size (`Transcoder.cs`) | C# (v0.8.11); DSP, ReplayGain, 32-bit, Qobuz and Tidal still Node's |
| The phone's downloads (Original or Opus 256) and its Opus stream away from home, the album's next tracks made ready (`Downloads.cs`) | C# (v0.8.12); the album's download list (with ReplayGain), automatic downloads, the phone's albums refreshed and its offline plays C#'s since v0.8.26 (`DownloadListRoutes.cs`), the covers' addresses signed as the Node server signs them, at the address it gives speakers |
| Your own playlists: the list, one, making, renaming, deleting, adding tracks or albums (`PlaylistRoutes.cs`) | C# (v0.8.8); sharing a playlist as text C#'s since v0.8.21 |
| Library changes: hearts, Listen later, label merges, Record labels on or off and their folder depth (`LibraryChanges.cs`), the Node server told (`/internal/library/changed`) | C# (v0.8.16); album edits C#'s since v0.8.22 |
| Settings only kept and read: the wall display, Smart Picks' switch and hour, Home's rows; dynamic playlists (`SettingsRoutes.cs`) | C# (v0.8.7); the waveform switch C#'s since v0.8.19, the share links' since v0.8.21; Dynamic Playlists saved and deleted, and the tag filter, since v0.8.22 |
| Home's rows: Album of the day, Label of the week, Recently played, Not played lately (`HomeRoutes.cs`) | C# (v0.8.6); the day and week are the Node server's clock's, told with the library's state; Smart Picks C#'s since v0.8.20 |
| Covers already drawn and label logos, to signed-in devices and signed addresses (`Images.cs`) | C# (v0.8.5); drawing a cover the first time C#'s since v0.8.22 (below); a speaker asking by its own address still Node's |
| Drawing a cover the first time, from the album's own picture (a found cover, its folder's, or its tracks' front cover), with ffmpeg as sharp draws it (`Covers.cs`) | C# (v0.8.22); an album with no cover (its drawn one) and a picture from elsewhere (a station's, a Sonos queue's, Last.fm's: "u-" keys) C#'s since v0.8.34 (`CoversDrawn.cs`); a picture only sharp reads well (CMYK, a colour profile other than sRGB, cut short) and a speaker asking by its own address still Node's |
| Reading tags: the scanner's reader (music-metadata as `scanner.js` uses it), copied to the letter (`Tags/`) | C# (v0.8.13), checked against the scanner's on the library itself (Settings → Library Scanner) |
| The scan's tags: a folder's new and changed files read together, one on each core playback doesn't keep, at the lowest priority (`Tags/TagReader.cs` ReadAll) | C# (v0.8.14), once the check has read every file the same both ways; read inside the C# scan since v0.8.18 |
| The library scan: the folders walked, names from folders and files, albums grouped, the database written, covers chosen, moved files recognised, nothing removed in a hurry (`Scan/`, `mandarin-server scan`, a process of its own) | C# (v0.8.18), on the cores playback doesn't keep, once the tag reader is trusted (the tag check passed, or `TAG_READER=csharp`); from v0.8.34 started by this server where it is |
| When to scan and the music folders (`Scans.cs`, `ScanRoutes.cs`, `Mounts.cs`): the timer (`SCAN_INTERVAL_HOURS`), the folders watched (a change read once quiet for 20 s, at most once a minute), Rescan, Reindex, Settings → Music folders and its folder picker, Forget folder, `/api/music-mount`, `/api/search-status`; the Node server told how each scan goes, for its copy of the library and `/api/status` | C# (v0.8.34), handed over as the job "scan" where the Node server's own scans would already be made by the C# program (v0.8.36: the tag check passed, or `TAG_READER=csharp`; else they stay the Node server's); Clean up still Node's (Qobuz's and Tidal's albums are) |
| The identification scan: what the files carry, MusicBrainz and iTunes asked, the releases scored, names applied, proposed or undone; Settings → Identify albums and the album editor's Find match (`Identify/`, `IdentifyRoutes.cs`) | C# (v0.8.19), handed over by the Node server when it starts, and again whenever it starts again (`Jobs.cs`, `/internal/front/runs`); the scorer held to the Node server's (`mandarin-server score`) |
| The MusicBrainz pack: what's published, downloaded and checked, moved to another folder, kept up to date (`Identify/Pack.cs`) | C# (v0.8.19) |
| Measuring loudness for files without ReplayGain tags (`Identify/Loudness.cs`) | C# (v0.8.19), on the cores playback doesn't keep, in the identification scan's hours and after it, album by album (v0.8.24); the gain each device gets still Node's |
| Waveforms for the progress bar: decoded, kept, sent (`Waveforms.cs`) | C# (v0.8.19) |
| MusicBrainz's one request a second, for both servers (`Identify/Lookups.cs`, `/internal/mb/slot`) | C# (v0.8.19); the write-ups and an album page's own release day asked by this server too since v0.8.21 |
| Record labels: the Labels wall, a label's albums, labels looked up for albums without one (MusicBrainz, then Discogs), logos (Discogs, FanArt.tv, or chosen by hand), the scan log, the Discogs and FanArt.tv keys (`Extras/LabelLookup.cs`, `Extras/LabelLogos.cs`, `LabelRoutes.cs`) | C# (v0.8.20), handed over by the Node server (`Jobs.cs`) |
| Release days: the day of albums tagged only to the year, from MusicBrainz after each library scan (`Extras/ReleaseDays.cs`) | C# (v0.8.20); the Node server says when a scan ends (`/internal/jobs/after-scan`); an album page's day at once C#'s since v0.8.21 |
| Smart Picks, the map of acts near what you play, the share card's suggestions from Deezer with their links (`Extras/Taste.cs`, `Extras/Similar.cs`, `Extras/ShareLinks.cs`, `TasteRoutes.cs`) | C# (v0.8.20), held to the Node server's (`mandarin-server score`); the plays still written by the Node server, which plays |
| A record's write-up and links: an album's year and release day, Wikipedia's words, Pitchfork's score, the artist's story, Qobuz's label and year, where to hear it and read about it; an artist's story; Pitchfork's lists, a review's record in the library and the search's Pitchfork part; the link that opens the Qobuz app; the share card's settings (`Extras/WriteUps.cs`, `Extras/WriteUpSources.cs`, `Extras/PitchforkLists.cs`, `WriteUpRoutes.cs`) | C# (v0.8.21), held to the Node server's (`mandarin-server score`); the wall display's page and the search's services still Node's |
| A playlist shared as text and one imported, the MDRP1 blob read as the Node server's zlib reads it (`Extras/ShareBlob.cs`, `ShareRoutes.cs`) | C# (v0.8.21), held to the Node server's (`mandarin-server score`) |
| The album editor: its view, a title, artist or year and a cover from an address laid over the scan, undone; the search for a missing cover (Apple Music, Deezer, MusicBrainz) (`AlbumEditRoutes.cs`, `Extras/ArtFind.cs`) | C# (v0.8.22), held to the Node server's (`mandarin-server score`); a cover only sharp reads well passed to the Node server as it came |
| Backup & restore: made, kept, listed, downloaded, restored and deleted, the file written and read as `lib/backup.js` does (`Admin/Backup.cs`, `AdminRoutes.cs`) | C# (v0.8.22), held to the Node server's (`mandarin-server score`); the Node server started again after a restore (`/internal/front/restart`) |
| Built-in Tailscale: its engine fetched, started, watched and stopped; signing in and out; on or off (`Admin/Tailscale.cs`) | C# (v0.8.22), handed over by the Node server (`Jobs.cs`); it stays up while the Node server restarts |
| Shelf's list: the whole library in artist order, each album's genres, the letter it is filed under and its year, with Mandarin's version, and "the same" for a signature still current (`ShelfRoutes.cs`) | C# (v0.8.23; the year since v0.8.27, the version since v0.8.28), held to the Node server's in `test/library-front.test.js`; the page itself C#'s since v0.8.28, so Shelf asks the Node server only for playback (`test/shelf.test.js` checks) |
| Last.fm, read-only: the key (saved, or `LASTFM_KEY`) and its check, similar artists and similar albums with whether each is in the library, one call at a time a quarter of a second apart, remembered a week (`Extras/Lastfm.cs`, `LastfmRoutes.cs`) | C# (v0.8.26), its address and the environment's key handed over by the Node server (`Jobs.cs`); Last.fm's pictures (`u-` keys) still drawn by the Node server |
| Headphone profiles from AutoEq: the index fetched once a day and searched, a profile fetched once and kept, one pasted by hand read (`Extras/AutoEq.cs`, `DspRoutes.cs`) | C# (v0.8.26), held to the Node server's reading of AutoEq's files (`mandarin-server score`); saving a profile to a device (Audio Devices) still Node's |
| The processor shared out: this server's threads and conversions kept off playback's cores (`Cpu.cs`) | C# (v0.8.13); the split is decided by the Node server (`lib/cpu.js`) and told with the library's state |
| Restart and Shut down (the side menu's power button), what this install can do, and the processor split for Settings → Library Scanner (`PowerRoutes.cs`) | C# (v0.8.31), where this server started the Node server (an install). Restart starts both again, this one in its same process as after an update; Shut down stops both (on a Mac the login item is unloaded; not in Docker). The split is still decided by the Node server until playback moves |
| An album's booklets: the PDFs in its folder, and their pages drawn as pictures for the album page's book button (`Booklets.cs`, `BookletRoutes.cs`; poppler's pdfinfo and pdftoppm) | C# alone (v0.8.33): new with this server, the Node server has none |
| The audio engine for sound devices on the server | C# (v0.8.0, `engine/`) |
| Everything else | Node, behind the C# server |

## Building and testing

`./build.sh` builds `server/bin/mandarin-server` for the machine it runs on (Linux or a Mac; `RID=`
for another): one self-contained file, no .NET needed where it runs (needs the .NET 10 SDK to build).

`MANDARIN_FRONT=1 npm test` runs the whole suite with every test's server behind the C# server, as
in the image (`test/setup.js`). CI runs it that way on Node 22 and directly on Node 20, and through
the C# server on a Mac; all must pass. A part moves to C# only when the suite still passes both ways.
