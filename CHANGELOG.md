# Changelog

Versioning: each set of changes is a development build and takes the next third digit
(0.3.0, 0.3.1, 0.3.2 …). The second digit moves only when the project owner says so.
`package.json`, the README title, the GitHub Pages badge and the Android app's
`versionName` (plus `versionCode`) move together — `npm test` fails if they don't.

## v0.8.27
A test build, from the `shelf-rouen-1.9.7` branch. It is built on v0.8.26 (`stage1-small-parts`), so
that one goes in first. Shelf gets Rouen's Shelf work since v1.9.3 (Rouen v1.9.4 to v1.9.7), plus
decades and previous/next buttons, which are Mandarin's own.

- **Choosing tracks on the back of the case** (Rouen v1.9.4).
  - Turn the front cover over, then hold a track to choose it; its number becomes a tick. Tap more
    to add them, or tap a chosen one to take it away. With a mouse, Ctrl/⌘-click chooses one and
    Shift-click a run.
  - **Play now**, **Play next** and **Queue** sit under the cover while tracks are chosen. Play now
    plays the first chosen track and queues the rest behind it; Play next and Queue keep album
    order, whatever order you chose them in.
  - Turning the case back, or moving the shelf, ends the choosing.
- **A set's discs each have their own heading**, numbered from 1 (Rouen v1.9.4).
- **A list too long for the back of the case unfolds into a booklet** below it, with pages for a box
  set: ‹ › or Page Up / Page Down (Rouen v1.9.4).
- **The queue** (Rouen v1.9.5).
  - A pane on the right shows what the zone in the bar will play, from the track playing on. Tap a
    track for **Play from here**.
  - It folds away to the right edge by its own tab. The choices on the left fold away the same
    way, by a tab on the left edge. Each device remembers both.
  - Rouen v1.9.6's fix is included: the left tab can be reached on an iPad and a TV.
- **Bigger covers with the panes folded away** (Rouen v1.9.7). The spinning disc and the popup's ×
  are centred properly.
- **Decades.** A **Years** tab sits beside Genres, Artists and Random.
  - It lists the decades your albums are from, newest first, then **Undated** for albums with no
    year.
  - Decades combine with each other ("the 1960s or the 1990s"), and narrow genres and letters as
    those narrow them. Each tile counts what your other choices leave.
  - Random shuffles what you've chosen, decades included.
- **Previous and next** on the bar at the shelf's foot, either side of play/pause.
  - Each is off when the zone can't do it; for example, next at the end of the queue.
  - Each does exactly what the remote's own previous and next buttons do. On a Sonos room or a
    renderer, previous goes back to the start of the track first when it's more than five seconds
    in.
  - The bar shows the new track when the zone moves to it. If the zone refuses, it says why.
- **The help popup** also explains choosing tracks and the edge tabs. It shows once after this
  update, unless you ticked "Don't show again".
- **What the servers send**, the same from both (checked in `test/library-front.test.js`):
  - `/api/shelf/albums` gives each album's year.
  - `/api/album` gives each track's disc number on an album with more than one disc.
  - The zone's state says how many tracks are left in its queue.
  - `/api/play-track` takes `only: true`, which Shelf's chosen tracks use: Play now plays that
    track alone. A track tapped on the album page still plays the rest of the album after it.
- **Tests** (`test/shelf.test.js`, in Chromium, both ways):
  - decades;
  - choosing and playing tracks, against a fake Sonos room;
  - previous and next, against the same room;
  - the queue pane, the disc headings and the lane's fold.
- The Android app for this version is 0.8.27 (version code 227). Nothing in it changed.

## v0.8.26
A test build, from the `stage1-small-parts` branch: stage 1 (parts a to c) of the move to C#
(`docs/specs/csharp-migration.md`). Three more parts of the server are now answered by the C#
server. Nothing looks or works differently.

- **Last.fm moves to the C# server.** The key in Settings → Setup → API Keys (or `LASTFM_KEY`),
  its check, and the album view's similar artists and similar albums.
  - One call at a time, a quarter of a second apart, as Last.fm asks.
  - Answers are kept for a week.
  - Whether each suggestion is in your library is decided as before.
  - Last.fm's pictures are still drawn by the Node server.
- **Headphone profiles move too.** Settings → Audio Devices → a device → DSP: searching AutoEq,
  fetching a profile (kept for good), and reading one you paste. AutoEq's files are read exactly
  as before; the C# server is checked against the Node server's reading of them, on awkward
  files as well. Saving a profile to a device is still the Node server's.
- **The phone's download lists move too.**
  - An album's download list, with each track's size and ReplayGain numbers.
  - Automatic downloads: Smart Picks, the Album of the day and the newest albums.
  - The phone's downloaded albums refreshed with their current titles and covers.
  - Plays made on the phone with no server, written to your history.
  - The downloads themselves were already made by the C# server.
- **Checked against the Node server's answers:** every album's download list at each quality, the
  automatic downloads, the album lists and the plays (`test/library-front.test.js`). Which server
  answers is pinned in `test/front.test.js`.
