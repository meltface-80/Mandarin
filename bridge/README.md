# Mandarin Bridge

Mandarin's renderer for a USB DAC on a device of its own (once called Mandarin USB, item 281): on Android, in
`android/` (this page); on Linux, in [`linux/`](linux/README.md); and as a Raspberry Pi image, in [`pi/`](pi/README.md): flash it, plug in
the DAC, set it up from its own page.

On Android, an app with one job: to be a UPnP renderer that plays through a USB DAC, bit-perfect, with
[Mandarin](https://github.com/meltface-80/Mandarin)'s own USB Audio driver — and to keep the device it runs on awake
while it does.

Made for a FiiO R7 feeding a small DAC over USB. Mandarin finds the renderer on the network by itself, reads what the
DAC takes, and sends each track accordingly: 16/44.1 as it is, hi-res as it is, DSD as the DSF or DFF file itself, or
upsampled on the server as far as DSD256 when the device's output settings say so. The app hands it to the DAC
untouched: no mixer, no resampling, no DSP, no volume levelling.

The driver is **Mandarin's**, not a copy that drifts: this app lives in Mandarin's repository (`bridge/`) and
builds straight from Mandarin's own driver files and `:core` module (see [The driver is Mandarin's own](#the-driver-is-mandarins-own)),
so a change to the driver is one pull request that both apps build against.

## What it does

* **A UPnP MediaRenderer.** Nothing to sign in to: the app announces itself (SSDP), Mandarin lists it in Settings →
  Audio Devices under the name you give it ("FiiO R7 USB"), and plays to it over AVTransport like a WiiM or a Chord
  Poly, the queue kept on the server, the next track handed over ahead (SetNextAVTransportURI) so tracks join
  gapless, changes sent back as UPnP events. Any other UPnP control point can play to it too.
* **What the DAC takes, advertised.** The renderer's ProtocolInfo lists a raw-PCM entry for every sample rate the DAC
  takes (`audio/L16;rate=…`, `audio/L24;rate=…`), the containers Mandarin sends (FLAC, WAV, AIFF, MP3, AAC, ALAC,
  Ogg, Opus), and the DSD types where the DAC takes DSD natively or as DoP. Mandarin reads the rates from those
  entries; `/dac.json` on the renderer says everything — rates, depths, DSD multiples natively and as DoP, the
  volume control, and what is being fed right now — for Mandarin to read in full (see below). When a DAC is plugged
  in or taken out, the description's address changes and the renderer announces itself again, so a control point that
  caches descriptions reads the new one.
* **Bit-perfect out of the USB port.** Mandarin's USB Audio Class 1 and 2 driver (`UsbDriver`, `UsbDac`,
  `UsbAudioSink`, `usb_jni.cc`) claims the DAC from Android, sets its clock to the track's rate, and feeds it PCM at
  its own depth, paced by the DAC's feedback. DSD goes natively on the DAC's DSD alternate setting or as DoP.
* **USB or nothing.** Where Mandarin's app falls back to Android's mixer (no DAC on the port, a format the DAC
  hasn't), this one stops with ERROR_OCCURRED and says why on its screen, then plays on by itself when a DAC is
  plugged in.
* **Never asleep.** The renderer is a foreground service holding a CPU wake lock, a high-performance Wi-Fi lock and
  a multicast lock from its start to its stop, so the R7 never dozes between tracks or overnight. The screen may go
  off; the device stays up. Optional: keep the screen on while the app is in front, start the renderer with the
  device, and a one-tap request to take the app out of Android's battery optimisation.
* **The DAC's page.** What the DAC says about itself (class, rates, depths, native DSD, volume control, the clock
  now), what it is being fed and how (feedback, underruns), the DSD mode (native, native with words reversed, DoP,
  PCM from the server), fixed volume and the volume limit — the same choices as Mandarin's own app — and diagnostics
  to copy into a report.

## Setting it up on a FiiO R7

1. Install the APK from Mandarin's [Releases](https://github.com/meltface-80/Mandarin/releases): a numbered
   `mandarin-bridge-v…` release, or the rolling **test-bridge** pre-release's `mandarin-bridge.apk`, which is `dev` as
   it is now. Sideloading needs
   "Install unknown apps" for the browser or file manager you fetch it with.
2. Open Mandarin Bridge once. It starts the renderer, and keeps it running.
3. Plug the DAC into the R7's USB port. Android asks once whether the app may use it; tick "always" so it doesn't ask
   again. The DAC's page fills in.
4. Optional, under Keep awake: **Turn off** battery optimisation, and keep **Start the renderer when the device
   starts** on. In the R7's own settings, set the screen timeout as you like it.
5. In Mandarin, **Settings → Audio Devices**: the renderer is listed by its name; switch it on. There is nothing to
   tick: the rates, depths and DSD come from the DAC itself (below). Choose Original or upsampled output, then pick it
   as the speaker and play.

