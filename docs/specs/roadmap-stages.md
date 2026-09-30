# Mandarin: the next seven stages

**Status: a plan, agreed stage by stage.** Nothing here is built. Each stage is
planned in detail, its open questions put to the project owner, and coded only
once the owner is happy with it. The stages run in the order below; later ones
lean on earlier ones (3 on 1 and 2; 5 and 6 on 3's phone-side engine).

Debian bookworm's ffmpeg (6.0 in the image, 5.1 or later on any host that
follows the README) has every filter named below. The Android app is Media3
1.8.0 (ExoPlayer) in a WebView shell; the page it shows is the same one the
browser gets.

---

## Stage 1: the phone in Audio Devices, away from home

### Today

* Audio Devices is **home only** by design (v0.5.0): a request from an address
  the server doesn't count as local gets `{ away: true, devices: [] }`, and every
  write on the page is refused with "Away from home, devices can't be changed".
* Over Tailscale the phone's address is a tailnet one, so the app on mobile
  data is "away", and the page is empty even though the phone is a zone the
  server is talking to (its hello and long poll are answered as normal).
* A phone is in the register (kind `phone`) while it has spoken in the last
  45 seconds; it has no on/off switch, and is named in the app.

### Decisions (owner)

* Away, the page shows **only the phone the app is on**. No other zone is
  listed or reachable away: Tailscale is for the phone, and the phone's DSP
  (Stage 3) runs in the app.
* Home is unchanged: every device, every setting, the network search.

### Plan

1. **Away, the route answers with the asking phone.** The phone is identified
   by its device token (the one the app signs in with), matched to the phone
   the register knows by that device; the list is that one entry, `away: true`
   beside it. Any other id asked for away is refused as it is now.
2. **The page** hides the search button and shows the single row, "This
   phone", opening to the phone's detail as at home; Stage 3 puts the
   headphone profile there.
3. **Writes away** are limited to that phone's own settings (Stage 3's DSP);
   everything else stays refused.
4. **Tests.** An away request from a signed-in phone lists that phone alone;
   from a browser, nothing; a scan away is refused.

### Versions

One patch version.

---

## Stage 2: what the phone plays on mobile data

### Today

* Away, the phone asks for `?q=opus` and gets **Opus at 256 kbps** (Ogg), made
  by ffmpeg with `libopus -b:a 256k -vbr on`. The same files serve Opus
  downloads. The next two tracks of the album are made ready behind it.
* **Opus is a 48 kHz codec.** libopus only encodes at 48 kHz, so ffmpeg
  resamples a 44.1 kHz file to 48 kHz on the way in (with its default
  resampler, not the SoX one the FLAC path uses), and every Opus stream decodes
  to 48 kHz on the phone.
* On the phone Media3 decodes Opus with Android's own decoder, which produces
  **16-bit PCM at 48 kHz**, and hands it to an `AudioTrack` as 16-bit. Android
  mixes at 48 kHz on nearly every phone, so there is **no second resample** for
  an Opus stream: the rate already matches. The "original" choice (FLAC over
  Tailscale) decodes at the file's rate and Android resamples 44.1 → 48 itself.
* The app's away quality is a setting (Opus or original).

### Decision (owner)

**Opus 256, for the stream and for downloads, is 24/48 end to end.** AAC is
not considered. Opus is a 48 kHz codec, so the rate is a given; "24" means no
16-bit step anywhere: the encoder is fed 64-bit float and the phone decodes to
float (24 bits and more) straight into the DSP engine and a float sink. Today
the phone's decoder is the 16-bit one, so this is the change.

### Assessment

* **Sample rate:** Opus already lands on Android's 48 kHz, which is the best
  case. Nothing to change there.
* **Bit depth:** the loss is in the depth: Android's own Opus decoder hands
  Media3 16-bit PCM. Opus itself decodes to float. Media3's **libopus decoder
  extension** decodes to float when the sink is float; it is not published
  as a ready-made library and has to be built with the NDK in CI (as the FLAC
  extension may be for Stage 3). That build is the one sure route to 24/48.
* **The encoder's own resample** (44.1 → 48 before Opus) becomes the SoX one
  at 64-bit float, the same as the FLAC path.
