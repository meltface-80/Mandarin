# Changelog

Versioning: each set of changes is a development build and takes the next third digit
(0.3.0, 0.3.1, 0.3.2 …). The second digit moves only when the project owner says so.
`package.json`, the README title, the GitHub Pages badge and the Android app's
`versionName` (plus `versionCode`) move together — `npm test` fails if they don't.

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
