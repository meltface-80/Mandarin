# Mandarin Bridge for Linux

A computer with a USB DAC on its port (a Raspberry Pi beside the DAC, an old laptop, a mini PC) as a renderer that
Mandarin plays to, bit-perfect. It is the Android app's twin: the same UPnP renderer on the network, the same
`/dac.json`, so Mandarin finds it by itself, reads the DAC whole (every rate, depth and DSD multiple) and confirms
what the DAC is fed (the ✓ on Now playing). It plays with Mandarin's own audio engine (`engine/`, the program the
server plays a DAC on its own computer with): each track decoded and written to the DAC at its own rate, untouched,
gapless into the next; DSD as native DSD where the DAC takes it, else as DoP.

## Install

On a 64-bit Debian, Ubuntu or Raspberry Pi OS computer (x64, or arm64: a Pi 3, 4, 5 or Zero 2), as root:

    curl -fsSL https://github.com/meltface-80/Mandarin/releases/download/test-bridge/install.sh | sudo sh

It installs the Bridge and the audio engine in `/usr/lib/mandarin-bridge`, ffmpeg where it isn't there, and a
systemd service that starts it at boot (`systemctl status mandarin-bridge`, `journalctl -u mandarin-bridge`).
Then switch it on in Mandarin's *Settings → Audio Devices*.

## Its page

There is no screen, so the Bridge has a page of its own: `http://<the computer>:49494/`. It shows:

- the DAC it plays to, and a choice of DAC where more than one is plugged in;
- what plays and how the DAC is fed;
- its name on the network;
- how DSD goes (native where the DAC takes it, DoP only, or none);
- who last played to it;
- the details to copy should something be wrong.

## How it fits together

| File | What it does |
|---|---|
| `Program.cs` | the command line (`--port`, `--data`, `--engine`, `--ffmpeg`, `--asound`, `--device`, `--address`) |
| `Bridge.cs`, `Bridge.Routes.cs` | the DAC chosen, `/dac.json`, the Sink, the HTTP routes, the page's state and settings |
| `Dac.cs` | the USB DACs the kernel lists (`/proc/asound`): each altset's format and rates |
| `Player.cs` | the audio engine, driven over its stdin and stdout |
| `Renderer.cs` | AVTransport, RenderingControl and ConnectionManager over the engine |
| `Ssdp.cs`, `Http.cs`, `Events.cs`, `Soap.cs`, `Scpd.cs`, `Xml.cs` | UPnP: discovery, HTTP, eventing, SOAP, the descriptions |
| `Web.cs` | its page |
| `Wifi.cs` | its Wi-Fi from its page, through NetworkManager, and a setup network where there is none (`--wifi`: the Pi image's) |
| `Store.cs` | its name, its UPnP id, the DAC chosen and the DSD setting (`settings.json` in its data folder) |

Build it with `./build.sh` (the .NET 10 SDK and clang), beside the engine (`engine/build.sh`); `RID=linux-arm64`
builds for a Pi. `test/bridge-linux.test.js` plays to it end to end from Mandarin's server.