* **The rate under DSP (Stage 3).** With the sink in float and DSP in the app,
  the phone plays 48 kHz float into Android's 48 kHz float mixer: no resample,
  no requantise until the output device. A USB DAC is opened by Android at the
  rate Android chooses (usually 48 kHz); playing a 96 kHz file bit-perfect to a
  USB DAC needs an exclusive audio path outside Media3 and is **not** in these
  stages (noted, not planned).

### Plan

1. The Opus conversion resamples with SoX at 64-bit float (`aresample=soxr…`,
   `internal_sample_fmt=dblp`) before `libopus`. The cache name changes so the
   server remakes its files; the phone's Opus downloads are remade too (see
   the questions).
2. The app decodes Opus with Media3's libopus extension (float) and opens the
   sink in float. CI builds the extension with the NDK.
3. The app's Now playing badge reads "Opus 256 · 24/48".

### Open questions

1. Existing Opus downloads on the phone were encoded from the old resample:
   remake them (re-download, in the background, while the old ones still
   play) or leave them and only make new ones the new way?
2. The libopus extension adds an NDK build to CI (longer builds, a few MB in
   the APK). Agreed?

### Versions

One patch version.

---

## Stage 3: DSP — AutoEQ for headphones, AutoEQ and PEQ for zones

### The chain, everywhere

```
decode → 64-bit float → headroom (preamp) → [upsample, SoX 33-bit] → DSP → dither → 24-bit (32 where supported)
```

* Sample rate untouched: a zone set to Original plays at the file's rate; a
  zone set to ×2 / ×4 / Max upsamples first and the filters run at the new
  rate (the owner's order: headroom → upsample → DSP).
* Every filter is a biquad computed in double precision (ffmpeg's `equalizer`,
  `lowshelf`, `highshelf` with `precision=double` on the server; the same
  biquads in Kotlin doubles on the phone).
* **Headroom is automatic.** The profile's positive gain is measured — the peak
  of its combined response over 20 Hz–20 kHz, computed from the biquads, not
  the largest single band — and a preamp of −(peak + 0.5 dB) is applied before
  the filters. A profile that already carries a preamp (AutoEQ's
  `Preamp: −6.2 dB` line) uses its own value if it covers the peak, else the
  measured one. The page shows the headroom in use.
* Dither: triangular at 24 bits, none at 32, as the renderer path does now.
* Off for Sonos rooms. The page says so ("Sonos rooms are tuned with
  Trueplay in the Sonos app"); their code stays untouched.

### Where the settings live

Per output, in the device register (`audio_devices.settings.dsp`), so they
survive restarts and follow a device's own settings page (Settings → Audio
Devices → the device). The phone's settings live there too and are handed to
the app in its hello and on every change (a `dsp` command on the long poll).

```
dsp: {
  enabled: true,
  headphone: { source: "autoeq", id: "…", name: "Sennheiser HD 650", preamp: -6.3, bands: [...] } | null,
  peq: { bands: [ { type: "peak"|"low_shelf"|"high_shelf", freq: 105, gain: -3.5, q: 1.2 }, … ≤ 10 ] } | null,
  headroom: "auto" | number
}
```

A zone applies headphone profile and PEQ in that order when both are set;
in practice a phone has a headphone profile and a room has a PEQ.

### 3.1 The phone (Bluetooth and USB)

* **Stream untouched.** The server sends Opus (away) or the file (home) as it
  does now; every filter runs on the phone.
* **Engine.** A Media3 `AudioProcessor` in the sink's chain. The sink is opened
  in float (`DefaultAudioSink.setEnableFloatOutput`); the processor takes
  whatever PCM the decoder gives (16-bit, 24-bit, float), converts to double,
  runs preamp → biquads, and writes float. Android mixes float; Bluetooth
  (SBC/AAC/LDAC) and USB take it from the mixer.
* **Depth from the decoder.** Android's Opus decoder gives 16-bit; Android's
  FLAC decoder gives float for 24-bit files when asked (API 24+), which Media3
  asks for when the sink is float. To be **verified on a 24-bit file in the
  first build**, with the fallback of building Media3's FLAC and Opus decoder
  extensions (libFLAC, libopus; NDK, in CI) which always decode to float.
* **AutoEQ profiles.** The server fetches AutoEQ's results index once a day
  (`jaakkopasanen/AutoEq` on GitHub, `results/`), and a chosen headphone's
  `ParametricEQ.txt` on demand, both cached in the database. The page offers a
  search box ("HD 650"), a list of matches by measurement rig, and Apply. A
  `ParametricEQ.txt` can also be pasted or uploaded for headphones AutoEQ
  doesn't have. Profiles are 10 bands at most already, which is why the PEQ
  is 10.
* **Where it shows.** The phone's page in Audio Devices (Stage 1 makes it
  reachable away): headphone profile, on/off, the headroom, and a note that
  it applies to whatever the phone plays through (Bluetooth, USB, the speaker).

