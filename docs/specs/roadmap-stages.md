# Mandarin: the next stages

**Status: agreed, stage by stage, on 30 September 2026.** Nothing here is built. Each stage is
planned in detail, its open questions put to the project owner, and coded only
once the owner is happy with it. The stages run in the order below; later ones
lean on earlier ones (3 on 1 and 2; 5 and 6 on 3's phone-side engine). Stage 4
(HQPlayer) was dropped. Stage 8 (record labels) was added once the seven were
built.

Debian bookworm's ffmpeg (6.0 in the image, 5.1 or later on any host that
follows the README) has every filter named below. The Android app is Media3
1.8.0 (ExoPlayer) in a WebView shell; the page it shows is the same one the
browser gets.

---

## Stage 1: the phone in Audio Devices, away from home

**Built in v0.5.21.**

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

**Built in v0.5.22.**

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
   server makes new files from here on; Opus downloads already on the phone
   stay as they are.
2. The app decodes Opus with Media3's libopus extension (float) and opens the
   sink in float. CI builds the extension with the NDK.
3. The app's Now playing badge reads "Opus 256 · 24/48".

### Decisions (owner)

* Existing Opus downloads on the phone stay as they are; only new ones are
  made the new way.
* The NDK build in CI for the libopus (and later FLAC) extension is agreed;
  APK size is no concern.

### Versions

One patch version.

---

## Stage 3: DSP — AutoEQ for headphones, AutoEQ and PEQ for zones

