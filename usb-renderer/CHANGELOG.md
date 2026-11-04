# Changelog

## Unreleased

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
