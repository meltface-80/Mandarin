# Mandarin's audio engine

`mandarin-audio` plays a sound device on the computer Mandarin runs on (a USB DAC, the speakers,
HDMI). It is written in C# (.NET 10) and built ahead of time to one native program, so nothing of
.NET is needed where it runs.

The server starts one per device (`lib/local/engine.js`) and talks to it over stdin and stdout,
one JSON object a line; `Mandarin.Audio/Program.cs` lists the commands and events.

| File | What it does |
|---|---|
| `Program.cs` | the command line, the control channel |
| `Engine.cs` | the decoder thread (ffmpeg into the buffer), the playback thread (the buffer to the device), the position |
| `Sinks.cs` | the devices: ALSA, and the tests' file |
| `Native.cs` | the C calls: ALSA (libasound), the thread's core and priority (libc) |

Build it with `./build.sh` (needs the .NET 10 SDK and clang): the program lands in
`engine/bin/mandarin-audio`, where the server looks first. `RID=linux-arm64 ./build.sh` builds
for another platform. The tests are `test/engine.test.js` in the server's suite.
