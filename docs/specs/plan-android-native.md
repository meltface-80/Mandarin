# Plan: the Android app as a full native app, not a WebView

Status: plan (bug list item 17), written v1.0.7; what is left set out below (item 46, 19 October 2026). N0 built (bug list item 21): `NativeShell.kt`, `Shell.kt` in `core`. N1 built (item 22): `LibraryClient.kt`, `Library.kt` in `core`, held to the server by `test/golden/android-api.json`. N2 built (item 23): `NowPlayingScreen.kt`; whole, out of preview and always the app's since item 47. Each native screen is held to the page's by the screens contract (item 25, `docs/specs/native-parity.md`); N2 lacks nothing of the page's since item 29, its Queue tab. N3's album page is in the contract (item 30); its native screen (item 32: `AlbumScreen.kt`, `AlbumTracks.kt`, and from items 39 to 44 `AlbumAbout.kt`, `AlbumHead.kt`, `AlbumSelect.kt`, `BookletScreen.kt`) lacks nothing of the page's since item 44, so it is out of preview in the contract and, since item 47, always the app's (the switches in Settings went); the mini player at its foot is native too (item 35: `MiniPlayer.kt`, whole from the start), and the touch layout's row under it (item 38: `TouchNav.kt`, each tap the page's own button's). Both screens and the bar are drawn as the page's own (items 36 and 37: its type, colours, sizes and spacing), not in Material's look.

## Is it the key to better function and performance?

**Mostly yes, for the parts you use every day.** Several of this round's bugs belong to the WebView, not to Mandarin:
- the page freezing while it waits on the app's bridge (item 2);
- Android's own overscroll stretch round the WebView (item 6);
- the menu's reload glitch, needed because the page has to be reloaded to change source (item 9);
- the keyboard needing focus inside a tap (item 13);
- the page watchdog (`PageWatch`, `PageGuard`) that exists to rescue a stuck renderer.

A native screen has none of these.

It also means real native list scrolling (RecyclerView/Compose `LazyVerticalGrid` with image caching), Android's own screen transitions, and no second process (the WebView renderer) to stall or be killed.

**The cost: two interfaces.** The web page stays: browsers, the iPhone, and the server's own Settings all need it. Every screen made native is a screen kept twice. So the plan is **not** a rewrite of everything. It makes native the screens used every day and keeps the WebView for the long tail (Settings, admin, backups, identification, the editors) until each earns a native version, or for good.

## What the app already has natively

A good half of a native app already exists, out of sight:

- **Playback**: `PhonePlayerService` (Media3 ExoPlayer, `MediaSession`, notification, lock screen), the Opus decoder, `UsbDac`/`UsbAudioSink` (bit-perfect USB), `DspSink`, `StreamCache` and the fetch-ahead (`CachePlan`).
- **Server access**: `ServerClient`, `Srp` (sign-in), `Route`/`ServerAddress` (home and away), `TailscaleEngine`, `PageRelay`.
- **Offline**: `DownloadStore`/`DownloadWorker`, `LocalMusic`, `OfflineApi` (it already answers the page's API from the phone's own albums).
- **The API**, written down: `docs/specs/api.md`.

What's missing is the screens and a typed client for the library API.

## Shape