- **The Docker image's base images come through Google's mirror of Docker Hub**
  (`mirror.gcr.io/library/golang`, `…/node`). They're the same images; the change avoids Docker
  Hub's limit on anonymous downloads, which failed the image build on GitHub's runners ("429 Too
  Many Requests"). Microsoft's .NET images still come from Microsoft.
- The Android app for this version is 0.8.26 (version code 226). Nothing in it changed.

## v0.8.25
A test build, from the `stage0-csharp-updates` branch: stage 0 of the plan for the rest of the move
to C# (`docs/specs/csharp-migration.md`, on the `migration-plan` branch). In-app updates now bring
Mandarin's C# server too.

- **Updating from Settings now updates the C# server as well.** Until now an update from the app
  brought the Node server's files only; the C# server came only with a new Docker image, so it
  could be left several versions behind. That's why v0.8.24's ReplayGain fix needed `docker pull`.
  - Each release now carries the C# server for x64 and ARM64, with their SHA-256 sums.
  - Once an update is running, the server sees that the C# server in front of it is another
    version. It fetches the right one for your machine, checks its sum and that it runs and says
    the right version, puts it in place, and restarts once more with it.
  - From this version on, the C# server restarts itself in place. The first time, the C# server
    in your image (older than this) can't, so it stops and Docker's restart policy starts the
    container again: `--restart unless-stopped` in the README's `docker run`, or
    `restart: unless-stopped` in `docker-compose.yml`. Without one, start it again yourself
    (`docker start musicd-server`).
  - It's tried twice at most for a version, so a C# server that won't start can't keep the server
    restarting. If GitHub can't be reached, it's tried again every half hour, six times at most.
    Settings shows the C# server's version beside Mandarin's while it isn't the same.
- **Never answered the old way.** While the two servers are different versions, the C# server
  answers nothing but its own `/server-info` and passes everything to the Node server, which has
  every part. The background work it would take over (identification, loudness, labels, Smart
  Picks and the rest) stays with the Node server until the matching C# server is running.
  Built-in Tailscale is the exception: if the C# server already runs its engine, it is left
  running, and the Node server doesn't start a second one on the same folder.
- `mandarin-server --version` says its version. `/api/health` and the update status say which C#
  server is in front, and whether it matches.
- On a Mac nothing changes: the Mac runs the Node server alone, and in-app updates are all it needs.
- Turn it off with `MANDARIN_SERVER_UPDATE=0`.
- New test: `test/csharp-update.test.js`. GitHub and the C# server in front are stood in for; the
  C# server's own part, starting itself again in the same process, is run for real.
- The Android app for this version is 0.8.25 (version code 225). Nothing in it changed.

## v0.8.24
A test build, from the `replaygain-fix` branch: Measure ReplayGain fixed, and run by the schedule,
after identification.

- **Fixed: Measure ReplayGain measured nothing.** Every file came back "couldn't be read", because
  the server asked ffmpeg for an option (`framelog=quiet`) that ffmpeg 5.1, the one in Mandarin's
  Docker image, doesn't have; newer ffmpegs do, which is why the tests didn't notice. It now asks in
  a way every ffmpeg since 4 understands. It wasn't the move to the C# server: the C# server
  measured as the Node server did, and both asked the same thing.
- **Files that couldn't be read are measured again, once**, as they failed because of the option,
  not themselves. A file that fails now stays failed, as before.
- **In Docker, pull the new image for this fix.** There the measuring is done by the C# server,
  which comes with the image: `docker pull`, then re-create the container. Settings → Updates
  alone brings the Node server's half only, and the image's C# server goes on measuring the old
  way. On a Mac, which runs the Node server alone, Settings → Updates is enough.
- **Measure ReplayGain keeps to the schedule.** With Scheduling on, it measures only between the
  start and end times (01:00–06:00 unless you changed them) and not at all outside them; with
  Scheduling off, whenever, until every file is done. Either way it waits while the library is
  being scanned.
- **One album at a time, after identification.** Within the hours the library scan comes first,
  then identification, then ReplayGain: albums are measured one at a time, newest additions first,
  each once identification has looked at it, so the two run side by side, measuring a little
  behind. When identification can't go on (switched off, finished, or MusicBrainz not answering),
  measuring carries on with any album.
- **Qobuz and Tidal tracks are no longer counted as "to measure".** They have no file on the server
  and were never measured; the page now says how many there are instead.
- **Settings → Library Scanner, regrouped.** The schedule comes first, with a line saying what is
  happening now (identifying which album, measuring which, or what it's waiting for), then
  Identify albums with the MusicBrainz pack and its progress, then Measure ReplayGain with its
  counts and what it's doing. The rest of the page is as before.
- The CI's Docker check now measures a file inside the image, so an ffmpeg that refuses the options
  is caught before a release.
- New tests in `test/loudness.test.js`: the hours, the order, measuring again once, the counts, and
  the same ffmpeg options on both servers.
- The Android app for this version is 0.8.24 (version code 224). Nothing in it changed.

## v0.8.23
A test build, from the `desktop-offline` branch, which carries the `shelf` and `offline-mode`
branches: Shelf, the album view's More by and Last.fm suggestions, Random Album's choice and the
radio's six-month rule (from Rouen, MusicD Remote v1.9.2–v1.9.3), and offline shown by a symbol in
the top bar rather than a notice.

- **New: Shelf.** Flick through your collection as through a record shop's shelf, on a tablet on a
  stand or a TV: **☰ → Shelf**, `/shelf`, or **Shelf ›** on the wall display.
  - On the left, choose genres and artists' letters (A–Z, #, 1–9). Each tile counts what choosing it
    would leave. **Random** shuffles the shelf; **Spin** lands somewhere three seconds later.
  - On the right, the shelf in three looks: covers, spines (with letter tabs) or a carousel. Swipe
    for one album, swipe and hold to keep turning, flick to spin. Tap the front cover to turn the
    case over and read its track list.
  - **Play now**, **Play next** and **Add to queue** for the album in front. Along the foot, the
    remote's mini player, fixed and flat: play/pause, the zone, the volume, and a tap on the record
    brings it to the front of the shelf.
  - It does not zoom, and how it moves is said once, in a popup the first time you open it (and
    after each update, until you tick "Don't show again").
  - The whole library is sent once, by the C# server; the page filters it itself.
- **New: under an album's review**, more by its artist, the albums they appear on, and — with a
  Last.fm key in **Settings → Setup → API Keys** (or `LASTFM_KEY`) — similar artists and similar
  albums from Last.fm. Ones in your library open here; the others say "Last.fm ↗" and open there.
  Read-only: nothing is scrobbled, and only the artist's name is sent.
- **Random Album now chooses, then asks.** The disc turns, an album is chosen, and a popup offers
  **Play now**, **Play next** or **Queue**. Nothing plays until you choose. Apple Shortcuts still
  play at once.
- **Random Album Radio doesn't repeat itself within six months.** An album the radio played isn't
  played by the radio again for six months (albums you play yourself don't count). With
  everything played, the one it played longest ago comes round first. The memory is kept in the
  database, so it survives a restart and travels with a backup.
- A backup now carries the Last.fm key with the other keys, on both servers.
- Not needed here: Rouen's v1.9.2 fix (an album opened at a position in the wrong list) can't happen
  in Mandarin, whose albums keep their own ids. Smart Picks already never adds anything by itself.
- **Offline in the Android app: a symbol, not a notice.** The line across the top of the screen
  saying the server can't be reached (or that Offline mode is on) is gone. In its place, an offline
  symbol in the top bar, between the menu and the magnifying glass. Tap it to see what the matter
  is: Mandarin can't be reached (and what to check), or Offline mode is on — with a button to
  switch it off. Only the page changes: the app shows it as soon as it has fetched the page from
  the server once.
- **A browser that can't reach the server: the same symbol, not a notice.** "Can't reach
  Mandarin — check the container is running" across the top of the page is gone. The top bar's
  offline symbol shows instead, and a tap on it says what the matter is and what to check.
  It goes away by itself as soon as the server answers.
- **It comes sooner.** The page used to look for the server once a minute while all was well, so
  the notice could take over a minute to appear. Now any of the page's own requests that finds no
  server starts the looking at once: the symbol shows within about 25 seconds (never for a
  moment's blip), and it still waits while an update restarts the server.
- New tests: `test/shelf.test.js`, `test/lastfm.test.js`, `test/radio-memory.test.js`,
  `test/random-pick.test.js` and `test/offline-indicator.test.js`, and Shelf's list asked of both
  servers in `test/library-front.test.js`.
- The Android app for this version is 0.8.23 (version code 223). Its offline symbol needs no new
  app: the app shows it once it has fetched the page from the server.

## v0.8.22
A test build, from the `claude/v0.8.22` branch: backups, built-in Tailscale, the album editor and
drawing covers move to Mandarin's C# server.

- **Backup & restore is now made by the C# server.** Making a backup, keeping one on the server,
  downloading, restoring and deleting all work as before. A backup made by either server restores
  on the other.
- **Built-in Tailscale is run by the C# server.** Signing in and out and switching it on or off
  work as before. It now stays connected while the server restarts after a restore.
- **The album editor is handled by the C# server**: a corrected title, artist or year, a cover from
  a web address, undoing your edits, and the search for a missing cover.
- **Covers are drawn by the C# server** the first time each size is asked for, from the album's own
  picture: a cover you found, the one in its folder, or the one in its tracks. An album with no
  cover still gets its drawn one from the Node server, as does a picture only it reads well (CMYK,
  or with a colour profile other than sRGB).
- **Saving and deleting a Dynamic Playlist**, and the list of tags to filter by, are handled by the
  C# server.
- **Fixed: Greek titles ending in Σ** could be missed by a search typed in lower case. Both
  servers now read them the same.
- Nothing in your library changes, and covers already drawn are kept. New tests compare backup
  files, the cover search and the album editor on both servers.

## v0.8.21
A test build, from the `claude/v0.8.21` branch: album write-ups, artist stories, Pitchfork, the Qobuz app link and playlist sharing move to Mandarin's C# server.

- **An album's write-up is now made by the C# server.** That covers its year and release day,
  Wikipedia's words with Pitchfork's score and link, the artist's story, and the links to hear it
  and read about it. All work as before, and what was already looked up is kept.
- **Pitchfork's lists are read by the C# server**: Latest and Best New Music, a review's record in
  your library, and the Pitchfork part of the search.
- **The link that opens the Qobuz app** on the right record, and the share card's settings, are
  handled by the C# server.
- **Sharing a playlist as text, and importing one someone shared with you, are handled by the C#
  server.** A playlist shared from either server imports into the other.
- **Fixed: no Qobuz app link after one missed answer.** When Qobuz's site didn't answer once, that
  album had no link until the server restarted. Now it asks again next time.
- **Fixed: a write-up holding the text `&constructor;`** showed a line of program code in its
  place. It now shows the text as written.
- **Fixed: importing a shared playlist could fail** when one of its tracks was on an album the
  library hadn't finished adding. That track is now passed over, and the rest import.
- An album's year in its write-up now asks the MusicBrainz set with `MUSICBRAINZ_URL`, as the
  release days do. Before, it always asked musicbrainz.org.
- Nothing in your library changes. New tests ask both servers about write-ups, Pitchfork's pages
  and shared playlists over many made-up cases, and check every answer is the same. Wikipedia,
  Pitchfork and Qobuz's site are fakes in the tests (`WIKIPEDIA_URL`, `PITCHFORK_URL`,
  `QOBUZ_WEB_URL`). The write-up and playlist tests now run against the C# server.
- The wall display's page, which follows what plays, stays with the Node server for now.
- The Android app for this branch is at the same test address (0.8.21, version code 221).

## v0.8.20
A test build, from the `claude/v0.8.20` branch: record labels, release days, Smart Picks and the share card's suggestions move to Mandarin's C# server.

- **Record labels are now handled by the C# server, whole.** The Labels wall and each label's
  albums, the labels looked up for albums whose files carry none (MusicBrainz, then Discogs), and
  the logos (found on Discogs and FanArt.tv, or chosen by hand) all work as before. So do the scan
  log and the Discogs and FanArt.tv keys with their check.
- **Release days are looked up by the C# server** after each library scan, for albums whose tags
  stop at the year. They now ask the MusicBrainz set with `MUSICBRAINZ_URL`, as the README says.
  Before, they always asked musicbrainz.org.
- **Smart Picks and the share card's three suggestions are made by the C# server**, with the map of
  acts near what you play, built once a day.
- **Fixed: no suggestions after one missed answer.** When Deezer didn't answer once, the share card
  showed no suggestions for that artist until the server restarted. Now it asks again next time.
- **Fixed: a record label named only in other scripts** (a Japanese label, say) could be Label of
  the week, or a search result, that opened to nothing. It stays off both now, as it stays off the
  Labels wall.
- Nothing in your library changes. A new test asks both servers about share links, suggestions,
  release days and label names over many made-up cases, and checks every answer is the same. The
  label, release day, Smart Picks and suggestion tests now run against the C# server.
- When the Node server starts again (an update, Restart), the C# server takes this work back
  before anything more is done.
- The Android app for this branch is at the same test address (0.8.20, version code 220).

## v0.8.19
A test build, from the `claude/v0.8.19` branch: album identification moves to Mandarin's C# server, whole, with the MusicBrainz pack, loudness measuring and the waveforms.

- **The identification scan is now made by Mandarin's C# server.** It looks each album up by
  what its files carry, then on MusicBrainz and iTunes. It scores what it finds and applies,
  proposes or leaves the album alone, rule for rule as before. Accept, Decline, Undo, Check again
  and the album editor's Find match work as before.
- **The MusicBrainz pack is kept by the C# server too**: downloaded and checked, moved to another
  folder, and kept up to date once a day.
- **Measuring loudness and the waveforms are made by the C# server.** The gain each device gets is
  still worked out by the Node server, which plays.
- **One MusicBrainz timer.** Every request to MusicBrainz, from either server, waits its turn on the
  same timer. Together they never ask more than once a second.
- **Fixed: track names on an album missing a track.** When a match was applied without asking,
  every track after the gap took its neighbour's name. Now each track gets the name of the track
  it matched. Albums matched before keep their names; Check again on one fixes it.
- **Check again** on an album now lets the MusicBrainz pack look at it straight away, even while
  musicbrainz.org isn't answering.
- Nothing in your library changes: your matches, proposals and what Undo puts back stay as they
  were. A new test asks both servers' scorers about 700 made-up albums and checks that every score
  and verdict is the same. The waveforms match number for number. The identification, pack,
  loudness and waveform tests now run against the C# server, and so do some older tests that had
  been running on the Node server alone.
- When the Node server starts again (an update, Restart), the C# server takes the work back
  before anything more is done, so the two never work on the same album.
- The Android app for this branch is at the same test address (0.8.19, version code 219).

## v0.8.18
A test build, from the `claude/v0.8.18` branch: the whole library scan moves to Mandarin's C# server in one step.

- **The library scan is now made by Mandarin's C# server.** It walks the music folders, reads the tags,
  names untagged albums from their folders, groups the albums and writes the database. It also
  chooses the covers, recognises moved files, and keeps the rules that never remove music in a
  hurry. All of it is done rule for rule, as before.
- It runs as a program of its own, at the lowest priority, on the cores playback doesn't keep. A full
  scan is about two and a half times faster.
- It's used once the tag reader check has passed, as yours has. Until then, or where the C# server
  isn't there, the Node server scans as before. The server log says `[scan] made by the C# server`
  when it's the C# server's scan.
- Nothing in your library changes: the same albums and album numbers, with their hearts, edits and
  plays. A new test scans one music folder both ways through nine kinds of change (files changed,
  renamed, removed, a drive missing, a folder that can't be read, and more) and checks that every
  table comes out the same. Every other scanner test now runs against the C# scan too.
- When to scan (every six hours, a change on disk, Rescan) and letting a folder go stay with the Node
  server for now.
- The Android app for this branch is at the same test address (0.8.18, version code 218).

## v0.8.17
A test build, from the `claude/v0.8.17` branch.

- **Settings → Library Scanner opens at once.** The page's own words and switches are there the
  moment it opens, with the numbers it showed last time, and each part fills in as soon as its own
  answer comes. Nothing waits any more for GitHub (asked about the MusicBrainz pack in the
  background) or for the lists of albums.
- **Only what moves changes.** While the page is open, only the numbers that changed are redrawn;
  the rest of the page stays still, and the lists of albums are fetched again only when their
  counts change.
- On a library of 164,000 tracks, the page's five-second refresh now asks for under 1 KB instead
  of 725 KB, and the server makes the lists in a quarter of the time.
- **Android: on a weak signal, the track that's playing comes first.** Away from home, the app
  saves the next tracks to the phone as you listen. On a poor mobile signal those downloads shared
  the connection with the track playing, so the music stopped every few seconds. Now they wait
  until the playing track has 30 seconds in hand, and pause whenever it drops to 10 seconds or the
  music has to wait. They carry on from where they stopped.
- The Android app for this branch is at the same test address (0.8.17, version code 217).

## v0.8.16
A test build, from the `claude/v0.8.16` branch: the sixteenth step in moving Mandarin's server to C#.

- **Hearts, Listen later and record label changes are now made by Mandarin's C# server**: a
  heart on or off, albums put on or taken off Listen later, labels merged or let go, Record labels
  switched on or off, and the folder depth labels are read from.
  - Each is written as before, and the Node server is told at once, so playback, Smart Picks and
    the label lookups see it straight away.
  - A test makes each change through the C# server and checks every library screen still reads
    the same from both servers.
- Album edits move with the covers, in a later step.
- The Android app for this branch is at the same test address (0.8.16, version code 216).

## v0.8.15
A test build, from the `claude/v0.8.15` branch.

- **The tag reader check keeps what it has found when Mandarin updates.** It starts again only
  when one of the two readers changes. Files already checked by v0.8.13 or v0.8.14 count, so this
  update doesn't send the check back to the start.
- **The check is quicker.** It reads a few files at a time, one on each core playback doesn't
  keep, and no longer rests between batches. While something is playing it still goes gently.
  - When the old reader stops on a file with several in hand, it reads those again one at a time
    to find the file, as before.
- **It shows about how long it has left**, in *Settings → Library Scanner → New tag reader check*.
- The report says which two readers it compared.
- The Android app for this branch is at the same test address (0.8.15, version code 215).

## v0.8.14
A test build, from the `claude/v0.8.14` branch: the fourteenth step in moving Mandarin's server to C#.

- **The scanner now reads tags with Mandarin's C# server.** It reads a folder's new and changed
  files together, several at a time: one file on each core playback doesn't keep (three on a
  four-core machine, two while DSP is in use), each at the lowest priority.
  - The library comes out exactly as before. A new test scans the same music both ways and checks
    every track, album and tag is the same.
  - It switches over by itself only once the tag reader check (v0.8.13) has read every file in
    your library the same both ways. Until then, and after each update until the check has run
    again, the scanner reads tags itself as before.
  - A file read differently later sends the scanner back to its own reader until it's put right.
  - Should the C# server not answer, the scan reads the tags itself and says so once.
  - *Settings → Library Scanner → New tag reader check* says which reader the scanner uses.
    `TAG_READER=node` keeps the old reader; `csharp` uses the new one without waiting.
- The Android app for this branch is at the same test address (0.8.14, version code 214).

## v0.8.13
A test build, from the `claude/v0.8.13` branch: the thirteenth step in moving Mandarin's server to C#.

- **Playback comes first on the processor.** Playback keeps a core of its own, or two while DSP
  is in use. Everything else runs on the other cores. On a four-core machine that is one core for
  playback and three for scanning and the rest; with DSP, two and two.
  - Playback means Mandarin's audio engine for a sound device on the server, and every conversion
    a device is waiting for or will play next, made by either server.
  - Scanning, measuring ReplayGain, the tag reader check below and the phone's downloads run at
    the lowest priority, and their disk reads go last.
  - ReplayGain is now measured on every core playback doesn't keep, a file on each, instead of one
    file at a time.
  - DSP keeps its second core for ten minutes after its last conversion, so the split doesn't
    change at every track.
  - *Settings → Library Scanner → Processor* shows the split.
  - Playback runs at a higher priority too when the container has `--cap-add SYS_NICE` (or
    `--privileged`, which a USB DAC needs anyway). Without it, playback still has its own cores.
  - `PLAYBACK_CORES=1` or `2` fixes how many cores playback keeps; `0` shares every core.
    `PLAYBACK_CORE=<n>` still picks the core.
- **A check of the new tag reader, on your own library.** Mandarin's C# server now has its own tag
  reader, a copy of the one the scanner uses. Before the scanner moves to it, every file is read by
  both, in the background, and the two readings are compared. Nothing in your library changes.
  - *Settings → Library Scanner → New tag reader check* shows how far it has got. **Copy report**
    copies the result; please send it to the developer.
  - It waits while a scan runs, and checks new and changed files after each scan. After an update
    it reads every file again.
  - A file the old reader can't survive (a damaged WAV can stop it) is noted, and the check goes on.
- The Android app for this branch is at the same test address (0.8.13, version code 213).

## v0.8.12
A test build, from the `claude/v0.8.12` branch: the twelfth step in moving Mandarin's server to C#.

- **The phone's downloads and its music away from home are now made and sent by Mandarin's C#
  server:** a download at Original or Opus 256 quality, and the Opus stream the phone plays away
  from home, with the album's next two tracks made ready behind it.
  - The same audio as before: a new test checks each FLAC is the very file the Node server's
    settings make, and each Opus file decodes to the very same sound.
  - Kept in the same place under the same names, so downloads and Opus already made are used as
    they are.
- The album's download list (with its ReplayGain numbers) and automatic downloads still come
  from the Node server; neither makes a file.
- The Android app for this branch is at the same test address (0.8.12, version code 212).

## v0.8.11
A test build, from the `claude/v0.8.11` branch: the eleventh step in moving Mandarin's server to C#.

- **Conversions are now made by Mandarin's C# server.** A file a device can't take as it is
  (24/96 to Sonos, a 24-bit WAV, a streamer's own rate and depth) is converted with ffmpeg by the
  C# server and sent as it is made; the next tracks of what's playing are made ahead there too,
  and the cache kept under its size. The same settings to the letter: a new test checks each kind
  of conversion is the very file the Node server's settings make, byte for byte.
  - The Node server still makes what only it can: a zone's DSP, a ReplayGain level, 32-bit
    output, Opus for the phone away from home, and Qobuz and Tidal. Each file is made by one.
- **Fixed: the phone's volume away from home.** The phone's volume has only a few real steps
  (often 15), so a level set from the page came back slightly different, and the slider jumped
  back and forth while the phone caught up — worst away from home — and + or − could get stuck.
  The app now says how many steps it has; the page moves one step at a time and shows each
  change as the phone will set it.
- **Fixed: signed in to Tailscale again, the app stayed offline** until the network changed. It
  now looks for the server again as soon as the Tailscale screen says connected.
- The Android app for this branch is at the same test address (0.8.11, version code 211).

## v0.8.10
A test build, from the `claude/v0.8.10` branch: the tenth step in moving Mandarin's server to C#.

- **Converted audio, once made, is now sent by Mandarin's C# server.** A file a device can't take
  as it is (24/96 to Sonos, a 24-bit WAV, a streamer's own rate and depth) is converted once by
  the Node server with ffmpeg and kept; the next tracks are made ahead of play. From then on the
  C# server sends the kept file, with seeking, and marks it as used so the cache keeps it.
  - The same bytes and headers, range for range: a new test converts each kind once, then checks
    the C# server's copy against the Node server's.
- Still the Node server's: making a conversion the first time, a conversion with a zone's DSP or
  a ReplayGain level, 32-bit output, Opus for the phone away from home, and Qobuz and Tidal.
- The Android app for this branch is at the same test address (0.8.10, version code 210).

## v0.8.9
A test build, from the `claude/v0.8.9` branch: the ninth step in moving Mandarin's server to C#.

- **Music files are now sent by Mandarin's C# server** whenever a track goes out as it is stored:
  to Sonos when it can play the file (its format, at most 24-bit/48 kHz, stereo, not DSD), and to
  a streamer that was promised the file itself. Straight from the disk, with seeking as before;
  before, the Node server read the file and the C# server passed every byte along.
  - The same bytes, the same headers, the same answer to every kind of range a player asks for:
    a new test checks each track against the Node server's.
  - A speaker's address carries a signature, which the C# server checks.
- Anything converted still goes through the Node server and ffmpeg: a file above what the device
  takes, a ReplayGain level, Opus for the phone away from home, and Qobuz and Tidal tracks.
- **Fixed: the Playlists screen's Import button no longer stays on Home** after going back from
  Playlists. It only went when the way out happened to clear it; it now always goes with the screen.
- The Android app for this branch is at the same test address (0.8.9, version code 209).

## v0.8.8
A test build, from the `claude/v0.8.8` branch: the eighth step in moving Mandarin's server to C#.

- **Your own playlists are now Mandarin's C# server's:** the list, opening one, making, renaming
  and deleting one, and adding tracks or whole albums to one.
  - Kept where they always were, in the same shape, so nothing to move or redo.
  - A Qobuz or Tidal playlist still shows only while you're signed in to the service with its
    import on, and is kept as it is while hidden.
  - Each change is saved in one go, so two changes at the same moment can't undo each other.
  - A new test makes every kind of change once through each server, from the same starting
    point, and checks both the answer and what was saved are the same.
- Sharing a playlist as text (to MusicD Remote and back) still comes from the Node server.
- The Android app for this branch is at the same test address (0.8.8, version code 208).

## v0.8.7
A test build, from the `claude/v0.8.7` branch: the seventh step in moving Mandarin's server to C#.

- **Settings that are only kept and read are now Mandarin's C# server's:** the wall display (on
  or off, and its seconds), Smart Picks (on or off, and its hour) and Home's rows (which, in what
  order). Saved in the same place, so the Node server sees a change at once.
- **Dynamic playlists are now read by the C# server:** the list, a playlist's albums, and its
  tracks as the player asks for them. They are saved Library views, so they come from the same
  Library wall as v0.8.4's.
- Your own playlists, share links and the waveform switch still come from the Node server: each
  depends on something only it knows (whether you are signed in to a service, which sites it
  links to, whether ffmpeg works).
- The Android app for this branch is at the same test address (0.8.7, version code 207).

## v0.8.6
A test build, from the `claude/v0.8.6` branch: the sixth step in moving Mandarin's server to C#.

- **Home's rows are now read by Mandarin's C# server:** Album of the day, Label of the week,
  Recently played and Not played lately.
  - Album of the day is still chosen once a day, at 00:01 on the server's clock, and kept through
    scans and restarts; both servers read and keep the same choice, and it still leaves Home once
    played. The day and the week come from the Node server, so a time zone set for the container
    is followed exactly as before.
  - The same answers as the Node server's, checked by the test that compares the two.
- Smart picks, radio and the server's status still come from the Node server.
- The Android app for this branch is at the same test address (0.8.6, version code 206).

## v0.8.5
A test build, from the `claude/v0.8.5` branch: the fifth step in moving Mandarin's server to C#.

- **Album covers and label logos are now sent by Mandarin's C# server.** Every size of a cover is
  still drawn once by the Node server and kept; from then on the C# server sends it. After a scan
  the tile size of every album is drawn ahead, so nearly every cover on the walls comes from C#.
  - The same rules: an address from before a cover changed gets the album's current cover, and a
    browser can keep a cover for good once it has it.
  - The same pictures, byte for byte, with the same caching headers (a new test checks).
  - A Sonos speaker fetching a cover by its own address is still answered by the Node server,
    which knows the speakers; a cover address handed to a speaker works in C# too.
- The Android app for this branch is at the same test address (0.8.5, version code 205).

## v0.8.4
A test build, from the `claude/v0.8.4` branch: the fourth step in moving Mandarin's server to C#.

- **Reading the library is now Mandarin's C# server's job:** the Library wall with every sort and
  Focus filter, search, the artists list and an artist's albums, an album's page, genres and
  decades, the random wall, Favourites, Listen later and Home's genre row.
  - The same answers as before, field for field and in the same order: a new test asks both
    servers the same questions, then changes the library (a heart, Listen later, an edit, labels
    switched on, a merge, plays) and asks again.
  - The Node server still scans, takes edits, hearts and label changes; the C# server keeps its
    copy of the library in step with the Node server's, so a change shows at once.
  - A streamed album's page (Qobuz, Tidal) still comes from the Node server, which asks the service.
- **Pages and lists are compressed again.** Since v0.8.3 the page's own files went out without
  compression; what the C# server answers is gzipped now, as before.
- The Docker image now includes libicu, so names sort the same way in both servers.
- The Android app for this branch is at the same test address (0.8.4, version code 204).

## v0.8.3
A test build, from the `claude/v0.8.3` branch: the third step in moving Mandarin's server to C#.

- **The page and its files are now served by Mandarin's C# server:** the page itself, its script
  and stylesheets, the icons and the fonts, everything in `public/`. Behind the sign-in as before,
  with the same caching: an hour for icons and fonts, while the page, its script, stylesheets and
  JSON are checked each time, so an update is seen at once. A copy still current is answered "not
  modified", the Android app's offline copy included.
- The Android app still gets its own page (without `viewport-fit=cover`) and its own stylesheet
  (every safe-area allowance at zero, plus the app's rules), as before.
- Every address that isn't a file in `public/` still goes to the Node server: its routes outside
  `/api` (`/login`, `/display`, the streams), and the page it opens for a deep link.
- The Android app for this branch is at the same test address (0.8.3, version code 203).

## v0.8.2
A test build, from the `claude/v0.8.2` branch: the second step in moving Mandarin's server to C#.

- **Signing in, signed-in devices and the gate are now Mandarin's C# server's.** Making the
  account, signing in (SRP), the "Enter your current password" check, changing the password,
  the list of signed-in devices and signing one out are all answered by C#, and so is the gate in
  front of everything else: a request from a device that isn't signed in stops there and never
  reaches the Node server.
  - The same rules, word for word: the account made only from the home network, five wrong
    passwords from one address locking it out for 15 minutes, every failure slowing the next
    attempt, an unknown username answered as if it were real, the cookie for browsers and the
    token for the Android app.
  - Nothing to sign in again: the account and the devices are the same tables in the same
    database, read and written by both servers. A token made by either works with the other.
  - The sign-in maths (SRP) is checked against the same fixed example as the page and the
    Android app, to the byte.
  - Streams and covers are still decided by the Node server (a Sonos speaker can't sign in: its
    addresses carry a signature, or come from a speaker the Node server knows).
- **A library scan no longer fails when something else writes to the database meanwhile.** The
  scan's transactions read first and asked for the write lock at their first write; if another
  connection had written in between (a device signing in, a setting saved), SQLite refused at once
  ("database is locked") and the whole scan stopped. Every transaction now takes the write lock at
  its start and waits its turn. Found because the C# server writes to the same file: a scan running
  while a device signed in failed. Checked: 20 forced scans against 100,000 writes from another
  connection, none failed.
- **Streamers' events still reach the Node server** (a streamer telling Mandarin its state changed
  can't sign in, and goes past the gate as before), and the Node server's loopback-only routes
  (`/internal/`) stop at the front door.
- Every response C# writes itself says so (`X-Mandarin-Answered: C#`), and `test/front.test.js`
  pins which server answers what, so a moved part can't quietly fall back to Node.
- The Android app for this branch is at the same test address (0.8.2, version code 202).

## v0.8.1
A test build, from the `claude/v0.8.1` branch: the first step in moving Mandarin's server from
Node.js to C#.

- **Mandarin's server in C# is the front door.** A new program (`server/`, .NET 10) takes
  Mandarin's port and starts the Node server behind it, on a port on `127.0.0.1` that nothing else
  can reach. It answers the parts already moved to C# and passes everything else on as it came.
  Each part of the server moves to C# in a later build, behind the same tests. When nothing is
  passed on any more, Node leaves the image. `server/README.md` keeps the list of what has moved.
  - Who is asking goes through unchanged. Home and away are told apart as before, the built-in
    Tailscale included, and no device can claim to be at home by sending a forwarded address of
    its own.
  - Streams to a room or a renderer, held requests and backup uploads pass straight through, as
    long as they take.
  - In-app updates work as before: the Node server still runs through `launcher.js`. Restart and
    Shut down stop the C# server with it, so Docker's restart policy acts as before.
  - Every response says which server it came through (`X-Mandarin-Server: C# 0.8.1`).
- **Tested both ways.** The whole suite runs with every test's server behind the C# server
  (`MANDARIN_FRONT=1`, as CI does on Node 22) and directly (as on Node 20). Both must pass.
- The Docker image starts the C# server, which starts the Node server. Nothing to change in
  `docker run`.
- The Android app for this branch is at the same test address as v0.8.0's (0.8.1, version code 201).

## v0.8.0
A test build, from the `claude/v0.8.0-csharp` branch. v0.7.x carries on beside it until this one
has proved itself.

- **Mandarin's audio engine, written in C#.** A sound device on the server's own computer (a USB
  DAC, the speakers, HDMI) is now played by a native program of Mandarin's own (`engine/`, .NET 10,
  built ahead of time: no .NET is needed where it runs). It holds the device open through ALSA.
  ffmpeg decodes each track straight into the engine's own buffer, 64 MB, a few minutes ahead at
  CD rates. One thread of the engine's own, and only that thread, writes to the device, on the
  core kept for playback and at a real-time priority where the system allows it. It allocates
  nothing while it plays. The server's own work (a library scan, an import, its own memory
  clean-up) is no longer anywhere in the path from the decoder to the device.
  - Gapless as before: the next track at the same rate goes into the open device with nothing
    between them. Pause holds the device where it is (or, on one that can't pause, hands it again
    what it was holding). A seek is heard at once.
  - Where the device is in a track is read from ALSA (what the device has still to play), not
    worked out from a clock.
  - Volume as before: untouched at 100% or on Fixed volume, scaled on the same 50 dB curve below.
  - A device that ran dry is put right at once and logged with how much was held ahead.
  - Checked bit for bit: two tracks (16- and 24-bit) played through the engine, into a file and
    through the ALSA library itself, come out sample for sample as each track decodes on its own.
- **Nothing stops playing on the way.** The Docker image carries the engine. An install updated
  from Settings downloads it once from the new "audio-engine" pre-release, checked against its
  checksum. Until it is there, on a Mac for now, or with `AUDIO_ENGINE=0`, devices play exactly as
  in v0.7.x. `/api/health` says which: `"audio_engine": "0.8.0"` or `null`.
- **Docker:** `--cap-add SYS_NICE` (or `--privileged`, as for the USB DAC already) gives the
  playback thread its real-time priority. Without it, it plays at an ordinary priority.
- **The Android app for this branch** is a direct download for testing:
  `https://github.com/meltface-80/Mandarin/releases/download/test-android/mandarin-android-test.apk`.
  It is 0.8.0 (version code 200), so a later v0.7.x app won't install over it: going back to v0.7.x
  before v0.8.0 is released means uninstalling it first.
- Under the hood: `engine/build.sh` builds the engine; CI builds and tests it with the rest
  (`test/engine.test.js`); the image builds it for amd64 ahead of time and for arm64 as one
  self-contained file.

## v0.7.10
- **A service's import switch now decides what is in the library** (Tidal and Qobuz). Off: none of
  its albums are on the walls, in search or on Home, and none of its playlists show, straight away.
  On: all back straight away, then brought up to date. Before, off only stopped further imports, so
  everything already brought in stayed. Update library now could also run an import with the switch
  off, and an import still running when it was switched off finished anyway. Update library now is
  hidden while the switch is off. Nothing is deleted either way, and Clean up leaves hidden albums alone.
- **Both switches start off.** Signing in to Qobuz or Tidal brings nothing into the library until you
  switch it on. A switch you have already set keeps its setting; one never touched is now off.
- Your own playlists saved while signed out of a service, or with its switch off, no longer drop that
  service's hidden playlists.
- **A signed-in Qobuz or Tidal account no longer weighs on the server.** Every import (20 s after
  each start, every six hours, after every rescan) fetched every favourite, purchase and playlist
  album again and rewrote all its tracks, changed or not — after a restart, one request per album,
  one after another, while the app waited on the same server (measured: 300 favourites, 306 calls,
  32 s). Albums already here and read within the week are kept as they are (6 calls, 0.6 s).
  The cover warm-up runs one pass at a time instead of one per library change.
- **The mini player, on touch screens** (the Android app, the iPhone and iPad home-screen app,
  tablets), is 15% taller, with a larger cover, buttons and text. **On a desktop** it is a quarter
  of the screen wide in the bottom-right corner, twice the height: a cover twice the size, the
  title beside it and the controls under the title.
- **On a tablet the album view fills the screen**, as on a phone, instead of a card over the page.
- **About this album grows downwards** under the cover when expanded; it had risen over the
  bottom of the cover.
- **Every album view shows the album's total time**, on the Tracks line, centred under Play Now
  and Queue.
- **The mini player can be moved on a desktop.** Press anywhere on the bar but a button and drag
  it: it goes where it is dropped, kept wholly on screen, and is there again next time (this
  browser remembers it). A click on the cover or the title still opens Now playing; the end of a
  drag doesn't. Double-click the bar to send it back to its corner. The volume sheet opens beside
  it, and near the top of the screen the room list opens under it. Phones and tablets are unchanged.
- Tests: the drag with a real mouse in a browser (a quick flick, the edges, click against drag,
  the sheets, a reload, the double-click, a tablet left as it was).

## v0.7.9
A full review of the server, the page, the Android app and the network engine.

- **Speakers and streamers are found more reliably.** Every search goes out from each of the
  machine's LAN addresses, worked out at the search: a server started before its network was up,
  or whose address changed, used to search from an address it no longer had and find nothing
  until restarted. VPN, Docker and VM interfaces are never used, and the server's own address is
  a private LAN one (it could be a VPN's). A Sonos household whose addresses had all changed is
  read in seconds (the old addresses were tried one by one, ten seconds each). A streamer that
  misses a search round, as multicast often does on Wi-Fi, is checked directly and stays listed.
  A Sonos player's model is retried when it failed to load.
- **Leaks fixed.** The Sonos and streamer loops kept every timer they made (some 98,000 a day);
  the album lookup caches grew without limit (their cap was never applied).
- **In-app updates work from a folder with a space in its path** (a home folder named "John
  Smith"): the download was unpacked through a shell, unquoted.
- **One stray error in background work no longer stops the server**; it is logged.
- **Share card.** The popup ends under its last line on Now playing (a 106px reserve for the
  transport bar was there even where the bar is hidden), and the × sits closer into the corner.
  Suggestions near what you play always come before an act near nothing you play.
- **The Library's Sort sheet keeps keyboard focus** on the row you pressed.
- **Dead code removed**: an unused New Releases picker, a Roon-era queue function, unused helpers,
  a pasted-eight-times block, and a 32 MB build of the network engine committed by mistake.
- **Checked and sound:** sign-in and the media gate, backup ids, the Android app's network
  timeouts, local ports (127.0.0.1 only) and service teardown, and the network engine (go vet and
  its tests clean; the Android core module's 47 tests pass).

## v0.7.8
- **An album's ⋯ menu is all on screen on a tablet.** From 720px up (an iPad either way round,
  a laptop) the menu opens upwards from the button row, and with only the title and the artist
  line above that row it rose past the top of the panel, which cut it off: the first two items
  could be neither seen nor tapped. The title, the buttons and the tracks now start lower, by
  exactly the room the menu needs (measured, for however many items this album's menu has and
  however many lines its title takes), and the menu stays clear of the Share button. Scrolled so
  there is no room above, it opens downwards instead.
- **About this album sits under the cover on a tablet**, in the left-hand column, with the title,
  the buttons and the tracks beside it. On a phone nothing moves: the review follows the tracks.

## v0.7.7
- **Playback on the server keeps clear of the server's other work.** A scheduled library scan
  during playback was found to run a sound device dry (the scan's reads held up the thread that
  feeds the device). Now the scan runs on a thread of its own, at a lower priority, with its own
  database connection; the page follows its progress as before. Conversions prepared ahead run
  below playback. On a Linux machine with four cores or more, the last core is kept for the
  decoder and the device sink and the server runs on the others (`PLAYBACK_CORE=0` turns this
  off, `PLAYBACK_CORE=<n>` picks the core); with `--privileged` the pair also runs at a higher
  priority. Measured: a full scan of 3,000 tracks used to hold the server's thread for seconds;
  now its longest hold is a millisecond.

## v0.7.6
- **A sound device on the server no longer runs dry when the feed pauses.** A bit-for-bit
  capture showed the device playing its whole buffer again — 131,072 frames, three seconds,
  repeated — six times in a two-minute track, and the track then ending early by the time lost.
  That is what an ALSA underrun looks like: the only slack between a pause in the feed and a dry
  device was the device's own buffer. ffmpeg's reader now queues a minute of audio (at 44.1 kHz;
  half that at 96) ahead of the device, filled by the decoder, which runs well ahead. Underruns
  are now logged as they happen, with the feed's longest waits (for the decoder, for the device,
  and for the server itself) so the cause can be read off the log.
- **A WAV or AIFF played to a sound device on the server, or to a renderer that won't take it,
  is now bit-perfect.** It goes as FLAC at its own rate and depth, and the conversion dithered at
  its 32-bit output before the encoder cut the samples to 24 bits — which took one 24-bit LSB off
  an eighth of the samples, always downwards. Found by a bit-for-bit capture of the server's
  output against Roon's. A conversion that changes only the container (same rate, same or deeper
  bits, an integer lossless source) now has no dither, and a test decodes the result and compares
  every sample. Dither stays where it belongs: a resample, a gain, DSP, or a lossy source.
- **The three acts under the share card are chosen for you.** Still from Deezer's related
  acts, but weighted by what you play: a taste graph is built once a day from the related lists
  of your most-played acts, and an act near nothing you play scores next to nothing — so a
  children's act or a wrong-genre act stays off the row without any genre to filter on. Two of
  the three are acts you have not heard of (not in the library, never played); the third is an
  act you know with a record you don't own, never one you play heavily. Each names the act's
  best-known record (from their top tracks) rather than their debut, with a line saying why it is
  there ("Near Steely Dan and Boz Scaggs, which you play"). The draw is weighted random among the
  best and remembers what it showed for a month, so the same record shared twice gives a
  different three. With no listening history yet, Deezer's own order stands.
- **The share card comes up at once, on Now playing and on the album page.** It is drawn from
  what the page already has, and the three acts are asked for only once it is on screen. What
  used to hold it up: it asked for the cover at a size nothing else used (1000 px, rounded up to
  the server's 1200 px step), so every first share of a record meant the server decoding and
  re-encoding the full cover and the phone downloading it — now it asks for the 800 px picture
  Now playing and the album page already show, the browser's own copy; the duck tile was a
  900 KB PNG for a 96 px drawing — now 30 KB; a wordmark the card doesn't carry was still
  requested as "/null", which came back as the whole app page on every draw; and the pictures
  were fetched one after another — now together. Measured in the browser: a cold share went
  from about 1.1 MB over the wire to nothing, and from 335 ms to 130 ms on a fast link (far
  more on a phone away from home).

## v0.7.5
- **The share card's duck is a rounded-square brass tile.** The app icon's shape — the duck in brass
  on a dark ground with a brass outline, corners in the card's own proportion — at the size and
  place the round disc had.

## v0.7.4
- **A Qobuz or Tidal album queued after the phone's own music plays when it is reached.** Playing
  music stored on the phone, the app's player holds the list itself, and a server album queued
  after it goes into that list. Until now a server track reached there was fetched cold, with
  none of the care the server's own queue gets: not fetched ahead, an error never tried again,
  nothing carried on when the server was back — so the page showed it about to play, without its
  cover, and the player stayed silent until Play now. Now the server's tracks in the phone's
  list are fetched ahead while the phone's music plays, tried again on an error, picked up when
  the server answers again, and Now playing has their cover and album by their id or, failing
  that, by the cover address the server gave them.
- **Music on device has Focus and Sort**, as the Library wall does, in the Android app: sort by
  album name, artist, release date or random; focus by artist, decade or quality (Hi-Res,
  lossless, lossy), each chip tapped once to include and again to exclude. Worked out on the
  phone, where that music lives, and remembered per device.
- **An artist's page shows everything of theirs in your library.** Tapping an artist's name used
  to ask the server alone, so an artist whose albums are on the phone came back as "0 albums".
  Now the page lists the server's albums (your files, Qobuz, Tidal) and the phone's own under
  "On this phone", and the phone's part stands even when the server can't be reached.
- **Albums from anywhere can be multi-selected together and played** in the Android app. Playing
  on This phone, a selection of your files, Qobuz, Tidal and the phone's own albums is one queue,
  with Play now, Play next and Queue meaning the same for all. With a room or a device as the
  zone, the server's albums go there and the phone's are left out, with the word "Unable to add
  music on this phone to queue". Before, the phone's albums went to the server with the rest, which knows nothing of them
  and refused the lot ("offsets required").
- **The share card carries the duck.** The duck, as a round black disc, sits inside the card's
  bottom-right corner, on the glass beside the album details, never on the border; with a review
  on the card it shares the foot with the review's source.
- **The Backup page says the API keys part carries the server's Tailscale identity**, so a
  restore onto a fresh install is the same node on your tailnet (it has since v0.7.2).

## v0.7.3
- **Qobuz and Tidal favourites follow both ways, by themselves.** Remove an album from your
  Qobuz or Tidal favourites on its page (⋯ → Remove from … favourites) and it is gone from the
  service, its page closes and its tile is off the wall at once — no rescan, no import. Add one
  and the walls take it in. A favourite added or removed in the Qobuz or Tidal app follows here
  on the next look: the server compares the service's favourites (and Qobuz purchases) with what
  it keeps every two minutes, and the page asks for that check when you come back to Home or the
  Library wall. The six-hourly import still brings the playlists. The page of an album is
  itself a look: opened, what the service says of its favourite is what the library goes by —
  no longer a favourite there, it is off the walls from the next draw, never "not in your
  favourites" on a page the walls still keep. Rescan library and the import let go by the
  service's id lists asked for now, so a listing that lags a removal (or a page of it cached
  within the minute) can no longer keep an album in.
- **One Update, the server first, the app after.** In the Android app the Update button used to
  start both at once; installing the app replaces the page, so the server's update ran unseen — a
  failure never shown, the offer back on the next open. Now the server updates first and, once it
  is back, the app's download and Android's installer follow; a server failure is shown and
  retryable, the app's update waiting on it. With the server on offer the page asks the app
  afresh, not from its hour's cache (the app's build lands minutes after the server's release,
  and the cache was what kept the banner saying "server only"), says "the app's vX follows in a
  few minutes" meanwhile, and asks again after the restart. The banner also sees the server back
  by its version, so a quick restart no longer leaves it on "Restarting…".
- **An album's page says why it is in the library.** A streamed album's page reads "In your
  library as a Qobuz favourite since 3 Oct 2026", "… as a Qobuz purchase", "Here for a Tidal
  playlist or favourite track" or "Played from Qobuz — not in your favourites", and "not out
  until 16 Oct 2026" for one not released yet. An album that appeared unasked — Qobuz lists a
  pre-release in the favourites its own app keeps out of sight, or a favourite another app
  linked to the account added — can be read off its page and removed there.

## v0.7.2
- **Hide / unhide on Audio Devices.** Devices you can't forget (a computer's HDMI outputs, say)
  can be hidden: tap **Hide / unhide**, tick them, tap **OK**. Hidden ones leave the list, and one
  that can be switched off is, so it leaves the zone picker too. Tap Hide / unhide again and the
  hidden ones are listed under Hidden: tick one and OK to bring it back. A note after OK says so.

- **The server's Tailscale identity travels with a backup's keys.** Restored onto a fresh install
  (a rollback, a rebuilt data folder), the server is the same node on your tailnet: the same
  address and name, no signing in again, and the phone's learnt address still right. Before,
  every reinstall was a new node, which is why away from home kept needing Tailscale set up
  afresh. The built-in Tailscale also now reports whether its node is online and any warning
  Tailscale raises, and rebinds, then restarts itself, when it has said Running but not online
  for a minute.
- **Leaving the Wi-Fi, the app follows at once.** The Wi-Fi gone with mobile data still up: the
  page's connections over it would hang rather than fail, and the page with them, until the
  app was closed and opened again. They are dropped at once, the way to the server looked at,
  and the server asked for within seconds; with no way to it, the app's own copy takes over.
  The page's own asks give up on a dead connection after 25 s too.
- **A fresh look at matching.** A copy that is the whole of itself on a bigger pressing (every
  track there, to the name and the second) is the same record: one edition difference, not a
  penalty a track, so a ten-track original on a twenty-track anniversary pressing now applies
  and the page says "the same record; this pressing has 10 more tracks". The pressings of a
  record with your track count or within one of it are fetched (eight, not three) before the
  best is chosen. Spaces are not a difference ("LateNightTales" is "Late Night Tales"). A
  folder that is one disc of a set ("CD2", "Disc 2") is scored against that disc of the
  release alone.

## v0.7.1
- **"UPnP error 501: … is not responding: socket hang up" on a renderer** (Audirvana's UPnP
  renderer on a Mac, among others): the player had closed the kept-alive connection the control
  request went out on. The request is now sent once more on a fresh connection, as Node's own
  guidance has it; a request that fails on a fresh one is still a failure.
- **Settings' × is the brass disc** it was meant to be in v0.7.0 (an older rule outweighed it),
  at the top bar's button size, as every page's ‹ already was.

## v0.7.0
- **Qobuz and Tidal are supported, experimentally.** Used the way their own apps and the Lyrion
  Music Server plugins use them, in line with each service's terms of service; those who use them
  do so at their own risk.
- **A USB DAC on a Mac** may give trouble for some; a fix is being worked on.
- **Various UI and UX improvements** across the app.
- **Tidal** (Settings → Services). Sign in with a Tidal subscription on tidal.com — Mandarin shows
  a link and a code, and notices by itself when the sign-in lands; the token is kept and renewed,
  never a password. Then everything Qobuz has (v0.6.23), the same way: your favourite albums as
  albums in the library (every one, a Tidal mark on the cover), your Tidal playlists and
  favourite tracks as playlists here, the Tidal browser (☰ → Tidal: search, new releases,
  recommended, top, rising, an artist's albums) as the album grid with **+** / **✓** on each
  cover and the album's own page on a tap, **Add to / Remove from Tidal favourites** in the ⋯
  menu, Clean up on the Library Scanner page, signed out it all steps aside. The same API and
  credentials as the Lyrion Music Server's Tidal plugin, used the same way.
  - Streamed through the server's transcode cache like a file, the next track ready behind the
    one playing. CD quality comes as one address; Tidal's hi-res FLAC (up to 24/192) comes as
    MPEG-DASH, which the server joins into one stream for ffmpeg on its own loopback. *Stream
    quality*: CD, or Hi-Res where Tidal has it (CD asked for instead where Tidal answers a hi-res
    ask with anything else). What Tidal streams a track at is learnt on the first play and the
    rows corrected.
  - Under the hood the two services share one library side (lib/services): rows, kept and held
    albums, playlists import, Clean up, pruning, and one set of routes per service. A service's
    playlists carry which service they are from.
- **The side menu, shorter**: Pitchfork, Labels, Qobuz, Tidal, Listen later, Dynamic Playlists,
  Playlists. Home, Random albums and Smart Picks leave it (Home's rows are where they live; ‹
  goes Home), **Import** is a button in the top-right corner of the Playlists screen, and **Discover** is
  gone altogether, its page in Settings → Setup with it.
- **‹ from a record label's albums goes back to the album** you opened the label from, not to
  the list of all labels.
- **The queue, edited.** On Now playing's Queue tab, hold a track to start selecting (it is the
  first pick), tap more in the order you want them; **⋯** beside the remaining time plays the
  selection now (moved to after the track playing, the first of them played) or next (moved), or
  removes it; **Clear all** empties the queue. Sonos rooms, renderers and the phone alike.
- **The Random albums wall is titled**, as every other grid screen is.
- **A long press selects what it is on**, everywhere there is a selection: album grids, an album's
  tracks, the labels grid and the queue all start with that tile or row as the first pick.
- **Settings' ‹ and × are brass discs**, as every ‹ and × in the app, at the top bar's size.
- **The menu button is Home's alone**: on the album grids, Labels, Listen later, the playlists
  and an artist's page, the brass ‹ stands in its place.
- **The search asks Qobuz and Tidal too.** From Home or the Library, signed in, each service's
  artists (chips) and albums (tiles, **+** / **✓** on the cover) follow the library's results —
  an album from either opens and plays whether or not it is in your library, both versions shown
  where both have it; an artist opens their albums in the service's browser. The Library wall's
  filter asks them for the letters typed too. Qobuz, Tidal and Pitchfork are each asked on their own and
  land as they answer, close behind the library's own results (a 200 ms debounce, as the
  services' own apps type ahead; the server keeps each answer an hour); the previous letters'
  sections stay, dimmed, until the new ones land, so nothing blinks out as you type. A tap on a
  result no longer closes the search, so the results are there when the album's page closes.
- **Rescan library goes on to the services**: once the music folder is scanned, Qobuz and then
  Tidal are brought up to date, in that order, each where you are signed in with the import on.
  The toast says so.
- **The Qobuz, Tidal and Pitchfork pages have a top bar** like every other screen: the name at the
  bar's height in the display face, the close disc in brass at the top bar's size, the bar's
  rule beneath, no grip.
- **Settings → Services, uniform**: the Qobuz and Tidal blocks the same — one width for the two
  quality selects, the same words on the signed-in line (Hi-Res or CD quality after the
  subscription), the same spacing.
- **Now playing's album name opens the album the track is from** — a Qobuz or Tidal album you
  started opens as itself, not the copy of the same record on your drive.
- **The Library's Focus and Sort** sit in their own row under the top bar again, as smaller
  pills — Focus on the left, Sort on the right — and stay in view while the grid scrolls. The
  search glass stays in the top bar at its size; the title keeps its place at every width.

## v0.6.23
- **Qobuz** (Settings → Services). Sign in with a Qobuz subscription; your favourites and purchases
  become albums in the library (every one), and the Qobuz browser (☰ → Qobuz) searches the
  catalogue and plays any album — to a Sonos room, a streamer, a USB DAC on the server or the
  phone — streamed through the server one track at a time with Qobuz's signed requests, the next
  track made ready behind the one playing. Every play is reported to Qobuz; nothing is downloaded.
  The same API and credentials as the Lyrion Music Server's Qobuz plugin, used the same way.
  - **Services** is the second item in Settings, as planned, with the Qobuz card: sign in, stream
    quality (CD, Hi-Res 24/96, 24/192), favourites and purchases in the library on or off, Update
    library now, Sign out.
  - The browser shows its albums as the album grid the rest of Mandarin draws, the Qobuz **+**
    in the corner of each cover; tapping an album opens its page here, the same page as any album.
  - Two favourites, kept apart: the **+** on a cover in the browser (a **✓** once added) and
    **Add to / Remove from Qobuz favourites** in the ⋯ menu on an album's page are the Qobuz
    favourite; the heart is Mandarin's, as on any album.
  - Your Qobuz playlists and favourite tracks are playlists here (each by its name, and "Qobuz
    favourite tracks"); the albums their tracks come from are known but off the walls.
  - Signed out, Qobuz albums and playlists leave the walls and the Playlists screen; their rows stay
    for the next sign-in.
  - A Qobuz album's page has no Download, Edit album or waveform; it isn't in offline mode.
- **Clean up** (Settings → Library Scanner): albums whose files are gone from the server, and
  Qobuz albums no longer wanted, each counted, each removed only when you press. Plays stay in
  history; an album's edits, heart and Listen later go with it.
  - An album played from the browser without being favourited is kept for a month (its page, Now
    playing, history) and left off the walls.

## v0.6.22
- **Play next.** A track's buttons are now Play now, **Play next** and Queue; a selection of
  tracks or of albums has **Play next** under Play now; an album's ⋯ menu says **Play Next**
  (it said Next). Play next puts what you chose straight after the track playing, in the order
  you chose it, and the rest of the queue follows on after it.

## v0.6.21
- **Settings, rearranged** (every screen and the app). The list is now Account, Music Folders,
  Audio Devices, Downloads (the app), Wall Display, Library Scanner, **Setup**, Backup & restore,
  Updates. Setup is a page of its own holding Smart Picks, Discover, Record labels, Home Screen,
  UI Settings, Share Card, Away from home and API Keys; Back from any of them returns to Setup.

## v0.6.20
- **The Offline switch no longer closes the side menu** (the Android app). Switching it reloads
  the page onto the phone's music or back onto the server, and the reload took the menu with
  it. The menu is now open again on the page that follows, with the switch in its new position.

## v0.6.19
- **The side menu, as it was, with two fixes.** Choosing an item closes the menu again (v0.6.18
  left it open). The Offline switch no longer closes it. An item is only as wide as its icon and
  its words: a tap elsewhere in the menu does nothing, and only a tap on the page beside the
  menu (or Escape) closes it.

## v0.6.18
- **Backup & restore: one list, wherever the backup is.** Each card now says where it is —
  **On the server** or **On this phone** — with the date, version, size and the device it was
  made from (or the file's name) below, instead of the phone's model as its title. A backup saved
  to a file on the phone appears in the same list, with **Restore…** and **Delete**, and the page
  says "Backing up…" once the place to save it is chosen. "Restore from a file on this phone…"
  stays, for a file this install didn't make.
- **The side menu closes only from outside it.** A tap on the page beside the menu (or Escape)
  closes it; nothing in the menu does — not the Offline switch, not a blank part of it, not an
  item. Before, every item closed it, the Offline switch included.
- **Sound devices on the server** (Settings → Audio Devices). A USB DAC, the speakers or HDMI on
  the computer Mandarin runs on are listed (off until switched on) and play like a renderer:
  queue, the next track, Output (Original, ×2, ×4, Max), Volume levelling and DSP.
  - **Linux:** ALSA cards this program may open, by card name (`plughw:CARD=…`); a USB DAC's own
    rates and depths are read from the card. While a track plays, the rate ALSA has the device
    open at is compared with what was sent. **Docker:** `--device /dev/snd`.
  - **Mac:** Core Audio outputs (system_profiler), played through ffmpeg's audiotoolbox output.
    The Mac plays at the rate set for the device in Audio MIDI Setup.
  - Two ffmpeg: one decodes each track, one holds the device open. A next track at the same rate
    goes into the open device with nothing between them. Pause holds the device where it is.
    Where the device is in a track is reckoned by the clock from its first frame, not from
    ffmpeg's own progress, which differs between ffmpeg versions.
  - Volume: Mandarin's slider scales the samples on a 50 dB curve (100% untouched); **Fixed
    volume** leaves them untouched always. The level is kept across restarts.
  - From Music Assistant's Local Audio Out (studied for this): the volume curve, ids from the
    device's name, and a failing device reported and let go rather than left "playing".

## v0.6.17
- **Backup & restore away from home too.** Backing up, restoring, and deleting a backup kept on
  the server were refused away from home ("Backup and restore only from home"). They now work
  from anywhere the app or page reaches the server, over Tailscale as at home. The whole
  database is a large file over mobile data; its size shows beside it.

## v0.6.16
- **Another VPN into your home network works with the app.** Off Wi-Fi, with a VPN up, the app
  now tries the server's home address too and uses it when it answers. Before, off Wi-Fi it
  only ever tried the Tailscale address, and with the phone's own Tailscale not signed in it
  went Offline even though the VPN reached the server.
- **Offline, the app's own page when it's newer.** The copy of the page saved from the server
  was used even when it came from an older server, bringing back what the app had since fixed
  (the Tailscale button). The saved copy now notes the server's version and is used only when
  it's no older than the app.
- **The app's backup carries the server's away-from-home address** too, so a reinstall restored
  from it knows where to find the server away (the phone's Tailscale still needs one sign-in).

## v0.6.15
- **The Tailscale button for this phone works again** (Settings → Away from home → This phone, in
  the Android app). The tap went to the ⓘ beside "Tailscale on this phone", which is a button too
  and came first, so Tailscale did nothing. It now opens the phone's Tailscale screen, to sign in.

## v0.6.14
- **Backup & restore** (Settings → Backup & restore). Tick what goes in: the settings you
  changed, every player's own settings (Sonos rooms, renderers and phones: names, output, DSP,
  volume levelling), your collection (playlists, Dynamic Playlists, favourites, Listen later,
  album edits), the API keys, the whole database, and this device's screen settings.
  - **From a browser or the home-screen app:** backups are kept on the server (the last 10), each
    with a Download button.
  - **From the Android app:** also **Back up to a file on this phone** (Android's own "save as"),
    which adds the app's settings: downloads, USB DAC, this phone's DSP and volume levelling.
    **Restore from a file** sends the server's part to the server and puts the app's back.
  - **Restoring** puts back the ticked parts as they were, for every device. A backup of how
    things are now is kept first ("Before restore", the last 5), then Mandarin restarts and the
    page reloads. The whole database restored keeps today's account and sign-ins. A reinstalled
    phone's DSP and levelling follow it to its new player. A backup from a newer Mandarin is
    refused. Only from home.
  - Never in a backup: your password data, other devices' sign-ins, the Tailscale identity,
    downloaded music, caches.

## v0.6.13
- **Not played in 6 months stays empty offline.** With the server out of reach, the Android app
  answered that row (and its full screen) itself with a random handful of the albums on the
  phone, an answer written before the six-month rule. It now gives the server's answer for a
  library with under six months of listening: nothing, so the row stays hidden.

## v0.6.12
- **A power button** at the top right of the side menu (☰) drops down **Restart** and **Shut down**. Restart stops Mandarin
  and starts it again. Shut down stops it until you start it again, so it no longer finds or
  controls your speakers and renderers. On a Mac the login item is unloaded (macOS would
  otherwise start it straight back) and a new **Mandarin** icon on the desktop and in
  Applications starts it again; it also starts at the next login. In Docker only Restart is
  offered: the container's restart policy brings any exit back, so `docker stop` is the way.
  Neither works from away (over Tailscale).
- **The Mac installer** adds that icon (re-run the install line once to get it).
- **README and site**: every feature in 30 words or fewer, with how to switch it on and use it
  behind an ⓘ (tools/docs/features.py writes both); claims made exact.

## v0.6.11
- **Install on a Mac in one line** (README and site): `tools/mac/install.sh`, pasted into Terminal,
  installs Homebrew, Node.js 22 and ffmpeg, downloads Mandarin, asks with the Finder's own
  folder chooser where the music is and where to keep the MusicBrainz pack, offers to keep the
  Mac awake while plugged in, starts Mandarin now and at every login, and opens it in the
  browser. The by-hand steps are still there, folded away, with the music folder and the pack
  folder explained. Away from home on a Mac through the Tailscale app.
- **Folder choosers on a Mac** (Music Folders, the pack's Folder): the top level shows Users and
  Volumes, not the Mac's system folders.
- **The app's signing key, as it is now**: from v0.6.10 the published app is signed with the
  project's own key. The README and the site say that coming from an earlier build needs one
  uninstall, and what a self-built app (`…-shared-key.apk`) can and can't update.

## v0.6.10
- **The Android app is a release build.** It was published as a debug build, which Android runs
  slower (and its Opus decoder unoptimised). Still signed with the same shared key, so it
  installs over the app you have; the file is now `…-shared-key.apk`.
- **Now playing waits for changes.** The page asked the server for the room's state every 1.5s;
  it now asks once and the server answers when something changes (or after 10s), the bar's
  clock moving the progress between. Back off on errors; a new room starts again at once.
- **Covers sized to their tiles.** A phone's 3-across tile was given a 500px cover; it now
  asks for what the tile needs (up to 2x the screen's density), and a four-cover mosaic for
  half that.
- **Long walls draw only what's near the screen** (touch screens): tiles off screen keep their
  place without being laid out or painted.
- **Random Album's disc turns twice, then rests**, and turns again while an album is found,
  rather than turning for ever.
- **The app's offline copy refreshes only what changed**: every five minutes it asked for the
  page, its script and every downloaded album's page in full; now the server answers "not
  modified" for what the app already has.
- **Start-up asks for less first**: the update check and the share-link settings wait until
  the first screen is up, and the side menu's three switches are asked for together.

## v0.6.9
- **A new icon: the duck in black on the app's brass**, the old dark badge's colours turned
  round. For the Android app (the adaptive icon's brass background and black duck, and the
  square and round icons for older launchers) and for the home-screen app, the browser tab and
  the site (every size, maskable included). tools/icons/make-icons.js draws them all from the
  duck itself.

## v0.6.8
Released with v0.6.7.

- **Barcoded albums first.** With the MusicBrainz pack, the albums whose barcode it has are
  looked at before the rest, and placed from the pack without a request to musicbrainz.org.
- **On through outages.** While musicbrainz.org isn't answering, the scan carries on with those
  albums from the pack alone (the files' MusicBrainz release id, then the barcode). A fit is
  applied as any match is; an album the pack can't place waits for musicbrainz.org rather than
  being marked unidentified. The Library Scanner page says it is matching from the pack.
- **"matched by barcode (pack)"** in the Applied list for a match the pack made.

## v0.6.7
- **A pack folder that isn't there is said in words.** A folder chosen for the MusicBrainz pack
  that the container was started without (`/packs` with no `-v …:/packs` line) gave
  "ENOENT … mbpack.sqlite.download". The page now says the folder isn't there and how to put it
  right, beside Folder, and Download stops before it starts.
- **The pack's mount, documented.** README → Install says how to keep the pack on another drive:
  a writable `-v …:/packs` line, kept in every `docker run`, and why the read-only `/mnt` mount
  won't do. The site's command builder takes an optional pack folder and adds the line to
  docker run and compose.

## v0.6.6
Also carries what was built as v0.6.4 and v0.6.5, released together here.

- **MusicBrainz pack** (Settings → Library Scanner). Every MusicBrainz release with a barcode,
  2.7 million of them with their tracks, in one file on the server (845 MB to download, 2 GB on
  disk). Barcodes are looked up there first, both forms of the barcode (12-digit UPC, 13-digit
  EAN), with no request to musicbrainz.org and no second's wait; anything the pack lacks is
  asked for as before. Download, update and remove it on the page; the server fetches a newer
  one by itself once a day when one is out. Built weekly on GitHub from MusicBrainz's CC0 data
  dump (tools/mbpack/build.js, .github/workflows/mbpack.yml) and published as the rolling
  "mbpack" pre-release.
- **The pack's folder.** Keep it in the data folder or any folder the server can write to, on
  any drive: chosen with the music-folder browser, its free space shown, a pack already there
  moved across, and a download that wouldn't fit stopped before it starts. `MBPACK_DIR` sets it
  on the server instead. A read-only folder (mounted `:ro`) is named as such, beside the button.
- **tools/identify-probe.js**: does barcode-first identification work on your library? Asks
  MusicBrainz and iTunes about a sample of your barcoded albums and lists which tags the files
  carry. `--pack` answers from the pack; `--same=FILE` asks about an earlier run's albums and
  prints both summaries.
- **Settings → UI Settings**, per device: Album & artist text, Grid screen title and Menu &
  Home Screen text (every other piece of text: the side menu, Home's headings, Settings, the
  album and Now playing views, the player bar; Normal to +50%, and +75% or +100% on a desktop), Grid layout (Auto, 3 columns, 2 columns or List, for album, playlist and label grids)
  and Tile size (−50% to +50%: Home's tiles, and how many fit on an Auto grid). The grid/list
  button leaves the top bar; Refresh takes its corner, and a device set to List stays List.
- **Labels screen**: find a label from the top bar (× clears, then closes the field) and turn
  the order round, # to Z or Z to #, remembered. One label's albums lose the "‹ All labels" bar:
  the top bar's ‹ goes back to all labels, its title is the label, the logo button top right.
- **Library screen**: Focus, Sort and the search glass in the top bar, in brass. The search
  opens over Focus and Sort; × clears, then closes. On a phone the title gives way to them;
  from 480px wide it shows. Leaving the wall closes the field and gives the next screen its
  title back.
- **An artist's page** has its album count and name beside ‹ in the top bar, not above the grid.
- **Settings on a tablet or a desktop** (768px wide and 600px tall or more): the list opens
  beside the page at the side menu's width, and each settings page only as wide as it needs.
  Phones, held either way, keep the full screen.

## v0.6.3
- **Matching weighs what identifies a record most** — tried against a real library's report
  first (tools/identify-report.js: 11,752 albums, 300 looked up again): the track count and
  lengths first, then the track names, then the album's name and artist, the year least. A
  track's name with something in brackets the release hasn't ("Live For (Album Version
  (Explicit))", "Little Rio (Un poco Rio)") is the same track; one the same length in the same
  place is too, whatever it's called; "Part II" is "Part 2", "Vol." is "Volume". On that
  library: of the 47 proposals waiting, 20 now apply by themselves (2 before); 47 of the 56 you
  accepted or matched by hand would have (45); no other record reached 95 % in any of it.
- **Disambiguation.** A release MusicBrainz labels live, remix, demo, acoustic, instrumental…
  costs a little when nothing of yours (the title, the folders, the box set, the tags) says
  so — and when they do say "remix", the release that says so too comes first.
- **95 % alike is always a match.** No exceptions any more: two releases that fit equally,
  or a release MusicBrainz has without track lengths, are applied like any other at 95 % or
  better — Undo (or the album editor) puts right the odd wrong one. Proposals already waiting
  at 95 % or more are applied when the server starts.
- **Spellings of the same name match.** "&", "+" and "and"; "Kickin'", "Kickin" and
  "Kicking"; "Rock 'n' Roll" and "Rock and Roll" — no longer counted against a match.
- **Capitals don't make a different genre.** "Rock", "rock" and "ROCK" are one genre on Home
  and in Library Focus, shown as most of your albums write it. (Names to the match score,
  albums and artists already paid capitals no attention: "If I Fell" is "if i fell".)
- **Box sets filed as albums.** A box whose discs are albums of their own — "Yes - The Steven
  Wilson Remixes (2018)/Disc 4 - Tales From Topographic Oceans (1973)" — keeps each disc as its
  own album, and its page says "From The Steven Wilson Remixes (2018) · disc 4 of 5", with the
  other discs a tap away (previous / next then step through the box). Edit album says so too.
  Plain "Disc 1", "CD2" folders are still one album's discs. An untagged named disc takes its
  name and year from its own folder.
- **tools/identify-report.js**: the identification scan's work on your library as one file —
  each album's tracks, folder and box, what was decided and what you did, and (with `--fetch`)
  every release MusicBrainz offers for it — for testing changes to the scoring against real
  albums. Read-only.
- **Edit album shows the album's folder**, above Find match — from your music folder down, so
  a box set or a remix ("Yes - The Steven Wilson Remixes (2018)/Disc 4 - …") can be told from
  the original when matching by hand.
- **A proposal says why it isn't 100 %**: track lengths differ, track names differ, the title
  or the artist's spelling, the year (with yours), or MusicBrainz having no track lengths.

## v0.6.2
- **95 % alike is a match.** The identification scan applies a match at 95 % alike or better
  (it was 96 %), whether MusicBrainz or iTunes found it — iTunes matches no longer have to fit
  exactly. Proposals already waiting at 95 % or more are applied when the server starts. Two
  different records fitting equally well are still left for you.
- **ⓘ notes checked against what the app does.** Corrected: the zone picker lists renderers
  and phones too; the waveform isn't prepared ahead for the next track; the label folder depth
  applies at once (no rescan); Discover's notes; Opus 256 is about a quarter of a CD-quality
  FLAC's size, not a tenth; the wall display's address follows the server's port.
- **Browser tests.** Home, the album view and Now playing are checked in a real browser at a
  desktop, phone and tablet size on every push, with no extra packages.

## v0.6.1
- **Random Album and Album of the day sit under the greeting**, with no heading, ahead of
  every row. "Not played in 6 months" holds only albums you haven't played, and stays hidden
  until it has some (its first six months), unless switched off.
- **Now playing goes back.** Opened from the mini player over an album, its corner button
  returns to that album (with its previous/next) instead of going Home. On a desktop it's an
  ×; on phones and tablets a ‹.
- **Album view on larger screens closes with an ×**, and its cover starts below the corner
  buttons, with previous/next still on its centre line. Phones keep the ‹.
- **Now playing, reduced.** On large screens a button beside Back shrinks Now playing to the
  album view's size and back; the card can be dragged by its top strip. Remembered per device.
- **The Random Album disc speeds up smoothly** from where it is when tapped, instead of jumping.
- **API keys say whether they work.** The Discogs and FanArt.tv boxes show a brass ✓
  "Checked and working" or a red ✕ when the service refuses the key.
- Smaller fixes: the waveform redraws when its bar changes size; the share card no longer
  waits for ever on a font; ⓘ notes stay up long enough to read and are named for screen
  readers; the share card's × is a brass disc; leaving an artist's page through the side menu
  no longer brings it back on Back; a label logo not found with one key is looked for again
  once another key is given, and a logo search asked for while one runs is no longer dropped.

## v0.6.0
The release: everything in the release candidates since v0.5.50, settled.
- **Multi-disc albums show it.** An album of more than one disc — disc folders ("Disc 1",
  "CD2", "DISC 1"…) or disc numbers in the tags — has a two-disc symbol on its cover in every
  grid, bottom right, opposite the quality. Tracks in disc folders whose tags carry no disc
  number take the folder's.
- **The phone's symbol moved.** On an album's page, the sign that it's on this phone sits at
  the bottom right of the cover, no longer under the share button.
- **Random Album.** Home's "Play something unheard" tile is now Random Album: a brass disc in
  the middle of the tile, turning on its own centre, faster while an album is found.
- **Messages above the transport bar.** Toasts showed over the mini transport bar; they now
  sit just above it while it's on screen.

## v0.6.0-RC11
- **Back from an artist goes back to the album.** Tapping the artist on an album's page opens
  the artist's page; Back from there went to Home. Now it reopens the album you came from — the
  brass Back beside the menu and the phone's back gesture alike — and closing the album returns
  to where you started.
- **The artist page's Back is the brass < beside the menu**, as on every other screen, in place
  of its own "← Back" button.

## v0.6.0-RC10
- **Untagged albums named from their folders.** A file with no artist tag showed under "Unknown
  Artist", its album titled with the whole folder name. Now its names come from where it's filed:
  the artist from the folder above the album's (`808 State/10x10 (1993)`), or an
  "Artist - Album" folder; the album and year from the album's folder (10x10, 1993); the title,
  track and disc from the file name (`1-01 - Pacific State`). Only what the tags leave empty is
  taken; folders such as Music or 4tb are never an artist. Nothing is written to the files.
- **Then identified.** Those albums are looked up on MusicBrainz again under their new names, so
  a match can put back what folder names can't hold ("ex_el" → "ex:el"). The album page says when
  an album's names come from its folders.
- **Beatles are The Beatles.** Albums tagged "Beatles" and "The Beatles" were two artists: half
  the albums sat under "Also appears on", and each track carried the other name. Where the library
  has "The …", the albums tagged without it are shown under that name, so the artist page, search
  and links are one; it's filed under B either way. An artist you set yourself in Edit album stays
  as you set it.
- **Read once, only what's needed.** On the first start only the tracks without an artist or
  album tag are read again. Each album keeps its id, favourite, Listen later and play history.

## v0.6.0-RC9
- **Volume Levelling heard at once on Sonos.** Changing a Sonos room's Volume Levelling did
  nothing to what it was playing: a Sonos queue keeps the addresses it was loaded with, and only
  renderers were planned again on a change. Now the room's queue is planned again with the new
  gain and carries on from the same track and second (paused, it stays paused), as a renderer's
  does.

## v0.6.0-RC8
- **Album of the day stays put.** The server now chooses the day's album once, at the first ask
  after 00:01, and keeps it in its database. Before, it was worked out afresh on every ask from
  the date and the list of albums, so a scan that added or removed an album, or a restart or
  update while the library was being read, put a different album there mid-day — and one you had
  played came back as a "new" one. Now it is the same album on every device all day, through
  scans, updates and restarts; once played, from anywhere, it's gone until the next 00:01.
- **One album per folder.** Two copies of a record in two folders — "Random Access Memories
  (2013)" and "(2023)" — were shown as one album holding both sets of tracks, because an album
  was told apart only by its artist and title. Its folder now counts too: separate folders are
  separate albums, always. Disc folders inside an album's folder ("Disc 1", "CD2", "DISC 1",
  "cd 2"…) are still one album, shown disc by disc. The first start after the update puts merged
  albums right (one scan, no tags read again); favourites, Listen later, edits and identification
  stay with the album, and a renamed album folder stays the same album.
- **Mandarin's own words throughout.** Every tip, note, message and label carried over from the
  software Mandarin grew out of is reworded or gone; an unused streaming account, its browser
  and its menu entries are removed, along with its share card link.
- **README and site:** a list of everything new since the last beta (v0.5.50).

## v0.6.0-RC7
- **Volume Levelling, per device.** ReplayGain is now set on each device's own page (Settings →
  Audio Devices → the device, above DSP) rather than once for everything: Off, Track, Album or
  Auto. With it on, a **Target volume level** from −14 LUFS (the default) to −25 LUFS replaces
  the pre-amp, and **Volume adjustment when loudness is unknown** (0 to −12 dB, −5 by default)
  sets the level of a track with no ReplayGain tags. A phone's setting goes to the app, for its
  downloads too. Every device starts Off; the old Settings → Loudness page is gone.
- **Library Scanner.** Identify albums is renamed Library Scanner and sits under Music Folders.
  It holds **Measure ReplayGain** (what was Measure loudness), under Ask iTunes.
- **Help behind ⓘ.** Longer explanations on the settings pages — Library Scanner, Audio Devices,
  Downloads, Away from home — now open from an ⓘ after the setting's name, as Smart Picks' do,
  with a short line left under each. The ⓘ is the size of the name it follows.

## v0.6.0-RC6
- **Moving the music to another zone works.** Choosing another zone while something plays asks
  whether to move it there; Yes did nothing, because the page and the server named the two
  zones differently and the server refused the request without the page saying so. Yes now
  carries the queue over and plays on from the same track and second in the new zone (the old
  one stops), and a toast says it moved, or why it couldn't.

## v0.6.0-RC5
- **Every tag is kept.** The scanner reads all of each file's tags into the database — not only
  the names it shows — including identifiers (MusicBrainz IDs, barcode, catalogue number, ISRC,
  country) and ReplayGain. The library is read once more after the update to collect them.
- **Albums are identified by what their files carry, first.** A MusicBrainz release ID in the
  tags is taken as it is; then a barcode, then a catalogue number with its label, then the
  tracks' ISRCs — each before any search by name. iTunes is asked by barcode too. The Applied
  list says what matched ("matched by barcode").
- **ReplayGain.** Settings → Loudness: Off (the default), Track, Album or Auto, and a pre-amp.
  Auto takes the album's gain while a record plays in order and the track's when records mix.
  Peaks cap every gain, so nothing clips. On Sonos and renderers the gain goes into the stream
  (converted to FLAC); the Android app applies it itself, downloads included.
- **Loudness measured for files without tags.** A switch on the same page measures them on the
  server (EBU R128 loudness and true peak), one at a time in the background, with progress shown;
  an album's gain is worked out once all its tracks are known.

## v0.6.0-RC4
- **The app and the browser show the same Home row.** "Not played in 6 months" was fetched only
  while the row was empty: once it held tiles — including the Home saved for an instant open — it
  was never fetched again, so the app could show yesterday's Album of the day, or a one-album list
  left from an offline session, while the browser showed today's. It is now fetched afresh every
  few minutes and when you come back to the app or the tab.
- **Album of the day, in step everywhere.** A new one at 00:01 (in the server's time zone, `TZ`),
  the same on every device; once played — from any device — it's gone from all of them until the
  next 00:01. Each page asks the server every minute while Home is open, and on coming back.
- **Not played in 6 months waits for six months of listening.** Until Mandarin has been played
  for six months, every album would count as "not played", so the row offers only Play something
  unheard and the Album of the day; its full page says from which date albums will show.
- **The share card's Download saves the card in the app.** The button (there since the card was
  first made, for browsers) did nothing in the Android app, whose WebView ignores download links;
  it now saves the card to the phone's Pictures/Mandarin and says so.

## v0.6.0-RC3
- **DSD to UPnP/DLNA renderers, as it is.** A DSD64 album on a Chord Poly arrived as 176.4 kHz
  PCM: every renderer was sent DSD as PCM. Now a device that says it takes DSD files (in its
  GetProtocolInfo, as the Poly does) is sent the DSF or DFF file itself, named as the device
  names it — at the DSD rates its page has on: those known for its model (DSD64–256 for a Poly),
  or DSD64 for a device without a profile. Tap a DSD rate off on its page and that rate goes as
  PCM again. Now playing shows "DSD64".

## v0.6.0-RC2
- **"Play something unheard" plays again.** The tile on Home (and the compass) said
  "zone_or_output_id required": the page named the zone one way and the server read it another.
  Both now agree (and the server takes either), and the message says which album started.

## v0.6.0-RC1
The first release candidate for 0.6.0: everything up to v0.5.58, settled.
- **Release candidates update in order.** The app, its update check and the server's updater now
  read "-RC1" as a release candidate: 0.6.0-RC1 is newer than 0.5.58, RC2 newer than RC1 (and
  RC10 than RC2), and 0.6.0 newer than any of them. Before, the app ignored the "-RC1" and
  wouldn't have offered 0.6.0 over it.

## v0.5.58
- **Offline shows only what's on the phone.** With no connection, Home showed the server's albums
  (Random albums, Library and the rest), which then wouldn't open: the page painted the last Home
  it had saved while online. Offline it now shows only the phone's music folder and downloads;
  the saved Home is kept for the server, untouched.
- **Offline mode.** A switch at the top of the menu, and in Settings → Downloads: the app as if
  there were no connection — only the music on the phone, and nothing asked of the server (no
  Sonos rooms, downloads wait, no Tailscale), even when it could be reached. Off again, the server's
  library is back.
- **No server playlists offline**, and an album left open isn't reopened offline unless it's on
  the phone.

## v0.5.57
A review of the whole Android app, and everything it found put right.
- **Unplugging the USB DAC mid-song no longer crashes the app.** The stream was freed while the
  audio was still being written to it. Unplugging anything else (a USB stick) no longer stops
  the DAC either.
- **Removing downloads doesn't freeze the app.** Albums are deleted in the background, however
  many gigabytes.
- **Offline, the page stays where you left it.** After the network went with the app open, every
  return to the app reloaded the page to Home. Now it stays put, and goes back to the server only
  once the server answers.
- **Update doesn't freeze the screen** when a downloaded update is checked before installing.
- **Android's backup leaves out this phone's sign-in and Tailscale identity** (restored to a new
  phone, two phones would have shared them) and the caches, which it rebuilds.
- **A download cut short is never taken as finished.** Each track must arrive at the length the
  server gave; Opus downloads start a track afresh rather than joining two halves.
- **Downloads run with a notification**, so Android lets a big album finish in one go rather than
  stopping it every ten minutes.
- **Lighter on the phone:** the downloads list is read from storage once, not on every request;
  the space downloads use is counted in the background; the player never reads storage on the
  screen thread; and a big music folder is re-read less often while the app is open (in step with
  how long a read takes), still every half minute for most.
- **Reports to the server don't pile up** when it's slow: only the newest is sent.
- **An offline play the page was told had failed doesn't start a few seconds later anyway.**
- **Moving downloads doesn't cut off the track playing**: its old copy goes when the track is done.
- **No "Can't reach Mandarin" notification with no network**, and the widget no longer tries to
  start something Android refuses from the background.
- **Android Auto's Random and Smart Picks lists open faster** (covers fetched four at a time).
- **Phone-music covers and tags stay current**: a replaced cover is picked up, and Rescan tries
  again the files whose tags couldn't be read.
- **No offline play is lost** when one is made while earlier ones are being sent.

## v0.5.56
- **No freeze when the network goes with the app open.** The freeze report from v0.5.55 showed
  the cause: the lock-screen, notification and widget controls for a Sonos room were redrawn on
  the app's screen thread every time the server couldn't be reached, and each redraw copied the
  album cover to Android. They're now drawn on their own thread, only when something shown has
  changed, with the cover kept small and shared rather than copied. With no network they wait
  quietly instead of trying again and again.
- **Offline at once.** The app now follows the phone's network itself: when the last network
  goes, it switches to its own copy of Mandarin within a second (it could take up to ~45 s), and
  drops connections to the server that would only hang. When a network comes back, it looks for
  the server straight away.
- **No Tailscale with no network.** With no Wi-Fi or mobile data the app no longer starts and
  restarts its Tailscale connection for minutes; that also held up its other checks.
- **Connections that go silent are dropped** after a minute instead of hanging the page.
- **Back always does something.** If the page doesn't answer, Back leaves the app.
- **Missing covers come back.** A downloaded album whose cover didn't arrive with it gets it the
  next time the server is reached, so it isn't a blank tile offline.

## v0.5.55
- **The app opens with no signal at all.** With Wi-Fi and mobile data off (or no SIM), the app
  could sit on its start-up logo until force-stopped. With no network it now opens straight onto
  its own copy of Mandarin — Home, the phone's music folder, downloads and the player — without
  first setting up the way to the server, which needed a network. A VPN app left on with nothing
  under it no longer counts as a network.
- **Never held at the start.** If the WebView doesn't confirm its link to the server within a few
  seconds, the page opens anyway rather than waiting for it.
- **Back online by itself.** When Wi-Fi or mobile data returns, the app finds the server again
  and moves the page back to it; no force stop needed.
- **This phone in Audio Devices with no network.** Offline, Settings → Audio Devices said "the
  network is being searched" and listed nothing. It now lists this phone, with its page: the USB
  DAC on its port (and the switch to play through it), and its DSP, which can be changed offline,
  plays at once, and is handed to the server when it's back.
- **This phone is already chosen.** When the phone is the only player (no network, or away from
  home), the zone picker picks it, not "Choose a zone…".
- **The DSP curve offline.** The script that draws it is now part of the app's own copy.
- **A freeze leaves a note.** If the app's screen ever stops answering for ten seconds, what it
  was stuck on is kept, and the next start offers it to share — like a crash report.

## v0.5.54
- **One Settings list.** Setup's pages — Away from home, API Keys, Smart Picks, Record labels,
  Discover, Identify albums and Updates — are back on the Settings list, in the same order, where
  Setup was; the Setup page is gone. All fourteen fit on one screen, and Back from any of them
  returns to the list.

## v0.5.53
- **Settings closes from the left.** The × on the Settings list is now to the left of the title,
  where every page's Back is.
- **The side menu covers the mini transport bar.** The bar showed over the open menu; the menu
  now sits above it.

## v0.5.52
- **An album moved off the phone leaves Home at once.** Taking the last album out of the phone's
  music folder (moving it to the server, say) left its tile on Home until the app was closed:
  the app had noticed, but the Home row's "nothing here" step stopped with an error before it
  could redraw. Fixed, and the empty row hides as it should.
- **No change to the folder is missed.** A change noticed while the folder was being read was
  dropped; it is now read once more when the read ends, so an album moved out file by file is
  always caught. While the app is on screen the folder is read every half minute (every three
  minutes behind it), and coming back to the app shows the list as it stands straight away.
- **A tile that's out of date tidies itself.** Opening an album that has left the phone says so,
  takes its tile off Home and the Music on device wall, and goes back to where you were.

## v0.5.51
- **Play to another phone.** A phone running the Mandarin app is now a player for your other
  devices at home too: your phone lists the FiiO R7 (and the R7 your phone) under its own name,
  and can play, queue, pause, change the volume and move music to it, as with any room. To
  itself it is still "This phone". It shows while the app is running on it and the phone is at
  home; away from home it plays for itself only. Audio Devices → the phone → **Other devices can
  play here** switches it off. Before, a phone was only ever a player for itself.

## v0.5.50
- **Adding to the queue while the phone plays a download.** When the phone was playing a list of
  its own — a downloaded album played while the server couldn't be reached, or the phone's own
  music — an album added with Add to queue or Play next went to the server's queue, which the
  phone wasn't playing, and the phone dropped it without a word. Now it goes into the list the
  phone is playing: at the end, or straight after the current track. Downloaded tracks play from
  the phone, the rest stream, and the queue shows them with their covers. Play Now also leaves
  the phone's own list at once, so an album queued straight after goes where it should.

## v0.5.49
- **iTunes as a second opinion for identification.** An album MusicBrainz can't place is now
  looked up in Apple's iTunes catalogue too — no account or key, one request every 3.2
  seconds, a quarter-hour pause if Apple asks us to slow down. What iTunes finds is applied only
  when it fits exactly: every track there, every length within a few seconds, every name the
  same. Anything less is proposed. Apple's release date is often a reissue's, so the album keeps
  the year its files carry. Albums already unidentified are asked of iTunes once, by
  themselves, after the new albums; MusicBrainz isn't asked about them again. Find match in the
  album editor lists iTunes's albums too when MusicBrainz has nothing near, marked "iTunes".
  Settings → Setup → Identify albums → **Ask iTunes too** switches it off; `ITUNES_COUNTRY`
  picks Apple's store (US by default).

## v0.5.48
- **Away from home over the app's own Tailscale stays connected.** On Android, Tailscale
  re-reads the phone's network only every ten minutes unless its host app says the network
  changed and which connection carries the traffic — the Tailscale app does, Mandarin's engine
  didn't. So after Wi-Fi to mobile data, a new mobile address, or another VPN coming on or
  off, the tunnel kept using the old network for up to ten minutes and the app went offline
  while the server was fine. Now the app hands the engine the phone's default route with its
  interfaces, a change makes Tailscale look again at once, and when the server doesn't answer
  the app has Tailscale rebind its sockets before giving up.
- **No more "On this phone" screen at a cold start away from home.** Opening the app on
  mobile data could land on the app's own downloads screen, with "Try the server again"
  working at once: the app looked for the server once for three seconds while its Tailscale
  engine was still coming up, switched to its offline copy of the page, then took the first
  page load's late failure for the copy failing. Now it looks three times over about ten
  seconds before going offline, and a failure while the offline copy is up is left alone —
  that screen is only for an app with no copy of the page at all.

## v0.5.47
- **Many more albums identified.** Another pressing of the same record is no longer a rival:
  an edition with a bonus track, or a remaster, used to leave a 100 % match "proposed" because
  "two releases fit"; now the record is applied and the pressing is a detail. The search asks
  MusicBrainz for forty results rather than ten, a loose search by the title's words runs when
  the phrase finds nothing near, and when the best fit hasn't the copy's track count the
  record's other editions are fetched too — the deluxe the search didn't list. A release
  MusicBrainz has without track lengths is judged by its names and applied on an exact fit
  rather than left unidentified. Settings → Setup → Identify albums → "Check the proposed and
  unidentified again" runs the leftovers under the new rules.
- **Music folders from anywhere.** Settings → Music Folders works away from home too, over
  Tailscale — it used to answer "Change music folders from home".
- **No stray scrollbar in Settings.** While Settings is open the page behind it stays put,
  so a Settings page with nothing to scroll shows no scrollbar.

## v0.5.46
- **The repository is now `meltface-80/Mandarin`.** Every address the server, the page, the
  Android app and the docs carry now names the new repository: the update check, the APK
  download, the Tailscale engine download and the user-agent strings. GitHub redirects the
  old name, so installs on earlier versions still find this update. The Docker image, the
  container and the data volume keep the `musicd-server` name, so nothing changes for a
  running install.

## v0.5.45
- **Lighter previous and next discs.** The two brass discs on the album art are now much
  more translucent, so the cover shows through them; the brass rim and the dark chevron
  keep them easy to find. Pressing one still firms it up a little.

## v0.5.44
- **Previous and next on the album page.** An album opened from a list — a Home row, an
  artist's albums, a label's, the Library wall, search results — knows the albums beside it.
  Two discs at the top of the page step to them, a swipe left or right does the same on the
  phone, and the arrow keys do on a keyboard; each opens exactly as its own tile would. At the
  first or last album the disc for that direction is dimmed. Back still returns to the list.

## v0.5.43
- **Now playing shows the whole cover.** A framed square at a steady size, not bled to the
  screen's edges and no longer faded into the ground at the bottom; the tabs and the corner
  buttons sit above it, never over it.

## v0.5.42
- **Graphite and brass.** The theme is flat now: a warm charcoal ground in place of the green,
  no felt grain or mottle on the ground, Now playing or the panels, no glow under the covers.
  The brass is the one accent — the headings, the top bar's discs, play, the lit segments of
  the progress meters (which stay, on the mini player and Now playing), the volume controls
  and the glyphs — and the plum is gone. The app's window matches before the page loads.
- **The icon to match.** The app's launcher icon and the home-screen icon of the web app are the
  duck in brass on the same charcoal.

## v0.5.41
- **The download folder is its own setting.** Settings → Downloads → Download folder: a folder
  of your own on the phone or an SD card, chosen on its own — nothing to do with the music on
  the phone. Before, downloads could only go into the music folder's Mandarin sub-folder, and
  forgetting that folder hid the downloads with it. A phone set up the old way carries on with
  the same place, now remembered separately.
- **Music on this phone watches its folder.** The folder is read again by itself when Android
  reports a change in it, when the app comes back to the front, and every few minutes while
  the app is open; a read of an unchanged folder is a listing, the tags kept from last time.
  Music moved away goes from the Home row, which hides when there is nothing in it; music
  added shows up. The setting has moved to Settings → Music Folders, with the server's.
- **The server's music folders are watched too.** A folder added, files copied in, an album
  deleted or renamed are noticed through the file system's own notifications and read within a
  minute, gathered into one scan; the timed rescan stays for what the file system doesn't
  report (a change made on a network share from another machine).

## v0.5.40
- **Native DSD over USB (Stage 9, part 3).** A DSF or DFF file goes to the DAC as DSD: natively
  on the DAC's DSD alternate setting (the Audiolab 8300CD: DSD64, 128 and 256), or as DoP on a
  DAC that takes 24-bit PCM at a sixteenth of the DSD rate. The app reads both containers
  itself (Media3 knows neither), and the DSD setting on this phone's page chooses Native,
  Native with the words reversed (for a DAC that plays noise the usual way), DoP, or PCM from
  the server as before. A DSD track the DAC can't be given is sent again as PCM.
- **Hi-res as it is, with USB direct.** The phone tells the server what its DAC takes — rates,
  depths, DSD — and the server plans the queue for it like a renderer's: a 24/96 or 24/192
  file as it is where the DAC takes the rate (the Sonos 24/48 rule no longer applies), FLAC at
  the best rate the DAC takes otherwise. The queue is planned again the moment the DAC comes,
  goes or changes, from where it was. The badge reads "USB DSD64 ✓" or "USB DoP DSD64 ✓".

## v0.5.39
- **USB direct: silence on the next track, fixed for real.** The diagnostics showed it: the
  stream opened for a new track was never started. ExoPlayer says play once, when playback
  starts, not again when the sink is configured for the next track — Android's own sink
  restarts its track itself, and the USB sink now does the same, so a skip, a new album or a
  format change plays on. (v0.5.38's engine change stands: the packets run continuously.)
- **Discogs token back on the API Keys page.** Its block was hidden from before record labels
  existed, so the token could never be entered — and without a Discogs token or a FanArt.tv
  key the logo pass had nothing to look with. Saving either now starts the pass at once.

## v0.5.38
- **USB direct: the DAC's volume starts low.** A DAC with a USB volume control came up at
  its own level — the DragonFly at full. The driver now sets the volume before the stream
  starts: at 10% whenever USB direct is switched on or a DAC is plugged in, and where the
  slider was set since on the tracks that follow. The slider follows a
  loudness curve (50% is -18 dB, 20% is -42 dB) rather than a straight line across the DAC's
  stated range. The Audio Devices page shows the level and the DAC's range while streaming.
- **Fixed volume, a volume limit, and the phone's buttons.** Under USB direct: a Fixed
  volume switch — on, the DAC is driven at full and the amplifier sets the level (the
  default for a DAC with no USB volume control); off, the slider and the phone's volume
  buttons drive the DAC's own control, or scale the samples in software for a DAC without
  one (the default for a DAC with its own control, like the DragonFly). A volume limit
  (default 80%) that the slider can't pass, so a DAC on headphones is never driven to full.
  The phone's volume buttons, the lock screen and Bluetooth controls move the USB level
  while the app plays through the DAC (the media session reports a remote device).
- **USB direct: silence after a skip or a new album, fixed.** The stream was stopped and
  restarted on every pause and seek, and the DAC could go quiet after that until its
  interface was selected afresh; the track then ran on with no sound and moved on. The
  engine now runs the packets continuously while the stream is open — PCM while playing,
  silence when paused, between tracks or on an underrun — so a skip only empties the
  buffer. The position counts only PCM the DAC has taken, and a stream that stops
  completing packets for a second is reopened from where it is. The diagnostics carry
  the engine's last events.

## v0.5.37
- **Bit-perfect USB (Stage 9, part 2).** With USB direct on (this phone's page in Audio
  Devices), the app plays through its own USB audio driver: the DAC is fed the track at its own
  rate and at the DAC's depth, Android's mixer out of the way — bit-perfect with the DSP off,
  the DSP's output at the DAC's rate with it on. Asynchronous DACs are paced by their feedback;
  adaptive and synchronous ones by the clock. The DAC's own USB volume control, where it has
  one, is what the volume slider drives (the DragonFly); otherwise the volume is fixed at full.
  A rate the DAC doesn't take, or the DAC unplugged mid-track, falls back to Android's track.
  The badge reads e.g. "Lossless · USB 24/44.1 ✓"; the page shows the stream's feedback and
  underrun counts. DSD comes in part 3. (Merged into v0.5.36 first; this version exists so
  the app's updater offers the build.)

## v0.5.36
- **The USB DAC, found and read (Stage 9, part 1).** In the Android app, a DAC on the USB
  port shows on this phone's page in Audio Devices: Android's permission for it (asked once),
  then what its descriptors say — USB Audio Class 1 or 2, sample rates (a UAC2 DAC's clock is
  asked for its range), bit depths, native DSD, a USB volume control, the bus speed — with a
  Copy button for the full diagnostics. Plugging a DAC in offers Mandarin. Nothing plays
  through it yet: that is part 2, and the USB direct switch waits for it.
- **The duck, bolder and in orange.** A Mandarin duck's orange on the plum, the line art
  thickened, centred on the duck itself and larger, and the level meter gone: the duck alone
  is the icon, on the launcher and the web app alike.

## v0.5.35
- **The icon in plum.** The duck is white now, on the plum of the transport controls, with the
  gold level meter kept: the Android launcher (square, round and adaptive), the web app's
  icons, the Apple touch icon, the favicon and the site's.

## v0.5.34
- **A Playlists row on Home.** Your playlists and the Dynamic Playlists on one shelf (the
  side menu keeps their two screens): yours first, newest change first, then the Dynamic ones
  marked "Dynamic · N albums", each a mosaic of its albums' covers. Tap a tile to open it, the
  title for the Playlists screen. In the Home Screen settings like the other rows; hidden
  until there is a playlist to show.

## v0.5.33
- **Tracks added to a playlist are completed from the library.** An entry that arrives
  without everything the stored record needs (the album's id, its title, the track's title)
  is filled in from the library — the album by its id, else by its names; the track by its
  place on the album when the title agrees, else by its title — instead of being skipped. When
  one still can't be stored, the toast says why ("album not in the library", "track not on
  that album"). Fixes a playlist saved with 0 of its tracks.

## v0.5.32
- **Playlists can be named in the Android app.** "＋ New playlist…" (from chosen tracks or
  albums), Focus → "Save as…" (a Dynamic Playlist) and "Save as a playlist" after an import
  used the browser's own name box, which the app's WebView has no dialog for: it answered
  "cancel" every time, so the sheet closed and nothing was made. The page now asks with a
  dialog of its own, in the app and the browser alike.
- **Sharing is MusicD Remote's format.** A playlist shared from here (Share → the MDRP1
  text) imports into MusicD Remote, and one shared from there imports here, with the same
  found / substituted / missing report. Covered by tests now.

## v0.5.31
- **Labels for albums whose files carry none.** With Record labels on, each album without a
  LABEL tag is looked up in the background — MusicBrainz first (a release by that title and
  artist, its label), then Discogs with your token — and kept by the album's identity, so a
  library rebuild keeps it; a miss is asked again after a month, or at once with Force rescan.
  The files' own tag always wins. The Settings page counts tagged, looked-up and untagged
  albums; the scan log says what each lookup found. (Stage 8, part 3 — the last.)

## v0.5.30
- **Merged labels and logos.** On the Labels screen, hold a tile to select labels and merge
  them into the first (the tile shows "N merged"; tap that to undo one at a time). Logos are
  found in the background for every label without one — Discogs first (your Discogs token in
  Setup → API Keys), then FanArt.tv by the label's MusicBrainz id (your FanArt.tv key) — and
  kept in the data folder, served like album art. On a label's page the picture button offers
  Discogs' candidates or takes a pasted address. The Settings page counts the logos; Force
  rescan looks again for the ones not found. (Stage 8, part 2.)

## v0.5.29
- **Record labels, from the tags.** Settings → Record labels (off by default) turns on a Labels
  screen in the side menu, the label on the album page and share card, labels in search, a
  Record label facet in Library Focus and a Label of the week row on Home. Each album's label
  is its files' LABEL tag, read with the library; spellings of one label fold together
  ("Blue Note Records (UK)" is *Blue Note*), and a name that isn't a label's (a management
  company, "Unknown") is left out. A library filed by label can take the label from the
  folder at a set depth instead. The Settings page counts the albums with and without a label
  tag. Merges, logos and lookups for untagged albums follow. (Stage 8, part 1.)

## v0.5.28
- **Listen later.** Put an album aside to play another time: on its page, ⋯ → Listen later, or
  select several albums on a wall and choose Listen later. They are a Home row and a wall of
  their own (also in the side menu), newest first, kept on the server by the album's identity
  so they survive a rescan. An album comes off the list by itself once every one of its tracks
  has been played since it was put aside — on any zone — or by hand. (Stage 7, the last of the
  roadmap.)

## v0.5.27
- **Downloads that outlive the app.** Settings → Downloads → Save to now offers the music
  folder's own “Mandarin” folder (the folder chosen for Music on this phone, on the phone or an
  SD card) beside the app's private storage. Albums saved there survive an uninstall: a fresh
  install pointed at the same folder finds them again, each album's own index file being the
  record. Writing plain files there needs Android's all-files access, granted once in the
  system settings (the page has an Allow button). “Move all here” carries existing downloads
  over, album by album, with progress; albums on a card that is out show as away rather than
  vanishing. The private store stays the default. (Stage 6.)
- **The Home row for music on the device shows.** It is called *Music on device*; the server's
  saved Home row order didn't know the row, so the page never showed it.

## v0.5.26
- **Music on this phone.** In the Mandarin app, Settings → Downloads → Music on this phone
  takes a folder chosen with Android's folder picker — purchases waiting to be moved to the
  server. The app reads its tags and covers (the folder's own “Mandarin” sub-folder is for the
  server's downloads), keeps a small index on the phone, and shows the albums on Home as
  “On this phone”, with a wall and an album page of their own. They play on the phone, through
  its DSP, whatever zone is picked; the page shows what's playing and the queue as for any
  zone. The server never sees these files. (Stage 5.)

## v0.5.25
- **Headphone profiles from AutoEq.** On a device's DSP page — the phone's, or a renderer
  feeding a headphone amp — choose a headphone by name: AutoEq's index of measured headphones
  and earphones is fetched once a day and kept in the database, the chosen profile fetched once
  and kept for good, and its bands (up to ten, with the profile's own preamp) run before the
  PEQ's. A profile can also be pasted from a ParametricEQ.txt. Headroom stays automatic: the
  profile's preamp when it covers the bands' combined peak, else half a dB under that peak.
  (Stage 3, complete.)

## v0.5.24
- **DSP on the phone.** The Mandarin app has its own engine: the phone's setting (Audio
  Devices → this phone, at home or away) runs on everything the phone plays — the server's
  stream, Opus away from home, downloads — in 64-bit float, the headroom first, then the
  bands, out to Bluetooth, USB or the speaker as float. The setting comes with the app's
  hello and whenever it is saved, and is kept on the phone so it applies offline. The badge
  reads "· DSP" while the engine is at work. (Stage 3, second part; AutoEQ profiles next.)

## v0.5.23
- **DSP for UPnP/DLNA renderers: a parametric EQ per zone.** On a device's page in Audio
  Devices, a DSP switch and up to ten bands — peak, low shelf, high shelf, low-pass,
  high-pass — with the response drawn as they are edited, and Save. With DSP on, every track
  is decoded to 64-bit float, the headroom taken, upsampled if the Output settings say so,
  the bands run (double precision), then dithered once to 24 bits (32 where the device takes
  it); off, the device gets the file as stored, as before. Headroom is automatic — half a dB
  under the bands' combined peak, not the largest band — or set by hand. A change is heard
  from the next track. Sonos rooms have Trueplay and no DSP. The phone's own engine and
  AutoEQ headphone profiles follow in the next two versions. (Stage 3, first part.)

## v0.5.22
- **Opus 256 is 24/48 end to end.** Opus is a 48 kHz codec; a 44.1 kHz file now reaches the
  encoder through the same 64-bit float SoX resample as the FLAC conversions (it was ffmpeg's
  default resampler), and the encoder is fed float. On the phone the app carries Media3's own
  Opus decoder over libopus, built into the app, which decodes to float where Android's decoder
  gave 16-bit; the audio path to Android's mixer is float. The Now playing badge reads
  "256 · 24/48" when that decoder is at work. New Opus files are made afresh on the server;
  Opus downloads already on the phone stay as they were. (Stage 2 of the roadmap.)

## v0.5.21
- **Away from home, Audio Devices shows this phone.** The page was empty on mobile data, since
  it is a home-only page and the app over Tailscale counts as away — yet the phone is the one
  player there is away, and its own settings live on that page. The app now sees the phone it
  is on there, and nothing else; Sonos rooms and streamers, and the network search, stay at
  home. A browser away still sees no devices. (Stage 1 of the roadmap.)

## v0.5.20
- **More of the plum.** The top bar's menu and search and the album view's back, home and
  share are now a plum disc with the glyph in the pale plum; the side menu's icons are the
  plum; the open search box is a plum pill with a plum glass; and the volume controls, on Now
  playing and above the mini player, are plum through — speaker, number, 0 and 100, − and +,
  and a slightly smaller thumb.

## v0.5.19
- **The duck's purple.** Mandarin's buttons take a plum: the top bar's menu, search and
  settings and the album view's back, home and share sit on a pale plum disc with a plum
  ring and a plum glyph; the glyphs on their own — the mini player's zone and volume, Now
  playing's device, volume, previous and next, and the icons down the Settings list — are the
  same plum; play/pause, on Now playing and on the mini player, is a plum disc.
- **One look.** Mandarin Light and the Settings → Appearance page are gone; the theme is
  Mandarin, the dark one. The sample rate badge on artwork is always on, so its switch went
  with the page.
- **The PWA and the Android app are the same page.** Settings fills the screen and lists its
  pages as the side menu does, with a close button, in the browser and on the phone alike;
  the app's own stylesheet keeps only what the WebView needs.

## v0.5.18
- **Now playing's seek bar is the same level meter as the mini player's** in the Mandarin
  themes: gold segments over faint ones, the thumb riding along them. A track with a waveform
  keeps its waveform, as before.

## v0.5.17
- **An update no longer loses what was playing.** A Sonos room keeps its queue on the speaker,
  but a phone's and a UPnP renderer's lived only in the server's memory, and an update ends in a
  restart — so the queue was gone and the page said nothing was playing. Those queues are now
  kept in the database as they change (the place in the track every ten seconds while it
  plays) and put back when the server starts. A renderer still playing the track it was given
  is recognised at once and carries on to the next; the phone zone shows its track, paused,
  until the app reports in, and the app is handed the queue back if it was restarted too. The
  app also starts playing again by itself once the server answers, where playback had given
  up during the outage. Browser, PWA and app alike, since the page only shows what the
  server holds.

## v0.5.16
- **Opening the search no longer makes the top bar taller.** The search box was 48px against
  the 40px buttons beside it, so the bar grew by 8px and the whole page shifted down each
  time it opened, and back when it closed. The box is now the buttons' height.

## v0.5.15
- **CI no longer hangs on ffmpeg.** The test and release jobs installed ffmpeg with apt, and
  a GitHub runner whose apt mirror stalled sat in that step for the whole hour. They now take
  a static ffmpeg build from a cache (no apt), and the jobs are capped at fifteen minutes.

## v0.5.14
- **The search bar's × closes it too.** With text in the field the × clears it, as before;
  tapped again with nothing to clear, it closes the bar (what tapping away does). Browser,
  PWA and the app alike.
- **Android app: the mini transport bar keeps out of the keyboard.** The app's WebView
  shrinks the page to fit above the keys, so the bar rode up and sat on them while you typed.
  While a text field has the focus the app hides it; it is back the moment typing is done.
  The PWA on an iPhone never had this, and is unchanged.

## v0.5.13
- **Smart Picks, tidied.** The Home carousel no longer shows the "Because you have been
  playing…" line under each tile (it is on the Smart Picks page). On that page every card
  lays out the same: a long reason used to push the text under the cover on that one card.
  The button that opens a pick's album page now says **Open**, which is what it does.

## v0.5.12
- **A paused track survives the phone's sleep.** Android stops the app's idle player after a
  while; when it came back, its hello to the server started the phone zone afresh and what was
  paused was gone ("nothing playing"). The server now keeps the phone's queue across a hello
  and hands it back; the app puts it on its player at the same place, paused, without fetching
  a byte until you press Play. The zone shows the paused track throughout.
- **The way to the server is repaired without airplane mode.** Away, once the page had fallen
  back to the app's own copy, it only asked the server whether it was back — it never had the
  route looked at again, and the Tailscale engine's tunnel can go stale while the phone sleeps.
  Only a change of network (airplane mode on and off) mended it. Now the offline watch checks
  and repairs the route each time it looks, the phone player does the same after three
  failures in a row, and an engine that still can't reach the server after its connections are
  dropped is started afresh (its sign-in is on disk, so that takes seconds).
- **The album page opens smoothly in the app.** On the WebView, three things cost frames while
  the panel slid in: a blur over the whole page behind it (hidden by the panel anyway), the
  panel's full-screen shadow, and a blurred ambient layer under a moving panel. The app's
  stylesheet drops all three (the ambient wash stays, unblurred — a tiny cover scaled up is
  soft enough), and the cover is decoded off the main thread.

## v0.5.11
- **Find match in the album editor.** Album page → ⋯ → Edit album now has, under the cover, a
  **Find match** button like Find cover: the releases MusicBrainz has for the album, scored
  and listed best first with the year, the pressing, the country and the track count, and a
  *Match* or *Likely* mark on the top one. Tap one and it is applied at once — artist, title,
  year and every track title — with the editor and the album page following; Undo is on the
  Identify albums page. Under the list, a box for the **barcode** or a MusicBrainz link, for
  an exact match.

## v0.5.10
- **A ripper's "null" is not part of a name.** Tags like `null: Line Up (null)`, `Line Up -
  undefined` or `(Unknown)` are tidied before anything is compared, searched for or paired,
  so such an album scores as its titles deserve and every track takes its release name when
  the album is matched. (Albums already applied with those tracks left unpaired: Undo, then
  Check again.)
- **Match by barcode or link.** Every proposed, unidentified or declined row on the Identify
  albums page has a **Barcode…** button: type the digits under the bars on the sleeve, or paste
  the address of the release (or the album's release group) on musicbrainz.org, and that
  release is written to the album whatever the scan thought — the surest match there is, since
  a barcode names one pressing. The row then says *matched by barcode* (or *link*), with Undo
  as for any applied match.
- **A copy missing a track is still the record.** The search no longer asks MusicBrainz for
  exactly the copy's track count (an eleven-track release never came back for a ten-track
  copy: "nothing with this title"), and tracks are paired by likeness of title and length,
  not by number, so with track 3 gone tracks 4 to 11 still find their own. Each release track
  missing from the copy costs a little (beets' 0.9), each track the release hasn't a little
  less (0.6), instead of a flat penalty for the count; a ten-of-eleven copy with everything
  else right is applied. A paired track takes its release track's name; one paired with
  nothing keeps its tag. The page says "1 track of the release missing here".

## v0.5.9
- **Identify albums names the album, not the pressing** — Roon's model, in MusicBrainz's terms.
  The record you have is one *release* of a *release group*; the group is the album. The scan
  now searches with the edition set aside ("Kid A", not "Kid A (2015 Remaster)"), scores a
  tag title against both the group's and the release's, and treats a tag year as right when it
  is the original's or the pressing's or the one the title names. What it writes is the
  **group's title and its first release year** (1988, not 2015) and track titles with any
  remaster tail removed ("Tune 1", not "Tune 1 - 2015 Remaster"); "(Live)", "(Deluxe
  Edition)" and a featured artist are part of a name and stay. The page shows the pressing's
  own facts beside the album — *2015 remaster · released 2015*.
- **Check the proposed and unidentified again** on the Identify albums page: forgets those
  verdicts (not declined, not applied) so the scan revisits them with the new scoring.

## v0.5.8
- **Identify albums** (Settings → Setup → Identify albums). A scan that finds each album's
  right names on MusicBrainz — no key, one request a second, the app named in its User-Agent —
  from what the files already say: the title, the track count, the artist where the tag can be
  trusted (never "Various Artists", "Unknown", blank or the album's own title), and above all
  each track's title and length. The likeliest releases are scored beets-style (distance 0 to
  1: album 3, artist 3, year 1, track count 3, per track title 3 and length 2, lengths free
  within 15 s). At most 0.04 apart — 96 % alike, the 95 % asked for — the match is **applied**:
  artist, title, year and the track titles are written to the database, the album edit overlay
  and a new `track_edits` overlay, and the files are never touched. Up to 0.15 it is
  **proposed** on the page with Accept and Reject; beyond that, or when two different releases
  fit equally, the album is **unidentified** for you to name by hand (tap the row, then ⋯ → Edit
  album). Applied names have **Undo**; every verdict is kept (`album_matches`), so an album is
  looked at once, an unidentified one again after a month, and none you edited by hand at all.
  Verdicts and overlays survive rescans and a rebuilt database.
- **Scheduling** on the same page, on by default: the scan runs between a start and an end time
  each night (01:00–06:00 to begin with, the server's clock; a window over midnight works). Off,
  it runs whenever the library isn't being scanned — about twelve albums a minute — until every
  album has been looked at. Progress and what it is doing right now are shown on the page.
- The ⋯ menu on an album's page opens **above** its button, so every item is on screen
  without scrolling.
- `MUSICBRAINZ_URL` and `IDENTIFY=0` for tests and odd setups (a mirror, or no scan at all).

## v0.5.7
- **Favourites.** Every album's page has a heart, first in its row of buttons (the size of the
  ⋯ button at the other end): hollow, red once tapped, kept on the server by the album's
  identity so it survives a rescan. A **Favourites** carousel on Home shows them the moment one
  is hearted, newest first; tapping its title opens the full wall. It is in Home Screen's list
  of rows like the others.
- A written plan for finding an album's right names from its tracks —
  `docs/specs/album-identification.md` — for review before anything is built.

## v0.5.6
- **Renderers send their changes (UPnP events).** Mandarin subscribes to each renderer's
  AVTransport events (GENA) with a callback on its own port, renews in time, and reads the
  device the moment it says something changed — a pause from the device's own app, a track
  ending — instead of asking every second. Position isn't evented, so a playing device is
  still read every few seconds for it, and every second while its page is open. A device that
  refuses subscriptions is polled as before. The device's page says which: *Updates: sent by
  the device (events)* or *read every few seconds*. Docker users need host networking for the
  callback, as they do for streams.
- **Fixed volume is a switch** on a renderer's page (never a Sonos room, never a TV): on, the
  device's own knob or fixed line out is the volume and Mandarin shows no slider; off,
  Mandarin's slider and mute drive it. The Chord Poly's profile starts it on.
- **OpenHome is recognised.** A renderer that also offers OpenHome's services (Linn,
  upmpdcli, some Naim/Auralic) says *UPnP AV + OpenHome* on its page; it is still driven
  through AVTransport.
- Not planned any more: WiiM multiroom grouping. DSD comes when the owner says.

## v0.5.5
- **The mini transport bar is always there** — on Home, on every album wall, whether or not
  anything is playing — so a zone can be picked from it (the speaker button) without a trip to
  Audio Devices. With no zone chosen it reads **No Zone Selected**; with a silent zone, the
  zone's name and *Nothing playing*. Nothing is picked for you any more: the zone picker in
  Audio Devices starts on *Choose a zone…* until you choose, and the zone you chose is
  remembered. The volume button with no zone opens the zone picker instead.

## v0.5.4
- **Android: Settings looks like the side menu.** The Settings list and Setup's are rows the
  way the menu draws them — the icon in the menu's grey, then the title, flat on the sheet —
  instead of boxed tiles stretched to fill the screen. Same icons, same order. The browser and
  the iPhone app keep their two-column tiles.

## v0.5.3
- **Upsampling.** A renderer's page has an Output section: **Original**, **Upsample ×2**,
  **×4** or **Max**. Upsampling stays in the file's family (44.1 → 88.2 → 176.4; 48 → 96 → 192),
  capped at the highest rate the device takes; a file already at the top plays as it is. The
  conversion runs in 64-bit float — SoX at 33-bit precision, libswresample carrying doubles —
  with triangular dither to **24 bits**, or **32** where the device takes it, the setting allows
  (Auto / 24 / 32) and the server's ffmpeg writes 32-bit FLAC (6.1 stops at 24; the page says
  so). A CD rip at ×4 converts at about fifty times real time on a small desktop CPU.
- **Verified.** On a WiiM, a few seconds into each track its own API is asked what the decoder
  is running; when it matches what was sent, the rate and depth get their ✓ on the device's
  page and the Now playing badge reads, say, *FLAC 24/176.4 ↑×4 ✓*. A mismatch is shown as
  the device's last trouble.
- **Random album radio is per device.** The one switch at the top of Audio Devices — which
  applied to whichever zone the picker showed — is gone; each device's page has its own,
  under its on/off switch. It is the same per-zone setting the server always kept, now shown
  where it belongs, and a Sonos room in a group shows its group's.

## v0.5.2
- **A switch on every device.** A renderer found on the network is **off until you turn it
  on**: it is listed in Audio Devices with its details, but not offered as a zone. A Sonos room
  is on until you turn it off, which takes it out of the zone picker and the room list (a group
  stays while any of its rooms is on). The switch is on the device's row and at the top of its
  page; its state is kept in the register, so it survives restarts. Switching a playing renderer
  off stops it and lets its queue go. Phones have no switch — a phone is always its own player.
- Upsample ×2, ×4 and Max move to v0.5.3.

## v0.5.1
- **UPnP/DLNA renderers play.** A WiiM, a Chord Poly, any renderer with AVTransport that
  takes FLAC is a zone: pick it in the zone picker and the queue, play next, the transport,
  seek, volume and mute, history, Random album radio and moving what is playing all work on
  it as on a Sonos room. The server keeps the renderer's queue (it has none of its own) and
  hands each following track over with `SetNextAVTransportURI` once its file is complete, so
  tracks join gaplessly on a device that honours it; a device that does not is started on the
  next track by hand. A device whose volume is fixed (a Poly feeding a Mojo) has no slider.
- **Original mode.** A file goes to a renderer as stored wherever the device takes its rate,
  depth and format — the chips on its page decide — and above that as FLAC at the highest
  rate the device takes in the file's family. Renderer stream URLs say what they carry
  (`…orig.flac`, `…48000-24.flac`); Sonos URLs and the 24/48 rule are untouched. The Now
  playing badge on a renderer says exactly what was sent: *FLAC 24/96*.
- **Between players:** a queue moved to or from a renderer is rebuilt from the library for
  the player it goes to, so each gets its own best stream.
- The spec's non-goals are now firm: no Roon Ready (RAAT), Bluetooth or AirPlay, ever.
- Tests: the fake renderer gained a transport that fetches what it is given, plays in real
  time and moves to the next URI by itself (or stops, when told to fault on it); the new
  end-to-end run covers bit-perfect and converted playback, gapless, the fallback, transport,
  volume, modes and transfers, beside the Sonos run, which is unchanged.

## v0.5.0
- **Audio Devices sees every player.** Settings → Audio Devices lists the Sonos rooms, the
  phones running the app and — new — the UPnP/DLNA renderers on the network (a WiiM, a Chord
  Poly, any streamer, receiver or TV that offers AVTransport), found by SSDP every minute or
  by **Look again**, or named in `UPNP_HOSTS`. Each is read: its description, what it
  advertises it can play (ConnectionManager), and — for LinkPlay/WiiM firmware — its own
  HTTP API, for the name the WiiM app uses and the firmware.
- **A device's page:** a name of your own (stored on the server, shown in the zone picker,
  Now playing and everywhere else; the Sonos app keeps its own), what it is, and its
  capabilities as chips — sample rates, bit depths, DSD (later), formats — each marked with
  where it came from: known for the model (WiiM range, Chord Poly), advertised, ticked by
  you, or confirmed by the device. On a renderer, tapping a chip changes what Mandarin may
  send it; Sonos rooms and phones are read-only. A device that has gone can be forgotten.
- **The register** (`audio_devices`) survives a library rebuild, like your edits and history.
- Playing to the renderers — Original, Upsample ×2, ×4, Max — follows in the next versions,
  per the spec. Nothing about Sonos playback changed.

## v0.4.3
- **A written plan for UPnP/DLNA renderers** — `docs/specs/audio-devices-upnp.md`: discovery
  of WiiM, Chord Poly and other renderers, a device register with editable names, the
  capability layers (advertised, known model, you set, verified), the Audio Devices page,
  Original / ×2 / ×4 / Max upsampling in 64-bit float out to 24 or 32 bits, gapless via
  `SetNextAVTransportURI`, verification through the WiiM's own API, the phased builds
  (v0.5.0–v0.5.3) and the tests. Nothing is built yet; Sonos stays as it is throughout.

## v0.4.2
- **The album view:** each track's length sits on the right of its row, as far from the right
  edge as the track number is from the left; the album's text is white rather than cream,
  which read as washed out; **Queue** is gold like **Play now**.
- **Two themes: Mandarin Dark and Mandarin Light.** The four originals (Dark, Light, Copper dark,
  Brass light) are gone. Mandarin Light is the same look on warm cream paper — felt-green ink
  and fills, an old gold for the small capitals, the covers still glowing in their own colour.
  Anyone on an old light theme moves to Mandarin Light, everyone else to Mandarin Dark.
- **The side menu, sign-in page and home-screen icons show Mandarin's badge everywhere.** A
  phone could keep showing the old black duck from its cache; the icons now have new
  addresses, so every device fetches the badge.
- **The README and the website are in Mandarin's look:** the "Mandarin by MusicD" logo (a dark
  and a light version, following the reader's setting), green felt and gold (cream in light
  mode), and the app's own typefaces.

## v0.4.1
- **Android: the phone's Back button steps back one level**, the way the page's own buttons do:
  a dialog, the zone or volume pop-up, the menu, the share sheet, the album or Now playing,
  then from any album wall to Home. Only on Home does it leave the app. Before, Back from an
  album or a wall either left the app or went back a whole page load (a reload), which is much
  of why the app felt less smooth than the PWA. The app also draws a little beyond the screen
  now, so carousels and walls have their tiles ready as you move.
- **Random albums turns over every time you come back to Home** — in the app and the PWA alike
  (it used to keep the same albums for five minutes).
- **The share card is near-instant.** It's drawn at once from what the server already knows
  about the album (no online lookups first), with the cover the page already has; if a
  fuller lookup then finds more (a review for the first time), the card is redrawn with it.
  The suggested albums follow a moment later, as before. The card's font is now the bundled
  one — the page no longer waits on Google Fonts, which could stall in the app and away.

## v0.4.0
Mandarin, in its new look (Late-Night Hi-Fi, v0.3.25; the name, v0.3.26), with its own icon and
one last fix:
- **Mandarin's icon: the MusicD duck as a receiver badge.** The duck in cream on the felt,
  inside a gold hairline, over a gold level meter — the Android app's launcher icon (adaptive,
  round and square), the home-screen and browser icons of the web app, the sign-in page and
  the side menu. The MusicD logo itself is unchanged, and still heads the README and the site.
- **No blue box on tap.** Tapping an album or a button in the Android app (and mobile browsers)
  flashed a translucent blue rectangle over it — square even on pill buttons. It's gone.
  Buttons now show they're pressed in their own shape and colour: a lighter shade on the
  dark themes, a touch darker on the light ones. Albums show nothing: a tap just opens the
  album. The raised "hover" look on album tiles is kept for a mouse only, so it no longer
  sticks to the last album tapped.

## v0.3.26
- **MusicD Server is now Mandarin.** The name everywhere you see it: the page, the menu, Settings,
  sign-in, the home-screen icon's name, messages, the Android app's name, its notifications,
  widget and Android Auto, the README and the website. Nothing to do: the Docker image
  (`ghcr.io/meltface-80/musicd-server`), the container and volume names, the app's package and
  the GitHub repository keep their names, so updates, installs and your data carry on as they are.

## v0.3.25
- **A new look: Late-Night Hi-Fi**, now the default (the others stay in Settings → Setup →
  Appearance). Deep green felt with a fine texture, warm cream text and muted gold; titles in
  Young Serif, the rest in Manrope (both bundled, so the look is the same offline).
  - Home opens with **Good morning / Good afternoon / Good evening** and the date.
  - Section titles in small gold capitals; **every cover glows softly in its own colour**, on
    Home and in every album grid.
  - *Not played in 6 months* starts with a dashed gold "something unheard" tile; *Smart Picks*
    shows the reason under each pick; *Label of the week* shows the label's name large.
  - *Browse by genre*: felt cards in six earthy tones.
  - The mini player is a small receiver: the room and the format above the track
    ("This phone · Opus 256"), and the progress as a gold level meter.
  - Anyone on the old default moves to it once; a theme picked afterwards is kept.
- **Settings → Setup:** Updates moved to the bottom of the list.

## v0.3.24
- **Settings, reordered.** Account, Music Folders, Audio Devices (was Playback), Home Screen,
  Share Card, Wall Display, Downloads (in the Android app), and **Setup** — a list of its own
  for the settings set once: Away from home, Updates (was System), API Keys (was Artwork &
  metadata), Smart Picks, Discover, Appearance. Back from one of those returns to Setup.
  New icons for Audio Devices, Updates and API Keys.
- **Music Folders finds DietPi's drives and shares.** The folder picker lists every drive and
  share mounted into the server, one tap to open, and says when one can't be seen: a network
  share the machine mounts only when opened (DietPi-Drive_Manager, `x-systemd.automount`)
  never reaches a container mounted with a plain `-v /mnt:/mnt:ro`. The fix, in the README and
  docker-compose.yml: `-v /mnt:/mnt:ro,rslave`.

## v0.3.23
- **A music folder can't vanish from the library any more.** A scan used to remove every track
  it couldn't find — so a network share that dropped for a moment, or a disk slow to answer,
  could take thousands of albums with it. Now a track is removed only when the folder it was in
  was read in full and it wasn't there. A folder that couldn't be read, or most of a folder gone
  at once (over a quarter of it, and over 500 tracks), is kept as it was, and the page says so,
  with a button to remove the missing ones if you did delete them.
- **An album that comes back gets its old id back**, so play history, playlists and the phone's
  downloads find it again.
- **Settings → Music folders**, as in Roon: add any number of folders from the app — browse to
  one, tap Add — and remove them (with a Yes/No first). In Docker, mount your drives once
  (e.g. `-v /mnt:/mnt:ro`) and choose the folders inside in the app. `/music` stays the first
  folder until you change the list.
- **Android: downloaded albums play in the full MusicD page.** With the server in reach, playing
  a downloaded album (from the Downloads screen, the Home row or Android Auto) goes through the
  server to this phone like any other album — Now playing, the bar at the bottom, the queue and
  history all follow it — and the tracks still come from the phone's own files. With no server,
  it plays from the phone as before.
- **Android: the Downloaded albums row shows every download**, including one whose album the
  server doesn't have right now (it plays from the phone), and its header opens them all as a
  wall in the page rather than a separate screen.

## v0.3.22
- **Android: no more "MusicD stopped" when switching between Wi-Fi and mobile data.** On a change
  of network the app drops the page's connections on the old route; if that landed just as a new
  connection was opening, the relay tripped over the closed connection and the app stopped. It now
  just drops that connection, and the page's next request goes the new way.

## v0.3.21
- **Built-in Tailscale without pulling a new image.** Updating from *Settings → Check for updates*
  brings the server's files but not a new Docker image, so an install updated that way had no
  Tailscale engine ("Tailscale isn't in this install"). Now the server fetches the engine by itself
  when its image doesn't carry one — from the "engine" pre-release on GitHub, built for x64 and
  ARM64 on every change to main, checked against its SHA256SUMS — into the data volume, and again
  after each server update. One download (the image, once) and in-app updates are all it takes.
  The engine release is a pre-release, never "latest", so the server's updater doesn't mistake it
  for a MusicD release.
- **Downloads as a folder** (Android app). *Settings → Downloads* listed every downloaded album
  above the settings, so with ten or more the settings were out of view. The albums are now behind
  one **Downloads** folder row (how many, and the space they take). Inside: each album plays or is
  removed on its own; **Select** ticks the ones to remove (Select all / none) and removes them
  together; **Clear all** removes everything. Each asks first, Yes or No. The phone's Back steps
  out of selecting, then back to the settings.
- **A yes/no that works in the app.** The Android app answered the browser's own confirm box
  with "no" without showing it, so *Forget* on a missing music folder (v0.3.20) did nothing
  there. It, and the new Downloads questions, now use MusicD's own Yes/No dialog.
- **One place for Tailscale** (Android app): the phone's own Tailscale moves from *System* to
  *Settings → Away from home*, under *This phone*, beside the server's.
- **The app update no longer looks a version behind just after an update.** The app looks for its
  update in a file GitHub serves from a copy kept for up to five minutes — and it's asked most just
  after the server's update, when the app has only just been built. It now asks GitHub's API
  (which answers from the repository) first, and when the server is still ahead of the newest app,
  *Check for updates* says the app update is on its way rather than "Up to date".

## v0.3.20
- **Home Screen order: drag a row as far as you like, and it stays.** Holding a row's grip and
  dragging moved it one place and then stopped, and the move wasn't saved — so a row seen moved
  (Downloaded albums, say) was back where it was the next time. The row being dragged was itself
  moved about the page, and the browser gives up the drag when that happens, so the drop that
  saves never came. Now the rows around it move instead: one drag passes as many rows as you like,
  and the order is saved however the drag ends.
- **A music folder left off a new container is kept, not removed.** Re-creating the container
  without one of its `-v` lines made that folder simply not there, and the server took its albums
  out of the library (they'd come back as new albums, without their play history). A folder that's
  missing is now treated like a drive that isn't mounted: its albums stay, and Home says which
  folder is missing and how to put it back — or *Forget* it, if it's gone for good.
- *Away from home* says how to get the built-in Tailscale when the image is older than the server
  (it comes with the Docker image: `docker pull`, then re-create the container).

## v0.3.19
- **Tailscale built into the server.** One download: the Docker image now carries MusicD's own
  Tailscale engine (the same one as the Android app's). Sign in once from the new
  *Settings → Away from home* — "Sign in to Tailscale" opens Tailscale's page — and the server
  joins your tailnet by itself as **musicd**: no Tailscale on the machine it runs on, no VPN, no
  ports opened. For a headless server, `TS_AUTHKEY` signs it in instead. The pane shows its state,
  its tailnet name and address, and signs it out or switches it off.
- It serves the server's own port on the tailnet and hands each request to MusicD with the
  caller's tailnet address, so everything reached this way is *away from home* as before (only
  the phone asking plays; Opus 256; no Sonos). Phones are given this address (it comes before a
  Tailscale on the host), learned the next time the app is used at home.
- Its identity lives in the data volume (a new container is the same machine). `TAILSCALE=off`
  leaves it out; `TS_HOSTNAME` renames it. Tailscale on the host still works. The engine comes with
  the image, so it's updated with the image (Settings → Check for updates updates the server's
  files, not the engine).
- Tested with the real engine and the real server on a private tailnet: signed in, joined, and a
  second machine reached MusicD through it and was treated as away from home.

## v0.3.18
- **Cached ahead, like Plexamp** (Android app, playing on the phone). The next tracks in the queue
  — in play order, shuffle and repeat included — are kept on the phone ahead of time, so they play
  without the network: through a dead spot, or on mobile data without using any.
  *Settings → Downloads → Cached ahead*: how many on **Wi-Fi** (5 to 45, 20 unless chosen) and on
  **mobile data** (5, 10 or 15; 10 unless chosen), and the **cache size** (2, 4, 6, 8 or 10 GB;
  2 GB unless chosen). Moving from Wi-Fi to mobile data keeps what's there and fetches no further
  than the mobile number. Tracks stay until the space is needed (the ones played longest ago go
  first), so one played again is already on the phone. A line there says how many of the next
  tracks are on the phone and how much space the cache uses, with *Clear cache*.
- A track on the phone plays from there wherever you are, in the format it was kept in — one kept
  as the original at home plays as the original (Lossless on Now playing) on mobile data, using
  none. A change of queue, a skip, a new network or a new setting starts the fetching again from
  the next track.
- The player itself now holds 5 minutes / 48 MB ahead in memory (the rest is in the cache), and the
  app no longer asks Android for extra memory.

## v0.3.17
- **Settings, one column** (Android app). The first Settings screen is now a single column of
  full-width buttons — the icon first, then the name — sharing the screen's height, with no
  scrolling. Every name is the same size: the longest one decides it, as large as fits on one
  line (up to 20px), so it adjusts to the phone. Browsers and the iPhone home-screen app keep
  their two-column cards.
- "Downloads on this phone" is now just **Downloads**.

## v0.3.16
**Wi-Fi to mobile data and back, without a gap** (Android app) — what Roon Arc does, and a little more.
- **Held ahead.** The phone fetches the whole of the playing track as fast as the network allows,
  then carries on into the next one (up to 15 minutes or 96 MB), so the few seconds with no
  connection as you leave the house are played from what's already on the phone. Skipping to
  the next track is instant too.
- **Tailscale kept ready.** MusicD's own Tailscale connection now stays joined at home (idle —
  it's not used there), so when the Wi-Fi goes the way to the server is already open instead of
  starting from nothing. It ends with the app.
- **The page never moves.** MusicD's page stays on the server's home address at home and away:
  the app passes its traffic to wherever the server can be reached right now (home, its own
  Tailscale connection, or the Tailscale app). No reload when you leave or come home — nothing you
  were looking at goes, and the page keeps its settings. (The server accepts requests relayed this
  way; the WebView needs to be recent enough, otherwise the page moves as before.)
- **Quick to notice, quiet to recover.** The app reacts as soon as Android says the Wi-Fi has
  gone; a connection that has gone silent is given up on after 8 seconds instead of 20, and a
  failed fetch is tried again at once — for a minute and a half — from where it stopped, while the
  music plays on from what's held, instead of stopping and starting over.
- **Changes at the next track.** A track finishes in the format it started in: leaving the house
  mid-song keeps the original to its end (the rest fetched over Tailscale if it isn't held yet),
  and coming home mid-song keeps Opus to its end; the next track follows the new place.

**Rescan library no longer says it failed when it didn't.** The page reads MusicD Remote's words
for how a rescan went ("rebuilt", "fresh", "scanning"); this server answered in its scanner's own
("updated", "unchanged", "running"), and every one the page didn't know was shown as "Rescan
failed". The server now answers in the page's words, and the page knows both. A rescan that
finds nothing new says "Library already up to date"; one that takes longer than a few seconds
says it's scanning, then — when it's done — how many albums there are and how many new tracks.

## v0.3.15
- **One Update button for the server and the app** (Android app). The update banner and
  *Settings → System → Check for updates* now look for both — the server's update and a newer
  app — and offer them together ("v0.3.16 available for the server and this app"); one tap on
  Update starts both. The server updates and restarts by itself while the app downloads its new
  version; then Android's installer asks you to confirm, as it always must for an app that doesn't
  come from a store. Either one alone is offered the same way. The separate "Check for app update"
  button is gone; the app's version still shows in *System*.
- Browsers and the iPhone home-screen app are unchanged (server updates only). An older server
  page doesn't know about the app's updates, so the app still offers its own there.

## v0.3.14
- **What's playing, and how, on Now playing.** A badge under the album name:
  - **Lossless** for a lossless file — in the browser and the iPhone home-screen app as well as the
    Android app, and on Sonos too (hi-res goes to Sonos as 24-bit/48 kHz, still lossless).
  - **The Opus logo and 256kbps** when the Android app is playing the server's Opus 256 (away from
    home with *Stream as: Opus 256*, or an album downloaded as Opus). The phone tells the server
    which it's playing, so the badge follows a switch between home and away.
  - A lossy file names its codec ("MP3", "AAC").
  The logo is the official Opus logo (Xiph.Org's, from the Opus source tree), drawn in the badge's
  colour: the original's dark grey would disappear on this screen. Also offline, from downloads.

## v0.3.13
Two fixes from MusicD Remote (v1.8.60–v1.8.62), in the browser, the iPhone home-screen app and the
Android app alike.
- **Release date sort by the day, not the year.** The Library's date sort (now labelled *Release
  date*) ordered albums by year alone, so an album out yesterday sat among this year's by title.
  The scan now keeps each album's date as precisely as its tags state it (`DATE`/`ORIGINALDATE`:
  "2024-03-15", "2024-03" or "2024"), beside the year, which is unchanged for everything else.
  A 2011 remaster's day never lands on a 1977 original: only a tag of the album's own year refines
  it. Albums whose tags stop at the year are looked up on MusicBrainz in the background after each
  scan, newest first, twenty albums a request (MusicBrainz allows one request a second); a day is
  used only when title, artist and year all match. Within a year, an album known only to the year
  sorts after the dated ones newest-first and before them oldest-first; undated albums stay last.
  Existing libraries: the next scan (within six hours, or *Rescan library*) reads the dates of files
  it had already read, once, without a full rescan.
- **The album view shows the full release date** ("25 September 2026", written the way the device
  writes dates), the same date the sort uses; an album known only to the year is looked up as it
  opens (a second and a half at most, else it's there next time).
- **The ⋯ button is the height of Play now and Queue.** It was a 40px transparent box round a ring
  drawn inside its icon, so the ring looked about half the pills' height. The ring is now the
  button's own border at the row's height, with the pills' outline, fill, hover and press — on the
  album view and all three playlist screens.

## v0.3.12
- **Your whole library away from home** (Android app), over MusicD's own Tailscale connection — no
  Tailscale app, no VPN. Off the home Wi-Fi (5G, someone else's Wi-Fi) the app joins your tailnet
  by itself and the full MusicD page, every album and playlist, comes from the server through it;
  the server streams to the phone as Opus 256 kbps (transcoded there) or the original files — your
  choice under *Download settings → Playing away from home* (Opus 256 by default) — and only this
  phone plays (no Sonos away, as before). Back on the home Wi-Fi it switches back and the connection stops.
  Sign in once on *Settings → System → Tailscale* (formerly "Tailscale test"); a passing
  "Test connection" keeps the server address it used. If the phone isn't signed in, the old way
  (asking the Tailscale app) is still tried, and with no way through at all the offline MusicD
  (your downloads) takes over as before.
- **Downloads over mobile data**: with *Wi-Fi only* off in Download settings, downloads — yours and
  automatic ones — run on mobile data too, through the same connection. Switching it now also
  applies to downloads already waiting (before, they kept waiting for Wi-Fi).
- The connection recovers by itself after the network changes (old connections are dropped), and
  after Android has restarted the app in the background (a download or playback brings it back).

## v0.3.11
- **Always MusicD's own interface** (Android app), online, offline, no data — never a different
  screen. The app now carries a copy of the interface built from this same version, used offline
  until it has saved one from the server (then the server's own version is used), so even the
  first start with no connection is the MusicD interface rather than the old Downloads screen.
- **Losing the server while the page is open** (Wi-Fi off, walking out of range): every 15 s the
  app checks the server is still there; after two checks with no answer the offline MusicD takes
  over by itself, instead of covers going blank and the page failing.

## v0.3.10
- **No more black screen when the server can't be reached** (Android app). Away from home with no
  route to the server (the Tailscale app off, say), the page could wait a long time on a black
  screen before giving up, and a page already open lost its covers and then failed. Every load now
  checks alongside whether the server answers; if it hasn't within 3 seconds, the app's own copy of
  MusicD takes over at once (your downloads, This phone), and the page comes back from the server
  when it answers again.

## v0.3.9
- **Test build: MusicD's own Tailscale connection on the phone** (the first step of built-in
  Tailscale). The app now carries a Tailscale engine (`android/musicdnet`, Go, built into the APK
  as `libmusicdnet.so` and run as its own process, like Syncthing for Android): it joins your
  tailnet as the phone with no VPN and no Tailscale app, and opens a port on the phone that leads
  to the server. *Settings → System → Tailscale test* signs the phone in by link and tests each
  step to the server (joined, answering, seen as away, the start of a track) with timings and a
  log to copy. Nothing else uses it yet: home/away switching is unchanged. Needs the server on
  your tailnet (Tailscale on the server machine, for now). 64-bit phones only in this build.
- The engine is tested on every Android build, driven the way the app drives it, over a private
  tailnet made on the build machine (sign-in by link, forwarding, audio with ranges, held
  requests, the server going away and coming back).

## v0.3.8
- **MusicD's full interface offline** (Android app). With no connection to the server the app no
  longer drops to a minimal screen: it shows MusicD itself — Home, the album pages, the Now
  playing screen, the queue, search, artist pages, Settings — answered by the app from what's on
  the phone. The library is your downloaded albums; the one room is *This phone*; Play, Queue,
  Play next, Shuffle, the transport, seek, volume, shuffle/repeat and *play from here* all work on
  the phone's player. A line at the top says it's offline. When the server can be reached again
  (checked every 10 seconds) the page reloads from it.
- How: whenever the page loads from the server, the app keeps a copy of it (the page, its script
  and stylesheet, icons, the settings it reads) and of each downloaded album's page; offline it
  keeps the page on the server's address and answers its requests itself. So it's always the same
  interface — the same version — as the server's. Needs one visit to the server with v0.3.8 to
  make that copy; until then the app's own offline screen is used, as before.
- Things that need the server say so offline (editing albums, Sonos rooms, Smart Picks and other
  server features).

## v0.3.7
- **Settings → Downloads on this phone is a settings page like the others** (Android app): the
  same header with a back chevron to the Settings tiles, the same rows, drop-downs and switches,
  and your chosen theme. It lists the albums on the phone (cover, progress, play on this phone,
  remove — tap one to open its page), then Downloading (quality, where to save, size limit,
  Wi-Fi only) and Automatic downloads. It follows downloads as they happen. The app supplies the
  data and applies the settings; browsers and the iPhone home-screen app don't get the page.
- The app's own offline screen keeps to playing what's on the phone, with a back chevron at the
  top instead of a button at the bottom; its settings moved to the page above.

## v0.3.6
- **Downloads show up as they happen** (Android app). The Home screen's *Downloaded albums* row
  was only drawn when Home was opened, so a finished download didn't appear until the app was
  closed and opened again. The app now tells the page every time a download is queued, moves on a
  track, finishes or is removed, and the row follows at once: an album appears the moment it's
  queued, with *Queued*, *↓ 3/10*, *Waiting* or *Failed* on its cover until it's done. The row
  switches itself on with the first download, and *Settings → Home Screen* follows too.

## v0.3.5
- **Playback controls on the phone**: the phone player never handed its session to Media3's
  notification manager, so music started in the app (a download, or *This phone* from the page)
  played with no notification, no lock-screen controls — and nothing but a force-close to stop
  it. It does now, and the player also stays properly in the foreground while it plays.
- **The app's own screen offline**: when the server can't be reached the app opens the Downloads
  screen by itself — what's on the phone first, the download settings below, a *Try the server
  again* button — instead of an error page. A player bar at the bottom shows what's playing, with
  a position slider and previous / play-pause / next.
- **Crash details**: if the app stops, the next start says so and offers to share the details
  (the stack trace, the app and Android versions), so a crash can be fixed rather than guessed at.

## v0.3.4
- **The Android app updates itself** (phase 4). The server's in-app updater only ever updated the
  server, so the phone kept running the old app — which is why downloads didn't play until the
  app was reinstalled. The app now looks for a newer APK itself (GitHub's `dist/latest.json`,
  when it opens, at most hourly, and from *Settings → System → Check for app update*), downloads
  it, checks its SHA-256, and hands it to Android's installer, which installs over the top:
  sign-in and downloads stay. Android asks once to allow installs from MusicD.
- **Automatic downloads** (Downloads screen): keep today's Smart Picks, the Album of the day and
  the newest 5–30 albums on the phone, in the chosen quality, under the same Wi-Fi rule and size
  limit. Checked every six hours; albums that drop off the lists are removed again, but never
  one you downloaded yourself. New `GET /api/download/auto`.
- **Android Auto**: MusicD appears as a media app in the car — Downloaded albums (played from the
  phone), and with the server in reach Smart Picks and Random albums (played on *This phone*
  through the server, so queue and history stay the server's). A sideloaded app shows in Android
  Auto only with its developer setting *Unknown sources* on.
- Tailscale inside the app (the plan's other phase-4 item) is left out: the official Tailscale
  app already does the job, and building it in would add 20–30 MB for no gain you'd notice.

## v0.3.3
- **Settings fills the screen in the Android app**: the tiles share the screen's height, so the
  first level never scrolls; a close button replaces the backdrop, and the phone's Back button
  steps out of a pane, then out of Settings. Browsers and the iPhone home-screen app are
  unchanged (the rules are in `public/android.css`, sent to the app only).
- **Downloaded albums** Home row (Android app): the albums on this phone, first on Home; its
  title opens the Downloads screen. It starts switched off and turns itself on the first time an
  album is downloaded; while there are downloads it can't be switched off (Settings → Home Screen
  says why). Other devices don't list it.

## v0.3.2
- **Away from home** (Android, phase 3): off the home Wi-Fi the app switches to the server's
  Tailscale address — asking the Tailscale app to connect — and back again at home. The server
  learns its own Tailscale address (or `TAILSCALE_ADDRESS`) and gives it to the app; it can also
  be typed on the connect screen. A track cut off by the switch resumes where it stopped.
- **Away, only the phone plays.** The server treats any request not from the home network as
  away: it lists and reaches only the asking phone's own zone — no Sonos rooms, no pause-all,
  mute-all, grouping or moving playback to a room, and no other phone. Browsers away have nothing
  to play to. `X-Forwarded-For` is believed only from a proxy on the server itself.
- **Opus over mobile data**: away, the phone streams Opus 256 kbps (`/stream/…?q=opus`, the same
  cached files as Opus downloads), with the album's next tracks prepared ahead.
- Fix: downloaded albums played from the Downloads screen go through a file-capable data source
  (they were given to the HTTP source only).
- No "No Sonos rooms found" warning away from home.

## v0.3.1
- **Downloads** (Android, phase 2): *⋯ → Download to this phone* on an album page, as Original
  (files as they are; DSD, APE, WavPack, ALAC, AIFF and >2-channel files become lossless FLAC at
  their own rate) or Opus 256 kbps (made once with ffmpeg and cached on the server). Phone storage
  or SD card, Wi-Fi only by default, optional size limit; downloads resume after interruptions.
  A native Downloads screen lists them and plays them with no server; the app plays a downloaded
  copy instead of streaming; titles, covers and edits of downloaded albums refresh from the
  server; plays made offline are sent to the history when the server is back. Browsers and the
  iPhone home-screen app are unchanged.

## v0.3.0
- **This phone** (Android): the phone running the app is now one of the zones. Choose *This
  phone* in the room picker and albums play through the phone's speaker or headphones — Play Now,
  Queue, Next, the queue tab, now playing, shuffle/repeat, volume, play history and Random Album
  Radio all work as they do for a Sonos room, with the phone's own notification, lock screen,
  headset buttons and Android Auto (Media3). *Move what's playing* works between the phone and any
  Sonos room. Phone playback is the Android app's own: the phone zone is visible to, and
  controllable from, that phone only — never the iPhone home-screen app or a browser. A phone
  can't be grouped with Sonos rooms. It's listed while the app is open or playing.
- Audio to the phone uses the same addresses Sonos gets (FLAC up to 24/48, higher converted).

## v0.2.2
- **Android layout, second go.** v0.2.1's change (no `viewport-fit=cover` for the app) didn't
  reach the cause. The app's window now uses up the system-bar insets itself instead of passing
  them on to the WebView, and the server sends the app its stylesheet with every safe-area
  allowance at zero — so the status and navigation bars are allowed for once, by the app, however
  the WebView behaves. Browsers and the iPhone home-screen app are unchanged.

## v0.2.1
- **Android updates install over the top.** Every APK is now signed with the same key
  (`android/app/musicd-debug.keystore`); before, each build had its own, so Android refused the
  update ("package conflicts with an existing package"). Going from an older build to v0.2.1
  needs one uninstall; every update after that installs in place.
- **Android layout:** no more gap above the top buttons, the mini player sits at the bottom, and
  Now playing has its full height back so the cover shows whole. Newer Android WebViews report
  the status and navigation bars to the page, and the page left that space on top of the app's
  own — twice. The app now identifies itself and the server sends it the page without
  `viewport-fit=cover`, so the space is left once.

## v0.2.0
- **An account.** MusicD Server now has one account, kept on the server. Until it's created —
  from a device on the home network — the server only shows "Create your account". Existing
  installs ask for it straight after this update. Every device then signs in once and is
  remembered.
- **The password never crosses the network**, even over plain http: sign-in uses SRP, so the
  device proves it knows the password and the server proves it knows the account. The server
  stores only a salt and SRP verifier (the password is stretched with PBKDF2 first).
- **Settings → Account**: every signed-in device with a *Sign out* button, sign out of this
  device, and change password. Five wrong passwords from one address lock it out for 15 minutes.
- **Forgot the password:** `docker exec musicd-server node reset-password.js` removes the
  account and signs every device out; library, edits, playlists and history stay.
- **Android app** signs in (or creates the account) itself — no other device or QR code needed —
  and checks the server's proof before trusting it. If the phone is signed out from Settings, the
  app asks to sign in again.
- **Sonos keeps playing**: the audio and cover addresses speakers are given are signed, and the
  speakers' own addresses are let through, so queues made before the update still play.

## v0.1.6
- No more "No Sonos rooms found yet" while an update (or any restart) is under way. The
  speakers found last time are remembered and asked first, so rooms are back within a
  couple of seconds instead of up to 30; until the server has looked, it says it is still
  searching and the page shows nothing. "Can't reach MusicD Server" no longer flashes up
  while an update restarts the server either — only if it stays away outside an update.

## v0.1.5
- Album edits always show. An album page opened from a tile drawn before the edit (another
  row, an earlier screen, a page restored after an update) kept the old title and year,
  because the page refused the server's title when it differed from the tile's. The page
  now takes the server's current title, artist, year and cover, and asks for the write-up
  and year again under the new names.
- An edited album is found by its new names and by the ones in its files, so play history,
  what a speaker is playing and the write-ups keep finding it (and its edited year).
  A title of punctuation only, like Sigur Rós's `( )`, is found too.
- A found cover shows everywhere straight away. Anything still holding the album's old
  picture address — a tile drawn before the save, a Sonos queue from before it — now gets
  the current cover (uncached) instead of the old placeholder, and the album page swaps
  every stale tile on screen to the new cover. Re-saving to make a cover appear is no
  longer needed.
- No zooming in the browser or home-screen app: pinch and double-tap zoom are off
  (viewport, `touch-action` on every element, and iOS pinch gestures cancelled). The page
  puts itself back to 1:1 if it ever finds itself scaled, so it can't get stuck zoomed.
- Settings → Share Card → **On the card: Review** switches the write-up on the share card
  on or off (on by default).

## v0.1.4
- **Updates never lose your library or edits, and never rescan it.** After a manual or
  in-app update the whole library is there the moment the server is back and plays
  straight away; the start-up check only reads files that are new or changed.
- Album edits are also saved to `album-edits.json` in the data folder and restored from it
  if the database ever has to start over. A database that must be replaced hands over its
  edits, play history and settings first; one from a newer version is never moved aside.
- Music mounted somewhere new (e.g. `/music` → `/music/4tb`) is recognised as the same files:
  albums, ids, play history, playlists and edits stay, and nothing is re-read.
- A drive that isn't mounted (an empty mount point) keeps its albums instead of having them
  removed and re-read when it's back.
- On a first scan, albums appear and play as they're found rather than when it finishes.
- `docker-compose.yml` (and the Pages install builder) name the volume `musicd-server-data`
  explicitly, so Compose and `docker run` use the same one; the server warns, in the log
  and on screen, when `/app/data` isn't a named volume and would be lost with the container.

## v0.1.3
- **In-app updates work.** Settings → Check for updates → Update installs the newest
  release and restarts the server in place (the same updater as MusicD Remote: the
  container runs `launcher.js`, which swaps the new files in while the server is stopped).
  Every version merged to main is now published as a GitHub release for it to find.
- The image is also tagged with its version (`:0.1.3`) as well as `:latest`.

## v0.1.2
- Settings → Artwork & metadata: the saved FanArt.tv key shows as `••••` plus its
  last four characters instead of "Current: undefined"; the stale Discogs wording is gone.

## v0.1.1
- **Edit album** (album page → ⋯ → Edit album): correct the title, artist and release
  year, and find a cover for an album without one — matched on title, artist and track
  names across Apple Music, Deezer and MusicBrainz, with suggestions and a paste-an-address
  box when no match is sure. Edits live in the database and survive rescans.
- Startup no longer crashes when the data volume holds a database from another program
  (the deleted earlier project used the same volume name): it's moved aside and a fresh
  library is built.
- A warning at startup when music is mounted beside `/music` (e.g. `/music1`) instead of inside it.

## v0.1.0
- First release: local library → Sonos, 24/48 ceiling, MusicD Remote interface,
  Docker image, Android app and PWA.
