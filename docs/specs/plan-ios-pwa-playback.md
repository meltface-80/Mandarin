# Plan: playback on the iPhone (the home-screen web app), streaming only

Status: plan, nothing built (bug list item 16). Written v1.0.7.

## The goal

The iPhone's home-screen Mandarin (the PWA, `public/manifest.json`, `display: standalone`) plays music **on the iPhone itself**, streamed from the server, the way the Android app's phone player does. No downloads, no offline library: streaming, with a small cache so the next track is already there.

## What's already there to build on

| Already in Mandarin | Where | Use for the iPhone |
|---|---|---|
| Opus 256 kbps VBR in Ogg, made per track, kept, the album's next two made ahead | `Downloads.cs` (`StreamOpus`, `?q=opus`) | the iPhone's main format on iOS 18.4+ |
| Range requests on every stream | `Streams.cs` (`enableRangeProcessing`) | seeking and resuming without a whole download |
| A phone as a player: `hello`, long-polled `commands`, `state` | `PhoneRoutes.cs`; the app's side in `android/core/.../Phone.kt` | the iPhone joins as a player the same way, in JavaScript |
| What to fetch ahead, on Wi-Fi and mobile data | `CachePlan.kt` | its rules ported to the page |
| ReplayGain and the player's DSP plan | `ReplayGain.kt`, `Dsp.kt`; `public/biquad.js` already in the page | levelling on the iPhone (gain only to begin with) |

## Format: AAC 256 or Opus 256?

**Opus 256 where the iPhone can play it, AAC 256 where it can't.** Both, picked by the page:

- **Opus in Ogg plays in Safari's `<audio>` from iOS 18.4** (March 2025). Before 18.4, Safari played Opus only inside a CAF file. Opus in MP4 still doesn't play in Safari's `<audio>`, and Opus in WebM is unreliable on iOS.
- The server already makes **Opus 256 in Ogg**, so on iOS 18.4+ nothing new is needed server-side: the same files as away-from-home streaming.
- For iOS below 18.4, the fallback is **AAC 256 in MP4 (`.m4a`)**, which every iPhone plays. One new conversion is needed: `-c:a aac -b:a 256k -movflags +faststart` (ffmpeg's own AAC encoder; at 256 kbps it's fine, and `libfdk_aac` is better if the image's ffmpeg has it). Kept and made ahead like the Opus ones (`?q=aac`).
- The page decides with `audio.canPlayType('audio/ogg; codecs="opus"')`. An answer of `"probably"` or `"maybe"` means Opus; anything else means AAC. It's asked once and kept.

Opus 256 is transparent to nearly everyone and smaller per quality than AAC; AAC 256 is close behind. Either is far better than the iPhone's speaker or Bluetooth needs (Bluetooth re-encodes to AAC anyway).

## "Small chunks": the choice

The name you were after is probably **HLS** (HTTP Live Streaming: a playlist of a few seconds' segments) or simply **Range requests** (asking for a file a piece at a time).

- **Recommended: whole tracks, fetched with Range requests.** Each track is one file (Ogg Opus or M4A); `<audio>` asks for it in pieces as it plays, seeks by asking for another piece, and the server already answers that. Simple, and the files are already made and kept.
- **HLS** would mean cutting every track into segments with playlists. Its gains (adaptive bitrate, live streams) don't apply to a library of files, and Safari's HLS wants AAC or fMP4 segments, so Opus would need another container. **Not worth it here**, unless gapless playback (below) needs it later.

## The cache

- A **service worker** (`public/sw.js`, new) keeps the playing track, the next two (one on mobile data), and their covers, in the Cache API, with a size limit (say 300 MB) and oldest-first eviction.
- A service worker answering media must answer Range requests itself: slice the cached file and send a `206` with `Content-Range`. A plain cached `200` makes `<audio>` refuse to seek. That's the fiddly part, about 60 lines.
- A home-screen web app's storage is counted by its own days of use, not Safari's, so one in use keeps its cache; but iOS can still clear it after a long spell unused or under storage pressure, so the cache is a help, never relied on.

## The player in the page

- One `<audio>` element plays; a second preloads the next track, and they swap at the end.
- **Gapless** albums (live sets, classical) will have a small gap at each swap with `<audio>`. Real gapless playback needs the Web Audio API with decoded buffers (memory-heavy for long tracks) or Managed Media Source (iOS 17.1+, fMP4 only). Start without it, and measure the gap on a real iPhone first.
- **Lock screen and Control Centre**: the Media Session API (title, artist, artwork; play, pause, next, previous, seek).
- **ReplayGain**: `audio.volume` can't be set on iOS (it's always 1), so levelling goes through a Web Audio `GainNode` (`MediaElementAudioSourceNode` → gain → output).

## The risk to settle first: background audio

**Audio in a standalone home-screen web app on iOS stops or turns unreliable when the app is left or the screen locks.** This has been reported to WebKit for years and isn't fixed. Specifically: playback can stop on locking, and lock-screen controls can stop working after audio has been paused for about 30 seconds. Safari itself (not the home-screen app) keeps playing in the background.

Known workaround: `display: "minimal-ui"` instead of `standalone` lets background audio carry on, at the cost of Safari's thin bar.

So **step 1 is a spike**: a test page that plays an Opus file and an AAC file on your iPhone, as a home-screen app, locked, for an album's length. Try `standalone` and `minimal-ui`. Everything else depends on what that shows.

## Stages (each its own branch, as CLAUDE.md step 4 has it)

1. **Spike** (a day): the test page above on your iPhone; formats, lock screen, background, the gap between tracks. Decide `standalone` or `minimal-ui`.
2. **AAC fallback on the server** (`?q=aac`, made and kept like Opus), with tests. Skipped if your iPhones are all on iOS 18.4+.
3. **The page as a player**: `hello`/`commands`/`state` in JavaScript, `<audio>` ×2, Media Session, the GainNode. "This iPhone" appears in the speaker picker.
4. **The service worker cache** with Range answers, and the fetch-ahead rules.
5. **Polish**: gapless playback if the spike showed the gap matters, a Settings page for quality and cache size, and a "Can't play in the background" note if `standalone` stays broken.

Sources: [MDN audio codec guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs), [Safari 18.4 web features](https://apple.gadgethacks.com/how-to/safari-18-4-hidden-web-features/), [WebKit bug 198277](https://bugs.webkit.org/show_bug.cgi?id=198277), [Apple Developer Forums: PWA lock-screen audio](https://developer.apple.com/forums/thread/762582), [What we learned about PWAs and audio playback](https://prototyp.digital/blog/what-we-learned-about-pwas-and-audio-playback).