**Built: 3.2 and 3.3 (the server chain, the PEQ page for renderers) in v0.5.23; 3.1 (the phone's engine) in v0.5.24; AutoEq profiles for both in v0.5.25.**

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
* A renderer set to **Original** with DSP on is decoded, filtered and
  re-encoded FLAC at the file's own rate and 24 bits (32 where supported);
  with DSP off it is the file as stored, as today.
* Conversions are cached files keyed by track, rate and depth today; the key
  gains a hash of the DSP so two zones with different settings never share a
  file, and a change remakes the files from the next track on.
* The same AutoEQ picker, for a renderer feeding a headphone amp.

### 3.3 PEQ for rooms

* Up to 10 bands, each: type (peak, low shelf, high shelf, low-pass,
  high-pass), frequency, gain (±20 dB; none for a pass filter), Q. A response curve drawn on the page (20 Hz–20 kHz, the combined
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

### Decisions (owner)

1. **AutoEQ profiles are pulled from the AutoEq repository and stored in the
   server's database** (as an earlier project of the owner's did), with paste
   or upload of a `ParametricEQ.txt` for headphones it lacks. The app does not
   fetch AutoEQ itself: the phone's chosen profile is handed to it by the
   server (hello, and a `dsp` command on change) and kept on the phone, so it
   applies to downloads offline too.
2. **PEQ band types: all of them** — peak, low shelf, high shelf, low-pass,
   high-pass.
3. **Save applies.** No live preview; a change takes effect when saved (the
   renderer's next conversion, the phone at once).
4. **DSP is a switch per zone.** On, the chain applies; off, the zone is
   bit-perfect as today. No note about bit-perfectness on the page.

### Versions

Three patch versions in order: the server DSP module + renderer chain + PEQ
page (3.2 and 3.3 together, testable with the WiiM), then the phone engine
(3.1), then AutoEQ fetching and the picker for both.

---

## Stage 4: HQPlayer — dropped

Dropped by the owner. For the record: NAA is Signalyst's own undocumented
protocol, so Mandarin could not be or send to an NAA endpoint; what was
possible was HQPlayer as a zone driven over its port-4321 control connection,
as the LMS bridge does. Not planned.

---

## Stage 5: music files on the phone

**Built in v0.5.26.**

### Plan

* The app reads music in **the folder the user chooses** with Android's
  document picker (`ACTION_OPEN_DOCUMENT_TREE`, permission kept). Nothing else
  on the phone is read.
* The app scans tags (Media3's metadata reader handles FLAC, MP3, AAC, Opus)
  and cover art, and keeps its own small index (Room, or the SQLite it has for
  downloads).
* **In the page** it appears as the Downloads wall does: a home row and a wall
  ("On this phone"), served to the page over the app's JavaScript bridge, so
  the server needs no copy of the phone's index. Playing one is the phone zone
  playing a `content://` URI; the DSP engine of Stage 3 applies, and the
  format badge reads from the file.
* Not scanned into the server's library (a phone's files are the phone's).

### Decisions (owner)

1. **One folder, chosen with Android's document picker.** Music bought on the
   phone (a Qobuz purchase, say) sits in that folder; the server's downloads
   go in a `Mandarin` folder inside it (Stage 6). The scan reads the chosen
   folder and skips `Mandarin/`, which the downloads code owns.
2. **Kept apart.** What's on the phone is new purchases, not copies of the
   library: they play through the app for the DSP, and the owner moves them
   to the server's storage when home. No merging with the server's albums.

### Versions

Two patch versions: the index and the wall, then playback with DSP and the
merged-album behaviour if chosen.

---

## Stage 6: downloads on an SD card that outlive the app

**Built in v0.5.27** — as plain files under the music folder's `Mandarin` folder with Android's all-files access, rather than through the document API: the downloads code is file-based throughout, and the result is the same.

### Today

Downloads live in the app's private storage (`filesDir`), which Android deletes
with the app.

### Plan

* Settings → Downloads → **Storage location**: "This phone (private)" or the
  music folder of Stage 5 (on the SD card or anywhere), where downloads go
  into a `Mandarin` folder of their own. The picker's permission is persisted;
  the app writes with `DocumentFile` and plays with `content://` URIs (Media3
  does this directly).
* **Survives reinstall.** Beside the files the app keeps a `mandarin.json`
  index (album, tracks, format, server id) so a fresh install that is pointed
  at the same folder imports everything without re-downloading, and the
  server's "downloaded on this phone" state is rebuilt from it.
* Moving between locations copies then deletes, with progress, and can be
  resumed.
* Stage 5's index code is reused for the import.

### Decisions (owner)

1. A folder on an SD card that is taken out leaves its albums on the page as
   unavailable ("on a card that isn't in"); they come back with the card.
2. The private store stays the default for a new install until a folder is
   chosen.

### Versions

Two patch versions: the location and the write path, then the import.

---

## Stage 7: Listen later

**Built in v0.5.28.** "Played through" is every track of the album having a play recorded since it was put aside; a track counts as played once it is well under way (the same rule history uses), so a track skipped in its first seconds keeps the album on the list.

### Plan

* A server-side list (`listen_later(album_key, added_at)`), one per account.
* **Add** from the album view's ⋯ menu and from a long-press on a tile
  ("Listen later"); **remove** the same way or from the list.
* **Find** it: a Home row ("Listen later", newest first, in the Home Screen
  settings like the other rows), an entry in the side menu, and a wall.
* Playing every track of an album to its end takes it off the list, with an
  undo toast; anything short of that leaves it on.

### Decisions (owner)

1. **Off the list when fully played.** Every track of the album played to its
   end, in one sitting or over several; an album left at 99% or less stays.
   The server counts it from the play history it already keeps per track, so
   a Sonos room, a renderer and the phone all count.
2. **No ageing.** An album stays until fully played or removed by hand.

### Versions

One patch version.

---

## Stage 8: record labels (added 1 October 2026)

Labels were left out of Mandarin on purpose — they lived in the Roon
extension, where they were hard work because Roon never says which label an
album is on. Mandarin reads the files, so most of that work is already done.

**8.1 built in v0.5.29.** Label of the week needs three albums; the Record
label facet, the search chips and the album page all come from the one set of
label rules in lib/library/index.js, so they agree with each other and with the
Settings switch.

**8.2 built in v0.5.30.** Merges in `label_merges` (a chain is followed to its
end; merging a target carries its sources along); logos in `label_logos` and
the data folder's `labels/`, served as `label-<key>` images (lib/labellogos.js).
The background pass runs when labels are switched on, when the wall opens (an
hour apart, or when the set of labels changed) and after a merge; a miss is
remembered for a week, Force rescan forgets the misses.

**8.3 built in v0.5.31.** `label_lookups` by album key (lib/labellookup.js):
MusicBrainz's release search carries the labels with its hits, so one call
answers; Discogs' release search for the rest. The pass runs with the logo
triggers (labels switched on, the wall opening an hour apart, the rescan
buttons) and the logo pass follows it, so a label found gets its logo looked
for in the same sitting. The tag and the folder always beat a lookup.

### Today

* The scanner stores the LABEL (or PUBLISHER) tag of every track and gives
  each album the most common one (`albums.label`). Nothing is read from it.
* The page still carries the extension's whole label UI, dark: the Labels
  wall and its tiles, the label page, merge with undo, logo pick with
  candidates, the scan log, a Label of the week row on Home, and the Settings
  block (on/off, album order, minimum albums per label, force rescan, label
  from folder depth). The server answers the stubbed shapes (`/api/labels…`
  → 410) and the album JSON carries `label: null`.
* The server already has a MusicBrainz client, a FanArt.tv key setting with a
  cache, a Discogs token setting (stubbed) and the generic `cache` table.
* README lists labels under "Not in this version".

### Plan

**8.1 Labels from tags.** Real answers behind the existing routes.

* `/api/filters/labels`: every label with its album count (the minimum-albums
  setting applied on the page as before); `/api/label-albums`: a label's
  releases, alphabetical or shuffled; labels in `/api/search`; the label on
  the album page and the share card; the side menu's Labels item.
* **Label of the week**: a label with at least three albums picked from a
  seed of the ISO week, cached for the week, a Home row of its own (hidden
  while labels are off, like the other rows that hide themselves).
* **Label from folder depth**: when set, the folder at that depth under the
  music root names the label and the tag is ignored — for libraries filed by
  label, as in the extension.
* Settings → Record labels on/off (off by default), with a line saying how
  many albums carry a label tag and how many don't, so the owner can see
  whether 8.3 matters for the library.
* The not-a-label filter from the extension (artist names, "Unknown",
  "Self-released", bare years) so a bad tag doesn't make a label.

**8.2 Merges and logos.**

* **Merged labels**: a `label_merges(source_key, target_key, merged_at)`
  table; the wall's select-two-and-merge and undo as they are on the page;
  keys are the normalised name (case, punctuation, "Records"/"Ltd" and the
  like dropped), so "Blue Note" and "Blue Note Records" fold together on
  their own and the owner merges the rest.
* **Logos**, both sources, in this order: Discogs (label search → the label's
  own image; needs the owner's Discogs token in Settings) then FanArt.tv (the
  label's MusicBrainz id looked up by name, then the HD logo; the FanArt.tv
  key is already a setting). Fetched in the background when labels are turned
  on and after a rescan, rate-limited (Discogs sixty a minute, MusicBrainz
  one a second) with the scan log the page already reads. Files kept under
  the data directory and served through the image route as `label-<key>`, so
  the app caches them offline with the album art. The page's logo picker
  (candidates from Discogs, or a pasted URL) stays.

**8.3 Labels for albums without the tag.** For albums the tag and the folder
leave without a label: MusicBrainz release search (artist and title, with
label info) then Discogs. A background pass with progress, the scan log,
*rescan* (the missing ones) and *force rescan* (everything, keeping logos and
MusicBrainz ids) as the page offers. Results in a `label_lookups(album_key,
label, source, looked_up_at)` table by the album's identity, so a library
rebuild keeps them. iTunes and TheAudioDB, the extension's first passes, are
not needed: they existed because Roon gave nothing to start from.

**Android**: nothing native. Labels come through the page; offline, the app
serves the cached label pages and logos as it does artist pages and art.

### Tests

A fake Discogs and a fake FanArt.tv beside the existing fake MusicBrainz
(label search and release lookup added to it); a labels test covering tags
→ counts → label page → search → Label of the week, the folder-depth rule,
merge and undo, logos from each source with the right precedence and caching,
and the lookup pass for untagged albums with rate limiting and the log.

### Decisions (owner)

1. **All three parts** (tags, merges and logos, lookups for the untagged).
   Most of the library is Qobuz purchases, which normally carry the LABEL
   tag; 8.1 reports the count so 8.3's worth is known before it runs.
2. **Label of the week stays**, as a Home row; **label from folder depth
   stays**.
3. **Logos from both** Discogs and FanArt.tv.

### Versions

Three patch versions, one per part.

---

## Stage 9: bit-perfect USB in the Android app — the app's own USB audio driver (added 2 October 2026)

Android's audio system mixes every app's sound at one rate (usually 48 kHz)
and has no DSD, so a USB DAC never hears the file as it is. The way round it,
as USB Audio Player Pro and HiBy do, is to leave Android's audio system out:
the app talks to the DAC itself through Android's USB host access, with a USB
Audio Class driver of its own. Any rate the DAC takes, 16/24/32-bit, native
DSD, no mixer in the way.

**9.1 built in v0.5.36.** UsbDac.kt (discovery, permission, the descriptors
walked for UAC1 and UAC2, a UAC2 clock asked for its range and current rate),
usb_jni.cc (usbdevfs capabilities and bus speed on the device node — the path
the driver will stream through), the MusicdUsb bridge and the USB DAC block on
this phone's Audio Devices page.

### Today

* The app plays through Media3 into a normal Android track (DspSink over
  DefaultAudioSink): resampled by the system to its rate, dithered to the
  device's depth. "Original" is bit-perfect only by luck of the rate.
* The server sends the phone Opus 256 at 24/48 (mobile data) or the original
  file; DSD files are converted to PCM for every player (lib/stream.js).
* The app already builds native code (the Opus decoder: NDK 27, CMake), so a
  native USB driver has a home.

### Plan

**9.1 Finding the DAC.** USB host access (`UsbManager`: attach and detach,
the permission dialog, remembered per device), the DAC's descriptors read and
understood — UAC1 and UAC2: the control interface, each streaming alternate
setting with its format, channels, bit depth and the rates its clock offers —
and a native bridge (libusb built in, handed the open device's file
descriptor, the only way to isochronous transfers on Android). Audio Devices
gains a **USB DAC** page listing what the DAC offers and a *USB direct*
switch, off until 9.2. Nothing plays through it yet; this is the part that
proves the phone and the DAC can be talked to at all.

**9.2 PCM, bit-perfect.** Playback through the driver: the DAC's clock set to
the track's rate, the right alternate setting chosen, samples packed to the
DAC's depth (16/24/32), isochronous OUT with asynchronous feedback (adaptive
and synchronous DACs handled too), gapless across tracks, rate changes
between them. In the player, a Media3 audio sink that hands decoded PCM to
the driver instead of an Android track whenever *USB direct* is on and the DAC
is attached, and falls back to the Android track when it is unplugged. Volume
fixed at full on this path (the DAC's own control where it has one, as an
option later); DSP off on this path — bit-perfect means untouched — with the
badge reading *USB · FLAC 24/96 ✓* when the DAC confirms the rate. The server
sends such a phone the original file on Wi-Fi as it does now; on mobile data
Opus stays Opus (decoded on the phone, sent at 48 kHz).

**9.3 DSD.** Native DSD where the DAC offers it (UAC2's DSD alternate
settings, DSD64/128/256, the bit order the DAC asks for), DoP where it only
takes that, PCM conversion on the server as today where it takes neither. The
server gains a stream plan for USB-direct phones that sends DSF and DFF files
as they are; the app reads the DSD out of them itself.

**9.4 Living with it.** Hot-plug while playing (pause, switch sink, resume),
underrun handling and a buffer-size setting, the wake lock the transfers need,
battery note, and a diagnostics pane: transfer counts, underruns, the DAC's
descriptors as text to copy — what a report back needs when something is
wrong on a DAC I have never seen.

### What this costs

Native C with isochronous USB is the hardest code in the project, and none of
it can be run here: CI can compile it, only a phone with a DAC can hear it.
Every part lands as a build to try, with the diagnostics pane carrying the
answer back. Expect several rounds per part.

### Questions (owner)

1. The phone (model, Android version) and the DAC(s) to test with — model,
   and whether their makers say UAC2, DoP, native DSD.
2. DSD in the library: which rates (DSD64/128/256) and which files (DSF, DFF)?
3. Volume on the USB path: fixed at full (bit-perfect, the amplifier does the
   rest), or the DAC's own hardware volume where it has one?
4. DSP on the USB path: off always (bit-perfect only), or allowed as a
   choice (the DSP's float output packed to the DAC's depth — not bit-perfect,
   but the DAC's own rate)?

### Versions

Four or more patch versions, one per part, each tried on the phone before the next.

---

## Order and versions

| Stage | Versions (patch each) | Depends on |
| --- | --- | --- |
| 1 Phone in Audio Devices away | 1 | — |
| 2 Mobile-data stream | 1 (or folded into 3) | — |
| 3 DSP | 3 | 1, 2 |
| 4 HQPlayer | dropped | — |
| 5 Music on the phone | 2 | 3's engine |
| 6 SD card downloads | 2 | 5's index |
| 7 Listen later | 1 | — |
| 8 Record labels | 3 | — |
| 9 USB audio driver | 4+ | 3's player |

Stages 7 and 8 are independent and can slot in anywhere. Whether the second digit
moves (0.6.0) at the start of Stage 3 is the owner's call.
