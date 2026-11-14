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
systemd service that starts it at boot (`systemctl status mandarin-bridge`, `journalctl -u mandarin-bridge`), run as
a user of its own, `mandarin-bridge`, its data folder `/var/lib/mandarin-bridge`. Before 0.3.12 the service ran as a
DynamicUser, whose data folder systemd 256 and later (Debian 13) mount so nothing in it can be run, and its update
couldn't be installed (item 415): run the install line again and it runs as its own user, its data folder kept (who it
is to Mandarin, its settings, its logs). On Mandarin OS, Mandarin OS 0.1.7 does this for the Bridge installed.
Then switch it on in Mandarin's *Settings → Audio Devices*. It finds Mandarin on its own network (a broadcast to port
3483); where Mandarin is elsewhere (another subnet, over a VPN), point it there: add `--server <Mandarin's address>` to
`ExecStart` in `/etc/systemd/system/mandarin-bridge.service`. A Bridge Mandarin knew as a UPnP renderer keeps its name
and settings there.

Updated from then on from Mandarin's *Settings → Updates* (item 291): a tap and the Bridge fetches its new build
itself, checks it against the release's checksum, puts it in `/var/lib/mandarin-bridge/app` and starts again into it;
an update that fails as it starts is let go and the installed one runs on; one that can't be fetched or checked says
why on the Bridge's row there. A Bridge from before v0.3.1 needs this install once more, by hand: it asked GitHub
without a User-Agent, which GitHub refuses (item 327).

Its log goes to journald (`journalctl -u mandarin-bridge`) and its last 2,000 lines are kept in memory as well, at
`GET /log` (`Kept.cs`): the Mandarin app's Save log (Settings → Setup → Logging) has them, gathered by the server.

## The bit-perfect check: `/capture`

Mandarin's bit-perfect check and SQ-tool (item 412) ask the Bridge to record exactly what it feeds the DAC, as they
ask the Android Bridge: the same `/capture` ([bridge/README.md](../README.md#the-bit-perfect-check-capture)), the same
WAV and sidecar, and `/dac.json` says `"capture": "/capture"` and `"capture_parts": true`. The audio engine records it
(`engine/Mandarin.Audio/Capture.cs`): a tap in front of its ALSA device, so the bytes are those it hands ALSA for the
DAC, after every conversion it makes. PCM and DoP are in its 32-bit words (`S32_LE`), native DSD in its `DSD_U32_BE`
or `DSD_U32_LE` words, so the WAV's container and valid bits are 32 and the sidecar's `format` names which;
`dsd_setting` says `native` or `native_le` for native DSD. Only made when asked: up to two minutes in one piece, or a
whole track in parts from the next flush (the track played again from its start), written on a thread of the
engine's own so a slow disk never holds the DAC up, into `capture/` in the Bridge's data folder, emptied as it starts
and as each recording starts; each part is let go once Mandarin fetches it. What ALSA's plug layer then does to fit a
DAC's own format (a 24-bit slot) is after the tap. A Bridge before 0.3.11 can't record, and Mandarin says so.

## Its page

There is no screen, so the Bridge has a page of its own: `http://<the computer>:49494/`. It shows:

- the DAC it plays to, and a choice of DAC where more than one is plugged in;
- what plays and how the DAC is fed;
- its name on the network;
- how DSD goes (native where the DAC takes it, DoP only, or none);
- the Mandarin it is played by, and when it last heard from it;
- the details to copy should something be wrong.

## Native DSD, and the kernel

Native DSD on Linux is the kernel's to offer. Linux's USB audio driver lists a DAC's native DSD (`DSD_U32_BE`) only
where its quirk table knows that DAC's maker; any other DAC is offered PCM alone, and its DSD goes as DoP, even where
the DAC itself says it takes DSD natively (its USB descriptor's raw-data format, which Mandarin Bridge for Android
reads and plays natively). The Bridge reads the descriptor too: where it says native DSD and the kernel offers none,
its page, `/dac.json` (`dsd_kernel_fix`) and its log give the line that has the kernel offer it, for that DAC alone:

```
echo "options snd-usb-audio vid=0x2622 pid=0x0041 quirk_flags=0x8000" | sudo tee /etc/modprobe.d/mandarin-dsd.conf
```

(its own `vid` and `pid`, as `lsusb` shows them), then unplug the DAC and plug it in again, or restart. `quirk_flags`
bit 15 is the driver's generic raw DSD (`QUIRK_FLAG_DSD_RAW`, Linux 5.15 and later); set for one DAC, it replaces
what the driver's own table gives that DAC. To undo it, delete the file and replug.

## How it fits together

| File | What it does |
|---|---|
| `Program.cs` | the command line (`--port`, `--data`, `--engine`, `--ffmpeg`, `--asound`, `--device`, `--address`, `--server`, `--sys`) |
| `Bridge.cs`, `Bridge.Routes.cs` | the DAC chosen, `/dac.json`, its hello's capabilities, the HTTP routes, the page's state and settings |
| `Dac.cs` | the USB DACs the kernel lists (`/proc/asound`): each altset's format and rates; its USB descriptor (sysfs) read for raw DSD the kernel holds back |
| `Player.cs` | the audio engine, driven over its stdin and stdout |
| `Capture.cs` | `/capture`: a recording of what the DAC is fed, made by the engine's tap, for the bit-perfect check |
| `Slim.cs` | SlimProto: Mandarin found, connected to, and what its `strm` says played through the engine; what happens said back (STAT) |
| `Http.cs`, `Xml.cs` | its web service: `/dac.json`, `/update`, `/log`, `/capture`, its page |
| `Web.cs` | its page |
| `Wifi.cs` | its Wi-Fi from its page, through NetworkManager, and a setup network where there is none (`--wifi`: the Pi image's) |
| `Store.cs` | its name, its UDN (its SlimProto id is made from it), the DAC chosen and the DSD setting (`settings.json` in its data folder) |

Build it with `./build.sh` (the .NET 10 SDK and clang), beside the engine (`engine/build.sh`); `RID=linux-arm64`
builds for a Pi. `test/bridge-linux.test.js` plays to it end to end from Mandarin's server.