### 3.2 Renderers (UPnP/DLNA): AutoEQ on the server

* The renderer's conversion already runs through ffmpeg in 64-bit float; the
  DSP is more of the same filter graph:
  `aformat=dbl → volume=<preamp>dB → [aresample=soxr] → equalizer… → aresample=<dither> → flac`.
* A renderer set to **Original** with DSP on is no longer bit-perfect: it is
  decoded, filtered and re-encoded FLAC at the file's own rate and 24 bits.
  The page says so where the output is chosen.
* Conversions are cached files keyed by track, rate and depth today; the key
  gains a hash of the DSP so two zones with different settings never share a
  file, and a change remakes the files from the next track on.
* The same AutoEQ picker, for a renderer feeding a headphone amp.

### 3.3 PEQ for rooms

* Up to 10 bands, each: type (peak, low shelf, high shelf), frequency, gain
  (±20 dB), Q. A response curve drawn on the page (20 Hz–20 kHz, the combined
  curve and the headroom line), the bands as rows under it.
* Applies to UPnP renderers and to the phone (a phone can carry both a
  headphone profile and a PEQ; they run in that order).
* Headroom automatic as above.

### Tests

* The biquad maths in one shared module on the server (`lib/dsp/biquad.js`),
  tested against known responses (a +6 dB peak at 1 kHz reads +6 dB at 1 kHz,
  0 dB an octave out at Q 1.41…), and the headroom calculation against a
  profile whose overlapping bands sum above their largest.
* An ffmpeg run on a test tone with a −6 dB shelf, measured.
* The fake renderer's stream checked for the DSP hash in the URL.
* The Kotlin biquads reviewed against the JS ones by hand (no Android SDK
  here); the friend's and the owner's phones are the test rig.

### Open questions (asked when Stage 3 comes up)

1. AutoEQ from GitHub on demand (needs the server to reach github.com) or a
   bundled subset? Recommendation: on demand, cached, with paste/upload as the
   offline route.
2. PEQ band types: peak, low shelf, high shelf only, or also low-pass /
   high-pass for a subwoofer crossover?
3. Should the PEQ page have a **preview** (apply to what's playing now,
   unsaved) or is Save-then-hear enough?
4. Is a renderer set to Original with DSP on acceptable as "no longer
   bit-perfect", or should DSP force at least ×1 processing explicitly on the
   page?

### Versions

Three patch versions in order: the server DSP module + renderer chain + PEQ
page (3.2 and 3.3 together, testable with the WiiM), then the phone engine
(3.1), then AutoEQ fetching and the picker for both.

---

## Stage 4: HQPlayer

### What is and isn't possible

* **NAA is Signalyst's own protocol** and is not documented; the only NAA
  endpoints are Signalyst's `networkaudiod` binaries. Mandarin cannot be an NAA
  endpoint, and cannot send to one, without reverse engineering that would not
  hold across HQPlayer releases. **Not planned.**
* **HQPlayer can be told what to play.** HQPlayer Desktop and Embedded listen
  on port 4321 for a control connection (XML over TCP): load a URL, play,
  pause, stop, seek, volume, and status. This is what the LMS bridge the owner
  found (`SimonArnold002/LMS-HQPlayer-Bridge`) uses: LMS hands HQPlayer a stream
  URL, HQPlayer decodes, upsamples, filters and outputs to its own DAC or NAA,
  and the bridge relays transport and status. It is also how the official
  HQPlayer Client and third-party remotes work.

### Plan

* **HQPlayer as a zone type** (`HQP_` ids), beside Sonos, phones and renderers:
  Mandarin keeps the queue and gives HQPlayer one signed stream URL at a time
  (the file as stored; HQPlayer does all processing itself, so Stage 3's DSP
  is off for it and the page says so), watches HQPlayer's status for track end
  and position, and relays play/pause/next/seek/volume.
