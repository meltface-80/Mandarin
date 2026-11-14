# Changelog

## v0.3.12

- Fixed - the Linux Bridge couldn't update itself on Mandarin OS, or on any computer with systemd 256 or newer (Debian 13, Ubuntu 24.10 and later): "The update couldn't be installed: mandarin-bridge couldn't be run (ErrorStartingProcess, …, Permission denied)", with the download, its checksum and its signature all good (item 415). Its service ran as a DynamicUser, and from systemd 256 a DynamicUser's data folder is mounted so nothing in it can be run, the update the Bridge fetches into it included. It runs as a user of its own now, mandarin-bridge, which install.sh makes, with the same limits as before (the system read-only but for its data folder, its own /tmp, no new privileges). Installed again, a Bridge keeps its data folder (who it is to Mandarin, its settings, its logs): systemd moves it back from /var/lib/private, and the service makes it the Bridge's. On Mandarin OS, Mandarin OS 0.1.7 does the same for the Bridge already installed. The Raspberry Pi image's Bridge runs as root, as it always has
- Improved - an update a computer won't run from the Bridge's data folder says so, and what to do (on Mandarin OS, update Mandarin OS; elsewhere, run the install line again), in place of .NET's "ErrorStartingProcess"
- Improved - Mandarin Bridge is 0.3.12

## v0.3.11

- New - the Linux Bridge (and the Pi's) records what it feeds the DAC for Mandarin's bit-perfect check and SQ-tool (item 412), as the Android Bridge does: the same /capture (a recording in one piece of up to two minutes, or a whole track in parts from the track played again), the same WAV and sidecar. The bytes are those Mandarin's audio engine hands ALSA for the DAC, after every conversion it makes: its 32-bit words, DoP under its markers, native DSD words either way round. Made only when asked, written on a thread of its own so a slow disk never holds the music up, kept in the Bridge's own data folder and let go as Mandarin fetches it. Before, Mandarin told a Linux Bridge's room to update an app that had no recording to update to
- Improved - Mandarin Bridge is 0.3.11

## v0.3.10

- Fixed - the Linux Bridge's update failed where systemd runs it (the Linux installer's service, Mandarin OS's): it has no HOME there, so .NET couldn't open its certificate stores and couldn't connect to GitHub securely, and its fallback, curl, failed as well, said only as "tar couldn't be run". With no HOME its data folder is its home now (and the installer's service sets it), so it connects as it should; and a program it can't start says which and why
- Improved - Mandarin Bridge is 0.3.10

## v0.3.9

- Improved - its log is always kept, as Mandarin's server keeps its own: in files that roll in its data folder (Logs/MandarinBridge_log.txt, then .01 to .10 older), each opening with which Bridge it is and each line dated in UTC with its level, so a restart, an update or a crash loses none of it. Before, the Linux Bridge and the Pi's kept their last 2,000 lines in memory alone, and the Android Bridge only what Android still held of the run. A crash is in it with its stack. Mandarin's server now keeps every Bridge's log beside its own too (item 389). Both Bridges
- Improved - Mandarin Bridge is 0.3.9

## v0.3.8

- Improved - security: the Linux Bridge (and the Pi's) installs an update only when it is signed with Mandarin's release key, now that there is one; an update replaced on GitHub, its checksum with it, is refused. A Bridge before 0.3.8 takes its update to 0.3.8 as before, and every one after it is checked (item 371)
- Improved - Mandarin Bridge is 0.3.8

## v0.3.7

- Fixed - a next track that couldn't be opened or read (a file gone, a stream refused) stopped the track playing there and then, with what was buffered of it: the next is read while this one plays, and its failure cut this one off. The track playing now plays out to its end, and the next's failure is said after it. The Linux Bridge and the Pi's
- Fixed - a DAC unplugged, or the network gone, was said to Mandarin as a track the DAC couldn't play, and Mandarin put the room's Output back to the last that played well. Each Bridge now says whether the track or the DAC failed: Mandarin keeps the Output for a DAC gone. Both Bridges
- Improved - Mandarin Bridge is 0.3.7

## v0.3.6

- Fixed - a Raspberry Pi just set up on Wi-Fi from its page could join the home network and then open its setup network again over it ("Mandarin Bridge Setup" back, the Pi gone from the home network) when NetworkManager took a few seconds joining: the setup network is now opened only where the Pi is still on no network
- Fixed - a Pi whose home network went for a minute (a router restarted) opened its setup network and stayed on it until someone joined the home network again from its page. It now closes it now and then for NetworkManager to join the home network it knows, and stays on it once it is back
- Fixed - security: a web page reaching a Bridge under its own site's name (DNS rebinding) passed its check of where a change comes from, the name and the page alike its own; a browser's change is now taken only under a name a home uses (an address, a bare name, .local, .lan, the tailnet's), as Mandarin's server takes one. Both Bridges
- Fixed - the Android Bridge stopped whenever any computer on the network sent it a request with a negative length; such a request is refused, and anything one request does wrong ends only that request
- Improved - Mandarin Bridge is 0.3.6

## v0.3.5

- Fixed - the Linux Bridge (and the Pi's) couldn't update where .NET's secure connection to GitHub failed before GitHub's certificate was seen: a DietPi's said "GitHub couldn't be reached (SecureConnectionError)" every time, though curl on the same computer (the install line's) fetched GitHub's releases. It now says what .NET said, and fetches with curl instead; the download is checked against its checksum (and signature) as before. A certificate refused (a wrong clock, missing certificates, an answer not GitHub's) is still said in words, and never fetched around (item 385)
- Fixed - installed again by hand, a Linux Bridge could go on running an older update it had fetched itself (kept in its data folder, run in place of the program installed). install.sh now clears it, and the Bridge never hands over to an update older than itself (item 385)
- Improved - Mandarin Bridge is 0.3.5

## v0.3.4

- Fixed - the Linux Bridge (and the Pi's) took an update the checksum beside it agreed with, which whoever could replace the release could replace with it (the security audit's ninth finding). Each Linux build is now signed with Mandarin's release key, its signature in the sidecar, and once a Bridge carries the key's public half it installs only a build signed with it, saying so where one isn't (item 371)
- Improved - Mandarin Bridge is 0.3.4

## v0.3.3

- Fixed - an update that couldn't make a secure connection to GitHub said only "GitHub couldn't be reached (SecureConnectionError)". It now says why: GitHub's certificate not valid on the computer's date, its clock wrong (a Raspberry Pi has no clock of its own, and one that hasn't set its time sees GitHub's certificate as not valid yet), with where to set it to sync; the computer's certificates missing or out of date, with the line that installs them again; or the answer not GitHub's (item 359)
- Improved - Mandarin Bridge is 0.3.3

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
