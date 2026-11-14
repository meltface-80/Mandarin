<div align="center">

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/mandarin-logo-light.png">
  <img width="800" alt="Mandarin by MusicD" src="docs/mandarin-logo-dark.png">
</picture>

</div>

# Mandarin — v1.3.2

<a href="https://buymeacoffee.com/musicd_projects"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" height="48"></a>

**Your own music files, played to Sonos rooms, to UPnP/DLNA renderers (a WiiM, a Chord Poly,
a streamer, an AV receiver), to a USB DAC through Mandarin Bridge and to the Mandarin Android app.**

A server on a machine you own scans your music folders and plays them to the players in your
house. You control it from a browser, an iPhone home-screen app or the Android app. No
subscription or streaming account is needed. Album names are looked up online (MusicBrainz,
Wikipedia, Deezer and others); your music files stay on your machine. Run the server on
[Mandarin OS](#mandarin-os), a system made for it alone (recommended), or [on Linux](#install-on-linux).

## 📖 [Everything else is on the site: meltface-80.github.io/Mandarin](https://meltface-80.github.io/Mandarin/)

Every feature and how to use it, the guides to install, set up and troubleshoot, and the downloads:
**[meltface-80.github.io/Mandarin](https://meltface-80.github.io/Mandarin/)**.

**New in v1.3.2** (Mandarin Bridge v0.3.10; Mandarin OS 0.1.6):
* **Mandarin OS 0.1.6:** Reinstall Mandarin keeps the box's settings; a box on 0.1.4 or later updates itself to it.
* **The app's built-in Tailscale no longer gets the app ended by Android.**
* **Mandarin OS's addresses by the box's address**, the one its screen shows.

[What's new](https://meltface-80.github.io/Mandarin/whats-new.html) on the site, and every change in the [changelog](CHANGELOG.md).

## Downloads

The newest of each, straight to your device. **Mandarin OS** is the recommended way to run the server: an image for a
USB stick. On Linux, the alternative, the server's install is one command, below.

| What | Version | Download |
| --- | --- | --- |
| **Mandarin OS**, a system made only to run Mandarin Server, the recommended way (a 64-bit Intel or AMD PC with UEFI) | 0.1.6 | [mandarin-os-0.1.6-x64.img.xz](https://github.com/meltface-80/Mandarin/releases/download/mandarin-os-v0.1.6/mandarin-os-0.1.6-x64.img.xz) for balenaEtcher or dd · [mandarin-os-0.1.6-x64.img](https://github.com/meltface-80/Mandarin/releases/download/mandarin-os-v0.1.6/mandarin-os-0.1.6-x64.img) for a phone; see [Mandarin OS](#mandarin-os) below |
| **Mandarin server** on Linux, the alternative (Debian, Ubuntu, Raspberry Pi OS; x64 or arm64) | v1.3.2 | the one line under [Install on Linux](#install-on-linux) |
| **Mandarin Remote**, the Android app (Android 8.0 or newer) | v1.3.2 | [mandarin-android.apk](https://github.com/meltface-80/Mandarin/raw/main/dist/mandarin-android.apk) |
| **Mandarin Bridge** for Android (a FiiO R7, say) | v0.3.12 | [mandarin-bridge.apk](https://github.com/meltface-80/Mandarin/releases/download/mandarin-bridge-v0.3.12/mandarin-bridge.apk) |
| **Mandarin Bridge** for Raspberry Pi (3, 4, 5, Zero 2 W) | v0.3.12 | [mandarin-bridge-pi-arm64.img.xz](https://github.com/meltface-80/Mandarin/releases/download/mandarin-bridge-v0.3.12/mandarin-bridge-pi-arm64.img.xz) |
| **Mandarin Bridge** for Linux (64-bit Debian, Ubuntu, Raspberry Pi OS) | v0.3.12 | `curl -fsSL https://github.com/meltface-80/Mandarin/releases/download/mandarin-bridge-v0.3.12/install.sh \| sudo sh`, or by hand: [x64](https://github.com/meltface-80/Mandarin/releases/download/mandarin-bridge-v0.3.12/mandarin-bridge-linux-x64.tar.gz) · [arm64](https://github.com/meltface-80/Mandarin/releases/download/mandarin-bridge-v0.3.12/mandarin-bridge-linux-arm64.tar.gz) |
| The server program on its own, what Settings → Updates fetches | v1.3.2 | [linux-x64](https://github.com/meltface-80/Mandarin/releases/latest/download/mandarin-server-linux-x64.gz) · [linux-arm64](https://github.com/meltface-80/Mandarin/releases/latest/download/mandarin-server-linux-arm64.gz) · [sums](https://github.com/meltface-80/Mandarin/releases/latest/download/mandarin-server.sha256) |
| **How Mandarin finds and names your music**, a guide in plain words | | [PDF](docs/Mandarin-music-scanning-guide.pdf) |

On an iPhone or iPad there is nothing to download: open `http://<server-ip>:3500` in Safari and tap **Share → Add
to Home Screen** ([On your phone](https://meltface-80.github.io/Mandarin/apps.html)).

## Install

Mandarin runs on an always-on computer on the same network as your speakers.

### Mandarin OS

*Recommended:* a lightweight system made only to run Mandarin, on a computer of its own (a 64-bit Intel or AMD PC with
UEFI and wired network, such as a mini PC), with its own web page to look after everything. Write the image to a USB
stick of 4 GB or more ([step by step](https://meltface-80.github.io/Mandarin/mandarin-os.html#usb)):

* **balenaEtcher** (Windows, macOS, Linux): flash `mandarin-os-0.1.6-x64.img.xz` as it is ([how](https://meltface-80.github.io/Mandarin/mandarin-os.html#etcher)).
* **A Linux terminal:** `xz -dc mandarin-os-0.1.6-x64.img.xz | sudo dd of=/dev/sdX bs=4M conv=fsync status=progress`, with `sdX` the stick ([how](https://meltface-80.github.io/Mandarin/mandarin-os.html#dd)).
* **An Android phone, with EtchDroid:** write the plain `mandarin-os-0.1.6-x64.img` ([how](https://meltface-80.github.io/Mandarin/mandarin-os.html#android)).

Then start the PC from the stick, with Secure Boot off, and answer the installer's questions
([Install it](https://meltface-80.github.io/Mandarin/mandarin-os.html#install), [Using Mandarin OS](https://meltface-80.github.io/Mandarin/mandarin-os.html#using)).

### Install on Linux

*The alternative:* on Debian, Ubuntu or Raspberry Pi OS (64-bit, x64 or arm64), one line as root, then open
`http://<server-ip>:3500`:

```bash
curl -fsSL https://raw.githubusercontent.com/meltface-80/Mandarin/main/tools/linux/install.sh | sudo bash -s -- --music /srv/music
```

Its options, removing it and a USB DAC on the same machine: [Install on Linux](https://meltface-80.github.io/Mandarin/install.html#linux).

## Updating

**Settings → Updates → Check for update** in Mandarin updates the server, the Android app and every Mandarin Bridge;
Mandarin OS updates itself from its system page ([Updating](https://meltface-80.github.io/Mandarin/install.html#updating)).

## Guides

[Features](https://meltface-80.github.io/Mandarin/features.html) ·
[Mandarin OS](https://meltface-80.github.io/Mandarin/mandarin-os.html) ·
[Mandarin Bridge](https://meltface-80.github.io/Mandarin/bridges.html) ·
[Upsampling and output](https://meltface-80.github.io/Mandarin/upsampling.html) ·
[Away from home](https://meltface-80.github.io/Mandarin/away.html) ·
[Qobuz and Tidal](https://meltface-80.github.io/Mandarin/services.html) ·
[Settings for the server](https://meltface-80.github.io/Mandarin/configuration.html) ·
[Your account](https://meltface-80.github.io/Mandarin/account.html) ·
[Logs](https://meltface-80.github.io/Mandarin/logs.html) ·
[Troubleshooting](https://meltface-80.github.io/Mandarin/troubleshooting.html) ·
[How it works, building and testing](https://meltface-80.github.io/Mandarin/how-it-works.html) ·
[CHANGELOG](CHANGELOG.md)

## License

MIT. The Sonos control is ported from Caldera Sonos Bridge and the UPnP to Sonos bridge, by the
same author.