**Volume.** A DAC with a USB volume control (headphone DACs mostly) is driven by Mandarin's slider through
RenderingControl, starting at 10% whenever it is plugged in, never above the limit set on the DAC's page; the R7's
volume buttons move it while the app is in front. A DAC without one — a line-out DAC into an amplifier — is on
**Fixed volume** by default: full level, bit-perfect, the amplifier's knob for the volume. Mandarin reads which it
is from the app and shows no slider for a fixed one (an older Mandarin: set the device's volume to Fixed on its page).

**The R7's own DAC.** Not used. This app plays through the USB port only; for the R7's internal DAC, use Mandarin's
own Android app on it.

## What Mandarin sees of the DAC

The app says everything about the DAC at `/dac.json`, and Mandarin (on `dev`, unreleased) takes the device at its
word, as Roon does a Roon Ready device: the rates, depths and DSD the DAC takes are on, nothing else is, and there is
nothing to tick. Ticks made by hand before no longer override it; a tap on a chip still turns that one off. The volume
follows the DAC: fixed where it has no USB volume control (or is set to Fixed here), Mandarin's slider where it has.
What it feeds the DAC now is `/dac.json`'s `now`: the `rate`, the `bits` of the words the DAC is opened at, `kind`
(`pcm`, `dop`, `dsd`) and the DSD multiple, and how its level is set (`volume`: `fixed`, `dac` for the DAC's own
control, `software`; `level`; `untouched`: whether the samples reach the DAC unchanged). Now playing's signal path
says exactly that, as the Bridge's word (item 287): "PCM 44.1 kHz, the 16-bit samples padded to 32 bits for the DAC,
fixed volume: the samples untouched — as Mandarin Bridge reports it", and the track's ✓ only where it is the format
sent and the Bridge says the samples go untouched (item 289); an older Bridge, which says nothing of them, has none.

The depths are those the renderer takes: every one up to the DAC's widest format, so a DAC with 24- and 32-bit
formats (an SMSL SU-1) is sent 16-bit tracks as they are, and the app gives them to the DAC at 32 bits (`dac_bits` says
the DAC's own formats). Anything said of the DAC changing — another DAC plugged in, DSD mode, fixed volume — changes
the description's address and is announced at once, so Mandarin reads it again within moments.

An older Mandarin reads only the ProtocolInfo: every sample rate, 16- and 24-bit, DSD64; tick the rest by hand.

## The bit-perfect check: `/capture`

Mandarin's server checks that the DAC was given exactly what it sent (its SQ-tool comparison). The app's part is
the evidence: on request, a recording of exactly what it fed the DAC, made from the bytes the USB driver's stream
took (`UsbDriver.tap`), after every conversion the app makes, so it holds the very words the USB transfers carry. It
runs only when asked, from a few seconds to two minutes.

| Request | |
|---|---|
| `POST /capture` `{"seconds": 30}` | Starts one, from the next byte the driver takes: `202` and the state. `409` while one runs, or with no DAC on the port. |
| `GET /capture` | `state`: `idle`, `armed` (no stream yet), `recording`, `finishing`, `done` or `failed` (`reason` says why), and `frames`, `rate`, `channels`, `container_bits`, `kind` so far. |
| `GET /capture.wav` | The recording, once `done`. |
| `GET /capture.wav.json` | Its sidecar. |
| `DELETE /capture` | Stops it. What was recorded is finished and kept. |

`/dac.json` says `"capture": "/capture"` where the app has it.

The WAV is written the way SQ-tool writes its own USB captures: `WAVE_FORMAT_EXTENSIBLE`, the container the DAC's
slot (16, 24 or 32 bits), the valid bits the DAC format's, and the samples as the DAC took them (left-justified, so
a 16-bit track in an SU-1's 32-bit slot reads as the same values as the file). DoP is PCM framed as it went; native
DSD is the DSD words as they went, `dsd: true`. SQ-tool's `read_wav` reads it as it is.

The sidecar's `capture` has `method` (`usb-driver`), `rate`, `channels`, `container_bits`, `valid_bits`, `dsd`,
`kind` (`pcm`, `dsd`, `dop`), `dsd_setting` (`native`, `native_le`, `dop`, `pcm`), `frames`, `seconds`, `started`,
`stop_reason`, `interruptions` (each `{frame, seconds, why}`: a flush, where a seek threw away bytes taken but not
played), `usb` (`underruns` and `errors` while it ran, `dac_rate_set`, `feedback`), `device` (`/dac.json`'s DAC),
and `track` (`uri`, `position_ms` when it started). A change of the stream's format (another rate, DSD after PCM)
ends it, as it does SQ-tool's.

## The driver is Mandarin's own

The app builds against Mandarin's files where they are in this repository, never a copy of them:

* `android/app/src/main/java/com/musicd/server/android/` — `UsbDac.kt` (the DAC found and read), `UsbDriver.kt` (the
  stream), `UsbAudioSink.kt` (the sink under ExoPlayer), `DspSink.kt` (every decode as float; with the DSP off and no
  gain, untouched), `DsdExtractor.kt` and `DsdRenderer.kt` (DSF and DFF to the sink), and
  `android/app/src/main/res/xml/usb_device_filter.xml` (which USB devices Android offers the app for): listed in
  `bridge/driver-files.txt`, put beside the app's own sources at build time (`app/build/mandarin`).
* `android/app/src/main/cpp/usb_jni.cc` — the native side (usbdevfs ioctls, isochronous transfers), compiled by
  `app/src/main/cpp/CMakeLists.txt` from where it is.
* `android/core/` — Mandarin's `:core` module, a project of this build (`android/settings.gradle.kts`): the app uses
  its words for the DAC's page (`UsbView`). Its tests run with Mandarin's app's.

A change to the driver is made once, in Mandarin's app, and both apps build with it in the same pull request: the
**Mandarin Bridge** workflow builds this one whenever its files, the driver's, or `:core` change. The app's own code in
`bridge/android/app/src/main/java` is written against the driver's surface — `Store`'s USB settings, `UsbDac`,
`UsbDriver`, the sinks — and nothing else; a driver change that needs something new of it fails that build. The
screen says which Mandarin it was built with (Mandarin's version and the commit). Until it moved here (Mandarin's
item 278) the app was github.com/meltface-80/Android-USB-Driver, with the driver copied in each night; its history
is there.

## Building

A standard Android Gradle project under `bridge/android/`:

```
cd bridge/android
./gradlew :core:test            # Mandarin's core tests
./gradlew :app:assembleRelease  # needs the Android SDK, NDK 27.2.12479018 and CMake 3.22.1
```

Every push that touches it builds the APK in GitHub Actions (`.github/workflows/bridge.yml`) and keeps it as a
run artifact; a push to `dev` also puts it on the **test-bridge** pre-release, at one fixed address. Builds are
signed with Mandarin's release key where the repository has the `MUSICD_KEYSTORE_BASE64` and
`MUSICD_KEYSTORE_PASSWORD` secrets (as before), else with the key committed in `app/mandarin-bridge-debug.keystore`, so
each build installs over the last. A numbered version is cut by hand: bump `versionName` and `versionCode` in
`app/build.gradle.kts`, name the version in `bridge/CHANGELOG.md`, merge, then run the **Mandarin Bridge release**
workflow with that version — it tags `mandarin-bridge-v<version>` and makes the release with every Bridge's build
(item 294): the APK, Mandarin Bridge for Linux (x64 and arm64) with an `install.sh` that fetches from that release,
and the Raspberry Pi image, each that Mandarin offers with its sidecar beside it. Nothing tags on its own.

## Updated from Mandarin

Mandarin's Settings → Updates lists every Bridge (item 291) and offers each the build published for it. Each build
published has a sidecar beside it, `<asset>.json` (`bridge/sidecar.sh`): its commit, its version and its SHA-256. The
Bridge says its own commit in `/dac.json` (`commit`, with `updates: true` and `update`, where an update is). Asked
with `POST /update {"tag": "test-bridge"}` (or `mandarin-bridge-v…`, never an address: the port has no sign-in), the
Bridge fetches that release of Mandarin's from GitHub itself, checks `mandarin-bridge.apk` against its sidecar, and
installs it with Android's package installer (`Updater.kt`). Android refuses an APK signed by another key. The first
time, Android asks on the device: to let the Bridge install apps, then to confirm, each a notification. After that,
on Android 12 and later, its updates install without a question, and `MY_PACKAGE_REPLACED` starts it again.
Mandarin Bridge for Linux does the same with `mandarin-bridge-linux-<arch>.tar.gz` (`bridge/linux` `Update.cs`).

Its log is in Mandarin's: when the Mandarin app's log is saved (Settings → Setup → Logging → Save log), the server
asks every Bridge for its own at the path its `/dac.json` names (`log`: `GET /log`, this app's last 2,000 lines of
Android's log, `BridgeLog.kt`), puts each line through the same filter as its own, and adds them after its own.

## How it fits together

```
Mandarin (or any control point)          Mandarin Bridge on the R7
  SSDP M-SEARCH ───────────────────────▶ Ssdp: answers; NOTIFY alive on start, every 10 min, on a DAC change
  GET /description.xml?caps=… ─────────▶ HttpServer → Scpd: the device, three services
  ConnectionManager.GetProtocolInfo ───▶ DacService.sink(): L16/L24 per rate, containers, DSD mimes
  GET /dac.json ───────────────────────▶ DacService.dacJson(): rates, bits, DSD native/DoP, volume, what plays now
  AVTransport.SetAVTransportURI/Play ──▶ Renderer → ExoPlayer: DsdExtractor/DsdRenderer, decoders → DspSink (float)
  SetNextAVTransportURI (gapless)                                → UsbAudioSink → UsbDriver → usb_jni.cc → the DAC
  RenderingControl.SetVolume ──────────▶ the DAC's USB volume control (or fixed)   ↳ UsbOnly refuses what the DAC can't take
  SUBSCRIBE /event/… ◀── NOTIFY ────── Events: LastChange (TransportState, URIs, Volume) to each subscriber
```

`DacService` hosts it all: the player with Mandarin's sinks, the renderer, the HTTP and SSDP servers, the wake locks
and the notification. `Renderer` is the transport; `Events` the eventing; `MainActivity` the one screen;
`BootReceiver` starts the renderer with the device.

## License

MIT, as the rest of Mandarin is (the repository's LICENSE).
