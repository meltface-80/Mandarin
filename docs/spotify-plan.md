# Spotify Lossless in Mandarin — the plan

Bug list item 142 and those after it. The owner's ask: Spotify as a streaming service in Mandarin, as Qobuz and Tidal
are, its favourites part of the library — and **lossless, or not at all**.

## Why Spotify Soloist

Spotify streams lossless (FLAC, up to 24-bit/44.1 kHz, on plans that include it) only to its own apps — and, since
August 2026, to **Spotify Soloist**, its own headless Connect player for Linux. Nothing else gets it:

- **librespot** (Spotty, SpotOn, Music Assistant's librespot path, every Connect speaker built on it) gets Ogg Vorbis,
  320 kbps at best. SpotOn's "FLAC" is that, converted. Spotify has said librespot may not implement lossless.
- The **Web API** never streams audio; the Web Playback SDK is a browser's, DRM'd, and lossy.

So Mandarin runs Soloist itself and plays what it plays. That is how those who have done it do it:

| Project | How it gets Spotify Lossless | What Mandarin takes from it |
|---|---|---|
| [Mandarin DAC Bridge](https://github.com/meltface-80/Mandarin-DAC-Bridge) (the owner's own, C#) | Soloist into a private PulseAudio with no sound card, only a pipe sink at S32/44.1 kHz; the pipe read at the DAC's pace | The whole of it: the download, the private PulseAudio, the pipe reader, the WebSocket client, the log hygiene (the key never repeated) |
| [LMS_Soloist](https://github.com/denieuwevorst/LMS_Soloist) (Lyrion) | Soloist into a null sink or a pulse shim; ffmpeg encodes to FLAC/MP3; a small HTTP relay serves the players | The live stream to network players, auto-play when Spotify starts, controls forwarded (but it captures 16-bit: Mandarin keeps 24) |
| [spotifast-lossless](https://github.com/klNuno/spotifast-lossless) (Rust) | Soloist with a libpulse shim; downloads and refreshes the build itself | The CDN download and the 90-day refresh; pairing through the Spotify app; proving the samples lossless |
| [SpotOn](https://github.com/stiefenm/spoton) (Lyrion) | librespot: lossy | The Web API under the February 2026 rules (Dev Mode limits, the new library endpoints, search capped at 10), and the HTTPS sign-in page that hands the code to a home server |
| [Music Assistant](https://www.music-assistant.io/music-providers/spotify/) | Soloist | Its open issues: about 5 s from Next to the new song on Sonos and Chromecast; Sonos groups through Connect |

## How it works

```
 Spotify app (or, later, Mandarin) ──Connect / Web API──▶ Soloist "Mandarin" (in Mandarin's container)
                                                              │ libpulse
                                                              ▼
                                       private PulseAudio: no sound card, a pipe sink, S32 LE 44.1 kHz stereo
                                                              │ named pipe, read by Mandarin
                                                              ▼
                      Mandarin: one live stream, /stream/spotify/live.flac, FLAC 24-bit (16-bit where the device takes no more)
                                                              │
                                     the room Spotify plays in: a Sonos group, a UPnP renderer, a sound device
 Soloist's WebSocket (127.0.0.1) ──▶ Mandarin: what plays (title, artists, album, cover, position), playing/paused/idle;
                                     Now Playing's controls ──▶ back to Soloist
```

- **Lossless, carried exactly.** Spotify's FLAC is 16- or 24-bit at 44.1 kHz; PulseAudio hands it on as 32-bit
  samples, untouched (no resampling: the sink is at 44.1 kHz), and Mandarin encodes them to FLAC at 24 bits — the
  low byte is always zero, so nothing is lost. Soloist's volume is held at 100%. Mandarin says *Lossless* only once
  the samples show it: half a second of sound with every sample on the 24-bit grid (decoded Ogg Vorbis lands
  anywhere), 24-bit when the bits below the 16th are in use; one sample off it, and it says *Lossy*. Heard afresh
  each time Soloist starts.
- **Lossless asked for.** Soloist plays Ogg Vorbis at 160 kbps, normalised, unless the account's prefs say otherwise
  (`settings/Users/<id>-user/prefs`, as spotifast-lossless writes them). Mandarin writes lossless (5) for both kinds
  of network and normalisation off before every start, and the first time a phone signs an account in, starts
  Soloist again once to take it up. On a plan without lossless Spotify plays what it may, and the samples say so.
- **One room at a time.** One Spotify account plays on one Connect device at a time: that's Spotify's rule. The
  room Spotify plays in is a setting (Settings → Services → Spotify), and changes when Mandarin moves the music.
- **Soloist itself** may not be redistributed. Mandarin downloads the official build for its processor from
  Spotify's CDN (`soloist-builds.spotifycdn.com`) into `DATA_DIR/spotify/soloist`, and replaces it before its 90
  days are up. It needs glibc 2.38: Mandarin's image is Debian 13 from item 142.
- **Your own Soloist API key**, from Spotify for Developers (Premium). It goes to Soloist on its command line, so
  the key is never logged or shown again: Soloist's own log has it taken out, as DAC Bridge does.
- **Signed in by the Spotify app.** Soloist keeps an account only when Spotify's own app signed it in: the first
  time, pick "Mandarin" in the Spotify app's devices, on the same network. Mandarin's container is on the host's
  network already (Sonos needs it), so Spotify's discovery reaches it.

## The builds

1. **Item 142 (this one): Spotify Connect into Mandarin, lossless.**
   Image on Debian 13 with PulseAudio and libatomic. Soloist downloaded and kept current; supervised (restarts,
   back-off, its log kept and cleaned of the key). The private PulseAudio and the pipe; the live FLAC stream; the
   WebSocket (signed in, active, playing/paused/idle, track, position, volume). When Spotify starts playing on
   "Mandarin", the chosen room plays the live stream; pause and stop follow; Now Playing shows Spotify's track,
   artists, album and cover, and its play/pause/next/previous go back to Soloist. Settings → Services → Spotify (the
   page and the app): the API key, Download/Update Soloist, the room, the device name, and a status line (the build
   and its date, signed in or waiting for the Spotify app, playing, lossless proven). Seek goes back to Soloist too.
   A phone is not offered as Spotify's room yet: the phone's player keeps what it streams in its cache, which an
   endless stream would fill. Tested end to end with stand-ins for Soloist, PulseAudio and Spotify's CDN
   (`test/StandIns`, `SpotifyTests`): the download, the restart for lossless, the proof, the FLAC stream, the key
   never logged.
2. **Item 143: your Spotify library in Mandarin.** Sign in to the Web API with your own Client ID (Development Mode:
   Premium, up to 5 users, a personal app is that), through an HTTPS page on Mandarin's GitHub Pages site that hands
   the code back to the server (Spotify allows only HTTPS or loopback addresses). Saved albums, Liked Songs (as their
   albums) and followed artists kept in the library as Spotify albums, as Qobuz's and Tidal's favourites are;
   playlists as playlists; a heart that saves to Spotify (PUT /me/library).
3. **Item 144: Spotify's catalogue in Mandarin, and playing from it.** Search (ten at a time, the API's limit), an
   artist's albums, an album; Play starts it on Mandarin's Soloist through the Web API (`PUT /me/player/play` with
   Soloist's device id), so Mandarin's own Play, Queue and Shuffle work on Spotify albums.
4. **Item 145: the rest.** Spotify albums in the walls, Focus and artist pages; Spotify's queue shown as the queue;
   moving the music from room to room; no downloads to the phone for Spotify albums (Spotify allows none);
   measuring and shortening the time from Next to the new song.

## What could go wrong

- **Spotify's terms.** Soloist is offered for DIY setups; capturing its sound for your own speakers is what DAC
  Bridge, LMS_Soloist and Music Assistant do, but Spotify hasn't said it's allowed. Mandarin never keeps Spotify's
  audio. Not legal advice.
- **Soloist is new.** Its builds expire every 90 days, its API can change, and Spotify could withdraw it.
- **Latency.** Pause and Next reach the room after its buffer: a second or few on Sonos.
- **Sonos and an endless FLAC stream.** Mandarin's other music is files of known length; this is a live stream.
  Item 142 is where it is tried on each kind of room.
