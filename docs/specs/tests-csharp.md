# The tests and tools in C# (v1.0.6)

The owner's option A: the 126 test files (about 27,800 lines), their helpers and the development
tools leave JavaScript for C#, and Node.js and npm leave the project with them. Nothing the server
or the page does changes. The page itself stays HTML, CSS and JavaScript.

## How the C# suite runs

- `test/Mandarin.Tests/` is an xUnit v3 project: `dotnet test test/Mandarin.Tests` from the
  repository root. Test classes run side by side, four at a time (`xunit.runner.json`).
- Each test has five minutes at most (`[Test]`, the Node suite's `--test-timeout`).
- The harness (`Harness/`) is the Node suite's helpers in C#:

  | Node | C# |
  |---|---|
  | `test/server.js` | `ServerProcess` (the program started, waited for, stopped) and `TestServer` (createServer's options; the database, the private addresses, a restart, a signed speaker address) |
  | `test/helpers.js`, `test/auth-helper.js` | `Session` (a server on a fresh fixture library, signed in, its first scan done; `Until`) |
  | `test/ports.js` | `Ports` (its own registry, ports from 22000 and addresses from 127.0.0.150, apart from the Node suite's while both run) |
  | `test/fixtures.js` | `Fixtures` (the ffmpeg-made library, DSF, FLAC's stream info) |
  | `test/setup.js` | `Http` (nothing off this machine; no request waits more than 90 s) |
  | `test/browser-harness.js` | `Browser`, `Page` (Chromium over the DevTools WebSocket) |
  | `test/score.js` | `Score` (`mandarin-server score`) |
  | `public/srp.js` in Node | `Srp` (the device's half), held to `test/srp-vector.json` |

- The page's own scripts (`srp.js`, and later `biquad.js`, `sharecard.js`, `shelforder.js`) are
  tested in headless Chromium, the browser they are written for, not in a JavaScript engine of C#'s.
- CI runs both suites while the move goes on: each test job runs its third of the Node files, then
  its third of the C# classes (`.github/csharp-tests.sh k/n`). A C# test that fails runs once more on
  its own; a pass then is a warning on the run, a failure again fails the job, as
  `.github/retry-failed.sh` has it for the Node suite. The release runs both, whole.

## How a file moves

- One JavaScript file becomes one C# class, its tests one for one, saying the same; the JavaScript
  file is deleted in the same pull request.
- A ported test passes against the server as it is. A sample of each batch is shown failing once
  with the server's code broken (the rule in docs/quality-plan.md), then put right.
- What a test runs in the page (an expression evaluated there) stays the page's language: it is the
  page being tested.
- New helpers go in `Harness/`; nothing the tests need is added to the server.

## The stages

| Stage | What | Branch |
|---|---|---|
| T0 | The project, the harness, CI; SRP, the version check, favourites, mounts | `v1.0.6-tests-csharp-0-groundwork` |
| T1a | 17 files that need no fakes: cpu, db, http-body, listen-later, music-folders, power, queue-moves, soap-retry, topology, version-compare, watch, waveform, home-rows, relay, case, identify-verdicts, page-script | `v1.0.6-tests-csharp-1-core` |
| T1b | 10 more of the server alone: config-csharp, identify-pack, phone-resume, library-kept, pages-csharp, downloads, folder-names, playlists, nothing-behind, album-folders | `v1.0.6-tests-csharp-2-core` |
| T1c… | The rest of the files in batches, the fakes (Sonos household, renderers, services) as they are needed, the browser tests | `v1.0.6-tests-csharp-<n>-<what>` |
| Tools | The quality gates, the API map and the MusicBrainz pack builder in C#; Node and npm out of CI and the repository | `v1.0.6-tools-csharp` |

Each stage is a pull request into `migration`, squash-merged when green.
