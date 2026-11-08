# Changelog

## v0.3.2

- Fixed - the Bridge's port took changes from anything: it has no sign-in (a Pi just flashed has no Mandarin to sign in to), and it read any request's body as JSON, so a web page open in a browser on the home network could, with a plain form's POST and without the browser asking first, rename it, change its DAC or DSD mode, move a Raspberry Pi to another Wi-Fi network, start a recording of what the DAC is fed, or have a Linux or Pi Bridge install an older release. Now a change is taken only as JSON (application/json), which a page on another site can't send without the browser asking first, and the Bridge never says yes, and never from another site where the browser names where it comes from. Mandarin and the Bridge's own page send both already (item 352)
- Fixed - an update is never to a release older than the one running, on Android, Linux and the Pi: an older one may lack what a newer one fixed (item 352)
- Improved - Mandarin Bridge is 0.3.2

## v0.3.1

- Fixed - the Linux Bridge (and the Pi's) couldn't be updated from Mandarin's Settings → Updates: it asked GitHub without a User-Agent, which GitHub refuses. It now names itself, and an update that fails says why in words (item 327). A Bridge installed before this is installed again by hand once
- Improved - Mandarin Bridge is 0.3.1

## v0.3.0

- Fixed - the Linux Bridge (and the Pi's) sent DSD as DoP to a DAC that Linux offers native DSD: Linux 6.x lists a raw-DSD altset as "Format: SPECIAL DSD_U32_BE", and the Bridge read only the line's first word; it now reads every format the line names, native DSD up to DSD512 (item 325)
- New - the Linux Bridge (and the Pi's) says when the computer's kernel holds back a DAC's native DSD (item 323): it reads the DAC's USB descriptor, and where it says native DSD (as Mandarin Bridge for Android reads and plays it) and the kernel offers only PCM, so that DSD goes as DoP, its page, its log and /dac.json give the modprobe line that has the kernel offer it (`options snd-usb-audio vid=… pid=… quirk_flags=0x8000`, QUIRK_FLAG_DSD_RAW for that DAC alone)
- New - the Bridge is played one continuous stream of PCM by Mandarin over SlimProto (item 322): Mandarin decodes each track (and upsamples it, where its Output says) and sends the samples alone, one track on into the next while they are of one rate and depth, the format said in SlimProto's strm; the Bridge only plays what comes, its DAC never let go between tracks. Its hello says it takes it (ContinuousPcm=1); Mandarin tells it each track as it comes to it, for its screen, notification and page. A DSD track still comes as its file
- New - a change of rate between two tracks (16/44.1 after 24/96, PCM after DSD) is given half a second of silence at the new rate before the music, so the DAC settles without a click; the same rate, nothing between them, as before (item 322)
- Fixed - the Android Bridge was a new device to Mandarin each time its app was installed again (its identity made at random): it is now made from the device's Android ID, the same for the app on that device after a reinstall (item 321)
- New - the Android Bridge is a SlimProto player (as Squeezelite is), where it was a UPnP renderer: it finds Mandarin on the network by itself (port 3483), connects, and plays what Mandarin sends it, one track on into the next, gapless, as before. Its hello tells Mandarin its DAC's highest rate and where its own page is, so Mandarin reads its DAC (/dac.json), offers its updates and reads its log as before (item 315)
- Improved - Mandarin keeps what it knew of the Bridge as a UPnP renderer: the name you gave it, switched on or off, and its settings (item 315)
- Improved - the screen says whether Mandarin has been found, at which address, and when it was last heard from; Restart the Bridge and the rest say "the Bridge" where they said "the renderer" (item 315)
- Improved - UPnP is gone from the Android Bridge: no description, no SOAP control, no events, no SSDP (item 315)
- New - the Linux Bridge, and the Raspberry Pi's, are SlimProto players too: they find Mandarin on the network by themselves, or are pointed at it (`--server <address>`), and play through Mandarin's audio engine as before, gapless, bit-perfect; Mandarin keeps the name and settings it had for them as UPnP renderers. Their page says which Mandarin plays them and when it was last heard from. UPnP is gone from them as well (item 316)
- Improved - Mandarin Bridge is 0.3.0

## v0.2.3

- Fixed - the Android Bridge let go of the DAC between two tracks and took it again (35 ms, the DAC locking again to DSD256), dropping the last of the track before and starting DoP's marker over: now a track that goes to the DAC as the one before did follows on in the same stream, gapless, as the Mandarin app's USB direct does too (item 304)
- Improved - Mandarin Bridge is 0.2.3, on Android, Linux and the Raspberry Pi alike

## v0.2.2

- Fixed - Google Play Protect called the Android Bridge harmful: it could install its own update without asking. An update from Mandarin is a notification on the device now, whose tap downloads it in the browser, and Android's installer asks; the Bridge holds no permission to install apps (item 297)
- Improved - Mandarin Bridge is 0.2.2, on Android, Linux and the Raspberry Pi alike

## v0.2.1

- Improved - Mandarin Bridge is 0.2.1, on Android, Linux and the Raspberry Pi alike: the Linux Bridge (and the Pi's) takes the same version as the app, where it said the server's
- Improved - the app is Mandarin Bridge (it was Mandarin USB): the name on the screen and on the network, the APK (Mandarin-Bridge-<version>.apk) and its test build (the test-bridge pre-release); it installs over Mandarin USB and keeps its settings, and Mandarin knows an app not yet updated as the same renderer
- New - a recording of exactly what the DAC is fed, on request (POST /capture, then /capture.wav and its sidecar): the evidence for Mandarin's bit-perfect check, written as SQ-tool writes a USB capture
- Fixed - the driver from Mandarin's dev (its PR 602): every sample reaches the DAC as it is; a 24-bit sample went one step low in a 32-bit slot, and a 32-bit stream lost its lowest 8 bits
- Improved - Mandarin sets the renderer up from the DAC alone (with Mandarin's change on dev): /dac.json's depths are every one the renderer takes, up to the DAC's widest format (16-bit tracks for an SMSL SU-1, whose formats are 24 and 32), the DAC's own formats under dac_bits; and any change to what is said of the DAC (its depths, DSD mode, volume control, fixed) is a new description address, announced at once, not only a change of rates
- New - the app is a UPnP MediaRenderer: no sign-in; Mandarin (or any control point) finds it on the network and plays to it, gapless, with events; the Mandarin-zone protocol of 0.1.0 is gone
- New - what the DAC takes is advertised: a raw-PCM ProtocolInfo entry per sample rate (Mandarin reads them), the containers Mandarin sends, DSD where the DAC takes it; everything, and what plays now, at /dac.json; a DAC plugged in or taken out is announced afresh
- Fixed - on a FiiO R7 the driver took the R7's own DAC, which sits on a USB bridge inside and is listed first, never the DAC on the port: the DAC plugged in is chosen by itself now, and the screen offers the choice when there is more than one (the driver from Mandarin's session branch until that lands on dev)
- Fixed - /dac.json and the root page answered "Player is accessed on the wrong thread": the player's state is read on its own thread now, so Mandarin's read of the DAC's capabilities and the ✓ work
- Fixed - nothing played on the R7: the sink that refuses Android's mixer claimed every format, so ExoPlayer skipped the FLAC decoder and handed the USB driver raw FLAC; it claims raw PCM only now
- New - the device is held awake (CPU, Wi-Fi, multicast) while the renderer runs; the screen may go off
- New - start with the device, keep the screen on while in front, and a one-tap request to leave Android's battery optimisation
- New - the DAC's page: what it takes, what it is being fed, DSD mode, fixed volume, the volume limit, diagnostics to copy
- New - the driver and Mandarin's core module copied verbatim from Mandarin (`mandarin/`), with a nightly workflow that copies them afresh, builds, and opens a pull request when they changed
