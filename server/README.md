# Mandarin's server in C#

`mandarin-server` is Mandarin's server, being moved from Node.js to C# (.NET 10) one part at a
time, from v0.8.1 on.

## How it runs while the move is under way

The C# server is the front door. It takes Mandarin's port (`PORT`, 3500), answers the parts
already moved to C#, and passes everything else, as it came, to the Node server behind it. It
starts the Node server itself (`node launcher.js`, so in-app updates work as before) on a free port
on `127.0.0.1` that nothing else can reach, and stops when it stops.

- **Who is asking** goes through unchanged. The Node server tells home from away by the caller's
  address, believing `X-Forwarded-For` only from this machine (the built-in Tailscale speaks for the
  device behind it). The C# server works the caller out the same way and passes on only that, so no
  device can claim to be at home by sending the header itself.
- **Streams and held requests** pass straight through, as long as they last; request bodies have
  no size limit (a whole database restored from a backup).
- Every response says which server it came through: `X-Mandarin-Server: C# 0.8.1`.
  `GET /server-info` answers from C# itself.

When nothing is passed on any more, the Node server, and Node itself, leave the image.

## What has moved

| Part | Where it is |
|---|---|
| The port, who is asking, the Node server's start and stop | C# (v0.8.1) |
| The audio engine for sound devices on the server | C# (v0.8.0, `engine/`) |
| Everything else | Node, behind the C# server |

## Building and testing

`./build.sh` builds `server/bin/mandarin-server`: one self-contained file, no .NET needed where it
runs (needs the .NET 10 SDK to build).

`MANDARIN_FRONT=1 npm test` runs the whole suite with every test's server behind the C# server, as
in the image (`test/setup.js`). CI runs it that way on Node 22 and directly on Node 20; both must
pass. A part moves to C# only when the suite still passes both ways.