* Found by address: Settings → Audio Devices → "Add HQPlayer…" with host and
  port (no discovery to rely on).
* The friend's rig is the test bed. Before coding: which HQPlayer (Desktop or
  Embedded), which version, whether it accepts an `http://` URL with a query
  string (Mandarin signs stream URLs), and whether their HQPlayer has a
  licence for the network control API (Embedded includes it; Desktop needs the
  "HQPlayer Client" allowance). A short capture of the XML exchange from the
  friend's setup (the bridge's log, or `tcpdump` on 4321) settles the protocol
  details.
* A fake HQPlayer for the tests, as there is a fake renderer and a fake Sonos.

### Open questions

Deferred to the stage; listed above.

### Versions

Two patch versions: the control client and zone with the fake, then whatever
the friend's testing turns up.

---

## Stage 5: music files on the phone

### Plan

* The app reads music **the user points it at**: a folder chosen with
  Android's document picker (`ACTION_OPEN_DOCUMENT_TREE`, permission kept), or
  the phone's music collection through `MediaStore` (the `READ_MEDIA_AUDIO`
  permission). One or both; question below.
* The app scans tags (Media3's metadata reader handles FLAC, MP3, AAC, Opus)
  and cover art, and keeps its own small index (Room, or the SQLite it has for
  downloads).
* **In the page** it appears as the Downloads wall does: a home row and a wall
  ("On this phone"), served to the page over the app's JavaScript bridge, so
  the server needs no copy of the phone's index. Playing one is the phone zone
  playing a `content://` URI; the DSP engine of Stage 3 applies, and the
  format badge reads from the file.
* Not scanned into the server's library (a phone's files are the phone's).

### Open questions

1. Chosen folder, whole-phone music collection, or both?
2. Should albums on the phone that are **also** in the server's library be
   shown as one album (play from the phone when it's there, from the server
   otherwise), or kept apart?

### Versions

Two patch versions: the index and the wall, then playback with DSP and the
merged-album behaviour if chosen.

---

## Stage 6: downloads on an SD card that outlive the app

### Today

Downloads live in the app's private storage (`filesDir`), which Android deletes
with the app.

### Plan

* Settings → Downloads → **Storage location**: "This phone (private)" or a
  folder the user picks with the document picker on the SD card (or anywhere).
  The picker's permission is persisted; the app writes with `DocumentFile`
  and plays with `content://` URIs (Media3 does this directly).
* **Survives reinstall.** Beside the files the app keeps a `mandarin.json`
  index (album, tracks, format, server id) so a fresh install that is pointed
  at the same folder imports everything without re-downloading, and the
  server's "downloaded on this phone" state is rebuilt from it.
* Moving between locations copies then deletes, with progress, and can be
  resumed.
* Stage 5's index code is reused for the import.

### Open questions

1. When the folder is on an SD card that is later removed, the albums show as
   "on a card that isn't in" rather than disappearing — agreed?
2. Should the private location remain the default for a new install?

### Versions

Two patch versions: the location and the write path, then the import.

---

## Stage 7: Listen later

### Plan

* A server-side list (`listen_later(album_key, added_at)`), one per account.
* **Add** from the album view's ⋯ menu and from a long-press on a tile
  ("Listen later"); **remove** the same way or from the list.
* **Find** it: a Home row ("Listen later", newest first, in the Home Screen
  settings like the other rows), an entry in the side menu, and a wall.
* Playing an album through to the end takes it off the list automatically
  (Roon's behaviour), with an undo toast.

### Open questions

1. Automatic removal on a full play-through, or only by hand?
2. A limit or an age (albums fall off after N months) or keep forever?

### Versions

One patch version.

---

## Order and versions

| Stage | Versions (patch each) | Depends on |
| --- | --- | --- |
| 1 Phone in Audio Devices away | 1 | — |
| 2 Mobile-data stream | 1 (or folded into 3) | — |
| 3 DSP | 3 | 1, 2 |
| 4 HQPlayer | 2 | the friend's rig |
| 5 Music on the phone | 2 | 3's engine |
| 6 SD card downloads | 2 | 5's index |
| 7 Listen later | 1 | — |

Stage 7 is independent and can slot in anywhere. Whether the second digit
moves (0.6.0) at the start of Stage 3 is the owner's call.
