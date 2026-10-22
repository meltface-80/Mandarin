# Changelog

## Unreleased
- `135-artist-head-overlap`: in the app, an artist's picture no longer sits over the heading ("6 albums · A.A.
  Williams"): the head of an album grid (the heading, the picture, links, biography, members) stands one part under
  another, on every screen that has one.
- `132-album-credits`: an album's page shows its credits, in the app and on the page. Under the tracks, over "About
  this album": who played, sang, wrote and made it, players first, then the writers, those who made the record and
  its art; each a row with their picture (or first letter), their name, and their parts, with the tracks they are on
  when not all ("Organ · track 1", "Lead vocals · tracks 1–3, 5"). Eight at first, More for the rest; a tap opens
  their artist page, and Back returns to the album. From the album's own tags and its MusicBrainz release (item 129).
- `134-offline-toast`: the row along the foot has its five buttons evenly across again, and offline is said at the
  top of the screen instead: a small pill in the middle, "Offline — tap for more", over every screen for as long as the
  app (or the page on a phone) is offline; a tap says why, as the sign in the row did. On a desktop the sign stays in
  the top bar.
- `131-artist-page`: an artist's page shows who they are, in the app and on the page. Over their albums: their
  picture (their own once the server has found one, else the biography's portrait), what they are, where from and
  when ("Band · Manchester · 1982–1987"), their links as pills (MusicBrainz, official site, Wikipedia, Wikidata,
  Discogs, AllMusic, Bandcamp, Last.fm, SoundCloud, YouTube; each opens in the browser), and the biography as before.
  A band's members, or a person's bands, follow in a row of round pictures with what each played and when; a tap
  opens their own page, even when the library has nothing of theirs. Under the albums and those they appear on, a
  new "Credited on" section lists the library's albums they played on, wrote or produced, saying as what.
- `130-artists-tab`: an Artists wall, in the app and on the page. The row along the foot has an Artists button
  (Menu, Home, Library, Artists, Search, five equal buttons; the Offline sign keeps a seat of its own between Home and
  Library, so the row doesn't shift when it comes). The wall shows every act in the library as a round picture (their
  own once the server has found one, else their first album's cover) with their name and how many albums, in the
  album wall's own columns, sizes and grid or list view (Settings → UI Settings), read a page at a time as you
  scroll. Sort at the top right goes round A to Z, most albums and random, and is kept; Search in the row finds an
  artist by part of the name across the whole library. A tap opens the artist's page, and Back from there comes back
  to the wall where you left it. New: `GET /api/artists?q=` finds by part of the name (accents and case aside).
- `129-artist-credits`: the server finds who played, sang, wrote and made each album, and who each act is, for the
  artists' pages and the album credits to come (items 130–132). An album's credits come from its files' own tags
  (PERFORMER "Name (drums)", PRODUCER, ENGINEER, ID3's credit lists) and, where the album has a MusicBrainz release
  (its tags' album id, or the identification scan's applied match), from that release: who played and sang on each
  recording, who wrote each work, who made the record. An act's members or bands, years, place and links (Wikidata,
  Wikipedia, Discogs, AllMusic, its own site) come from MusicBrainz, and its picture from FanArt.tv (with a key),
  Wikidata (Wikimedia Commons) or Deezer. It works in the background, one album and one act at a time at
  MusicBrainz's pace of one request a second, the library's album artists first; a page that asks before it has got
  there has its answer found there and then. New: `GET /api/album/credits`, `GET /api/artist`,
  `GET /api/credits/status`; `GET /api/artists` gives each act's own picture (`photo_key`) once found. Kept in tables
  of its own (`album_credits`, `album_credit_state`, `artist_info`), made the first time something is found.

## v1.1.2

**Reliability updates.** No new features: the Android app is steadier in everyday use. At home it talks to the
server over the Wi-Fi even when Android prefers mobile data, so a weak Wi-Fi no longer makes screens fail or flips
the app away and back; an album that can't be read says so plainly and tries again by itself. Left paused in the
background, "This phone" stops itself after five minutes rather than being ended by Android, and Android tidying
away an idle app no longer brings up "Mandarin stopped in the background" (it is still in the log when logging is
on). The test build of the app keeps one file rather than a copy of every version.

- `128-test-android-one-apk`: the `test-android` pre-release keeps one APK, `mandarin-android-test.apk`. Each build
  of `dev` also uploaded a copy under its version's name, and 46 of them (13 to 20 MB each, from 0.8.0 on) had built
  up. The version built is still said in the pre-release's notes.
- `127-home-over-wifi`: in the Android app, at home the app's connections go over the Wi-Fi. At 06:48 on 22 October
  the Wi-Fi was still up (what was already open on it went on answering), but Android judged it poor and sent new
  connections over mobile data, which can't reach the server's home address: for half a minute every new request
  failed, and an album's page showed "failed to connect to /192.168.0.57 (port 3500) from /192.0.0.4 …" with no way
  to ask again. Now, home on the Wi-Fi, the screens, the player's streams and downloads are tied to it, and the
  check of the home address asks over it too (so a poor Wi-Fi no longer flips the app away and back); away, or the
  Wi-Fi gone, they are let go at once. An album that can't be read says "Couldn't reach the server. Trying
  again…" and asks again by itself, less and less often, while its page is up (core `Route.overWifi`, `Failure`).
- `126-backup-ending-no-note`: in the Android app, Android ending the app after waking it for a task of its own no
  longer brings up "Mandarin stopped in the background". At 04:05 on 22 October it ended the app with a signal, at
  230 (perceptible: neither on screen, in view nor playing) and with no words of its own, after waking it overnight:
  the nightly backup, which ends the app it backed up. A note now needs the app to have been on screen, in view or
  playing; the note calls 230 "woken by Android" rather than "in view", and with logging on the ending is still in
  the log ("no note: …").
- `125-frozen-idle-no-note`: in the Android app, Android ending the app while it is idle in the background and frozen
  no longer brings up "Mandarin stopped in the background" at the next start. It happened again at 18:49 on 21
  October, six minutes after the phone's player had stopped itself (item 124), with no player and no media session
  left: another app called on the frozen app and had to wait for it ("Sync transaction while frozen"), and Android
  ends a frozen app for that, whoever the caller. The app loses nothing it doesn't bring back (the screen it was on,
  the phone's queue, paused), so this is Android's clean-up, like being short of memory, which never had a note. With
  logging on, such endings are still written in the log ("no note: …").
- `124-frozen-in-background`: in the Android app, "This phone" stops itself when it has not played for five minutes
  and the app is off screen, so Android no longer ends the app in the background. Paused, Media3 keeps the player's
  service in the foreground for ten minutes and then lets it go; Android then froze the app with the player's media
  session still open, and ended it when another app asked that session something ("Sync transaction while frozen",
  21 October 17:16), or, on 1.1.0, for the player's long poll running on ("too much CPU"). Opened again, the app
  starts the player, and the server puts its queue back, paused (core `PlayerIdle`).

## v1.1.1

**Logging has been added to the server and the Android app, and is off by default.** When something isn't right,
switch it on in the app (Settings → Setup → Logging), use the app as you normally would for 24 hours, then tap Save
log: the app's log and the server's are saved together to Downloads/Mandarin on the phone, for you to send to the
developer. While logging is off, nothing is collected. The log is made without personal data: no IP addresses
(home, Tailscale or internet), no names of people, rooms or devices, nothing you play or search for, no files or
folders and no account details. Please look through it before you send it. Clear log empties it, and switching
logging off deletes it, the server's part too. What it captures and what it leaves out:
[Logs](https://meltface-80.github.io/Mandarin/#logs).

Also in the Android app: the screen you are on stays put when the server goes or comes back; away from home the
screens play on this phone; leaving the Wi-Fi switches to the way away at once; the app asks the server for less
while it's off screen; the side menu opens as it was last seen; a cover changed in the album editor shows on the
Library at once.

The details, item by item:
- `123-library-new-cover`: in the Android app, a cover found or changed in the album editor shows on the Library wall,
  the other walls and the search at once. They are kept as loaded while the app runs (and a playing phone keeps it
  running, the screen made again or not), and nothing told them the album's cover had a new key: two albums given
  their covers still showed the drawn placeholders. Now the album's page, each time it reads the album, puts its cover
  right wherever a kept list shows an older one (core `AlbumCovers`, `LibraryWall.coverIs`).
- `122-glitch`: in the Android app, the side menu opens as it was last seen. It opened as the page's markup has it,
  Labels and Shelf drawn, then took them away when the server answered they were switched off, and the rescan line
  ("13,549 albums · checked 2 hours ago") came in under them and moved Settings down: at every opening, a moment after
  it slid in. Now the rows and the server's status are kept on the phone (core `Menu.keep`), the menu opens with them,
  and only a change at the server changes it (the log says so, marked). Settings' foot likewise opens with the version
  last read rather than "Mandarin" and then the version.
- `121-logging-switch`: logging in the Android app, for sending to the developer when something is wrong: Settings →
  Setup → Logging, under API Keys. Off unless switched on, and off nothing is collected. On, the screen says to use
  the app as usual for 24 hours and then tap Save log (to Downloads/Mandarin), that the log is made without personal
  data, and that it is the user's to look through before sending it; Clear log empties it, and switching off deletes
  it. The log holds the app's lines (the log build's, item 116: the screens' moves and what didn't flow, each request
  and how long it took, the way to the server, the phone's player, the app's own lines of Android's log, crashes and
  freezes) and the server's. No personal data goes in: each app line goes through core `LogRedact` (addresses of
  every kind, room and device ids, what is played or searched for, anything quoted, files and folders, keys), and the
  server keeps, while on, only its code's own words and, of the values put into them, numbers, errors' names and its
  own addresses (`LogLine.cs`, `Diagnostics.cs`, `/api/diagnostics`): no name, title, address or message.
- `120-background-polling-trimmed`: the Android app asks the server for less while nobody is looking. With the app off
  screen and nothing playing it asked 11 to 14 times a minute until Android froze it: the room followed by the
  screen's mini player as well as by the notification, the rooms before every wait on the room, the server's status
  and today's album every minute. Now the screens' repeated asks (the room followed, today's album, the notices,
  Settings → Away from home's Tailscale status) run only while the app is on screen (`NativeShell.onScreen`, between
  MainActivity's onResume and onPause), and are asked at once when it comes back; the notification looks at the rooms
  every five minutes, woken at once by a room chosen in the app. Offline, the phone's answer about its room is held as
  long as asked (20 s, as the server's), not 1.5 s, which had a screen asking 40 times a minute.
- `119-away-phone-room`: in the Android app, away from home the screens play in this phone's room, the only one the
  server offers there (core `Route.room`, `Store.playRoom`), and in the room kept again at home. They stayed in the
  Sonos room kept from home: the mini player asked for it every 2 s and the server refused each time ("Away from home,
  only this phone plays"), 46 times in two minutes one morning. And a room that isn't answered is asked for less and
  less often, 2 s up to half a minute (core `Retry`), not every 2 s for as long as the screen is up.
- `118-away-way-at-once`: in the Android app, the way to the server (home or away) is taken as soon as it is decided,
  before it is connected (`Away.check`). Off the Wi-Fi the app used to go on asking the home address while it waited
  for the way away to come up: 22 s for the Tailscale app at 07:53 one morning, every request waiting out its 5 s.
  And a phone signed in to MusicD's own Tailscale stays on it (127.0.0.1:34500) while its engine comes up or starts
  afresh after a stall (core `Route.way`); before, it was moved to the Tailscale app's address, which nothing answered
  on that phone, and went offline until the engine was back. The Tailscale app is asked only on a phone not signed in
  to MusicD's own.
- `117-stay-on-screen-offline`: in the Android app, the server going or coming back no longer takes you to Home. Both
  closed every screen over Home (`OfflineNow.goOffline` and `goOnline`), so Wi-Fi coming back while Settings → Away from
  home was open left you on Home with the way back in to tap again; going offline did the same from an album's page or
  Now playing. Now the screen on show stays and the side menu stays open; Home's rows are read afresh for when it is
  next shown, in the room that plays now.

## v1.1.0
- `115-menu-settings-close` (folded into v1.1.0): in the Android app, Settings, Playlists and the side menu's other
  pages couldn't be closed when opened from Home (their ✕ and ‹ did nothing). The menu's "every screen over Home
  closed" found none to close on Home and then closed Home itself, so the page opened had nothing under it. Every way
  back to Home now goes through one step (`toHome`) that keeps Home, and puts it back if it is ever missing. The app is
  built again as 1.1.0 with versionCode 327; `.github/publish-apk.sh` publishes the same version over itself when its
  versionCode rises, and `dist/latest.json` says the code it carries.
- `111-webview-gone`: the Android app has no web view (O2 in old/plan-android-native.md): it opens on its own
  Home (`ShellRoute.HOME` the first route), and `MainActivity` holds the shell, the pickers and the volume keys, the
  server's reachability moving to `ServerReach.kt` (the same looks and timings; the copy of the server's last answers
  refreshed while it answers). What the screens handed to the page is the app's own (`ShellHand.kt`): the row's
  buttons; the screen settings the page kept (core `ScreenPrefs`: the UI Settings, the Library's view, the share card's
  service) and the room (`Store.zone`, written as it is chosen or grouped), with a backup's "page" part made from them
  under the page's own `rra-*` names and restored to them; Now playing's album (core `NowAlbum`, the page's matcher:
  the playing track's own album, else a search matched by credited name); the update offer (core `UpdateBanner`,
  updater.js's words and steps; `UpdateNow.kt` looks for it while Home is up and installs the server's update, then
  the app's; Settings → Updates hands its find to it; `AppUpdate`'s own dialog is gone); the server's gate shutting on
  the phone (core `GateWatch`: a 401 saying "Sign in to Mandarin", not a wrong password) opens the sign-in screen; the
  side menu's Shelf opens `/shelf` in the phone's browser; Android's stretch past a list's ends is off for every screen
  (`MandarinTheme`), as it was for the WebView (v1.0.7). Deleted: `PageFrame`, `PageGuard`, `PageCurtain`,
  `PageRelay`, core `PageWatch`, `AppBridge`, `BackupBridge`, `OfflineSite`'s page copy and the APK's `bundleSite`
  step, the `androidx.webkit` library, `test/offline-bundle.test.js` and its C# twin. The page's Android glue stays on
  the server until the next release, for older apps.
- `112-server-notices-native`: the server's notice at the head of the app's Home is worked out by the app (O2-5 in
  old/plan-android-native.md): core `ServerNotices` reads /api/status as the page's server-notice.js does (the
  data not kept, no music folder, a first scan, no audio found, starting up, a music folder gone with Forget or Remove
  the missing ones and its question, no Sonos rooms; none offline, nor a folder or the rooms away), asked again as the
  page asks; `Notices.watch` keeps it while Home is up, and Forget asks its question and forgets the folder itself
  (`/api/library/forget-folder`). `test/server-notices-words.test.js` holds every phrase to the page's. The page now tells
  the app the update offer alone.
- `113-mini-player-steady`: the docked mini player no longer dips when moving between screens. Each native screen
  draws its own mini player, and one just opened followed its room from nothing (no track known, no cover fetched), so
  the bar was first drawn without its cover and room line, shorter, then grew back. `followRoom` now keeps each room's
  state while the app runs and a screen starts from it, and `rememberImage` keeps what it fetched (as the tiles' covers
  are kept), so the bar's first frame on a new screen is the last screen's.
- `110-downloads-retry-native`: the app's old Downloads screen (`DownloadsActivity`, a View screen) is deleted, with the
  error panel's On this phone that opened it and the page-load error's automatic open of it (both dead since the page's
  copy took over offline). Its two buttons move, as the owner asked: Try again on a download that failed, in Settings →
  Downloads' albums (`settings-downloads-albums.retry`, the page's and the app's; `MusicdDownloads.retry`), and Try the
  server again in the Offline dialog when the server can't be reached (`offline.retry`; `MusicdApp.lookForServer`, the
  server looked for now rather than at its next look). An album's ⋯ → Downloading… (`MusicdDownloads.open`) opens
  Settings → Downloads' albums (`ShellRoute.settings("downloads-albums")`).
- `109-offline-native`: offline, the Android app stays native (O1's switch-over, old/plan-android-native.md).
  With Offline mode on or the server out of reach, MainActivity no longer loads the page's copy kept in the APK: it
  parks the page (stopped, blank) and the native screens stay in front (`OfflineNow`), asking the phone the same
  questions they ask the server (`Store.screenClient`: core `PhoneAnswers` through a `LocalTransport`; the services keep
  the server's client). The row along the foot is the app's own offline too (Home, the Library wall, the side menu, the
  search, the Offline sign's dialog saying why); the page's sheets, which need the server, aren't offered. The menu's
  Offline Mode switch no longer reloads the page under a picture of the screen. Home's rows are read afresh on each
  switch (`HomeKept.reset`).
- `108-phone-album-native`: one of the phone's own albums (Home's Music on device, its wall) opens the app's own album
  page (`ShellRoute.PHONE_ALBUM`), read from the phone (core `PhoneShelf.phoneView`) and played on it as the page's
  `invokePhone` plays one, with its toasts (picked tracks too, as the page's playTracks); About this album comes from
  the server when it answers. Its other buttons are the page's for now; Download isn't offered, as on the page. `AlbumScreen.kt`
  gives its head's lines and ⋯ menu to `AlbumHeadParts.kt`, and `NativeShell.kt` its hand-off helpers to `ShellRoutes.kt`.
- `107-offline-phone-room`: step 3 of O1 (offline natively). The rest of the app's offline answers move into core:
  `PhoneRoom` (this phone as the one room: its zone and output, what it plays, its queue, the plays and transport sent to
  its player through a `Deck`), `PhoneFormat` (the format badge) and `PhoneAnswers` (the router: the server's own status,
  the library, the room, a setting as the server last gave it, and "Not available offline" for anything else). The app's
  `OfflineApi` becomes an adapter giving them the phone (its player as a `PhoneDeck`, its audio device in
  `PhoneDevices.kt`, its covers). A selection of albums played offline was queued twice (the app sends a selection's
  albums both as items and as offsets, and both were read); now once.
- `106-offline-phone-shelf`: step 2 of O1 (offline natively). `ServerClient` asks through a `Transport`: over HTTP
  (`HttpTransport`, the code it had) or answered in the app (`LocalTransport`), so the native screens can be answered
  offline without a change of their own. The library on the phone moves into core as `PhoneShelf` (from the app's
  `OfflineApi` and `LocalMusic`): the wall sorted and paged, random albums, search, an artist's albums, an album's page
  (the one saved, or made for an old download), the phone's own music with its badge, downloads as the library has
  them, and the rows the phone keeps nothing for, empty. Today's offline mode answers from it already. Random Album
  offline now plays one of the phone's albums; it asked for `/api/pick-unheard`, which offline answered with nothing.
- `105-offline-dialog-native`: the first step of O1 (offline natively, old/plan-android-native.md). The Offline
  sign in the app's row along the foot opens the app's own Offline dialog, the page's (server-notice.js openOffline)
  drawn natively: the heading, why only the music on this phone shows, and Switch offline mode off beside Close when
  Offline mode is on. Its words live in core (`Offline.kt`), held to the page's by `test/offline-words.test.js`; the
  dialog is a contract screen (`offline`) with the page's keys on `#offline-overlay`.
- `104-one-prompt-one-share-sheet`: the Android app had grown three name boxes (`NamePrompt.kt`, one inside
  `SmartSheets.kt`, `PromptDialog.kt`) and two playlist share sheets (`PlaylistShareSheet.kt`, `ShareTracksSheet.kt`),
  each a copy of the page's one drawn a little differently. Now one of each: every name is asked in `NamePrompt.kt`, and
  a Dynamic Playlist's Share opens the playlists' sheet, its file read into the same `ShareFile` with what reading found
  as its `ShareCaveats`. The duplicate `share-tracks` screen leaves the screens contract (the page's sheet is keyed
  `playlist-share` alone); `TrackShare` keeps only the reading of a Dynamic Playlist's tracks.
- `103-scanner-pack-null`: Settings → Library Scanner's MusicBrainz pack read "null" after the folder's free space in
  the Android app. Android's JSON reader gives the word "null" for a field the server sends empty (the JVM's gives
  nothing, so the core tests never saw it); the pack's folder problem, the check's error and the job's error showed it
  whenever there was none. The scanner's every text read from the server now takes an empty field as nothing, held by
  tests that read the JSON as Android does. Choosing the pack's folder no longer shows the toast "The pack’s folder is
  set", in the app or on the page.
- `102-mini-player-docked`: the Android app's mini player docked, as the owner chose it from renders: the full width of
  the screen, straight on top of the row along the foot, solid in that row's own colour with a hairline above it, not
  rounded and no shadow; the track's progress along its top, the full width, above the cover and the words. It does
  what it did and shows where it showed; the app's own bar and the page's in the app (android.css) alike. A browser
  keeps the floating bar.
- `101-settings-no-subtitles`: every Settings page with nothing under its heading, as the owner asked: the line saying
  what the page holds ("Qobuz and Tidal", "Where your library is read from", Setup's list of its pages), Account's
  "Signed in as …", Downloads' counts and a device's model are gone, on the page and in the Android app alike; the
  heading keeps the room the line used to end with (18). The page's Change password keeps the name signed in itself
  rather than reading it back from the line.
- `100-audio-devices-crash`: the Android app crashed opening Settings → Audio Devices. A list's words (the choice made,
  else the list's first) were read from the zones' list before the zones had come, and the first of none threw. A list
  with nothing in it yet now shows nothing; every list in Settings reads its words the same way.
- `99-library-wall-away`: away from home (mobile data, a VPN) the Android app's Library stayed on its grey skeletons for
  good. The Library's wall, kept while the app runs, set its "a page is on its way" when it asked for its first page and
  cleared it only once the page came: the Library left or drawn again before then, the request was called off and the
  flag stayed up, so every visit after asked for nothing. Seldom at home, where the first page comes at once. The flag
  is now let go however the request ends; and a first page that failed ("Couldn't load") is asked for again when the
  Library is opened again.
- `98-offline-mode-one-line`: the side menu's Offline mode row on one line, as the owner asked: "Offline Mode - On" or
  "Offline Mode - Off", where it read "Offline mode" with "On · only the music on this phone" or "Off" under it; in
  the app's own menu and the page's alike.
- `96-native-phone-album-and-menu`: the last of the page's screens the Android app's own screens still handed over to
  outside Settings and the playlist sheets. A server notice's Forget (a music folder gone) did nothing in the app: its
  question was asked by the page hidden behind the native Home, so the folder was never forgotten. The page now hands
  each button's question to the app with the notice, the app asks it as the page's yes-or-no sheet, and the page does
  its work once told it was answered Yes. The side menu's Restart and Shut down are now the app's own too: the
  question (Shut down saying how the server is started again), then the screen over everything while the server is
  away, as the page's (`power-cover` in the screens contract), until it answers again, the page under the app read
  afresh with it. Shelf stays the page's, a page of its own; the Offline dialog and the signed-out state go with the
  offline work (O1); a Music on device album's page is still the page's.
- `94-native-playlist-import-share`: a playlist's Import and Share sheets natively in the Android app, as the page's.
  Import (Playlists → Import): what to paste and why, the box to paste a shared playlist into, Choose a file… (the
  phone's own file picker, for a `.musicd` file), then Import: how many of its tracks the library has, those it couldn't
  match and those found on another album, each listed, and Save as a playlist, which asks its name in the app's own name
  box (the page's, natively) and makes it, the Playlists screen and Home's row taking it at once. Share (a playlist's ⋯ →
  Share): how many tracks and what was left out, what sharing means, the playlist as text; Copy, Download (the `.musicd`
  file to the phone's Download/Mandarin folder, where Import's Choose a file… finds it) and Done. The page's sheets and
  name box are keyed for the screens contract (`playlist-import`, `playlist-share`, `prompt`). On the page, Choose a
  file…'s words sit in the middle of the button (they sat at its top), and the name box's field is in the page's face, not
  the browser's.
- `95-native-smart-playlist-sheets`: a Dynamic Playlist's sheets natively in the Android app, as the page's, over the
  screen that asked: New (Albums or Tracks, each with what it means), then the Focus sheet led by the playlist's own
  Order and Playlist size, open from the start; Edit (that sheet over the playlist's own view, its size and order kept);
  the name box (Save as… from the Library too), the save made on the app's lane of changes to what Home shows, what it
  plays of the albums that match said, the playlist or the list read again; Share (its tracks read album by album, the
  server's file shown with how many tracks went in and every reason it holds less, Copy to the clipboard, Download to
  Downloads/Mandarin). Show albums or Clear all from a playlist's Focus open the Library in that view, as the page's
  do. The page's sheets are keyed for the screens contract (`smart-new`, `prompt`, `share-tracks`); its hand-offs stay
  for an app not yet updated.
- `89-native-settings-audio`: Settings → Audio Devices natively in the Android app (plan T6), as the page's: the zone the
  controls play to; every player the server sees, a row each (its icon, name, what it is and whether it plays) with its
  switch where it can be switched off; Hide / unhide (the rows ticked, OK, and what came of it said) and Look again;
  Waveform. A row opens the device's own page: on or off, Random album radio, a phone's Other devices can play here, its
  name (and Use the network name), About, its capabilities as chips (tapped on or off where they can be set), Output
  (the mode, the depth, Fixed volume), Volume levelling with its level, the DSP (a headphone profile found on AutoEq by its
  name or pasted, the bands' curve drawn from the same maths the server runs, each band's type, Hz, dB and Q, Add band,
  the headroom Auto or set, Save), this phone's USB DAC (Allow, what it takes, USB direct, fixed volume, the limit, how
  DSD goes, what it is being fed, Copy), and Forget this device. The page's are keyed for the screens contract
  (`settings-audio`, `settings-device`).
- `92-native-settings-backup-updates`: Settings → Backup & restore and Settings → Updates natively in the Android app
  (plan T9), as the page's. Backup & restore: the parts to put in, each ticked or not with what it holds (the whole
  database with its size), a passphrase, Back up to a file on this phone (Android's own "save as") or to the server, and
  what came of it; Restore from a file on this phone (Android's own "open"), and every backup, the server's and this
  phone's, newest first, each with where, when, what version, how big and what it holds, Restore… (its parts, a sealed
  one's passphrase, Restore now, asked first), Download (one of the server's, saved to this phone and listed with its
  files) and Delete (asked first). A restore is made on the app's lane of changes; this screen's own settings travel
  with a backup and come back with a restore (handed to and from the page, where they live); once the server is back
  from its restart the app starts again on what was restored. Updates: Check for updates looks for the server's update
  and the app's at once, then offers to install what it found, in brass, with the server's release notes, or says how
  things stand; installing is handed to the page's update banner on Home, where its progress shows. The pages are keyed
  for the screens contract (`settings-backup`, `settings-system`).
- `90-native-settings-scanner`: Settings → Library Scanner natively in the Android app (plan T7), as the page's: the
  schedule (on or off, its start and end chosen on the phone's own clock, what runs now); Identify albums and Ask
  iTunes too; the MusicBrainz pack (what is downloaded and from when, Download, Update or Remove, the download's progress
  every second, its folder, and Change… among the server's drives and folders); identification's progress and Check the
  proposed and unidentified again; Measure ReplayGain and how far it has got; Clean up, each kind with its Remove,
  asked first; the processor; and the proposed, unidentified, applied and declined albums, each opened by its name, with
  Accept and Reject, Undo or Check again, and Barcode… to match it by a barcode or a MusicBrainz link, the first 60 of
  each until Show all. Each block is drawn from its own answer as it comes and asked for again every five seconds. The
  page's is keyed for the screens contract (`settings-scanner`).
- `97-label-logos-status-gap`: the server's label scan said, for a moment, that nothing was running between two passes:
  between a logo pass and the one asked for while it ran (a second API key saved during the first pass), and between
  the label lookups and the logo pass that follows them. Whoever waited for the scan to end (the page's and the app's
  Record labels, and the label-logos test, which failed on dev for it) could read the logos before the next pass had
  looked. The running pass now hands over to the next without letting go.
- `93-native-add-to-playlist`: Add to playlist natively in the Android app, as the page's sheet, from an album's ⋯, from
  tracks picked on an album's page, and from albums picked on a wall or an artist's page: how many are being added and
  ✕, then ＋ New playlist… (named in the app's own name prompt, My playlist suggested) and each of your playlists with
  how many tracks it holds. What came of it is said as the page says it (how many tracks, from how many albums, a
  playlist now full, an album that couldn't be read, named). Made on the app's lane of changes to what Home shows, so
  Home's Playlists row has it when Home is back. The page's sheet and name prompt are keyed for the screens contract
  (`add-to-playlist`, `prompt`).
- `91-native-settings-downloads`: Settings → Setup → Downloads natively in the Android app (plan T8), as the page's: the
  Downloads row (how many albums, the space they take, how many are on the way) opening the albums; Offline mode;
  Downloading (the quality, where to save, the download folder chosen, changed or forgotten, Allow for the all files
  access it needs, Move all here for the albums saved elsewhere, the size limit, Wi-Fi only); Playing away from home;
  Cached ahead (on Wi-Fi, on mobile data, the cache's size, how much is ahead, Clear cache); Automatic downloads. The
  albums: each with its cover, title, artist and how far it has come, Play on this phone, Remove; Select (each ticked,
  Select all or none, Done, Remove the ones ticked) and Clear all, each asked first; an album tapped opens its page.
  Read again every two seconds while open, so a download is seen moving on; Home's Downloaded albums row follows a
  removal. The page's pane is keyed for the screens contract (`settings-downloads`, `settings-downloads-albums`), its
  switches and lists named for their rows; the page test and the page measurements stand the app's bridge in and ask
  for the page as the app does (its user agent, so the server adds android.css), through new `init` and `app` options.
- `88-native-settings-folders`: Settings → Music Folders natively in the Android app (plan T5), as the page's: the
  server's folders as cards (icon, name, path, how many tracks, or that it isn't there or can't be read and what to do),
  Remove where there is more than one (asked first); Add a folder, which browses the server's folders (Cancel, where it
  is, the mounted drives and shares, Up, the folders in it, those in the library marked, Add it or that it is in the
  library already); what is said of them (what a container must mount); then Music on this phone with its ⓘ: Choose a
  folder, or the folder with its albums, tracks and when it was read, Read again, Change folder and Forget (asked
  first). The page's is keyed for the screens contract (`settings-folders`). On the page, Add a folder opens the
  folder browser at once, its folders filling in when the server answers, where it waited for the server first.
  The contract's labels in core are written in parts of 300 at most (`ContractLabels1.kt` …, joined by `Contract.kt`):
  one file had reached the length watch, and each screen made native adds to it.
- `87-native-settings-services`: Settings → Services natively in the Android app (plan T4), as the page's: Qobuz and
  Tidal, each under its title with its ⓘ. Signed out, Qobuz's email and password and Sign in; Tidal's Sign in on
  tidal.com, which opens tidal.com, then the link, the code to type there and Cancel, waited for until it lands. Signed
  in, the stream quality, the favourites in the library on or off, Update library now, Sign out, and what the library
  holds of the service, asked again while it is being brought in. The page's is keyed for the screens contract
  (`settings-services`). On the page, the box of a Tidal sign-in under way (its note and Cancel, with no link or code)
  no longer stands under Sign in on tidal.com when no sign-in is under way: its `display: flex` outranked the hidden
  attribute. A test of item 83's that took the first of two saves to be still under way when the second was asked for,
  which it need not be, now holds the first until the second is asked.
- `85-home-rows-after-marks`: in the Android app, an album put on Listen later (from its page, or picked on a wall)
  showed in Home's Listen later row only once the app was started again, sometimes; a favourite likewise. The change was
  made beside Home's read of its rows, which could be answered first, and from the screen that asked, which dropped it
  if that screen closed first. The app's changes to what Home shows (Listen later, favourites, the rows' order) are now
  made one at a time, in the order asked, to the end whatever becomes of the screen, and Home reads its rows once those
  under way are made.
- `84-listen-later-removed-crash`: the Android app crashed a moment after an album was taken out of Listen later (or out
  of any of Home's rows, emptied or shortened under it). Each of Home's rows of tiles was told how many tiles it had when
  Home was drawn, and looked each up in the row as it is now: an album taken out between two frames left it asking for a
  tile the row no longer had. A row now draws its tiles from a copy of the row as it was when drawn.
- `83-home-order-after-settings`: in the Android app, Home's rows put in a new order in Settings → Home Screen showed in
  that order only once the app was started again. Home reads its layout from the server the moment it is back on
  screen, and that read could be answered before the new order was saved; the save's own answer was dropped when the
  page closed. Home's layout is now read and saved one call at a time, in the order asked, so Home's read waits for a
  save under way, and a save finishes and lays Home out from the server's answer whether the page is still open or not.
- `82-settings-pages-unresponsive`: in the Android app, a page of Settings the app doesn't draw itself yet (Music
  Folders, Services, Audio Devices and the rest; Home Screen too, before item 81) left the app unresponsive until it was swiped away. The
  page was put in front of the app's Settings to show it, but the rule that keeps the rest of the page out of sight
  while one of its sheets is over an app screen hid the Settings sheet too: an empty, clear page took every tap. The
  Settings sheet is now shown when it is the one asked for, and the page comes in front only once its sheet is seen,
  so a sheet that stays out of sight can never cover the app's screen again.
- `81-native-settings-home`: Setup's Home Screen page natively in the Android app (plan T3), as the page's: the
  greeting and Random Album, each on or off on this phone; Home's rows in their order, each with its handle, its name
  (and why it can't be switched: a setting behind it off, or Downloaded albums while albums are on the phone) and its
  switch. Held by its handle a row follows the finger and the rows it passes step past it; let go, the order is saved,
  as a switch is at once, and the native Home is laid out from it straight away. On the page, Downloaded albums' reason
  now reads on its own line under the name, as a row whose setting is off already did, instead of run into the name and
  cut off. The page's is keyed for the screens contract (`settings-homescreen`). With it, every page of Setup is the
  app's own.
- `80-native-settings-share-away`: the last two of Setup's pages natively in the Android app (plan T2), as the page's:
  Share Card (the review on the card on or off, the services and the review sites to link to, each on or off, and the
  default service chosen from those on, the same default the card's held chip sets) and Away from home (the server's
  built-in Tailscale on or off, its status, name and address, Sign in, which opens Tailscale's page, or Sign out, what
  Tailscale warns or what went wrong, read again every three seconds; This phone, the app's own Tailscale). The page's
  are keyed for the screens contract (`settings-sharecard`, `settings-away`). Every page of Setup is now the app's own.
- `78-native-settings-setup`: five of Setup's pages natively in the Android app (plan T2), as the page's: Smart Picks
  (on or off, the hour the day's picks are built, Rebuild today's picks now), Record labels (on or off with how many
  labels, logos and tagged albums the server has, a label's albums in order or shuffled, the fewest albums a label
  needs, Force rescan and what came of it, the label from a folder's depth), UI Settings (album and artist text, grid
  screen title, menu and Home text, grid layout, tile size), Wall Display (on or off, how often it turns over) and
  Shelf (on or off), each setting's ⓘ with its help. A list opens as the phone's own list of choices, as the page's
  did in the app. What the server keeps is saved there at once; what the page keeps on this device (UI Settings, a
  label's order and minimum) is handed to the page (`page-pref`) and kept by the app, whose screens follow it. Share
  Card and Away from home follow.
- `79-settings-freeze`: opening Settings from the Android app's side menu froze the app. The native Settings' icons
  were the page's SVG paths as written, an arc's flags run into the number after them, a form none of the app's other
  icons uses; every arc's numbers are now each set apart, and `test/android-vectors.test.js` holds every drawable to it.
- `77-album-editor-heading-serif`: the native album editor's heading, Edit album, is in Young Serif as the page's is (it
  was in Manrope); a test holds every title the page sets in the serif to be drawn in the serif by the app.
- `76-native-settings-account`: Settings natively in the Android app (plan T1), from the side menu, as the page's: the
  list over the whole screen (✕ and Settings in the serif, a row a section with its brass icon, the server's version and
  View on GitHub at the foot); Setup's list (the app's Downloads in it); Account (who is signed in, the devices signed in
  with when each was last seen, Sign out on each but this one, Sign out of this device, which takes the app to its
  sign-in, and Change password, proved with the current one as the page does it); API Keys (Discogs, FanArt.tv and
  Last.fm, each with its ⓘ, the box saying what the server has, its ✓ or ✕ once checked, Save). The pages not yet
  native open on the page alone over the app's Settings, each as its row opens it, and their Back comes back to the
  app's list. The page's Settings is keyed for the screens contract (`settings`, `settings-setup`, `settings-account`,
  `settings-keys`).
- `75-native-share-card`: the Share card natively in the Android app (plan B4), from an album's native page and from
  Now playing, as the page's: a panel over the screen (centred above the mini player and the row where they show), ✕
  in its corner, the card drawn by the app itself with the page's measurements (core's `CardLayout`, sharecard.js's
  arithmetic) and its look (Manrope; the cover softened behind a glass pane; the cover, the release, the title and the
  artist stepped down in size to fit four lines; the review under a hairline with whose words they are; Pitchfork's
  score and Best New Music on the cover; the duck tile in the corner), from the server's cache first and drawn again if
  the full answer says more; Share… (the phone's share sheet) and Download (to Pictures/Mandarin, also by holding the
  card); the places to hear or read about the record, as equal chips, a service held as the default (ticked, and the
  page's default too), Qobuz's chip given the album's own address where it is the default; If you like this, each act
  queued from the library in the room or found on the default service; the hint. Before, the page's card opened over
  the native screen. The page's card is keyed for the screens contract (`share-card`; Copy image is the page's alone).
- `74-native-album-editor`: the album editor and the matcher natively in the Android app (plan B5), from an album's ⋯,
  Edit album, as a sheet from the foot over the album's native page, as the page's: its grip, Edit album and ✕; the cover
  with what is said of it, Find cover (an album with no cover of its own is searched for at once, and a sure match
  chosen), the covers found to choose from (the sure one marked Match) or an image's address pasted and shown before it
  is used, Remove found cover and Keep current cover; the names from MusicBrainz with the album's folder (and its box
  set), Find match, the releases offered with how alike each is (Match or Likely on the first), applied with a tap, or a
  barcode or a release's link; the title, the artist and the year, each with what the files say and Put back; Save,
  Cancel and Undo all edits, and the note. Once it changes the album, its page is read again and the page's walls are
  told. Before, the page's own editor opened over the native page. The page's editor is keyed for the screens contract
  (`album-edit`), its page test opens it on Album One with its title changed.
- `73-native-service-browsers`: the Qobuz and Tidal browsers natively in the Android app (plan B2), from the side menu,
  the search's service artists and Pitchfork's Find on Qobuz. As the page's: over the whole screen, the title and ✕, the
  search field (450 ms after the last key, or Enter) and the tabs (New Releases, then Qobuz's lists, or the ones Tidal
  says) pinned at the head; the line saying what is shown; the albums as tiles with the service's favourite (+ or ✓) on
  each cover, a tap on it adding or taking away the favourite; a search's artists as a strip of round pictures; an
  artist's ‹ Back, picture, name and biography with Show more, and their albums with Load more. A tile opens the album's
  native page (the server makes its library rows first), and its favourite is read again when the browser comes back.
  Two contract screens (`service-browser`, `service-artist`), the page keyed and measured against a stand-in Qobuz.
- `72-snappy-screen-changes`: one native screen now gives way to the next at once in the Android app. Navigation's own
  cross-fade (0.7 s) ran between every two screens, so the screen being left showed as a ghost over the one coming (Home
  over Now playing, tapping the mini player); there is no fade now, in either direction, as on the page.
- `71-native-labels`: the record labels natively in the Android app (plan B1), from the side menu, Home's Label of the
  week, an album's label and the search's label chips. The list as the page's: the heading and Back, the order (# to Z,
  Z to #) at the top right, the row's Search finding a label, every label as a tile (its logo, or its name in words) with
  its name, how many albums and how many merged into it; while the scan runs its bar and what it says (read again every
  few seconds); with none, Rescan now and the scan log (shared or copied). A long press picks labels to merge into the
  first, with the merge bar along the foot; "N merged" opens the labels merged into one, each with its ✕. A label's albums
  are a native wall (its order and fewest albums from Settings → Record labels), with its logo button opening Discogs's
  logos or an address pasted, Save and ✕. Three contract screens (`labels`, `label-logo`, `label-unmerge`) and the wall's
  logo, the page keyed and measured.
- `70-native-pitchfork`: Pitchfork natively in the Android app (plan B3), from the side menu and the search's reviews:
  the magazine over the whole screen with its title, ✕ and the tabs Latest Reviews and Best New Music pinned at its head,
  the reviews as the page's woven mosaic three across (every third large, left then right) with their scores (gold for
  Best New Music), BNM and the album and artist over each cover; a review's page with ‹ Back, the cover, album, artist
  and score, the note that the review is read on pitchfork.com, Read on Pitchfork (the phone's browser), Open in your
  library (the album's native page, when the library has it) and Find on Qobuz (the page's Qobuz browser, its search
  seeded). Two contract screens (`pitchfork`, `pitchfork-review`), the page keyed and measured against a stand-in
  Pitchfork.
- `69-native-notices`: the page's notices at the head of the native Home in the Android app (plan R3, in part). Since the
  native Home came in front from launch (item 64) the page's notices were hidden behind it: the update offer (the
  server's and the app's, with its notes, Update or Later, its progress and a failure) and the server's notice (an empty
  library, no rooms, a music folder gone with its Forget, the data not kept). The page now tells the app of them as they
  change, and the native Home draws them as the page does, at the UI Settings' menu size; their buttons are the page's
  own, tapped. The home contract screen gains them, the page keyed.
- `68-native-room-sheets`: Play on's Group zones and Device power natively in the Android app (plan R1), from Now playing
  and the mini player: the sheets up from the foot as the page's, Group zones with a row for each speaker the room's first
  may play with (ticked in brass, the first kept and said to keep playing, another room's said, the ones Sonos won't sync
  left out and said), Cancel and Apply (split, then group, the first speaker's queue kept; the app and the page then follow
  the new room Roon makes); Device power with each device's controls, Power and Select input, or what it says with none.
  And the question when a room is chosen while the one left is playing, "Move what's playing in Kitchen to Study?", asked
  by the app over its own screen: the page asked it unseen behind the native screen, and no longer does for a room the app
  chose. Two contract screens (`group`, `device-power`), the page's sheets keyed and measured.
- `67-native-menu`: the side menu natively in the Android app (plan R2), opened by the row's Menu on every native screen:
  the drawer from the left over the screen dimmed, sliding in as the page's, Mandarin's mark and name with the red power
  button (Restart, and Shut down where the server can, else how to in Docker), the Offline switch with its line, then
  Pitchfork, Labels, Qobuz, Tidal and Shelf as the server says, Listen later, Dynamic Playlists, Playlists, Rescan library
  with how old the library is (the rescan's toasts, a scan still going waited for and its end said) and Settings, at the
  UI Settings' menu size. Playlists, Dynamic Playlists and Listen later open natively over Home; the rest are the page's
  own items, tapped. The Offline switch holds the screen while the page loads again, the page's menu open on it as before.
  A tap beside the drawer closes it, Back too. A contract screen (`menu`), the page keyed and measured.
- `66-native-dynamic-playlists`: the Dynamic Playlists natively in the Android app (plan P3), opened wherever the page
  opened its own (the side menu, Home's tiles, a playlist saved from its Focus). The screen: the heading with the bar's
  Back, New Dynamic Playlist as the first tile (the dashed brass sleeve with ＋), then each saved one with its covers'
  mosaic, its name and its view in a line. A Dynamic Playlist's page: the bar's Back to Home, ← Dynamic Playlists, its name
  over what it is made of, its order and its view, Play now and Queue (its albums, as many as one go takes, with how many
  of how many said), ⋯ with Share (every album read first, then the page's sheet with the file), Edit (the page's Focus
  with the playlist as what it saves) and Delete (asked first); then its albums as tiles, or its tracks numbered with
  their covers read a few albums at a time with Load more, and the line saying how many. Two contract screens
  (`smart-playlists`, `smart-playlist`), the page keyed and measured; a playlist's tile on the page is called by its name.
- `65-native-playlists`: your playlists natively in the Android app (plan P1, and P2's page), opened wherever the page
  opened its own (the side menu's Playlists, Home's Playlists heading and its tiles). The Playlists screen: the heading with
  the bar's Back, Import in the top-right corner, each playlist as a tile of the wall with its covers' mosaic, its name and
  how many tracks, the last changed first, and the banner while there are none. A playlist's page: the bar's Back to Home,
  ← Playlists, its name over its hairline and how many tracks, Play now and Queue (each track in turn, the first as asked),
  ⋯ with Share (the page's sheet with the file) and Delete (asked first), then its tracks numbered, each with its album's
  cover, a tap playing it. Import is the page's sheet over the screen, and the list is read again when it closes. Two
  contract screens (`playlists`, `playlist`), the page keyed and measured; a playlist's tile on the page is called by its
  name. Offline the page's own stay. Dynamic Playlists follow (P3).
- `64-native-always-on`: the Android app's native Library (its walls and an artist's page with it), Home (with Smart Picks and
  Random Album's pick) and search are permanently on, as Now playing and the album page have been since item 47: the three
  preview switches in UI Settings are gone and the page's own versions are no longer reached in the app. The native Home is
  in front from the app's first frame, drawn to the UI Settings and in the room it was last given, so the page's Home never
  shows first; it steps aside for the app's own error screen, and for a page that never says where Home stands (a sign-in
  page). Offline, the page's Home and search stay, as their rows come from the phone, until the native offline mode (plan O1).
- `61-native-search`: the search natively in the Android app (plan S1 and S2), in a new preview, Native Search in UI
  Settings, beside Native Library and Native Home. The row's Search, the glass, and a search started elsewhere open it in
  place of the page's field: the field across the top bar in brass with its ✕ and the count beside it ("3 artists, 3
  albums", or how far the index is built); under Home's greeting, the library's artists and labels as chips and its albums
  as tiles, each under its small heading, asked a moment after the last letter; then Qobuz's and Tidal's artists (a strip
  of portraits) and albums (each with its + or ✓, a tap opening the album's page) and Pitchfork's reviews with their
  scores, each part landing as it answers, the last words' kept dim until the new ones replace them; the banner where
  nothing matches anywhere; the mini player and the row out of the keyboard's way while the field has it. An album's page
  opens over the results and Back comes back to them. A service's artist and a review open the page's own browser and
  magazine, as they are not native yet. A contract screen (`search`), the page keyed and measured to match, its services'
  and reviews' sections held in a browser against fakes. Offline the page's own search stays.
- `63-native-home-review`: the native Home (item 57, a preview) read against the page's, and set right where it differed.
  A downloaded album the library still has opens its page as any album does (it was played from the phone with "Not in the
  library right now"), and a download's badge is worn in Downloaded albums and its wall alone, not on the same album in
  every row. Random albums is new on every visit to Home and Not played kept five minutes only once it has answered, so a
  failure is asked again next time, as the page's. The Library row asks in the Library's order alone (its Focus and name
  filter narrow the wall, never the row), the view coming with Home from the page or from the native Library's Sort. The
  room reaches Home whenever it changes, not only when Home comes in front (it could start with none), and a room chosen on
  a screen over Home is Home's too. The row's Home goes back to Home from any depth (an artist from an album from a wall),
  and through one of the page's own screens in front of it. The page's own questions over Home (moving the music to another
  room, a name asked for) bring the page in front; offline, the page's Home stays in front, its rows the phone's. Home's
  rows are asked again when one of the page's screens over it closes (Settings → Home Screen, say).
- `62-home-opener-aotd`: the page test of the screens contract failed on dev on the 20th: its Home check waited for today's
  album, which leaves Home once it has been played that day, and on the 20th the album the day chose was the one an earlier
  screen's check plays. The check takes Home without it on such a day; and Home, Smart Picks and the random pick are checked
  first, before any check plays an album, so today's album and its badge are checked as well.
- `57-native-home`: the Home group natively in the Android app (plan H1 to H5), in a new preview, Native Home in UI
  Settings, beside Native Library: Home itself (the greeting with the date over it; the strip under it with Random
  Album's turning disc and today's album wearing ★ Today; the rows in your order and visibility, each heading a tap to
  its wall; the Playlists row's mosaics; the Smart Picks cards; the label of the week with its name large; Browse by
  genre's cards two to a row, each opening a wall of that genre's albums with the reshuffle; and the app's own two rows,
  Downloaded albums with each download's badge and Music on device, from the phone), Smart Picks as a screen of its own
  (each pick's cover, reason, Open or ＋ Add, and Not for me) and the album Random Album chose, offered as the page offers
  it (Play now, Play next, Queue); the walls of a genre, of the downloads and of the phone's music, the last with Focus
  and Sort over the phone's own facets and sorts. Three screens of the contract (`home`, `picks`, `random-pick`), the
  page keyed to match and measured in the browser; the page keeps its own Home underneath and tells the app when its
  Home should be in front (held by a browser test), so the side menu, the search, Settings and the page's own screens
  come up as ever. The page's Music on device Focus says "Clear all", as the Library's does. The native album page's
  Play Now says nothing on success (item 58, merged first).
- `60-composers-only-classical`: an album whose files carry COMPOSER tags (a rock album names its songwriters there) had
  its page headed as a classical album's: the writers where the band's name goes, the band under them as performers. The
  composers' head is a classical album's only now (one set out as works, or whose genre says so); every other album's page
  names its artist alone, on the page and in the app alike (the server decides, in one place).
- `59-booklet-route`: an album with a booklet (a PDF in its folder) crashed the app when the book on its cover was tapped:
  the booklet's screen (item 42) was never declared in the app's navigation graph, so the route built for it found no
  destination. Declared now; and a JVM test holds every route of the shell's to a screen in the graph, so a route without
  one fails the build rather than the phone.
- `58-no-playing-toast`: the native album page's Play Now put up a toast saying "Playing" over the mini player, which was
  already showing what plays. Nothing is said now unless the play failed; Queue, Play next and a track's own actions still
  say what they did, as the mini player doesn't show that.
- `56-mini-bar-buttons`: the native mini player's Play on and volume buttons stood 10dp apart where the page's touch, the
  row's spacing between them; and the 10 came off the title, which was cut short ("Boat Graveya…") where the page's
  wasn't. Side by side now, as the page's, the title the page's 128 wide.
- `55-share-card-flash`: the Share card (and the other sheets) opened from a native screen flashed something on the way in
  and out: the page was put in front before it had painted itself clear, so a frame of Home's covers showed, and on
  closing the page painted Home again before the screen was back in front. Each way is a handshake now: the page comes
  in front once it has painted clear (two frames on), and paints its own screens again only once the app has the screen
  in front. The browser test of the sheets over a native screen holds both.
- `54-native-exact-look`: every native screen held to the page's own numbers, read from the page itself in a browser
  (each contract item's size, type and spacing at a phone's width) rather than from a reading of its stylesheet. The type:
  Material put half a pixel between every two glyphs, so a tile's title stood a twentieth wider than the page's (none now,
  as the page has none unless it says so); a line set tighter than the font's own height (a wall's heading at 1.2, a tile's
  title at 1.25, the track on Now playing at 1.15, an album's title) stood taller than the page's line box, which put the
  heading 5dp low and the tiles' rows apart (laid out as the browser lays them: Type.kt); the wall's figures tabular, as
  the page's are. The buttons: the same button is the same size on every screen, as the page's are, and a ring or a disc
  drawn by a plain button's background or border modifier (the wall's Back, the album's heart and ⋯, the volume's − and +,
  shuffle and repeat, the random wall's reshuffle, the Offline sign) was drawn 48 wide, the button's touch target, not its
  40 or 44: each is now a filled or outlined button, drawn at its own size. The tiles: the hifi palette's sleeve (corners of
  12, the faint ring, no shadow), 11 under the cover, the title at 600; the heading and the first row where the page has
  them; the mini player's pill the page's 96 with its meter where the page's is; the row's words at their own line; the
  album page's action row 42 tall with the ⋯ menu at the page's sizes, its head's lines at the page's; Now playing's tabs,
  track, artist, album and badge lines, Play on as the page's popover, the volume sheet 14 over the mini player; the Queue's
  summary, tools and rows as the page's; the booklet's head; the yes-or-no sheet as the page's own, not Material's. And the
  Share card (with Add to playlist, Edit album, Group zones, Device power and a Dynamic Playlist's name), asked for from
  Now playing or an album's native page, opened over Home with the native screen gone: it opens over the screen now, as it
  opens over the page's own screens, and the screen is there again when it closes. And the page's own Back now closes
  a lib sheet (Focus, Sort, Group zones, Device power, Add to playlist), the album editor and the name prompt: on Home
  with one of them open it answered "nothing to close", and the app left the screen.
- `53-native-wall-look`: the native Library wall, the walls and an artist's page drawn as the page draws them where
  they strayed (the owner's screenshots): the heading in the page's serif (Young Serif, as the hifi palette sets its
  titles), the bar's Back a brass disc with the glyph in the charcoal, Focus and Sort as brass pills, and the room
  between the heading and the first row the page's. The mini player stood 8dp taller than the page's on every native
  screen: its three lines of text took Material's 24sp body line each, three of which stand taller than the cover;
  each line is now at the font's own height, as the page's. The sheets', chips', pills' and rows' texts likewise.
- `52-native-library-group`: the rest of the Library natively in the Android app (plan L2 to L5), in the same
  preview as the wall (Native Library in UI Settings): Focus (the listening and each facet as a section that opens to
  its chips, a chip tapped once included, again excluded, once more cleared; Clear all, Save as… through the page's
  Dynamic Playlist prompt, Show albums) and Sort (a row each way, the one on reversed by a second tap, Random
  reshuffled) as sheets up from the foot of the screen; the name filter across the top, opened by the row's Search;
  albums selected by a long press, the bar's hint, the ⋯ with the count and its Play now, Play next, Add to end of
  queue, Add to playlist… (the page's sheet), Listen later and Clear; the walls Home links to (Listen later,
  Favourites, Recently played, Not played in 6 months, Random albums with its reshuffle) and an artist's page (the
  count and the name, the biography with Show more, their albums and those they appear on), each a native screen
  with the mini player and the row. A change of view on the native wall goes back to the page, so its own wall and
  Home's Library row follow. Three screens of the contract (`library` whole, `wall`, `artist`), keyed on the page and
  in the app, each tile carrying all three; the page's check closes a sheet by its own close. `core` holds the view as
  the page writes it (`LibraryView`, with its JVM test) and reads the facets, the walls and a biography.
- `51-native-library-wall`: the Android app's Library wall natively, a preview (Settings → Setup → UI Settings →
  Native Library): a tap on Library opens the app's own wall in the page's view of the library (the sort and the
  focus as the page's wall asks for them) and at this phone's UI Settings (the columns or the list, the tile and
  text sizes); the heading with the count, the bar's Back over the albums, the tiles as the page's (the cover with
  its corners, "♪" without one, the rate in brass when better than CD, a service's mark, two discs), paged sixty at a
  time as the end comes near, the banner where the library can't be read yet or nothing matches; the mini player
  and the row along the foot; a tile opens the native album page over it, with the wall as its list for previous
  and next, and Back comes back to the wall where it was. The wall is the screens contract's (`library`), keyed on
  the page (the bar's Back and title, the banner, Focus, Sort, the filter, each tile and its parts), with Focus, Sort
  and the name filter its gaps for L2. The page's check takes the mini player and the row under a wall's root as
  their own screens' (`shared`). Covers are kept once fetched (`Covers.kt`); the page's UI Settings are read by
  `core` (`WallPrefs`, with its JVM test).
- `50-native-track-disc-place`: the brass disc on the track playing, on the Android app's native album page, sat
  against the first letter of the track's name; it is now in the middle of the room between the track's number
  and its name, as the page's (nowdisc.js): the number's figures measured as drawn, the disc half the room past
  them, so a one-figure number and a two-figure one place it alike.
- `49-classical-works-page-app`: a classical album's page, on the page and in the Android app alike, set out
  as works and movements as Roon has them (from the server's works, item 48): the composers' line in the
  artists' place, each a tap to their page, and under it who performs the album, the conductor named as such;
  WORKS over the list; a work's row with a brass ring that plays it, its name, who it is by where the album
  has several composers and who performs it, and its length; its movements under it as track rows, indented,
  with their numbers; a one-track work its own row; a set's discs heading the list; a tap on a work's row
  opening Play now, Play next and Queue for the whole work. The items are the screens contract's
  (`composer`, `performers`, `disc-head`, `work`, `work-play`, `work-composer`, `work-performers`,
  `work-length`, the work's three buttons), keyed on the page (`album-works.js`) and in the app
  (`AlbumWorks.kt`, `ComposerLines`), so neither can drift; `classical-works.test.js` opens such an album
  on the page and holds it to the contract. An album with no works is drawn as it always was.
- `48-classical-works-server`: the server sets a classical album out as works and movements (the page and
  the app draw them next, item 49). The scanner keeps what the tags say of a track's composer, conductor,
  work, movement and its number, and performers (`Tags/Classical.cs`; a library from before has every file read
  once more for them at its next scan), and the album's page answers with `works` (each a work with its movements, or a plain
  track, in the album's order) and the album's `composers`, `conductor` and `performers`. Works come from
  the WORK and MOVEMENT tags where the files carry them, or from the titles ("Symphony No. 5: I. Allegro",
  consecutive and numbered, or by a composer) where they don't; a compilation's "Artist - Title" is left
  alone (`Works.cs`, held by `WorksTests`).
- `47-native-screens-always`: the Android app's Now playing (with its Queue) and album page are the app's own
  always: the two preview switches in Settings → Setup → UI Settings are gone, a tap on the mini player or an
  album opens the native screen, and the page's Now playing and album page are not reached in the app. The
  three screens leave preview in the contract. An older app still says it has no native screen, and the page
  opens its own, as before.
- `46-native-plan-remaining`: a plan, nothing built: what is left for the Android app to be wholly native,
  every screen and function of the page's, set out as about forty items in stages (the frame, the Library,
  Home, Search, playlists, rooms and the menu, labels, the services, the share card and the editor, Settings
  pane by pane, offline natively, the WebView's end), in `old/plan-android-native.md`.
- `45-native-volume-sheet`: the Android app's native Now playing and mini player open the page's volume sheet,
  not Material's menu: a glass pill the width of the screen (at the foot of Now playing; just above the mini
  bar), the speaker and the level in brass, the slider over the speaker's own scale with its ends written
  under it (brass to the thumb, the thumb brass), and − and + in brass rings. The level follows a drag at once
  and is sent as it ends, as the page's does; a room with no volume says it is fixed. The sheet's glass and edge
  join the palette held to `style.css` (`--bg-veil`, `--glass-edge`).
- `44-native-album-download-service`: the Android app's native album page's ⋯ has the last two of the page's
  items: Download to this phone (Remove from this phone, or Downloading… n/m while it goes, following the app's
  own downloads through the same dialogs the page's bridge uses), and a streamed album's favourite on its
  service (Add to / Remove from Qobuz or Tidal favourites; removed, the page closes and the walls drop it,
  `library-changed` in `public/app/native-handoff.js`). The gaps list is empty: the native album page lacks
  nothing of the page's and is out of preview in the contract, so it can't fall behind the page again.
- `43-native-album-select`: the Android app's native album page (preview) selects tracks as the page's does: a
  long press on a track starts it, each row's circle (or the row) picks or unpicks, a picked row washed in
  brass, and the ⋯ with the count, top right in place of previous and next, opens what to do with them: play
  now, play next or add to the end of the queue (in the album's order, one at a time as the page sends them,
  Play next last to first), add to a playlist (the page's own sheet, `album-playlist-tracks` in
  `public/app/native-handoff.js`), Listen later (the album), or clear. 9 items off the gaps list.
- `42-native-album-booklet`: the Android app's native album page (preview) has the album's booklet: the book
  on the cover when its folder has a PDF (one opens at once, several are chosen from a list), and the booklet's
  pages one under another over everything, each drawn by the server as wide as the screen, with Close and the
  page count as the page's viewer has them (`BookletScreen.kt`). The viewer is a screen of the contract
  (`docs/specs/screens.json`, `booklet`): the page's viewer carries its keys, and `test/parity.test.js` gives
  Album One a booklet and opens it.
- `41-native-album-nav-notes`: the Android app's native album page (preview) has previous and next beside
  Share, the album before and after it in the row or wall it was opened from (the page hands the list over as
  it opens the album, `MusicdApp.openAlbumIn`; the app holds it and each page stepped to keeps its place), the
  notes under the head (named from its folders; why a streamed album is here, as the page words it; a disc of
  a box set, with the other discs a tap away, stepping through the box), and the service's mark on a Qobuz or
  Tidal album's cover. 7 items off the gaps list.
- `40-native-np-tabs-weights`: the Android app's native Now playing has its Queue tab back, and the brass line
  under the tab on is as wide as its word (it filled the row, pushing Queue off the screen). Every native screen
  is in the page's weights now: the variable Manrope's default instance is ExtraLight, and the app drew every
  weight with it; `res/font` carries a static instance a weight (Regular to ExtraBold), so a title is bold as
  the page's.
- `39-native-album-about`: the Android app's native album page (preview) has what the page's has under the
  tracks: About this album (the write-up, Show more, whose words they are, the link to its page), then More by
  the artist and the albums they appear on (the library's own, `/api/artist-albums`), then Last.fm's similar
  artists (with its Last.fm link, and the note when the key is wrong) and similar albums, three of each and More
  for the rest. An album of the library's opens its own native page over this one, an artist of the library's
  their page, and what only Last.fm knows its Last.fm page, marked "Last.fm ↗" as on the page. `core` reads the
  review from the extras and Last.fm's two answers (`Lastfm.kt`), each tested. 16 items off the gaps list.
- `38-native-touch-nav`: the Android app's native album page (preview) has the touch layout's row along the
  foot of the screen, as the page's: Menu, Home, Library and Search under the mini player, the one the page is
  on in brass (the page says which as it opens the album), and the Offline sign between Home and Library when
  the app is offline. Each tap goes back to the page and taps its own button (`nav` in
  `public/app/native-handoff.js`), so there is one way to do each thing. The row is a screen of the contract
  (`docs/specs/screens.json`, `nav`): the page's row carries its keys, and the app has every item.
- `37-native-album-look`: the Android app's native album page (preview) is drawn as the page's sleeve: the
  brass corner discs, the cover's glow fading out behind the top, the 160px sleeve with its ring and shadow,
  the head in the page's type and white (the artists in brass), the heart as the page's (hollow, red once
  tapped), Play Now and Queue as brass pills and ⋯ outlined, "TRACKS" tracked out over its hairlines, the rows
  at the page's sizes with the brass disc turning on the track playing in the room (`album.track-playing`,
  off the gaps list), the open row's wash and its pills. The date line no longer says "null" for an album
  with no label: Android's org.json reads a JSON null as the word "null" where the JVM's (the tests') gives
  the default, so each field of the extras that can be null is asked first (`AlbumExtras.kt`).
- `36-native-np-look`: the Android app's native Now playing (preview) is drawn as the page's, not in Material's
  own look: the page's type (Manrope, the hifi palette's `--font-sans`, as `res/font/manrope.ttf`, for every
  native screen), the brass corner discs and the tracked-out tabs with the brass line under the one on, the
  cover whole in a rounded frame in the room the controls leave, the title and the artists in the page's white,
  the format badge, the seek bar as the page's level meter with its white thumb (the waveform, when there is
  one, at the page's 64px), the transport in brass with shuffle and repeat small and dim until on (the "1" inside
  repeat's arrows), and Play on and the volume under it, each at the page's size and spacing.
- `35-native-mini-player`: the Android app's native album page (preview) has the mini player at its foot, as
  the page's bar: what the room plays (its cover and track, the room and the format above them; a tap opens
  Now playing, the native one when this phone has it on, else the page's), play/pause, Play on and the volume
  (Now playing's own menus, so each of their items carries both screens' keys), and the track's progress as the
  brass level meter along the bottom. A room chosen on its Play on is the page's room too. The mini player is
  a screen of the contract (`docs/specs/screens.json`, `mini-player`): the page's bar carries its keys
  (`test/parity.test.js` opens it), and the app has every item from the start, so it isn't in preview.
- `34-background-stop-away` (first part): the Android app says, at its next start, why playback stopped in the
  background: why Android ended the app (when it was a fault, or came while it was playing), the Tailscale
  engine ending by itself (its exit code and last lines), or the player giving up away from home (and whether
  the engine was still running), with Share details as for a crash.
- `33-native-regex-crash`: the Android app no longer crashes opening native Now playing. Its labels were filled
  by a regular expression the JVM takes and Android refuses (an unescaped `}`); escaped, and every regex in the
  app's Kotlin is now checked against Android's rule (`test/android-regex.test.js`), which the JVM tests can't see.
- `32-native-album`: the Android app's native album page (stage N3, a preview, switched on in Settings → Setup →
  UI Settings, "Native album page"). An album tapped opens the app's own page of it, in the room chosen: the
  sleeve and its glow, the head (title, artist, date, label and score, rate and length), the heart, Play Now,
  Queue and ⋯ (Play Next, Shuffle, Radio, Listen later, Add to playlist, Edit album), and the tracks (a tap:
  Play now, Play next, Queue). Share card, Add to playlist, Edit album, an artist or a label open on the page.
  What it lacks yet of the page's (previous/next, booklet, review and the rows under it, selection, Download)
  is on the gaps list, which only shrinks.
- `30-album-contract`: the album page in the screens contract, ahead of its native screen (stage N3): its items
  keyed on the page (`data-parity`) and held by `test/parity.test.js`; the gate holds every key of the contract
  written in the page's source, so one shown only for some albums (a booklet, a review, Last.fm's rows, the
  app's Download) can't be lost unseen. Nothing changes on screen.
- `29-native-queue`: the Android app's native Now playing (preview) has its Queue tab: the queue (play on from a
  track; a long press picks tracks to play now, next or remove; Clear all) and what played earlier (put one back
  next, or several next or at the end), each asked first in a native copy of the page's yes-or-no sheet. The
  screens contract holds the Queue and the sheet too (one element can carry two screens' keys), and none of the
  three native screens lacks anything of the page's.
- `28-album-head-lines`: the album page's head is a line each beside the sleeve: the title, the artist, the
  release date (its label and score after it), then the rate (16/44.1, hi-res in brass) and the album's
  length. The rate leaves the cover, the length the Tracks line; the date no longer wraps with the artist.
- `27-native-np-links`: the Android app's native Now playing (preview) has Share card, the artists (each with
  a page of their own a tap away) and the album, handed back to the page's own (`share`, `artist`, `album` in
  `public/app/native-handoff.js`), and the track's waveform under the seek bar, folded as the page folds it
  (`Waveform.kt`). The gaps list is down to 2: the Now playing and Queue tabs.
- `26-native-np-controls`: the Android app's native Now playing (preview) has shuffle and repeat, the format
  badge, the volume menu (its scale, a step down and up, or "Volume control is fixed") and Play on (each room,
  Group zones and Device power, which open the page's own sheets through `public/app/native-handoff.js`, and
  pause and mute every room), in the page's own icons. The gaps list is down from 23 to 6.
- `25-native-parity`: the screens contract (`docs/specs/screens.json`, `docs/specs/native-parity.md`): each
  screen the Android app draws natively, its controls and readouts by key and its labels. The page is held
  to it in a browser (`test/parity.test.js`), the app by `npm run parity` in the gates (every control and
  readout of a native screen keyed, its labels from the contract's `Contract.kt`), so neither side can gain
  or lose an item alone. Native Now playing, in preview, lacks 23 of the page's items, listed in
  `tools/quality/parity-gaps.json`, which only shrinks; its room name, which the page doesn't show, is gone.
- `23-android-native-nowplaying`: native Now playing in the Android app, a preview behind a switch in
  Settings → Setup → UI Settings: the room's track, cover, seek and transport; the mini player hands over to it.
- `24-album-page-sleeve`: the album page leads with a 160px sleeve, the title and the artist line
  beside it, and the buttons straight under them, on a phone, a tablet and a desktop alike; the
  cover's colours glow behind the top again; previous and next sit beside Share; the ⋯ menu opens
  downwards over the tracks; from 720px up About this album is a column beside the tracks.
- `22-android-native-n1`: the Android app's typed client for the library (`LibraryClient`, `Library.kt`):
  albums, an album's page, artists, search and Home's rows. The server's answers on the test library
  are kept in `test/golden/android-api.json` (AndroidApiTests), and the app's tests read its client's
  from there (LibraryTest): a change to either side fails until the other is told.
- `21-android-native-n0`: the Android app's native shell (stage N0 of
  `old/plan-android-native.md`): Compose, its navigation and Mandarin's graphite and brass
  (held to the page's palette by a test), laid over the page's WebView. Nothing on screen changes;
  the native screens go in it from N2.
- `20-dev-branch`: `migration` is `dev` now: its pushes publish `ghcr.io/meltface-80/musicd-server:dev`
  and the Android app's `test-android` pre-release; work is merged there, the version moved when
  the owner says (CLAUDE.md section 4).
- `19-apk-publish-on-latest-main`: the Android app is put in dist/ on main as it is now, not on
  the commit it was built from (`.github/publish-apk.sh`): two merges close together left the
  second's pull request in conflict (1.0.17's, published by hand), and an older version's run
  ending last no longer puts its app over a newer one.

## v1.0.17
- `18-test-races`: a scan isn't said to have ended (/api/status) until the library has been read
  again: for a moment it was, and albums asked for then were the ones from before it, or "still
  being scanned". The offline sign's test waits for the page's own look at the server, and the
  renderer's transport test holds a long track, not a three-second one, and the services' stream
  test waits until nothing is being converted, as the server counts it.

## v1.0.16
- `16-17-plans-ios-pwa-android-native`: plans, nothing built: playback on the iPhone's home-screen
  app (`docs/specs/plan-ios-pwa-playback.md`) and a native Android app
  (`old/plan-android-native.md`).

## v1.0.15
- `15-spaces-in-search-fields`: a space typed in the Library's filter stays, so two words can be
  looked for.

## v1.0.14
- `14-recently-played-grid`: Home's Recently played opens to a grid screen of its own.

## v1.0.13
- `13-search-one-tap`: Search from Home is one tap, the Android app's keyboard with it.

## v1.0.12
- `11-service-grids-follow-settings`: Qobuz's and Tidal's grids take List as every grid does, and
  each grid screen's title takes the Grid screen title size on a touch screen too.

## v1.0.11
- `10-share-card-no-label`: the share card carries no record label (a long one ran off the card).

## v1.0.10
- `09-offline-toggle-silent`: the side menu's Offline switch moves and nothing else is seen to:
  the app holds a picture of the screen while the page loads again under it (`PageCurtain.kt`),
  and the menu is back open without sliding in.

## v1.0.9
- `08-hide-greeting-random-button`: Settings → Setup → Home Screen switches the greeting and
  Random Album off, on this device; what was under them moves up.

## v1.0.8
- `07-home-position-after-genre`: Back from a genre, or a row's wall, comes to Home where it was
  scrolled to; Home tapped on Home still goes to its top.

## v1.0.7
**Fixes from the bug list** (`bug-list.md`), one branch each, merged in order.

- `v1.0.6-tests-csharp-5-suites`: CI red on every run since T1e. `TagsFrontTests` held the C# tag
  reader to music-metadata's readings of files made on the spot by whichever ffmpeg the machine had;
  the readings were kept from ffmpeg 6.1.1's files, and CI's static ffmpeg makes others. The 31 files
  ffmpeg made are kept as made (`test/golden/tags-front.files.tar.gz`); the test needs no ffmpeg.
- `02-android-unresponsive`: the page waited, script stopped, while the app read every downloaded
  album's `album.json` again after each track a download finished; and every return to the app
  redrew Home's downloaded and on-the-phone rows. The list is read on the app's own thread before
  the page is told (`DownloadAlbums.kt`), and a row that hasn't changed stays as drawn.
- `03-audio-device-detection`: renderers that announce themselves (`NOTIFY ssdp:alive`,
  `Renderers/SsdpListen.cs`) and sound devices plugged in (`/dev/snd` watched) are found at once,
  not at the next minute's search; the network searched every 20 s while Audio Devices is open;
  Look again reads this computer's devices alongside the network's.
- `04-grid-position-after-focus`: Focus closed with nothing changed (Show albums, nothing chosen;
  Clear all, nothing to clear) leaves the Library wall where it was, not back at its first album.
- `05-top-button-touch-area`: a tap just off a top button on a grid screen with no strip round it
  (Focus and Sort 32px tall, ‹ 40px) is the button's, not the album's under it.
- `06-no-overscroll-bounce`: no stretch when Home or a list is pulled past its end in the app:
  Android drew its own round the WebView whatever the page said (`PageFrame.kt`).

## v1.0.6
**The tests in C#** (`docs/specs/tests-csharp.md`): the Node suite moves to C# file by file, and Node
and npm leave the project after it. Nothing the server or the page does changes.

- Stage T0 (`v1.0.6-tests-csharp-0-groundwork`): `test/Mandarin.Tests`, an xUnit v3 project, with
  the Node suite's helpers in C# (`Harness/`): the server started and stopped, its options, ports of
  its own, the fixture library, signing in by SRP, the HTTP rules (nothing off this machine, no
  request waits for ever), Chromium over the DevTools WebSocket, and `mandarin-server score`.
- Ported, their JavaScript files deleted: `srp` (the page's `srp.js` now run in Chromium, the
  tests' own SRP client and the server's half, all held to the fixed vector), `version`,
  `favourites`, `mounts`. Shown failing: the tests' SRP with its separator changed, favourites with
  the server's newest-first order turned round.
- CI and the release run both suites; the C# classes are dealt out to the same three parts, and a
  failure runs once more on its own (`.github/csharp-tests.sh`).
- `tools/quality/policy.json`: the C# tests are under the file-length gate (`test/**/*.cs`).
- Stage T1a (`v1.0.6-tests-csharp-1-core`): 17 more files ported and deleted: `cpu`, `db`,
  `http-body`, `listen-later`, `music-folders`, `power`, `queue-moves`, `soap-retry`, `topology`,
  `version-compare`, `watch`, `waveform`, `home-rows`, `relay`, `case`, `identify-verdicts`,
  `page-script` (each part and the join compiled by Chromium, as the page loads them). Shown
  failing: release candidates with their numbers compared as text; two parts declaring one name.
- Stage T1b (`v1.0.6-tests-csharp-2-core`): 10 more: `config-csharp`, `identify-pack`,
  `phone-resume`, `library-kept`, `pages-csharp`, `downloads`, `folder-names`, `playlists`,
  `nothing-behind`, `album-folders`. The harness gains `ServerCommand` (one of the program's own
  commands run to its end), `Bytes` (an answer as bytes) and a client that asks as a browser does
  (compressed answers accepted), and reads numbers a test wrote itself. Shown failing: the
  configuration's mass-removal default changed.
- Stage T1c (`v1.0.6-tests-csharp-3-core`): 11 more: `engine`, `power-csharp`, `cpu-alone`,
  `stream`, `security`, `backup-sealed`, `local-output`, `dsp` (the page's `biquad.js` run in
  Chromium), `scans-csharp`, `update-alone`, `tailscale-builtin`. The Tailscale engine the tests
  stood in for with a Node script is `test/StandIns`, a small C# program the tests start as the
  server would start the real one; the tests' own web servers can serve HTTPS. Shown failing: the
  page's frame guard loosened.
- Stage T1d (`v1.0.6-tests-csharp-4-golden`): six of the suites held to the Node server's recorded
  answers (`test/golden`): `db-csharp`, `share-csharp`, `backup-csharp`, `artfind-csharp`,
  `extras-csharp`, `conversions-csharp`. The harness reads the recordings as JavaScript did and
  writes JSON byte for byte as JSON.stringify wrote it (`JsJson`: a lone surrogate kept, nesting
  unbounded, an object's number-like keys first, a number as Number's toString writes it), so the
  recorded sums still match; the suites' seeded cases are made the same way (`JsGen`: their
  generator, JavaScript's undefined), and a list of cases too long to copy by hand is kept as data
  (`test/golden/artfind-csharp.cases.json`, written once from the JavaScript). Shown failing: a
  backup's refusal reworded.
- Stage T1e (`v1.0.6-tests-csharp-5-suites`): four more: `scan-csharp`, `tags-front`,
  `writeups-csharp`, `identify-csharp`. The jobs the write-up and identify suites sent the program
  are kept as they were sent (`test/golden/*.jobs.json.gz`, a year ahead as `<NEXT YY>`), so their
  generators need no port. The tag files are made by `Harness/TagFixtures.cs` byte for byte as
  `test/tagfixtures.js` made them, and music-metadata's readings of them are kept
  (`test/golden/tags-front.json`): `test/tag-oracle.js` and `test/tagfixtures.js` go. Shown failing:
  a tag file's title changed by a letter; a track's length named under another rule.
- Version 1.0.6 (Android versionCode 314).

## v1.0.5
**The page's script in parts** (`docs/specs/page-modules.md`): `public/app.js`, 19,579 lines, is
carved into files under `public/app/`, served joined as one script.

- Stage 0 (`v1.0.5-stage-0-groundwork`): the server makes `/app.js` from the parts
  `public/app/parts.txt` lists, in order, kept and sent with an ETag
  (`server/Mandarin.Server/Pages.Script.cs`); without the list, `app.js` is sent as it is. The
  Android app's offline copy is joined the same way when the app is built. For now the list
  names one part, `app.js` itself: nothing the page does changes.
- Stage 1a (`v1.0.5-stage-1a-small-blocks`): ten small blocks before and after the rest of
  `app.js` (the sign-out guard, request limits, the library mark, after-start, UI settings; UI
  Settings, Away from home, the toast lift, power, backup and restore) are parts of their
  own, moved unchanged and in their order: the join's tokens are the old file's.
  `test/page-script.test.js` also compiles each part alone and the join as one script; shown failing
  with one `const` declared in two parts.
- Stage 1b (`v1.0.5-stage-1b-big-blocks`): everything after the core is parts, in its order, none
  over 400 lines; `app.js` is the core alone (10,367 lines).
  - The mini transport (5 parts), the share card (3), the Settings sheet (4), Audio Devices (3)
    and the Library Scanner (2) lose their wrappers: their names move to the page's top. The few
    that would clash there are renamed by scope: `open`, `close`, `when`, `USB` and `status`
    (a browser's own names), `overlay` (both the share card's and Settings'), and the Library
    Scanner's ten names that Audio Devices has too (`pane` → `scanPane` …). The guards that left
    Settings, Audio Devices and the Library Scanner when their elements were missing go: the
    elements are in `index.html`.
  - The streaming-service browser, made once per service, keeps its closure: its album rows and
    its views are functions it calls with `sb`, what its pieces share.
  - The 17 small blocks among them are parts as they were.
  - `npm run names` (`tools/quality/page-names.js`, new, in `npm run gates`): over the parts
    joined and the page's other scripts, no name declared twice at the top, none a browser's own,
    each read somewhere, nothing read that nothing declares. ESLint is told every part's top
    names. Shown failing with a part declaring `close`, a second `scanLoad`, a name read nowhere
    and one declared nowhere; `test/page-names.test.js` (new) holds its verdict.
- Stage 2 (`v1.0.5-stage-2-core`): the core is 33 parts, in its order, none over 400 lines;
  `app.js` keeps only the startup that closed it (`bootstrap()`, 68 lines), and leaves the
  file-length allowance and its exemption.
  - The core loses its wrapper, and so do two big blocks inside it, the search and the labels
    browser; their names join the page's top with no clash (stage 1b renamed the add-ons' that
    would have), but the search's `row` and `openBtn`, which the Library Scanner and Settings
    have: `searchRow` and `searchOpenBtn`. Their guards for missing elements go, as 1b's did.
  - 933 names at the top of 81 parts, none clashing, each read (`npm run names`).
- `test/page-script.test.js` (new): the list and the folder agree, the three joins (server,
  Android, test) agree, and `/app.js` is the join. Shown failing with a script in `public/app/`
  the list doesn't name.
- `test/page-tour.test.js` (new): every screen of the page opened in a browser, at a desktop and
  at a phone, with nothing thrown. Shown failing with a name missing from Music folders.
- `test/backup-page.test.js`: the sealed-backup test waits for the first scan before it opens the
  page, as the test beside it does. A page drawn on an empty library reloads itself once the albums
  come, which broke the test two runs in three.

## v1.0.4
**Downloads in Setup** (`v1.0.4-downloads-in-setup`): the Android app's Downloads page is in
Settings → Setup, before Away from home.

- It was placed before Wall Display in the Settings list; when v1.0.2 moved Wall Display into
  Setup, it fell to the foot of the list, under Updates. Now it is Setup's, and Back from it goes
  to Setup, as its other pages' do (`public/app.js`).
- The app's own pointer (Downloaded albums: "Download settings: Settings → Setup → Downloads."),
  README and the Pages site say where it is now.
- `test/downloads-tile.test.js` (new): with the app's bridge stood in, Downloads is in Setup before
  Away from home and not in the Settings list, opens its page, and Back goes to Setup; a browser
  has none. Shown failing on v1.0.3's page (Downloads after Updates).

## v1.0.3
**Mac support dropped** (`v1.0.3-pull-Mac-support`): Mandarin runs on Linux, in Docker. A Mac
can't be tested here, and a Mac's DAC playback (through Mandarin DAC Bridge) stopped on a user's
Mac in ways that couldn't be reproduced; the Mac's CI jobs also held builds and releases up.

- **Gone**: the Mac install line (`tools/mac/install.sh`), the Mac's builds in each release
  (`mandarin-server-osx-arm64.gz`, `-osx-x64.gz`) and the release job that made them, the Mac
  test jobs in CI, and Mandarin DAC Bridge (no longer offered, built or tested:
  `.github/dac-bridge.sh`, `test/dac-bridge.test.js`).
- **CI runs on a push** (and by hand) only: the pull request runs into main and the weekly run
  existed for the Mac's tests.
- **The server** keeps only Linux's ways: no Core Audio device list (`Local/LocalDevices.cs`), no
  launchd login item for Shut down (`PowerRoutes.cs`; `start_again` is `docker` or `manual`), no
  libSystem or macOS file system calls (`Program.cs`, `Scan/PosixFs.cs`), no BSD `nice`
  (`Cpu.cs`), no Mac build or signing in an update (`Admin/Updater.cs`), Linux only in
  `server/build.sh`. Audio Devices drops its Mac and DAC Bridge notes.
- **A Mac install on v1.0.2** keeps working as it is. Its update from Settings finds no build for
  it and changes nothing. To move: back up (Settings → Backup & restore), install on a Linux
  machine with Docker, restore.
- README and the Pages site: the Install on a Mac sections and the DAC Bridge notes removed; a
  v1.0.3 note says the above.
- The Mac's tests went with it (Core Audio parsing, launchd's Shut down, the engine off Linux,
  Tailscale's engine off Linux); `test/power.test.js` now holds that a Mac's old login item gets
  nothing of its own.

## v1.0.2
**Optional features** (`v1.0.2-optional-features`): the wall display and Shelf each switch off
whole, from Settings → Setup.

- **Settings → Setup → Wall Display**: the wall display's page moved from the Settings list into
  Setup (Back goes to Setup). On by default, as before.
- **Settings → Setup → Shelf** (new): Shelf's switch (`/api/settings/shelf`, `shelfEnabled`,
  carried in a backup's settings). **Off on a new install**: written off when the database is
  first made (`Features.NewInstall`). An install from before v1.0.2 has no setting and keeps Shelf
  on, as it was.
- **Off is off** (`server/Mandarin.Server/Features.cs`, new). Neither part had work of its own in
  the background; what they cost is what their screens ask for. Switched off:
  - `/display` and `/shelf` are a page saying so (`public/display-off.html`,
    `public/shelf-off.html`) with no script, so a screen left open on it asks for nothing more.
    Before, a wall display switched off kept asking for its setting every minute;
  - what only they ask for is refused: the wall display's content (as before) and Shelf's list,
    never made, and one kept for the library let go when Shelf is switched off;
  - a page open as it is switched off goes to that page at its next look, within 30 s;
  - the side menu has no Shelf (`public/features.js`, new), and the wall display no Shelf button.
  Switched on again, each is as it was.
- `test/optional-features.test.js` (new). Shown failing with the code broken: a kept list sent
  while off, `/shelf` always Shelf's own page, the side menu's Shelf left, a new install's Shelf
  left on. The tests that use Shelf switch it on first, as a new install must. `test/settings-desktop.test.js`
  now has Wall Display and Shelf among Setup's pages, Back from each to Setup.
- `public/display.js` is 10 lines shorter (644; its allowance follows).
- The Android app bundles `features.js` for offline, and `test/offline-bundle.test.js` (new) holds
  every script `index.html` loads to both of the app's lists (`build.gradle.kts`, `OfflineSite.kt`):
  each new script had been added to them by hand. Shown failing with `features.js` left out of
  either.

## v1.0.1
**UI tweaks 1** (`v1.0.1-ui-tweaks-1`): the album page's playing track, and the Shelf's order and looks.

- **The playing track has a disc** (`public/nowdisc.js`, new). On an album page, the track the
  selected zone is playing has a small disc between its number and its name, centred in the room
  between them and on the name's line, inside the row's lines; the names don't move for it. It
  turns while the zone plays and stops when it pauses (and stands still with reduced motion). It
  follows the zone: Play now, the next track, a pause. Each row now carries its track's id
  (`data-track-id`, on the line that makes the row, so `public/app.js` stays at 19,582 lines). The
  Android app bundles the new file for offline.
- **The Shelf's order switches** (`public/shelforder.js`, new). The order's name above the shelf is
  a button: **A → Z by artist** (the server's order, as before) or **A → Z by album**, by title as
  the Library wall's Album order reads them (a leading "The", "A" or "An" aside, accents and case
  folded). Both put titles of signs alone first, then those starting with a number, then the
  letters. The album in front stays in front; each device keeps its choice; under Random order it
  says so and doesn't switch. By album, the spines' tabs are the titles' letters. The help (shown again
  after an update) says how: a seventh line, which `test/shelf.test.js` now expects.
- **The Shelf's carousel look is gone**: covers and spines. A device that had the carousel opens on
  the covers. `public/shelf.js` is 15 lines shorter (2,047; its allowance follows).
- `tools/lint/node_modules`, a link to a folder on the machine v0.9.4 was made on, committed by
  mistake, is gone (the folder is git-ignored; `npm run tools` makes it).
- `test/now-disc.test.js` and `test/shelf-order.test.js` (new). Each was shown failing with the
  code broken: the disc not centred; "The" not set aside; the carousel kept.

## v1.0.0
**The release review** (`v1.0.0-release-review`): everything since the audit (v0.9.1 to v0.9.7)
read again before the owner's merge to main. Two faults found and fixed, and a test that raced;
the README and the Pages site say what is new since v0.9.0.

- **Lists that follow the play history went stale after a play** (`LibraryRoutes.Kept.cs`, from
  v0.9.3's kept lists). A kept list was keyed on the copy of the library and the hearts, and a play
  changes neither, so the wall sorted by Most played or Last played, the Played filter, and the
  facets' Played counts came back as they were before the play (a 304 to a page whose copy was
  current), until a scan, an edit or a heart. Now the wall is made afresh whenever its sort or
  filter reads the plays, and the facets are kept apart for "no plays yet" and "some plays".
  `test/library-kept.test.js` plays a track and asks again: it failed on the old code and
  passes now.
- **A renderer's tick came before its rate was kept** (`Renderers/Players.Commands.cs`). When a
  WiiM (or a sound device on Linux) confirmed the rate it was sent, Now playing showed ✓ first and
  the rate was marked verified on Audio Devices after; a page that opened the device's page on
  seeing the tick could still find the rate "profile". The rate is now kept first, then the tick
  shown. Found when `test/renderer-playback.test.js` failed on a busy machine; with a 1.5 s pause
  put before the write it failed every time on the old order, and passes on the new.
- `test/backup.test.js` waits for a restore's restart (half a second after its answer) before
  asking anything more. On a busy machine the next request reached the server as it started again
  ("fetch failed"); with an 800 ms pause put in after the restore it failed every time, and passes
  now.
- **README and Pages**: a "New in v1.0.0" note (the phone and tablet layout, the Android app
  installed over itself, the APK's name, the audit), and why a Mac's install line offers Mandarin
  DAC Bridge: Mandarin's audio engine plays through ALSA, which macOS doesn't have, so the bridge
  plays a USB DAC on a Mac instead; playing it from Mandarin itself is for a later build. The
  phone and tablet layout is a feature of its own (`tools/docs/features.py`), and the Library,
  Search, Labels and Offline notes say where their controls are on a phone or a tablet.
- `tools/docs/features.py`, which writes both feature lists, had fallen behind the README in four
  notes (matches applied from 85%, a Mac's DAC through the bridge, what a backup holds, how an
  update starts again): run, it would have put the old words back. It now holds the README's, and
  joins a note's two paragraphs into one on the site's card.
- Version 1.0.0 (Android `versionCode` 308).
- **The release's own test run set up as CI's** (`.github/workflows/release.yml`). It had no
  poppler and no Mandarin DAC Bridge, which `test/dac-bridge.test.js` plays an album through on CI
  (since v0.9.0, after the last release), so v1.0.0's first release run failed its tests. It now
  installs and builds both as `ci.yml` does. Shown here: with `CI=1` and no bridge the test fails
  as the release did; with the bridge built by `.github/dac-bridge.sh` it passes.
- **The APK reaches main through a pull request** (`.github/workflows/android.yml`). main takes
  changes only through a pull request (the "Protect main and migration" ruleset, since v0.8.44),
  so the workflow's push of `dist/mandarin-android.apk` and `dist/latest.json` was refused, and
  the app wasn't published. It now pushes them to `publish-apk/<version>` and opens and merges a
  pull request into main (no approval is required). That needs Settings → Actions → General →
  "Allow GitHub Actions to create and approve pull requests".

## v0.9.7
**The Android app's file is named Mandarin-Android-0.9.7.apk, and test builds don't wait for a
Mac** (`v0.9.7-apk-name`).

- The versioned APK the build makes, on the test-android pre-release and as the build's artifact,
  is `Mandarin-Android-<version>.apk` (`…-shared-key.apk` when signed with the committed key), in
  place of `musicd-server-android-<version>.apk`. The fixed names the links use stay:
  `mandarin-android-test.apk` (test-android) and `dist/mandarin-android.apk` (main), and the app's
  update check (`dist/latest.json`) is unchanged.
- **The Mac's tests are off the test builds' path** (a trial). GitHub has few Mac runners, and a
  test build waited up to an hour for one, twice: before its merge into migration and again before
  its image. They now run on main, on a pull request into main (before anything reaches a
  release), weekly and by hand ("Run workflow" on any branch); everywhere else the Mac jobs are
  skipped, and a skipped job holds up neither a merge nor the image. CI also runs once per commit
  instead of twice (a pull request shows its branch's run), but for a pull request into main.
- **The Library's filter covers Focus and Sort** (phones and tablets): opened, its field goes over
  them where they float, in ‹'s line; they no longer drop back into a row of their own under it,
  pushing the albums down. On a tablet they sit at the bar's own edge (its 22px), so the field
  covers them whole.
- `test/renderer-playback.test.js` holds the renderer on its first track before reading its queue:
  the fixture's tracks are three seconds long, and on a busy machine the track ran out and the next
  began first (the queue read 2 tracks, not 3). Shown with a 3.5 s pause put in: it failed every
  time before, and passes now.

## v0.9.6
**The touch layout** (`v0.9.6-touch-layout`): on a phone or a tablet, either way round. A desktop
(a mouse) is as it was.

- **A row along the foot of the screen:** Menu on the left, then Home, Library, and Search on the
  right. Home and Library light up on their own screens; a second tap goes back to the top. From an
  album's page, Home or Library closes it first. The row shows on every screen but Now playing.
- **The mini player sits above the row.** Everything that kept room for it (the page's foot, the
  volume sheet, an album's page) keeps room for both.
- **Home has no top bar:** the date and the greeting are at the top of the screen. The menu and the
  glass moved to the row; other screens keep their top bar (Back, Filter, Select, Shuffle).
- **The grid screens** (Library, Random albums, a genre, Listen later, Playlists, Smart Picks, a
  label, an artist) have no top bar's strip: the albums scroll up to the screen's edge, and the
  bar's buttons float where they were (‹ on the left; Shuffle, a label's logo on the right). The
  screen's title is the page's heading, at the top of the grid.
- **The Library:** Focus and Sort move up into ‹'s line, on the right, and say just "Focus" and
  "Sort ⌄" (the order chosen is in the sheet Sort opens); its glass gives way to
  Search in the row, which opens the Library's filter ("starts with") as the glass did, with the
  strip back under the field while it is open. **The Labels list** likewise: #–Z alone on the
  right in ‹'s line, and Search finds a label.
- **Search** opens the top bar again with the field across the whole screen, and the page moves
  down under it, so no result is behind it. While a field has the keyboard up, the keyboard goes
  over the row and the mini player (in the Android app, whose page shrinks above the keyboard,
  they step aside).
- **Offline** is a small sign between Home and Library; a tap says what the matter is, as before.
  **The library scan's progress** is a thin brass line along the top edge of the screen.
- `public/touchnav.js` works the page's own controls (the menu, Home, the Library wall, the search),
  so each does what it did; the app bundles it for offline. `test/touch-nav.test.js` holds the
  layout at phone and tablet sizes, both ways round, and a desktop's. The Offline, Settings and UI
  Settings tests check the phone's and tablet's places for what moved (the Offline sign in the row;
  the top bar's disc measured on ‹; the Library's Focus and Sort in ‹'s line, no glass), and still
  the desktop's.

## v0.9.5
**The Android app installed over itself plays what it was playing** (`v0.9.5-rc1-phone-queue-after-reinstall`).

- After the app was installed over itself, it showed an album from earlier in the day, and played
  it with only that album queued. The app's player starts empty and asks the server for the list it
  had; the server handed back its own queue, the last album played through the server, even when the
  phone had since played a list of its own (a download, the phone's own music).
- Now the server hands back the list the phone last played, at the same track and place, paused.
  A list of its own comes back when the server knows every track in it (a download), and nothing
  comes back when it doesn't (the phone's own music), never the older album. The server keeps the
  same list across its own restart.
- The app tells the server the track ids of downloaded tracks it plays, so a downloaded album comes
  back. `test/phone-resume.test.js` holds all three cases.
- An album opened just after the page loaded could be put back to "Loading…" and drawn again: the
  page, as it started, reopened the album left open before a reload, which by then was the one
  just opened. It now does so only when no album has been opened yet. `test/play-next.test.js`,
  which failed on this about one run in seven (and on `migration` at v0.9.4), passes every time.

## v0.9.4
**The audit's documentation** (`old/audit-b4-main.md` module 5). Nothing changes in use.

- **Every route listed** (D2, `docs/specs/api.md`): 202 routes, each with its method, address, who
  may ask (open, signed in, a signed address, the server's own key) and the file that answers it.
  `tools/api-map.js` writes it from the C# sources, and `npm run gates` fails while it is out of
  date. `test/api-map.test.js` holds every GET it lists to a route the server answers.
- **Comments say what the server does now** (D1). Some 70 still described a Node server standing
  behind this one (work "handed over", a Node server "told" of changes, covers "left to" it); each
  now says what happens. The Node server's own behaviour, where it is kept byte for byte, is in the
  past tense. `server/README.md` says how to read one of its files as it last was.
- **The page's empty catch blocks each say why they do nothing** (D4): storage being optional, an
  abort already settled, an app older than the page. The page scripts now carry no lint
  suppressions, so a new empty one fails the lint. `public/app.js` stays at 19,582 lines.

## v0.9.3
**The audit's performance** (`old/audit-b4-main.md` module 4). The same answers, made
less often.

- **The library's lists are kept once made** (P1, `LibraryRoutes.Kept.cs`):
  - which lists: the wall and its facets, the Shelf, the artists and an artist's albums, genres
    and decades, hearts and Listen later;
  - each was made, written out and hashed for its ETag every time it was asked for, even when the
    page's copy was current; the Shelf is every album in the library, each time it opens;
  - now each is kept for the copy of the library it was made from and the hearts it shows, and
    sent as kept (a 304 while the page's copy is current), marked `X-Mandarin-Kept`;
  - a scan, an edit or a heart makes it afresh, and while the library is being built every list
    is made as before.
- **The Android app's page and stylesheet are kept once made** (P2, `Pages.Kept.cs`), while the
  files they come from are as they were; an update's new files are made once.
- `test/library-kept.test.js` (new).

## v0.9.2
**The audit's code quality** (`old/audit-b4-main.md` module 1). Nearly nothing changes in
use: the server reads and answers requests one way everywhere, and its code is split, renamed
and checked by its build.

- **One way in and one way out for every route** (Q1, `Http.cs`). Each route file ported from
  the Node server had its own JSON body reader (four) and JSON writer (eight), and they had
  drifted. Now:
  - a body is turned down alike wherever it is sent: not JSON, or not an object or an array, a
    400 "Bad JSON"; a charset that isn't a UTF one a 415; past 2 MB a 413. Before, sign-in's and
    playback's routes took a bare string as `{}` and read any charset as UTF-8;
  - every JSON answer carries its weak ETag, is "not modified" for a copy still current and has
    no body for a HEAD. Before, sign-in's, playback's, a download's and the not-found answers had
    no tag;
  - the two sign-in GET routes and `/server-info` answer a HEAD, as Express's `app.get` did.
- **Names from the Node era** (Q7): `Front` is `Server`, `Scan/NodeFs.cs` is `Scan/PosixFs.cs`.
- **The build checks the analyzer rules the code now keeps** (Q3, Q5, Q6, S7;
  `server/Mandarin.Server/.editorconfig`). Breaking any of them fails the build:
  - dead code: unused `using`s (50 removed), private members, parameters;
  - a number parsed or written without a culture (18 fixed, the Sonos metadata's included);
  - an ignored result, a bare `Exception`, a compare by lower-casing (each fixed);
  - SHA-1 and MD5 outside `Fingerprint.cs`, which says what each of the nine uses is for (ETags,
    cover fingerprints, cache names, Qobuz's request signature) and why none protects anything.
- **The three largest server files split along their seams** (Q2): `LibraryRoutes.cs`,
  `Identify/Identifier.cs` and `Admin/Backup.cs`, each now a few files under 400 lines.
- `test/http-body.test.js` (new) sends each refused body to every kind of reader and checks each
  writer's answer.

## v0.9.1
**The audit's tests** (`old/audit-b4-main.md` module 2), the first of the audit's stages
to take a version of its own: one patch version a stage from here (the owner's choice). Nothing
changes in use; the tests reach what they didn't, and wait for what they read.

- The routes no test called, now tested: identification's accept and reject
  (`test/identify-verdicts.test.js`), several albums at once, tracks played before put next or
  at the end, the shortcut's Random Album, the outputs a Sonos room hasn't and the playlist
  routes gone since v0.6 (`test/play-routes.test.js`), Tailscale's sign-out, the update's status.
- A test waits for the state it reads, not a fixed time; a sleep stays only where a test proves
  something doesn't happen in a window, and says so.
- `test/helpers.js`: `until`, a signed-in `/api` client and a server started on the fixture
  library, shared from now on.
- The two tests that asserted one thing on Linux and another on a Mac are a test each.

## v0.9.0
**No Node.js.** Stage 7 part 6 of the move to C# (`old/csharp-migration.md`): the Node
server's code leaves the repository and Node.js the image. Mandarin's server is one program
(`server/`, C#), as it has been behind the scenes since v0.8.50; this release takes away what
stood behind it. Everything the page, the apps and the speakers see is as in v0.8.50.

- **The image** (`Dockerfile`): Debian with ffmpeg, poppler, the Tailscale engine, the audio
  engine, the server and the page (`public/`) — no Node.js, no `node_modules`, no npm stage.
  CI's image check now also fails if Node.js is in it.
- **The repository**: `index.js`, `launcher.js`, `reset-password.js` and `lib/` deleted.
  `package.json` keeps the tests' packages only, as development dependencies (`better-sqlite3`,
  `fast-xml-parser`, `music-metadata`, and `sharp` for `tools/icons`); the tests stay JavaScript
  (`node:test`) and run against the program. `server/build.sh` and `engine/build.sh` read the
  version without Node.
- **The server's paths for a Node server behind it, gone**: starting and waiting for one,
  passing requests on to it (the reverse proxy and its package with it), the version match, the
  work handed over and claimed back, the library's state asked of it, its words to and from
  this server (`/internal/library`, `/internal/cpu/*`, `/internal/tags`,
  `/internal/transcode/prefetch`, `/internal/tailscale`, `/internal/services/played`,
  `/internal/jobs/import`, `/internal/devices/changed`, `/internal/playback/*`), and the
  updater's launcher path and npm run. The server always runs as it ran alone in v0.8.50; the
  `/internal/` addresses the tests use (a scan ended, the taste work, the prune, the services'
  watch, a change made by hand, the hub's revision, MusicBrainz's one timer) stay.
  `mandarin-server config` no longer carries the hand-over's `via_launcher`, `cpu_dsp` and
  `scan_program`.
- **The tests**: the parity suites lose their recording halves (`RECORD_<SUITE>=1`, which asked
  `lib/` live) and are held to what they kept in `test/golden/` alone; `test/golden.js` only
  reads. The last tests that asked `lib/` (the engine, sound devices, identification, label
  logos, Last.fm, loudness, the MusicBrainz pack, the radio's memory, Shelf, similar artists,
  streams, Tailscale) ask the program (`mandarin-server score`, new answers) or the server
  running. The in-app update's end-to-end test (`test/update.test.js`: the page's one Update for
  the server and the Android app, the library and an edit kept across the restart) runs on the
  C# server, which builds its next version to update to (or takes `MANDARIN_SERVER_BIN_NEXT`).
  `test/setup.js`'s Node block (`MANDARIN_FRONT`) is gone, and CI with it.
- **Found and fixed on the way**: Last.fm's similar artists failed on a list of one (its answer
  isn't an array then), and its quarter-second spacing between calls could fall short on a busy
  machine (it is measured on a monotonic clock now). The engine's seek test was tightened after a
  deliberate break slipped past it.
- **Forgot the password?** `docker exec musicd-server /app/server/bin/mandarin-server
  reset-password` (the sign-in page, Settings → Account, the Android app and the site say so).
- **The Mac installer** (`tools/mac/install.sh`) installs ffmpeg and poppler only, and starts the
  server alone; run on a Mac installed before v0.9.0, it brings the files up to date and puts the
  server in Node's place. `tools/tag-report.js` and `tools/tag-from-folders.js` run from a
  checkout now (the image has no Node.js).
- **Docs**: the README and the GitHub Pages site (v0.9.0 on top, the Mac's install by hand, the
  password reset, how it works, development), `server/README.md` (how it runs, alone), the spec.
- **What the server used to hand to the Node server, answered here** (stage 7 part 7): with
  nothing behind it, such a request fell through to "No such endpoint". The album editor's cover
  from an address follows redirects here (https to http too, as fetch did; twenty at most), reads
  an address as a browser does (a space in it), and refuses a picture ffmpeg can't read (422,
  "Couldn't read that image") or one past 64 MB (502, too large). A JSON body sent without a
  length is read to the 2 MB limit (413 past it). A route that fails says why (500 and the error,
  as the Node server's routes did: a stream, a download, a library write with the database held,
  a service's Clean up, status or settings); a cover that can't be drawn is absent (404), as
  before. A merged label let go by a key of any shape: "Not a merged label". Tested in
  `test/nothing-behind.test.js`.
- **A USB DAC on a Mac** plays through [Mandarin DAC Bridge](https://github.com/meltface-80/Mandarin-DAC-Bridge)
  (stage 7 part 7): the Mac's install line offers to add it (`MANDARIN_DAC_BRIDGE=yes` or `no`
  answers without asking; installed already, it is left as it is), and each DAC is a renderer,
  "<DAC> (Bridge)", which the bridge holds, switches to each track's rate and plays bit-perfect,
  sharing it with Audirvana. Mandarin's audio engine plays through ALSA, so a Mac's own sound
  devices, listed but not played since v0.8.49, are no longer offered; Audio Devices points to
  the bridge instead. CI plays a queue through the bridge's fake DAC, end to end
  (`test/dac-bridge.test.js`).
- **The loudness order test** read the order files were measured in from the order their ffmpeg
  stand-ins wrote a line, so files started together could be noted out of order on a busy
  machine; it reads the processes' order now.
- **Security, before main** (the audit, `old/audit-b4-main.md` module 3; tested in
  `test/security.test.js`, `test/backup-sealed.test.js` and `test/backup-page.test.js`):
  - **A backup sealed with a passphrase** (Settings → Backup & restore, 8 characters or more).
    The API keys, the Qobuz and Tidal sign-ins and the server's Tailscale identity go into one
    sealed part (AES-256-GCM, its key from the passphrase by PBKDF2-SHA256, 600 000 rounds). A
    whole database's copy leaves them out too, with what a restore never takes from it (the
    account, the signed-in devices, the signing secret), deleted so they leave no trace in the
    file. Restoring the keys or the whole database asks for the passphrase: without it, or
    with another, nothing changes. Everything else in a sealed backup restores without it, and
    a backup without a passphrase is as before. The list marks a sealed backup; the app sends
    the passphrase with a file (`X-Mandarin-Passphrase`). The page says what a backup holds.
  - Every page that acts (the page, sign-in, Shelf) may be framed only by Mandarin itself
    (`frame-ancestors 'self'`, `X-Frame-Options`), so another site can't steer clicks on
    Settings or Restart. The wall display may still be framed. Every file is taken as the type
    it is named (`nosniff`), and no address is sent to another site (`Referrer-Policy`).
  - A cover from an address in the album editor is never fetched from the server itself or its
    link (loopback, link-local such as a cloud's `169.254.169.254`, `0.0.0.0`). Every redirect
    hop is checked, by the address's name and by what DNS answers for it, and again where the
    connection is made. Addresses on your network are fetched as before.
  - A WiiM's own (self-signed) certificate is taken from a private network's address only
    (RFC 1918, link-local, IPv6 unique local).
  - NuGet's vulnerability audit is on: a package with a known advisory fails the build.
  - The restore routes moved to `AdminRestoreRoutes.cs` (`AdminRoutes.cs` was at its length cap).
  - `sharp` (used by `tools/icons` only, not in the image) is 0.35.5, out of libvips' advisories.

## v0.8.50
Stage 7 of the move to C# (`old/csharp-migration.md`): **Node removed** — the C# server
stands on its own, the last routes move, the launcher and in-app updates are the C# server's, the
tests drive the binary over HTTP, and the image and the repository lose Node. The last v0.8.x; the
owner's merge to `main` is v0.9.0. The parts as they are built:

- **Plan**: the five parts in the spec, each committed on its own, in small steps; a sixth since
  part 5 (the image and the repository without Node, on a branch of its own).
- **The configuration from the environment** (part 1, step a): `Config.cs` reads what
  `index.js` read (`MUSIC_DIR`, `SERVER_IP`, `SONOS_HOSTS`, `UPNP_*`, `INCLUDE_ZONES`,
  `EXCLUDE_ZONES`, `SCAN_INTERVAL_HOURS`, `MUSICDNET_BIN`, the `*_URL` stand-ins, `IDENTIFY*`,
  `LOUDNESS_TICK_MS`, `LASTFM_*`, `LOCAL_AUDIO`, `UPDATE_*`…), with the same defaults, into the
  shape the hand-over carried, so everything the hand-over set up takes it unchanged once no Node
  server is there to hand it over. The tests' stand-ins, which `index.js` took as `createServer`'s
  overrides, come as `QOBUZ_URL`, `TIDAL_URL`, `TIDAL_AUTH_URL`, `TIDAL_IMAGES_URL` and
  `MANDARIN_CONFIG` (a JSON object laid over the whole). `mandarin-server config` prints it;
  `test/config-csharp.test.js` holds it to `index.js`'s names and defaults, name by name.
- **The C# server on its own** (part 1, step b): with `MANDARIN_NODE=0`, or no `index.js` in
  the app's folder, no Node server is started or waited for. Every job is this server's from
  the first request (`Jobs.StartAlone`: the hub, the scans, the services, the update, the
  processor split, set up from `Config.cs` as the hand-over set them up; the speakers found
  last time asked first, as `index.js` asked them), and the library's state is this server's
  own (`Library.State.cs`: the version and the marks moved where the Node server was told of a
  change, so the copy is read again on the next request; the scan's state, the label rules,
  the day and the week on this clock, the address). A database put back from a backup goes in
  at the start (`Admin/Restore.cs`, as `lib/backup.js` did), Restart and Shut down from
  Settings are the program's own, and a restore's restart starts the program again in its own
  process. What no route answers is 404, as Express said it. `test/server.js` (new) starts the
  program alone for a test, as the image will start it; `test/csharp-alone.test.js` (new) holds
  the account, the scan, the library, the pages, the rooms, a heart and `/api/health` to it with
  no Node server anywhere. Behind a Node server nothing changes.
- **The health check** (part 1, step c): on its own, `/api/health` has no `csharp` field (no
  version to match). `mandarin-server --health` asks `/api/health` on `PORT` once, prints the
  answer and leaves with 0 when it was 200, else 1; the image's `HEALTHCHECK` runs it in place
  of `node -e`, and the image's smoke test runs it both ways. `test/csharp-alone.test.js` holds
  both.
- **Playback alone** (part 1, step d): `test/csharp-alone.test.js` now also starts the program
  with a fake Sonos household at `SONOS_HOSTS` and a fake renderer at `UPNP_HOSTS`, and holds the
  rooms (in `/api/zones`, `/api/status` and `/api/health`), the phone's hello, the renderer in the
  device list and as a zone once switched on, and a play on a room: the speaker fetches the track
  from this server's own address. That last found a gap: the install's secret (the `authSecret`
  setting, under which the addresses handed to speakers are signed and checked) was the Node
  server's to make as it started, so alone nothing it signed was vouched for. `Auth.Secret.cs`
  makes it at the start when none is there, as `lib/server/auth.js` did. Part 1 is complete.
- **The last routes** (part 2). On its own, what no route answers is not there as Express said it:
  an `/api/` address as JSON (`{ error: "No such endpoint: GET /x" }`), anything else
  finalhandler's page. The tag readers' check (`/api/tagcheck`, `/api/tagcheck/report`, v0.8.13)
  goes with the Node reader: the C# reader is the reader, so the Library Scanner page's "New tag
  reader check" panel and its Copy report button are gone (the Node side stays until part 5).
  `mandarin-server reset-password` does what `reset-password.js` did (the account removed, every
  device signed out, while the server runs; `docker exec musicd-server
  /app/server/bin/mandarin-server reset-password`); the Node script and the hint on the sign-in
  page stay until part 5. Settings → Updates' `mac_node_only` is gone (never true with the C#
  server in front). Alone, `POST /internal/library/changed` from this machine with the front key
  makes the server read its copy again, for a test that changed the database by hand (part 4), and
  the tests' `/internal/playback/revision` holds. A renderer's event (`NOTIFY /upnp/event/…`)
  says it was answered by the C# server, as it has been since v0.8.49. Covers in CMYK or with a
  profile of their own, and placeholders where ffmpeg can't draw text (a static ffmpeg, some
  Homebrew builds), were the Node server's to draw: alone they are drawn as ffmpeg reads them,
  without the profile, and the placeholder without its words, until the owner decides (the spec's
  section 6). `test/csharp-alone.test.js` holds each.
- **The update, with no launcher** (part 3). On its own, an update from Settings is the C#
  server's whole: GitHub asked, the release's bundle downloaded and checked (its `package.json`
  names it; no `index.js` is looked for), its own program of the new version fetched, checked and
  put in place of the file it runs from, the bundle's files laid over the install (never the
  data; no `npm install`), and the server started again from the new file in its own process, as
  Restart from Settings starts it — no `launcher.js`, no `.update/READY`, no code 75. Behind a
  Node server the launcher's way stays until part 5. The image's `CMD` already runs the server
  under tini and the Mac's launchd item already runs the binary; both lose their Node pieces in
  part 5. `test/update-alone.test.js` (new) runs it for real from a copy of the program in an
  install of its own, the new program a stand-in that writes down how it was started.
- **The tests drive the binary** (part 4). The tests that started the Node server
  start the program alone through `test/server.js` (its `createServer` takes `index.js`'s options
  as the environment; what a test reached into the Node server for, it has from the database file
  or over HTTP; the program's log is kept for a test that reads it). Moving them found three things
  the program alone answered differently: a deep link (`/library`, an album's address, a folder's
  redirect) was the not-found page, because the not-found route claimed every address without a
  file extension before the page could (it stands where the Node server's catch-all stood now);
  a stream with a rate, depth or gain the server won't make, or of a track or file that isn't
  there, fell through to the not-found page where the Node server said 400 or 404 (`Streams.cs`
  says them alone, and reads a gain written as a list of one, `?g[]=-3`, as that gain, as
  Express read it); and a cover that can't be had was the same, where the Node server answered an
  empty 404 (`Images.cs`). `test/pages-csharp.test.js`, `test/loudness.test.js` and
  `test/covers-csharp.test.js` hold each, on the program alone. And Rescan library answered
  with no services after it, where the Node server named the ones signed in with their import on
  (Qobuz, Tidal) as it set them going; it names them now (`test/qobuz.test.js`).
  The suites that compared the two servers side by side hold the C# server to a recording of the
  Node server's answers (`test/golden/`, made again with `RECORD_…=1` while `index.js` is still
  here). That found one more, from stage 6: a renderer or sound device hidden, or switched off,
  while it played was let go but never sent Stop — the route writes the switch first, and the
  hub's player refuses one switched off, so the Stop never went; the Node server stopped it before
  writing. It is stopped now, as there (`Renderers/Players.cs` `LetGo`,
  `test/devices-csharp.test.js`). And a JSON body that can't be read, sent where no route takes
  it, is refused as Node's `express.json()` refused it ahead of every route (400 `Bad JSON`; 415
  for a charset it can't read; 413 past 2 MB sent in chunks), not "No such endpoint"
  (`Pages.NotThere.cs`, `test/csharp-alone.test.js`).
  The recordings (`test/golden.js`): the library's screens, files, covers, conversions and
  downloads; Audio Devices' writes; playback; the services' rows, import, sign-in and streams. What
  follows from the machine is kept by rule rather than as it was recorded — a file's length (another
  ffmpeg makes the fixtures a few bytes apart), ETag and Last-Modified from the file, the Node
  server's ffmpeg arguments run again here with or without soxr, a cover's hash from its address,
  SQLite's ids as keys, times as days from now — so each holds on Linux, a Mac and CI's static
  ffmpeg alike. The processor split (`test/cpu-alone.test.js`, new), Restart and Shut down
  (`test/power-csharp.test.js`), the update's refusals (`test/update-alone.test.js`) and which
  server answers what (`test/front.test.js`) are held on the program alone; what only the Node
  server did (its hand-over, its launcher) is run while it is there and goes with it. Two test
  helpers were made sturdier on the way: a restart waits for the program's first scan
  (`test/server.js`), a test that times out leaves no server holding its port, and a browser call
  that is never answered fails by its name. CI's Node-alone job is gone.
- **The tests on the program alone, and what they found** (part 5). The suites that still asked
  `lib/`'s modules no longer need them: the parity suites (Sonos, renderers, extras, identify,
  share, backup, write-ups, art search, streams, scan, database, conversions, AutoEQ) hold the C#
  program to a recording of the Node server's answers (`test/golden.js` `answers()`: in full where
  small, a short sum of each 32 cases otherwise), the tag reader to `music-metadata` itself
  (`test/tag-oracle.js`), and the waveform to the Node server's rule kept in the tests
  (`test/waveform-rule.js`); some forty unit tests ask the C# server's own rules through
  `mandarin-server score` (new answers in `RulesCommand.cs`: mounts, versions, a SOAP call sent,
  label names, what a phone plays, the processor split and where each kind of process starts, home
  and away addresses, what an install can do, a device register script, the SSDP Sonos check, a
  backup's server part with a phone's id remapped) or through the server running (the library's
  safety, its folders, dates and names, the watch, the household read past a player that hangs, a
  renderer seen lately; Shut down on a Mac with a stand-in `launchctl`; Restart and Shut down
  refused over Tailscale). Tests of what only the Node server did go with it (its hand-over and
  updater, the tag check, its own processes). Found on the way and fixed:
  - the library's one-time upgrades (album keys with their folder, names from folders for untagged
    tracks, disc folders' numbers) were made by the Node scanner each time it started, and never by
    the C# program alone; `Scan/Scanner.Migrate.cs` makes them before a scan, marked done as before;
  - an album edit made or dropped rewrote `album-edits.json` only through the Node server, so
    without it a database that had to start over lost the edits made since; the C# server writes it;
  - a scan read as ended on `/api/status` before the library had been read again after it, so a page
    polling Rescan could fetch the albums from before; a scan is under way until that read is done;
  - `/api/cpu` said DSP was no longer in use while its split was still in place (from the hold's
    end until its timer re-decided, longer on a busy machine); it reports the DSP the split was
    decided with (`Cpu.cs`; the placement rule moved to `Cpu.Place.cs`).
  The Node server's scanner as a fallback (`Scans.cs`) goes, and `tools/identify-report.js`,
  `identify-probe.js` and `artist-report.js`, which ran `lib/` with the image's Node.

## v0.8.49
Stage 6 of the move to C# (`old/csharp-migration.md`): **playback moves to the C# server,
whole** — the rooms, the queue, grouping, the radio, the phone as a zone, Sonos, UPnP renderers
and sound devices on this computer — each part held to the Node server's own answers and command
order. After it the Node server does nothing (stage 7 removes it). The parts as they are built:

**Fixed after the merge (#209): no sound anywhere without `SERVER_IP`.** With no `SERVER_IP`
set, as in the Docker install, the C# hub handed every speaker and phone `http://127.0.0.1:3500/…`
for the music: Sonos rooms took the queue and played nothing, and the phone showed the album with no
sound. The Node server's `lanAddresses()` reads this machine's network interfaces when it is given
none (`os.networkInterfaces()`, its default); the C# copy read none, so its answer was always
loopback. It reads them now (`Playback/Topology.cs`), which also brings back the search for speakers
from every LAN interface, a renderer's event address and the phone's away-from-home address over
Tailscale. Every test pinned `SERVER_IP` to 127.0.0.1, so none saw it; `test/stream-address.test.js`
holds both servers to the rule with none set (the queue and the phone's track on this machine's LAN
address, and the audio fetched from there), and `test/sonos-csharp.test.js` compares the two
readings of this machine's own interfaces.

- **The hub, the queue store, the phone as a zone, history, the radio and the play routes**
  (part 1): the zone hub (`lib/sonos/zones.js`: one state per zone, the revision the long polls
  wait on, the three hooks — a track started, one played long enough to count, the queue near its
  end — the kept queues put back after a restart), the phone (`phones.js`: hello, the commands long
  poll, the report with the phone's own list, its USB DAC and its volume steps, every command), the
  queue store (`queue-store.js`: the same `queue:<id>` rows, the same debounce and position writes,
  so a queue one server kept is put back by the other across an update), the items (`playback.js`:
  signed addresses, DIDL, each track's gain, the prefetch), history and the radio (`features.js`'s
  playback half: a play into `plays` with its album's id, Listen later's album coming off the
  list, Random Album Radio with its six-month memory and 60-day preference), and every playback
  and phone route (`api-playback.js`, `api-phone.js`: the gate, the name overlay, now playing and
  its badge, Random Album, the history-to-queue routes, `/api/radio`) — in C#, answered from this
  server's first request wherever it holds the new job `playback`. Playing a Qobuz or Tidal album
  from its browser plays through the hub here too, the Node server no longer asked
  (`/internal/playback/play` stays for an older C# server). `server/Mandarin.Server/Playback/`
  (`Hub.cs`, `Hub.Commands.cs`, `Phones.cs`, `Phones.Report.cs`, `Phones.Commands.cs`,
  `QueueStore.cs`, `Items.cs`, `Item.cs`, `Tracks.cs`, `History.cs`, `NowPlaying.cs`,
  `Register.cs`, `ZoneState.cs`), `PlaybackRoutes.cs`, `PlaybackRoutes.Commands.cs`,
  `PlaybackRoutes.Play.cs`, `PhoneRoutes.cs`, `ServiceRoutes.Play.cs`. The Node server's part is
  the hand-over only (`lib/server/playback-handover.js`, new): its hub never starts where the C#
  server names the job, and starts after all at a hand-over that leaves it out or when none comes;
  the hand-over's `config` carries what the hub was set up with (the Sonos hosts, the server's
  address, the include and exclude lists, the renderer hosts, multicast, the offline wait, local
  audio). Sonos rooms (part 2) and renderers (part 3) are stubbed meanwhile: a Sonos id is refused
  as an unavailable room. Tests: `test/playback-csharp.test.js` (new): the same requests to this
  suite's server (behind C#) and to a Node server alone in a child process, for a phone zone, every
  answer and refusal compared as JSON — hello, the lists, playing and controlling, the report and
  now playing, the badge's every word, transport, queue and volume commands in order, the phone's
  volume steps, the radio switch and its memory, away from home, the phone's own list, the queue
  handed back with a hello and the kept row in the database, and the queue kept across a restart
  of the C# server. `test/radio-memory.test.js` and `test/queue-moves.test.js` pass through C#;
  the suites that drive the fake household (`test/phone.test.js` among them) wait for part 2.
  Split for the length gate: `Jobs.Internal.cs` (the internal routes) out of `Jobs.cs`,
  `ServiceRoutes.Play.cs` out of `ServiceRoutes.cs`.
- **Sonos** (part 2): the player (`lib/sonos/device.js` and the sending half of `soap.js`: a
  keep-alive pool of four, the SOAPACTION header, the ten-second timeout, one retry on a
  connection the player closed, every failure one UPnPError), discovery and the household
  (`topology.js`: M-SEARCH from every LAN address, the seeds and the players that answered last
  time asked first, the household from any one player — the first known alone, then the rest at
  once — the models fetched, the signature, `sonosKnownHosts` kept as the Node server kept it),
  and the Sonos half of the hub (`zones.js`: the three loops — discovery every minute, the
  household every thirty seconds, the poll every second with the watched, playing and
  every-fifth rule — the group read into the zone's state, the volumes, the queue read from the
  speaker and kept until its UpdateID moves, enqueue in the Node server's exact order, sixteen
  tracks a round trip and one at a time on older firmware, each command read back promptly,
  `playFromHere` read back before answering, every queue edit, the play modes, volume and mute,
  pause-all, grouping and ungrouping, moving music between any two kinds, a room's queue planned
  again for its levelling) — in C#. With them the rooms' part of `/api/status`, `/api/health`'s
  rooms and a speaker's own address for a cover (`Images.cs`) are the hub's, and Sonos rooms and
  phones go into the device register from the hub (`devices.js` `syncKnown`, every ten seconds
  and at a phone's hello), so a phone's page in Audio Devices is there; a device write's effects
  (a phone told its DSP or levelling, a room's queue planned again) are the hub's too
  (`DeviceRoutes.cs`). `Playback/SonosDevice.cs`, `SonosTopology.cs`, `Hub.Sonos.cs`,
  `Hub.SonosCommands.cs`, `Hub.Register.cs` (new); `POST /internal/playback/revision` for the
  tests (the hub's change counter set). Tests: `test/playback-csharp.test.js` extended — a fake
  household for each server, and after each scenario (played to, every transport command, the
  queue added to, moved, played from, cut and cleared, the play modes, volume and mute, a
  stopped room, pause-all, grouping and ungrouping, music moved from the phone to a room and back)
  the commands each speaker was sent compared action for action, as well as every answer;
  `test/e2e.test.js`, `test/queue-screen.test.js`, `test/play-next.test.js`,
  `test/sonos-restart.test.js`, `test/now-playing-restart.test.js` (its counter set through the
  internal route where C# holds playback), `test/phone.test.js` whole, `test/dsp.test.js`,
  `test/stream.test.js` and `test/playlists.test.js` pass through C#. The suites that bring a
  renderer (`queue-stopped`, `audio-devices`, `devices-csharp`, `renderers-csharp`,
  `local-output`) wait for parts 3 and 4.
- **The renderers** (part 3): the UPnP players (`lib/renderers/players.js`: the queue kept here,
  `jump`, the next track armed once its file is complete — the conversion's state, a prefetch
  when it has none — the device that ignores SetNextAVTransportURI noticed and started by hand,
  three stops before a track ever plays reported rather than looped, shuffle's played set and
  loop, the poll with the track found by its URI, the LinkPlay check of what a WiiM is really
  playing, GENA subscriptions renewed in time and `NOTIFY /upnp/event/:id` answered before the
  gate, the target a stream is planned to — the profile's effective chips, ffmpeg's 32-bit, the
  DSD mimes, the zone's DSP — `replan`, `restore`, `drop`, every command and the fixed-volume
  rule), discovery (`discovery.js`, `ssdp.js`, `linkplay.js`: M-SEARCH for MediaRenderer from
  every LAN address, Sonos answers left aside, the location cache and its ten-minute re-check,
  a known renderer that missed a round checked directly, the Sink read, LinkPlay's probe —
  https then http, the certificate unverified — and the seeds), the device list's model
  (`devices.js`: the scan every minute, `json`, `list`, `get`, `online`, `enabled`, `forget`) and
  with it `GET /api/audio-devices`, a device's page, Look again and Forget, the switch
  (`enabled`) and the radio on a PATCH, and the away-from-home rule — in C#, the hub's. A device
  write's every effect is the hub's now (a renderer switched off or hidden while playing stopped
  and let go, its queue planned again for its DSP or levelling), so the Node server is no longer
  told of one. `Renderers/Players.cs`, `Players.Poll.cs`, `Players.Commands.cs`, `Renderer.cs`,
  `Discovery.cs`, `Ssdp.cs`, `GenaClient.cs`, `LinkPlay.cs`, `Devices.cs`, `Playback/SoapHttp.cs`
  (the sending half of `soap.js`, shared with Sonos), `Playback/Hub.Upnp.cs`,
  `UpnpEventRoutes.cs`, `DeviceRoutes.Read.cs` (new). Tests: `test/renderer-playback.test.js`
  (bit-perfect and gapless, SetNext ignored, the next file waited for, transport, the queue,
  volume, shuffle and loop, upsampling, DSP, events, fixed volume, DSD, a restart) and
  `test/audio-devices.test.js`'s renderer half pass through C#, with `test/devices-hide.test.js`,
  `test/queue-stopped.test.js` and `test/renderers-csharp.test.js`; `test/devices-csharp.test.js`
  holds the switch and the radio to the Node server's own answers and rows too, and a renderer
  hidden while playing to a Stop on the fake device. `test/local-output.test.js`'s end-to-end
  half waits for part 4.
- **Sound devices on this computer** (part 4): the engine's driver (`lib/local/engine.js`:
  Mandarin's audio engine found in the same order — `AUDIO_ENGINE_BIN`, the image's, the one
  downloaded into the data folder, each asked for `protocol 1` — fetched once in the background
  where the image lacks it and that is allowed, checked against its SHA256SUMS, and driven over
  its stdin and stdout as before: the commands, the events — `pos`, `format`, `ended`, `xrun`,
  `error` — what it was given mapped back to the track the player knows, the gain on the audio
  taper, the engine on playback's own core at a raised priority where the system allows, `halt`),
  the device list (`lib/local/devices.js`: ALSA's cards from `/proc/asound` and `/dev/snd` with a
  USB DAC's own rates and depths, a Mac's outputs from `system_profiler`, the id from the name,
  `hw_params` for the verified tick) and the scan every half minute into the register
  (`devices.js` `scanLocal`, with the list's `local` counts) — in C#, the hub's. A sound device's
  volume is kept in the register (`local_volume`) and its queue put back after a restart, stopped,
  as before. `Local/AudioEngine.cs` (grown out of `HealthRoutes.cs`), `Local/EngineOutput.cs`,
  `Local/LocalDevices.cs`, `Cpu.Engine.cs` (new). Not ported, as planned: `lib/local/output.js`,
  the ffmpeg sink a device was played through before the engine — a Mac's sound devices are
  listed and not played from this server (the Node server plays them until stage 7 decides). The
  hand-over carries a test's own device list (`local_devices`), so `test/local-output.test.js`'s
  end-to-end half passes through C# with a `file:` device played by the engine; the Node-alone
  run is unchanged.
- **What was left, and the Node hub idle** (part 5): the wall display's content takes the zone's
  track from the hub here (`/api/display/content`; `POST /internal/playback/now` is no longer
  asked — it stays, with `/internal/devices/changed` and `/internal/playback/play`, for an older
  C# server). With it nothing of playback is the Node server's where this server holds the job:
  its hub never starts, its device scans never run, and it answers nothing a page or a speaker
  asks of playback. A speaker asking for a stream or a cover by its own address, unsigned (a
  queue made before an update), is vouched for by the hub here (`Streams.cs`, `Images.cs`): the
  Node server no longer knows the speakers and would turn it away. The hub never holds a thread
  waiting on the library's copy (now playing, a play recorded, a queue rebuilt for another player,
  the kept queues put back): each is asynchronous, so a busy machine with few cores can't be
  starved into a hang — CI's runners were. The device list and its routes came with part 3, the rooms' part of
  `/api/status` and `/api/health` with part 2. `test/housekeeping-csharp.test.js` holds
  `/api/status` to the Node server's own answer with the rooms' part set aside (the Node hub
  being idle, it counts none) and the display's content to the hub's track.
- **The suite, steady and quicker.** A phone's report that brings a USB DAC (or takes it away) is
  answered once its queue has been planned again, so the app's next poll has the new queue (the
  replanning had been left running after the answer, and a poll straight after found nothing).
  The parity test for the Sonos rooms compares a room's state until both hubs have read it, never
  once (each reads its room on a timer of its own), and reads the room paused before moving its
  music back to the phone (the fixture's tracks are three seconds long). A test's request to a
  server fails after a minute and a half naming its address (`test/setup.js`), so a server that
  never answers is a failure with a name rather than a file held to its five-minute timeout. CI
  deals the test files out to three Linux jobs and two Mac jobs (`npm run test:shard`, node's
  `--test-shard`) and keeps the .NET packages between runs: the whole run takes the time of a
  part. Two more races found by the first sharded run: the server takes its port with a few
  tries over five seconds (`lib/server/listen.js`, new) rather than failing on the moment the one
  before is still letting go of it (a restore's restart; the in-app update's restart has the same
  shape at home); and a scan made by the C# program is given once the program has gone, never
  while it still holds the database (a database replaced underneath it read "disk I/O error" on
  a Mac). And a test file that fails in CI is run once more on its own (`.github/retry-failed.sh`):
  a pass then is a warning on the run naming the file, a race on a busy runner to fix in its turn;
  a failure again is red. The re-run's first catch was no race: a page's `Last-Modified` from the
  C# server (`Pages.cs`, a backup's download too) is now the file's time rounded to the
  millisecond first, as Node's `fs.Stats` gives it and `sendFile` sends it, so a file written at
  .9995 s is the next second from either server.

## v0.8.48
Stage 5 of the move to C# (`old/csharp-migration.md`): **everything the Node server still did
but play moves to the C# server**, part by part, each held to the Node server's own answers and
writes. After it the Node server is playback and nothing else (stage 6 moves that; stage 7 removes
Node). The parts as they are built:

- **The database** (part 8): made and brought up to date by the C# server, as the Node server made
  it, statement for statement: its tables and indexes, the columns added since a table first
  shipped, a database made by something else moved aside (`musicd.old-<ms>.db`) and what is worth
  keeping carried over, the album edits read back from `album-edits.json` or written there, and
  Smart Picks' and the radio's tables. The C# server does it before it starts the Node server, and
  the Node server asks it again as it opens the database (`mandarin-server db`), so a backup put back
  is brought up to date by C# too. `server/Mandarin.Server/Schema.cs` (new), `Program.cs`, `Front.cs`.
  The Node server's part is the hand-over only: `lib/library/db.js` asks the program when the C#
  server that started it has it (`MANDARIN_SERVER_DB=1`), checks the tables have what it needs, and
  only then leaves out its own; `lib/server/features.js` makes none of its tables then; a Mac on
  Node alone, an older C# server or a program that fails, its own code as before. Tests:
  `test/db-csharp.test.js` (new): a new database, one from before the added columns, one made by
  something else, one from a newer version, and `album-edits.json` both ways, each made by the C#
  program and by `lib/library/db.js` from the same start and compared file for file; through the
  server, the Node server's database is the program's, and with a program that fails its own.
- **The pages** (part 7): the sign-in page (`/login`), the wall display's page (`/display`), and the
  page for any other address it opens (a deep link, the Android app's form of it too), sent by the C#
  server as the Node server sent them (the same file, tag and caching); a folder of the page's files
  asked for without its slash is sent there (301), as before. `/api/health` (Docker's health check)
  by the C# server too, field for field: the rooms found and how bringing the C# server to the Node
  server's version went, as the Node server says them with its state; the library's count, ffmpeg,
  the conversions under way and the audio engine there. `server/Mandarin.Server/HealthRoutes.cs`
  (new), `Pages.cs` (a page's tag now gives its time to the nearest millisecond, as Node's does:
  Shelf's page's tag changes once), `Program.cs`, `Library.cs`, `Transcoder.cs`. The Node server's
  part: two fields more in `/internal/library` (`rooms`, `csharp_update`). Tests:
  `test/pages-csharp.test.js` (new), each page, deep link, redirect and `/api/health` held to the
  Node server's own answer; `test/front.test.js`'s pins moved on to C#.
- **The phone's download lists, what was left** (part 3): a streamed album's download list (its
  tracks planned as FLAC, as before; the phone is then refused each one, as before), a track whose file
  is gone from the disk (404), and the phone's albums or offline plays sent as something that can't be
  read as a list (Express's own 500 page, as in the image), all answered by the C# server now. A
  download refused for a streamed track says "can't" with its apostrophe, as the Node server wrote it
  (`\u0027` before). `DownloadListRoutes.cs`, `Downloads.cs`. Tests: `test/library-front.test.js`'s
  download checks, each of these held to the Node server's own answer.
- **Last.fm, what was left** (part 6): its routes moved in v0.8.26 and its pictures in v0.8.34, but
  they waited for the Node server's hand-over, which brought Last.fm's address and the environment's
  key. The C# server now has both from its own environment (`LASTFM_URL`, `LASTFM_KEY`, the same
  container) from its start, the Node server's word taking over when it comes (the tests' stand-in),
  so a Node server starting again no longer takes Last.fm with it for a moment. `Jobs.cs`,
  `LastfmRoutes.cs`. Tests: `test/lastfm.test.js`, a C# server in front of a stand-in that hands
  nothing over, answering Last.fm from its own environment, the stand-in never asked.
- **The in-app update and the processor split** (part 4). Settings → Updates is the C# server's once
  the Node server hands it over (the job `update`): the status, Check now, Install and the check every
  twelve hours, as the Node server made them, with the same words for each refusal (GitHub turning the
  check down, no update, a download that fails, a bundle that isn't Mandarin's). An install fetches
  and checks the C# server of the new version first and stops with nothing changed if it can't be
  had, as before; then the bundle is staged for the launcher and the Node server asked to start again,
  on which the launcher lays the new files in and the new Node server asks this program to start again
  from its new file, as before. `server/Mandarin.Server/Admin/Updater.cs` (new, `lib/updater.js` and
  `csharp-update.js`'s `prepare` rule for rule), `UpdateRoutes.cs` (new), `Jobs.cs`. The processor
  split (which cores playback keeps, the rest for everything else; two for playback while DSP
  converts and ten minutes after) is decided by the C# server now (the job `cpu`), from the same rule
  as `lib/cpu.js` and counting both servers' DSP conversions, and sent to the Node server, which
  follows it for playback's own processes (the audio engine, its decoder) and tells the C# server of a
  DSP conversion it makes itself; `/api/cpu` (Settings → Library Scanner) answers from that decision.
  `Cpu.cs`, `PowerRoutes.cs`, `Transcoder.cs`. The Node server's part is the hand-over: `update` and
  `cpu` in `FRONT_JOBS`, its own update checks not started once handed over, where GitHub is asked
  and whether it runs under the launcher said in the hand-over's settings (`index.js`,
  `lib/server/api-playlists.js`), and `lib/cpu.js` following a split given to it (`follow`,
  `unfollow`, `tellDspTo`). Tests: `test/update-csharp.test.js` (new): a stand-in GitHub, the server
  through the C# server on a copy of the app and of the program, every refusal word for word, then an
  install staged under the launcher with the program of the new version in place first and the Node
  server asked to start again with 75; without a launcher, the files laid in. `test/cpu.test.js`: the
  C# server's decision held to `lib/cpu.js`'s for the same cores, followed by the Node server, both
  moving when DSP takes and gives back its second core.
- **Audio Devices, the writes** (part 1). What you change on a device's page in Settings → Audio
  Devices is written by the C# server now: its name, hidden, sharing (a phone's), output (mode, bits,
  volume), DSP, Volume Levelling and the rates, depths and DSD you tick, each checked and written as
  the Node server wrote it, in the same order and with the same words for a refusal (a write made
  before a refusal stays, as before). The Node server is then told, so what each write did there
  still happens (the name everywhere, a renderer's or sound device's queue planned again with its
  new DSP or levelling, a phone told its own, a Sonos room's queue planned again, a device hidden
  while on switched off and let go), and answers the device as its page shows it, which the C#
  server sends on. Switching a player on or off and the radio stay the Node server's until playback
  moves (stage 6), as do the list, a device's page, Look again and Forget. Away from home, only the
  phone the app is on, by the Node server as before. `server/Mandarin.Server/DeviceRoutes.cs` (new),
  `LibraryRoutes.cs`; the Node server's part is the hand-over (`lib/renderers/devices.js` `changed`,
  `registry.js` `refreshName`, `index.js` `/internal/devices/changed`). Tests:
  `test/devices-csharp.test.js` (new): every write and refusal made from the same row through the
  C# server and by the Node server itself, the rows and answers compared; the Node server's effects
  seen.
- **Library housekeeping** (part 2). The library scans are the C# server's to start whatever reads
  the tags: where it is trusted with them (the tag check passed, or `TAG_READER=csharp`) its own
  program scans, as since v0.8.34; where not (`TAG_READER=node`, or the check still to pass) each
  scan it starts (its timer, the music folders' watcher, Rescan, Reindex, a folder added) is made by
  the Node server's own scanner at its ask, which says how it is going line by line, as the program
  does. Before, the scans stayed with the Node server then, with Rescan, Reindex and the music
  folders' routes. `/api/status` (what the setup screen and the pages poll) is the C# server's: the
  library's part from it (the scan's state, the music folders, the count, whether the data folder is
  a Docker volume), the rooms' part as the Node server says it with its state. Clean up (Settings →
  Library Scanner): what could go counted by the C# server — the albums whose folder has gone from
  the disk, and each service's — and the music folders' kind made there (the albums removed with
  their edits, hearts and Listen later, the Node server's copy read again; a service's kind the C#
  server's since v0.8.44); each refusal in the same words. The wall display's content: the zone's
  track asked of the Node server, the artist's photos (MusicBrainz for the act, FanArt.tv for the
  pictures, kept a week), the album's write-up, the artists' stories and more by the artist from the
  C# server. `server/Mandarin.Server/HousekeepingRoutes.cs` (new), `Scans.cs`, `ScanRoutes.cs`,
  `LibraryChanges.cs`, `Services/Rows.cs`, `WriteUpRoutes.cs`, `Jobs.cs`. The Node server's part is
  the hand-over: the scans handed over whatever the tag reader, whether the program is trusted said
  with it, its scanner at the C# server's ask (`index.js` `/internal/scan`), a zone's track
  (`/internal/playback/now`), the rooms' part with its state, and Clean up's word
  (`lib/server/api-library.js`). Tests: `test/housekeeping-csharp.test.js` (new): `/api/status`, the
  counts, Clean up and the display's content held to the Node server's own answers; a folder gone
  from the disk counted and cleaned; with `TAG_READER=node`, the scans started by the C# server and
  made by the Node server's scanner, the library the same as its own scan makes; `test/front.test.js`
  and `test/scans-csharp.test.js` brought up to date.
- **A speaker's cover** (part 5, in part). A Sonos speaker fetches a cover by its own address, with
  no sign-in and no signature; the Node server's gate knows its speakers and lets them through. The
  C# server now does the same: the speakers' addresses come with the Node server's state, and a
  cover one asks for is sent by the C# server like any other. `server/Mandarin.Server/Images.cs`;
  `index.js` (`speakers` with the state). Tests: `test/covers-csharp.test.js`, a cover asked for
  from a speaker's address and from a stranger's, each answered as the Node server answers it. The
  pictures in another colour space than sRGB (CMYK, or carrying a profile of their own) still go to
  the Node server to draw, as before: drawing them the same needs the colour maths libvips does, and
  how to have that in the C# server is put to the owner (`old/csharp-migration.md`, part 5).
- The Android app for this version is 0.8.48 (version code 248). Nothing in it changed.

## v0.8.47
Stage 4.4 and 4.5 of the move to C# (`old/csharp-migration.md`): **Qobuz and Tidal are the
C# server's, whole**, handed over as the job "services". Signing in and out, Tidal's token, playing an
album from their browser and their streams join the catalogue, the rows and the import moved before.
With the C# server in front and the services handed over, the Node server doesn't ask Qobuz or Tidal
for anything, refresh a token or make a service's stream: for a service album it plays the library's
tracks, as for an album of your own. (Before the hand-over, in its first seconds, it makes them as it
always did, so nothing a speaker asks for meanwhile goes unanswered.) Each is held to the Node server's own answer, write and bytes.

- **Signing in** (Settings → Services): Qobuz with your username and password, asked of Qobuz once,
  the token kept and never the password; Tidal with a link and a code, Tidal asked every few seconds
  until you have signed in on tidal.com, the code expires or you let it go, then your account, name
  and subscription kept. Turned down in the services' own words, as before. Signed in with the
  import switched on, your favourites are brought in at once, by the C# server.
- **Signing out** and Disconnect: a Qobuz play under way reported over first, the account let go.
- **Settings → Services signed out** (`GET` and `POST /api/settings/<s>`), a Tidal sign-in under way
  among it.
- **Tidal's token** is refreshed by the C# server alone: when it is due within the minute, before the
  request; when Tidal turns it down, then the request asked once more; one refresh at a time, the
  others waiting for it; the refresh token kept when Tidal sends none. A refresh Tidal refuses is
  said as before. An import or a favourites' watch is now made whole by the C# server however the
  token stands (v0.8.45 left a step to the Node server for it).
- **Playing an album from the browser** (`POST /api/qobuz/play`, `/api/tidal/play`): its rows
  written by the C# server (asked of the service each time, as before), then its tracks played by the
  Node server's playback, the album or one track of it, now, next or at the end.
- **Their streams**: a Qobuz or Tidal track a speaker, a streamer or the phone fetches is fetched,
  copied or converted by the C# server, into the same transcode folder, under the same name, with the
  same ffmpeg arguments: as it comes where the service already sends what was planned (or less, for
  Sonos: never upsampled), converted like a file otherwise (with a ReplayGain, a zone's DSP, 32 bits
  where taken). Qobuz: one signed ask per track for the format the device takes and the account
  allows, and every play reported (Start as a device starts fetching, End when the next starts, it
  has played through, or you sign out). Tidal: its playbackinfo, CD from one address, hi-res from
  MPEG-DASH, its pieces fetched one after another and fed straight to ffmpeg (no address of the
  server's in between); an account Tidal answers a hi-res ask with CD for is asked for CD from then
  on, until a setting is written; and the rows corrected to what Tidal really streams. The next
  tracks made ready behind the one playing are made by the C# server too. Signed out, nothing of a
  service streams, made already or not.
- **The search from Home**: Qobuz's and Tidal's albums and artists beside the library's
  (`GET /api/search/external`), asked by the C# server.
- `server/Mandarin.Server/Services/Accounts.cs` and `ServiceStreams.cs` (new), `TidalApi.cs`,
  `QobuzApi.cs`, `Catalogue.cs`, `Import.cs`, `Rows.cs`, `ServiceHttp.cs`, `ServiceRoutes.cs`,
  `Streams.cs`, `Transcoder.cs`, `WriteUpRoutes.cs`, `LibraryRoutes.cs`, `LibraryChanges.cs`, `Jobs.cs`,
  `Auth.cs`. Gone: the hand-backs that existed only because the Node server owned Tidal's token
  (`ToNode`, `TidalApi.GoodFor`, `Import`'s step left to the Node server). The Node server's part is
  the hand-over only:
  - `index.js`: "services" added to the work it hands over; once it is, a service's track handed to
    the C# server to make like any conversion, a speaker fetching one from the Node server itself
    told to it (`/internal/services/played`) rather than reported to Qobuz, and Tidal's token refused
    a refresh there; at the hand-over a Tidal sign-in under way let go, a refresh under way finished
    first and a Qobuz play reported over; where Tidal's sign-in is asked handed over with the rest;
    `POST /internal/services/step` removed; and `POST /internal/playback/play`, a service album the
    C# server wrote played here, as `api-service.js`'s play does once the album is in the library.
  - `lib/server/api-service.js`: that part of its play route made one function (`play`), so both
    run the same lines.
- **Tests:** `test/services-signin-csharp.test.js` (new), through the C# server, each held to the
  Node server's own answer, write or file for the same request from the same start: Settings →
  Services signed out and its switches word for word; Qobuz's sign-in, refused (each way) and made
  (the answer, the account kept, never the password); Tidal's sign-in begun, asked again, approved
  (the account, its user and subscription), let go, and expired by the clock and by Tidal's word;
  signing out and Disconnect; Tidal's token due for a request, an import and a watch, three asking at
  once and one refresh, and one Tidal refuses (a request, a favourite, Update library now) in the
  same words; playing an album, a track of it now and at the end, and refused, with the same rows,
  the same answer and the same queue on a stand-in Sonos room; the streams, each file the very one
  the Node server makes and the answers' headers the same (Qobuz's CD as it comes, 24/96 to Sonos at
  24/48, to a streamer as it comes and promised 192 kHz, with a ReplayGain; Tidal's CD, its hi-res from
  DASH, the Node server's loopback address never asked; the CD an account without hi-res gets, the
  rows learnt the same); Qobuz's play reports, the same events; a speaker asking the Node server
  itself; and, through it all, the Node server asking Qobuz and Tidal for nothing and refreshing
  nothing. Adjusted, as this version changes what they pinned: the token cases in
  `test/services-csharp.test.js`, `test/services-rows-csharp.test.js` and
  `test/services-import-csharp.test.js` (refreshed by the C# server, the Node server never asked; its
  step's route gone; Settings → Services signed out and signing in now the C# server's), and
  `test/conversions-csharp.test.js` (a service's track handed over too). `test/fake-tidal.js` can
  make a sign-in's code short-lived and hold a refresh back. `test/front.test.js` pins which server
  answers what (its v0.8.47 test and header line; the v0.8.21, v0.8.39 and v0.8.45 tests moved on to
  C# where this version moved them; "services" in the v0.8.19 test's job list).
- Last.fm: the quarter of a second between two asks is counted from the answer, not the ask, so a
  first ask that opens its connection slowly can't reach Last.fm closer than that to the next (a test
  measuring it at Last.fm's end saw 235 ms on a busy machine).
- The Android app for this version is 0.8.47 (version code 247). Nothing in it changed.

## v0.8.46
**Now playing follows the room again after the server has started again.** Reported on the Android
app: left for another app, back, a track further down the queue played; it played, but Now playing
kept the track from before (paused, it paused), and only closing the app and opening it again put the
screen right.

- Why: every answer the page polls for carries the server's change counter, and the page drops one
  older than the last it painted (a slow one-off answer landing after a newer one). The counter starts
  again at 1 whenever the server does (an update, a restore, the C# server starting it again), so a
  page kept open across that took every answer after it for an old one. The screen stayed as it was,
  and the page asked about four times a second, the server answering at once each time.
- Now a counter below the one the page asked to wait on is taken for what it is: the server's counter
  now (or the app's own copy's, when it answered while the server couldn't be reached). The page shows
  the room as it is and goes back to waiting on it (`public/app.js`). Nothing on the server changed.
- **Tests:** `test/now-playing-restart.test.js`, in a browser with a stand-in Sonos room: Now playing
  shows track 1; the server's counter starts again; Play from here on track 3: Now playing shows it,
  and the page waits on the server again rather than asking over and over. Without the fix it stays on
  track 1.
- The Android app for this version is 0.8.46 (version code 246). Nothing in it changed.
- **The app for the migration branch** (CLAUDE.md section 4): each push to `migration` that changes
  the app or the page puts its APK on the rolling "test-android" pre-release, at one fixed address
  (`releases/download/test-android/mandarin-android-test.apk`), as test branches' apps already were.
  The file there is replaced; no tag or release is made, and the app's own update check still reads
  main's, so it's offered to nobody who didn't fetch it.

## v0.8.45
Stage 4.3 of the move to C# (`old/csharp-migration.md`): **Qobuz's and Tidal's import, the
favourites' watch and the service playlists are the C# server's**, handed over as the job "import".
Each writes what the Node server wrote, row for row and mark for mark, and answers in its words; the
Node server is told and reads its library again, as before.

- **The import**: your favourites (and on Qobuz your purchases) brought into the library, every
  album, only what is new or a week old asked of the service again; one no longer wanted let go, by
  the ids asked for then; then the playlists. Made 20 seconds after the C# server takes the work over
  (as the Node server made it after its start), every six hours, after a Rescan and after signing in
  with the import on (the Node server asks the C# server for these two), and by **Update library
  now** (`POST /api/settings/<s>/import`). What it made is kept as before (Settings → Services'
  "updated" line).
- **The favourites' watch**: every two minutes, and when the page comes back to Home or the Library
  wall (`POST /api/services/watch`, not more than once in 15 seconds), an album favourited in the
  service's own app is brought in and one taken away there let go.
- **The service playlists**: each Qobuz or Tidal playlist, and your favourite tracks, as a playlist
  here, the albums their tracks are from held; one gone from the service goes from here. Your own
  playlists, and the other service's, are kept as they were.
- **Settings → Services, signed in**: its state (`GET /api/settings/<s>`, an import running among
  it), the stream quality and the import's switch (`POST /api/settings/<s>`): switched on, the albums
  are back at once and the import starts; off, they are out at once. A setting written there tells
  the Node server, so an account Tidal gave CD for hi-res is asked for hi-res again, as before.
  Signed out, Settings → Services stays the Node server's (a Tidal sign-in under way is its), as do
  signing in and out (stage 4.4) and playing.
- **Tidal's token** is still refreshed by the Node server alone. An import or a watch is made by the
  C# server only with a token good for five more minutes; otherwise, or when Tidal refuses it
  partway, it is left to the Node server from there, which makes it with its own import or watch and
  refreshes the token (`POST /internal/services/step`). What was brought in before stays, each album
  written whole and kept once its rows are; the counts are then those of the Node server's run.
- **Where the two servers meet:**
  - a step left to the Node server that fails (Tidal refuses it a new token too): what the C# server
    brought in before is told to it all the same, so it is on the walls;
  - the imports on the timers (the first after the hand-over, then every six hours) are made one
    service after the other, not side by side, so a step left to the Node server never writes the
    playlists while the other service's import here writes them;
  - a backup put back stops an import or a watch under way at its next album (waited for up to 20
    seconds) before the Node server starts again, rather than writing on into the database put back.
- The C# server's copy of the library is now read again as soon as it tells the Node server of a
  service's change, as the Node server's own is, rather than at the next request: an import running
  meanwhile is never seen half made.
- `server/Mandarin.Server/Services/Import.cs` (new), `Rows.cs`, `Catalogue.cs`, `QobuzApi.cs`,
  `TidalApi.cs`, `ServiceRoutes.cs`, `LibraryRoutes.cs`, `LibraryChanges.cs`, `Library.cs`,
  `Jobs.cs`. The Node server's part is the hand-over only:
  - `index.js`: "import" added to the work it hands over; its import and watch timers left idle once
    it is (and the first import made after all if the C# server never takes the work over); an
    import or watch of its own running at the hand-over finished first; when the first import comes
    and how often the watch looks handed over with the rest; and `POST /internal/services/step`, a
    step the C# server leaves to it, made by the service's own import or watch.
  - `lib/server/api-service.js`: the import it would start after signing in asked of the C# server
    instead.
  - `lib/server/api-library.js`: the imports after a Rescan asked of the C# server instead (the
    answer still names them); and the C# server's word that a service's settings were written
    (`settings` in `libraryChanged`): Tidal's hi-res asked for again, as its own setSettings did.
- **Tests:** `test/services-import-csharp.test.js`, through the C# server, each held to the Node
  server's own import, watch and answer for the same request from the same start: Settings →
  Services' state word for word, the quality (and one not offered, refused in the same words) and the
  switch (on: importing, the import made; off: out of the library); Update library now from nothing,
  again with everything here (nothing fetched), with a favourite taken away on the service and with a
  playlist gone there (every column of every album and track and the type SQLite keeps it as, the
  kept marks with the service's own dates, Tidal's "+0000" among them, the held marks, the playlists
  as text, yours and the other service's kept as they were, what it made, the answer); the watch;
  the page's quick look and its 15 seconds; Tidal's token due (the import and the watch made once,
  by the Node server, which refreshed it), refused partway (the same library in the end) and
  refused with no new token to be had (what was brought in before on the walls); the
  import after a Rescan and after signing in made by the C# server; and its timers, the Node
  server's own idle. `test/qobuz.test.js` now caches Qobuz's listing with an import through the
  front door rather than inside the Node server. `test/fake-qobuz.js` can date a favourite and a
  purchase. `test/front.test.js` pins which server answers what (its v0.8.45 test and header line;
  "import" in the v0.8.19 test's job list).
- The Android app for this version is 0.8.45 (version code 245). Nothing in it changed.

## v0.8.44
Stage 4.2 of the move to C# (`old/csharp-migration.md`): **Qobuz's and Tidal's albums as
rows in the library are the C# server's**: opening one, adding it to your favourites and taking it
away, its page, Clean up and the month's prune. Each writes what the Node server wrote, column for
column, and answers in its words; the Node server is told and reads its library again, as before.

- **Opening an album** from a service's browser or search (`POST /api/qobuz/open`, `/api/tidal/open`):
  its rows written (the album, its tracks), its cover kept beside the database as before, and the
  album's page opens. One already in the library is answered as it is, the service not asked.
  An album Tidal's lists gave is again asked of Tidal for its tracks only (v0.8.39 had made that
  one ask slower).
- **Add to / Remove from favourites** (`/favorite`, `/unfavorite`): made on Qobuz or Tidal, the
  album kept in the library (its rows written or brought up to date) or let go, as before.
- **A streamed album's page** (`GET /api/album`): whether it is a favourite on the service, the
  library brought into line with that as the page opens (a favourite removed in the service's own
  app is let go, one added there kept, a purchase kept whatever), and why it is here (kept as a
  favourite or a purchase and since when, held by a playlist, last played, a release day still to
  come), in the same order of fields.
- **Clean up** of Qobuz's or Tidal's albums (Settings → Library Scanner), where the library scans are
  the C# server's: the albums no longer wanted go, with their edits, hearts and Listen later; signed
  out, every one, with the kept marks and the service's playlists. The counts, and the music folders'
  own Clean up, stay the Node server's.
- **The month's prune** of albums only ever played from the browser (unplayed a month, neither kept
  nor held): made by the C# server once a day, the first ten minutes after it takes the work over,
  handed over as the job "prune"; the Node server's own daily timer then does nothing.
- **Tidal's token** is still refreshed by the Node server alone: a request it would have to be
  refreshed for is passed to the Node server whole. A favourite is passed on unless the token is good
  for five more minutes, so a token is never found due after the favourite was made; one Tidal
  refuses changed nothing there, so the Node server's is the one made. Either way it is made once.
- Signing in, the settings, the import, the favourites' watch, the service playlists and playing stay
  the Node server's (stages 4.3, 4.4 and 6).
- `server/Mandarin.Server/Services/Rows.cs` (new), `Catalogue.cs`, `QobuzApi.cs`, `TidalApi.cs`,
  `ServiceHttp.cs`, `ServiceRoutes.cs`, `LibraryRoutes.cs`, `Jobs.cs`. The Node server's part is the
  hand-over only: "prune" added to the work it hands over and its timer left idle (`index.js`), and
  the C# server's word that the services' rows changed taken (`services` in
  `lib/server/api-library.js`): the library read again and the covers drawn ahead, as each service's
  own change did (an album opened: read again only, as opening did), and after a favourite the
  service's answers it kept forgotten, as its own favourite forgot them.
- **Tests:** `test/services-rows-csharp.test.js`, through the C# server, each held to the Node
  server's own write and answer for the same request: an album opened (every column of its album and
  tracks rows and the type SQLite keeps each as, its cover and the address beside it, the answer word
  for word), favourited and taken away (the rows, the kept mark, the favourite on the service, the
  Node server's own kept answer forgotten, an album opened before brought up to date), the page's
  service fields in order (kept, let go, kept as the page opens, a purchase, a row from before
  v0.7.3, a release still to come), Tidal's token about to expire or refused (answered by the Node
  server, the favourite made once), Clean up signed in and out, and the prune.
  `test/services-csharp.test.js` now opens and favourites on the Node server itself (its change seen
  at once). `test/qobuz.test.js` and `test/tidal.test.js` pass with C# answering. `test/front.test.js`
  pins which server answers what (its v0.8.44 test and header line; "prune" in the v0.8.19 test's job
  list).
- The Android app for this version is 0.8.44 (version code 244). Nothing in it changed.

## v0.8.43
Albums added to the library show up on their own, in the Android app and the browser alike: Home's
Library row and the Library wall take them as the scan finds them, with nothing tapped. Before, with
the Library sorted by Recently added, new albums stayed off the row until the sort was changed and
changed back.

- **Why they didn't:** Home's Library row was read once and then kept until the sort changed, and
  at each start it was painted from the copy kept last time and counted as read. Nothing told the
  page that a scan had added albums: the server never said, and the page never asked again.
- **The server says now** (the C# server): every answer to a signed-in device carries which albums
  the library holds (`X-Mandarin-Library`: their count and a mix of their ids, moved when one comes
  or goes, not when one is edited), and `GET /api/library/mark` answers it. Not to anyone who
  hasn't signed in.
- **The page listens:** when the mark moves, the Library row is read again on Home at once, and
  the Library wall is read again when it's at its top with no album open over it (further down,
  or under an album, it stays put until it's next opened). Nothing else is reshuffled. A page with nothing else asking (no room playing, say) asks
  for the mark itself every half-minute or so.
- **At each start** the Library row painted from last time is read again, not kept.
- **Tests:** `test/library-live.test.js`, in a browser through the C# server, with the Library
  sorted by Recently added: the mark on a signed-in device's answers only (on the Node server's,
  passed through, too) and moved by an album added; Home's row and the Library wall each taking a
  new album first by themselves; the wall left as it is while an album is open over it; and the
  row read again on opening after albums came while it was shut. On the page before, all three
  page checks fail.
- The Android app for this version is 0.8.43 (version code 243). Nothing in it changed.

## v0.8.42
The Android app no longer needs swiping away and opening again when its screen goes stale and stops
answering taps: it watches the page, as it already watched its own screen thread, and puts it right
itself.

- **The page watched.** While the app is on screen it asks the page every 10 seconds how it is
  (`window.__musicdPageCheck`, new in the page):
  - **no answer twice in a row** (the page's script has stopped), or the WebView saying the page
    hasn't handled a tap for over 10 seconds: the page's renderer is ended and the page put up
    again in a new WebView, which is what swiping the app away and opening it again did;
  - **asking the server for 45 seconds with no answer at all, and still asking**, while the app
    reaches the server itself: the page's connections are stuck. They're dropped (the page's next
    asks open new ones), and if it still has no answer 10 seconds on, the page is loaded again.
  - At most one reload or new WebView every two minutes. What was done is kept, as a freeze is,
    and the next start offers it to share ("Mandarin's page stopped last time").
  - The rules are `PageWatch` in the app's core (`android/core`), with its tests.
- **The page's renderer gone** (crashed, or ended by Android for memory while the app was behind
  others): the page is put up again in a new WebView, loaded when the app is next on screen.
  Before, the WebView took the whole app with it, the music playing on the phone too.
- **Back after half a minute or more away**, the relay's connections from before are dropped before
  the page asks afresh: kept over a sleep, they could hang rather than fail.
- **The relay** (`PageRelay`): a connection it can't take (no thread or file handle to spare just
  then) is closed rather than ending the relay; if the relay does stop, it closes its port, and the
  app starts it again when it's next on screen. Before, a relay that had stopped kept the port
  open, and every request the page made was taken and never answered.
- **Smart Picks' Make again, asked while the picks are being made, is no longer dropped** (the C#
  server's, `Extras/Taste.cs`): they're made once more when that build ends, from the plays as they
  are then. It's what turned main's Mac run red after v0.8.41: the Smart Picks test's Make again
  landed on the build that follows the library scan, which had read the plays from before.
  `test/smart-picks.test.js` now holds a build on a slow Deezer (`test/fake-deezer.js`'s `hold`)
  and asks again meanwhile.
- **Tests:** `test/stale-page.test.js`, in a browser: the page says how long it has been asking
  with no answer, an answer from the server ends it, the next ask starts it again, and coming back
  starts afresh. `PageWatchTest` (JVM): a page that answers is left alone; a silent one is put up
  again on the second miss; stuck connections are dropped, then the page reloaded; nothing when
  the server can't be reached either (that's an outage, which the app's own copy of the page
  covers), when the page has stopped asking, or when it's hidden; the two-minute spacing.
- The Android app for this version is 0.8.42 (version code 242).

## v0.8.41
Albums found by the identification scan at **85 % alike or better are now applied** (it was 95 %),
as the owner asked: going through about 190 proposals, most of the 85–94 % ones were right, held
back by an edition note, track names written differently or the lengths of another pressing.

- **Applied from 85 %**, as the page shows it, from MusicBrainz and iTunes alike, with Undo as
  before. Nothing is proposed any more: anything below 85 % is left for you to match by hand,
  as it always was.
- **The proposals already waiting are applied** the first time the scan runs after the update,
  as if each had been accepted (the same catch-up v0.6.3 had for its own change).
- The few that will now be applied wrongly can be put right as before: Undo on the album, or Find
  match.
- Both copies of the scan's rule move together (`lib/identify/score.js` and the C# server's
  `Identify/Score.cs`, which makes the scan), so the Node server's answers and the C# server's
  stay the same; Settings → Library Scanner, the README and the site say 85 %.
- **Tests:** `test/identify.test.js` holds the new line (85 % applied, 94 % applied, 84 % left
  unidentified, nothing proposed), the proposals waiting at 85 % or more applied once, and the scan
  end to end with its near misses applied (a track missing, a length 26 s off, from MusicBrainz and
  from iTunes); `test/identify-csharp.test.js` holds the two servers to the same verdicts.
- The Android app for this version is 0.8.41 (version code 241). Nothing in it changed.

## v0.8.40
Stage 3 of the move to C#: the conversions the Node server still made, with a ReplayGain, a zone's
DSP or 32-bit output, are made by the C# server, the files the very ones the Node server made.
After this only Qobuz's and Tidal's tracks are converted by the Node server.

- **A ReplayGain (`?g=`)**, on a Sonos room's stream and on a streamer's, **a zone's DSP (`?o=`)**,
  read from the device's settings as it fetches (a Sonos room's left to Trueplay, as before), and
  **32-bit output** where ffmpeg writes 32-bit FLAC: planned as `index.js` plans them, with stage
  2b's ports, and made with the same ffmpeg arguments under the same names in the conversions
  folder. A gain or a zone written in a form Express would read as a list (`g[]=`, `g` twice) is
  still the Node server's to answer, as is a gain out of range (its 400).
- **Made ahead too:** the Node server's "make these next" hands these to the C# server as it already
  handed the rest (`owns` in `index.js`, the hand-over switch).
- **Playback's second core while DSP runs**, as before: the C# server tells the Node server when a
  DSP conversion starts and when the last ends (`POST /internal/cpu/dsp`), and keeps to the split
  it answers with. The split stays the Node server's decision (`lib/cpu.js`).
- `Streams.cs` plans every stream with `Playback/StreamPlans.cs` (held to `lib/stream.js` by
  `test/streams-csharp.test.js`) instead of its own copy of the Sonos rule.
- **Tests:** `test/conversions-csharp.test.js` (through the C# server): a gain on Sonos's rule, on
  the 24/48 rule and on a streamer's rate; a zone's DSP alone and with a gain; a Sonos room's and an
  unknown zone's left out; 32-bit where ffmpeg writes it (refused as before where it doesn't), and
  end to end behind an ffmpeg that says it writes it (none of this machine's or CI's do); what is
  still the Node server's; and its "make these next" for a gain and a DSP made by the C# server.
  Each file is compared with the one ffmpeg makes from the Node server's own plan, byte for byte,
  under the Node server's own name. `test/library-front.test.js` now expects these from C#.
- The Android app for this version is 0.8.40 (version code 240). Nothing in it changed.

## v0.8.39
Stage 4.1 of the move to C# (`old/csharp-migration.md`): **Qobuz's and Tidal's catalogue
is the C# server's**. Built by Claude B, in parallel with stage 2 (v0.8.37 and v0.8.38), as the owner
arranged. Nothing in the Android app changed (it is 0.8.39 so the version moves together).

- **Browsing Qobuz and Tidal** — new releases, the featured lists (Tidal's tabs), search, an
  artist's albums, an album and its tracks, and whether an album is in your favourites on the
  service — is answered by the C# server, in the same shapes and words (`GET /api/qobuz/…` and
  `/api/tidal/…`: `lists`, `new-releases`, `featured`, `search`, `artist-albums`, `album`, `state`).
  Each album is marked as before: a favourite on the service, kept in the library, in the library.
  - The account, the albums kept and the library are read from the database the Node server writes;
    the C# server writes nothing. Signing in, the settings, the import, favouriting, opening and
    playing a service album stay the Node server's (stages 4.2 to 4.4, and 6).
  - **Tidal's token** is still refreshed by the Node server alone, so the two servers never hold
    different ones: a request made when it is about to expire, or that Tidal refuses, is passed to
    the Node server, which refreshes it and answers; the next is the C# server's again.
  - A favourite added or taken away (still the Node server's) is seen at once by the lists and the
    album's heart: the C# server keeps the favourites a minute, as before, but never past a change
    to the library.
  - One thing slower: Tidal's lists no longer hand the Node server the albums they list, so opening
    an album from Tidal's browser asks Tidal for it once more, until opening moves too (4.2).
  - `server/Mandarin.Server/Services/` (`ServiceHttp.cs`, `QobuzApi.cs`, `TidalApi.cs`,
    `Catalogue.cs`), `ServiceRoutes.cs`. The Node server's part is the hand-over only: the services'
    addresses added to what it hands over (`index.js`), as Last.fm's were in v0.8.26.
  - **Tests:** `test/services-csharp.test.js`, through the C# server: every catalogue route,
    signed out and signed in, held to the Node server's own answer to the same request, its
    refusals word for word; a favourite changed on the Node server seen at once; Tidal's token
    refreshed by the Node server alone, for a refused token and for one about to expire.
    `test/qobuz.test.js` and `test/tidal.test.js` pass with C# answering. `test/front.test.js` pins
    which server answers what (its v0.8.39 test and header line).

## v0.8.38
Stage 2b of the move to C#: the stream plans, ReplayGain, the DSP filters, the addresses signed for
speakers and the radio's memory, written in C# and held to the Node server's answers. Holding the C#
server already running to the same answers found a few places it differed; they're put right.

- **In C#** (`server/Mandarin.Server/Playback/`), used only by the tests until stages 3 and 6:
  - the stream plans (`lib/stream.js`): what a speaker, a streamer or the phone gets, the file as it
    is or a conversion, its type, the levelling and DSP added to it, ffmpeg's arguments, and the
    cache's names for it;
  - ReplayGain: the levelling setting, an album's loudness from its tracks', each track's gain;
  - the DSP filters (`public/biquad.js`, `lib/dsp.js`): their curves, headroom, the stored form, the
    fingerprint in a conversion's name, and ffmpeg's filter graph;
  - the radio's six-month memory;
  - V8's own `sin`, `cos`, `log`, `log10` and `pow` (`JsMath.cs`): .NET's differ from them in the
    last bit for a few in a hundred numbers, which would change a cache name or a headroom figure.
    They're x64 Node's to the bit, on every machine. Node built for Apple silicon rounds a few of its
    own in the last bit differently, so on a Mac a conversion with DSP or levelling that Node made
    may, now and then, be made again under C#'s name for it once C# makes them (stage 3).
- **Put right in the C# server already running:**
  - **a signed address** (a stream or a cover handed to a speaker) is checked as the Node server checks
    it: the path as the request wrote it, and `s` as Express reads the query. Before, the decoded path
    (a cover whose name needs escaping went to the Node server) and `?S=` as well as `?s=`. Where it
    can't be sure what the Node server would say (`s[]=`, an unusual address), the Node server decides,
    as it did;
  - a measured peak and an album's loudness are worked out with V8's `pow` and `log10`, so they're
    stored as the Node server would store them, to the last bit;
  - AutoEq's bands are rounded as JavaScript rounds (one value just under a half came out one higher);
  - Sonos's conversion: a codec name with a letter outside ASCII is read as JavaScript reads it.
- **Tests:** `test/streams-csharp.test.js` asks both about 207,000 cases and needs the same answers,
  NaN and -0 included: the repo's own cases (streams, DSP, levelling, the radio, signing), every rate
  from 8 kHz to 768 kHz and DSD64 to DSD512 at every depth, every renderer profile, every filter at
  its extremes, and seeded generated ones. Signing is checked against the Node server's own gate.
  The answers built on `Math` are held to Node's where its `Math` is V8's fdlibm (x64: CI's Linux
  jobs); on Apple silicon the test checks that Node's own `Math` is within the last bits of
  `JsMath.cs` and leaves those answers out.
- The Android app for this version is 0.8.38 (version code 238). Nothing in it changed.

## v0.8.37
Stage 2a of the move to C#: the logic Sonos and other players are driven by, written in C# and held
to the Node server's answers. Nothing that runs changes: the C# copies are used only by the tests
until playback moves (stage 6).

- **The Sonos logic in C#** (`server/Mandarin.Server/Playback/`): XML read as the Node server reads
  it (`lib/xml.js`, broken documents included), DIDL-Lite built byte for byte and read back, the
  queue's move plans, the household read from a ZoneGroupState (rooms, groups, pairs, home theatre
  satellites), the SSDP answer's headers and this machine's LAN addresses, and the SOAP envelope
  sent and the answer or fault read.
  - **Tests:** `test/sonos-csharp.test.js` asks both servers about 11,700 cases and needs the same
    answers, key order included: what the repo's fake speakers and real players send, awkward cases
    by hand, and seeded generated and damaged ones.
- **The renderers' logic in C#** (`server/Mandarin.Server/Renderers/`): a device's description (its
  services' addresses resolved as Node's URL resolves them), the formats it says it takes, the events
  it sends, and its capability profile (the rates, bits and DSD it gets, the user's own rates over
  them).
  - **Tests:** `test/renderers-csharp.test.js` asks both servers about 16,000 cases the same way:
    the repo's fake renderers, real devices' documents (WiiM, Sonos, Denon, Linn, gmrender,
    Samsung), Sonos's event shapes, and seeded generated and broken ones.
- **The Docker image's build** copies the C# server's folder whole, so a new folder of it can't be
  left out (the image failed to build on this branch's first push, which added `Playback/`).
- **Who does what:** the owner's split is in the migration spec. Stage 2 is this account's (2a here,
  2b next); stage 4's parts 1 to 4 (Qobuz and Tidal, not their streams) are Claude B's.
- The Android app for this version is 0.8.37 (version code 237). Nothing in it changed.

## v0.8.36
The app and the browser page no longer go stale and stop answering taps after the phone has slept,
and the library scans go to the C# server only once the tag check has passed, as the owner decided.

- **A screen that went stale and stopped answering** (the Android app and the PWA alike, until
  closed and opened again). A phone that sleeps, or moves from Wi-Fi to mobile data, can leave
  requests on connections that never answer, and a browser keeps only six to the server: once six
  were waiting, everything after them waited too. Several things made that likely: the room list
  asked for every 15 seconds even in the background, with nothing to stop a new ask joining one
  still waiting; the offline check (v0.8.23) starting another look at the server at every failed
  request while one hung, and never looking again after; and almost nothing the page asks for had
  a time limit. Now:
  - every request the page makes of the server is given up after 30 s (a read) or 90 s (anything
    else); the long jobs (Reindex, backups, an update, an import, the MusicBrainz pack) aren't;
  - coming back to the page (shown again, or woken: its clock jumped) lets go at once of every
    read still waiting from before, before the page asks afresh (not a write: its answer may be
    in already, and it has its own limit);
  - the room list and the update check aren't asked for while the page is hidden, nor the room
    list again while one ask is waiting; it's asked for at once on coming back;
  - the offline check looks once at a time, and an answer that takes over 8 s counts as none.
  - **Tests:** `test/stale-page.test.js`, in a browser, with the requests a dead connection would
    hold held for ever: one is given up; coming back lets go of a read that was waiting, not a
    write; failed requests don't each start another look; hidden, the room list isn't asked for,
    and shown, it is at once. On the page before, the first of them never ends.
- **The library scans go to the C# server only once the tag check has passed** (the owner's
  decision): where the Node server's own scans would already be made by the C# program —
  `TAG_READER=csharp`, or the check passed for the two readers. Otherwise they stay the Node
  server's, as before v0.8.34 (which handed them over whatever the check said). Decided when the
  C# server takes the work over. `test/scans-csharp.test.js` holds both ways.
  - Removing a music folder or forgetting a missing one is checked against a scan and done under
    one lock, so the timer's or the watcher's scan can't start in between.
- The Android app for this version is 0.8.36 (version code 236). Nothing in it changed.

## v0.8.35
The Queue screen, quick: tapping a track further down plays from it with "Now playing" moved at
once, and a Sonos room's queue is kept by the server instead of read whole from the speaker each
time.

- **Tapping a track to play from it** (after the "Play from …?" question) moves "Now playing" to
  it straight away, the tracks above it into the played ones, before the speaker has answered.
  The room's own queue is then asked for as soon as it has moved, not after a fixed wait, and if
  the room isn't there yet the screen keeps what you tapped and asks again.
- **The list is never emptied to wait.** Opening the Queue tab again, or any change made on it
  (Remove, Play next, Clear), leaves the rows on screen until the fresh queue replaces them.
  "Loading queue…" shows only for a room whose queue hasn't been shown yet.
- **A Sonos room's queue is kept by the server.** Opened again, the speaker is asked for its first
  track alone, whose answer says whether the queue has changed (Sonos's UpdateID); the whole queue,
  up to a thousand tracks, is read again only when it has. A change made in the Sonos app is seen
  the same way. When the queue grows (an album added here or there), the server reads it again in
  the background, so the screen opens on it at once.
- **Play from here** answers once the room has moved to the track (its state read back first).
- A Node change, as the owner allowed: playback is the Node server's until stage 6. Renderers'
  and the phone's queues were already the server's own, in memory.
- **Tests:** `test/queue-screen.test.js`: the queue opened again costs one track's answer; a change
  from the Sonos app is read; an album added is read in the background; Play from here answers
  with the room moved; and in a browser, with the speaker holding its answers, "Now playing" moves
  at once and the list is never empty. All but the Sonos-app case fail on the code before.
  `test/fake-sonos.js` now answers a Browse as a speaker does: the part asked for, and an UpdateID
  that moves with the queue.
- The Android app for this version is 0.8.35 (version code 235). Nothing in it changed.

## v0.8.34
Stages 1e and 1f of the move to C# (`old/csharp-migration.md`): **the library scans are the
C# server's**, and so are the covers the Node server still drew with `sharp`, but for a few. Also a
fix for Queue writing over a queue that wasn't playing, a calmer Shelf, and Add to playlist on the
album page. From the `v0.8.32` branch, numbered 0.8.34 as v0.8.33 went out first.

- **The library scans** (stage 1e) are a job the Node server hands over, as identification and
  the rest are: the C# server reads the library half a second after taking over, every
  `SCAN_INTERVAL_HOURS` (six), and when the music folders change on disk (watched with the file
  system's own notifications; read once the changes have been quiet for 20 seconds, at most once a
  minute, as before). The Node server's own timer and watcher don't start.
  - Rescan library, Reindex, Settings → Music folders (the list, adding and removing a folder, the
    folder picker and its hints about mounts), Forget folder, `/api/music-mount` and
    `/api/search-status` are answered by the C# server, in the same shapes and words.
  - The Node server keeps its copy of the library for playback: it is told how each scan goes
    (about once a second, so `/api/status` and the page's progress are as before), reads the
    albums found so far as they land, and once a scan ends does what followed one (the covers drawn
    ahead, the tag check, release days and Smart Picks), and after a Rescan brings Qobuz and Tidal
    up to date, as before.
  - The scan now reads tags with the C# reader whatever the tag check says (Settings → Library
    Scanner still runs it and lists any difference). `TAG_READER=node` keeps the scans, and the
    music-metadata reader, the Node server's. *(v0.8.36 puts the check back: the scans are handed
    over only once it has passed.)*
  - Clean up stays the Node server's while Qobuz's and Tidal's albums are (stage 4).
  - `server/Mandarin.Server/Scans.cs`, `ScanRoutes.cs`, `Mounts.cs`. The Node server's part is a
    hand-over switch only (`index.js`, `lib/server/api-library.js`), as the owner allowed.
  - **Tests:** `test/scans-csharp.test.js`: every read route held to the Node server's own answer
    to the same request, every refusal word for word, a folder added and removed, Rescan
    ("fresh", then "rebuilt"), Reindex, a missing folder kept then forgotten, and a new album found
    by the watcher, by the timer, and not for a hidden folder.
- **Covers** (stage 1f), drawn by the C# server with ffmpeg, as the owner chose:
  - an album with no cover of its own: its placeholder, the same colour, gradient, note, title
    and artist as `sharp` drew (`test/covers-csharp.test.js` holds the two drawings together);
  - a picture from elsewhere (a radio station's, a track queued from the Sonos app, Last.fm's):
    fetched as before (http(s), three redirects, 15 MB at most) and drawn as a cover is.
  - Still the Node server's: a picture only `sharp` reads well (CMYK, a colour profile other than
    sRGB, a file cut short), a speaker asking for a cover by its own address, and the placeholder
    where ffmpeg can't draw text (no `drawtext`: Homebrew's on a Mac, CI's static build), as the
    C# server's log says once.
  - CI's image check makes sure the image's ffmpeg draws text with a system font.
- **Queue and Play next no longer write over a queue that isn't playing.** With music in the queue
  and nothing playing, queueing an album replaced the queue and started it (on Sonos; a renderer or
  the phone jumped to it and played). Now what's added joins the queue and nothing starts; an empty
  queue is started as before, and while music plays nothing changed. A Node change, as the owner
  allowed for this bug (`test/queue-stopped.test.js`).
- **Shelf moves less under a finger:** a finger goes 40% further for one album, the shelf carries
  on less after a swipe, and a flick has to be firmer to spin it. The wheel and a trackpad are as
  before.
- **The album page's ⋯ menu has Add to playlist**, under Listen later: the whole album into one of
  your playlists or a new one.
- **The Android app waits for CI too** (#181, `claude-b-app-waits`), as the release and the image
  have since v0.8.31 (#179): it goes out only once every CI run on the same commit has passed.
- The Android app for this version is 0.8.34 (version code 234). Nothing in it changed.
## v0.8.33
An album's booklet, in the app: the PDFs that came with an album open on its page, drawn by the
C# server. From the `claude-b-booklets` branch, built on v0.8.31; `v0.8.32` is a separate build.

- **The book button.** An album with a booklet shows a brass book in the bottom right of its
  cover, opposite the bit/sample rate. Albums without one show nothing.
  - **A booklet** is a PDF in the album's folder, in a folder inside it that holds no music
    ("Scans", "Booklet", "Artwork"), or beside the discs' folders ("CD 1", "Disc 2"). A folder with
    music in it is another album's: a single loose in an artist's folder doesn't show the booklets
    of the artist's albums. Twenty at most; an album with several offers them on a sheet.
  - **Tapping it** opens the booklet over the album page, its pages one under another, as wide as
    the screen, with the page you're on at the top. × or the phone's Back closes it (Escape in a
    browser), leaving the album page as it was.
- **The source badge** (Local, Qobuz, Tidal) moves to the bottom left of the cover, above the
  bit/sample rate, or in its place when there's no rate: the bottom right is the book's.
- **Drawn by the C# server, page by page.** The Android app's page can't show a PDF itself, so the
  server draws each page as a picture at the screen's width (`server/Mandarin.Server/Booklets.cs`,
  `BookletRoutes.cs`; `GET /api/album/booklets`, `GET /api/booklet/page`), two at a time, in the
  background's place, kept in the data folder's `booklets/` (half a gigabyte at most, the pages
  least lately shown let go first). A phone fetches only the pages it shows. A booklet is named by its album and an id, never by a path, so nothing outside an album's
  own booklets can be asked for; signed in only. New with the C# server: none of it is the Node
  server's (a Mac kept on Node alone shows no book).
- **poppler** draws them (pdfinfo, pdftoppm), as ffmpeg draws covers:
  - **Docker:** in the image from this version.
  - **A Mac:** run the install line again (it now installs poppler with ffmpeg), or
    `brew install poppler`. Until then a Mac shows no book; once it's there, the server finds it
    within five minutes, without a restart.
- **Tests:** `test/booklets-csharp.test.js`, through the C# server: which albums have one (and a
  single loose in an artist's folder that hasn't the artist's albums' booklets), pages
  drawn in their own colours at a kept width and kept, a changed booklet drawn afresh, nothing
  outside an album's booklets (another album's, a page past the end, an id made up, not signed
  in), and in a browser at a phone's size the book's and the badges' places, the sheet, the pages,
  Escape and Back. CI installs poppler on Linux and the Mac, and the test fails there without it.
- The Android app for this version is 0.8.33 (version code 233). Nothing in it changed.

## v0.8.31
Stage 1d of the move to C# (`old/csharp-migration.md`): Restart and Shut down are the C#
server's, and **Restart now starts both servers again**.

- **Restart** (the side menu's power button) stops the Node server cleanly, then the C# server
  starts itself again in place, on every processor core it started with, as after an update, and
  starts a new Node server. Before, only the Node server started again and the C# server carried
  on as it was.
  - A downloaded update waiting to be put in is no longer put in by Restart; Settings → Update
    does that, as it always has.
- **Shut down** is as before, now from the C# server: both stop. On a Mac the login item is
  unloaded, so it stays stopped until the Mandarin icon or the next login. In Docker it isn't
  offered (`docker stop`).
- **Settings → Library Scanner's processor line** (`/api/cpu`) is answered by the C# server. Which
  core playback keeps is still decided by the Node server until playback moves (stage 6): taking
  it now would mean changing the Node server.
- From home only, both, as before.
- `server/Mandarin.Server/PowerRoutes.cs`; answered there where the C# server started the Node
  server itself, as every install does.
- **Tests:** `test/power-csharp.test.js` runs the real C# server starting the real Node server:
  Restart in the same process with a new Node server and the library and sign-in as they were;
  Shut down leaving with 0; Docker's refusal.
- **Releases, the image and the engines wait for CI** (#179, `claude-b-release-waits`). A merge
  to `main` used to publish the release and the image at once, alongside CI rather than after it:
  v0.8.29 and v0.8.30 both went out while their Mac tests were still running, v0.8.29's to fail.
  Now each waits for CI on the same commit and goes out only if every run of it passed
  (`.github/wait-for-ci.sh`, a first `ci` job in `release.yml` and `docker-publish.yml`). A CI run
  re-run to green: re-run the failed job of the Release or Publish run too.
- The Android app for this version is 0.8.31 (version code 231). Nothing in it changed.

## v0.8.30
A test build, from the `v0.8.31-tests` branch, with `v0.8.31-cpu` and #176 (`claude-b-fix`) merged
in. The tests run several at once, about three and a half times faster; Settings counts every
processor core again after an update; and a label's albums no longer come back over the Labels list.

- **Settings counted one core fewer after each update** (Docker and Mac). A 4-core machine showed
  "3 cores · 1 kept for playback · 2 for scanning" after an update from Settings, then 2 after the
  next. The C# server keeps itself off playback's core, and after an update it starts itself again
  in the same process, which kept it to those cores; it then counted only them. It now goes back
  to every core first (`server/Mandarin.Server/Cpu.cs` `Restore`, `Front.cs`).
  - **Already counting fewer?** Restart the container or the app once. The update into this
    version is still made by the old one, so it doesn't put it right by itself.
- **A label's albums could come back over the Labels list** (#176). Tapping ‹ while a label's
  albums were still on their way showed the label again when they came. The Labels list and a
  label's albums now drop an answer for a screen that is no longer showing.
- **The tests run several files at once** (`npm test`: four; CI's Mac job: two, as it has three
  cores). On a 4-core machine: Node alone from 585 s to about 165 s, through the C# server from
  859 s to about 240 s.
  - `test/ports.js` hands each test file its own ports and loopback addresses (a slot per test
    process, kept in the temp folder), and `test/fake-sonos.js` puts its rooms on them. A new test
    takes `ports.port()` and `ports.host(i)` instead of a number. CI's Mac job adds every address
    to lo0 (`node test/ports.js --addresses`).
  - Tests that waited a fixed time and then acted now wait for the thing itself (Sonos and renderer
    restarts, the share card, the shelf, Settings, the folder watch, the processor split). The
    stand-in Sonos rooms and renderer can hold their answers or their clock for that.
- **Tests on a Mac** (CI): Homebrew's ffmpeg has no SoX resampler, so both resamplers' commands are
  now checked on every machine; a browser run without a mouse has none on a Mac either; built-in
  Tailscale's download is checked as not offered off Linux; the processor plan is checked as Linux's
  anywhere; and the folder watch is heard to be live before changes are counted (a Mac's starts a
  moment after it's asked for, and misses what changes before).
- `test/csharp-update.test.js`: the C# server started again after an update tells the Node server
  the same cores as before.
- The Android app for this version is 0.8.30 (version code 230). Nothing in it changed.

## v0.8.29
A test build, from the `mac-csharp` branch, built on v0.8.28 (`shelf-cs`), so that one goes in first.
Mandarin's C# server now runs on Macs too, updates bring both servers together, and from here on
new server work is done in C# only (`old/csharp-migration.md`, 2.1, 2.2 and 2.4).

- **The C# server on a Mac.** As in the Docker image, it's what starts when you log in, and it
  starts the Node server behind it.
  - **Installing on a Mac now sets it up**, for Apple silicon and Intel.
  - **A Mac installed before v0.8.29:** paste the install line again, at the Mac. When macOS asks
    to let **mandarin-server** find devices on your network or open your files, choose **Allow**:
    Mandarin needs both to reach your speakers and read your music. Until you do, the Mac carries
    on as it was, and Settings shows a note under the version.
  - The C# server comes from the release of the version you have. If you haven't updated in a
    while, update in Settings first, then paste the line.
  - `MANDARIN_NODE_ONLY=1` in front of the line keeps the Node server alone, as before.
  - **What it changes on a Mac:** the library scan, identification, loudness, backups and the rest
    already moved now run in C# there too, as in Docker. Playback and the Mac's own sound devices
    stay the Node server's for now, and built-in Tailscale stays Linux only.
- **An update brings both servers together** (Docker and Mac). Settings → Update now fetches and
  checks the C# server of the new version *before* it installs anything ("Fetching the C#
  server…"), and the two start together.
  - **If it can't be had** (GitHub not answering, say), the update stops and says why. Nothing
    changes, and you can try again.
  - Until now the C# server was fetched only after the update had installed the Node server's
    files. If that fetch failed, the two ran mismatched, with the C# server passing everything on,
    for up to three hours or for good.
- **All server work is now done in C#.** The Node server's copies of parts already moved stay as
  they are, for a Mac kept on Node alone, and aren't changed any more. A part the Node server still
  runs itself (playback, the updater, Qobuz and Tidal) moves to C# before it's changed; this
  build's change to the updater is the last made in Node.
- **Each build now has its own branch, named for its version** (`v0.8.30` next).
- **For the C# server on a Mac** (`server/`):
  - the scan's file system calls take macOS's forms (`Scan/NodeFs.cs`);
  - the C library is macOS's (`Program.cs`);
  - background work runs at a lower priority with `nice`, as the Node server does on a Mac
    (`Cpu.cs`);
  - `server/build.sh` builds for the Mac it runs on.
- **Releases** carry `mandarin-server-osx-arm64.gz` and `mandarin-server-osx-x64.gz`, built and
  signed on GitHub's Mac runners, beside the Linux builds and in the same sums file.
- **Tests:**
  - CI runs the whole suite through the C# server on a Mac. The scan is held to the Node server's
    there, file for file.
  - `test/csharp-update.test.js`: the Mac's build chosen and signed; the new version's C# server put
    in place before an update, and an update that can't have it stopped with nothing changed.
  - `test/update-prepare.test.js`: the updater asks for it before staging anything.
  - **Not tried on a real Mac** (there isn't one to try it on): the installer, macOS's permission
    prompts, Sonos on a Mac's network, and whether macOS asks again after an update. Tell me what
    happens on yours.
- The Android app for this version is 0.8.29 (version code 229). Nothing in it changed.
## v0.8.28
A test build, from the `shelf-cs` branch. Shelf's screen is rearranged for a tablet on a stand,
and its page moves to the C# server, so Shelf now asks the Node server for nothing but playback.

- **Shelf's screen, rearranged:**
  - **The album's Play now and Queue are in the bar at the foot**, after what's playing and just
    before the zone button. **Play next is gone** from the album's buttons; it's still offered for
    tracks you choose on the back of the case.
  - **The album's name sits just above the bar.**
  - **Bigger buttons:** previous and next are twice the size, play/pause is bigger, and there's
    more room between them. The zone and volume buttons are twice the size too.
  - **A bigger volume control:** a thicker slider with a bigger knob, and bigger − and + buttons.
  - **Bigger covers**, in the room the album's buttons left.
  - **The track list on the back of the case is as big as the back holds.** Its size is worked out
    for each album:
    - in one column or two, whichever lets the names be bigger;
    - growing never cuts short a name that fitted at the smallest size;
    - a list too long even at the smallest still goes on into the booklet below the case.
    The barcode is smaller to give the names more room.
  - **On a phone** the bar takes two rows: the album's Play now and Queue above, the rest below.
  - While you choose tracks on the back, the album's own Play now and Queue step aside, as its
    name does.

- **Shelf's page (`/shelf`) is answered by the C# server**, as the main page has been since v0.8.3.
  With Shelf's list already there (v0.8.23), every request Shelf makes outside playback is now the
  C# server's.
- **Playback stays the Node server's** for now: the rooms, the queue, play/pause, previous and
  next, volume and Play now. It moves with the rest of playback in stage 6 of the move to C#
  (`old/csharp-migration.md`).
- **Shelf's list also gives Mandarin's version.** The help popup uses it to know when it's due
  again after an update, instead of asking the updater. It shows once the library has arrived.
- **Tests:**
  - `test/front.test.js` pins `/shelf` to the C# server: the page, "not modified" for a copy
    still current, and the sign-in page for a visitor signed out.
  - `test/shelf.test.js` now records, in a real browser through the C# server, which server
    answered each request the page made: nothing but playback may come from the Node server.
  - `test/shelf.test.js` also checks the rearranged screen:
    - Play now and Queue are in the bar, by the zone button, with no Play next, and Queue adds to
      the queue;
    - the buttons are the new sizes, and the covers take the room;
    - a short track list fills the back with nothing cut short;
    - the volume slider fills to the level.
  - The full suite passes both ways.
- The Android app for this version is 0.8.28 (version code 228). Nothing in it changed.

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
(`old/csharp-migration.md`). Three more parts of the server are now answered by the C#
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
to C# (`old/csharp-migration.md`, on the `migration-plan` branch). In-app updates now bring
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
  `old/album-identification.md` — for review before anything is built.

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
- **A written plan for UPnP/DLNA renderers** — `old/audio-devices-upnp.md`: discovery
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
