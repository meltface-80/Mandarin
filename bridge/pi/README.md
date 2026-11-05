# Mandarin Bridge for Raspberry Pi

A Raspberry Pi beside the DAC, as a renderer Mandarin plays to bit-perfect: Raspberry Pi OS Lite (64-bit) with
[Mandarin Bridge for Linux](../linux/README.md), the audio engine it plays with and ffmpeg, the Bridge started at
boot. For a Pi 3, 4, 5 or Zero 2 W.

## Set it up

1. Download `mandarin-bridge-pi-arm64.img.xz` from the
   [test-bridge](https://github.com/meltface-80/Mandarin/releases/tag/test-bridge) pre-release.
2. Flash it with [Raspberry Pi Imager](https://www.raspberrypi.com/software/): *Choose OS → Use custom*. Its own
   settings work as usual: set your Wi-Fi there (and a user and SSH, should you want to log in), or leave them.
3. Plug the DAC into the Pi's USB port and power it on.
4. Its page is at **http://mandarin-bridge.local:49494/** once it is on your network. With no network set, the Pi opens
   its own Wi-Fi, **Mandarin Bridge Setup** (password `mandarin-setup`): join it from a phone, open
   **http://10.42.0.1:49494/**, choose your home network and give its password. The Pi joins it, the setup network
   closes, and the phone goes back to your Wi-Fi; should it fail, the setup network opens again.
5. In Mandarin, *Settings → Audio Devices*: switch the Bridge on. It plays like any room.

Wi-Fi is set for the UK (`cfg80211.ieee80211_regdom=GB` in `cmdline.txt`); the Imager's own Wi-Fi country, or that
line changed, sets another.

## How it is made

`build-image.sh`, on 64-bit ARM Linux (GitHub's ARM runner in `bridge-pi.yml`), as root:

- takes the latest Raspberry Pi OS Lite (64-bit) and grows its root partition by a gigabyte;
- installs ffmpeg in it;
- installs the Bridge, the engine and their systemd service, with `pi.conf` laid over it: run as root, so its page
  can set the Wi-Fi through NetworkManager (`--wifi`);
- names it `mandarin-bridge` and lets its Wi-Fi start;
- checks that the Bridge and ffmpeg run inside it.

A push to dev puts the image on the `test-bridge` pre-release.