- **UI**: Jetpack Compose (Material 3, dynamic colour off; Mandarin's own palette from `style.css`'s tokens, and its type: Manrope, `res/font/manrope_*.ttf`, a static instance of the page's woff2 a weight).
- **Layers**: `core` (pure Kotlin, already a module with JVM tests) gains the typed API client and models; the app gains a repository with a local cache (Room) so screens show at once and refresh behind, and the Compose screens.
- **Images**: Coil, with a disk cache keyed by the server's `image_key`.
- **Lists**: Paging 3 over the Library's `offset`/`count` API.
- **Navigation**: Navigation Compose. A route for each native screen, and **`web/{path}`, a WebView screen opened at that page path** for everything not native yet. Same sign-in cookie as today.
- **Player control** (Sonos, renderers, the phone): the zones API plus the server's revision/long-poll (`hub.Bump`), so Now playing and the mini player stay live.

## Stages (each its own branch and PR, CLAUDE.md step 4)

| Stage | What | Leaves in the WebView |
|---|---|---|
| N0 | Native shell: Compose activity, navigation, theme, the `web/{path}` screen. Opens to the WebView Home exactly as today. **No visible change**; it's the frame the rest goes in. | everything |
| N1 | Typed API client in `core` from `api.md`: albums, album, artists, search, home rows, zones, queue, playback. JVM tests against the C# server (the suite's own fixtures). | everything |
| N2 | **Now playing + mini player + queue** native, over the existing `PhonePlayerService` and the zones API. The most-used, most-animated screens. | Home, Library, search, Settings |
| N3 | **Album page** native (tracks, play/next/queue, favourite, ⋯ menu). | Home, Library, search, Settings |
| N4 | **Library grid** native: columns, list, text size and tile size from the same settings; Focus, Sort, the filter; position kept. | Home, search, Settings |
| N5 | **Home** native: greeting, Random/Album of the day, the rows in the user's order. | search, Settings |
| N6 | **Search** native (the library's and Qobuz's/Tidal's). | Settings and the long tail |
| N7 | Offline mode native, over `DownloadStore`/`LocalMusic` directly. `OfflineSite` (the page's copy in the APK) goes. | Settings and the long tail |

Each stage ships on its own and can be tested by updating from `dev`; the WebView screens keep working throughout. Rough size: N0–N1 a week; N2–N5 one to two weeks each; N6–N7 a week each.

## What to decide before N0

1. **minSdk**: stays 26 (Compose supports it).
2. **One palette, or two**: whether the native screens follow Mandarin's dark brass exactly (recommended) or Material You.
3. **Tablets**: Compose's window size classes let the Library and Now playing go two-pane on a tablet from the start, or later.
4. **Order**: Now playing first (N2) is the recommendation: it's where fluidity shows most and it already sits on native playback.

## Risks

- **Drift between web and native**: a feature added to the page and not the app (or the reverse). Handled by the screens contract (`docs/specs/screens.json`, `docs/specs/native-parity.md`):
  - every native screen's controls and readouts are listed in it, by key;
  - the page's test and the app's gate (`npm run parity`) fail when either side differs from it;
  - a screen in preview may lack items only from a list that only shrinks.
  The data is held by `test/golden/android-api.json`, the colours by `ShellTest`.
- **Size of the APK**: Compose adds about 3–5 MB. The page's copy (`OfflineSite`) leaves at N7.
- **Two update paths**: native screens change with an app update, not a server update. The server keeps answering older apps (the API is versioned by what it adds, never by what it removes).

## What is left (19 October 2026, after items 35 to 45)

Built: N0, N1, N2 (Now playing, the Queue, the yes-or-no sheet; whole), N3 (the album page, whole), both out of
preview and always the app's since item 47 (the WebView's Now playing and album page are not reached in the app), the
mini player, the touch layout's row and the booklet viewer. The gaps list is empty. Everything else the page
draws is still the WebView's, and the owner's rule is that **all of it** is to be native and kept so: not the
"long tail stays web" of the first plan. The page itself stays, for browsers, the iPhone and the server's own
Settings; each screen is drawn twice and the contract holds the two together.

The inventory below is the page's own surfaces (public/app, by module), grouped as stages. Each row is one
bug-list item and branch into `dev`, built as N2 and N3 were: the screen's items into `screens.json` and keyed
on the page first; the Compose screen to it, in preview while its gaps list shrinks; out of preview at zero.
Sizes are the page's lines for that surface, a proxy for the native work.

### F. The frame, first (what every other stage stands on)

| Item | What | Page |
|---|---|---|
| F1 | The native frame: the top bar (menu, back, the title and count, the glass, the select ⋯ menu, reshuffle, the scan bar), the touch row along the foot and the mini player on every native screen, the toast, the banner, the skeletons. Home, Library and Search become native routes the row switches between; the WebView becomes one route among them (`web/{path}`) for what is still the page's | `page-state`, `home-layout` (`setTopbarNav`), `topbar-height`, `album-tiles`, `toast-lift`, `touchnav.js` · ~900 |
| F2 | The dialogs and sheets: the prompt and notice dialogs (the yes-or-no one is native, and the name box since item 94), the list sheet (`openLibSheet`) and the overflow menu (`buildOverflowMenu`) as the page draws them, each a contract screen the later stages open | `album-grid` (dialogs), `library-controls` (`openLibSheet`, `askName`), `home-picks` (menu) · ~350 |
| F3 | `core`: the client for every route the stages below call (the list in `docs/specs/api.md`; today it has the library, the album, Last.fm, zones and playback), recorded into `test/golden/android-api.json`; covers cached by `image_key`; the library's `X-Mandarin-Library` mark as a change signal | `library-mark`, `request-limits`, `sign-out-guard` · ~250 |

### N4. The Library

| Item | What | Page |
|---|---|---|
| L1 | The wall: the grid (columns, list layout, tile size and text size from UI Settings), paged over `/api/library/albums`, the position kept on return, the quality, source and multi-disc marks on the tiles. **Built (item 51), always on since item 64**: `LibraryScreen.kt`, `AlbumTile.kt`, opened by the page in its view of the library with its UI Settings; Focus, Sort and the name filter are its gaps (L2) | `walls`, `library-wall`, `album-grid`, `album-tiles` · ~1,000 |
| L2 | **Built (item 52), always on since item 64.** The controls row and its sheets: Focus (the facets: genre, source, decade, label, format, rate, bits, channels, letter, added; played: any, never, 6 or 12 months; Clear all, Save as a Dynamic Playlist, Show albums), Sort (name, artist, release, added, most and last played, random with its seed; a second tap flips it), the name filter; the Filter sheet (all, genre, tag, decade) | `library-controls`, `library-focus`, `playlist-share` (`openLibSortSheet`), `filter-sheet` · ~700 |
| L3 | **Built (item 52), always on since item 64.** Selecting albums: a long press, the action bar, the ⋯ (play now, next, at the end; add to playlist; Listen later; clear), `/api/play-multi` | `album-grid` (select mode), `labels-albums` (`invokeAlbumMulti`) · ~250 |
| L4 | **Built (item 52), always on since item 64** (`ArtistScreen.kt`; the phone's own albums on it wait for O1). The artist's page: their albums and the biography head, the title and count in the bar | `artist-view` · 303 |
| L5 | **Built (item 52), always on since item 64** (`WallScreen.kt`). The walls Home links to: Listen later, Favourites, Recently played, Not played in 6 months; Random albums with reshuffle | `walls`, `album-grid` (`loadRandom`) · ~300 |

### N5. Home

| Item | What | Page |
|---|---|---|
| H1 | **Built (item 57), always on since item 64** (`HomeScreen.kt`, `HomeRows.kt`, `HomeTiles.kt`). Home: the greeting, the Today strip (the Random Album tile, Album of the day), the rows in the user's order and visibility (`/api/settings/home-rows`), each heading a tap to its wall; drawn from a cache at once and refreshed behind; the scroll kept | `home`, `home-layout`, `home-render`, `home-rows` · ~1,400 |
| H2 | **Built (item 57)** (`PicksScreen.kt`). Smart Picks: the row and the full screen with each pick's reason, favourite and block | `home-picks` · ~430 |
| H3 | **Built (item 57)**. Browse by genre (the genre cards, `/api/home/genre-groups`) and Label of the week | `home-rows`, `device-power` (genre cache) · ~200 |
| H4 | **Built (item 57)** (`RandomPickDialog.kt`). The Random Album pick: the spinning disc, Play now, Play next, Queue (`/api/pick-unheard`) | `play-unheard` · ~200 |
| H5 | **Built (item 57)** (the walls in `WallScreen.kt`, the sheets in `LibrarySheets.kt`). The app's own rows, from the store directly: Downloaded albums and Music on device, with the latter's Focus and Sort sheets | `home` (downloads), `home-layout` (local wall) · ~400 |

### N6. Search

| Item | What | Page |
|---|---|---|
| S1 | **Built (item 61), always on since item 64** (`SearchScreen.kt`, `SearchRows.kt`). The library's search: the field in the bar, artists and labels as chips, the albums grid, the index building shown | `search` · ~200 |
| S2 | **Built (item 61), always on since item 64** (a service's artist and a Pitchfork review are handed to the page's browser and magazine until B makes them native). The services' search: Qobuz, Tidal and Pitchfork sections as each answers, the last query's kept dim until replaced | `search-external` · ~220 |

### P. Playlists

| Item | What | Page |
|---|---|---|
| P1 | **Built (item 65)** (`PlaylistsScreen.kt`; the server has no playlists of its own now, so it is yours alone). The Playlists screen (the app's own first, then the server's with their mosaics), a server playlist's page (play, play a track, Share) | `walls` (`showPlaylists`), `library-wall` (`openPlaylist`) · ~350 |
| P2 | **Its page built (item 65)** (`PlaylistScreen.kt`: play, queue, a track from its album, Delete asked natively; Add to playlist stays the page's sheet). **Import and Share built (item 94)** (`PlaylistImportSheet.kt`, `PlaylistShareSheet.kt`, with the name box, `PromptDialog.kt`; core `PlaylistShare.kt`). The app's own playlist: its page (play, queue, a track plays from its album, Share, Delete), Add to playlist (the sheet, a new one named), Import (a pasted MDRP1 or a `.mus` file), Share (`/api/share/encode`, copied or saved) | `playlists`, `playlist-import`, `playlist-share` · ~700 |
| P3 | **Built (item 66)** (`SmartPlaylistsScreen.kt`, `SmartPlaylistScreen.kt`; New and Edit go through the page's sheets and its Focus, Share through its sheet). Dynamic Playlists: the list, New from the Library's Focus, a playlist's page (play, edit through Focus, Share, Delete) | `smart-playlists`, `smart-playlist`, `zone-grouping` (delete) · ~450 |

### R. Rooms, the menu, the server

| Item | What | Page |
|---|---|---|
| R1 | **Built (item 68)** (`RoomSheets.kt`; the queue-move question asked by the app, the page's quiet for a room the app chose; the room is still the page's select's, told by the app). Group zones and Device power as native sheets (today the page's, opened from the native Play on); the queue-moves-with-the-room question; the room chosen kept by the app, not the page's hidden select | `zone-grouping`, `device-power` · ~600 |
| R2 | **Built (item 67)** (`MenuDrawer.kt`; Playlists, Dynamic Playlists and Listen later open natively; Pitchfork, Labels, Qobuz, Tidal, Settings, Shelf, Restart and Shut down, with the question and the cover screen, are the page's). The side menu: the items (Pitchfork, Labels, Qobuz, Tidal, Shelf, Listen later, Dynamic Playlists, Playlists, Rescan with the library's age, Settings), the Offline switch, the Power popover (Restart, Shut down, the cover screen until the server answers) | `menu-drawer`, `power` · ~400 |
| R3 | **Part built (item 69)** (`NoticeBanners.kt`: the server's notice and the update offer at the head of the native Home, told by the page, `native-notices.js`; the Offline dialog and signed-out still the page's). The server's notices: an empty library, no rooms, a folder gone (forget it); the update toast (the server's update, and the app's own, Update or Later with the notes); the Offline dialog; signed out → sign-in | `server-notice`, `updater`, `check-update`, `app-update-bridge`, `android-app-update` · ~500 |

### B. Labels, the services, the card, the editor

| Item | What | Page |
|---|---|---|
| B1 | **Built (item 71)** (`LabelsScreen.kt`, `LabelSheets.kt`, a label's albums a `WallScreen` of kind `label`). Labels: the list (find, #–Z order, the scan log, rescan), select and merge, unmerge, a label's albums (its order and minimum from Settings), the logo sheet (Discogs candidates or a pasted address) | `labels`, `labels-list`, `labels-albums` · ~935 |
| B2 | **Built (item 73)** (`ServiceBrowserScreen.kt`; an album opens the native album page, as the page's opens its own). The Qobuz and Tidal browsers: the tabs, search, the artist strip and head and their albums (Load more), the album's page, favourite, open in the library, play | `service-browser`, `-rows`, `-views`, `service-browsers` · ~1,100 |
| B3 | **Built (item 70)** (`PitchforkScreen.kt`; Find on Qobuz opens the app's Qobuz browser, seeded, since item 73). Pitchfork: the lists, a review, the find buttons | `pitchfork` · ~230 |
| B4 | **Built (item 75)** (`ShareSheet.kt`, `ShareCardPainter.kt`, core `ShareCard.kt`; from the album page and Now playing; Copy image stays the page's, as Android's clipboard can't hand a picture to another app). The Share card: the card drawn (sharecard.js's painting in Kotlin's Canvas), Save, Share and Copy through the app's own sharing, the service links with hold-to-prefer, If you like this | `share-card`, `-links`, `-suggestions`, `sharecard.js` · ~1,400 |
| B5 | **Built (item 74)** (`AlbumEditSheet.kt`, `AlbumEditParts.kt`; a sheet over the native album page, its own window so the keyboard lifts it). The album editor and the matcher: a cover found, pasted, removed or kept; title, artist and year with their "was"; MusicBrainz candidates, a barcode or a link; save, undo all | `album-editor`, `album-editor-match` · ~700 |

### T. Settings (the whole tree; one item a pane, in this order)

| Item | What | Page |
|---|---|---|
| T1 | **Built (item 76)** (`SettingsScreen.kt`, `SettingsPanes.kt`; the panes not yet native open on the page alone, their Back coming back to the app's list). The frame: the list, a pane and the way back, the version in the foot; then Account (devices, revoke, sign out, change the password through `Srp`) and API Keys (each with its check) | `settings`, `settings-views`, `settings-home`, `settings-account`, `settings-info` · ~700 |
| T2 | **Built (items 78, 80)** (`SettingsSetup.kt`: Smart Picks, Record labels, UI Settings, Wall Display, Shelf; `SettingsShareAway.kt`: Share Card, Away from home). Setup's small panes: Smart Picks, Record labels, UI Settings (text, title, tile, layout), Wall Display, Shelf, Share Card, Away from home (the server's Tailscale; the phone's test) | `settings-views`, `settings-ui`, `ui-settings`, `settings-services` (display, depth), `settings-away`, `features.js` · ~500 |
| T3 | **Built (item 81)** (`SettingsHome.kt`, core `HomeRowsSettings.kt`; native Home laid out from the answer at once). Home Screen: the rows shown and hidden, dragged into order; the greeting and Random Album switches | `settings-home` · ~200 |
| T4 | **Built (item 87)** (`SettingsServices.kt`, core `ServiceSettings.kt`; each change on the app's lane of changes, `ServerWrites`). Services: Qobuz (sign in, quality, favourites and purchases, update now, sign out), Tidal (the device code, cancel, quality, favourites, update, sign out) | `settings-services` · ~300 |
| T5 | Music Folders: the server's (added through the folder browser, removed, missing or unreadable) and the phone's own folder | `settings-folders`, `android-downloads` (the local folder block) · ~300 |
| T6 | Audio Devices: the list (hide, look again), the zone chosen, Waveform; a device's page: name, on or off, radio, fixed volume, capabilities, about, levelling, DSP (the bands and their curve, `biquad.js` in Kotlin), headphones (AutoEq), the USB DAC (direct, limit, DSD mode, diagnostics), forget | `audio-devices`, `-page`, `-dsp` · ~815 |
| T7 | Library Scanner: identify and its night window, the CPU priority, the MusicBrainz pack, ReplayGain; the proposed, applied and unidentified lists with their actions; the cleanup | `settings-scanner`, `-scanner-albums` · ~450 |
| T8 | Downloads (the app's: quality, Wi-Fi only, the limit, the folder, the stream cache, automatic downloads, offline mode, the list with remove and play) | `android-downloads` · ~390 |
| T9 | Backup & restore (the parts, a passphrase, to the server or a file, the list with download, delete, restore) and Updates (the server's check and install; the app's row) | `settings-backup`, `check-update`, `android-app-update` · ~450 |

### N7. Offline, and the WebView's end

| Item | What |
|---|---|
| O1 | Offline natively: the native screens read `DownloadStore` and `LocalMusic` themselves when the server is away; `OfflineApi` and `OfflineSite` (the page's copy in the APK) go; `DownloadsActivity` (a View screen, not Compose) is replaced by the native Downloads pane and Home's rows |
| O2 | The WebView's end: with every surface native, `MainActivity`'s page frame goes (`PageFrame`, `PageGuard`, `PageCurtain`, `PageRelay`, the JavaScript bridges, `native-handoff.js`), the preview switches go, and the app opens on native Home. The page stays on the server for browsers and the iPhone |

### Not the app's

The wall display (`/display`) and the Shelf (`/shelf`) are screens for a screen on the wall, not a phone; the
login page is `SignInActivity` already; the desktop's own parts (the mini player dragged, Now playing's
reduced size, the keyboard) are marked `only: page` in the contract, with why. Nothing else is left out.

### Keeping the two the same

The rule from N2 on stays the rule for every screen above, and is machine-held (`docs/specs/native-parity.md`):
a feature goes into `screens.json` first, then onto both sides in the one change; the page's test and the
app's gate fail when either side differs; a screen in preview may lack items only from a list that only
shrinks; the colours are held to `style.css` by `ShellTest`, the data to the server by the golden recording.
So "implemented and maintained" is not a promise but a gate: a page change that leaves the app behind does
not merge.

### Order and size

F1 to F3 first; then N4, N5, N6 (the screens used every day), then P, R, B, T, and O last. In practice (item 51)
the wall came first: nothing of the frame's top bar can be seen until a native wall stands under it, and the row
and the mini player are native already, so the frame's pieces are built with the first screen that shows each
(the wall's heading and Back with L1, Focus and Sort with L2) and F1 becomes the routes' restructuring once Home,
the Library and Search are all native. About forty items,
most a day or two each at the cadence of items 35 to 45; Settings (T) is the largest at nine, the Share card
(B4) and the Audio Devices page (T6) the largest single screens. The page's lines in the tables are the
proxy: about 17,000 of its 19,700 remain to be drawn natively.
