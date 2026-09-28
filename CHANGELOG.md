# Changelog

Versioning: each set of changes is a development build and takes the next third digit
(0.3.0, 0.3.1, 0.3.2 …). The second digit moves only when the project owner says so.
`package.json`, the README title, the GitHub Pages badge and the Android app's
`versionName` (plus `versionCode`) move together — `npm test` fails if they don't.

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
