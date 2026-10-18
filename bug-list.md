# Bug list

Each item is worked on its own branch, in this order. An item is marked **Fixed** only once the owner has tested it and said so.

Status: **Open** · **In progress** · **Ready to test** (green, waiting on the owner) · **Fixed**

| # | Item | Branch | Status |
|---|------|--------|--------|
| 1 | CI red on `v1.0.6-tests-csharp-5-suites` (PRs #255 → migration, #256 → main): `TagsFrontTests` compared files made by CI's ffmpeg against readings recorded from ffmpeg 6.1.1's files | `v1.0.6-tests-csharp-5-suites` | Ready to test |
| 2 | Android app occasionally becomes unresponsive (investigate): the page waited on the app re-reading every downloaded album's file after each track a download finished, and redrew Home's phone rows on every return to the app | `02-android-unresponsive` | Ready to test |
| 3 | Detecting new audio devices is slow: the network was searched once a minute and sound devices read every 30 s, and nothing listened when a renderer announced itself | `03-audio-device-detection` | Ready to test |
| 4 | Library grid loses its scroll position when Focus closes via "clear selection" or "show albums" with nothing selected: must return to where it was opened from, not spring to the top. Both buttons reloaded the wall from its first album even when the filters were unchanged | `04-grid-position-after-focus` | Ready to test |
| 5 | Top buttons with no top bar need a bigger touch area: missed taps hit the album below. Focus and Sort were 32px tall, ‹ 40px; each now takes taps from a little way round it, mostly below | `05-top-button-touch-area` | Ready to test |
| 6 | Home Screen: overscroll stretch/bounce at the top and bottom, on Android and in the browser: remove it. In the app it was Android's own WebView stretch, which the page's CSS can't switch off; now off. The page already stops dead in browsers, now held by a test | `06-no-overscroll-bounce` | Ready to test |
| 7 | Home Screen loses its scroll position after entering a genre and coming back: needs position memory | — | Open |
| 8 | Settings > Setup: options to turn off the greeting and the random album button; the rest of the UI moves up when either is off | — | Open |
| 9 | Side menu offline toggle closes and reopens the menu (a visible glitch): must be a silent refresh, only the switch moving | — | Open |
| 10 | Share card: remove the record label (long names run off the card) | — | Open |
| 11 | Qobuz and Tidal grids must follow the same grid settings as every other grid (column count, text size) | — | Open |
| 12 | Question, advice only: screen transition animations (navigation is fast but not always fluid) | — | Open |
| 13 | Android Home Screen search needs two taps (open, then keyboard): one tap must do both | — | Open |
| 14 | Recently played carousel should open to a grid screen (feature) | — | Open |
| 15 | Spaces can't be typed in album-grid search and in Focus text (Home Screen search is fine) | — | Open |
| 16 | Plan: iOS PWA streaming-only playback (AAC 256 vs Opus 256, cache, chunked/segmented transfer) | — | Open |
| 17 | Plan: Android as a full native app instead of a WebView | — | Open |
