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
- Every response says which server it came through (`X-Mandarin-Server: C# <version>`), and one
  C# wrote itself says so (`X-Mandarin-Answered: C#`). `GET /server-info` answers from C# itself.
  `test/front.test.js` pins which server answers what.
- **The library** is read here from a copy in memory, as the Node server keeps one. Which copy is
  current is the Node server's to say (it still scans and takes edits): each library request asks
  it first, on a private address with a key this server gave it (`/internal/library`), and the
  copy here is rebuilt from the database when it changed, and checked every five seconds besides,
  so a screen seldom waits for the rebuild. On 20,000 albums a rebuild takes about half a second,
  as the Node server's own does; lists are sorted with ICU sort keys, computed once per rebuild. Names sort as JavaScript sorts them
  (ICU's collation, so the image carries libicu), and `test/library-front.test.js` asks both
  servers the same questions and checks the answers are the same.
- **Compression:** what C# answers itself goes out gzipped, as the Node server's did.
- **The database** is the Node server's (`<data>/musicd.db`), shared: the Node server makes it and
  brings its tables up to date first; C# opens it afresh for each request, so a database put back
  from a backup is the one read next.

When nothing is passed on any more, the Node server, and Node itself, leave the image.

## What has moved

| Part | Where it is |
|---|---|
| The port, who is asking, the Node server's start and stop | C# (v0.8.1) |
| Signing in, signed-in devices, the gate (`Auth.cs`, `Srp.cs`) | C# (v0.8.2); streams and covers still gated by Node |
| The page and its files, `public/` (`Pages.cs`) | C# (v0.8.3); deep links, `/login`, `/display` still Node's |
| Reading the library: the Library wall and its Focus sheet, search, artists, an album's page, genres, decades, the random wall, Favourites, Listen later (`Library.cs`, `LibraryRoutes.cs`, `Names.cs`) | C# (v0.8.4); scans, edits, hearts, labels, Home's rows and a streamed album's page still Node's |
| Home's rows: Album of the day, Label of the week, Recently played, Not played lately (`HomeRoutes.cs`) | C# (v0.8.6); the day and week are the Node server's clock's, told with the library's state; Smart picks still Node's |
| Covers already drawn and label logos, to signed-in devices and signed addresses (`Images.cs`) | C# (v0.8.5); drawing a cover the first time, and a speaker asking by its own address, still Node's |
| The audio engine for sound devices on the server | C# (v0.8.0, `engine/`) |
| Everything else | Node, behind the C# server |

## Building and testing

`./build.sh` builds `server/bin/mandarin-server`: one self-contained file, no .NET needed where it
runs (needs the .NET 10 SDK to build).

`MANDARIN_FRONT=1 npm test` runs the whole suite with every test's server behind the C# server, as
in the image (`test/setup.js`). CI runs it that way on Node 22 and directly on Node 20; both must
pass. A part moves to C# only when the suite still passes both ways.
