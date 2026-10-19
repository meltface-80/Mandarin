# Plan: the Android app as a full native app, not a WebView

Status: plan (bug list item 17), written v1.0.7. N0 built (bug list item 21): `NativeShell.kt`, `Shell.kt` in `core`. N1 built (item 22): `LibraryClient.kt`, `Library.kt` in `core`, held to the server by `test/golden/android-api.json`. N2 in preview (item 23): `NowPlayingScreen.kt`. Each native screen is held to the page's by the screens contract (item 25, `docs/specs/native-parity.md`); N2 lacks nothing of the page's since item 29, its Queue tab. N3's album page is in the contract (item 30), its native screen to come.

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

- **UI**: Jetpack Compose (Material 3, dynamic colour off; Mandarin's own palette from `style.css`'s tokens).
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
