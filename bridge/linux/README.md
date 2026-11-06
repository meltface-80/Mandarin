# Mandarin Bridge for Linux

A computer with a USB DAC on its port (a Raspberry Pi beside the DAC, an old laptop, a mini PC) as a player that
Mandarin plays to, bit-perfect. It is the Android app's twin: the same SlimProto player (as Squeezelite is; a UPnP
renderer before 0.3.0), the same `/dac.json`, so it finds Mandarin by itself, Mandarin reads the DAC whole (every rate,
depth and DSD multiple) and confirms what the DAC is fed (the ✓ on Now playing). Mandarin does all the work (any
upsampling, DSD made from PCM) and sends the Bridge what the DAC is to play. It plays with Mandarin's own audio engine (`engine/`, the program the
server plays a DAC on its own computer with): each track decoded and written to the DAC at its own rate, untouched,
gapless into the next; DSD as native DSD where the DAC takes it, else as DoP.

## Install

On a 64-bit Debian, Ubuntu or Raspberry Pi OS computer (x64, or arm64: a Pi 3, 4, 5 or Zero 2), as root:

    curl -fsSL https://github.com/meltface-80/Mandarin/releases/download/test-bridge/install.sh | sudo sh

It installs the Bridge and the audio engine in `/usr/lib/mandarin-bridge`, ffmpeg where it isn't there, and a
systemd service that starts it at boot (`systemctl status mandarin-bridge`, `journalctl -u mandarin-bridge`).
Then switch it on in Mandarin's *Settings → Audio Devices*. It finds Mandarin on its own network (a broadcast to port
3483); where Mandarin is elsewhere (another subnet, over a VPN), point it there: add `--server <Mandarin's address>` to
`ExecStart` in `/etc/systemd/system/mandarin-bridge.service`. A Bridge Mandarin knew as a UPnP renderer keeps its name
and settings there.

Updated from then on from Mandarin's *Settings → Updates* (item 291): a tap and the Bridge fetches its new build
itself, checks it against the release's checksum, puts it in `/var/lib/mandarin-bridge/app` and starts again into it;
an update that fails as it starts is let go and the installed one runs on. A Bridge installed before this needs this
install once more, by hand.

Its log goes to journald (`journalctl -u mandarin-bridge`) and its last 2,000 lines are kept in memory as well, at
`GET /log` (`Kept.cs`): the Mandarin app's Save log (Settings → Setup → Logging) has them, gathered by the server.

## Its page

There is no screen, so the Bridge has a page of its own: `http://<the computer>:49494/`. It shows:

- the DAC it plays to, and a choice of DAC where more than one is plugged in;
- what plays and how the DAC is fed;
- its name on the network;
- how DSD goes (native where the DAC takes it, DoP only, or none);
- the Mandarin it is played by, and when it last heard from it;
- the details to copy should something be wrong.

## How it fits together

| File | What it does |
|---|---|
| `Program.cs` | the command line (`--port`, `--data`, `--engine`, `--ffmpeg`, `--asound`, `--device`, `--address`, `--server`) |
| `Bridge.cs`, `Bridge.Routes.cs` | the DAC chosen, `/dac.json`, its hello's capabilities, the HTTP routes, the page's state and settings |
| `Dac.cs` | the USB DACs the kernel lists (`/proc/asound`): each altset's format and rates |
| `Player.cs` | the audio engine, driven over its stdin and stdout |
| `Slim.cs` | SlimProto: Mandarin found, connected to, and what its `strm` says played through the engine; what happens said back (STAT) |
| `Http.cs`, `Xml.cs` | its web service: `/dac.json`, `/update`, `/log`, its page |
| `Web.cs` | its page |
| `Wifi.cs` | its Wi-Fi from its page, through NetworkManager, and a setup network where there is none (`--wifi`: the Pi image's) |
| `Store.cs` | its name, its UDN (its SlimProto id is made from it), the DAC chosen and the DSD setting (`settings.json` in its data folder) |

Build it with `./build.sh` (the .NET 10 SDK and clang), beside the engine (`engine/build.sh`); `RID=linux-arm64`
builds for a Pi. `test/bridge-linux.test.js` plays to it end to end from Mandarin's server.
